# S9 — DISCOVERY & ARCHITECTURE REPORT

**Sprint:** 9 — Reports/Analytics + Observability (Backend)
**Phase:** 1 — Discovery & Architecture (READ-ONLY)
**Author:** Neo (Lead Backend Engineer & Architecture Executor)
**Date:** 18 August 2026
**Baseline:** S8 LOCKED — commit `c0ac25c762c686bb594498b3ec9754c03ea16161` (`main`, CI green, 461/461 tests, 0 failed, 0 skipped)
**Status of this document:** Discovery only. **No implementation performed. No source code, migration, schema, API, or test modified. No commit. No push. No deploy.**

---

## 1. Executive Summary

S9 delivers two capabilities on top of the locked S8 baseline:

1. **Reports/Analytics backend** — a server-side **READ / INTELLIGENCE LAYER** implementing the locked Phase-7 frontend blueprint (`REPORTS-ANALYTICS-LOCKED.md`, 25/25 prototype gates PASS): canonical KPI registry (`RPT_KPIS` — 4 KPIs), dashboard/report read endpoints with period pills (7D/30D/90D/12M), branch scope (HQ all 14 / Manager own branch), and RBAC (Receptionist/Doctor blocked).
2. **Observability** — Prometheus-compatible `/metrics` endpoint, request/worker instrumentation, and alerting hooks, building on the already-installed `nestjs-pino` structured logging and the existing `/health/*` module.

**Key discovery findings:**

- The **read-port pattern already exists and is proven**: `FinanceReadPort`, `AppointmentsReadPort`, `PatientsReadPort`, `ClinicalReadPort` are sanctioned cross-module READ-ONLY boundaries operating inside the caller's `runAs()` RLS transaction. S9 Reports **extends these ports** (additive read methods) rather than inventing a parallel query layer — this preserves the "satu canonical truth" rule mechanically.
- The **RBAC matrix already contains the `reports` domain** in `architecture.contract.ts` `ROLE_DOMAIN_MATRIX` (hq=`all`, branch_manager=`branch`, branch_admin/receptionist=`NONE`, doctor=`'own'`). ⚠️ **One governance ambiguity found** — see §22 Q1: the locked Reports doc says "Doctor ❌ blocked" but the canonical matrix grants doctor `view` with `own` scope. The matrix (S6-amended, contract-tested) is the authoritative security artifact; the deviation is flagged for governance decision, NOT silently resolved.
- **Queue name `reports-refresh` already exists** in `QUEUE_NAMES` (S8) — reserved for exactly this sprint's refresh pattern.
- **No observability metrics library is installed** (`prom-client`/OpenTelemetry absent). T-observability will require adding `prom-client` (Prometheus de-facto standard for Node) — a new dependency requiring governance approval.
- The **KPI set is feasible against existing schema**: revenue (`sale_records` status='confirmed'), appointment counts/no-show (`appointments.status`), recall rate (`recall_cases.status`), per-branch revenue (`sale_records.branchId`), doctor production (`commission_ledger.grossRevenue` + appointments), treatment mix (`sale_records`/`treatment_records` linkage — needs one design decision, §22 Q3). **Chair Utilisation is NOT computable** from current schema (no chair/resource entity) — the locked prototype itself deferred real chair data; recommendation: omit or stub-honest (§22 Q2).

**Proposed Phase-2 breakdown: 5 tasks** (T1 KPI registry + read-port extensions → T2 Reports module endpoints → T3 Observability → T4 tests+migration+CI → T5 hardening gate), mirroring the proven S8 cadence.

**Verdict: `READY FOR CHATGPT GOVERNANCE REVIEW`** — with 4 open questions that need governance decisions but do not block Phase 2 planning.

---

## 2. S9 Objective

Per `PRODUCTION-BACKEND-BLUEPRINT-v1.0.md` §28 (line 539):

> **Sprint 9 — Reports/Analytics + Observability:** RPT_KPIS, dashboards, metrics/tracing/alerting.

Decomposed into two objectives:

**O1 — Reports/Analytics backend.** Bring the Phase-7 locked frontend blueprint (which ran on prototype in-browser state) to the production backend as a **read-only intelligence layer**: canonical KPI definitions owned by Reports, facts read from domain owners through sanctioned read ports, branch-scope + RBAC enforced server-side (RLS backstop), report usage audited.

**O2 — Observability.** Make the system measurable in production: a Prometheus-compatible metrics endpoint (HTTP request rates/latencies, worker job counters, DB pool stats), tracing wiring consistent with the existing correlation-ID infrastructure, and documented alerting hooks (threshold rules over the exported metrics). Explicitly NOT a full APM platform — KISS per ADR-007/ADR-008 (single VPS, no over-engineering).

**Relationship to S8:** S8 delivered the integration runtime (outbox, workers, RLS hardening, system-worker identity). S9 consumes that runtime read-side (metrics about workers/queues) and extends the read-port layer. S8 runtime is **immutable** — S9 does not touch workers, outbox, or migrations 0017–0023 except purely additive new files.

---

## 3. Blueprint Reference

| Document | Role | Key sections used |
|---|---|---|
| `docs/PRODUCTION-BACKEND-BLUEPRINT-v1.0.md` | Master blueprint | §28 line 539 (S9 definition); §29 Risk Register (R2 scope leak, R7 over-engineering); §30 ADR-003 (server authz + RLS), ADR-007/008 (KISS infra); §32 consistency audit ("read-only domains expose only GET") |
| `docs/REPORTS-ANALYTICS-LOCKED.md` | Phase-7 LOCK record | 25 gates; canonical KPI registry (4 KPIs); period pills; RBAC table; DEFER list (Chart.js prod, real-time, scheduling, drill-down, ETL) |
| `docs/REPORTS-ANALYTICS-ARCHITECTURE.md` | Full authority doc | §1–25: business purpose, domain boundary (facts owned by domain owners), entities (ReportDefinition/KpiDefinition/ReportView/ReportFilter/ReportAudit), RBAC matrix, branch scope, events, audit requirements, §24 Production Backend Implications (schema: report_definitions, kpi_definitions, report_views, report_audit; aggregation service; RBAC server-side) |
| S8 lock baseline (repo state) | Current truth | commit `c0ac25c`, migrations 0000–0023, 461 tests, CI loop |

**Blueprint §24 — Production Backend Implications (authority for S9 DB design):**
- Schema: `report_definitions`, `kpi_definitions`, `report_views`, `report_audit`
- Query layer: aggregation service (read from domain tables, cache materialized views)
- Scheduled report generation (cron) — **DEFERRED** per LOCKED.md risks
- Export service (CSV/PDF) — **DEFERRED** per LOCKED.md risks ("Export (production)" listed but RISKS defer scheduling; export listed in domain contract COMMANDS but no production gate demand — see §22 Q4)
- RBAC enforcement server-side

---

## 4. Current S8 Locked Baseline

Verified directly against the repository (not memory):

| Item | Evidence |
|---|---|
| HEAD commit | `c0ac25c feat(crm): complete and lock sprint 8 integration runtime` (git log) |
| Working tree | Clean at discovery start (`git status --short` empty) |
| Repo root | `C:\Users\User\Desktop\Medini terbaru` (git toplevel confirmed) |
| Migrations | `drizzle/0000…0023` (23 files); journal contiguous; CI applies all 23 in order via manual-psql loop |
| Test baseline | 461/461 PASS, 0 skipped (S8 lock record); 36 integration specs + 31 unit/contract/architecture specs |
| CI | `.github/workflows/ci.yml` — lint → typecheck → build → migrate (23 files) → seed → `npm test` |
| Frontend lock | `CURRENT-MEDINI-REVIEW.html` MD5 `84f3993af955af666d263f364cb37eb6` — verified unchanged |
| Dev DB | Docker container `backend-postgres-1` (Up, port 5433) |
| Modules (12) | patients, appointments, dashboard, payors, clinical, finance, marketing, operations, whatsapp, administration, settings, ai-manager |
| Infrastructure | database (Drizzle+RLS), health (`/health/live`, `/health/ready`), queue (BullMQ+Redis, `QUEUE_NAMES` incl. **`reports-refresh`**), outbox (dispatcher/recovery/scheduler) |
| Shared | audit (AuditService/AuditPort, same-tx pattern), logging (nestjs-pino, redaction, categories), correlation (AsyncLocalStorage, `x-correlation-id`), ports (7 read ports), architecture contract (ROLE_DOMAIN_MATRIX incl. `reports` rows), security, idempotency, events, errors |

**S8 constraints carried forward:** workers use `runAsWorker` system identity; RLS = 59 org-isolation policies + per-table worker policies; audit writes same-transaction; `.env` must be sourced for integration tests (`set -a && . ./.env && set +a`).

---

## 5. Existing Architecture Assessment

### 5.1 Read-port layer (the critical reuse asset)

Seven sanctioned cross-module READ ports exist in `src/shared/ports/`. Each: READ-ONLY, operates on the caller's `runAs()` transaction (RLS applies), never imported across module-infra boundaries. Current method inventory:

| Port | Existing methods | Gap for S9 |
|---|---|---|
| `FinanceReadPort` | `revenueTotal(orgId, {branchId, from, to})` (status='confirmed'), `outstandingLabPayables`, `openAlertCount`, `outstandingCommission`, `expenseTotal` | ✅ revenue KPI already servable; needs **revenue-by-branch list** and **daily revenue series** for charts/trends |
| `AppointmentsReadPort` | `countByDate(orgId, branchId, date, statuses?)`, `statusBreakdown(...)` | needs **range series** (daily booked/completed/no-show over N days) — currently single-date only |
| `PatientsReadPort` | `countPatients`, `getPatientById`, `findByPhone`, relationship counts | sufficient for S9 KPI strip (patient total) |
| `ClinicalReadPort` | encounter/plan/notes/timeline reads (patient-scoped) | needs **treatment mix aggregate** (org/branch + period) — currently patient-scoped only |
| `PayorsReadPort`, `ConfigResolverPort`, `AiPolicyPort` | master data / governance | not needed for S9 core |

**Assessment:** the pattern is proven (Dashboard module consumes 2 ports today, integration-tested in `dashboard.spec.ts`). S9 Reports = **Dashboard's pattern, generalized**: a new `reports` module consuming extended ports. No new architectural invention required on the read path.

### 5.2 Dashboard module (existing read model)

`dashboard/` = 3 files (controller/service/module), one endpoint `GET /api/v1/dashboard/context?date=`. Service derives everything from read ports inside `runAs()`; HQ → org-wide rollup (`branchId=null`), branch users → own branch; **records NO audit (view-only)** per locked behavior note in AuditService ("View-only actions must NOT be recorded").

⚠️ **Design tension discovered:** the Reports LOCK doc (§16 Audit Requirements) mandates "Setiap: report view opened (who/view/filter), filter change, export… Immutable." — i.e., report views **must** be audited, while the existing AuditService comment says view-only actions must NOT be recorded. Resolution: the Reports LOCK is the domain-specific authority and `report_audit` is a **domain-owned entity** (Reports OWNS ReportAudit per domain contract), distinct from the shared immutable `audit_log` for state-changing actions. Proposal: report-view tracking writes to a dedicated `report_audit` table via the same AuditService mechanism (action verbs like `report.view_opened`), preserving immutability while satisfying the domain contract. Flagged for governance confirmation (§22 Q5).

### 5.3 RBAC/permission enforcement

`PermissionGuard` is a global `APP_GUARD` reading `@RequirePermission(domain, action)` metadata → `can()` → `ROLE_DOMAIN_MATRIX`. The `reports` domain rows **already exist**:

- hq: `view`, scope `all`
- branch_manager: `view`, scope `branch`
- branch_admin (=receptionist alias): `NONE`
- doctor: `view`, scope **`'own'`** ⚠️ (see §22 Q1 — LOCK doc says doctor blocked)

Scope is additionally enforced by RLS at the DB layer (59 org policies + branch-scope policies from 0002/0003/0017). Reports endpoints inherit this defense-in-depth for free when queries run inside `runAs()`.

### 5.4 Health & observability baseline

- `/health/live` + `/health/ready` exist (VERSION_NEUTRAL, `@Public`, excluded from global prefix, excluded from pino autoLogging). Readiness probes PostgreSQL for real; Redis reported as config-presence only.
- Logging: `nestjs-pino` + `pino` + `pino-http` **installed and wired globally** (`AppLoggerModule` is `@Global`), correlation ID injected per request, aggressive secret redaction (`REDACT_PATHS`), categories include `worker`, `integration`, `audit`.
- Correlation: AsyncLocalStorage middleware on every request; workers propagate correlation IDs in job envelopes (S8).
- **Missing:** metrics (no `prom-client`/OTel), no `/metrics` endpoint, no request-duration histograms, no worker job counters, no alerting definitions.

### 5.5 Queue/worker baseline relevant to observability

BullMQ 5 + ioredis; `QUEUE_NAMES = ['domain-events','whatsapp-send','bukku-sync','ai-jobs','notifications','reports-refresh','recall-due']`. Workers: outbox dispatcher, whatsapp-send, recall-due, bukku-sync + central `RecoveryScheduler`. **Metrics instrumentation points:** job processed/failed/duration per queue, outbox backlog depth, recovery sweep runs. `reports-refresh` queue is currently **unused** — reserved (whether by design for S9 or coincidence, it is available and registered, so no QUEUE_NAMES change needed if S9 uses it).

### 5.6 Schema facts for KPI feasibility (verified against `schema.ts`)

- `sale_records`: orgId, branchId, patientId, amount(numeric 19,4), saleDate(date), status ∈ {recorded, confirmed, cancelled}; indexes on branch, patient, date, status → **revenue KPI + by-branch + daily series: feasible**
- `appointments`: orgId, branchId, doctorId, scheduledDate, status ∈ {booked, confirmed, checked-in, waiting, called, in-progress, completed, cancelled, no-show}; index (branchId, scheduledDate), (doctorId, scheduledDate) → **appointment trends + no-show rate + doctor production: feasible**
- `recall_cases`: orgId, branchId, patientId, dueDate, status ∈ {open, completed, cancelled} → **recall rate: feasible** (completed / (completed+cancelled+open-due) — formula decision, see registry)
- `commission_ledger`: doctorId, branchId, period, grossRevenue → **doctor revenue: feasible** (or derive from sale_records via appointments.doctorId — formula decision in registry)
- `treatment_catalog` + `appointments.treatmentRef` (varchar, free text) + `treatment_plan_items` → **treatment mix: partially feasible** — `treatmentRef` is free-text, not FK; canonical mix needs a defined source (§22 Q3)
- **No chair/operatory entity exists** → Chair Utilisation KPI **not computable** (LOCK doc itself lists it in the prototype KPI strip but the data source was prototype-mock; RISKS deferred real-time) — §22 Q2

---

## 6. S9 Functional Scope

### 6.1 In scope (proposed, pending approval)

**Reports/Analytics (O1):**
1. Canonical KPI registry `RPT_KPIS` — persisted `kpi_definitions` table + service, seeded with the 4 locked KPIs (Revenue/Appointment, Recall Rate, No-Show Rate + one slot resolved per §22 Q2), each with `sourceDomain` + formula + unit + scopeRules. HQ-only definition view.
2. Reports read endpoints (server-side equivalents of the locked prototype views):
   - KPI strip (4 cards, scope-aware)
   - Revenue by branch (top-N, scope-aware)
   - Treatment mix (period-aware) — pending Q3
   - Appointment trends (daily series: booked/completed/no-show over period)
   - Doctor production table (in-scope doctors)
   - Period pills: 7D/30D/90D/12M
3. Branch scope enforcement: HQ → all 14 branches; Manager → own branch; scope derived from principal, never client-supplied.
4. RBAC: `@RequirePermission('reports','view')` + service-level scope checks + RLS backstop.
5. Report usage audit: `report.view_opened`, `report.filter_changed` → `report_audit` table (immutable, append-only).

**Observability (O2):**
6. `/metrics` endpoint (Prometheus text format, version-neutral like `/health`, access policy decided per §22 Q6).
7. HTTP instrumentation: request count + duration histogram (labels: method, route, status) via pino-http hook or interceptor feeding `prom-client`.
8. Worker/queue instrumentation: jobs processed/failed per queue, outbox backlog gauge, DB pool gauge (basic).
9. Alerting hooks: documented threshold rules (e.g. outbox backlog > N, worker failure rate, 5xx rate) as config/documentation — **no alertmanager deployment** (KISS, ADR-008).

### 6.2 Explicitly out of scope (per LOCK doc RISKS + blueprint)

- Chart.js / any frontend rendering — backend serves JSON only
- Real-time dashboards (websocket/cron push) — DEFERRED
- Report scheduling (cron-generated reports) — DEFERRED
- Drill-down (branch → treatment) — DEFERRED v2
- Data warehouse / ETL / materialized-view caching layer — DEFERRED (blueprint §24 mentions caching; S9 reads live through ports — scale path documented instead)
- CSV/PDF export — pending §22 Q4 (recommend defer)
- Frontend sprint — NOT started (hard rule)
- Production deploy / production migration — NOT done (hard rule)
- Any mutation endpoint in reports domain — read-only is the domain contract
- AI Insights feed consumption — AI Manager governed, S7 contract only; S9 does not wire AI consumption (deferred)

---

## 7. S9 Non-Functional Requirements

| NFR | Requirement | Mechanism |
|---|---|---|
| Canonical truth | One number for "revenue" everywhere | All revenue reads through `FinanceReadPort` (status='confirmed' single rule); KPI registry stores the formula + sourceDomain |
| Read-only | Reports never mutates business data | No write methods in module; RLS grants SELECT only on domain tables (via runtime role); new tables append-only except `kpi_definitions` (HQ-governed) |
| Scope safety | Cross-branch leak = HIGH risk (blueprint R2) | Server-side scope from principal + PermissionGuard + service check + RLS (defense-in-depth, ADR-003) |
| Performance | KPI queries over ≤12M windows on dev-scale data; no N+1 | Set-based aggregates in read ports; existing indexes (sale_date, branch, status) cover query shapes; new index only if evidence demands |
| Honesty | No fabricated numbers | Uncomputable KPI (chair) = explicit `not_available` state, never mock (matches health-module honesty precedent) |
| Observability overhead | Metrics must not materially slow requests | `prom-client` in-memory registry, histogram buckets coarse; `/metrics` excluded from pino autolog (like /health) |
| Test integrity | 0 skipped gate; .env sourced; ×3 consecutive green | Existing vitest `dbIt` pattern + replay-verify |
| KISS | No OTel collector, no K8s, no Grafana deploy | prom-client + endpoint + documented alert rules only (ADR-007/008) |

---

## 8. Proposed Architecture

### 8.1 Module map (additive — existing modules untouched except port extensions)

```
src/modules/reports/                          (NEW module, mirrors S6/S7 layout)
  reports.module.ts                           imports:[AuthModule], exports ReportsService, KpiRegistryService
  presentation/reports.controller.ts          GET endpoints only, @RequirePermission('reports','view')
  presentation/kpi-registry.controller.ts     GET registry (HQ-gated)
  application/reports.service.ts              orchestration: period/scope resolution → port calls → DTO
  application/kpi-registry.service.ts         canonical registry reads (seeded definitions)
  application/report-audit.service.ts         append report_audit events
  domain/kpi-formulas.ts                      PURE functions: rate/series computation from port outputs
  domain/period-resolver.ts                   PURE: 7D/30D/90D/12M → {from, to} (server date)
  domain/reports-scope.ts                     PURE: principal → scope descriptor (hq-all | branch)
  infrastructure/reports.repository.ts        kpi_definitions + report_audit persistence (Drizzle, org-scoped)

src/shared/ports/                             (ADDITIVE methods only — no signature changes)
  finance.read-port.ts      + revenueByBranch(), + revenueDailySeries()
  appointments.read-port.ts + dailySeries(range), + doctorProduction(range)
  clinical.read-port.ts     + treatmentMix(range)         (pending Q3)
  marketing (NEW read port? recallRate) — recall_cases owned by marketing;
      options: new MarketingReadPort OR AppointmentsReadPort-adjacent RecallReadPort (§22 Q7)

src/infrastructure/observability/             (NEW, sibling to health/)
  observability.module.ts
  metrics.service.ts                          prom-client registry: http histogram, worker counters, gauges
  metrics.controller.ts                       GET /metrics (VERSION_NEUTRAL, @Public or protected per Q6)
  http-metrics.interceptor.ts                 global interceptor → observe duration/count
  worker-metrics.ts                           helper used by S8 workers? NO — workers untouched.
                                              Instead: queue-event listeners (BullMQ QueueEvents) observe jobs
                                              externally → zero changes to locked S8 worker code ✓
```

**Critical design decision — S8 immutability preserved:** worker metrics are collected via **BullMQ `QueueEvents` listeners** (a read-side subscription to the queue event stream) rather than editing S8 workers. Outbox backlog = a periodic gauge query via a scoped read. This gives observability over S8 runtime with **zero diff** to locked code.

### 8.2 Data flow (request path)

```
GET /api/v1/reports/kpis?period=30D
  → AuthGuard (JWT) → PermissionGuard (@RequirePermission('reports','view'))
  → ReportsService.kpis(principal, period)
      → domain/reports-scope: principal → {scope: 'org'| 'branch', branchId?}
      → domain/period-resolver: '30D' → {from,to} (server-local date, same convention as dashboard)
      → dbCtx.runAs(principal, tx =>
             FinanceReadPort.revenueTotal(tx, org, {branchId, from, to})
             AppointmentsReadPort.dailySeries(tx, org, branchId, from, to)
             RecallReadPort.rate(tx, org, branchId, from, to)
             …)
      → domain/kpi-formulas: pure compute (no-show %, recall %, per-appointment revenue)
  → ReportAuditService.record('report.view_opened', {view:'kpis', period}, tx)
  → DTO response (JSON)
```

RLS applies automatically: `runAs` sets `app.role`/`app.org_id`/`app.branch_ids` transaction-locally (S8 T1), so port queries can never leak cross-org/cross-branch even on a service bug.

### 8.3 Observability flow

```
HTTP req → correlationMiddleware → http-metrics.interceptor (start timer)
        → controller … → response → interceptor observes {method,route,status,duration}

BullMQ (redis) ⇄ QueueEvents listeners (observability module)
        → on completed/failed → counter.inc({queue, status}); histogram.observe(duration)

Periodic (setInterval, in-process, mirrors RecoveryScheduler fallback pattern):
        → outbox backlog gauge (SELECT count WHERE published_at IS NULL — scoped worker read)
        → DB pool gauge (active/idle from drizzle $client pool)

GET /metrics → registry.metrics() (Prometheus text)
```

---

## 9. Component Changes

| Component | Change | Nature |
|---|---|---|
| `src/modules/reports/**` | New module (≈10 files) | Additive |
| `src/shared/ports/finance.read-port.ts` | +2 read methods | Additive (no signature change) |
| `src/shared/ports/appointments.read-port.ts` | +2 read methods | Additive |
| `src/shared/ports/clinical.read-port.ts` | +1 read method (treatment mix, Q3) | Additive |
| `src/shared/ports/` (recall) | +1 new read port OR extend existing (Q7) | Additive |
| `src/infrastructure/observability/**` | New (≈5 files) | Additive |
| `src/app.module.ts` | +2 imports (ReportsModule, ObservabilityModule) | Registration only (sanctioned) |
| `src/main.ts` | Possibly +global interceptor registration, +'/metrics' prefix exclusion | Minimal, reviewed |
| `src/infrastructure/database/schema.ts` | +2 tables (kpi_definitions, report_audit) appended at end | Additive section |
| `drizzle/0024_s9_reports_observability.sql` | New migration + journal entry + CI loop entry | Additive (never edit old) |
| `package.json` | +`prom-client` dependency | **New dep — needs approval** |
| S8 runtime (workers/outbox/RLS 0017–0023) | **ZERO changes** | Untouched |
| `CURRENT-MEDINI-REVIEW.html` | **ZERO changes** (MD5 verify at gates) | Untouched |

---

## 10. Data Model / Database Impact

One new migration: **`drizzle/0024_s9_reports_observability.sql`** (numbering continues 0024; journal idx appended; CI loop updated).

### Proposed tables (2)

**`kpi_definitions`** — canonical registry (Reports OWNS)
- `id` uuid PK, `org_id` uuid NOT NULL (RLS org-isolated, consistent with all org tables)
- `kpi_key` varchar(64) NOT NULL — e.g. `revenue`, `revenue_per_appointment`, `recall_rate`, `no_show_rate`
- `name` varchar(128) NOT NULL
- `formula` text NOT NULL — canonical expression (human + doc readable, e.g. `sum(sale_records.amount where status='confirmed') / period`)
- `source_domain` varchar(32) NOT NULL — finance | appointments | marketing | clinical
- `unit` varchar(16) NOT NULL — MYR | count | percent
- `scope_rules` jsonb NOT NULL — e.g. `{"hq":"all","branch_manager":"branch"}`
- `version` integer NOT NULL default 1 (KPI formula changes = versioned, per locked lifecycle DRAFT→PUBLISHED→VERSIONED)
- `status` varchar(16) NOT NULL default 'published'
- audit cols; unique (org_id, kpi_key, version)
- Seed: 4 canonical KPI definitions for the Medini org (seed data, like branches/staff precedent)
- RLS: ENABLE+FORCE; org isolation `org_id = app_org_id()`; SELECT for human roles per matrix; **no system_worker policy needed** (no worker touches it — least privilege, S8 N9 pattern)

**`report_audit`** — immutable usage trail (Reports OWNS ReportAudit)
- `id` uuid PK, `org_id` uuid NOT NULL
- `actor_id` uuid NOT NULL, `actor_role` varchar(32) NOT NULL
- `action` varchar(48) NOT NULL — `view_opened` | `filter_changed` (export deferred)
- `view` varchar(64) NOT NULL — kpis | revenue_by_branch | treatment_mix | appointment_trends | doctor_production | kpi_registry
- `filter` jsonb NULL — `{period, branchId?}` (branchId recorded = the EFFECTIVE scope branch, never client-injected)
- `correlation_id` varchar(64) NOT NULL
- `created_at` timestamptz NOT NULL default now() — **append-only: no UPDATE/DELETE grants, RESTRICTIVE policy mirroring audit_log N9 hardening**
- Indexes: (org_id, created_at), (org_id, actor_id)
- RLS: ENABLE+FORCE + org isolation; SELECT hq-only (audit review), INSERT for api source, no UPDATE/DELETE

**Why NOT 4 tables:** blueprint §24 lists `report_definitions`, `report_views` too. Analysis: report definitions/views in S9 are **static code-defined views** (the 5 locked prototype views) — persisting them buys nothing until user-defined reports exist (post-v2, deferred). KISS + ADR-007: only `kpi_definitions` (governance-required: canonical registry must be inspectable/versioned) and `report_audit` (contract-required) are persisted. Flagged as Architecture Decision AD-1 (§23).

**No changes to existing tables, columns, enums, indexes, or RLS policies.** No data migration/backfill needed (new tables start empty; seed = kpi definitions only).

---

## 11. API Contract Design

All under `/api/v1/reports/*`, GET only, `@RequirePermission('reports','view')`, global ValidationPipe (whitelist), zod-parsed query DTOs in service boundary (project convention: zod in service, class DTOs at edge minimal).

| # | Endpoint | Query | Response (shape) | RBAC/scope |
|---|---|---|---|---|
| 1 | `GET /reports/kpis` | `period=7D\|30D\|90D\|12M` (default 30D) | `{ period, scope:{type, branchId?}, cards:[{kpiKey,name,value,unit,sourceDomain,available,note?}] }` | hq=all branches; manager=own; receptionist/doctor per Q1 |
| 2 | `GET /reports/revenue-by-branch` | `period`, `limit=6` | `{ period, rows:[{branchId, branchName, revenue}], total }` | manager → single-row (own branch) |
| 3 | `GET /reports/treatment-mix` | `period` | `{ period, rows:[{category, count, revenueShare?}] }` | scoped (Q3 dependent) |
| 4 | `GET /reports/appointment-trends` | `period` | `{ period, series:[{date, booked, completed, noShow}] }` | scoped |
| 5 | `GET /reports/doctor-production` | `period` | `{ period, rows:[{doctorId, name, appointmentsCompleted, grossRevenue}] }` | scoped |
| 6 | `GET /reports/kpi-registry` | — | `{ definitions:[{kpiKey,name,formula,sourceDomain,unit,version,status}] }` | **HQ only** (service-level role check; manager 403) |
| 7 | `GET /metrics` (version-neutral, outside /api/v1) | — | Prometheus text | Access policy Q6 |

**Error semantics:** 401 unauthenticated; 403 RBAC/scope violation (never 404-leak); 400 invalid period (zod); 500 with correlationId. **Idempotency:** N/A (reads). **Audit:** endpoints 1–5 record `report.view_opened` (with filter) in same tx; filter change = distinct `period` value per request, so each request is self-describing (no separate filter_changed tracking needed server-side beyond the per-request record — noted in registry).

---

## 12. Security / RBAC Impact

- **Matrix:** `reports` rows already exist in `ROLE_DOMAIN_MATRIX` — no contract change needed for hq/manager/receptionist. **Doctor cell conflict** (matrix=`view/own` vs LOCK doc=blocked) → governance decision Q1; implementation follows whichever governance rules, with a contract test asserting the decided behavior.
- **Scope:** derived from principal server-side; manager can never pass `?branchId=` to widen scope (query param either absent or validated against principal; recommend: no branchId param at all in v1 — scope is fully server-derived, matching dashboard precedent).
- **RLS:** new tables get org-isolation RESTRICTIVE + role permissives per S8 N9 checklist: (a) permissive per command needed, (b) `COALESCE(app_role(),'')` null-safe quals, (c) no worker policies (no worker access), (d) live-probe both directions in tests.
- **PII:** doctor-production returns doctor names + revenue — staff data, in-scope only; no patient PII in any report response (aggregates only).
- **`/metrics` exposure:** metrics can leak operational shape (queue names — already in code, not sensitive; no label values containing org/branch/patient IDs — rule: labels = low-cardinality constants only). Recommend `@Public` + infra-network-only at deploy (documented), consistent with `/health`. Q6.
- **Secrets:** no new secrets; `prom-client` needs none; redaction list unchanged.

---

## 13. Audit / Logging Impact

- **Domain audit:** `report_audit` append per §10 — satisfies LOCK §16 (views + filters immutable). Written via same-tx pattern (consistent with AuditService precedent); if audit insert fails, the read request fails — acceptable (audit is part of the contract).
- **Shared audit_log:** untouched. Decision AD-2: report-view events go to the **domain-owned `report_audit`** table, not shared `audit_log`, because (a) domain contract says Reports OWNS ReportAudit, (b) AuditService's own comment bars view-only records in the shared trail, (c) avoids polluting the security audit trail with high-volume read events. Q5 for governance confirmation.
- **Logging:** reports requests flow through existing pino-http (category `api`, correlationId). Metrics collection itself is silent. New module uses child logger category `app`; no new log categories needed (could add `reports` if volume justifies — default: reuse `api`).
- **Correlation:** `/metrics` gets correlation middleware automatically (main.ts applies to all requests); health-style exclusion from autolog extended to `/metrics`.

---

## 14. Integration Impact

| Integration | Impact |
|---|---|
| S8 outbox/workers | **Read-side only** (QueueEvents listeners, backlog gauge). Zero code change. |
| Redis/BullMQ | QueueEvents connections (+1 per queue, 7 max) — negligible. |
| PostgreSQL | +2 tables, +1 migration; read queries use existing indexes; RLS +~4 policies on new tables only. |
| Bukku/WAHA/AI | None. |
| Frontend | None this sprint (backend-only; frontend sprint explicitly deferred). API contracts designed to match the locked prototype's data shapes so the future frontend sprint needs no redesign (blueprint §32 "no mismatch"). |
| CI | +1 migration file in apply loop; `npm ci` picks up prom-client; tests +S9 specs. |

---

## 15. Testing Strategy

Following the proven S8 shapes (unique org UUID per spec file `…-0901` series; namespaced staff IDs `90d1f1a*-`; `dbIt` wrapper; raw-connection RLS probes):

| Layer | Coverage |
|---|---|
| **Unit (pure domain)** | period-resolver (7D/30D/90D/12M boundaries, invalid input), kpi-formulas (rate math incl. divide-by-zero → honest null/`available:false`), reports-scope (hq vs manager vs blocked roles) |
| **Contract** | RBAC matrix assertions for reports domain (hq/manager/receptionist/doctor decided behavior per Q1); architecture boundary test (reports module imports only ports, never domain repositories — extend `test/architecture/boundaries.spec.ts`) |
| **Integration (live PG)** | `reports.spec.ts`: seed org+branch+sale_records+appointments+recall_cases → each endpoint returns correct aggregates **within scope**; manager sees own branch only; cross-branch leak probe (manager requests, HQ data seeded — must not appear); canonical-truth test: `reports` revenue === `FinanceReadPort.revenueTotal` for same window === dashboard-equivalent number |
| **Security/RLS** | kpi_definitions + report_audit RLS live probes (raw connection, session GUCs per S8 pattern): org isolation (org A cannot read org B definitions/audit), receptionist denied (403 at guard + 0 rows at RLS), append-only enforcement (UPDATE/DELETE on report_audit → denied), HQ reads audit |
| **Observability** | `/metrics` returns Prometheus text containing `http_request_duration` series after a request; QueueEvents counter increments after a processed job (reuse an existing test queue or a lightweight probe job on `reports-refresh`); metrics endpoint excluded from autolog; no high-cardinality labels (assert label set bounded) |
| **Regression** | Full suite ×3 consecutive, **0 skipped** (grep the Tests line), `.env` sourced; replay-verify on scratch DB (0000→0024, drift zero); typecheck/lint/build green; MD5 frontend check; `git status` S0–S8 module diff = 0 |
| **Migration** | fresh replay proof; journal idx contiguity; idempotent re-apply (DROP POLICY IF EXISTS pattern) |

Target: zero failed, zero skipped, count reported exactly (461 + new).

---

## 16. Migration / Deployment Considerations

- Migration: manual-psql mechanism (write SQL → CI loop entry → journal append → dev apply via `docker exec … psql` → replay-verify). RLS clauses follow S8 N9 checklist verbatim.
- Seed: kpi_definitions seeded in migration itself (org-scoped INSERT for the canonical Medini org) OR in seed.js — recommend **migration-seeded reference data** (like enum/branch precedent) so fresh replay yields a usable registry; decision finalized in Phase 2.
- Deployment: **NOT in scope** — no production deploy, no production migration (hard rule). Dev DB only.
- Rollback: new tables are additive; rollback = drop migration file before merge. Post-merge, migrations are locked (never edited) — so Phase 3 gate is replay-proof before commit.
- Dependency: `npm install prom-client` (lockfile change) — CI `npm ci` compatible.

---

## 17. Risks & Mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Scope leak in report aggregates (blueprint R2 HIGH) | High | Server-derived scope only (no branchId param); PermissionGuard + service check + RLS triple layer; dedicated cross-branch leak test |
| R2 | "Duplicate revenue" — reports computes differently from finance | High | Mechanical impossibility by design: reports calls FinanceReadPort; parity test asserts equality with port output; KPI registry documents formula |
| R3 | Doctor RBAC ambiguity (Q1) implemented wrong | Medium | **HARD STOP rule applies** — governance decides before T2; contract test locks the decision |
| R4 | Chair KPI uncomputable → fabricated number | Medium | Honest `available:false` + note (health-module honesty precedent); never mock |
| R5 | prom-client new dependency (supply chain, bundle) | Low | De-facto standard (prometheus prom-client, MIT, widely audited); version-pinned; lockfile diff reviewed at gate |
| R6 | Metrics cardinality explosion (label abuse) | Medium | Code rule: constant label sets only; test asserts bounded labels; no IDs in labels |
| R7 | report_audit write failure breaks reads | Low | Same-tx = consistent failure with correlationId; volume is low (human click-rate) |
| R8 | 12M aggregation perf on large sale_records | Low-Medium | Indexed date/branch/status columns; set-based SQL; if evidence shows slowness → defer to documented materialized-view path (explicitly out of scope) |
| R9 | QueueEvents listeners add Redis connections | Low | 7 queues max, lazy; shutdown via OnApplicationShutdown (registry precedent) |
| R10 | Regression in S8 (461 tests) | High | S8 files untouched; full-suite ×3 gate; architecture boundary tests; git-diff scope review at lock gate |

---

## 18. Dependencies

**Hard dependencies (must exist — all verified present):**
- S8 runtime: `DbContextService.runAs` with org GUC (S8 T1), RLS org isolation (0017+), audit same-tx pattern
- Read ports (finance/appointments/patients/clinical) + their module owners' tables
- `ROLE_DOMAIN_MATRIX` reports rows (present)
- nestjs-pino wiring (present), correlation middleware (present)
- BullMQ QueueEvents API (bullmq ^5.81.3 present)
- `reports-refresh` queue name registered (present)

**External/decision dependencies:**
- Governance approval of `prom-client` dependency
- Governance decisions Q1–Q7 (§22)
- ChatGPT Governance Phase 1 approval → Phase 2 → implementation approval

**Upstream documents:** Blueprint §28, REPORTS-ANALYTICS-LOCKED.md, REPORTS-ANALYTICS-ARCHITECTURE.md (all read and cross-checked).

---

## 19. Explicit Out-of-Scope

1. Frontend work of any kind (frontend sprint not started; CURRENT-MEDINI-REVIEW.html MD5-locked)
2. Production deployment, production migration, staging
3. Report scheduling / cron-generated reports / email delivery
4. CSV/PDF export (pending Q4; recommend defer per LOCK RISKS)
5. Real-time dashboards (websocket/cron push refresh)
6. Drill-down views (branch → treatment → patient)
7. Data warehouse / ETL / materialized views / BI embeds
8. AI Insights consumption wiring (AI Manager governed; S7 contract only)
9. Any mutation/write endpoint in the reports domain
10. Changes to S8 locked runtime: workers, outbox, migrations 0000–0023, RLS policies on existing tables
11. Alerting infrastructure (Alertmanager/Grafana/PagerDuty) — hooks/rules documentation only
12. OpenTelemetry distributed tracing rollout (deferred; correlation-ID logging is the v1 "tracing wiring" per KISS)
13. User-defined/custom report builder (report_definitions/report_views persistence — deferred post-v2, AD-1)

---

## 20. Proposed Phase 2 Task Breakdown

**5 tasks** (complexity-justified, not forced):

| Task | Name | Depends on |
|---|---|---|
| **S9-T1** | **Canonical KPI registry + read-port extensions** — migration 0024 (kpi_definitions + report_audit + RLS + seed), schema.ts section, KpiRegistryService, additive port methods (finance byBranch/dailySeries, appointments dailySeries/doctorProduction, recall port decision Q7, treatment mix Q3), pure domain (period-resolver, kpi-formulas, reports-scope) | — |
| **S9-T2** | **Reports read endpoints** — reports module (controller/service/audit), 6 GET endpoints, RBAC + scope + integration tests incl. cross-branch leak + canonical-truth parity | T1 |
| **S9-T3** | **Observability** — prom-client, observability module (/metrics, HTTP interceptor, QueueEvents worker metrics, outbox/pool gauges), alert-rules doc, autolog exclusion | T1 (parallel-ish with T2; shares migration only if gauges need none — T3 is DB-free, can run parallel after T1) |
| **S9-T4** | **S9 tests completion + CI** — full S9 spec suite green ×3, replay-verify 0000→0024, CI loop updated, regression 461+n with 0 skipped | T2, T3 |
| **S9-T5** | **Hardening gate** — cross-domain audit without features: RLS live dump on new tables, metrics cardinality audit, secrets scan, MD5 check, git-scope review, honest residual risks, final evidence report | T4 |

Execution order: `T1 → (T2 ∥ T3) → T4 → T5`. Each T-task ends with the S8-cadence governance report (evidence table, exact counts, git state) and **stops for authorization** before the next. Progress reported at every 20% increment.

---

## 21. Definition of Done

Phase 3 complete when ALL hold, with runtime evidence (not claims):

1. All 6 reports endpoints + `/metrics` implemented per approved contracts; every acceptance criterion per task met.
2. Canonical truth proven by test: reports revenue ≡ FinanceReadPort revenue for identical windows.
3. Scope proven by test: manager cross-branch leak impossible (guard + service + RLS three-layer evidence).
4. RBAC proven: receptionist (and doctor per Q1 decision) denied at guard AND at RLS.
5. `report_audit` immutable: append works, UPDATE/DELETE denied (RLS probe), actor/timestamp/correlation correct.
6. `/metrics` exposes http + worker + backlog series; bounded labels proven.
7. Full suite ×3 consecutive green, **0 skipped**, exact count reported; replay 0000→0024 drift-zero on scratch DB.
8. typecheck / lint (max-warnings=0) / build green.
9. `git status` shows only S9-scoped files; S0–S8 diffs = 0; MD5 frontend unchanged; secrets scan clean.
10. S9-FINAL-AUDIT-REPORT.md = PASS with no unresolved critical/high; ChatGPT Governance approves; only then commit → push → CI green → lock.

---

## 22. Open Questions (for ChatGPT Governance — NOT silently resolved)

| # | Question | Options | Recommendation |
|---|---|---|---|
| **Q1** | **Doctor access to reports:** `ROLE_DOMAIN_MATRIX` grants doctor `reports: view/scope 'own'` (S6-era, contract-tested), but REPORTS-ANALYTICS-LOCKED.md RBAC table says Doctor ❌ blocked. Conflict between two locked artifacts. | (a) Follow matrix (doctor own-scope view — e.g. own production); (b) follow LOCK doc (block doctor, amend matrix + contract test as an explicit governance amendment, mirroring the S6 D1 whatsapp amendment precedent) | **(b)** — the Phase-7 LOCK is the newer, domain-specific authority; amend the matrix with a documented governance decision exactly like S6 D1 did for whatsapp |
| **Q2** | **Chair Utilisation KPI:** no chair/operatory entity exists in schema; prototype used mock data; LOCK doc includes it in the KPI strip but RISKS defer real-time ops data. | (a) Omit from v1 KPI strip (3 cards); (b) include with `available:false` + note "requires Operations chair tracking — deferred" | **(b)** — preserves the locked 4-card strip contract honestly (matches health-module honesty precedent); zero fabrication |
| **Q3** | **Treatment mix source:** `appointments.treatmentRef` is free-text varchar (not FK to treatment_catalog); canonical mix needs a defined fact source. | (a) Group by `treatment_catalog.category` via treatmentRef→code match where possible, bucket unmatched as 'Other'; (b) derive from `treatment_plan_items` (clinical-owned, FK-clean) via ClinicalReadPort; (c) defer treatment-mix endpoint to a later sprint | **(b)** — clinical-owned FK-clean source honors "aggregate from domain owners" strictly; (a) risks garbage groupings from free text |
| **Q4** | **Export (CSV/PDF):** LOCK lists export as a command with RBAC+audit, but RISKS defer scheduling; blueprint §24 lists export service. In S9? | (a) Defer export entirely; (b) CSV only for the 5 views (audit-logged) | **(a)** — LOCK RISKS explicitly defer; KISS; frontend sprint will revisit |
| **Q5** | **Report-view audit location:** domain contract says Reports OWNS ReportAudit; AuditService comment says view-only actions must NOT be recorded (shared trail). | (a) Dedicated `report_audit` table (proposed); (b) shared audit_log with source='api' | **(a)** — domain contract ownership + avoids polluting security trail with read events; keeps AuditService comment true |
| **Q6** | **`/metrics` access policy:** Prometheus scraping needs unauthenticated or token access; endpoint leaks operational shape. | (a) `@Public` like /health + deploy-time network restriction documented; (b) require a metrics bearer token (env-configured) | **(a)** for v1 with a documented hard note (KISS, health precedent); (b) documented as the production-hardening option in S10 |
| **Q7** | **Recall rate read boundary:** recall_cases is marketing-owned; no MarketingReadPort exists. | (a) New `RecallReadPort` in shared/ports (mirrors existing pattern); (b) extend an existing port | **(a)** — new single-purpose port keeps domain ownership lines clean |

---

## 23. Architecture Decision Summary

| AD | Decision | Rationale |
|---|---|---|
| AD-1 | Persist only `kpi_definitions` + `report_audit`; `report_definitions`/`report_views` stay code-defined | No user-defined reports in v1; KISS (ADR-007); avoids dead schema |
| AD-2 | Report-view audit → domain `report_audit` table, not shared audit_log | Domain contract ownership; AuditService view-only exclusion; volume isolation (Q5) |
| AD-3 | Worker metrics via BullMQ QueueEvents listeners, NOT by editing S8 workers | S8 immutability (hard rule); read-side observation is sufficient for counters/histograms |
| AD-4 | prom-client for metrics (new dependency) | Prometheus text format is the blueprint's stated direction ("Prometheus-compatible"); prom-client is the standard; OTel SDK deferred as over-engineering for single-VPS v1 |
| AD-5 | Reports module consumes extended shared read ports; zero new domain-repository imports | Canonical-truth + module-boundary rules; pattern proven by Dashboard |
| AD-6 | Scope fully server-derived; no branchId query param in v1 | Dashboard precedent; closes the widest scope-leak surface by construction |
| AD-7 | No caching/materialized views in v1 | Dev-scale data; indexed live reads; documented scale path instead of premature infra (ADR-007) |
| AD-8 | "Tracing wiring" = correlation-ID continuity + http/worker duration histograms, NOT OTel traces | Blueprint intent is production measurability; correlation IDs already span request→worker; full OTel is S10 hardening material |

---

## 24. Recommendation

**Proceed to Phase 2** upon ChatGPT Governance approval, conditional on:

1. Decisions on **Q1–Q7** (recommendations provided for each; Q1 is the only security-relevant one and follows the S6 D1 amendment precedent).
2. Approval of the **`prom-client` dependency** addition.
3. Approval of the **5-task breakdown** (T1 → T2∥T3 → T4 → T5) with S8-style per-task governance stops.
4. Reconfirmation of hard rules: no implementation before Phase-2 approval; S8 immutability; no deploy; frontend untouched; evidence-based reporting with per-20% progress checkpoints.

No blockers discovered. Blueprint scope is clear, S8 baseline matches the documented locked state exactly, architecture path is determined end-to-end, database impact is minimal and additive, security contract has exactly one ambiguity (Q1) with a governed resolution path, and the testing strategy fully validates the requirements.

---

**READY FOR CHATGPT GOVERNANCE REVIEW**
