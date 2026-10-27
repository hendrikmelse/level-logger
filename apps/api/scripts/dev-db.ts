// A throwaway Postgres for development on a machine without Docker or a native Postgres: PGlite
// served over the Postgres protocol on 127.0.0.1:5433, with its data kept in .pglite/ (ignored by
// git). Use it with the default DATABASE_URL in .env.example. Delete .pglite/ to start over.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const db = await PGlite.create("../../.pglite");
const server = new PGLiteSocketServer({ db, port: 5433, host: "127.0.0.1", maxConnections: 10 });
await server.start();
console.log("Dev database listening on 127.0.0.1:5433 (data in .pglite/)");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  });
}
