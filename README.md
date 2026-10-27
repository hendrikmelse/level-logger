# Level Logger

A public web viewer for a device that continuously records the water level in a sump pump pit, and the API the device logs to.

Live at **sump.hendrikmelse.com** (once deployed; see [deploy/README.md](deploy/README.md)).

## What it does

- **Current level** in inches, with how long ago it was measured (and a warning if the device has gone quiet).
- **Interactive chart** over any time span: presets from 1 hour to 1 year, or drag across the chart to zoom into any span. The server returns at most about 800 buckets (average, with the min-to-max range shaded), reading raw 1-second data for short spans and per-minute totals for long ones.
- **Ingest API** for the logging device: batches of raw ADC readings, timestamped by the server.
- **Calibration history:** raw readings are stored as received and converted to inches at query time, using the calibration that was in force when each reading was taken. Changing the calibration never rewrites history.

## Stack

TypeScript in an npm workspaces monorepo (Node 22+), set up like the owner's flashcards project: Fastify, Drizzle, zod and PostgreSQL on the API; React, Vite, TanStack Query and uPlot on the web; Vitest (API tests run against in-memory PGlite).

```
apps/api/         Fastify API: ingest, device CLI, chart queries (also serves the built web app)
apps/web/         React single-page app
packages/shared/  Types, ingest schemas and the calibration math shared by both
deploy/           Production runbook (deploy/README.md) and the server-side files
```

## Getting started

```sh
npm install
docker compose up -d db        # Postgres on localhost:5433
cp .env.example .env
npm run db:migrate
npm run device -- create "Sump pit"      # prints the device's API key once
npm run dev                    # API on :3000 and the web app on Vite's dev port
```

No Docker or native Postgres? `npm run dev:db` serves an embedded Postgres (PGlite) on the same port 5433, keeping its data in `.pglite/`. After `db:migrate`, `npm run db:seed-dev` fills it with a week of fake readings (`-- --reset` replaces them).

Scripts: `npm run dev`, `npm test`, `npm run typecheck`, `npm run build`, `npm run db:generate` (after editing `apps/api/src/db/schema.ts`).

## Device CLI

```sh
npm run device -- list
npm run device -- create "Sump pit"
npm run device -- rotate-key 1
npm run device -- calibrations 1
npm run device -- calibrate 1 210 4 640 20 --from 2026-11-01T09:00 --note "new sensor"
```

`calibrate <id> <adc1> <inches1> <adc2> <inches2>` adds a two-point linear calibration that applies from `--from` (default: now) until the next one. A new device starts with a placeholder calibration (0-1023 mapped to 0-40 inches) so the pages work before the sensor is measured. On the server, run the same commands through the image (see deploy/README.md).

## Ingest API

`POST /api/ingest` with `Authorization: Bearer <device key>` and a JSON body. The server stamps the newest sample with the time the request arrives and places the others before it, so the device needs no clock. Accepted shapes:

```jsonc
{ "samples": [512, 513, 511], "interval_ms": 1000 }   // oldest first; interval_ms defaults to 1000
{ "readings": [{ "adc": 512, "ago_ms": 2000 }, { "adc": 513, "ago_ms": 0 }] }
{ "adc": 512 }                                        // one reading, taken just now
```

`adc` is an integer from 0 to 65535 (a 10-bit Arduino sends 0-1023); up to 10,800 samples per request. The response is `{"stored": n}`: a sample whose millisecond already holds a reading for that device is dropped. Errors: 401 for a missing or unknown key, 400 for a body that matches no shape.

## Read API (public)

- `GET /api/devices` lists devices (`id`, `name`).
- `GET /api/devices/:id/current` gives the latest reading in inches and its age.
- `GET /api/devices/:id/chart?from=<epoch s>&to=<epoch s>&maxPoints=800` gives `{bucketSeconds, t[], avg[], min[], max[]}` in inches.
- `GET /api/health` (liveness) and `GET /api/ready` (database reachable).

## Data model

`readings` (device, server timestamp, raw value) is the source of truth; `readings_minute` holds per-minute count/sum/min/max, maintained on ingest, so long chart spans do not scan one row per second. At one reading a second, expect about 31.5 million raw rows a year. Readings are kept forever.
