# REPORTS & ANALYTICS DOMAIN — ARCHITECTURE LOCK v1.0

**Status:** LOCKED · **Phase:** Blueprint Lock Program — Phase 7 (Group D: Analytics)
**Date:** 13 August 2026 · **Author:** Neo (Senior Architect)
**Depends on:** Semua domain (Dashboard, Patients, Appointments, Clinical, Marketing, Finance, Operations, WhatsApp Hub, AI Manager, Administration, Settings)
**Master direction:** Reports = READ / INTELLIGENCE LAYER — BUKAN source of truth.

---

## 1. Business Purpose

Reports & Analytics ialah **READ / INTELLIGENCE LAYER** untuk MediniOne.

Ia menjawab: **"Macam mana performance klinik?"** — revenue, appointment, treatment mix, doctor production, recall effectiveness — dalam satu tempat, dengan satu definisi.

**KRITIKAL:** Reports TIDAK menjadi source of truth. Ia baca dari domain owner (Finance own revenue, Appointments own appointment data, dll). Tujuannya hapuskan "Finance Revenue vs Dashboard Revenue vs Reports Revenue" — mesti SATU canonical truth.

## 2. Domain Scope

**DALAM scope:**
- Canonical fact definitions (revenue, appointments, patients, recall)
- Dimensions: branch, time, doctor, treatment
- KPI definitions (single source — consume dari domain locked)
- Aggregation rules (branch scope, period)
- Report views: Overview / Revenue / Clinical / Marketing / Ops (production)
- Chart rendering (prototype: Chart.js)
- Insight consumption (Insights AI baca — AI Manager governed)
- Export (production: CSV/PDF)

**LUAR scope:**
- Revenue computation — Finance (locked)
- Appointment data — Appointments (locked)
- Patient master data — Patients (locked)
- Treatment data — Clinical (locked)
- Campaign metrics — Marketing (locked)
- AI insight generation — AI Manager (locked)
- ANY data mutation — Reports read-only

## 3. Domain Boundary

| Benda | Pemilik | Reports buat apa |
|---|---|---|
| Revenue facts | Finance | Baca + aggregate |
| Appointment facts | Appointments | Baca + aggregate |
| Patient facts | Patients | Baca + aggregate |
| Treatment facts | Clinical | Baca + aggregate |
| Recall/campaign metrics | Marketing | Baca + aggregate |
| Doctor production | Clinical/Appointments | Baca + derive |
| AI insights | AI Manager | Consume (Insights AI) |
| KPI definitions | **Reports (canonical registry)** | Define ONCE, semua consume |

**Rule:** Reports defines KPI DEFINITIONS (satu canonical). Reports does NOT compute raw facts — it aggregates from domain owners.

## 4. Responsibilities

1. Define canonical facts (satu definisi setiap metrik)
2. Aggregate dari domain owners (bukan kira sendiri)
3. Enforce branch scope + RBAC pada setiap report
4. Render report views (chart + table)
5. Serve Insights AI (read-only consumption)
6. Export (production)
7. Track report usage (audit)

## 5. Subdomains / Modules

| Module | Fungsi |
|---|---|
| Overview | KPI strip: revenue/appt, chair utilisation, recall rate, no-show rate |
| Revenue Analytics | Revenue by branch, treatment mix, trend |
| Appointment Analytics | Booked vs completed vs no-show trends |
| Doctor Production | Per-doctor patients + revenue |
| Marketing Analytics | Campaign delivery, recall effectiveness (production) |
| Ops Analytics | Doctor live status stats, lab overdue (production) |
| KPI Registry | Canonical KPI definitions (single source) |
| Insight Feed | Insights AI consumption (governed) |

## 6. Entities

| Entity | Medan utama |
|---|---|
| `ReportDefinition` | id, name, category, canonicalFactId, dimensions[], period[] |
| `KpiDefinition` | id, name, formula, sourceDomain, unit, scopeRules |
| `Dimension` | id, type (branch/time/doctor/treatment), sourceDomain |
| `ReportView` | id, name, layout, widgets[] |
| `ReportFilter` | scope (branch), period (7D/30D/90D/12M) |
| `ReportAudit` | who, view, filter, when |

**Existing helpers:** `getDashboardContext()`, `getRoleAnalytics()`, `branchRows()`, `getTreatmentAnalytics()`, `getDailySeries()`, `getDoctorAnalytics()`, `APPT_OUTCOME` — semua read-only, scope-aware.

## 7. Entity Relationships

```
KpiDefinition (1) ──< (n) ReportWidget  (widget guna KPI)
DomainOwner (Finance/Appointments/...) (1) ──< (n) Fact  [Reports CONSUME, tak own]
ReportView (1) ──< (n) ReportWidget
Dimension (n) ──< (1) ReportFilter
Branch/Time (n) ──< (1) ReportScope
```

## 8. State Machines / Lifecycles

### Report View
```
DRAFT → PUBLISHED (canonical) → (KPI formula change) VERSIONED
```

### Filter State
```
INITIAL (scope dari role) → USER_FILTER (period/branch) → RE-RENDER (safe, Chart destroy/re-init)
```

## 9. Business Rules

1. Reports TIDAK boleh mutate data — read-only (enforced: takde write function).
2. Satu canonical definition per KPI — tiada duplicate "revenue" dalam 3 tempat.
3. Branch scope: HQ semua, Manager own branch sahaja — DIPAKSA dari state layer.
4. Period: 7D/30D/90D/12M — semua aggregate dari SAME source series.
5. Chart re-init safe (Chart.getChart destroy before new) — tiada memory leak.
6. Insights AI baca dari canonical facts — AI Manager governed.
7. Setiap metrik mesti nyatakan source domain — takde "floating number".
8. Doctor production derive dari Clinical/Appointments — bukan kira sendiri.
9. Export (production) — data snapshot, bukan live mutate.
10. Zero JS errors — semua chart destroy/re-init betul.

## 10. RBAC / Permission Model

Ikut permissionMatrix (locked) — module `reports`:

| Action | HQ | Manager | Receptionist | Doctor |
|---|---|---|---|---|
| View reports | ✅ | ✅ own branch | ❌ | ❌ |
| Period filter | ✅ | ✅ | ❌ | ❌ |
| Export | ✅ | ✅ own branch | ❌ | ❌ |
| View KPI definitions | ✅ | ❌ | ❌ | ❌ |
| Insight feed | ✅ | ✅ | ❌ | ❌ |

## 11. Branch / Data Scope

- HQ: all branches (14)
- Manager: own branch sahaja — `getDashboardContext().scope === 'branch'` enforce
- Receptionist/Doctor: TIADA akses reports (permissionMatrix: X)
- Charts & tables scoped melalui `dc.scope` + `scopedBranchId`

## 12. Cross-Domain Dependencies

| Reports perlukan | Reports berikan |
|---|---|
| Finance: revenue facts | Dashboard: KPI canonical definitions |
| Appointments: appointment facts | AI Manager: Insights AI consume canonical facts |
| Patients: patient counts | Marketing: campaign effectiveness view |
| Clinical: treatment mix | Operations: performance context |
| Marketing: recall/campaign metrics | HQ: cross-branch comparison |
| AI Manager: Insights AI (governed) | — |

## 13. Events Produced

- `report.view_opened` (who, view, filter)
- `report.filter_changed` (period/branch)
- `report.exported` (production)
- `report.kpi_definition_updated`

## 14. Events Consumed

- `finance.invoice_created` (revenue fact update)
- `appointment.status_changed` (appointment fact update)
- `clinical.treatment_completed` (treatment mix update)
- `marketing.campaign_completed` (campaign metrics update)
- `ai.insight_published` (Insights AI feed)

## 15. Actions / Commands

| Command | Actor | Gate |
|---|---|---|
| View report | HQ/Manager | RBAC reports module |
| Change period filter | HQ/Manager | RBAC |
| Export report | HQ/Manager | RBAC + audit |
| View KPI registry | HQ | RBAC |
| (production) Schedule report | HQ | RBAC |

## 16. Audit Requirements

Setiap: report view opened (who/view/filter), filter change, export, KPI definition change. Immutable.

## 17. Notification Requirements

- Insight feed update (Insights AI publish) → HQ/Manager notify (optional)
- KPI formula change → notify report consumers (production)

## 18. Search Requirements

- Search report by name/category
- Filter by dimension (branch/doctor/period)
- KPI registry search (production)

## 19. AI Interaction Boundaries

| AI boleh | AI TIDAK boleh |
|---|---|
| READ canonical facts (Insights AI) | Mutate data |
| DRAFT insight summaries (Insights AI draft) | Change KPI definitions (HQ only) |
| RECOMMEND report views | Execute report export (human) |

## 20. Reporting / Analytics Implications

Reports IS the analytics layer — ia consume canonical facts dari semua domain. Semua domain produce facts; Reports aggregate + display. Tiada domain lain "kira sendiri" untuk display.

## 21. UX / Workspace Architecture

Page: **Reports & Analytics** (Business section). Layout:
1. Header: title + scope subtitle (cross-branch / branch) + period pills (7D/30D/90D/12M)
2. KPI strip (4 cards): Revenue/Appointment, Chair Utilisation, Recall Rate, No-Show Rate
3. Row 1: Revenue by Branch (bar, 6 top) + Treatment Mix (doughnut)
4. Row 2: Appointment Trends (line, 12 weeks: booked/completed/no-show) + Doctor KPI (table)
5. All charts scope-aware + period-aware + re-init safe

## 22. Prototype Implementation Requirements

Sedia ada (functional):
- KPIs dari `getRoleAnalytics()` — scope-aware
- Revenue by branch chart — top 6 in-scope branches
- Treatment mix doughnut — from `getTreatmentAnalytics()` (same source)
- Appointment trends line — from `getDailySeries()` (same daily records)
- Doctor KPI table — from `getDoctorAnalytics()` in-scope doctors
- Period pills — `pillFilter` 7D/30D/90D/12M
- Zero JS errors; Chart destroy/re-init safe
- Read-only: takde write/mutate function

BAHARU (P7 formalize):
- Canonical KPI registry (state: RPT_KPIS) — setiap KPI ada sourceDomain
- Read-only disclosure (subtitle/notes: "Read-only — baca dari domain owners")

## 23. Smoke Test Requirements

R-01..R-25:
- Page renders + subtitle scope-aware
- KPI strip 4 cards render
- Revenue chart canvas exists + Chart instance
- Treatment mix chart exists
- Appointment trend chart exists
- Doctor KPI table rows render
- Period filter pills work (7D/30D/90D/12M)
- Branch scope: manager only own branch (state layer)
- HQ sees all branches
- No write functions (read-only enforced)
- Canonical KPI registry: each KPI has sourceDomain
- No duplicate revenue definitions
- Charts re-init safe (filter change no error)
- Insights AI consume path (AI Manager governed)
- Zero JS errors
- Existing 685 tests kekal PASS

## 24. Production Backend Implications

- Schema: report_definitions, kpi_definitions, report_views, report_audit
- Query layer: aggregation service (read from domain tables, cache materialized views)
- Scheduled report generation (cron)
- Export service (CSV/PDF)
- RBAC enforcement server-side
- Insights AI: RAG over canonical facts

## 25. Risks / Open Decisions

| Item | Status |
|---|---|
| Chart.js in production | DEFER — production may use server-side charts/BI embed |
| Real-time dashboards | DEFER — production (websocket/cron refresh) |
| Report scheduling | DEFER — production |
| Drill-down (branch → treatment) | DEFER — v2 |
| Data warehouse/ETL | DEFER — production big data |

---

## DOMAIN CONTRACT — REPORTS & ANALYTICS

**OWNS:** ReportDefinition, KpiDefinition (canonical registry), ReportView, ReportFilter, ReportAudit.
**SOURCE OF TRUTH:** KPI DEFINITIONS sahaja. BUKAN data facts — data facts milik domain owners.
**CONSUMES:** `finance.invoice_created`, `appointment.status_changed`, `clinical.treatment_completed`, `marketing.campaign_completed`, `ai.insight_published`.
**PRODUCES:** `report.view_opened`, `report.filter_changed`, `report.exported`, `report.kpi_definition_updated`.
**COMMANDS:** view report, filter period, export, view KPI registry.
**AUDIT:** report views + filters + exports immutable.
**AI:** READ-ONLY untuk AI (Insights AI). AI tidak boleh ubah KPI definitions.

## LOCK GATE CHECKLIST

- [x] 25 gates documented
- [x] Reports = READ layer — takde mutate
- [x] Canonical KPI definitions (satu source, takde duplicate revenue)
- [x] Branch scope enforced (state layer)
- [x] Aggregation dari domain owners (bukan kira sendiri)
- [x] Chart re-init safe
- [x] Insights AI consume governed
- [x] RBAC ikut matrix
- [x] Production path no-redesign

**LOCK GATE: PASS (architecture)** — prototype + smoke tests sebelum final LOCKED.
