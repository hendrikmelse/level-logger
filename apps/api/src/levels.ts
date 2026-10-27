import { desc, eq, sql } from "drizzle-orm";
import { inchesFromAdc, isDecreasing, type ChartSeries, type CurrentLevel } from "@level-logger/shared";
import { calibrationAt, calibrationHistory } from "./devices.js";
import { devices, readings } from "./db/schema.js";
import type { Db } from "./db/types.js";

export async function currentLevel(db: Db, deviceId: number, now: Date): Promise<CurrentLevel | null> {
  const [device] = await db.select().from(devices).where(eq(devices.id, deviceId));
  if (!device) return null;
  const info = { id: device.id, name: device.name };

  const [latest] = await db
    .select()
    .from(readings)
    .where(eq(readings.deviceId, deviceId))
    .orderBy(desc(readings.ts))
    .limit(1);
  if (!latest) return { device: info, reading: null };

  const cal = calibrationAt(await calibrationHistory(db, deviceId), latest.ts);
  return {
    device: info,
    reading: {
      at: latest.ts.toISOString(),
      adc: latest.adc,
      inches: inchesFromAdc(latest.adc, cal),
      ageSeconds: Math.max(0, Math.round((now.getTime() - latest.ts.getTime()) / 1000)),
    },
  };
}

type BucketRow = { t: string; n: string; sum: string; min: number; max: number };

/**
 * Levels between `from` and `to` in at most about `maxPoints` buckets. Short spans read the raw
 * readings; once the buckets would be a minute or wider the per-minute totals are used instead.
 * Each bucket is converted with the calibration in force at its start.
 */
export async function chartSeries(
  db: Db,
  deviceId: number,
  from: Date,
  to: Date,
  maxPoints: number,
): Promise<ChartSeries> {
  const spanSeconds = Math.max(1, (to.getTime() - from.getTime()) / 1000);
  const wanted = Math.max(1, Math.ceil(spanSeconds / maxPoints));
  // Raw readings come about once a second, so a one-second bucket is the finest there is. From a
  // minute up, whole minutes are the unit the totals are kept in.
  const useMinutes = wanted >= 60;
  const bucketSeconds = useMinutes ? Math.ceil(wanted / 60) * 60 : wanted;

  const result = useMinutes
    ? await db.execute<BucketRow>(sql`
        select floor(extract(epoch from bucket) / ${bucketSeconds})::bigint * ${bucketSeconds} as t,
               sum(n) as n, sum(sum_adc) as sum, min(min_adc) as min, max(max_adc) as max
        from readings_minute
        where device_id = ${deviceId} and bucket >= ${from.toISOString()} and bucket < ${to.toISOString()}
        group by 1 order by 1`)
    : await db.execute<BucketRow>(sql`
        select floor(extract(epoch from ts) / ${bucketSeconds})::bigint * ${bucketSeconds} as t,
               count(*) as n, sum(adc) as sum, min(adc) as min, max(adc) as max
        from readings
        where device_id = ${deviceId} and ts >= ${from.toISOString()} and ts < ${to.toISOString()}
        group by 1 order by 1`);
  // postgres-js returns the rows as an array, PGlite wraps them in { rows }.
  const rows: BucketRow[] = Array.isArray(result) ? result : (result as { rows: BucketRow[] }).rows;

  const history = await calibrationHistory(db, deviceId);
  const series: ChartSeries = { bucketSeconds, t: [], avg: [], min: [], max: [] };
  for (const r of rows) {
    const t = Number(r.t);
    const cal = calibrationAt(history, new Date(t * 1000));
    const lo = inchesFromAdc(Number(r.min), cal);
    const hi = inchesFromAdc(Number(r.max), cal);
    // A falling calibration turns the lowest raw reading into the highest level.
    const falling = isDecreasing(cal);
    series.t.push(t);
    series.avg.push(inchesFromAdc(Number(r.sum) / Number(r.n), cal));
    series.min.push(falling ? hi : lo);
    series.max.push(falling ? lo : hi);
  }
  return series;
}
