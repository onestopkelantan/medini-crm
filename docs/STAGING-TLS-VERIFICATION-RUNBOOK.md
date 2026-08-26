# Medini CRM — Staging & TLS Live Verification Runbook (Tier 1, P7-F8 / TLS readiness)

**Status:** TLS live = **UNVERIFIED** (no production/staging domain attached).
This runbook is the EXACT execution checklist to verify TLS + monitoring +
backup on a real staging deployment. **No evidence is faked — each step must be
executed against a live deployment and its output recorded.**

> TLS live verification is **impossible without a real domain + DNS**, because
> Let's Encrypt performs an ACME HTTP-01/TLS-ALPN-01 challenge against the
> public domain. The Caddy *configuration* is verified (see §A); live issuance
> is **UNVERIFIED** until §B is executed on a real domain.

---

## A. TLS configuration — VERIFIED (static, this checkpoint)

| Item | State | Evidence |
|---|---|---|
| Domain env-driven | ✅ `{$DOMAIN:localhost}` | Caddyfile line 8 |
| Auto Let's Encrypt | ✅ Caddy default on 443 for a public domain | Caddy behaviour |
| HTTP→HTTPS redirect | ✅ Caddy automatic (port 80 → 443) | Caddy behaviour |
| HSTS | ✅ `max-age=31536000; includeSubDomains; preload` | Caddyfile line 11 |
| X-Frame-Options | ✅ `SAMEORIGIN` | line 12 |
| X-Content-Type-Options | ✅ `nosniff` | line 13 |
| Referrer-Policy | ✅ `strict-origin-when-cross-origin` | line 14 |
| `-Server` header removal | ✅ | line 15 |
| /metrics → 404 public | ✅ `respond @metrics 404` | lines 20–21 |
| XFF REPLACE (not append) | ✅ `header_up X-Forwarded-For {remote_host}` | line 32 |
| TRUSTED_PROXIES | ✅ `172.16.0.0/12` (compose default) | docker-compose.prod.yml |
| Only 80/443 public | ✅ DB/Redis/backend/monitoring internal | compose (no port maps) |

## B. TLS live verification — EXECUTE on staging (requires real domain)

Prerequisites: a real domain with an A/AAAA record → staging server public IP;
ports 80+443 open inbound; `DOMAIN` set in `backend/.env`.

```bash
# 0. Deploy staging (see STAGING-PARITY.md). Then:

# 1. Certificate issued & valid chain
curl -fsSvI "https://$DOMAIN/" 2>&1 | grep -iE "subject:|issuer:|expire|SSL certificate verify"
#   EXPECT: issuer = Let's Encrypt (R10/R11/E5...), verify ok = 0

# 2. HTTP→HTTPS redirect (301/308 to https)
curl -sI "http://$DOMAIN/" | grep -iE "^HTTP|^location"
#   EXPECT: HTTP/1.1 308 Permanent Redirect, location: https://...

# 3. HSTS + security headers present
curl -fsSI "https://$DOMAIN/" | grep -iE "strict-transport-security|x-frame-options|x-content-type-options|referrer-policy|^server"
#   EXPECT: HSTS preload header present; NO 'server:' header (removed)

# 4. TLS version + cipher (no TLS < 1.2)
curl -fsS --tlsv1.2 --tls-max 1.2 "https://$DOMAIN/health/live" >/dev/null && echo "TLS1.2 OK"
curl -s   --tlsv1.0 --tls-max 1.0 "https://$DOMAIN/" -o /dev/null -w "%{http_code}\n" || echo "TLS1.0 rejected (expected)"

# 5. /metrics NOT publicly exposed (404 from internet)
curl -s "https://$DOMAIN/metrics" -o /dev/null -w "%{http_code}\n"
#   EXPECT: 404

# 6. /health reachable (public-safe)
curl -fsS "https://$DOMAIN/health/ready" | head -c 200
#   EXPECT: 200 + JSON readiness

# 7. XFF / TRUSTED_PROXIES live (per-IP rate limit through Caddy)
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "%{http_code} " -X POST "https://$DOMAIN/api/v1/auth/login" \
    -H 'content-type: application/json' -d '{"username":"nope","password":"wrongpass1"}'
done; echo
#   EXPECT: 401 401 401 401 401 429  (6th = rate limited; proves per-IP bucketing via XFF)

# 8. OCSP stapling / cert transparency (optional but recommended)
echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" -status 2>/dev/null | grep -i "OCSP Response Status"
```

Record every output into the deployment log. **Only after all 8 pass may TLS be
marked VERIFIED.**

## C. Backup / RPO verification on staging

```bash
# 1. WAL archiving active
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U medini -d "$POSTGRES_DB" -tAc "SHOW archive_mode; SHOW wal_level;"
#   EXPECT: on / replica

# 2. WAL segments accumulating in the archive volume
docker compose -f docker-compose.prod.yml exec postgres ls /walarchive | grep -c '^000000'
#   EXPECT: >= 1 and growing

# 3. Full backup runs + heartbeat fresh
docker compose -f docker-compose.prod.yml exec backup sh -c \
  '/backup.sh && tail -5 /backups/backup.log && ls -la /backups/metrics/'

# 4. Restore rehearsal (full)
./backup/restore-rehearsal.sh /backups/medini_<ts>.sql.gz medini_staging_restore

# 5. PITR rehearsal
POSTGRES_HOST=localhost POSTGRES_PORT=5432 POSTGRES_USER=medini \
  WAL_ARCHIVE_DIR=/walarchive ./backup/pitr-rehearsal.sh
```

## D. Monitoring verification on staging

```bash
# 1. All scrape targets UP
docker compose -f docker-compose.prod.yml exec prometheus \
  wget -qO- http://localhost:9090/api/v1/targets | grep -o '"health":"up"' | wc -l

# 2. Dependency exporters healthy
#   pg_up==1, redis_up==1, probe_success==1

# 3. Fire a real alert (backend down) and confirm routing
docker compose -f docker-compose.prod.yml stop backend
sleep 90   # BackendDown for:1m
docker compose -f docker-compose.prod.yml exec prometheus \
  wget -qO- 'http://localhost:9090/api/v1/alerts' | grep -o BackendDown
docker compose -f docker-compose.prod.yml start backend

# 4. Alertmanager received + routed (UI / API)
docker compose -f docker-compose.prod.yml exec alertmanager \
  wget -qO- http://localhost:9093/api/v2/alerts | head -c 300
```

## E. Sign-off

- [ ] All §B TLS steps PASS → TLS = **VERIFIED**
- [ ] All §C backup steps PASS → RPO = **VERIFIED (≤5min WAL / 6h floor)**
- [ ] All §D monitoring steps PASS → Monitoring = **VERIFIED**
- [ ] Recorded in deployment log with date + operator + outputs

**Do NOT mark any item PASS without executing it against a live deployment.**
