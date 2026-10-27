import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { Db } from "./db/types.js";
import { healthRoutes } from "./routes/health.js";
import { levelRoutes } from "./routes/levels.js";
import { helmetOptions, originCheck } from "./security.js";

export interface AppOptions {
  db: Db;
  logger?: boolean;
  /** URL prefix for all API routes, e.g. "/api". */
  prefix?: string;
  /** Trust X-Forwarded-* from a reverse proxy in front of the app. */
  trustProxy?: boolean;
  production?: boolean;
  /** Directory of the built web app to serve alongside the API. */
  staticDir?: string;
  /** The clock used to timestamp incoming readings. Tests replace it. */
  now?: () => Date;
  /** Requests a minute one client may make to each public read route. */
  readRateLimit?: number;
  /** Requests a minute one client may make to the ingest route. */
  ingestRateLimit?: number;
}

export async function buildApp({
  db,
  logger = true,
  prefix = "",
  trustProxy = false,
  production = false,
  staticDir,
  now = () => new Date(),
  readRateLimit = 120,
  ingestRateLimit = 120,
}: AppOptions) {
  // A batch is at most about 10,000 samples, well under the default 1 MB body limit.
  const app = Fastify({ logger, trustProxy });

  await app.register(helmet, helmetOptions(production));
  await app.register(rateLimit, { global: false });
  app.addHook("onRequest", originCheck);

  await app.register(
    async (api) => {
      await api.register(healthRoutes, { db });
      await api.register(levelRoutes, { db, now, readRateLimit, ingestRateLimit });
    },
    { prefix },
  );

  if (staticDir) {
    await app.register(fastifyStatic, {
      root: staticDir,
      // Hashed build assets never change; everything else (index.html) must be
      // revalidated so a deploy is picked up immediately.
      setHeaders(res, filePath) {
        res.header(
          "cache-control",
          /[\\/]assets[\\/]/.test(filePath) ? "public, max-age=31536000, immutable" : "no-cache",
        );
      },
    });

    // The app has a single page, but unknown paths still get the app shell. API paths and requests
    // for missing files (*.js, *.png, ...) stay real 404s.
    app.setNotFoundHandler((req, reply) => {
      const path = (req.raw.url ?? "").split("?")[0]!;
      const isApi = prefix !== "" && (path === prefix || path.startsWith(`${prefix}/`));
      const looksLikeFile = /\.[a-z0-9]+$/i.test(path);
      if (req.method === "GET" && !isApi && !looksLikeFile) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "Not found" });
    });
  }

  return app;
}
