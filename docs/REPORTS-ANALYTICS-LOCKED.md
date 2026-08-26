# REPORTS & ANALYTICS DOMAIN — LOCKED

**Locked:** 13 August 2026 · **Blueprint Lock Program Phase 7 (Group D: Analytics)**
**Authority:** docs/REPORTS-ANALYTICS-ARCHITECTURE.md
**Master direction:** Reports = READ / INTELLIGENCE LAYER — BUKAN source of truth.

---

## PHASE: 7 — Reports & Analytics Domain Lock
## STATUS: ✅ LOCKED

## OBJECTIVES:
- Lock Reports sebagai read-only intelligence layer
- Lock canonical KPI definitions (satu source — tiada duplicate revenue)
- Lock aggregation dari domain owners (bukan kira sendiri)
- Lock branch scope + RBAC
- Lock Insights AI consumption (AI Manager governed)

## COMPLETED:
- [x] Architecture document (25 gates) — REPORTS-ANALYTICS-ARCHITECTURE.md
- [x] Domain contract
- [x] Canonical KPI registry (RPT_KPIS — 4 KPI, setiap satu ada sourceDomain + formula)
- [x] Read-only disclosure dalam subtitle
- [x] KPI strip: Revenue/Appointment · Chair Utilisation · Recall Rate · No-Show Rate
- [x] Revenue by branch chart (bar, top 6, scope-aware)
- [x] Treatment mix chart (doughnut, dari getTreatmentAnalytics — SAME source)
- [x] Appointment trends (line, 12 weeks, dari getDailySeries — SAME daily records)
- [x] Doctor KPI table (dari getDoctorAnalytics, in-scope sahaja)
- [x] Period pills 7D/30D/90D/12M (Chart re-init safe)
- [x] Branch scope: HQ all (14), Manager own branch
- [x] RBAC: Receptionist/Doctor blocked (permissionMatrix)
- [x] Read-only enforced — tiada write/mutate action
- [x] Insights AI: domain = Reports, read-only capability (execute: [])

## ARCHITECTURE DECISIONS:
- Reports define KPI DEFINITIONS sahaja — facts milik domain owners
- Satu canonical truth: Finance revenue = Dashboard revenue = Reports revenue
- Semua chart aggregate dari helpers yang sama (getRoleAnalytics, getTreatmentAnalytics, getDailySeries, getDoctorAnalytics)
- Chart destroy/re-init safe (Chart.getChart) — tiada memory leak
- Insights AI baca canonical facts — AI Manager governed

## DOMAIN CONTRACT:
- OWNS: ReportDefinition, KpiDefinition (canonical registry), ReportView, ReportFilter, ReportAudit
- SOURCE OF TRUTH: KPI DEFINITIONS sahaja (bukan data facts)
- CONSUMES: finance.invoice_created, appointment.status_changed, clinical.treatment_completed, marketing.campaign_completed, ai.insight_published
- PRODUCES: report.view_opened, report.filter_changed, report.exported, report.kpi_definition_updated
- COMMANDS: view report, filter period, export, view KPI registry
- AUDIT: report views + filters + exports immutable
- AI: READ-ONLY (Insights AI); AI tak boleh ubah KPI definitions

## TESTS:
- R-01..R-25: **25/25 PASS**
- Full suite: **710/710 PASS** (685 + 25)
- Zero JS errors

## RISKS:
- Chart.js in production — DEFER (BI embed/server-side charts)
- Real-time dashboards — DEFER production
- Report scheduling — DEFER production
- Drill-down (branch → treatment) — DEFER v2
- Data warehouse/ETL — DEFER production

## LOCK GATE: ✅ PASS

## NEXT PHASE:
Phase 8 — Cross-Domain Architecture Consolidation (Group E: Enterprise)
