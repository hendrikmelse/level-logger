// Manages devices and their calibrations. Run from the repo root with `npm run device -- <command>`,
// or on the server with `node apps/api/dist/device.js <command>` (see deploy/README.md).
import { eq } from "drizzle-orm";
import { addCalibration, calibrationHistory, createDevice, rotateApiKey } from "../devices.js";
import { db, sql } from "./client.js";
import { devices } from "./schema.js";

const usage = `Usage:
  device list
  device create <name>                      Prints the new API key once; it is not stored.
  device rotate-key <id>                    Replaces the device's API key and prints the new one.
  device calibrations <id>                  Lists every calibration and when it applies.
  device calibrate <id> <adc1> <inches1> <adc2> <inches2> [--from <ISO date/time>] [--note <text>]
      Adds a calibration: two raw readings and the height in inches measured at each. It applies from
      --from (default: now) until the next calibration. Earlier calibrations are never changed, so
      data recorded before --from keeps converting the way it did.`;

function fail(message: string): never {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (value === undefined) fail(`${name} needs a value`);
  args.splice(i, 2);
  return value;
}

function id(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) fail("Give the device id as a positive whole number");
  return n;
}

function number(value: string | undefined, what: string): number {
  const n = Number(value);
  if (value === undefined || !Number.isFinite(n)) fail(`${what} must be a number`);
  return n;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();

  switch (command) {
    case "list": {
      for (const d of await db.select().from(devices).orderBy(devices.id)) {
        console.log(`${d.id}\t${d.name}\tcreated ${d.createdAt.toISOString()}`);
      }
      break;
    }
    case "create": {
      const name = args.join(" ").trim();
      if (!name) fail("Give the device a name");
      const { device, apiKey } = await createDevice(db, name);
      console.log(`Created device ${device.id} (${device.name}) with a placeholder calibration.`);
      console.log(`API key (shown only now): ${apiKey}`);
      break;
    }
    case "rotate-key": {
      const apiKey = await rotateApiKey(db, id(args[0]));
      if (!apiKey) fail("No such device");
      console.log(`New API key (shown only now; the old one no longer works): ${apiKey}`);
      break;
    }
    case "calibrations": {
      const deviceId = id(args[0]);
      const [device] = await db.select().from(devices).where(eq(devices.id, deviceId));
      if (!device) fail("No such device");
      for (const p of await calibrationHistory(db, deviceId)) {
        const c = p.calibration;
        console.log(
          `from ${p.effectiveFrom.toISOString()}: ${c.adc1} -> ${c.inches1} in, ${c.adc2} -> ${c.inches2} in` +
            (p.note ? `  (${p.note})` : ""),
        );
      }
      break;
    }
    case "calibrate": {
      const from = option(args, "--from");
      const note = option(args, "--note");
      const effectiveFrom = from === undefined ? new Date() : new Date(from);
      if (Number.isNaN(effectiveFrom.getTime())) fail("--from is not a valid date");
      const deviceId = id(args[0]);
      const [device] = await db.select().from(devices).where(eq(devices.id, deviceId));
      if (!device) fail("No such device");
      await addCalibration(
        db,
        deviceId,
        {
          adc1: number(args[1], "adc1"),
          inches1: number(args[2], "inches1"),
          adc2: number(args[3], "adc2"),
          inches2: number(args[4], "inches2"),
        },
        effectiveFrom,
        note,
      );
      console.log(`Calibration added; it applies from ${effectiveFrom.toISOString()}.`);
      break;
    }
    default:
      console.log(usage);
      if (command !== undefined) process.exitCode = 1;
  }
}

try {
  await main();
} catch (err) {
  if (!process.exitCode) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
} finally {
  await sql.end();
}
