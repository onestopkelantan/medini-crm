# Medini CRM

Multi-branch dental clinic CRM ("MediniOne") for **Medini Dental Group** — 14 branches.
It covers patients, appointments, clinical records, invoicing and payments,
WhatsApp communication, AI receptionist, marketing, operations, administration,
and reports.

## Active stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind, TanStack Query, React Router |
| Backend | NestJS 11 modular monolith, TypeScript, Drizzle ORM, Zod, Pino, BullMQ |
| Database | **MySQL 8.4** |
| Cache / queue | Redis |
| Object storage | Garage (S3-compatible) |
| Edge | Caddy (TLS + reverse proxy) |
| Observability | Prometheus, Grafana, Alertmanager, blackbox and exporters |
| Auth | JWT, Argon2id and RBAC via `ROLE_DOMAIN_MATRIX` |

API: `/api/v1`. Health: `/health/live` and `/health/ready`.

## Repository layout

```text
app/                  React frontend
backend/              NestJS backend
backend/drizzle-mysql Active MySQL migrations
backend/test/         MySQL-compatible unit, contract, architecture and integration tests
docs/                 Current architecture, integration and operations documents
monitoring/           Prometheus / Alertmanager / blackbox configuration
power-bi/             BI assets
backup/               MySQL backup utilities
scripts/              Audits, smoke tests and operational tools
docker-compose.prod.yml
```

## Run the local production-shaped stack

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.override.yml up -d
```

Open `http://localhost:8080/`.

`docker-compose.override.yml` is local-development only. Never use it in
production.

## Local development

```bash
cd backend && npm ci && npm run start:dev
cd app && npm ci && npm run dev
```

## Database

The only supported database engine is **MySQL 8.4**. New environments are built
from `backend/drizzle-mysql/`:

```bash
cd backend
npm run build
node dist/infrastructure/database/migrate.js
```

Seed data requires `SEED_DEMO_PASSWORD`; no default production password exists.

## Quality gates

```bash
cd app
npm ci
npm run check
npm run lint
npm run build

cd ../backend
npm ci
npm run lint
npm run typecheck
npm run build
npm run test:mysql
```

GitHub Actions also validates the production Compose model, committed-secret
scan, dependency audit, fresh MySQL migrations and seed.

## Production checklist

1. Copy the production environment template and supply real secrets outside Git.
2. Validate Compose: `docker compose -f docker-compose.prod.yml config --quiet`.
3. Run a full MySQL backup before deploying.
4. Build/pull immutable images and start the stack.
5. Run `scripts/ops/smoke.sh` against the deployed URL.
6. Verify `/health/ready`, application login, branch scoping and role access.
7. Confirm monitoring and backup freshness.
8. Keep the previous image tag available for rollback.

See the current documents under `docs/operations/` for monitoring and first-HQ
bootstrap procedures.
