# PHASE 3.1 — LOCKED

**Hardening + QA + Security Isolation**

**Locked:** 9 August 2026

## Verification Evidence

```text
Attack tests (server-side) : 17/17 PASS
Vitest regression          : 19/19 PASS
TypeScript                 : 0 errors
Production build           : PASS
UI smoke (4 roles)         : 47/47 PASS
Branch context smoke       : 6/6 PASS
Session isolation          : PASS
Total QA                   : 89/89 PASS
Canonical branch count     : 14
```

## Leaks Found & Fixed (root-cause, at correct layer)

| # | Leak | Fix |
|---|---|---|
| 1 | Receptionist boleh akses `finance.*` (4 endpoints) | permissionMatrix: finance → hq + branch_manager sahaja |
| 2 | Receptionist/Doctor boleh akses `reports.overview` | reports → permProc; matrix → hq + branch_manager |
| 3 | Receptionist/Doctor boleh akses `marketing.campaigns` | campaigns → permProc("marketing","view") |
| 4 | `dashboard.stats` bocor 7 financial keys kepada Receptionist/Doctor | `stripFinancialFields()` server-side; `safeBase` pada semua return path; BM extras dihadkan kepada branch_manager |
| 5 | Frontend roleGuard/nav benarkan branch_admin ke Finance/Reports | App.tsx + AppLayout navByRole diselaraskan dengan matrix server |
| 6 | Stale "14 branches" (semasa) | Dikunci kepada canonical **14** (bukan 15) |

## Security Guarantees (server-enforced)

```text
Receptionist financial data : BLOCKED — revenueToday, revenueMonth, trend,
                              outstanding, claimsByStatus, momPct, collection7d
                              ABSENT dari server response
Doctor financial data       : BLOCKED (sama)
Manager cross-branch        : BLOCKED (scopeBranch override + get360 FORBIDDEN)
Doctor cross-doctor         : BLOCKED (server forces doctorId=self)
HQ legitimate access        : WORKING
Manager scoped access       : WORKING
```

## Test Assets (permanent)

```text
app/api/phase31.test.ts  — 19 Vitest regression tests (via appRouter.createCaller)
app/smoke-ui.mjs         — 47-check 4-role UI smoke (headless Chrome CDP)
app/smoke-branch.mjs     — 6-check branch context smoke
```

## Deferred (non-blocking)

- Bundle 1.76MB (>500kB warning) — code-splitting, fasa akan datang
- Vite dynamic-import warning pada `connection.ts` — intended (native better-sqlite3)
- 18 npm audit vulnerabilities (dev deps) — review sebelum production hardening

## Status

```text
LOCKED
```
