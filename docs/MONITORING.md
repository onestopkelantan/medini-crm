# Medini CRM — Production Monitoring & Alerting (Tier 1, P7-F8)

**Status:** IMPLEMENTED (config) · **Finding:** P7-F8 (monitoring/alerting = operational prerequisite) · **Tier:** 1

Implements the observability architecture already specified in
`docs/OBSERVABILITY.md` (S9 ADR-008: Prometheus metrics, KISS, no
over-engineering). No new stack was invented — Prometheus + Alertmanager +
Grafana is the architecturally-sanctioned choice.

---

## 1. Stack (all internal-only, NO public ports)

| Service | Image | Role |
|---|---|---|
| prometheus | prom/prometheus:v2.53.0 | metrics TSDB + alert evaluation (30d retention) |
| alertmanager | prom/alertmanager:v0.27.0 | alert routing/notification |
| blackbox | prom/blackbox-exporter:v0.25.0 | HTTP probes (health/readiness/WAHA) |
| postgres-exporter | prometheuscommunity/postgres-exporter:v0.15.0 | `pg_up`, DB stats |
| redis-exporter | oliver006/redis_exporter:v1.62.0 | `redis_up`, queue/cache stats |
| node-exporter | prom/node-exporter:v1.8.1 | host disk/CPU/mem + textfile (backup/WAL) |
| cadvisor | gcr.io/cadvisor/cadvisor:v0.49.1 | container restart-loop / resources |
| grafana | grafana/grafana:10.4.2 | optional operator dashboards |

All attach to `medini-internal` (`internal: true`) — **no internet egress, no
host port mappings**. The backend `/metrics` endpoint is already `@Public` but
Caddy returns **404 from the internet** (unchanged); Prometheus reaches it over
the Docker network only.

## 2. The 10 mandated monitoring areas → alert mapping

| # | Area | Alert | Signal source |
|---|---|---|---|
| 1 | Backend unavailable | `BackendDown` (critical) | `up{job="medini-backend"}==0` |
| 2 | PostgreSQL unavailable | `PostgresDown` (critical) + `BackendNotReady` | `pg_up==0`, `/health/ready` probe |
| 3 | Redis unavailable | `RedisDown` (critical) | `redis_up==0` |
| 4 | Backup failure | `BackupStale` (high) + `WalArchiveStale` (medium) | textfile heartbeat / newest-WAL mtime |
| 5 | Disk/storage pressure | `DiskPressure` (high) | node-exporter root FS >85% |
| 6 | Excessive API 5xx | `Api5xxRate` (high) | `http_requests_total{status=~"5.."}` |
| 7 | Auth failure spike | `AuthFailureSpike` (high) | login 4xx rate |
| 8 | Excessive latency | `ApiLatencyHigh` (medium) | p95 `http_request_duration_seconds` |
| 9 | Container restart loop | `ContainerRestartLoop` (high) | cadvisor `container_start_time_seconds` churn |
| 10 | WAHA availability/session | `WahaDown` (high) | blackbox probe of `/api/sessions` |

Plus retained S9 hooks: `OutboxBacklog` (A1), `WorkerFailureStorm` (A2).

## 3. Verification (deploy-time checklist)

Monitoring is **config-verified** here; live scrape/alert verification requires
the production/staging deployment (no prod containers run in this environment).
Exact verification steps are in `docs/STAGING-TLS-VERIFICATION-RUNBOOK.md` §D:

- [ ] `prometheus:9090/targets` → all jobs `UP` (backend, postgres, redis, node, cadvisor, blackbox probes).
- [ ] `pg_up==1`, `redis_up==1`, `probe_success==1` for live/ready.
- [ ] Force-test an alert (e.g. `docker stop backend`) → `BackendDown` fires → routed to the configured receiver.
- [ ] No secrets in any metrics payload (label discipline: no org/branch/patient IDs — enforced by `s9-observability.spec.ts`).

## 4. Secrets & fail-safe properties

- **No secrets in monitoring config.** `DATA_SOURCE_NAME`/`REDIS_PASSWORD` use
  `${VAR}` injection at deploy (Docker Compose performs the expansion, not
  Alertmanager). `GRAFANA_ADMIN_PASSWORD` is env-injected, never committed.
- **F11-1 remediation:** Alertmanager configuration is fully STATIC — no
  runtime environment interpolation, no shell-style `${VAR:-default}`
  expansion (Alertmanager does not support it). The default receiver is a
  harmless localhost blackhole; alerts still **fire** and are visible in the
  Prometheus/Alertmanager UI, so monitoring never silently disables itself.
- **Optional webhook:** to enable a real notification channel, copy
  `monitoring/alertmanager.yml` to an override file, replace the blackhole
  URL with the real webhook URL, and update the compose volume mount. Never
  commit real webhook URLs or secrets.
- **Inhibit rule:** when the backend is down, downstream 5xx/readiness/latency
  noise is suppressed so the operator sees one actionable critical.

## 5. Incident Response Runbook

This section maps each alert to concrete operator actions. All commands are
verified against the actual repository.

### 5.1 BackendDown (critical)

| | |
|---|---|
| **What it means** | Prometheus cannot scrape `backend:3000/metrics` for >1m. The NestJS process is down, crashed, or network-isolated. |
| **First check** | `docker ps -a | grep backend` — is the container running? `docker logs backend --tail 50` — OOM, unhandled exception, or DB connection failure? |
| **Health endpoint** | `GET /health/live` (liveness) and `GET /health/ready` (readiness — checks DB + Redis). |
| **Containment** | `docker restart backend` or `docker compose -f docker-compose.prod.yml up -d backend`. If crash-looping, check `.env` for missing/invalid `DATABASE_URL` or `REDIS_PASSWORD`. |
| **Escalation** | If restart does not recover within 5m, escalate to on-call engineer. |
| **Recovery verification** | `curl -f http://localhost:3000/health/ready` returns 200; Prometheus `up{job="medini-backend"}==1`. |

### 5.2 PostgresDown (critical)

| | |
|---|---|
| **What it means** | `pg_up==0` — postgres_exporter cannot reach PostgreSQL. DB is down or exporter is misconfigured. |
| **First check** | `docker ps -a | grep postgres` — container running? `docker logs backend-postgres-1 --tail 50` — disk full, corruption, or auth failure? |
| **Health endpoint** | `pg_isready -U medini -d $POSTGRES_DB` (via `docker exec`). |
| **Containment** | `docker restart backend-postgres-1`. If WAL archive volume is full, check `walarchive` volume size and run `backup/wal-retain.sh` manually. |
| **Escalation** | If DB does not recover in 10m or data corruption is suspected, escalate to DBA/on-call. |
| **Recovery verification** | `pg_isready` returns OK; `pg_up==1` in Prometheus; backend `/health/ready` returns 200. |

### 5.3 BackendNotReady (critical)

| | |
|---|---|
| **What it means** | `/health/ready` returns non-2xx — backend process is alive but cannot reach PostgreSQL or Redis. |
| **First check** | `docker logs backend --tail 50` — look for `ECONNREFUSED` or timeout errors. Check `docker ps` — are postgres/redis healthy? |
| **Health endpoint** | `GET /health/ready` — inspect the JSON body for which dependency failed. |
| **Containment** | Restart the failing dependency first (postgres/redis), then backend. If network issue, `docker network ls` and `docker network inspect medini-internal`. |
| **Escalation** | If dependencies are healthy but backend still not ready after 5m, escalate. |
| **Recovery verification** | `/health/ready` returns 200; `probe_success{job="medini-health", instance=~".*health/ready"}==1`. |

### 5.4 RedisDown (critical)

| | |
|---|---|
| **What it means** | `redis_up==0` — redis_exporter cannot reach Redis. BullMQ queue is impacted. |
| **First check** | `docker ps -a | grep redis` — container running? `docker logs backend-redis-1 --tail 50` — OOM, persistence failure, or wrong password? |
| **Health endpoint** | `redis-cli -a $REDIS_PASSWORD ping` (via `docker exec`). |
| **Containment** | `docker restart backend-redis-1`. If AOF corruption, may need to restore from backup. |
| **Escalation** | If Redis does not recover in 5m, escalate — queue backlog will grow. |
| **Recovery verification** | `redis_up==1` in Prometheus; backend `/health/ready` returns 200. |

### 5.5 BackupStale (high)

| | |
|---|---|
| **What it means** | `medini_backup_last_success_timestamp_seconds` >26h old — backup sidecar is not completing backups. |
| **First check** | `docker logs backup --tail 50` — pg_dump errors, disk full, or cron not running? Check `docker exec backup ls -la /backups/` — are files being written? |
| **Health endpoint** | `docker exec backup cat /backups/.heartbeat` — timestamp should be recent. |
| **Containment** | `docker restart backup`. If disk full, clean old backups per `backup/wal-retain.sh` retention policy. |
| **Escalation** | If backups remain stale after 1h, escalate — RPO 6h at risk. |
| **Recovery verification** | `medini_backup_last_success_timestamp_seconds` recent; `ls -la /backups/` shows new `.dump` files. |

### 5.6 WalArchiveStale (medium)

| | |
|---|---|
| **What it means** | `medini_wal_last_archive_timestamp_seconds` >15m old — WAL archiving is broken despite `archive_timeout=300`. PITR chain may be broken. |
| **First check** | `docker logs backend-postgres-1 --tail 50 | grep archive` — archive_command failing? Check `docker exec backend-postgres-1 ls -la /walarchive/` — files being written? |
| **Health endpoint** | `psql -U medini -d $POSTGRES_DB -c "SELECT * FROM pg_stat_archiver"` — `last_failed_wal` newer than `last_archived_wal`? |
| **Containment** | Check `backup/wal-archive.sh` exists and is executable. Check `walarchive` volume has space. |
| **Escalation** | If WAL archiving not restored in 30m, escalate — PITR recovery point at risk. |
| **Recovery verification** | `pg_stat_archiver.last_archived_wal` recent; `ls -la /walarchive/` shows new segments. |

### 5.7 DiskPressure (high)

| | |
|---|---|
| **What it means** | Root filesystem >85% full — risk to `pgdata`, `backupdata`, `walarchive`. |
| **First check** | `df -h` on host. `docker system df` — are images/volumes consuming space? `du -sh /var/lib/docker/volumes/*` — which volume is largest? |
| **Health endpoint** | N/A — host-level metric. |
| **Containment** | Clean old Docker images (`docker image prune -a`). Clean old backups per retention policy. If pgdata is large, check for table bloat. |
| **Escalation** | If disk cannot be freed below 80%, escalate — may need volume expansion. |
| **Recovery verification** | `node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes` < 0.80. |

### 5.8 Api5xxRate (high)

| | |
|---|---|
| **What it means** | 5xx rate >0.1/s over 5m — application errors, DB timeouts, or unhandled exceptions. |
| **First check** | `docker logs backend --tail 100 | grep -i "error\|exception\|5[0-9][0-9]"` — what is failing? Check `/health/ready` — is a dependency down? |
| **Health endpoint** | `GET /health/ready` — check dependency status. |
| **Containment** | If caused by a bad deploy, rollback. If DB connection pool exhausted, restart backend. |
| **Escalation** | If 5xx rate persists >15m or affects >10% of requests, escalate. |
| **Recovery verification** | `rate(http_requests_total{status=~"5.."}[5m])` < 0.1/s. |

### 5.9 AuthFailureSpike (high)

| | |
|---|---|
| **What it means** | Login 4xx rate >0.5/s over 5m — possible credential attack, brute force, or client misconfiguration. |
| **First check** | `docker logs backend --tail 100 | grep -i "auth\|login\|401\|403"` — which IPs? Check if rate limiting is triggering (429s). |
| **Health endpoint** | `GET /health/ready` — ensure backend is healthy. |
| **Containment** | Verify rate limiting is active (`@Throttle` on auth routes). If attack, consider IP block at Caddy level. |
| **Escalation** | If sustained attack >30m or successful breach suspected, escalate to security team. |
| **Recovery verification** | `rate(http_requests_total{route=~".*auth/login.*", status=~"4.."}[5m])` < 0.5/s. |

### 5.10 ApiLatencyHigh (medium)

| | |
|---|---|
| **What it means** | p95 latency >2s over 5m — slow queries, resource exhaustion, or dependency slowness. |
| **First check** | `docker logs backend --tail 100` — look for slow query logs. Check `pg_stat_activity` for long-running queries. Check CPU/memory on host. |
| **Health endpoint** | `GET /health/ready` — dependency health. |
| **Containment** | If DB slow, check indexes. If memory pressure, restart backend. |
| **Escalation** | If latency >5s p95 for >30m, escalate. |
| **Recovery verification** | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))` < 2s. |

### 5.11 ContainerRestartLoop (high)

| | |
|---|---|
| **What it means** | Container restarted >3 times in 15m — crash-looping due to config error, OOM, or dependency failure. |
| **First check** | `docker ps -a | grep -E "Restarting|Exited"` — which container? `docker logs <container> --tail 50` — why is it crashing? |
| **Health endpoint** | N/A — container-level. |
| **Containment** | `docker stop <container>` to stop loop. Fix root cause (config, env var, dependency). |
| **Escalation** | If restart loop persists after config fix, escalate. |
| **Recovery verification** | `changes(container_start_time_seconds[15m])` < 3. |

### 5.12 WahaDown (high)

| | |
|---|---|
| **What it means** | WAHA API probe failing for >2m — WhatsApp transport degraded. |
| **First check** | `docker ps -a | grep waha` — container running? `docker logs waha-medini --tail 50` — session expired, auth failure, or engine crash? |
| **Health endpoint** | `GET /api/sessions` (requires `X-Api-Key`). |
| **Containment** | `docker restart waha-medini`. If session expired, re-authenticate via QR (operator action). |
| **Escalation** | If WAHA not restored in 30m, escalate — WhatsApp messaging down. |
| **Recovery verification** | `probe_success{job="waha"}==1`. |

---

## 6. Escalation Matrix

| Severity | Response Time | Escalation Path |
|---|---|---|
| critical | 15 minutes | On-call engineer → Engineering lead |
| high | 1 hour | On-call engineer |
| medium | 4 hours | Next business day |

**Note:** This monitoring stack is internal-only. External paging (PagerDuty/Opsgenie)
requires additional configuration not covered in this document.

---

## 7. Related Documents

- `docs/BACKUP-RPO-PITR.md` — backup/restore procedures
- `docs/STAGING-TLS-VERIFICATION-RUNBOOK.md` — TLS live verification
- `docs/S10-T2-DEPLOYMENT-RUNBOOK.md` — deployment procedures
- `docs/WAHA-PRODUCTION-READINESS.md` — WAHA production setup
