import { bigint, doublePrecision, integer, pgTable, primaryKey, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

/** A logging device (one per pit or sensor). Only a hash of its API key is stored. */
export const devices = pgTable("devices", {
  id: serial().primaryKey(),
  name: text().notNull(),
  apiKeyHash: text().notNull().unique(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * How raw readings convert to inches. Calibrations are never edited or deleted: a new one takes
 * over from its `effectiveFrom`, and the one in force at a given moment is the latest that started
 * at or before it. Raw readings are stored as received, so history can always be re-read.
 */
export const calibrations = pgTable(
  "calibrations",
  {
    id: serial().primaryKey(),
    deviceId: integer()
      .notNull()
      .references(() => devices.id),
    effectiveFrom: timestamp({ withTimezone: true }).notNull(),
    adc1: doublePrecision().notNull(),
    inches1: doublePrecision().notNull(),
    adc2: doublePrecision().notNull(),
    inches2: doublePrecision().notNull(),
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.deviceId, t.effectiveFrom)],
);

/** Raw readings, as received. `ts` is stamped by the server. */
export const readings = pgTable(
  "readings",
  {
    deviceId: integer()
      .notNull()
      .references(() => devices.id),
    ts: timestamp({ withTimezone: true, precision: 3 }).notNull(),
    adc: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.ts] })],
);

/** Per-minute totals of the raw readings, kept up to date on ingest, so long chart spans stay cheap. */
export const readingsMinute = pgTable(
  "readings_minute",
  {
    deviceId: integer()
      .notNull()
      .references(() => devices.id),
    bucket: timestamp({ withTimezone: true }).notNull(),
    n: integer().notNull(),
    sumAdc: bigint({ mode: "number" }).notNull(),
    minAdc: integer().notNull(),
    maxAdc: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.bucket] })],
);
