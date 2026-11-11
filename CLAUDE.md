# Working in this repo

Level Logger: a public web viewer for a device that records the water level in a sump pump pit, plus an ingest API the device logs to. Live at **sump.hendrikmelse.com**. The owner is Hendrik (GitHub `hendrikmelse`, repo `hendrikmelse/level-logger`, public). The repo is public, so never commit the production server's address, credentials, API keys or anything from `.env`.

This project is deliberately set up like the owner's `flashcards` project (same VPS, same shared Caddy and Postgres, same CI/GHCR/`deploy.sh` flow, same TypeScript monorepo layout: Fastify + Drizzle + zod API, React + Vite web, `packages/shared`). When in doubt about a convention, look at the flashcards repo (`../flashcards` locally, `hendrikmelse/flashcards` on GitHub), especially its `CLAUDE.md` and `deploy/README.md`.

## How to work with the owner

Same habits as flashcards (see its CLAUDE.md for the reasoning):

- Edit in the owner's own checkout, not a worktree. The default branch here is `master` (the owner chose to keep it; do not rename it). Work on a branch, never push to or merge into `master`; the owner merges PRs themselves.
- Tests and typecheck only at commit time, not after small edits (say they were not run). Still add or update tests alongside a change.
- Commit and push only when asked. Opening a PR is outward-facing: only when asked.
- Commit messages and PR bodies end with the attribution lines the session's system reminder gives.
- **Keep the README current as you change things** (features, scripts, API, setup, deploy steps), in the same change that alters them. `deploy/README.md` likewise for anything about the server.
- Anything worth remembering about the project goes in this repo (this file, README, `deploy/README.md`), not in local memory, because the owner works from several machines.

## Decisions so far (2026-10-27)

- **One device for now, built to extend.** Model devices as rows (id, name, API key hash, calibration) from the start; readings reference a device. No multi-user UI yet.
- **Sampling:** the device samples once per second and posts batches roughly once a minute. Batch size and cadence must not be hardcoded anywhere.
- **Reading = raw ADC value (0-1023).** Conversion to inches happens on the server, via per-device calibration stored server-side (so it can change without reflashing, and old raw data can be re-interpreted). Store raw values only; derive inches at query time.
- **Server timestamps the data.** The device may have an RTC but the server is the clock. A batch is stamped from its arrival time, with each sample positioned by its offset within the batch. The ingest endpoint should stay flexible about payload shape because the device may later become a Raspberry Pi or similar.
- **Transport:** assume HTTPS works. If the Arduino + Ethernet shield cannot do TLS, revisit then (plain-HTTP route, relay, or different board).
- **Device hardware (2026-11-10):** an ESP32-C3 Super Mini over WiFi (so TLS is fine), firmware in `firmware/` (PlatformIO). It sends `readings` with `ago_ms` and buffers in RAM while offline. Its ADC is 12-bit (0-4095), so the placeholder 0-1023 calibration is wrong for it until real calibration points are set. Not yet flashed or tested on hardware; sensor type and pin still to be decided.
- **Viewer is public, read-only, no accounts.** Views: current level, and an interactive chart over any time span (zoom/pan, server-side downsampling so a year of 1 Hz data stays fast).
- **Retention: keep everything forever.** At 1 reading/second that is about 31.5 million rows a year. Revisit rollups/compression only if size becomes a real problem.
- **Calibrations are append-only history.** Each calibration (two raw/inch points) applies from its `effective_from` until the next one starts; old ones are never edited or deleted, and each reading converts with the calibration in force at its own time. New devices start with a placeholder calibration (0-1023 mapped to 0-40 in) until real measurements exist. Chart buckets use the calibration at the bucket start.
- **Admin is CLI-only for now** (`npm run device -- ...`, or `node apps/api/dist/device.js` on the server). A web admin page is wanted eventually, not yet.
- **No alerts for now** (high level, device silent); possibly later. Pump-cycle detection is also not built.
- **Dev database:** this machine has no Docker or Postgres, so local development uses `npm run dev:db` (PGlite served on port 5433) and `npm run db:seed-dev`.
- **Production (live since 2026-10-27):** deployed by CI on every push to `master`. The first commit went straight to `master` (a one-time exception, since there was nothing to open a PR against); after that, use branches and PRs. Device 1 ("Sump pit") exists on the server on the placeholder calibration; the real calibration and the Arduino's first ingest are still to do. The chart queries have only been exercised against PGlite with data; production is real Postgres 17 but has no readings yet.
- **Known limits:** the ingest payload accepts no device-supplied timestamps (server time only). Retried batches after a lost response will be stored twice (different arrival times); add an idempotency key if that matters.
- **Deployment:** `sump.hendrikmelse.com`, one image built by CI and pushed to GHCR, a block in the shared Caddyfile, a database and role in the shared Postgres.
