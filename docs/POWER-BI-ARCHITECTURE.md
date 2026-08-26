# Medini Power BI Architecture (S9-T6)

**Status:** Foundation established (PBIP + TMDL, validated). **Not yet published** — Power BI Service workspace, gateway, and scheduled refresh are Sprint 10 scope.

## Architecture

```
Medini CRM PostgreSQL (production)
        │  PostgreSQL.Database(PgServer, PgDatabase)   ← parameters, no credentials in repo
        ▼
MediniBI.SemanticModel  (Import mode, star schema)
        │  DimDate (CALENDARAUTO) · DimBranch · DimDoctor · DimTreatmentCategory
        │  FactRevenue (confirmed only) · FactAppointments · FactRecallCases · FactTreatmentItems
        ▼
_Measures  (canonical DAX — 1:1 with RPT_KPIS)
        ▼
MediniBI.Report  (PBIR skeleton — Executive Overview page)
```

## Canonical truth parity (HARD RULE)

| DAX measure | RPT_KPIS key | sourceDomain | Formula parity |
|---|---|---|---|
| `Total Revenue` | `revenue` | finance | SUM(FactRevenue[Amount]) = sale_records confirmed |
| `Revenue per Appointment` | `revenue_per_appointment` | finance | DIVIDE(revenue, completed) — BLANK when 0 |
| `No-Show Rate %` | `no_show_rate` | appointments | no-show / (completed + no-show) |
| `Recall Rate %` | `recall_rate` | marketing | completed / all due in period |

`model.tmdl` carries `MediniBI_CanonicalTruth` annotation: **no parallel revenue definitions may be added**. If the registry formula changes, the DAX measure must change in the same PR.

## Files

- `MediniBI.pbip` — project entry point
- `MediniBI.SemanticModel/definition/` — database, model, expressions (PgServer/PgDatabase params + shared source), 9 table TMDLs, relationships, roles
- `MediniBI.Report/` — .platform, definition.pbir (byPath binding), report.json, pages/

## Validation evidence (S9)

- `te validate` → **No validation errors found**
- `tmdl-validate` → **0 errors, 0 warnings**
- Hook validators (PBIR/binding/pages) → **all exit 0**
- `te bpa run` → 17 findings: 5 "Error" = documented TE3 built-in exceptions (additive facts `Amount`/`Quantity` keep `summarizeBy: sum` — they ARE the measures' source; DimDate calculated-column false-positives); 12 Warning = description/formatString housekeeping (accepted). Exceptions recorded in `MediniBI_BPA_Exceptions` annotation.

## Sprint 10 activation checklist

1. Install Power BI Desktop → open `MediniBI.pbip`
2. Set PgServer/PgDatabase parameters → credentials via Desktop credential store (never in repo)
3. Refresh → verify row counts vs `SELECT count(*)` on each source table
4. Publish to Service workspace → configure gateway (on-prem data gateway for self-hosted PG)
5. Wire RLS: replace role placeholder with `USERPRINCIPALNAME()` → staff→branch mapping
6. Scheduled refresh (nightly; off-peak)
