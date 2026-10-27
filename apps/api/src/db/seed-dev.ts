// Fills the development database with a week of fake one-second readings: a pit that slowly fills
// and is pumped out every 40 minutes, a rainy spell where it cycles every 10, and a 90 minute
// outage. Run with `npm run db:seed-dev` (add --reset to replace readings already there).
import { sql } from "drizzle-orm";
import { addCalibration, createDevice } from "../devices.js";
import { db, sql as client } from "./client.js";
import { devices } from "./schema.js";

const DAYS = 7;
const reset = process.argv.includes("--reset");

try {
  let [device] = await db.select().from(devices).limit(1);
  if (!device) {
    const created = await createDevice(db, "Sump pit");
    device = created.device;
    console.log(`Created device ${device.id}. API key (shown only now): ${created.apiKey}`);
    // 200 -> 3 in and 800 -> 30 in, so the fake data lands at plausible heights.
    await addCalibration(db, device.id, { adc1: 200, inches1: 3, adc2: 800, inches2: 30 }, new Date(Date.now() - DAYS * 86_400_000), "dev sample");
  }

  const existing = await db.execute(sql`select 1 from readings where device_id = ${device.id} limit 1`);
  const hasData = (Array.isArray(existing) ? existing : (existing as { rows: unknown[] }).rows).length > 0;
  if (hasData && !reset) {
    console.log("This device already has readings; pass --reset to replace them.");
  } else {
    await db.execute(sql`delete from readings where device_id = ${device.id}`);
    await db.execute(sql`delete from readings_minute where device_id = ${device.id}`);
    const seconds = DAYS * 86_400;
    await db.execute(sql`
      insert into readings (device_id, ts, adc)
      select ${device.id}, ts, adc from (
        select
          date_trunc('second', now()) - (${seconds - 1} - i) * interval '1 second' as ts,
          i,
          (300 + 220 * ((i % case when i between ${5 * 86_400} and ${5 * 86_400 + 4 * 3600} then 600 else 2400 end)::float
                        / case when i between ${5 * 86_400} and ${5 * 86_400 + 4 * 3600} then 600 else 2400 end)
           + (random() * 6 - 3))::int as adc
        from generate_series(0, ${seconds - 1}) as i
      ) s
      where i not between ${3 * 86_400} and ${3 * 86_400 + 5400}`);
    await db.execute(sql`
      insert into readings_minute (device_id, bucket, n, sum_adc, min_adc, max_adc)
      select device_id, date_trunc('minute', ts), count(*), sum(adc), min(adc), max(adc)
      from readings where device_id = ${device.id} group by 1, 2`);
    console.log(`Seeded ${DAYS} days of readings for device ${device.id}, ending now.`);
  }
} finally {
  await client.end();
}
