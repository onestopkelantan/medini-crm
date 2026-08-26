# FINAL HARDENING PASS REPORT — F-02 + F-05 + B-2 + F11-1

**Date:** 2026-08-23 · **Baseline:** `5eb40fd` (immutable, recoverable) · **HEAD before pass:** `cf71539` · **HEAD after pass:** (see commits below)

---

## 1. Executive Summary

One controlled final hardening pass completed before independent GLM 5.3 re-audit.
- **F-02 (doctor→HQ DB-layer gap):** FIXED — additive migration 0031, 6 RESTRICTIVE policies, verified.
- **F-05 (SECURITY DEFINER):** ACCEPTED RISK — non-exploitable, required by registration flow, no safe change needed.
- **B-2 (monitoring incident response):** FIXED — comprehensive runbook added to MONITORING.md.
- **F11-1 (Alertmanager):** VERIFIED — static config, no shell expansion, starts/restarts cleanly.
- Full regression: 585/585 PASS ×2, migration replay 0000→0031 deterministic, zero drift.

---

## 2. F-02 Root Cause

`n9_staff_human_all` PERMISSIVE policy was too broad — it allowed ALL human roles
(including doctor) to perform ALL operations on `staff` without role-based
restriction. The API layer blocked this, but the DB layer did not.

Specifically:
- Doctor could INSERT staff with `role='hq'` (bypassing `staff_non_hq_requires_branch`
  check constraint, which only enforces branch_id for non-HQ roles).
- Doctor could UPDATE staff `role='hq'` (RLS WITH CHECK did not block role escalation).

---

## 3. F-02 Exact Fix

**Migration:** `0031_f02_doctor_admin_deny.sql` (additive, after 0030)

**6 RESTRICTIVE policies created:**

| Table | Policy | Command | Effect |
|---|---|---|---|
| staff | `f02_staff_doctor_insert_hq_deny` | INSERT | Deny doctor/receptionist inserting rows with role IN ('hq','developer') |
| staff | `f02_staff_doctor_update_hq_deny` | UPDATE | Deny doctor/receptionist updating rows to role IN ('hq','developer') |
| staff | `f02_staff_doctor_delete_hq_deny` | DELETE | Deny doctor/receptionist deleting rows with role IN ('hq','developer') |
| role_assignments | `f02_ra_doctor_insert_hq_deny` | INSERT | Same restriction |
| role_assignments | `f02_ra_doctor_update_hq_deny` | UPDATE | Same restriction |
| role_assignments | `f02_ra_doctor_delete_hq_deny` | DELETE | Same restriction |

**Design principle:** RESTRICTIVE policies are ANDed with existing PERMISSIVE
policies. So `n9_staff_human_all` still allows non-workers, but `f02_*` policies
add: "EXCEPT doctor/receptionist cannot modify HQ/developer rows."

---

## 4. F-02 Before/After Evidence

| Scenario | Before | After |
|---|---|---|
| Doctor INSERT staff role='hq' | ✅ ALLOWED (bug) | ❌ DENIED (`f02_staff_doctor_insert_hq_deny`) |
| Doctor UPDATE staff role='hq' | ✅ ALLOWED (bug) | ❌ DENIED (`f02_staff_doctor_update_hq_deny`) |
| Doctor DELETE staff role='hq' | ❌ DENIED (permission denied) | ❌ DENIED (unchanged) |
| Doctor INSERT role_assignments role='hq' | ❌ DENIED (org isolation) | ❌ DENIED (unchanged) |
| Doctor UPDATE role_assignments role='hq' | ✅ ALLOWED (bug) | ❌ DENIED (USING clause filters) |
| Doctor DELETE role_assignments role='hq' | ❌ DENIED (permission denied) | ❌ DENIED (unchanged) |
| Doctor SELECT staff | ✅ ALLOWED (legitimate) | ✅ ALLOWED (unchanged) |
| Doctor SELECT role_assignments | ✅ ALLOWED (legitimate) | ✅ ALLOWED (unchanged) |
| HQ INSERT staff role='hq' | ✅ ALLOWED (legitimate) | ✅ ALLOWED (unchanged) |
| Branch manager SELECT staff | ✅ ALLOWED (legitimate) | ✅ ALLOWED (unchanged) |

---

## 5. New Migration Number

**0031** — `0031_f02_doctor_admin_deny.sql`

---

## 6. F-05 Threat-Model Assessment

| Check | Result |
|---|---|
| Function owner | `medini` (not `medini_app`) |
| SECURITY DEFINER | Yes |
| EXECUTE ACL | `medini`, `medini_app` only (PUBLIC excluded) |
| search_path | `pg_catalog, public` (pinned) |
| Function arguments | `p_invite_token`, `p_name`, `p_username`, `p_password_hash`, `p_org_id` |
| Dynamic SQL | None |
| Tables accessed | `staff` only (SELECT + UPDATE) |
| INSERT/UPDATE/DELETE | UPDATE only |
| Caller-controlled object resolution | No — all identifiers static |
| Caller can create/alter objects | No — CREATE denied to medini_app |
| Caller can SET ROLE | No — function runs as owner, not caller |
| Caller can bypass RLS | No — function does not disable RLS |
| PUBLIC can execute | No — ACL excludes PUBLIC |
| Privilege escalation possible | No — function validates token, org_id, status, expiry |
| Required by registration flow | Yes — sole path for staff self-registration |

**Unauthorized execution test:** FAIL (Invalid or expired invitation)
**Privilege escalation test:** FAIL (org_id mismatch rejected)
**Valid registration test:** PASS (worker with valid token registered successfully)

---

## 7. F-05 Decision

**ACCEPTED / NON-EXPLOITABLE RESIDUAL RISK**

Justification:
- Function is the sole legitimate path for staff self-registration (invite-token flow).
- No dynamic SQL, no caller-controlled object resolution, no RLS bypass.
- ACL is tight (medini + medini_app only).
- search_path is pinned.
- Previous audits (S10, Tier 2) found no exploitable path.
- Any change would require rewriting the registration flow — unacceptable regression risk.

---

## 8. B-2 Documentation Changes

Added to `docs/MONITORING.md`:
- **Section 5: Incident Response Runbook** — 11 alerts mapped to operator actions
  (what it means, first check, health endpoint, containment, escalation, recovery verification)
- **Section 6: Escalation Matrix** — critical/high/medium response times
- **Section 7: Related Documents** — cross-references to backup, TLS, deployment, WAHA runbooks

---

## 9. F11-1 Verification

- ✅ No `${VAR:-default}` syntax in `monitoring/alertmanager.yml`
- ✅ `amtool check-config` PASS
- ✅ Docker Compose config valid
- ✅ Alertmanager starts successfully
- ✅ Alertmanager survives restart
- ✅ Prometheus can communicate with Alertmanager
- ✅ Alert rules remain loaded
- ✅ No real secrets committed

---

## 10. Migration Replay Result

- **Range:** 0000 → 0031 (31 migrations)
- **Deterministic:** Yes
- **Errors:** None
- **Dev schema == Replay schema:** Yes (302 policies, 70 tables, 269 indexes, 6 functions, 56 enums)
- **Historical migrations modified:** No

---

## 11. Full Test Result

| Suite | Result |
|---|---|
| Backend lint | 0 errors, 0 warnings |
| Backend tsc | 0 errors |
| Backend build | PASS |
| Backend tests | **585/585 PASS ×2 consecutive** |
| Frontend lint | 0 errors |
| Frontend tsc | 0 errors |
| Frontend build | PASS |

---

## 12. Security Regression Result

| Area | Result |
|---|---|
| Authentication (login, wrong password, malformed JWT, expired JWT, refresh rotation, refresh reuse, logout, post-logout) | ✅ PASS (11/11 refresh matrix) |
| RBAC (HQ, branch_manager, branch_admin, doctor, receptionist, worker, developer) | ✅ PASS (14/14 targeted) |
| RLS (cross-org SELECT/INSERT/UPDATE/DELETE, cross-branch, WITH CHECK) | ✅ PASS |
| F-02 specific (doctor direct DB to admin data) | ✅ DENIED |
| IDOR (staff IDs, role assignment IDs, settings IDs, AI IDs, cross-org UUIDs) | ✅ PASS (0 unauthorized) |
| Escalation (doctor→HQ, branch_manager→HQ, branch_admin→HQ, developer→privileged, worker→human) | ✅ DENIED |
| GUC manipulation (role spoofing, org spoofing) | ✅ DENIED |
| SQL injection | ✅ BLOCKED (syntax error — parameterized) |
| Concurrency (last-HQ protection, role versioning) | ✅ PASS (12/12 administration spec) |
| Monitoring (Alertmanager startup, restart, Prometheus connectivity, alert loading) | ✅ PASS |
| Secrets | ✅ CLEAN (no secrets in repo) |
| Docker Compose | ✅ VALID |
| WAHA auth/security | ✅ INTACT (compose disabled, auth documented) |

---

## 13. RLS/RBAC/IDOR Result

- **RLS:** 302 policies, all verified. F-02 adds 6 restrictive policies.
- **RBAC:** All 7 roles tested. Doctor/receptionist cannot escalate to HQ/developer.
- **IDOR:** 0 unauthorized access across staff, role_assignments, settings, AI, cross-org UUIDs.

---

## 14. Infrastructure/Monitoring Result

- Alertmanager: static config, deterministic, starts/restarts cleanly, Prometheus connectivity OK.
- Prometheus: alert rules loaded (medini-availability, medini-dependencies, medini-infrastructure).
- Docker Compose: valid.
- No monitoring controls weakened.

---

## 15. Secret Scan Result

**CLEAN.** No real secrets committed. All secrets use `${VAR}` placeholders or
are gitignored (`.env`, `staging.env`, `e2e/.auth/`).

---

## 16. Cleanup Result

- Forensic/test databases: `medini_replay_current` dropped. ✅
- Temp containers: `medini-redis` removed. ✅
- Temp volumes: 5 anonymous volumes removed. ✅
- Temp networks: `backend_default` (docker-compose managed, not temp). ✅
- Dev DB probe residue: 0 test rows remain. ✅
- Working tree: only intentional changes (3 files). ✅

---

## 17. Files Changed

| File | Change |
|---|---|
| `backend/drizzle/0031_f02_doctor_admin_deny.sql` | NEW — F-02 fix |
| `backend/drizzle/meta/_journal.json` | Added idx 30 |
| `docs/MONITORING.md` | Added incident response runbook |

---

## 18. Commit Hashes

| Commit | Description |
|---|---|
| `340bf2f` | fix(security): close doctor admin db-layer access (F-02) |
| `8751857` | docs(ops): add monitoring incident response runbook (B-2) |

---

## 19. Remaining Operational Prerequisites

- Real staging/production domain + DNS
- Production secrets via secret manager (JWT_SECRET, JWT_REFRESH_SECRET, DATABASE_URL, DATABASE_RUNTIME_URL, REDIS_PASSWORD, POSTGRES_*)
- TLS live verification (runbook §B)
- Monitoring live verification (runbook §D)
- RPO/RTO prod-scale rehearsal
- Boss final sign-off after governance review

---

## 20. Items Intentionally NOT Changed

| Item | Reason |
|---|---|
| F-05 SECURITY DEFINER function | Accepted risk — non-exploitable, required by registration flow |
| `n9_staff_human_all` policy | Too broad to change without breaking legitimate staff management; F-02 adds restrictive policies instead |
| WAHA compose service | Disabled by design; security hardening already applied |
| Any S8/S9/S10/Tier 1–4 controls | Preserved per mandate |

---

## 21. Recommendation for GLM 5.3 Independent Re-Audit

**READY FOR INDEPENDENT GLM 5.3 RE-AUDIT.**

Focus areas for auditor:
1. Verify F-02 fix: `0031_f02_doctor_admin_deny.sql` policies are correct and do not break legitimate HQ/branch_manager/branch_admin access.
2. Verify F-05 accepted risk: `register_staff_with_token` ACL, search_path, and lack of dynamic SQL.
3. Verify migration replay: 0000→0031 deterministic, 302 policies.
4. Verify full test suite: 585/585 ×2.
5. Verify no secrets in repo.

---

**DO NOT claim production ready.**

**READY FOR INDEPENDENT GLM 5.3 RE-AUDIT.**

**HARD STOP.**
