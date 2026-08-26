# Medini CRM — Production Deployment Runbook (S10 T2)

**Scope:** infrastructure foundation only. No go-live, no production migration against live data, no T3/T4.

---

## 1. Prerequisites

| Requirement | Minimum |
|---|---|
| OS | Linux (Ubuntu 22.04 LTS recommended) |
| Docker | 24+ with Compose v2 |
| CPU / RAM | 2 vCPU / 4 GB RAM (small clinic load) |
| Storage | 50 GB SSD (PostgreSQL + backups) |
| Domain | e.g. `crm.medini.example.com` with DNS A-record → server IP |
| Ports (public) | **80** (HTTP→HTTPS redirect) + **443** (HTTPS) only |

---

## 2. Secrets Setup (one-time, manual)

```bash
# On the production server — NEVER commit these
cp backend/.env.production.example backend/.env
# Edit backend/.env with real secrets:
#   POSTGRES_PASSWORD, POSTGRES_APP_PASSWORD, REDIS_PASSWORD
#   JWT_SECRET, JWT_REFRESH_SECRET (>= 32 chars, random)
#   DOMAIN
```

### Rate limiting / trusted proxy (S10 F-03 — REQUIRED before go-live)

The auth rate limiter (login 5/min, register 3/min, refresh 10/min) buckets by
client IP. Behind Caddy the direct peer is always Caddy's container address, so
`TRUSTED_PROXIES` must list the Docker bridge CIDR or every client shares ONE
bucket (fail-closed — safe, but one attack locks out all logins for 60s).

`docker-compose.prod.yml` already sets `TRUSTED_PROXIES: ${TRUSTED_PROXIES:-172.16.0.0/12}`
(172.16.0.0/12 covers every Docker bridge network; Caddy REPLACES
`X-Forwarded-For` with `{remote_host}`, so the rightmost entry is always the
real client — spoofing the header cannot bypass the limit). Override only if
your Caddy sits on a different CIDR:

```bash
# In the server shell or backend/.env — only if not the default bridge range:
TRUSTED_PROXIES=<caddy-peer-cidr>
```

Verify after first deploy (from outside): 6 rapid bad logins from one IP → 429;
from another IP → still 401 (separate buckets).

---

## 3. Build & Start

```bash
# From the repo root on the production server
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

Caddy auto-provisions a Let's Encrypt certificate for `$DOMAIN` on first 443 hit.

---

## 4. Database Migration (first deploy only)

```bash
# Run migrations 0000 → 0028 against the production database
# (includes S10 remediation 0025–0028: auth lifecycle, GLM 5.3 fixes,
# developer role, D-01 staff deny).
for f in backend/drizzle/0*.sql; do
  sed 's/--> statement-breakpoint//g' "$f" | \
    docker compose -f docker-compose.prod.yml exec -T postgres \
      psql -U medini -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q
done
```

---

## 5. Health Verification

```bash
# Backend readiness (via Caddy → backend)
curl -fsS https://$DOMAIN/health/ready

# Frontend (static SPA)
curl -fsS https://$DOMAIN/

# PostgreSQL (internal only — NOT publicly reachable)
docker compose -f docker-compose.prod.yml exec postgres pg_isready -U medini

# Redis (internal only)
docker compose -f docker-compose.prod.yml exec redis redis-cli -a "$REDIS_PASSWORD" ping
```

---

## 6. Backup

- **Automated:** `backup` sidecar runs `pg_dump` daily at 02:00 (cron inside the container).
- **Location:** `backupdata` Docker volume (`/backups` inside the container).
- **Naming:** `medini_YYYYMMDD_HHMMSS.sql.gz`.
- **Retention:** 30 days (pruned automatically).
- **Log:** `/backups/backup.log`.

### Manual backup
```bash
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U medini -d "$POSTGRES_DB" --no-owner --no-privileges --clean --if-exists \
  | gzip > "medini_manual_$(date +%Y%m%d_%H%M%S).sql.gz"
```

---

## 7. Restore Rehearsal (safe, non-production)

```bash
# On a staging/scratch server — NEVER against live production
./backup/restore-rehearsal.sh /path/to/medini_YYYYMMDD_HHMMSS.sql.gz medini_restore_test
```

Verifies: tables ≥ 69, branches ≥ 14, staff_status enum = 6, data integrity.

---

## 8. Network / Firewall

| Port | Exposure | Purpose |
|---|---|---|
| 80 | Public | HTTP → HTTPS redirect (Caddy) |
| 443 | Public | HTTPS (Caddy termination) |
| 3000 | **Internal only** | Backend (NestJS) |
| 5432 | **Internal only** | PostgreSQL |
| 6379 | **Internal only** | Redis |
| 80 | **Internal only** | Frontend (nginx static) |

`medini-internal` Docker network is `internal: true` (no outbound internet for DB/Redis/workers).

---

## 9. Logging

| Layer | Location |
|---|---|
| Caddy access | `caddy_data` volume → `/data/access.log` (JSON) |
| Backend app | stdout → `docker compose logs backend` (pino structured) |
| Backup | `backupdata` volume → `/backups/backup.log` |
| Container | `docker compose logs <service>` |

Logs never contain passwords/tokens (backend redaction + no secret logging).

---

## 10. Rollback

- **Application:** `docker compose -f docker-compose.prod.yml down && git checkout <previous-tag> && docker compose -f docker-compose.prod.yml up -d --build`
- **Database:** migrations are forward-only; rollback = restore from the latest proven backup (see §7).

---

## 11. What T2 does NOT do

- No production go-live / DNS cutover.
- No production migration against live customer data.
- No monitoring/alerting rollout (T3).
- No GLM audit / final governance lock (T4).
