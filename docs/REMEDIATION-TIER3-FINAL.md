# MEDINI CRM — REMEDIATION TIER 3 (APPLICATION / CODE QUALITY + DEPENDENCY SECURITY) — FINAL REPORT

**Immutable baseline:** `5eb40fd7707345b83e0fb5d0987a2f6f9cf1f169` — NOT altered/amended/reset (recoverable).
**Tier 2 HEAD:** `e3bb2da` · **Tier 3 remediation HEAD:** `d7cdd79` (4 commits on top of Tier 2).
**Mod:** REMEDIATION ONLY. **Tiada push. Tiada deploy. Tiada history rewrite. Tiada migration 0031.**
**Test count:** Tier 2 585 → **585** (no change in count; 2 flaky-then-pass integration specs were re-verified green). **585/585 PASS ×2.**

---

## 1. Executive Summary

Tier 3 membersihkan hutang kualiti kod + dependency security tanpa melemahkan sebarang kawalan keselamatan. Backend lint dan frontend lint kini **0 errors**; dependency production kekal **0 vulnerabilities**; dev vulnerabilities dikurangkan **24 → 4** (semua moderate, dev-only, breaking-major barrier didokumenkan); test environment kini **deterministik** (tiada lagi manual env sourcing); full suite **PASS dua kali berturut**.

| Item | Before | After |
|---|---|---|
| Backend lint | 7 errors / 17 warnings | **0 / 0** |
| Frontend lint | 14 errors | **0** |
| Backend prod vulnerabilities | 0 | **0** (unchanged) |
| Backend dev vulnerabilities | 24 (8 high, 2 critical) | **4 (moderate, dev-only)** |
| Frontend prod vulnerabilities | 0 | **0** |
| Test env determinism | manual `set -a && . ./.env` | **automatic (globalSetup)** |
| Migration replay 0000→0030 | 70/296 | **70/296 = dev (no drift)** |

## 2. Tier 2 Starting State
HEAD `e3bb2da`, branch `main`, clean working tree, 585/585 PASS, backend tsc 0, builds PASS, replay 0000→0030 deterministic, S8/S9/S10 controls active, no push/deploy.

## 3. Findings Addressed
| Finding | Status |
|---|---|
| Backend lint (7 errors, pre-existing baseline) | ✅ FIXED (0 errors, 0 warnings) |
| Frontend lint (14 errors) | ✅ FIXED (0 errors) |
| Backend devDep vulns (24) | ✅ REDUCED to 4 (0 high/critical); prod 0 |
| Test env non-determinism (manual .env) | ✅ FIXED (globalSetup) |

## 4. Backend Lint Before/After
- **Before:** 7 errors + 17 warnings (`no-unused-vars` ×6, `no-unsafe-function-type` ×1, `no-explicit-any` ×17).
- **Fixes:** removed unused imports (`isNotNull`,`sql`,`ThrottlerGuard`,`res`,`stderr`); typed `resolveClientIp`/`getTracker` request shape (no `any`); typed `makeContext` handler; targeted, justified `eslint-disable-line` for genuinely-dynamic test payloads (JSON responses, row shapes, cross-test `globalThis` stash). **No rule weakened globally; no blanket disables.**
- **After:** **0 errors / 0 warnings** (`--max-warnings=0` passes).

## 5. Frontend Lint Before/After
- **Before:** 14 errors (9 `react-refresh/only-export-components` in shadcn `ui/*`, Tooth3D `set-state-in-effect`, sidebar `purity`, seed.ts `no-explicit-any`×3 + `no-unused-vars` + `prefer-const`).
- **Fixes:** seed.ts prefer-const + destructure cleanup + targeted disable; Tooth3D/sidebar targeted disables (one-time WebGL error fallback / memoized random skeleton width); shadcn `ui/*` file-level `react-refresh/only-export-components` disable with justification (co-located cva variants = standard shadcn pattern, dev-HMR-only, no production impact).
- **After:** **0 errors**. Behaviour preserved; no broad rule disabling.

## 6. Dependency Audit Before/After
| | Before | After |
|---|---|---|
| Backend prod (`--omit=dev`) | 0 | **0** |
| Backend all | 24 (8 high, 2 critical) | **4 (moderate)** |
| Frontend prod | 0 | **0** |
| Frontend all | 4 (moderate) | **4 (moderate)** |

## 7. Dependency Classification
- **Eliminated (targeted dev upgrades):** vitest ^2→^4.1.11 (2 critical chain), @nestjs/cli ^10→^11.0.24 + @nestjs/schematics ^11 (glob/picomatch/tmp/ajv/inquirer/external-editor/webpack/angular-devkit), eslint-plugin-boundaries ^5→^7.2.0 (@boundaries/elements/js-yaml/handlebars).
- **Remaining 4 (moderate, dev-only, transitive):** `drizzle-kit@0.31.10` → `esbuild ≤0.24.2` via `@esbuild-kit/*`. The ONLY npm-suggested fix downgrades to `drizzle-kit@0.18.1` — **rejected as unsafe/regressive** (major version backward). drizzle-kit is **not** wired into any runtime/CI migrate path (CI applies migrations via `psql` directly), so residual risk is dev-tooling-only. **Not shipped in the production image** (`Dockerfile.prod --omit=dev`). Documented as accepted dev-only residual.

## 8. Test Infrastructure Changes
- **NEW `test/global-setup.ts`** — loads `backend/.env` into `process.env` before any spec (never overrides already-set vars, so CI's explicit env wins); strips quotes; safe.
- **`vitest.config.ts`** — wired `globalSetup: ['test/global-setup.ts']`.
- **Result:** suite now runs deterministically from `npm test` alone — **no manual `set -a && . ./.env && set +a`**. No secrets in config. Two consecutive full runs both 585/585.

## 9. Security Regression (Tier 3 final vs Tier 2)
| Control | Proof |
|---|---|
| RLS (296 policies) | ✅ unchanged (replay = dev) |
| Org isolation (T2-A) | ✅ hq non-canonical org → 5 staff (own only) |
| Developer deny (S10) | ✅ developer → 0 staff |
| No-GUC login path | ✅ 11 staff (intact) |
| SECURITY DEFINER search_path pin (T2-C) | ✅ `search_path=pg_catalog,public` |
| RBAC / JWT / refresh / registration / rate-limit / trust-proxy | ✅ full suite green (no regression) |
| Secret handling | ✅ scan clean |
| Prod dependency vulnerabilities | ✅ 0 (not reintroduced) |

**No RLS policy weakened; no RBAC expanded; no JWT trust expanded; no authz bypass; no secrets exposed; no S8/S9/S10 regression; no prod vuln reintroduced.**

## 10. Migration Replay
`0000→0030` clean on fresh DB: **70 tables / 296 policies = dev**. No drift. Historical migrations 0000–0028 untouched; 0029/0030 (Tier 2) unchanged. **No migration 0031 created** (not required).

## 11. Full Test Results
- **Run 1:** 89 files / **585/585 PASS** (0 failed)
- **Run 2:** 89 files / **585/585 PASS** (0 failed)
- Note: during one earlier run, two integration specs (finance bukku hq-only, appointments double-booking) flaked under parallel timing, then both **passed in isolation and in both clean full runs** — intermittent timing, not a code defect. No security test skipped due to missing env.

## 12. Build Results
- Backend `tsc --noEmit`: **0** · `nest build`: **PASS** · `eslint`: **0**
- Frontend `tsc --noEmit`: **0** · `vite build`: **PASS** · `eslint`: **0**

## 13. Remaining Findings
| Item | Class |
|---|---|
| 4 backend + 4 frontend drizzle-kit→esbuild moderate dev vulns | ACCEPTED dev-only residual (fix = unsafe downgrade; not in prod image/CI) |
| Frontend chunk-size advisory | informational (pre-existing) |

## 14. Residual Risk
Low. The only residual is the drizzle-kit/esbuild **dev-only** transitive advisory — no production runtime exposure, no CI exposure (migrations applied via psql), and the suggested fix is a regressive downgrade. Accept for now; revisit when a safe non-major drizzle-kit patch lands.

## 15. Files Changed
- backend: `src/core/auth/auth-throttler.guard.ts`, `src/core/auth/staff-registration.service.ts`, `test/unit/auth-throttler.spec.ts`, `test/integration/s10-developer-systemadmin.spec.ts`, `test/integration/s10-rate-limit.spec.ts`, `test/integration/s10-registration-replay.spec.ts`, `test/global-setup.ts` (NEW), `vitest.config.ts`, `package.json`, `package-lock.json`
- frontend: `db/seed.ts`, `src/components/Tooth3D.tsx`, `src/components/ui/{badge,button,button-group,form,navigation-menu,sidebar,toggle}.tsx`, `package.json`, `package-lock.json`

## 16. Commits Created (4, on top of Tier 2 `e3bb2da`)
| Commit | Kandungan |
|---|---|
| `e2770ef` | STEP 2 backend lint → 0/0 |
| `d182357` | STEP 3 frontend lint → 0 |
| `39c64ce` | STEP 4 dependency security (backend 24→4, prod 0) |
| `d7cdd79` | STEP 5 deterministic test env (globalSetup) |

## 17. Working Tree State
**CLEAN** (0 uncommitted changes at report time).

## 18. Git Push Status
**NOT DONE.** No push, no force-push, no history rewrite.

## 19. Deployment Status
**NOT DONE.** No staging, no production deployment.

## 20. Tier 3 Verdict
### 🟢 COMPLETE
All acceptance criteria met: backend lint 0, frontend lint 0, backend tsc 0, frontend tsc 0, both builds PASS, prod vulnerabilities 0, dev vulnerabilities classified (4 dev-only residual documented), lockfile consistent, test env deterministic, full suite PASS ×2, migration replay 0000→0030 PASS (70/296=dev), no RLS/RBAC/auth/S8-S10 regression, secret scan PASS, compose validation PASS, no forensic DB residue, working tree clean, no unauthorized migration changes, no push, no deploy.

**The system remains under governance. NOT production-ready. HARD STOP after Tier 3 — Tier 4 not started.**
