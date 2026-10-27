// Bundles the API into dist/ for production. Third-party dependencies stay
// external (installed in the runtime image); workspace packages such as
// @level-logger/shared ship as TypeScript source, so they are bundled in.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith("@level-logger/"));

await build({
  entryPoints: {
    server: "src/server.ts",
    migrate: "src/db/migrate.ts",
    device: "src/db/device-cli.ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outdir: "dist",
  sourcemap: true,
  external,
  logLevel: "info",
});
