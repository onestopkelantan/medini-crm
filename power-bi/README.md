# MediniBI — Power BI Project (S9-T6)

Open `MediniBI.pbip` in Power BI Desktop (≥ Nov 2024, PBIP + TMDL support).

## Layout

| Path | What |
|---|---|
| `MediniBI.SemanticModel/definition/` | TMDL star schema — 4 dims + 4 facts + `_Measures` (canonical KPI DAX) |
| `MediniBI.Report/` | PBIR skeleton bound byPath to the model |

## Ground rules

1. **Canonical truth:** KPI measures mirror the backend `kpi_definitions` registry (RPT_KPIS). Never add a second revenue/no-show/recall definition — extend the existing measure.
2. **No credentials in repo.** Connection uses `PgServer`/`PgDatabase` parameters; credentials live in the Desktop/Service credential store.
3. **Validate before commit:** `te validate <model>/definition` + `te bpa run` + hook validators must be green.
4. Facts are Import-mode and read from canonical tables only (sale_records, appointments, recall_cases, treatment_plan_items ⋈ treatment_plans). RLS/scope for production serving is enforced at the CRM backend today; Service-side RLS activates in S10.

See `docs/POWER-BI-ARCHITECTURE.md` for the full architecture + S10 activation checklist.
