import { buildApp } from "./app.js";
import { config } from "./config.js";
import { db, sql } from "./db/client.js";

const app = await buildApp({
  db,
  prefix: "/api",
  trustProxy: config.TRUST_PROXY,
  production: config.NODE_ENV === "production",
  staticDir: config.WEB_DIST,
});

// Finish in-flight requests and close the database pool when the platform
// stops the container (docker stop sends SIGTERM).
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}

await app.listen({ port: config.PORT, host: "0.0.0.0" });
