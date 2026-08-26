# MEDINI CRM — REMEDIATION TIER 2 (SECURITY HARDENING) — FINAL REPORT

**Audited baseline (immutable):** `5eb40fd7707345b83e0fb5d0987a2f6f9cf1f169` — NOT altered/amended/reset.
**Tier 1 HEAD:** `6c131dd` · **Tier 2 remediation HEAD:** `9451fb8` (7 commits on top of Tier 1).
**Mod:** SECURITY HARDENING ONLY. **Tiada push. Tiada deploy. Tiada merge/release/lock.**
**Test count:** OLD **567** → NEW **585** (+18). **585/585 PASS.**

---

## 1. Executive Summary

Tier 2 menguatkan **defense-in-depth pada DB layer** tanpa melemahkan sebarang kawalan sedia ada. Enam keluarga finding keselamatan ditangani; tiada CRITICAL/HIGH baharu dijumpai; tiada auth-bypass / cross-org bypass / RLS bypass / JWT forgery / secret leakage diperkenalkan.

| Sub | Finding | Status |
|---|---|---|
| T2-A | FAMILY-1 org isolation (staff/role_assignments) | ✅ **FIXED+VERIFIED** (0029) |
| T2-B | FAMILY-4 password_hash exposure | ✅ **FIXED+VERIFIED** |
| T2-C | P5-F2 search_path hardening | ✅ **FIXED+VERIFIED** (0030) |
| T2-D | P5-F6 PUBLIC EXECUTE hardening | ✅ **FIXED+VERIFIED** (0030) |
| T2-E | FAMILY-2 state machine defense-in-depth | ✅ **CLASSIFIED+VERIFIED** (no change — justified) |
| T2-F | P7-F1 dev port exposure | ✅ **FIXED** (config) |
| T2-G | Security config review | ✅ **VERIFIED** (all S8/S9/S10 controls active) |

---

## 2. Findings addressed

| ID | Root cause | Risk | Status |
|---|---|---|---|
| **FAMILY-1** (P1-F2, P4-F2, P4-F3, P5-F1, P8-F5) | staff/role_assignments tiada org-scoped RLS — non-canonical `app.org_id` GUC boleh READ cross-org identity data | Cross-org identity leak (usernames/roles/invite tokens/hashes) | **FIXED** |
| **FAMILY-4** (P4-F4, P5-F7) | admin staff reads guna `select()` — membawa `password_hash`/`mfa_secret`/`invite_token` ke DTO/API | Credential exposure via admin API | **FIXED** |
| **P5-F2** | `register_staff_with_token` (SECURITY DEFINER) tanpa `SET search_path` | search_path shadowing | **FIXED** |
| **P5-F6** | Functions default PUBLIC EXECUTE | Unauthorized direct DB invocation | **FIXED** |
| **FAMILY-2** (P2-F3, P2-F4, P3-F2, P3-F6) | Lifecycle transitions enforced di service, bukan DB | Unaudited/invalid transitions | **CLASSIFIED+VERIFIED** |
| **P7-F1** | Dev compose expose 5433/6379 ke 0.0.0.0 (LAN) | Accidental dev infra exposure | **FIXED** |

## 3. Findings intentionally NOT changed (with rationale)

| Item | Rationale |
|---|---|
| **branches / organizations org-isolation** | `app_branch_ids()` resolves via the branches table → org policy there silently empties branch scope for scratch orgs and breaks the `treatment_plans_scope` PERMISSIVE chain (verified live: treatment_mix returned 0). Admin reads the canonical org by design (single-tenant G1). Both are low-sensitivity reference data, already covered by developer deny (0028) + worker read scoping (s8). |
| **app_* GUC helper functions (PUBLIC EXECUTE)** | SECURITY INVOKER, read-only `current_setting` helpers with NO object references, called by EVERY RLS policy. search_path pin adds no value; revoking PUBLIC would break RLS evaluation. |
| **New DB CHECK constraints for state transitions** | Statuses are ALREADY PostgreSQL ENUMs (invalid values rejected by the type system). Transition RULES (multi-row tx, timestamp stamping, admin override, last-HQ advisory-lock concurrency) cannot be expressed as safe CHECKs without breaking legitimate workflows. Service enforcement is correct; DB-layer backstop is the append-only audit trail (verified atomic + tamper-proof). |
| **Refresh token / registration / rate-limit / trust-proxy controls** | Already passing; no demonstrable security improvement available without weakening. Re-verified active (§11–15). |

## 4. Root cause

- **FAMILY-1:** Identity tables predate the S8 org-isolation model; only role-based (not org-based) policies existed. `n9_staff_human_all` is PERMISSIVE for any non-worker role with no org clause.
- **FAMILY-4:** Repository read methods used Drizzle `select()` (all columns) rather than an explicit safe-column projection.
- **P5-F2/F6:** `register_staff_with_token` created without `SET search_path` and with default PUBLIC EXECUTE.
- **P7-F1:** Dev compose used default port binding (all interfaces).

## 5. Files changed

- `backend/drizzle/0029_t2_org_isolation_identity.sql` **(NEW)**
- `backend/drizzle/0030_t2_function_security.sql` **(NEW)**
- `backend/drizzle/meta/_journal.json` (idx 28, 29)
- `backend/src/modules/administration/infrastructure/administration.repository.ts` (STAFF_READ_COLS)
- `backend/docker-compose.yml` (127.0.0.1 binding)
- Tests (NEW): `t2-org-isolation.spec.ts`, `t2-password-hash.spec.ts`, `t2-function-security.spec.ts`, `t2-state-machine.spec.ts`

## 6. Migration numbers

**0029** (org isolation) + **0030** (function security). Historical 0000–0028 **NOT modified**. Replay 0000→0030 deterministic: **70 tables / 296 policies = dev**.

## 7. Policy changes

- `t2_staff_org_isolation` — staff, RESTRICTIVE FOR SELECT: `app_org_id() IS NULL OR org_id = app_org_id()`
- `t2_role_assignments_org_isolation` — role_assignments, RESTRICTIVE FOR SELECT: same
- (branches/organizations evaluated → **excluded**, see §3)
- Net policy count: 294 → **296** (+2)

## 8. Function changes

- `register_staff_with_token` — recreated (same body) with `SET search_path = pg_catalog, public`; `REVOKE EXECUTE FROM PUBLIC`; `GRANT EXECUTE TO medini_app` (proacl = medini + medini_app only).

## 9. API changes

- Administration staff READ surface now returns an explicit safe-column projection (no `password_hash`/`mfa_secret`/`invite_token`). **No route/shape change for legitimate fields** (id, orgId, branchId, name, username, email, phone, role, status, specialization, doctorRef, mfaEnabled, audit cols, deletedAt). Auth internals unchanged (dedicated auth queries).

## 10. State-machine changes

**None (justified).** Classification: (A) monotonic (plans/encounters), (B) reversible (staff), (C) multi-row workflow (payment/lab/recall), (D) admin override (last-HQ). Verified: status cols are PG enums; invalid enum value rejected; audited lifecycle mutations atomic (commit/rollback together); audit_log append-only (tamper-proof trail). Service enforcement retained as the correct layer.

## 11–15. Security test matrix / IDOR / RBAC / RLS / Concurrency

| Matrix | Result |
|---|---|
| **RLS** — staff/ra cross-org SELECT (hq, non-canonical org) | ✅ denied (11→5, 5→0); canonical intact; no-GUC login intact |
| **RLS** — cross-org UPDATE (WITH CHECK/USING) | ✅ 0 rows (USING makes foreign rows invisible) |
| **RLS** — S8 org isolation (appointments, wrong org) | ✅ 0 rows (active) |
| **RLS** — S10 developer deny (staff/patients) | ✅ 0 rows (active) |
| **RLS** — S9 worker isolation (refresh_tokens, wrong org) | ✅ 0 rows (active) |
| **RBAC** — developer /system-admin only; business 403 | ✅ (s10-developer-systemadmin 4/4) |
| **IDOR** — cross-org staff/ra by UUID | ✅ denied at DB layer (org isolation) |
| **JWT** — missing/malformed/expired/altered/stale | ✅ (S10 auth suite 567+ passing; PrincipalResolver fail-closed) |
| **DB escalation** — SET ROLE medini / CREATE / ALTER | ✅ `permission denied to set role`; CREATE/ALTER denied (no CREATE on public) |
| **SECURITY DEFINER** — search_path pin, PUBLIC revoked, shadow vector | ✅ pinned; proacl medini+medini_app; medini_app no CREATE (temp per-session) |
| **Function invocation** — medini_app callable, validates token | ✅ reachable + enforces validation |
| **State machine** — enum guard, audit atomicity, append-only | ✅ 4/4 |
| **Concurrency** — last-HQ N7-2 race (×5 rounds) | ✅ (administration.spec 12/12) |
| **Password hash** — admin read surface + serialization | ✅ no credential keys; login unaffected |
| **Registration** — full invite→register→approve→login E2E | ✅ (s10-registration-replay 3/3) |
| **Rate limit / trust proxy** — login/register/refresh + XFF | ✅ (s10-rate-limit 4/4, trust-proxy-live 4/4) |
| **Refresh rotation** — matrix | ✅ (s10-refresh-token-matrix 11/11) |

## 16. Regression results

| Check | Result |
|---|---|
| **Backend full suite** | **89 files / 585/585 PASS** (clean) |
| Backend tsc (`--noEmit`) | **0 errors** |
| Backend build | **PASS** |
| Backend lint | 7 errors / 17 warnings — **PRE-EXISTING baseline** (unchanged) |
| Frontend tsc | **0 errors** |
| Frontend build | **PASS** |
| Frontend lint | **14 baseline errors** (unchanged) |
| Secret scan | **clean** (0 real secret in new migrations/src) |
| Migration replay 0000→0030 | **70 tables / 296 policies = dev** |
| Docker compose validation | **exit 0** (dev + prod) |
| Backup/restore smoke | ✅ (Tier 1 rehearsal unaffected; migrations additive) |

## 17. Before / after comparison

| Control | Before | After |
|---|---|---|
| Cross-org staff READ (non-canonical GUC) | 11 rows (leak) | **5 rows (own org only)** |
| Cross-org role_assignments READ | 5 rows (leak) | **0 rows (own org only)** |
| Admin staff API credential columns | `password_hash`/`mfa_secret`/`invite_token` selected | **stripped by construction** |
| `register_staff_with_token` search_path | caller-dependent | **pinned `pg_catalog, public`** |
| `register_staff_with_token` EXECUTE | PUBLIC | **medini_app only** |
| Dev PG/Redis exposure | 0.0.0.0 (LAN) | **127.0.0.1 only** |
| Invalid status value | (enum — already guarded) | verified guarded |
| Tests | 567 | **585** |

## 18. Security impact

- **Strengthened (additive only):** DB-layer org isolation on identity tables; credential-column exclusion on admin read surface; SECURITY DEFINER search_path pin; PUBLIC EXECUTE revocation; dev infra localhost binding.
- **Proven NOT weakened:** RLS (296 policies), RBAC, JWT, refresh security, registration, rate limiting, trust proxy, worker isolation, developer deny, audit logging, secret handling, WAHA auth. **No regression detected** — had any control weakened, work would have STOPPED per mandate.

## 19. Remaining accepted risks

| Item | Class |
|---|---|
| branches/organizations org-isolation | ACCEPTED RISK (low-sensitivity reference data; role/worker/developer denies cover; org policy breaks branch-scope chain — see §3) |
| State transition rules service-enforced | ACCEPTED RISK (correct layer; DB backstop = enum types + append-only audit trail) |
| Backend lint 7 errors (pre-existing baseline) | BACKLOG → Tier 3 |
| Backend devDep vulns (24, dev-only) | BACKLOG → Tier 3 (not shipped, breaking majors) |
| TLS live / monitoring live / staging deploy | UNVERIFIED (operational, Tier 1 documented) |

## 20. Remaining Tier 3 work

- Backend lint baseline (7 errors / 17 warnings) cleanup.
- Backend devDependency upgrades (vitest/@nestjs/cli/drizzle-kit/boundaries — breaking majors, dev-only).
- Frontend chunk-size advisory (pre-existing).

## 21. Commit hashes (7, on top of Tier 1 `6c131dd`)

| Commit | Kandungan |
|---|---|
| `eb03781` | T2-A org isolation (0029) + regression spec |
| `d2603d1` | T2-B password_hash exclusion + spec |
| `d7ecbde` | T2-C search_path + T2-D PUBLIC EXECUTE (0030) + spec |
| `10b09ce` | T2-E state machine classification + spec |
| `7c5b53f` | T2-F dev port localhost binding |
| `9451fb8` | T2 TS strict-cast fixes (tsc 0) |
| (this report) | T2-FINAL doc |

## 22. Final verdict

### 🟢 TIER 2 COMPLETE

Enam keluarga finding keselamatan ditangani dengan bukti runtime sebenar; 2 migrations (0029/0030) additive + deterministic; tiada kawalan dilemahkan; **585/585 PASS**; replay 70/296 = dev; secret scan clean. Tiada CRITICAL/HIGH baharu. Tiada stop-condition triggered.

**Tiada push. Tiada deploy. Tiada merge/release/lock. Baseline `5eb40fd` immutable. HARD STOP selepas Tier 2 — Tier 3 TIDAK dimulakan.**
