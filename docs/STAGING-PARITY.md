# Medini CRM — Staging Parity Assessment (Tier 1)

**Status:** Config parity ✅ · Live staging deployment ❌ (prerequisites missing — documented below)

This document answers: *can a staging environment reproduce the production
topology?* — and lists exactly what is missing to run a live staging deploy.
**No production was deployed. No staging was deployed (no domain/secrets here).**

---

## 1. Topology parity — can staging reproduce production?

Staging uses the **same** `docker-compose.prod.yml` (there is intentionally no
separate staging compose — parity by construction). Differences are only
environment *values*, not topology.

| Layer | Production source | Staging reproducible? |
|---|---|---|
| Docker Compose | `docker-compose.prod.yml` | ✅ same file |
| PostgreSQL 16 | `postgres` service (+ WAL archiving) | ✅ same service |
| Redis 7 | `redis` (requirepass, AOF) | ✅ same service |
| Backend (NestJS) | `backend` Dockerfile.prod | ✅ same image build |
| Frontend (static SPA) | `frontend` Dockerfile.prod (nginx) | ✅ same image build |
| Caddy (TLS) | `caddy` + `Caddyfile` | ✅ same; domain differs |
| WAHA | commented `waha` service | ✅ same (opt-in) |
| Monitoring | prometheus/alertmanager/grafana/exporters | ✅ same services |
| Backup | 6-hourly `backup` sidecar + WAL | ✅ same service |
| Network isolation | `medini-internal` (`internal: true`), `medini-public` | ✅ same |
| Health checks | all services | ✅ same |
| Migrations | 0000→0028 replay (runbook §4) | ✅ same loop |
| Env / secrets | `backend/.env` | ⚠️ staging values (staging.env exists, dev-grade) |

**Conclusion: full topology parity is achievable from the same compose file.**

## 2. Environment / secret parity

| Variable | Prod | Staging |
|---|---|---|
| `TRUSTED_PROXIES` | `172.16.0.0/12` (compose default) | ✅ staging.env has it |
| `DATABASE_URL` / `DATABASE_RUNTIME_URL` | owner / medini_app | ✅ pattern identical |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | real secrets | ⚠️ dev-grade placeholders |
| `POSTGRES_PASSWORD` / `REDIS_PASSWORD` | real secrets | ⚠️ dev-grade |
| `DOMAIN` | real prod domain | ❌ **missing** (no staging domain) |
| `AM_WEBHOOK_URL` / `GRAFANA_ADMIN_PASSWORD` | real | ⚠️ unset |
| `WAHA_API_KEY` | real (if in scope) | ⚠️ unset |

## 3. What is MISSING to run a live staging deploy

These are **operational prerequisites**, not code defects:

1. **A staging domain + DNS** (A/AAAA record → staging server public IP).
   Required for Caddy to issue a real Let's Encrypt cert (TLS live verify).
2. **Real staging secrets** in `backend/.env` (POSTGRES/REDIS/JWT/WAHA keys).
   Current staging.env values are dev-grade placeholders, not for any real deploy.
3. **A staging host** with Docker 24+ (the runbook §1 prerequisites).
4. (Optional) `AM_WEBHOOK_URL` if alert *notifications* are to be tested;
   alerts fire regardless.

## 4. Exact staging bring-up (once prerequisites exist)

```bash
# On the staging host, with DOMAIN + secrets in backend/.env:
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
# Migrations 0000→0028:
for f in backend/drizzle/0*.sql; do
  sed 's/--> statement-breakpoint//g' "$f" | \
    docker compose -f docker-compose.prod.yml exec -T postgres \
      psql -U medini -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q
done
# Then run docs/STAGING-TLS-VERIFICATION-RUNBOOK.md §B (TLS), §C (backup), §D (monitoring).
```

## 5. Verdict

- **Config/topology parity: ✅ VERIFIED** — one compose file reproduces prod.
- **Live staging deployment: ❌ NOT EXECUTED** — missing domain + real secrets
  (§3). This is an operational prerequisite, not a blocker for Tier 1 sign-off.
  The exact bring-up + verification steps are documented (§4 + TLS runbook).
