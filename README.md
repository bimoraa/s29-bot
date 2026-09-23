# S29 Bots

A TypeScript Discord bot that stays connected to one configured voice channel.

## Requirements

- Node.js 24.17.0 or newer
- A Discord bot token
- Docker Compose for the bot, PostgreSQL, and Redis

## Local development

```sh
npm install
cp .env.example .env
```

Set the Discord IDs, bot token, and database password in `.env`. Start the local dependencies with:

```sh
docker compose up -d database redis
```

Then run the bot:

```sh
npm run dev
```

Build and run the production output with:

```sh
npm run build
npm start
```

## Always-on deployment

Invite the bot to your server with `View Channel` and `Connect` permissions for the target voice channel. Fill in `.env`, then run:

```sh
docker compose up -d --build
```

Compose starts PostgreSQL and Redis first, waits for their health checks, then starts the bot. PostgreSQL and Redis data persist in named volumes. The bot retries voice reconnections, and Compose restarts it after a crash or host reboot.

### Hostinger production

The production stack lives in `/srv/s29-bots` as its own Docker Compose project. It keeps separate PostgreSQL and Redis volumes from LuaAegis and other apps on the VPS. The bot health endpoint uses `127.0.0.1:3000`; PostgreSQL and Redis use the loopback ports `55432` and `56379` so they do not overlap with the services already on the host.

Pushing to `main` runs `.github/workflows/deploy.yml` on the dedicated `s29-bots` GitHub Actions runner installed on the VPS as `s29deploy`, separate from LuaAegis's runner. It builds a versioned image, waits for `/readyz`, and switches the current release only after it is healthy. Failed updates start the prior image again. The runner can invoke only the host-side deployment script through `sudo`; no SSH key or production `.env` is stored in GitHub.

The VPS keeps production settings in `/srv/s29-bots/shared/.env`. `deploy/hostinger/provision.sh` installs the locked-down deploy account and host-side deployment scripts.

## HTTP and metrics

The HTTP server listens on `HTTP_HOST` and `HTTP_PORT` (defaults to `0.0.0.0:3000`):

- `GET /livez` — process is serving requests.
- `GET /readyz` — Discord, PostgreSQL, Redis, and the job queue are reachable.
- `GET /metrics` — Prometheus metrics for HTTP requests, queue jobs, and Node.js runtime.

Compose publishes the HTTP port on `127.0.0.1` only. Prometheus can scrape `http://localhost:3000/metrics` from the host; other containers can use `http://bot:3000/metrics`.

## Jobs and source layout

BullMQ uses Redis for durable jobs, retries, and backoff. A scheduled infrastructure health job checks PostgreSQL and Redis once a minute. The queue API can be used by future jobs; feature-specific jobs and services without behavior have been removed for now.

```text
src/
  app/             startup, runtime context, and graceful shutdown
  config/          environment loading and validation
  discord/         client and event registration
  features/voice/  voice connection guard
  infrastructure/  PostgreSQL, HTTP, metrics, BullMQ, and Redis
  jobs/            job processing and recurring health check
  shared/logger/   structured application logger
```
