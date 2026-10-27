import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { PLACEHOLDER_CALIBRATION, type Calibration } from "@level-logger/shared";
import { calibrations, devices } from "./db/schema.js";
import type { Db } from "./db/types.js";

/** The key is 256 random bits, so a fast hash is enough to store it safely. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function newApiKey(): string {
  return `ll_${randomBytes(32).toString("base64url")}`;
}

export async function findDeviceByKey(db: Db, key: string) {
  const [device] = await db.select().from(devices).where(eq(devices.apiKeyHash, hashApiKey(key)));
  return device ?? null;
}

/** Creates a device with a placeholder calibration. The returned key is shown once and never stored. */
export async function createDevice(db: Db, name: string) {
  const apiKey = newApiKey();
  const [device] = await db.insert(devices).values({ name, apiKeyHash: hashApiKey(apiKey) }).returning();
  await db.insert(calibrations).values({
    deviceId: device!.id,
    effectiveFrom: new Date(0),
    ...PLACEHOLDER_CALIBRATION,
    note: "Placeholder until the sensor is calibrated",
  });
  return { device: device!, apiKey };
}

export async function rotateApiKey(db: Db, deviceId: number): Promise<string | null> {
  const apiKey = newApiKey();
  const updated = await db
    .update(devices)
    .set({ apiKeyHash: hashApiKey(apiKey) })
    .where(eq(devices.id, deviceId))
    .returning({ id: devices.id });
  return updated.length > 0 ? apiKey : null;
}

export interface CalibrationPeriod {
  effectiveFrom: Date;
  calibration: Calibration;
  note: string | null;
}

/** Every calibration of a device, oldest first. */
export async function calibrationHistory(db: Db, deviceId: number): Promise<CalibrationPeriod[]> {
  const rows = await db
    .select()
    .from(calibrations)
    .where(eq(calibrations.deviceId, deviceId))
    .orderBy(asc(calibrations.effectiveFrom));
  return rows.map((r) => ({
    effectiveFrom: r.effectiveFrom,
    calibration: { adc1: r.adc1, inches1: r.inches1, adc2: r.adc2, inches2: r.inches2 },
    note: r.note,
  }));
}

/** The calibration in force at `at`; the earliest one if `at` precedes them all. */
export function calibrationAt(history: CalibrationPeriod[], at: Date): Calibration {
  let current = history[0]?.calibration ?? PLACEHOLDER_CALIBRATION;
  for (const period of history) {
    if (period.effectiveFrom.getTime() > at.getTime()) break;
    current = period.calibration;
  }
  return current;
}

/** Adds a calibration that takes over from `effectiveFrom`. Earlier calibrations are left alone. */
export async function addCalibration(
  db: Db,
  deviceId: number,
  cal: Calibration,
  effectiveFrom: Date,
  note?: string,
) {
  if (cal.adc1 === cal.adc2) throw new Error("The two calibration points need different raw readings");
  const clash = await db
    .select({ id: calibrations.id })
    .from(calibrations)
    .where(and(eq(calibrations.deviceId, deviceId), eq(calibrations.effectiveFrom, effectiveFrom)));
  if (clash.length > 0) throw new Error("This device already has a calibration starting at that moment");
  await db.insert(calibrations).values({ deviceId, effectiveFrom, ...cal, note: note ?? null });
}
