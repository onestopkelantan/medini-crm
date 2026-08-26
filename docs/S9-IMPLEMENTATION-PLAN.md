# S9 — IMPLEMENTATION PLAN

**Sprint:** 9 — Reports/Analytics + Observability + Power BI Foundation (Backend)
**Phase:** 2 — Task Breakdown & Implementation Planning
**Author:** Neo
**Date:** 18 August 2026
**Baseline:** S8 LOCKED — `c0ac25c` (main, CI green, 461/461, replay 0000→0023)
**Phase 1 doc:** `docs/S9-DISCOVERY-ARCHITECTURE-REPORT.md` (approved by Bos)
**Scope ruling (Bos, 18 Aug):** S9 stays **backend-only per Blueprint §28** + Power BI foundation added as T6. Full-stack production readiness (frontend integration, infra, backup/restore, deployment) = **Sprint 10**, out of S9 scope.

---

## Open Question Resolutions (defaults applied — Bos may override before implementation)

| # | Decision applied | Rationale |
|---|---|---|
| Q1 | **Doctor BLOCKED from reports** — amend `ROLE_DOMAIN_MATRIX` doctor.reports → NONE (governance amendment, S6 D1 whatsapp precedent) + contract test | Phase-7 LOCK doc is the newer domain-specific authority |
| Q2 | Chair Utilisation card = `{available:false, note:"requires chair tracking — deferred"}` | No chair entity; honesty precedent (health module) |
| Q3 | Treatment mix sourced from **`treatment_plan_items` JOIN treatment_catalog** (clinical-owned, FK-clean) via ClinicalReadPort | Free-text `treatmentRef` risks garbage groupings; "aggregate from domain owners" |
| Q4 | Export CSV/PDF **deferred** | LOCK RISKS defer; KISS |
| Q5 | Report-view audit → dedicated **`report_audit`** table (not shared audit_log) | Domain contract ownership; AuditService view-only exclusion |
| Q6 | `/metrics` = `@Public` (health precedent) + documented network-restriction note for deploy | KISS; hardening option in S10 |
| Q7 | New **`RecallReadPort`** in shared/ports | Clean domain ownership line (marketing owns recall_cases) |

**S9-T6 note:** Power BI foundation consumes the **same canonical read layer** — no parallel SQL against raw tables beyond documented BI views (§T6).

---

## Task Summary

| Task | Name | Depends | Est. files | DB changes |
|---|---|---|---|---|
| **S9-T1** | Canonical KPI registry + read-port extensions + migration 0024 | — | ~12 | +2 tables (kpi_definitions, report_audit), +RLS, +seed |
| **S9-T2** | Reports read endpoints (6 GET) | T1 | ~8 | none |
| **S9-T3** | Observability (/metrics + instrumentation) | T1 | ~7 | none |
| **S9-T6** | Power BI foundation (PBIP + TMDL semantic model + DAX) | T1 (registry), T2 (endpoint parity) | ~10 (new `power-bi/` dir at repo root) | none (reads only) |
| **S9-T4** | Tests ×3 + replay 0000→0024 + CI update | T2,T3,T6 | ~4 (specs + ci.yml) | none |
| **S9-T5** | Hardening gate + final audit | T4 | ~2 (reports) | none |

Execution order: `T1 → (T2 ∥ T3 ∥ T6) → T4 → T5`

---

## S9-T1 — Canonical KPI Registry + Read-Port Extensions + Migration 0024

1. **ID:** S9-T1
2. **Name:** Canonical KPI registry (RPT_KPIS) + read-port extensions + migration 0024
3. **Objective:** Persist the canonical KPI registry + report audit trail; extend sanctioned read ports with the aggregate methods Reports/PBI need; provide pure domain functions for period/scope/KPI math.
4. **Scope:**
   - `drizzle/0024_s9_reports_foundation.sql` — `kpi_definitions`, `report_audit` tables + RLS (org isolation RESTRICTIVE + permissives, COALESCE-null-safe per N9 checklist) + seed 4 KPI definitions + journal append + CI loop entry
   - `schema.ts` — additive section (2 pgTable + types)
   - `src/modules/reports/domain/` — `period-resolver.ts` (7D/30D/90D/12M → {from,to}), `kpi-formulas.ts` (pure: rates, divide-by-zero → available:false), `reports-scope.ts` (principal → scope descriptor; doctor/receptionist → denied)
   - Read ports (additive methods only):
     - `FinanceReadPort`: `revenueByBranch(orgId,{from,to})`, `revenueDailySeries(orgId,{branchId,from,to})`
     - `AppointmentsReadPort`: `dailySeries(orgId,branchId,from,to)` (booked/completed/no-show per day), `doctorProduction(orgId,branchId,from,to)`
     - `ClinicalReadPort`: `treatmentMix(orgId,branchId,from,to)` — from `treatment_plan_items` JOIN `treatment_catalog` (category), via plans' branch
     - NEW `RecallReadPort`: `recallStats(orgId,branchId,from,to)` (open/completed/cancelled counts by dueDate window)
5. **Files/modules affected:** migration 0024, `drizzle/meta/_journal.json`, `.github/workflows/ci.yml`, `src/infrastructure/database/schema.ts`, 4 read-port files (3 extend + 1 new), `src/modules/reports/domain/*` (3 files)
6. **Database changes:** +`kpi_definitions` (org_id, kpi_key, name, formula, source_domain, unit, scope_rules jsonb, version, status, audit cols; uq org+key+version), +`report_audit` (org_id, actor_id, actor_role, action, view, filter jsonb, correlation_id, created_at; append-only), RLS both, seed 4 KPIs (revenue, revenue_per_appointment, recall_rate, no_show_rate)
7. **API changes:** none
8. **Security/permission changes:** RLS on 2 new tables (org-isolation RESTRICTIVE + human permissive SELECT/INSERT; NO worker policies — no worker touches them; report_audit no UPDATE/DELETE grants)
9. **Audit/logging changes:** report_audit is the audit target (T2 writes; T1 creates structure only)
10. **Tests required:** `test/integration/s9-reports-foundation.spec.ts` — replay-proof, RLS probes (org isolation, append-only enforcement, no-GUC service path COALESCE safety), seed verification, period-resolver unit tests, kpi-formulas unit tests (divide-by-zero), port method integration tests against seeded org
11. **Dependencies:** none (first task)
12. **Acceptance criteria:** migration replays clean 0000→0024; RLS live-probes pass both directions; port methods return correct aggregates vs direct SQL; unit tests green; regression 461 unchanged
13. **Regression risks:** LOW — all additive; ports extended not modified; new tables isolated
14. **Rollback consideration:** pre-merge = drop files; post-merge = locked (replay-proof gate before commit)

---

## S9-T2 — Reports Read Endpoints

1. **ID:** S9-T2
2. **Name:** Reports module — 6 read-only GET endpoints
3. **Objective:** Serve the locked Phase-7 report views from production backend with RBAC + scope + audit.
4. **Scope:**
   - `src/modules/reports/` module (controller/service/module, S6 layout)
   - Endpoints (all `@RequirePermission('reports','view')`, GET, versioned /api/v1/reports):
     1. `GET /kpis?period=` — KPI strip (4 cards incl. honest chair card)
     2. `GET /revenue-by-branch?period=&limit=6`
     3. `GET /treatment-mix?period=`
     4. `GET /appointment-trends?period=`
     5. `GET /doctor-production?period=`
     6. `GET /kpi-registry` — HQ only (service-level role check)
   - Scope fully server-derived (hq→org-wide, manager→own branch; doctor/receptionist → 403 via matrix amendment in T1's contract test + guard)
   - Every request records `report.view_opened` to `report_audit` (same-tx)
   - `app.module.ts` registration
5. **Files/modules affected:** `src/modules/reports/{reports.module.ts, presentation/reports.controller.ts, application/reports.service.ts, application/report-audit.service.ts, infrastructure/reports.repository.ts}`, `src/app.module.ts`, `architecture.contract.ts` (doctor.reports → NONE, 1-line + comment)
6. **Database changes:** none (T1 done)
7. **API changes:** +6 GET endpoints (additive)
8. **Security/permission changes:** doctor.reports → NONE (documented governance amendment Q1); PermissionGuard + service-level scope + RLS三层
9. **Audit/logging changes:** `report.view_opened` per request (view + filter + actor + correlationId)
10. **Tests required:** `test/integration/s9-reports.spec.ts` — each endpoint happy path; manager scope isolation (cross-branch leak probe); receptionist/doctor 403; HQ registry access vs manager 403; canonical-truth parity (reports revenue ≡ FinanceReadPort.revenueTotal same window); audit row written with correct actor/filter; matrix contract test update
11. **Dependencies:** T1
12. **Acceptance criteria:** all 6 endpoints return correct scoped data; leak probes fail-closed; parity test passes; audit rows immutable; full regression green
13. **Regression risks:** MEDIUM-LOW — matrix amendment (doctor cell) is the only touch to locked contract; contract test updated in same batch
14. **Rollback consideration:** module is additive; matrix amendment is 1 cell + test — revert = restore cell (but would violate LOCK doc; flagged for governance in final report)

---

## S9-T3 — Observability

1. **ID:** S9-T3
2. **Name:** /metrics + HTTP/worker instrumentation + alerting hooks
3. **Objective:** Prometheus-compatible observability without touching locked S8 worker code.
4. **Scope:**
   - `npm install prom-client` (new dependency — Bos-approved per plan acceptance)
   - `src/infrastructure/observability/` module: `metrics.service.ts` (registry: `http_request_duration_seconds` histogram {method,route,status}, `worker_jobs_total` counter {queue,status}, `outbox_backlog` gauge, `db_pool` gauges), `metrics.controller.ts` (GET /metrics, VERSION_NEUTRAL, @Public, excluded from autolog), `http-metrics.interceptor.ts` (global), `queue-events.listener.ts` (BullMQ QueueEvents subscriptions — zero S8 worker diff), periodic gauges (setInterval, RecoveryScheduler-pattern)
   - `main.ts` — interceptor registration + prefix exclusion for `/metrics`
   - `docs/OBSERVABILITY.md` — alert rules (outbox backlog > N, worker failure rate, 5xx rate, p95 latency) as documented hooks (no Alertmanager deploy — KISS)
5. **Files/modules affected:** new observability dir (~5 files), `main.ts`, `app.module.ts`, `package.json`+lockfile, `docs/OBSERVABILITY.md`
6. **Database changes:** none (backlog gauge reads outbox table via scoped query)
7. **API changes:** +GET /metrics (version-neutral)
8. **Security/permission changes:** /metrics @Public (Q6); label cardinality rule: constant label sets only, no IDs
9. **Audit/logging changes:** /metrics excluded from pino autolog (health precedent); no audit (infra endpoint)
10. **Tests required:** `test/integration/s9-observability.spec.ts` — /metrics returns text with expected series after a request; QueueEvents counter increments on processed job (use reports-refresh or existing queue with a probe job); bounded label assertion; autolog exclusion; readiness endpoint unchanged
11. **Dependencies:** T1 (shares nothing DB-wise; logically parallel with T2)
12. **Acceptance criteria:** /metrics exposes http+worker+backlog series; zero S8 worker file diffs; cardinality test passes; regression green
13. **Regression risks:** LOW — interceptor is global but additive; autolog exclusion mirrors health
14. **Rollback consideration:** remove module + dependency; no schema impact

---

## S9-T6 — Power BI Foundation

1. **ID:** S9-T6
2. **Name:** Power BI semantic model + DAX + PBIP project foundation
3. **Objective:** Establish the production BI foundation: PBIP project with TMDL semantic model (star schema over canonical Medini facts) + core DAX KPI measures + validation pipeline — consuming the SAME canonical truth as Reports (no parallel logic).
4. **Scope:**
   - New dir `power-bi/` at repo root (NOT inside backend/): `MediniBI.pbip`, `MediniModel.SemanticModel/definition/` (TMDL: model, relationships, tables), `MediniReport.Report/` (PBIR skeleton)
   - Semantic model (Import mode, DirectQuery-deferred): **star schema**
     - Facts: `FactRevenue` (sale_records confirmed), `FactAppointments`, `FactRecallCases`, `FactTreatmentItems`
     - Dimensions: `DimDate` (calendar), `DimBranch` (14 canonical), `DimDoctor`, `DimTreatmentCategory`, `DimOrganization`
     - Power Query M: source = PostgreSQL (connection string parameterized, env-based; NO hardcoded credentials — uses `DatabaseConnection` parameter placeholder)
     - DAX measures (canonical parity with RPT_KPIS): `Total Revenue`, `Revenue per Appointment`, `Recall Rate %`, `No-Show Rate %`, per-branch revenue, appointment trends (booked/completed/no-show), doctor production — each measure documented with its RPT_KPIS sourceDomain
     - RLS placeholder roles (OrgRole/BranchRole) designed but marked "activate at Service publish" (local file can't enforce)
   - Validation: `te validate` + `te bpa run` + hooks (validate-tmdl/pbir/binding) — all wired into S9-T4 CI gate where runner-supports
   - Docs: `power-bi/README.md` — architecture diagram, refresh path (S10: gateway + scheduled refresh), how canonical parity is maintained
5. **Files/modules affected:** new `power-bi/` tree (~10 files), `docs/POWER-BI-ARCHITECTURE.md`
6. **Database changes:** none (BI reads via documented SQL in M queries; recommends S10 read-replica/read-role)
7. **API changes:** none
8. **Security/permission changes:** none backend; PBI RLS roles designed-not-enforced (documented)
9. **Audit/logging changes:** none
10. **Tests required:** `te validate` = 0 errors; `te bpa run --fail-on error` pass; hooks green (TMDL/PBIR/binding); DAX measures parse; parity checklist: each DAX KPI definition matches RPT_KPIS formula (documented mapping, human-reviewed — runtime parity vs live DB deferred to S10 when gateway exists)
11. **Dependencies:** T1 (KPI registry = formula source), T2 (endpoint shapes inform measures)
12. **Acceptance criteria:** PBIP opens structurally (validation green); star schema correct (no snowflake facts); ≥8 DAX measures with canonical mapping; BPA clean; naming conventions per `pbi-standardize-naming-conventions`; no secrets in project
13. **Regression risks:** NONE to backend (isolated dir)
14. **Rollback consideration:** delete `power-bi/` dir; zero backend impact

---

## S9-T4 — Tests ×3 + Replay + CI

1. **ID:** S9-T4
2. **Name:** Full test completion + migration replay + CI green
3. **Objective:** Prove S9 end-to-end integrity.
4. **Scope:** complete all S9 specs; `.env`-sourced full suite ×3 consecutive (0 skipped); fresh scratch-DB replay 0000→0024 (drift zero); CI loop updated with 0024; PBI validation step in CI (te validate + hooks, best-effort on Ubuntu runner — tmdl-validate linux binary available in hooks/bin)
5. **Files:** specs (T1/T2/T3), `scripts/replay-verify.sh` evidence, `.github/workflows/ci.yml`
6. **DB changes:** none
7. **API changes:** none
8. **Security changes:** none
9. **Audit changes:** none
10. **Tests required:** IS the task — counts reported exactly (461 + S9 new), 0 skipped gate
11. **Dependencies:** T2, T3, T6
12. **Acceptance criteria:** 3× consecutive green locally; CI green on push (when governance authorizes push); replay proof printed
13. **Regression risks:** catches others' risks
14. **Rollback:** N/A

---

## S9-T5 — Hardening Gate + Final Audit

1. **ID:** S9-T5
2. **Name:** Cross-domain hardening + forensic audit + evidence pack
3. **Objective:** S8-T5-style final gate — no features, only proof.
4. **Scope:** live RLS dump (new tables), metrics cardinality audit, secrets scan, MD5 frontend check, git-scope review (S0–S8 diff = 0), canonical-truth re-verification, honest residual risks, S9-FINAL-AUDIT-REPORT.md (PASS/FAIL + findings + severity), Level 1/2/3 reports
5. **Files:** `docs/S9-FINAL-AUDIT-REPORT.md`, evidence attachments
6. **DB changes:** none
7. **API changes:** none
8. **Security changes:** none (verifies them)
9. **Audit changes:** none (verifies them)
10. **Tests:** final full-suite re-run as evidence
11. **Dependencies:** T4
12. **Acceptance criteria:** audit PASS or documented findings with remediation; all gates' evidence assembled
13. **Regression risks:** none
14. **Rollback:** N/A

---

## Dependency Graph

```
S9-T1 (registry + ports + migration 0024)
   ├──→ S9-T2 (reports endpoints)
   ├──→ S9-T3 (observability)          [parallel after T1]
   └──→ S9-T6 (power BI foundation)    [parallel after T1]
           ↓
        S9-T4 (tests ×3 + replay + CI)
           ↓
        S9-T5 (hardening + final audit)
           ↓
   GOVERNANCE REVIEW → commit → push → CI → 🔒 S9 LOCKED
```

## Explicitly OUT of S9 (deferred to Sprint 10)

Frontend integration, production deployment, production migration, backup/restore rehearsal, DR drill, infrastructure hardening, E2E browser flows, PBI Service publish/gateway/scheduled refresh, performance benchmarking, data-quality audit of production data.

---

**AWAITING BOS APPROVAL OF THIS PLAN → then implementation starts at S9-T1.**
