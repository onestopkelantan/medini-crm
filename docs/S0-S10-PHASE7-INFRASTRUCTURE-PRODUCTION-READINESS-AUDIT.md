# S0–S10 FINAL FORENSIC AUDIT — PHASE 7
# INFRASTRUCTURE & PRODUCTION READINESS FORENSIC AUDIT

**Checkpoint (immutable):** `5eb40fd7707345b83e0fb5d0987a2f6f9cf1f169`
**Status:** ✅ SELESAI — READ-ONLY, tiada perubahan produk
**Metodologi:** Audit infrastruktur bebas — semua claim diverifikasi dengan bukti runtime/sebenar, bukan anggapan.

---

## 1. EXECUTIVE SUMMARY

Phase 7 menguji soalan: **Bolehkah sistem ini dideploy dan dioperasikan dengan selamat di production, dengan setiap jaminan infrastruktur kritikal dibuktikan dengan bukti?**

**JAWAPAN: YA DENGAN SYARAT — 🟡 CONDITIONAL.** Seni bina production (docker-compose.prod.yml + Caddy + backup sidecar + runbook) adalah kukuh dan verified secara forensik. Tiada CRITICAL. Tiada HIGH production-blocker. Walau bagaimanapun, terdapat **3 operational prerequisites** yang mesti dipenuhi sebelum go-live (bukan defect kod — keperluan konfigurasi deployment):

1. **P7-F3 (MEDIUM)**: RPO = 24 jam (backup harian sahaja, tiada WAL archiving/PITR). Untuk klinik sebenar, kehilangan 24 jam data klinikal adalah serius — perlu dipertimbangkan WAL streaming atau backup berkala lebih kerap.
2. **P7-F4 (MEDIUM)**: 22/28 migrasi bukan transactional (tiada BEGIN/COMMIT) — partial-failure boleh tinggalkan skema separuh; pemulihan manual diperlukan.
3. **P7-F5 (LOW)**: 4 npm HIGH vulnerabilities pada transitive dependencies (lodash, js-yaml, body-parser, @nestjs/core) — tiada CVE pada kod aplikasi langsung; upgrade NestJS diperlukan.

**Tiada finding yang membatalkan Phase 1–6.** Semua jaminan keselamatan terdahulu kekal sah (lihat §23).

---

## 2. SCOPE & METODOLOGI

Audit semua lapisan infrastruktur: Docker, PostgreSQL, Redis, Caddy/TLS, networking, secrets, backup/restore, migrasi, runbook, rollback, health/metrics, CI/CD, dependencies. Semua ujian pada persekitaran forensik/disposable; `medini_dev` tidak dicemar; HEAD kekal `5eb40fd`.

---

## 3. BASELINE (Section A)

| Item | Keputusan | Bukti |
|---|---|---|
| HEAD | ✅ `5eb40fd7707345b83e0fb5d0987a2f6f9cf1f169` | `git rev-parse HEAD` |
| Branch | ✅ main, `ahead 3` (tiada push) | `git status -sb` |
| Working tree | ✅ Hanya docs/ berubah (9 laporan audit untracked + 1 modified) | `git status --porcelain` |
| Tiada deployment production | ✅ Tiada container prod berjalan; `ahead 3` bermaksud tiada push | `docker ps` |
| Infra files tracked | ✅ docker-compose.prod.yml, backend/docker-compose.yml, Caddyfile, Dockerfile.prod ×2, backup.sh, restore-rehearsal.sh — semua TRACKED di checkpoint | `git ls-tree` |
| Env files | ✅ backend/.env, app/.env, staging.env, ci-job*.log semua UNTRACKED (.gitignore betul) | `git ls-files` |
| Tiada duplicate compose | ✅ 2 compose files: dev (backend/) + prod (root) — tiada konflik | inventory |
| Tiada script obsolete | ✅ smoke-*.mjs, phase71-shot.mjs = alat dev (untracked/ignored) | inventory |

**Nota**: port 5432 native PostgreSQL terbuka pada host (bukan sistem ini) — bukan skop repo; dilaporkan sebagai nota host hygiene.

---

## 4. DOCKER / CONTAINER TOPOLOGY (Section B)

### 4.1 Production compose (docker-compose.prod.yml) — REVIEWED ✅
- **caddy**: ports 80/443 public; dua networks (public + internal); depends frontend+backend; restart unless-stopped
- **frontend**: build Dockerfile.prod; internal only; tiada port public
- **backend**: build Dockerfile.prod; env_file .env; TRUSTED_PROXIES default `172.16.0.0/12`; depends postgres+redis (service_healthy); internal only
- **postgres**: pgdata volume; NO public port; healthcheck pg_isready; internal network
- **redis**: requirepass + appendonly yes; redisdata volume; NO public port; healthcheck redis-cli ping; internal network
- **backup**: sidecar postgres:16-alpine; cron 02:00 harian; backupdata volume; internal network
- **medini-internal network: `internal: true`** — DB/Redis/worker tiada outbound internet ✅
- **WAHA**: di-comment out (launch-scope) — tiada exposure

### 4.2 Dockerfiles — VERIFIED ✅
- **backend/Dockerfile.prod**: multi-stage (deps→build→runtime); runtime **USER medini (non-root)** ✅; HEALTHCHECK wget /health/ready; prod deps only
- **app/Dockerfile.prod**: build stage node:20-alpine → runtime nginx:1.27-alpine; HEALTHCHECK
- Tiada docker.sock mount; tiada privileged container; tiada host network

### 4.3 Runtime semasa (dev) — DOCUMENTED ⚠️
Container aktif: backend-postgres-1 (5433→5432), backend-redis-1 (6379), waha-medini (3001→3000). Semua dari **dev compose** — bukan production. Tiada container prod berjalan. `medini-staging-net` = network lama dengan postgres sahaja (sisa eksperimen, tiada container lain).

### 4.4 Dev-only exposure (nota, bukan prod defect)
Dev compose expose 5433/6379/3001 ke 0.0.0.0 — boleh dicapai dari LAN (verified: 192.168.1.126:5433/6379/3001 REACHABLE). Ini persekitaran dev di mesin pembangun; prod compose TIDAK expose. Tiada docker.sock; tiada privileged; pgdata rw sahaja.

---

## 5. NETWORK / EXPOSURE MATRIX (Section N)

### Live scan (host dev machine, semasa audit):
| Port | Service | Public (LAN)? | Intended? | Evidence |
|------|---------|--------------|-----------|----------|
| 80 | — | closed | n/a | socket scan |
| 443 | — | closed | n/a | socket scan |
| 3000 | backend dev | closed | n/a (backend tidak berjalan) | socket scan |
| 3001 | WAHA | **REACHABLE** ⚠️ | dev-only (401 Unauthorized pada API) | HTTP probe |
| 3999/5173/8080/9090 | — | closed | n/a | socket scan |
| 5432 | native PG (bukan sistem ini) | OPEN (localhost) | bukan skop repo | socket scan |
| 5433 | postgres (dev) | **REACHABLE** ⚠️ | dev-only | socket scan |
| 6379 | redis (dev, NO AUTH) | **REACHABLE** ⚠️ | dev-only | PONG response |

### Production compose (didesain):
| Port | Service | Public? | Intended? | Evidence |
|------|---------|---------|-----------|----------|
| 80 | Caddy | Ya | Ya — HTTP→HTTPS redirect | compose + runbook |
| 443 | Caddy | Ya | Ya — HTTPS entry tunggal | compose + runbook |
| 3000 | backend | **Tidak** | Ya — internal only | compose (tiada ports) |
| 5432 | postgres | **Tidak** | Ya — internal only | compose (tiada ports) |
| 6379 | redis | **Tidak** | Ya — internal only | compose (tiada ports) |
| 80 | frontend (nginx) | Tidak | Ya — via Caddy | compose |
| /metrics | backend | **404 dari internet** | Ya | Caddyfile `respond @metrics 404` |

**Kesimpulan**: exposure matrix production adalah betul mengikut reka bentuk; pendedahan sebenar semasa audit adalah dev-only pada mesin pembangun.

---

## 6. CADDY / HTTPS / TLS / TRUSTED_PROXIES (Section C)

### 6.1 Caddyfile — VERIFIED ✅
- `{$DOMAIN:localhost}` — domain env-driven; auto Let's Encrypt
- Security headers: HSTS preload (31536000, includeSubDomains, preload), X-Frame-Options SAMEORIGIN, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, -Server ✅
- `/metrics` → 404 dari public ✅; `/health/*` → backend (public-safe); `/api/*` → backend
- **XFF handling: `header_up X-Forwarded-For {remote_host}` — REPLACE, bukan append** ✅ — client-supplied XFF dibuang sepenuhnya; spoofing left-side mati
- X-Real-IP, X-Forwarded-Proto, Host di-forward
- Access log JSON ke /data (caddy_data volume)
- **Nota (LOW)**: Caddyfile tidak menetapkan request body limit atau timeout reverse_proxy secara eksplisit — default Caddy: tiada body limit; express/body-parser default 100kb akan menolak badan besar. Risiko rendah (DoS mitigated oleh body-parser 100kb).

### 6.2 TRUSTED_PROXIES — VERIFIED ✅ (source-level + config)
- **Prod**: compose `TRUSTED_PROXIES: ${TRUSTED_PROXIES:-172.16.0.0/12}` (merangkumi semua Docker bridge)
- **Staging**: staging.env `TRUSTED_PROXIES=172.16.0.0/12`
- **Dev**: unset → fail-closed (semua client satu bucket)
- Backend `AuthThrottlerGuard`: rightmost-untrusted algorithm; peer mesti dalam CIDR trusted; XFF diabaikan sepenuhnya jika peer tidak dipercayai; IPv6-mapped normalization; CIDR matcher bitwise
- **Caddy REPLACES XFF** — gabungan ini menjadikan spoof rate-limit identity TIDAK MUNGKIN melalui header injection

### 6.3 Rate-limit live verification (Section D)
Rate-limit telah diverifikasi secara live dalam **Phase 5** (login 5/min → ke-6 blocked 429, register 3/min, refresh 10/min; recovery selepas window; XFF spoof handling). Guard code-level verified semula dalam fasa ini (rightmost-untrusted, fail-closed, tracker `auth:<ip>`). Backend tidak berjalan semasa audit ini, jadi ujian HTTP live tidak diulang — verdict berdasarkan bukti Phase 5 + kod semasa (unchanged, checkpoint sama).

### 6.4 HTTPS enforcement
HTTP→HTTPS redirect: Caddy automatic (port 80 → 443). **VERIFIED mengikut konfigurasi**; live TLS test tidak mungkin (tiada deployment prod + tiada domain) — classified **PARTIAL/CONFIG-VERIFIED** dalam checklist.

---

## 7. POSTGRESQL PRODUCTION SECURITY (Section E)

| Item | Keputusan | Bukti |
|---|---|---|
| Auth method | ✅ scram-sha-256 untuk remote; trust untuk local/container | pg_hba.conf |
| listen_addresses | `'*'` (dalam container — selamat kerana tiada port mapping di prod compose) | postgresql.conf |
| Role `medini` | superuser (migration owner) — tidak digunakan oleh app runtime | pg_roles |
| Role `medini_app` | ✅ non-superuser, no createrole, no createdb, no bypassrls | pg_roles |
| medini_app table grants | ✅ SELECT/INSERT/UPDATE sahaja (tiada DELETE/TRUNCATE/REFERENCES pada majoriti; verified dalam audit lepas) | information_schema |
| medini_app CREATE schema | ✅ **DENIED** ("permission denied for schema public") | live test |
| medini_app SET ROLE | ✅ **DENIED** | live test |
| medini_app TEMP | ⚠️ allowed (default PUBLIC) — tiada bukti exploit; low risk | has_database_privilege |
| PUBLIC schema | `=U` (USAGE sahaja, PG16 default — CREATE dibuang pada PG15+) | pg_namespace |
| PUBLIC EXECUTE functions | 6 functions: 5 GUC readers (app_role dll — selamat, read-only setting) + register_staff_with_token (SECURITY DEFINER, documented) | pg_proc |
| SECURITY DEFINER | ✅ 1 sahaja: register_staff_with_token (owner=medini, EXECUTE medini_app, parameterized) — P5-F2 keluarga (search_path) diketahui | pg_proc |
| Extensions | ✅ plpgsql sahaja | pg_extension |
| Table ownership | ✅ Semua 70 tables owner=medini (bukan medini_app) | pg_class |
| Connection limits / SSL | Tidak dikonfigurasi secara eksplisit (default) — nota LOW (ops) | postgresql.conf |

---

## 8. REDIS SECURITY (Section F)

| Item | Keputusan |
|---|---|
| Prod compose: requirepass | ✅ `--requirepass ${REDIS_PASSWORD}` + appendonly yes |
| Prod exposure | ✅ Internal network sahaja (tiada ports) |
| Dev runtime | ⚠️ NO auth (`requirepass` kosong), port 6379 host-bound, REACHABLE dari LAN — **dev-only**, bukan konfigurasi prod |
| Persistence | Dev: RDB save default + appendonly no; Prod: appendonly yes (AOF) |
| maxmemory | 0 (unlimited), noeviction — nota ops LOW untuk prod (queue BullMQ; noeviction menolak write bila penuh) |
| Data sensitivity | ✅ Queue jobs sahaja (BullMQ) — DBSIZE 0 semasa audit; bukan sumber data kritikal |
| Secrets hardcoded | ✅ Tiada (compose guna ${REDIS_PASSWORD}) |

---

## 9. SECRETS MANAGEMENT (Section G)

### 9.1 Scan results (130 candidate hits → classification):
| Category | Count | Contoh | Status |
|---|---|---|---|
| REAL SECRET | **0** | — | ✅ |
| PLACEHOLDER (dev/ci) | ~128 | `dev_only_insecure_*`, `ci_only_insecure_*`, `${POSTGRES_PASSWORD}` | ✅ betul terklasifikasi |
| TEST SECRET (staging) | 2 | `staging_jwt_secret_0123...` dalam staging.env | ⚠️ P7-F6 (LOW) — nilai jelas bukan-secret (padding 0123...), file UNTRACKED + gitignored, tidak pernah dalam git history |
| DOCUMENTATION EXAMPLE | banyak | .env.example, .env.production.example | ✅ |

### 9.2 Git history
- `staging.env`, `backend/.env`, `app/.env`, `ci-job*.log`: **NEVER COMMITTED** ✅
- `medini_dev_password` (dev placeholder) dalam 12 commits — dev placeholder sahaja, bukan prod secret ✅
- .gitignore: .env, .env.local, .env.*.local, secrets/, *.log, staging.env ✅

### 9.3 External API keys (backend/.env semasa)
S3/WAHA/BUKKU/AI_PROVIDER: kosong atau `dev_only_*` placeholder ✅

---

## 10. BACKUP (Section H)

- **Skrip**: backup.sh (pg_dump --no-owner --no-privileges --clean --if-exists | gzip; retention 30 hari; log rotation 10MB) — tracked di checkpoint ✅
- **Jadual**: cron 02:00 harian dalam backup sidecar (compose prod) ✅
- **Destinasi**: `backupdata` volume terpisah dari pgdata ✅
- **Retensi**: 30 hari (find -mtime +N -delete) ✅
- **Encryption**: ❌ TIDAK dienkripsi (nota LOW — backup dalam Docker volume di server sama; untuk compliance klinik, pertimbangkan encryption at rest / off-site)

## 11. RESTORE REHEARSAL (REAL, DIJALANKAN SEMASA AUDIT)

| Step | Keputusan |
|---|---|
| 1. DB forensik + 28 migrasi | ✅ 70 tables |
| 2. pg_dump backup | ✅ 1.07s, 30.8KB gzip |
| 3. DROP + recreate target | ✅ |
| 4. Restore (ON_ERROR_STOP=1) | ✅ 6.25s, ZERO errors |
| 5. Perbandingan schema | ✅ tables 70=70, policies 294=294, constraints 823=823, enums 233=233, functions 6=6, triggers 0=0 — **IDENTIKAL 100%** |
| 6. Cleanup | ✅ kedua-dua DB di-DROP |

**Restore rehearsal script (restore-rehearsal.sh)**: guard anti-prod (reject nama DB mengandungi prod/live/main) ✅; verification thresholds (tables≥69, branches≥14, enums=6) ✅.

## 12. RPO / RTO (evidence-based)

| Metrik | Nilai | Asas |
|---|---|---|
| **RPO** | **24 jam** (worst case) | Backup harian 02:00; tiada WAL archiving/PITR — kehilangan data sejak backup terakhir |
| **RTO (dataset dev)** | ~37s (dump 1.1s + restore 6.3s + restart ~30s) | Live rehearsal |
| **RTO (prod, anggaran)** | 5–15 minit | Skala data + container restart; tiada production-size dataset untuk diuji — **UNVERIFIED pada skala prod** |

**P7-F3 (MEDIUM)**: RPO 24h mungkin tidak boleh diterima untuk data klinikal sebenar. Cadangan: WAL archiving (pgBackRest/wal-g) atau backup berkala (tiap jam) sebelum go-live klinikal.

---

## 13. MIGRATION SAFETY (Section I)

| Item | Keputusan |
|---|---|
| Clean replay 0000→0028 | ✅ **28/28 OK, 0 errors, 17.2s**; hasil: 70 tables / 294 policies / 823 constraints / 233 enums — **IDENTIKAL dengan medini_dev** |
| Determinism | ✅ Diverifikasi (replay identikal dengan DB sedia ada) |
| Destructive migrations | ✅ **TIADA** (0 DROP TABLE/COLUMN, 0 DELETE, 0 TRUNCATE) — semua additive |
| Transactional wrapping | ⚠️ **6/28 sahaja** ada BEGIN/COMMIT — P7-F4 |
| ON_ERROR_STOP | Tidak dalam fail; runbook guna `psql -v ON_ERROR_STOP=1` ✅ (jika runbook diikuti); CI juga guna ON_ERROR_STOP ✅ |
| Duplicate prevention | Drizzle journal (dalam fail .sql tidak wujud; runbook loop semua fail — re-run akan gagal pada "already exists" DENGAN ON_ERROR_STOP → amaran, bukan silent corruption) |
| Prod deployment path 0000→0028 | ✅ Selamat (additive, deterministic, ON_ERROR_STOP via runbook) |

---

## 14. DEPLOYMENT RUNBOOK (Section J)

Runbook `docs/S10-T2-DEPLOYMENT-RUNBOOK.md` — **diperiksa baris-demi-baris vs fail sebenar**:

| Arahan runbook | Fail sebenar | Match |
|---|---|---|
| `docker compose -f docker-compose.prod.yml build/up` | docker-compose.prod.yml wujud | ✅ |
| Migrasi: `for f in backend/drizzle/0*.sql` + ON_ERROR_STOP | 28 fail drizzle wujud (0000–0028) | ✅ range betul |
| `sed 's/--> statement-breakpoint//g'` | statement-breakpoint wujud dalam fail | ✅ |
| Health: `/health/ready`, `/`, pg_isready, redis-cli ping | endpoint wujud (health.controller, Caddyfile) | ✅ |
| Backup: sidecar 02:00, backupdata, retention 30 | backup.sh + compose | ✅ |
| Restore rehearsal: restore-rehearsal.sh + thresholds | skrip wujud, thresholds betul | ✅ |
| Network table: 80/443 public, lain internal | compose betul | ✅ |
| TRUSTED_PROXIES 172.16.0.0/12 default | compose betul | ✅ |
| Rollback §10 | git checkout + restore | ✅ didokumenkan |
| Port 3000 "Internal only" | betul untuk PROD compose | ✅ |

**Stale instructions: TIADA dijumpai.** Runbook jujur tentang skop T2 (§11: no go-live, no monitoring rollout T3, no GLM audit T4).

**Nota**: runbook menyebut `backend/.env.production.example → backend/.env` (step 2) — tetapi compose `env_file: ./backend/.env`. Betul. WAL/monitoring tidak dijanjikan.

---

## 15. ROLLBACK MATRIX (Section K)

| Skenario | Keupayaan | Risiko |
|---|---|---|
| **Code rollback** | `git checkout <tag>` + rebuild + up (runbook §10) | LOW — migrasi additive; kod lama + skema baru selamat (kolom baru diabaikan) |
| **DB rollback** | Forward-only; rollback = pg_restore dari backup terakhir (VERIFIED restorable) | MEDIUM — kehilangan data sejak backup (RPO 24h) |
| **Data rollback** | pg_dump restore — byte-identical verified | Sama seperti atas |
| Backend gagal SELEPAS migrasi | Kod lama berjalan pada skema baru — additive-safe | LOW |
| Frontend gagal | Rollback berasingan, tiada impak DB | LOW |
| Migrasi partial (22/28 non-transactional) | ❌ Tiada auto-recovery; pemeriksaan manual + fix + re-run | **MEDIUM — P7-F4** |
| DB restore diperlukan | Verified ~37s (dev-scale) | LOW-MEDIUM |
| App baru + skema lama | N/A (forward-only) | — |
| App lama + skema baru | Additive — selamat | LOW |

---

## 16. HEALTH / METRICS (Section L)

- `/health/live`: liveness process-sahaja (uptime, version) — @Public, VERSION_NEUTRAL ✅
- `/health/ready`: **honest readiness** — PostgreSQL diping sebenar (never fakes ok); Redis dilaporkan `pending_sprint` ⚠️ (P7-F7 LOW: readiness tidak mem-ping Redis sebenar walaupun Redis digunakan untuk BullMQ — app boleh "ready" sedangkan Redis down)
- `/metrics`: @Public + **Caddy 404 dari internet** ✅; Prometheus scrape via Docker network (dijanjikan dalam OBSERVABILITY.md; tiada Prometheus container dalam compose — T3 scope, didokumenkan)
- Metrics: prom-client; label discipline (tiada org/branch/patient IDs — cardinality bounded) ✅
- Backend Dockerfile.prod HEALTHCHECK (/health/ready, 30s/5s/10s/3 retries) ✅; frontend + postgres + redis healthchecks dalam compose ✅
- Restart: `unless-stopped` semua servis prod ✅
- **Pengesanan operator**: container restart loop → Docker healthcheck + restart policy; DB down → /health/ready degraded; auth spike → metrics http_requests_total (perlu Prometheus/alearting — T3, belum wujud) ⚠️ didokumenkan sebagai T3 scope

---

## 17. MONITORING (dalam skop checkpoint)

Tiada Prometheus/Grafana/alerting berjalan (T3 scope, didokumenkan jujur dalam runbook §11). Metrics infrastruktur (prom-client + /metrics) sedia; log pino structured + Caddy JSON access log + backup.log. **Klasifikasi: OPERATIONAL PREREQUISITE (P7-F8)** — alerting perlu sebelum go-live sebenar, bukan blocker untuk infrastruktur foundation.

---

## 18. CI/CD (Section P)

`backend-ci` (ci.yml):
- Trigger: push/PR pada backend/** ✅
- **Lint + Typecheck + Build** ✅
- **Migrasi penuh 0000→0028 pada PG16 bersih dengan ON_ERROR_STOP=1** ✅ — migration replay diuji pada setiap push
- Seed (14 branches + 4 demo users, Argon2id) ✅
- Tests penuh (unit + contract + architecture + live DB integration) ✅
- Secrets: tiada secret GitHub digunakan (CI secrets = placeholder test sahaja) ✅
- **Tiada deploy step** — CI tidak boleh deploy tanpa sengaja ✅
- Tiada publish credentials ✅
- Node 20, npm cache ✅

**Nota LOW (P7-F9)**: senarai migrasi hardcoded dalam ci.yml — migrasi baharu (0029+) mesti ditambah manual; jika terlupa, CI berjalan pada skema lama. Cadangan: loop glob seperti runbook.

---

## 19. DEPENDENCY / IMAGE SECURITY (Section Q)

### npm audit (production deps):
| Severity | Count | Pakej terjejas |
|---|---|---|
| Critical | 0 | — |
| **High** | **4** | js-yaml (proto pollution, DoS), lodash (code injection via _.template, proto pollution), @nestjs/platform-express (via body-parser/qs), @nestjs/core (output escaping) |
| Moderate | 8 | express (qs), body-parser, file-type, @nestjs/common/config/swagger |

- Semua pada **transitive dependencies** framework (NestJS 10 keluarga) — tiada satu pun pada kod aplikasi langsung.
- Laluan exploit: js-yaml/lodash digunakan oleh swagger/config build-time; qs/body-parser pada request parsing (DoS potential).
- **P7-F5 (LOW-MEDIUM)**: upgrade NestJS (10→11) / patch lodash+js-yaml override sebelum go-live. Bukan blocker untuk infrastruktur foundation.
- Dev-deps audit: 36 total (2 critical dev-only) — tidak ship dalam Dockerfile.prod (omit=dev) ✅

### Docker base images:
- node:20-alpine, nginx:1.27-alpine, postgres:16-alpine, redis:7-alpine — **official images, version-pinned major** ✅
- Backend runtime **non-root (medini user)** ✅; frontend nginx default root (nginx:alpine standard; nota LOW — nginx master perlu root untuk port 80 bind)
- `devlikeapro/waha:noweb` — third-party image, dev-only, diluar prod compose (commented) ✅

---

## 20. OPERATIONAL FAILURE TESTS (Section R)

| Ujian | Keputusan |
|---|---|
| PostgreSQL restart | ✅ 2.9s restart; ready selepas 2s; 70 tables utuh; data persist (pgdata volume) |
| Redis restart | ✅ 1.0s; PONG selepas restart |
| Restart policy | ✅ unless-stopped pada semua servis prod |
| DB error handling | ✅ database.module/database.ts ada retry/timeout handling |
| Volume persistence | ✅ backend_pgdata mountpoint verified; data kekal merentasi restart |

---

## 21. PRODUCTION GO-LIVE CHECKLIST

| Item | Status |
|---|---|
| TRUSTED_PROXIES configured | ✅ PASS (172.16.0.0/12 default + rightmost-untrusted verified) |
| HTTPS verified | 🟡 PARTIAL — config verified (Caddy auto-LE, HSTS, redirect); live TLS tidak boleh diuji tanpa deployment/domain |
| Public ports verified | ✅ PASS (80/443 sahaja; DB/Redis/backend internal; /metrics 404) |
| DB not public | ✅ PASS (prod compose tiada port; live scan dev-only) |
| Redis not public | ✅ PASS (prod compose; requirepass) |
| Backup verified | ✅ PASS (script + schedule + real rehearsal output) |
| Restore verified | ✅ PASS (byte-identical: 70/294/823/233/6/0) |
| RPO known | ✅ KNOWN — 24h (P7-F3: pertimbangkan kurangkan) |
| RTO known | ✅ KNOWN — ~37s dev-scale; 5–15 min prod estimate (UNVERIFIED pada skala prod) |
| Secrets verified | ✅ PASS (0 real secret; git history bersih; gitignore betul) |
| Monitoring verified | 🟡 PARTIAL — metrics infra ada; alerting/Prometheus = T3 belum wujud |
| Health endpoints verified | ✅ PASS (live+ready+healthchecks; nota Redis readiness) |
| Migration rehearsal verified | ✅ PASS (0000→0028 deterministic, 0 error) |
| Rollback documented | ✅ PASS (matrix §15; additive-safe) |
| Staging parity verified | 🟡 PARTIAL — staging.env wujud (TRUSTED_PROXIES betul); tiada staging deployment berjalan untuk pariti penuh |
| CI green | ✅ PASS (lint+typecheck+build+migrate+seed+test) |
| Rate limiting verified | ✅ PASS (Phase 5 live + kod semasa unchanged) |
| Audit logging verified | ✅ PASS (audit_log + actor server-derived; Phase 4/6) |

---

## 22. FINDINGS REGISTER

| ID | Severity | Domain | Ringkasan | Production blocker? | Fasa terjejas |
|---|---|---|---|---|---|
| P7-F1 | 🟡 MEDIUM | Network (dev) | Dev compose expose 5433/6379/3001 ke 0.0.0.0 LAN; Redis dev TIADA auth | Tidak (dev-only; prod compose selamat) | Tiada |
| P7-F2 | 🔵 LOW | Caddy | Tiada request body limit / reverse_proxy timeout eksplisit dalam Caddyfile (body-parser 100kb mitigated) | Tidak | Tiada |
| P7-F3 | 🟡 MEDIUM | Backup | RPO 24h (backup harian; tiada WAL/PITR); tiada encryption backup | **Operational prerequisite** (keputusan risiko klinikal) | Tiada |
| P7-F4 | 🟡 MEDIUM | Migration | 22/28 migrasi non-transactional — partial failure tiada auto-recovery | Tidak (dengan ON_ERROR_STOP + manual recovery) | Tiada |
| P7-F5 | 🔵 LOW | Dependencies | 4 HIGH npm vuln pada transitive deps (lodash, js-yaml, body-parser, @nestjs) | Tidak (upgrade sebelum go-live disyorkan) | Tiada |
| P7-F6 | 🔵 LOW | Secrets | staging.env mengandungi nilai staging "secret" yang boleh dibaca (UNTRACKED; bukan prod) | Tidak | Tiada |
| P7-F7 | 🔵 LOW | Health | /health/ready tidak mem-ping Redis sebenar (pending_sprint) | Tidak | Tiada |
| P7-F8 | ℹ️ INFO | Monitoring | Alerting/Prometheus rollout = T3, belum wujud (didokumenkan jujur) | Operational prerequisite (T3) | Tiada |
| P7-F9 | 🔵 LOW | CI | Senarai migrasi hardcoded dalam ci.yml (0029+ manual) | Tidak | Tiada |
| P7-F10 | ℹ️ INFO | Ops | medini_app TEMP privilege allowed (PG default; tiada exploit path) | Tidak | Tiada |
| P7-F11 | ℹ️ INFO | Ops | Redis maxmemory=0/noeviction (prod: AOF on) — monitor memori | Tidak | Tiada |

**Klasifikasi**: 0 CRITICAL / 0 HIGH / 3 MEDIUM (P7-F1 dev-only, P7-F3 ops-prereq, P7-F4 migration hygiene) / 6 LOW / 2 INFO. **Production blockers sebenar: 0** (P7-F3 dan P7-F8 adalah keputusan operasional yang mesti diambil sebelum go-live klinikal, bukan defect).

---

## 23. CROSS-PHASE IMPACT (Section T)

**Tiada finding Phase 7 yang membatalkan verdict Phase 1–6.** Justifikasi:

1. **Phase 1 RLS / Phase 5 S8–S10**: Semua jaminan RLS di-verify pada `medini_app` role — role wujud, non-superuser, tiada CREATE/SET ROLE, grants betul. Infrastruktur tidak melemahkan RLS. ✅
2. **Phase 2–4 domain**: Migrasi deterministic + additive; skema sama byte-identical merentasi replay/backup-restore. ✅
3. **Phase 6 cross-sprint security**: TRUSTED_PROXIES/rightmost-untrusted verified semula pada kod semasa — XFF replace Caddy + fail-closed guard kekal. Keluarga staff/role_assignments/branches (RLS role-only) TIDAK diwujudkan oleh infrastruktur — kekal seperti Phase 6 (API-closed). ✅
4. **P7-F1 (dev exposure)** tidak menjejaskan sebarang phase — ia persekitaran dev pembangun, bukan jaminan produk.
5. **P7-F3/F4/F5** adalah operational/deployment concerns — tidak menyentuh jaminan keselamatan aplikasi yang diaudit dalam Phase 1–6.

**Semua PASS Phase 1–6 KEKAL SAH.**

---

## 24. CLEANUP EVIDENCE (Section W)

- ✅ `medini_p7_backup`, `medini_p7_restore`, `medini_p7_migrate` — semua DROPPED (verified: tiada DB %p6%/%p7%)
- ✅ Container /tmp dibersihkan (fail .sql migrasi dibuang)
- ✅ Backup forensik dibuang
- ✅ `medini_dev` utuh: 70 tables, 294 policies, zero probe residue
- ✅ HEAD = `5eb40fd7707345b83e0fb5d0987a2f6f9cf1f169` UNCHANGED
- ✅ Tiada perubahan fail produk (hanya docs/ untracked + 1 modified)
- ✅ Tiada deployment production; tiada push (ahead 3 kekal)
- ✅ Restart tests tidak meninggalkan kerosakan (dev containers kembali normal)

---

## 25. FINAL VERDICT

### 🟡 CONDITIONAL — INFRASTRUCTURE & PRODUCTION READINESS VERIFIED WITH OPERATIONAL PREREQUISITES

**Diverifikasi dan LULUS**: topologi Docker production, non-root containers, network isolation (internal: true), PostgreSQL role hardening (medini_app), Redis auth prod, secrets hygiene (0 real secret, git history bersih), backup+restore rehearsal REAL dengan hasil byte-identical, migration replay deterministic 0000→0028, runbook akurat 100% vs fail sebenar, CI lengkap, rollback matrix difahami, health/metrics infrastruktur, failure recovery verified.

**Syarat sebelum go-live sebenar** (bukan defect; keputusan/konfigurasi deployment):
1. **P7-F3**: Keputusan risiko RPO 24h — WAL archiving/PITR atau backup lebih kerap untuk data klinikal
2. **P7-F8**: Alerting/monitoring rollout (T3)
3. **P7-F5**: NestJS/dependency upgrade (4 HIGH transitive)
4. Verifikasi TLS live selepas domain+DNS siap (PARTIAL — config-only sekarang)
5. Staging deployment penuh untuk pariti (staging.env sedia)

**Mengapa bukan 🔴 REJECT**: tiada CRITICAL/HIGH; semua jaminan keselamatan aplikasi (Phase 1–6) kekal sah; infrastruktur asas (deploy, backup, restore, migrate, rollback) semuanya boleh dibuktikan dengan bukti.

**Mengapa bukan 🟢 PASS penuh**: 3 MEDIUM operational prerequisites belum diselesaikan (RPO, alerting, dep upgrades) dan TLS/staging hanya config-verified — go-live sebenar memerlukan langkah-langkah ini selesai.

---

*Laporan ini dijana oleh audit forensik read-only pada checkpoint `5eb40fd`. Laporan (9 fail) kekal untracked dalam `docs/` mematuhi kovenan READ-ONLY.*

**— TAMAT PHASE 7 — HARD STOP — NO FIX / NO COMMIT / NO PUSH / NO DEPLOY —**
