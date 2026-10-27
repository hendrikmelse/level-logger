import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { asc } from "drizzle-orm";
import { ingestBodySchema, type DeviceInfo } from "@level-logger/shared";
import { devices } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { findDeviceByKey } from "../devices.js";
import { storeBatch } from "../ingest.js";
import { chartSeries, currentLevel } from "../levels.js";

export interface LevelRoutesOptions {
  db: Db;
  /** The clock; tests replace it. */
  now: () => Date;
  /** Requests a minute one client may make to each public read route. */
  readRateLimit: number;
  /** Requests a minute one client may make to the ingest route. */
  ingestRateLimit: number;
}

const deviceParams = z.object({ id: z.coerce.number().int().positive() });

const chartQuery = z.object({
  // Epoch seconds.
  from: z.coerce.number().int(),
  to: z.coerce.number().int(),
  maxPoints: z.coerce.number().int().min(10).max(5000).default(800),
});

export async function levelRoutes(app: FastifyInstance, { db, now, readRateLimit, ingestRateLimit }: LevelRoutesOptions) {
  const read = { config: { rateLimit: { max: readRateLimit, timeWindow: "1 minute" } } };

  app.get("/devices", read, async (): Promise<DeviceInfo[]> => {
    return db.select({ id: devices.id, name: devices.name }).from(devices).orderBy(asc(devices.id));
  });

  app.get("/devices/:id/current", read, async (req, reply) => {
    const params = deviceParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid device id" });
    const level = await currentLevel(db, params.data.id, now());
    if (!level) return reply.code(404).send({ error: "No such device" });
    return level;
  });

  app.get("/devices/:id/chart", read, async (req, reply) => {
    const params = deviceParams.safeParse(req.params);
    const query = chartQuery.safeParse(req.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: "Invalid parameters" });
    const { from, to, maxPoints } = query.data;
    if (to <= from) return reply.code(400).send({ error: "`to` must be after `from`" });
    return chartSeries(db, params.data.id, new Date(from * 1000), new Date(to * 1000), maxPoints);
  });

  app.post(
    "/ingest",
    { config: { rateLimit: { max: ingestRateLimit, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
      const device = match ? await findDeviceByKey(db, match[1]!) : null;
      if (!device) return reply.code(401).send({ error: "Missing or unknown API key" });

      const body = ingestBodySchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "Invalid body", issues: body.error.issues });

      const stored = await storeBatch(db, device.id, body.data, now());
      return { stored };
    },
  );
}
