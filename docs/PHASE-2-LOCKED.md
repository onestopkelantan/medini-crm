# PHASE 2 — LOCKED

**Data Consistency & Analytics Engine**

## Scope
- Shared Analytics Engine — satu canonical engine, role-aware query di atasnya
- Pattern: `getRoleAnalytics()` → `getAnalytics()` (bukan per-role analytics functions)
- `dashboard.stats`, `reports.overview` sebagai centralized procedures
- Phase 2 formulas: revenue, appointments, patients, conversion, reconciliation, HQ/branch aggregation, period calculations

## Status
```text
LOCKED
```

## Key Guarantees
- ONE analytics truth + many authorized views
- Tiada `managerAnalytics()` / `doctorAnalytics()` sebagai business truth berasingan
- Role-specific functions hanya scope/presentation adapters

## Evidence
- Phase 3.1 regression E1–E3: HQ & Manager legitimate analytics access intact; HQ multi-branch aggregation verified (multi-branch patient set > 1)
- Phase 3.1 fixes tidak mengubah sebarang formula Phase 2 — hanya tambah authorization layer di atasnya
