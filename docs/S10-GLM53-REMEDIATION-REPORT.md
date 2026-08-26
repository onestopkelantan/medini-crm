# S10 GLM 5.3 — REMEDIATION REPORT
**Sprint:** S10 GLM 5.3 Remediation (continuation session 2)
**Date:** 2026-08-19
**Branch:** workspace `Medini terbaru`
**Status:** 🟢 READY FOR GLM 5.3 RE-AUDIT

---

## 1. Executive summary

All seven planned work items are complete and verified GREEN on the live dev
stack (PostgreSQL 16, RLS-enforced). The two prior blockers — happy-path 42501
and the missing S10-05 rate limiting — are closed with reproducible test
evidence. No S8/S9 module was modified beyond additive, approved changes. No
GLM call, no production deploy, no legacy `:5000` change, no final push.

## 2. Scope & method

Continuation of the S10 GLM 5.3 remediation. Prior session had already fixed
S10-02 refresh_tokens RLS (migration 0026), proven `register()` green via
isolation probes, and installed `@nestjs/throttler`. This session traced the
remaining happy-path failure, wired the throttler, secured the invitation
link origin, cleaned the S10-touched frontend lint, implemented the
Developer/System-Admin identity, documented first-HQ bootstrap, and ran the
full regression.

Constraints honored: S8/S9 modules locked (additive only), no mock/seed/
SQLite/tRPC in production data flow, argon2 untouched, no speculative changes,
hex-valid UUID test fixtures, `CURRENT-MEDINI-REVIEW.html` untouched.

## 3. Findings fixed (GLM 5.3 mapping)

| Finding | Fix | Evidence |
|---|---|---|
| S10-01 happy-path 42501 | Error traced to a non-register step; register proven green previously; test suite green | `test/integration/s10-happy-path.spec.ts` 2/2 |
| S10-05 rate limiting absent | `AuthThrottlerGuard` + `ThrottlerModule` wired; login 5/min, refresh 10/min, register 3/min per IP | unit 6/6, E2E 3/3 |
| Invite link host injection | Client-supplied `baseUrl` removed; server env `APP_PUBLIC_BASE_URL` only, fail-closed validation | `s10-invite-baseurl.spec.ts` 5/5 |
| Frontend lint (S10 files) | 16 errors in 8 S10 files fixed (`(e:any)` → `errorMessage()` type guard, unused imports, 2 justified eslint-disable) | `npm run lint`: 30 → 14 (remaining = shadcn/seed/Tooth3D baseline); `tsc` clean |
| No developer/system-admin identity | `developer` role: matrix `{}` + `/system-admin/*` + RLS RESTRICTIVE (migration 0027) | `s10-developer-account.spec.ts` 6/6 |
| No first-HQ procedure | `docs/S10-FIRST-HQ-BOOTSTRAP.md` — one-shot, no credentials, dual-control activation | doc reviewed |

## 4. S10-05 rate limiting — design & verification

**Files:** `src/core/auth/auth-throttler.guard.ts` (new), `auth.module.ts`
(ThrottlerModule + APP_GUARD), `auth.controller.ts` (per-route `@Throttle`).

Design decisions:
- **One module-level named throttler** (`auth`, ttl 60s, default limit 1000 =
  no-op). Route decorators override the limit. (Two named throttlers would
  BOTH apply to every decorated route — the minimum would win; discovered via
  unit test and corrected.)
- `shouldSkip()` returns true unless the handler/class carries
  `THROTTLER:LIMIT` metadata → **business routes are never throttled**.
- Tracker = `auth:<ip>`, leftmost `X-Forwarded-For` (trusted proxy) else
  socket address; used only as a bucket key.
- Identical behavior in test and production (no env-based weakening; E2E
  tests that need volume use `@SkipThrottle` explicitly).

Verification (`test/unit/auth-throttler.spec.ts` 6/6;
`test/integration/s10-rate-limit.spec.ts` 3/3, compiled app over real HTTP):
- login: first 5 → 401 (bad creds), 6th/7th → **429**; other IP → 401.
- register: 4th rapid attempt → **429**.
- `/health/live` ×10 rapid → all 200 (not throttled).

## 5. Invitation link origin — design & verification

`administration.controller.ts` no longer accepts any `baseUrl` input (the
parameter is deleted — compile-time guarantee). `AdministrationService.
resolvePublicBaseUrl()` reads `APP_PUBLIC_BASE_URL` (added to
`env.validation.ts`, default `http://localhost:5173`), parses via `URL`,
enforces http/https, returns the normalized origin only. Malformed or
non-http(s) values throw fail-closed. Tests 5/5 including `javascript:`,
`data:`, `ftp:` rejection and path stripping.

## 6. Frontend lint

Baseline 25–30 errors; **16 in S10-touched files fixed**:
`Administration.tsx` (3 any), `Appointments.tsx` (2 any + unused var),
`Login.tsx` (1 any), `Patients.tsx` (1 any + 2 unused imports),
`Register.tsx` (1 any), `Reports.tsx` (3 unused imports),
`useAuth.tsx`/`useBranch.tsx` (react-refresh — resolved with a documented
`eslint-disable-next-line` justification; the context-hook-beside-provider
pattern is intentional). New shared helper `errorMessage()` in `lib/api.ts`
replaces every `(e:any)` error extraction with a type-safe guard.
Remaining 14 errors are the agreed baseline: `db/seed.ts`, `Tooth3D.tsx`, and
`components/ui/*` shadcn legacy — untouched per constraints.
`npx tsc --noEmit` → 0 errors.

## 7. Developer / System Admin account — design & verification

Architecture (approved): the Developer is a **technical-only** identity,
fully separate from Medini HQ Owner, using the **normal auth pipeline**
(Argon2id + JWT + refresh rotation — no magic login, no backdoor).

Three independent deny layers:
1. **Matrix** — `ROLE_DOMAIN_MATRIX.developer = {}` → `can()` fails closed for
   every domain/action (verified across 13 domains × 6 actions × 2 contexts).
2. **PermissionGuard** — every business route carries `@RequirePermission`
   → 403 for developer.
3. **RLS (migration 0027)** — `s10_developer_deny` RESTRICTIVE policy on **63
   business tables** (`USING/WITH CHECK app_role() <> 'developer'`).
   RESTRICTIVE cannot be overridden by PERMISSIVE (S8 N9-1 lesson).

Intentional exclusions: `staff`, `role_assignments` (auth must build the
Principal — no business data), `refresh_tokens` (session lifecycle),
`audit_log`, `domain_events`, `processed_events`, `idempotency_keys`
(infrastructure plumbing; discovered during testing that denying
`refresh_tokens` broke login — policy scope corrected and re-applied).

Technical surface: `SystemAdminModule` (`GET /system-admin/overview|health|
readiness`), gated by AuthGuard + explicit `role === 'developer'` check;
zero business-module imports by construction.

Tests (`s10-developer-account.spec.ts` 6/6): normal login, refresh rotation +
logout revocation, matrix denial (156 combinations), RLS SELECT denial on
`patients` (as `medini_app` + developer GUC), RLS INSERT denial on `tasks`,
hq regression guard.

## 8. Migrations

- **0026_s10_glm53_remediation.sql** — refresh_tokens RLS (prior session).
- **0027_s10_developer_role.sql** — `developer` enum value, relaxed
  `staff_non_hq_requires_branch` (developer is branch-less but not HQ), 63
  RESTRICTIVE deny policies (idempotent: drops stale copies first).
  Journal idx 26 added; CI replay loop updated.

## 9. Test results

| Suite | Result |
|---|---|
| auth-throttler unit | 6/6 |
| s10-rate-limit E2E | 3/3 |
| s10-invite-baseurl | 5/5 |
| s10-developer-account | 6/6 |
| s10-happy-path | 2/2 (prior session) |
| auth lifecycle / T1-T3 regression | 29/29 (prior session) |
| **Full suite (this session)** | **80/80 files · 491 passed · 0 failed · 41 skipped (honest skips)** — 168s |

## 10. Security posture notes

- No new secrets; `APP_PUBLIC_BASE_URL` is config, not a secret.
- Rate limiting is IP-based; per-account lockout remains a future (post-GLM)
  candidate — documented, not speculative.
- The developer role can never become a business Owner/HQ/Branch Manager:
  matrix has no cells, and RLS denies rows even if a code path regresses.
- First-HQ bootstrap: one-shot, out-of-band token, dual-control activation,
  permanently inert afterward (`docs/S10-FIRST-HQ-BOOTSTRAP.md`).

## 11. Regression summary & flaky notes

Full-suite run (this session, 2026-08-19): **80/80 test files, 491 passed,
0 failed, 41 skipped** in 168s on the live dev stack. The 41 skips are the
project's standard *honest skips* (suites that require optional infrastructure
and report so explicitly). The previously documented Windows/tinypool
"Worker exited unexpectedly" flake did NOT occur in this run; it remains an
intermittent environment-level issue (2/3 historical runs fully green), not a
code defect — CI (Linux) is unaffected.

## 12. Files changed (this session)

Backend: `auth.module.ts`, `auth.controller.ts`, `auth-throttler.guard.ts`
(new), `administration.controller.ts`, `administration.service.ts`,
`env.validation.ts`, `architecture.contract.ts`, `schema.ts`,
`health.module.ts`, `app.module.ts`, `system-admin/*` (new module),
`drizzle/0027_s10_developer_role.sql` (new), `drizzle/meta/_journal.json`.
Tests: `auth-throttler.spec.ts`, `s10-rate-limit.spec.ts`,
`s10-invite-baseurl.spec.ts`, `s10-developer-account.spec.ts` (all new).
Frontend: `lib/api.ts` (+`errorMessage`), 6 pages, 2 hooks.
CI: `.github/workflows/ci.yml` (0027 in replay loop).
Docs: this report, `S10-FIRST-HQ-BOOTSTRAP.md`.

## 13. What was NOT done (per hard-stop constraints)

No GLM call. No production deploy/migration/DNS cutover. Legacy `:5000` left
running. No final GitHub push/lock — checkpoint commit only.
`CURRENT-MEDINI-REVIEW.html` untouched.

## 14. Risks & follow-ups

- **tinypool worker-exit flake** on Windows: environment-level, documented
  with evidence; CI (Linux) unaffected.
- **Per-account (not just per-IP) login throttling**: future hardening
  candidate after GLM re-audit.
- **bootstrap-hq.ts scripts**: to be implemented only when first production
  deployment is scheduled (procedure fully specified).
- **Frontend shadcn baseline lint** (14 errors): legacy, out of scope.

## 15. Verdict

All GLM 5.3 findings in scope are remediated with reproducible, live-DB test
evidence. **🟢 READY FOR GLM 5.3 RE-AUDIT.**

## 16. Appendix — key commands

```bash
# full backend suite
cd backend && set -a && . ./.env && set +a && npm test
# targeted
npx vitest run test/integration/s10-rate-limit.spec.ts
npx vitest run test/integration/s10-developer-account.spec.ts
npx vitest run test/integration/s10-invite-baseurl.spec.ts
npx vitest run test/unit/auth-throttler.spec.ts
# policies
docker exec -i backend-postgres-1 psql -U medini -d medini_dev \
  -c "SELECT tablename FROM pg_policies WHERE policyname='s10_developer_deny';"
# frontend
cd app && npm run lint && npx tsc --noEmit
```
