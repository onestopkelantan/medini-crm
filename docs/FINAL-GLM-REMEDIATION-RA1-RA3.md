# FINAL GLM REMEDIATION — RA-1 / RA-2 / RA-3

**Date:** 2026-08-23 · **Baseline:** `5eb40fd` (immutable ancestor, recoverable) · **HEAD before:** `6c6a08d` · **HEAD after:** (see commits below)

---

## 1. Executive Summary

Three findings from the GLM 5.3 independent random forensic re-audit were reproduced,
root-caused and remediated with minimal, auditable changes:

- **RA-1 (CI schema-drift):** FIXED — CI migrate step was a hardcoded list that
  silently stopped at migration 0028 while the schema had reached 0031. Now
  journal-driven with drift detection + schema fingerprint gate.
- **RA-2 (frontend CI gate):** FIXED — no frontend CI job existed at all. Added a
  mandatory install → typecheck → lint → build job with zero bypass.
- **RA-3 (invalid UUID → 400):** FIXED — malformed UUID path params returned 500
  (pg `invalid input syntax`). Now 400 via `ParseUUIDPipe` on all 16 controllers.

No security control weakened. No test removed. No rate limit changed. Suite grew
585 → 595 (10 new RA tests), all green ×2 consecutive.

## 2. GLM Findings Reproduced

| Finding | Reproduction |
|---|---|
| RA-1 | `.github/workflows/ci.yml` migrate step listed 28 literal filenames ending at `0028_s10_d01_staff_deny.sql` — migrations 0029/0030/0031 would NEVER run in CI |
| RA-2 | `grep frontend .github/workflows/ci.yml` → zero matches; no `app/**` trigger; no typecheck/lint/build enforcement for the SPA |
| RA-3 | Live server test: `GET /api/v1/admin/staff/xyz123` → `500 INTERNAL_ERROR`; `GET .../123e4567-e89b-12d3-a456-426614174000` (valid, nonexistent) → 404 (correct) |

## 3. RA-1 Root Cause

CI's "Migrate" step enumerated migration files by hand. Hand-maintained lists drift:
Tier 2 added 0029/0030 and the hardening pass added 0031, but nobody updated the CI
list — so CI had been validating against a 0028-shaped schema for three migrations.
The local replay fixture had the same class of bug earlier (fixed in Tier 4, `278b428`).

## 4. RA-1 Implementation

- CI migrate step now reads `drizzle/meta/_journal.json` via `jq`, sorts by `idx`,
  cross-checks tags 1:1 against `drizzle/0*.sql` files, and fails loudly on any
  count/order mismatch. No hardcoded filenames remain.
- New "Schema fingerprint" step asserts the freshly replayed CI DB matches the
  current shape: `tables=70`, `policies=302`, `rls_enabled=70` — drift = red CI.
- New regression spec `backend/test/integration/ra1-schema-drift.spec.ts` (5 tests):
  journal contiguity, journal==files, range reaches 0031, fixture has no hardcoded
  total, fixture never silently reuses a partial DB.

## 5. RA-1 Validation

- Local clean replay 0000→0031: **OK** (all 31 files apply, zero errors).
- Full fingerprint replay == dev **EXACT**: 70 tables · 989 columns · 269 indexes ·
  823 constraints · 56 enums · 6 functions · 70 RLS-enabled tables · 302 policies.
- **Policy definitions md5-identical** between replay and dev (`e5a88b02…`).
- Journal-vs-files local simulation: 31==31, order match.
- Spec: 5/5 PASS.

## 6. RA-2 Root Cause

CI only ever had a backend job. Frontend quality was enforced only locally —
nothing stopped a broken SPA from merging green.

## 7. RA-2 Implementation

New `frontend` job in `.github/workflows/ci.yml`:
`actions/checkout` → `setup-node` (npm cache) → `npm ci` → `npx tsc --noEmit` →
`npm run lint` → `npm run build`. Triggers extended with `app/**` for push and PR.
No `continue-on-error`, no `|| true`, no ignored exit codes — any step failure = red CI.
Backend job byte-identical in behaviour.

## 8. RA-2 Validation

- `js-yaml` parse: valid.
- `grep -E "continue-on-error|\|\| true"` → zero matches.
- Local equivalents all green: FE lint 0, FE tsc 0, FE build PASS (`built in 19.68s`).
- Backend CI steps unchanged (lint/typecheck/build/migrate/seed/test intact).

## 9. RA-3 Root Cause

Controllers declared `@Param('id') id: string` with no pipe. A malformed UUID flowed
through the service into a Drizzle query, where PostgreSQL raised
`invalid input syntax for type uuid` (SQLSTATE 22P02) — an unhandled error that the
global filter correctly mapped to 500. But a malformed client-supplied identifier is
a **client** error (400), not a server fault.

## 10. RA-3 Implementation

`ParseUUIDPipe` added to every `@Param('id')` across all 16 controllers
(administration, ai-manager, appointments, clinical-ops, consents, encounters, notes,
plans, finance, finance-integration, marketing, operations, patients, insurances,
panels, whatsapp). The pipe rejects malformed UUIDs at the framework layer — before
any service/DB work — with Nest's standard 400. No controller logic, service, or
authorization path was touched; real DB errors still surface as 500 (not masked).

New spec `backend/test/integration/ra3-uuid-400.spec.ts` (5 tests, compiled-app E2E):
malformed→400, empty-segment behaviour, nonexistent→404, own-org→200, cross-org→404.

## 11. RA-3 Validation (actual observed behaviour)

| Request | Before | After |
|---|---|---|
| `GET /admin/staff/xyz123` | **500** INTERNAL_ERROR | **400** BAD_REQUEST |
| `GET /admin/staff/123e4567-…-426614174000` (valid, nonexistent) | 404 NOT_FOUND | 404 NOT_FOUND (unchanged) |
| `GET /admin/staff/1e1d639b-…` (valid, own org) | 200 | 200 (unchanged) |
| `GET /admin/staff/054c8ac4-…` (valid, other org) | 404 (RLS) | 404 (unchanged — denial preserved) |

## 12. Security Regression

Targeted: refresh-token matrix 11/11 · developer/systemadmin + D-01 deny 14/14 ·
rate-limit 4/4 · administration (last-HQ, role versioning, N7-1/N7-2 concurrency) 12/12.
Live DB spot-checks post-change: doctor own-org staff=1, cross-org=0, doctor INSERT
hq → DENIED by `f02_staff_doctor_insert_hq_deny` (F-02 intact). RA-3 pipes sit BEFORE
authorization — they only reject malformed input, they do not grant anything.

## 13. Full Test Results

- Backend: **595/595 PASS ×2 consecutive** (91 files; delta +10 = RA-1 ×5 + RA-3 ×5, documented)
- Backend lint 0/0 · tsc 0 · build PASS
- Frontend lint 0 · tsc 0 · build PASS
- (Environment note: intermittent Windows vitest worker-fork crash ~1 in 3 runs,
  0 test failures — two consecutive clean runs recorded. CI Linux unaffected.)

## 14. Migration Replay Results

0000→0031 deterministic from zero; journal==files; fingerprint == dev exact;
policy definitions md5-identical. **NO DATABASE MIGRATION REQUIRED** for RA-1/2/3
(no schema change — RA fixes are CI/test/code-level only).

## 15. CI Validation

- Schema replay is journal-driven and current (0031), drift = red.
- Stale replay cannot pass silently (count mismatch → DROP/rebuild; fingerprint gate).
- Frontend lint/typecheck/build mandatory, no bypass patterns.
- Compose: `docker compose -f docker-compose.prod.yml config --quiet` → VALID.
- Secret scan: CLEAN (only demo test credentials in specs; no real secrets).

## 16. Before/After Behaviour

| Surface | Before | After |
|---|---|---|
| CI migrate | Hardcoded 28 files (stale) | Journal-driven 31 + drift checks |
| CI schema gate | None | Fingerprint asserts (tables/policies/RLS) |
| Frontend in CI | Not run at all | Mandatory typecheck+lint+build |
| Malformed UUID | 500 | 400 |

## 17. Files Changed

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | RA-1 journal-driven migrate + fingerprint gate; RA-2 frontend job; `app/**` triggers |
| 16 × `backend/src/modules/*/presentation/*.controller.ts` | RA-3 `ParseUUIDPipe` on `:id` params |
| `backend/test/integration/ra1-schema-drift.spec.ts` | NEW — 5 tests |
| `backend/test/integration/ra3-uuid-400.spec.ts` | NEW — 5 tests |
| `docs/FINAL-GLM-REMEDIATION-RA1-RA3.md` | NEW — this report |

## 18. Commit Hashes

| Commit | Description |
|---|---|
| `fa4ce61` | fix(api): map invalid UUID path params to 400 (RA-3) |
| `d0131fb` | fix(ci): prevent schema replay drift + enforce frontend gate (RA-1, RA-2) |
| (final) | docs(audit): document RA-1 RA-2 RA-3 remediation |

## 19. Residual Risks

- Fingerprint counts (70/302/70) are explicit by design — a future migration must
  update them deliberately (that IS the gate). Documented in the workflow comments.
- Windows-only vitest worker-fork flake (environment; 0 failures; CI unaffected).
- F-05 SECURITY DEFINER remains ACCEPTED RISK from the hardening pass (unchanged).

## 20. Remaining Known Findings

None new. Previously accepted: F-05 (documented, non-exploitable). Nothing hidden.

---

**GOVERNANCE:** Baseline `5eb40fd` intact and recoverable · previous audit reports
untouched · no push · no deploy · working tree clean after final commit.
