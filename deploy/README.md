# Deployment runbook

Runs at **https://sump.hendrikmelse.com** on the same VPS as the flashcards app, in the same way. The server itself (Docker, the shared Caddy and Postgres, the `deploy` user, backups, monitoring) is already set up; the flashcards runbook in `hendrikmelse/flashcards` (`deploy/README.md`) is the reference for all of it. This file only covers what is specific to this app. Keep it up to date.

```
internet ─▶ Caddy (80/443, automatic HTTPS) ─▶ level-logger-api (Node, port 3000)
                                                        │ internal "db" network
                                                        ▼
                                              shared Postgres (database level_logger)
```

One image holds the API and the built web app. CI builds it, pushes it to `ghcr.io/hendrikmelse/level-logger:<commit sha>`, and deploys it over SSH with a restricted key that can only run `ci-entrypoint.sh`. `deploy.sh` pulls, migrates, restarts, health-checks and rolls back on failure. The server-side files live in `deploy/server/level-logger/` and are copied to `/srv/level-logger` by hand.

## One-time setup

1. **DNS:** add an A record `sump.hendrikmelse.com` pointing at the server (same IP as the flashcards record).
2. **Database** (on the server):

   ```bash
   cd /srv/postgres
   APP_PW="$(openssl rand -base64 24 | tr -d '/+=')"
   docker compose exec -T postgres psql -U postgres <<SQL
   create role level_logger login password '$APP_PW';
   create database level_logger owner level_logger;
   SQL
   echo "$APP_PW"
   ```

   The nightly backup (`/srv/postgres/backup.sh`) dumps every database, so this one is included automatically, and so is the offsite copy.
3. **App directory:** copy `deploy/server/level-logger/*` (including `.env.example`) to `/srv/level-logger`, `chmod +x *.sh`, `cp .env.example .env && chmod 600 .env`, and put the password from step 2 in `DATABASE_URL`.
4. **Caddy:** add to `/srv/caddy/Caddyfile`, then reload (`docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`):

   ```
   sump.hendrikmelse.com {
   	encode zstd gzip
   	reverse_proxy level-logger-api:3000
   }
   ```
5. **CI deploy key:** same procedure as flashcards step 7, with its own key pair: make a new ed25519 key, authorize it in `/home/deploy/.ssh/authorized_keys` as `restrict,command="/srv/level-logger/ci-entrypoint.sh" ssh-ed25519 AAAA... github-actions-deploy-level-logger`, and set the repository secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` and the variable `DEPLOY_ENABLED=true` on `hendrikmelse/level-logger`. The default branch is `master`, and CI deploys on pushes to it.
6. **Merge to `master`** (or run the workflow). Then create the device and calibrate it, below.

## Devices and calibration on the server

```bash
cd /srv/level-logger
export IMAGE="$(cat current-image)"
docker compose run --rm --no-deps api node apps/api/dist/device.js create "Sump pit"      # prints the API key once
docker compose run --rm --no-deps api node apps/api/dist/device.js calibrate 1 210 4 640 20 --note "first measurement"
```

Other commands: `list`, `rotate-key <id>`, `calibrations <id>` (see the README). Put the API key in the device's firmware only; it is stored hashed and cannot be recovered, only rotated.

## Operating

- **Logs:** `sudo journalctl -t level-logger-api`.
- **Deploy log:** `sudo journalctl -t level-logger-deploy`.
- **Rolling back:** `./deploy.sh ghcr.io/hendrikmelse/level-logger:<previous sha>`; `current-image` holds the deployed one. Migrations are not undone, so keep them backward compatible.
- **Monitoring:** add an UptimeRobot check on `https://sump.hendrikmelse.com/api/ready`. A Healthchecks.io-style alert for "the device stopped reporting" is not built yet (alerts are deferred); the page itself shows "No data since …" in red after 5 minutes.
- **Growth:** about 31.5 million readings a year. Check `select pg_size_pretty(pg_total_relation_size('readings'));` now and then; the nightly dumps are kept 14 days, so they grow with the table too.
