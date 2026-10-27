import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import * as schema from "../src/db/schema.js";
import { addCalibration, createDevice } from "../src/devices.js";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let clock = new Date("2026-01-01T12:00:00.000Z");
let deviceId: number;
let apiKey: string;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  const created = await createDevice(db, "Sump pit");
  deviceId = created.device.id;
  apiKey = created.apiKey;
  app = await buildApp({ db, logger: false, now: () => clock });
}, 60_000);

afterAll(async () => {
  await app.close();
  await pg.close();
});

const post = (body: unknown, key: string | null = apiKey) =>
  app.inject({
    method: "POST",
    url: "/ingest",
    payload: body as object,
    headers: key ? { authorization: `Bearer ${key}` } : {},
  });

describe("ingest", () => {
  it("rejects a missing or wrong key", async () => {
    expect((await post({ adc: 1 }, null)).statusCode).toBe(401);
    expect((await post({ adc: 1 }, "ll_nope")).statusCode).toBe(401);
  });

  it("rejects bodies it does not understand", async () => {
    expect((await post({ samples: [] })).statusCode).toBe(400);
    expect((await post({ adc: -1 })).statusCode).toBe(400);
    expect((await post({ hello: "world" })).statusCode).toBe(400);
  });

  it("timestamps a batch from its arrival, newest last", async () => {
    clock = new Date("2026-01-01T12:01:00.000Z");
    const res = await post({ samples: [100, 200, 300] });
    expect(res.json()).toEqual({ stored: 3 });
    const rows = await db.select().from(schema.readings).orderBy(schema.readings.ts);
    expect(rows.map((r) => [r.ts.toISOString(), r.adc])).toEqual([
      ["2026-01-01T12:00:58.000Z", 100],
      ["2026-01-01T12:00:59.000Z", 200],
      ["2026-01-01T12:01:00.000Z", 300],
    ]);
  });

  it("does not double count a sample at the same instant", async () => {
    const res = await post({ adc: 999 });
    expect(res.json()).toEqual({ stored: 0 });
    const [minute] = await db.select().from(schema.readingsMinute).orderBy(schema.readingsMinute.bucket);
    expect(minute).toMatchObject({ n: 2, sumAdc: 300, minAdc: 100, maxAdc: 200 });
  });

  it("accepts explicit ages", async () => {
    clock = new Date("2026-01-01T12:10:00.000Z");
    expect((await post({ readings: [{ adc: 50, ago_ms: 2500 }, { adc: 60, ago_ms: 0 }] })).json()).toEqual({ stored: 2 });
  });
});

describe("reading the levels", () => {
  it("lists the devices without exposing keys", async () => {
    const res = await app.inject({ method: "GET", url: "/devices" });
    expect(res.json()).toEqual([{ id: deviceId, name: "Sump pit" }]);
  });

  it("reports the current level converted with the placeholder calibration", async () => {
    clock = new Date("2026-01-01T12:10:30.000Z");
    const res = await app.inject({ method: "GET", url: `/devices/${deviceId}/current` });
    const { reading } = res.json();
    expect(reading.adc).toBe(60);
    expect(reading.inches).toBeCloseTo((60 / 1023) * 40);
    expect(reading.ageSeconds).toBe(30);
  });

  it("404s for an unknown device", async () => {
    expect((await app.inject({ method: "GET", url: "/devices/999/current" })).statusCode).toBe(404);
  });

  it("returns raw buckets for a short span", async () => {
    const from = Date.parse("2026-01-01T12:00:00Z") / 1000;
    const res = await app.inject({ method: "GET", url: `/devices/${deviceId}/chart?from=${from}&to=${from + 120}&maxPoints=120` });
    const series = res.json();
    expect(series.bucketSeconds).toBe(1);
    expect(series.t).toEqual([from + 58, from + 59, from + 60]);
  });

  it("uses the per-minute totals for a long span", async () => {
    const from = Date.parse("2026-01-01T12:00:00Z") / 1000;
    const res = await app.inject({ method: "GET", url: `/devices/${deviceId}/chart?from=${from}&to=${from + 3600}&maxPoints=10` });
    const series = res.json();
    expect(series.bucketSeconds).toBe(360);
    // 12:00-12:05 holds the first batch; the second (12:09:57-12:10:00) falls in the next 6-minute bucket.
    expect(series.t).toEqual([from, from + 360]);
  });

  it("rejects a backwards range", async () => {
    expect((await app.inject({ method: "GET", url: `/devices/${deviceId}/chart?from=100&to=50` })).statusCode).toBe(400);
  });
});

describe("calibration history", () => {
  it("converts old readings with the calibration that applied then", async () => {
    await addCalibration(
      db,
      deviceId,
      { adc1: 0, inches1: 0, adc2: 100, inches2: 100 },
      new Date("2026-01-01T12:05:00.000Z"),
    );
    const from = Date.parse("2026-01-01T12:00:00Z") / 1000;
    const series = (
      await app.inject({ method: "GET", url: `/devices/${deviceId}/chart?from=${from}&to=${from + 120}&maxPoints=120` })
    ).json();
    // 12:00:58 is before the new calibration, so it still uses the placeholder (0-1023 -> 0-40 in).
    expect(series.avg[0]).toBeCloseTo((100 / 1023) * 40);

    const later = Date.parse("2026-01-01T12:09:00Z") / 1000;
    const after = (
      await app.inject({ method: "GET", url: `/devices/${deviceId}/chart?from=${later}&to=${later + 120}&maxPoints=120` })
    ).json();
    // After 12:05 one raw unit is one inch.
    expect(after.avg).toEqual([50, 60]);
  });

  it("refuses a calibration with two identical raw points", async () => {
    await expect(
      addCalibration(db, deviceId, { adc1: 5, inches1: 1, adc2: 5, inches2: 2 }, new Date("2026-02-01T00:00:00Z")),
    ).rejects.toThrow();
  });
});
