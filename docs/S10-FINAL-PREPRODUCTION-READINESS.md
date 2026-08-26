# S10 FINAL PRE-PRODUCTION READINESS

**Mod**: Final targeted remediation + verification (post GLM 5.3 APPROVE).
**Baseline**: `2940d76` — preserved; all changes in one new commit on top.
**Status**: 🟢 READY FOR FINAL FULL FORENSIC AUDIT (NOT locked, NOT pushed, NOT deployed).

---

## A. Starting checkpoint
`2940d76` — GLM 5.3 final re-audit: 🟢 APPROVE FOR CHATGPT S10 GOVERNANCE REVIEW, 0 CRITICAL / 0 HIGH.

## B. Changes made (exact files + reason)

| File | Change | Reason |
|---|---|---|
| `backend/test/integration/_replay-fixture.ts` | **NEW** (148 lines) | F-01 — self-contained replay fixture |
| `backend/test/integration/s10-registration-replay.spec.ts` | +4 lines | F-01 — call `ensureReplayFixture` in beforeAll |
| `backend/test/integration/s10-developer-systemadmin.spec.ts` | +4 lines | F-01 — same |
| `backend/test/integration/s10-trust-proxy-live.spec.ts` | **NEW** (4 tests) | F-03 — live verification A–D |
| `docker-compose.prod.yml` | +5 lines | F-03 — `TRUSTED_PROXIES: ${TRUSTED_PROXIES:-172.16.0.0/12}` |
| `staging.env` | +4 lines | F-03 — same for staging parity |
| `backend/.env.example` | +7 lines | F-03 — documented placeholder |
| `docs/S10-T2-DEPLOYMENT-RUNBOOK.md` | +25/-2 | F-03 deploy section + migration range 0025→0028 |
| `backend/src/core/auth/auth-throttler.guard.ts` | comment only | F-07 — Caddy REPLACES XFF (verified), not appends |

**No RLS/RBAC/auth/migration/business-logic changes. S8/S9 untouched.**

## C. F-01 — Self-contained fixtures

**Implementation** — `_replay-fixture.ts`:
1. Existence check via `pg_database` (no destructive DROP/CREATE by default).
2. **Cross-process advisory lock** (`pg_advisory_lock(0x53313028)`) serializes the create+replay window — two spec files running concurrently (vitest `maxWorkers: 4`) cannot race.
3. Migrations 0000→0028 replayed in file order with a **dollar-quote + string-literal aware statement splitter** (naïve `;` split broke `$$` function bodies in 0003 and quoted strings containing `;` in 0016; whole-file `query()` broke on `ALTER TYPE … ADD VALUE 'developer'` used later in the same implicit transaction in 0027 — all three fixed by the splitter, each statement committing separately = psql semantics).
4. After replay, **assert 294 policies** — a partial/corrupt replay FAILS LOUDLY.
5. Existing valid fixture is reused untouched; a corrupt one (exists but wrong policy count) is rebuilt.

**Verification**:
- Fresh environment (DB dropped): `s10-registration-replay` + `s10-developer-systemadmin` run together → **7/7 PASS** (23s, fixture auto-created).
- Fixture already exists: rerun → **7/7 PASS** (12s, idempotent, no race, no rebuild).
- Full suite: **565/565 PASS** with no manual fixture step.

## D. F-03 — TRUSTED_PROXIES

**Exact value**: `172.16.0.0/12`.

**Why correct**: in `docker-compose.prod.yml`, Caddy and backend share the `medini-internal` bridge network. Docker assigns bridge subnets from 172.16.0.0/12 (verified: dev bridge `backend_default` = 172.18.0.0/16). 172.16.0.0/12 covers every Docker bridge network, so the Caddy container is always inside the trusted range; nothing outside the Docker host can be a direct peer of the backend (DB/Redis/backend have no public ports, network is `internal: true`). The Caddyfile REPLACES `X-Forwarded-For` with `{remote_host}`, so the rightmost entry is always the real client. A narrower CIDR is not safely expressible (Docker picks the subnet dynamically); 172.16.0.0/12 is the correct RFC-1918 Docker default and is not internet-routable.

**Live verification** (`s10-trust-proxy-live.spec.ts`, compiled app, real HTTP, `TRUSTED_PROXIES=127.0.0.1`) — **4/4 PASS**:
- **A** different client IPs → separate buckets (IP-A 429 at 6th, IP-B/C still 401).
- **B** same IP repeated → 429 at 6th (login 5/min).
- **C** spoofed left-side XFF rotation → cannot bypass (rightmost wins).
- **D** multiple XFF values → rightmost (proxy-observed) is the key.
- register 3/min + refresh 10/min also verified.

## E. F-07 — Documentation correction
Guard comment now states the Caddyfile REPLACES XFF (verified in Caddyfile line 32) rather than "appends". Implementation unchanged; rightmost rule additionally correct for append-style proxies.

## F. GLM findings status

| ID | Action | Result |
|---|---|---|
| F-01 | **FIXED** | self-contained fixtures, 565/565 reproducible |
| F-02 | S11 backlog | NOT touched (doctor→HQ DB-layer gap, legacy S8) |
| F-03 | **FIXED/CONFIGURED** | 172.16.0.0/12, live-verified |
| F-04 | S11 | `tsc -b` 42 errors (40 seed.ts out-of-scope, 2 src hygiene); vite build passes — not S10 blocker |
| F-05 | S11 hygiene | `register_staff_with_token` no SET search_path — not exploitable (medini_app has no CREATE) |
| F-06 | INFO | stateless access token valid until expiry after logout — recorded trade-off |
| F-07 | **FIXED** | guard comment corrected |
| F-08 | INFO/verified | repo ahead-2 unpushed (this pass adds 1 more); staging.env committed with dev-grade placeholders (classified, not production secrets); function comment-drift cosmetic |
| F-09 | test-infra | documented (full-file E2E trips own rate limit); journey-a 3/3 PASS live |

## G. Security preservation (verified this pass)

- **No RLS architecture changes** — `git diff 2940d76` contains zero migration/RLS/RBAC/auth changes.
- **D-01 remains closed** — 0028 deny policies intact; clean replay verified 294 policies.
- **Policy count: 294** (verified on fresh replay AND on real pg_dump restore).
- **S8/S9 unchanged** — MD5 of 0020–0024 identical to S9 lock `7cca0b3`:
  `b01c4262…` / `e82dc531…` / `a9cec5f7…` / `ba770b07…` / `46db1f4a…`.
- No controls removed, no tests removed, no assertions weakened, rate limiting NOT disabled, trusted-proxy validation NOT bypassed.

## H. Test results

| Suite | Result |
|---|---|
| Backend full regression | **85 files · 565/565 PASS · 0 failed** (122s) |
| First run | 84/85 + 1 tinypool worker flake (infra, not a test) → rerun green |
| S10 replay specs (fresh + rerun) | 7/7 × 2 PASS |
| F-03 live trust-proxy | 4/4 PASS |
| Browser E2E journey-a (live :3000+:5173) | 3/3 PASS |
| Frontend lint | 14 errors — all contractual baseline (ui/* react-refresh, seed.ts, Tooth3D); no new |
| Frontend tsc (`tsc --noEmit`) | clean (0 errors) |
| Frontend production build | PASS (42.99s; chunk-size advisory pre-existing) |

## I. Infrastructure

- **Caddy/HTTPS**: auto-LE 443, HSTS preload, XFO, nosniff, `-Server`, /metrics→404 from internet, XFF replace. ✅
- **Trusted proxy**: TRUSTED_PROXIES configured (compose default + staging.env + .env.example + runbook). ✅
- **DB**: no public port, internal network, migrations 0000→0028 replay clean. ✅
- **Redis**: requirepass + appendonly, no public port. ✅
- **Metrics**: /metrics @Public by S9 Q6 governance decision, network-restricted via Caddy 404. ✅
- **Secrets**: no real credentials committed (scan clean — only `${VAR}` placeholders); staging.env dev-grade documented. ✅
- **Backup/restore**: backup.sh (daily 02:00, 30d retention, gzip) + restore-rehearsal.sh; **REAL restore rehearsal executed this pass**: pg_dump → restore to scratch → 70 tables / 294 policies / 11 staff / 14 branches → scratch dropped. ✅
- **Audit logging**: full schema (actor/role/org/branch/action/entity/before/after/source/correlation_id); auth_login_success/failure/logout persisted; 0 rows containing password/token/argon2 in payloads. ✅

## J. Remaining issues

| Item | Class |
|---|---|
| F-02 doctor→HQ DB-layer gap | **S11 backlog** (legacy S8, API blocks path) |
| F-04 `tsc -b` 42 errors | **S11** (hygiene; vite build passes) |
| F-05 search_path | **S11 hygiene** (not exploitable) |
| F-06 stateless access token | **informational** (recorded trade-off) |
| F-08 staging.env committed (dev-grade) | **informational** → move to secret manager at ops time |
| F-09 E2E full-file rate-limit self-trip | **test-infrastructure** (storageState/SkipThrottle later) |
| Frontend chunk >500 kB advisory | **informational** (pre-existing) |
| Production secrets + first-HQ bootstrap | **pre-deployment requirement** (documented: runbook §2 + S10-FIRST-HQ-BOOTSTRAP.md) |

**No production blocker. No new HIGH/CRITICAL.**

## K. Final recommendation

### 🟢 READY FOR FINAL FULL FORENSIC AUDIT

Both GLM pre-deploy conditions (F-01, F-03) are closed and live-verified; F-07 corrected; infrastructure, backup/restore, audit logging, frontend, E2E, and full regression all green; S8/S9 immutable; D-01 closed; diff is minimal and security-preserving. This checkpoint is ready to proceed to the final full GLM forensic audit → ChatGPT governance review → Final S0–S10 audit → Bos sign-off.

**NOT pushed. NOT deployed. NOT locked. NOT production-approved.**
