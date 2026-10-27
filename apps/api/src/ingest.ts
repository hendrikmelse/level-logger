import { sql } from "drizzle-orm";
import { samplesFromBody, type IngestBody } from "@level-logger/shared";
import { readings, readingsMinute } from "./db/schema.js";
import type { Db } from "./db/types.js";

const MINUTE_MS = 60_000;
// Postgres limits a statement to 65,535 parameters.
const INSERT_CHUNK = 5000;

/**
 * Stores a batch from a device. The newest sample is stamped with `now` and the others are placed
 * before it. Returns how many readings were new: a sample at exactly the same millisecond as an
 * existing one is dropped, and is not counted in the per-minute totals either.
 */
export async function storeBatch(db: Db, deviceId: number, body: IngestBody, now: Date): Promise<number> {
  const rows = samplesFromBody(body).map((s) => ({
    deviceId,
    ts: new Date(now.getTime() - s.agoMs),
    adc: s.adc,
  }));

  return db.transaction(async (tx) => {
    const inserted: { ts: Date; adc: number }[] = [];
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      inserted.push(
        ...(await tx
          .insert(readings)
          .values(rows.slice(i, i + INSERT_CHUNK))
          .onConflictDoNothing()
          .returning({ ts: readings.ts, adc: readings.adc })),
      );
    }

    const buckets = new Map<number, { n: number; sum: number; min: number; max: number }>();
    for (const r of inserted) {
      const key = Math.floor(r.ts.getTime() / MINUTE_MS) * MINUTE_MS;
      const b = buckets.get(key);
      if (b) {
        b.n += 1;
        b.sum += r.adc;
        b.min = Math.min(b.min, r.adc);
        b.max = Math.max(b.max, r.adc);
      } else {
        buckets.set(key, { n: 1, sum: r.adc, min: r.adc, max: r.adc });
      }
    }
    for (const [key, b] of buckets) {
      await tx
        .insert(readingsMinute)
        .values({ deviceId, bucket: new Date(key), n: b.n, sumAdc: b.sum, minAdc: b.min, maxAdc: b.max })
        .onConflictDoUpdate({
          target: [readingsMinute.deviceId, readingsMinute.bucket],
          set: {
            n: sql`${readingsMinute.n} + ${b.n}`,
            sumAdc: sql`${readingsMinute.sumAdc} + ${b.sum}`,
            minAdc: sql`least(${readingsMinute.minAdc}, ${b.min})`,
            maxAdc: sql`greatest(${readingsMinute.maxAdc}, ${b.max})`,
          },
        });
    }
    return inserted.length;
  });
}
