# PHASE 1 — LOCKED

**Branch Context & Dashboard Foundation Architecture**

## Scope
- Dashboard shell (`AppLayout.tsx`)
- Global branch context (`useBranch.tsx`) — satu authoritative `branchId`, bukan state berasingan setiap widget
- Shared data layer (tRPC + Drizzle + SQLite)
- Dashboard widgets & KPI/charts asas
- Page integration (16 pages routing)

## Status
```text
LOCKED
```

## Key Guarantees
- Bila branch berubah, semua branch-aware component ikut context yang sama
- HQ: branch selector (All / 1–14). Non-HQ: locked ke own branch
- Satu data truth melalui shared tRPC procedures

## Evidence
- Phase 3.1 regression: branch context smoke 6/6 PASS (selector present, 14 branches, switch works, non-HQ locked, no stale state)
