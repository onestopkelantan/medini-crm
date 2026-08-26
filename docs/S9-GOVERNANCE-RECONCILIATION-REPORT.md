# S9 — GOVERNANCE RECONCILIATION & FORENSIC REVIEW

**Date:** 18 August 2026 · **Reviewer:** Neo (forensic reconciliation, pre-governance)
**Baseline:** S8 LOCKED `c0ac25c762c686bb594498b3ec9754c03ea16161`
**State at review:** implementation complete, tests 475/475 ×3, **NO commit/push/deploy**
**Purpose:** determine what is genuinely S9 baseline vs addition, what is required, what should be deferred/removed before LOCK. **No code was changed during this review.**

---

## 1. Executive Summary

S9 delivered Reports/Analytics + Observability + a Power BI foundation. The forensic diff against S8 HEAD is **tight and additive**: 12 modified files + 13 new paths, **zero** changes to S8 runtime modules (whatsapp/finance/marketing/outbox/queue), **zero** changes to S8 migrations 0000–0023, **zero** changes to S8 test files.

**Three items require explicit governance attention before LOCK:**
1. **`kpi_definitions` DB table** — the Blueprint's canonical-KPI-registry requirement can arguably be code-defined. Defensible either way → flagged as GOVERNANCE DECISION.
2. **Doctor RBAC amendment** (`reports: view/own → NONE`) — a locked-contract change. Documented and contract-tested, but it IS a governance-level amendment → flagged GOVERNANCE DECISION (confirmation, not new decision).
3. **Power BI PBIP foundation** — the largest scope addition. Justified as "foundation only" (no publish, no live DB validation), but governance should confirm it belongs to S9 vs S10 → flagged GOVERNANCE DECISION with a KEEP recommendation.

**One security item is marked `REMEDIATION REQUIRED BEFORE PRODUCTION`** (not before lock): `/metrics` is `@Public` and its safety depends entirely on deploy-time network restriction (S10).

---

## 2. S9 Original Baseline

From `PRODUCTION-BACKEND-BLUEPRINT-v1.0.md` §28 (line 539):

> **Sprint 9 — Reports/Analytics + Observability:** RPT_KPIS, dashboards, metrics/tracing/alerting.

From `REPORTS-ANALYTICS-LOCKED.md` (Phase-7 LOCK) + `REPORTS-ANALYTICS-ARCHITECTURE.md` §24 (Production Backend Implications):

- Canonical KPI registry (`RPT_KPIS` — 4 KPIs, each with sourceDomain + formula)
- Read-only intelligence layer; aggregate from domain owners, never recompute
- Period pills 7D/30D/90D/12M; branch scope HQ-all/Manager-own; RBAC Receptionist/Doctor blocked
- Report usage audit (views + filters immutable)
- Schema: `report_definitions`, `kpi_definitions`, `report_views`, `report_audit` (§24)
- Observability: metrics/tracing/alerting (Blueprint §28)

---

## 3. Actual Implementation Summary

| Task | Delivered |
|---|---|
| T1 | `kpi_definitions` + `report_audit` tables (migration 0024), 4 KPI seeds, RLS; extended Finance/Appointments/Clinical read ports; new `RecallReadPort`; pure domain (period/scope/formulas) |
| T2 | 6 GET endpoints `/api/v1/reports/*`; scope server-derived; doctor blocked (contract amendment); per-view `report_audit` rows |
| T3 | `/metrics` (Prometheus), HTTP histogram/counter, worker counters via BullMQ QueueEvents (zero S8 worker diff), outbox backlog gauge, `OBSERVABILITY.md` alert rules; `prom-client` dependency |
| T6 | `power-bi/` PBIP project: TMDL star schema (4 dims + 4 facts), 9 DAX measures mapped 1:1 to RPT_KPIS, PBIR skeleton, architecture docs |
| T4/T5 | ×3 green (475/475, 0 skipped), replay 0000→0024 clean, CI updated, final audit report |

---

## 4. Baseline vs Addition Matrix

| Item | Original S9 Baseline | Neo Addition | Existing Capability | Required? | Recommendation |
|---|---|---|---|---|---|
| 6 GET `/reports/*` endpoints | YES (Blueprint §28 "dashboards") | As specified | Dashboard module = 1 endpoint only (context); no report views | YES | 🟢 KEEP — REQUIRED |
| KPI strip (4 cards) | YES (LOCK §5) | + honest `chair_utilisation available:false` (Q2) | none | YES | 🟢 KEEP — REQUIRED |
| Revenue by branch | YES (LOCK §5) | additive port method `revenueByBranch` | none | YES | 🟢 KEEP — REQUIRED |
| Treatment mix | YES (LOCK §5) | via ClinicalReadPort (FK-clean source, Q3) | none | YES | 🟢 KEEP — REQUIRED |
| Appointment trends | YES (LOCK §5) | additive port `dailySeries` | single-date only before | YES | 🟢 KEEP — REQUIRED |
| Doctor production | YES (LOCK §5) | additive port `doctorProduction` | none | YES | 🟢 KEEP — REQUIRED |
| KPI registry endpoint | YES (LOCK: HQ views registry) | `GET /kpi-registry` HQ-only | none | YES | 🟢 KEEP — REQUIRED |
| Period pills 7D/30D/90D/12M | YES (LOCK §9 rule 4) | `period-resolver` pure fn | none | YES | 🟢 KEEP — REQUIRED |
| HQ/Manager scope | YES (LOCK §11) | `reports-scope` pure fn, server-derived (AD-6) | dashboard does this | YES | 🟢 KEEP — REQUIRED |
| Report usage audit | YES (LOCK §16, domain contract) | `report_audit` table + per-view append | shared `audit_log` exists but view-only excluded | YES (see Review B) | 🟡 GOVERNANCE DECISION |
| `kpi_definitions` table | §24 lists it | persisted + seeded | could be code-defined | UNCLEAR (see Review A) | 🟡 GOVERNANCE DECISION |
| `report_audit` table | §24 lists it | persisted, append-only RLS | shared audit_log | YES (see Review B) | 🟢 KEEP — JUSTIFIED |
| Migration 0024 | implied | 1 additive file + journal + CI | n/a | YES | 🟢 KEEP — REQUIRED |
| `/metrics` endpoint | YES (Blueprint "metrics") | Prometheus text | none | YES | 🟢 KEEP — REQUIRED |
| HTTP metrics | YES ("metrics/tracing") | global interceptor | none | YES | 🟢 KEEP — REQUIRED |
| Worker metrics | YES ("metrics") | QueueEvents listeners (AD-3) | none | YES | 🟢 KEEP — JUSTIFIED |
| Outbox backlog gauge | implied ("alerting") | 30s in-process gauge | none | JUSTIFIED | 🟢 KEEP — JUSTIFIED |
| Alerting rules doc | YES ("alerting") | `OBSERVABILITY.md` (6 rules) | none | YES | 🟢 KEEP — REQUIRED |
| `prom-client` dependency | not named | new dep 15.1.3 | none | YES (see Review D) | 🟢 KEEP — JUSTIFIED |
| `/metrics` @Public | not specified | @Public + doc note | /health precedent | PARTIAL (see Review E) | 🔴 REMEDIATE before production |
| Doctor RBAC → NONE | conflict (matrix vs LOCK) | amended + comment + test | matrix had view/own | governance (see Review F) | 🟡 GOVERNANCE DECISION |
| `RecallReadPort` | implied (recall_rate KPI) | new port | none | YES (see Review C) | 🟢 KEEP — REQUIRED |
| Power BI PBIP foundation | NOT in §28 text | full `power-bi/` tree | none | scope (see Review G) | 🟡 GOVERNANCE DECISION (recommend KEEP as foundation-only) |
| `report_definitions`/`report_views` tables | §24 lists them | **NOT created** (AD-1, code-defined views) | n/a | NOT for v1 | 🟢 KEEP — JUSTIFIED (omission) |

---

## 5. Database Review

- `kpi_definitions` (org_id, kpi_key, name, formula, source_domain, unit, scope_rules jsonb, version, status, audit cols; uq org+key+version). RLS: org-isolation RESTRICTIVE + hq insert/update + hq/manager select. No DELETE policy (versioned, never deleted). Seeded ×4 canonical KPIs.
- `report_audit` (org_id, actor_id, actor_role, action, view, filter jsonb, correlation_id, created_at). RLS: org-isolation RESTRICTIVE + hq select + hq/manager insert. **No UPDATE/DELETE permissives → append-only.** Grants: SELECT/INSERT only.
- Indexes: uq + org idx (kpi), org+created / org+actor (audit). No FK to staff/branches (intentional — audit rows must survive staff changes; actor_id is a recorded fact, not a live FK).
- Migration 0024 additive; journal idx 23 contiguous; CI loop updated. Replay 0000→0024 clean (69 tables, 4 seeds), scratch DB dropped after proof.

---

## 6. Reports Review

Endpoints all GET, `@RequirePermission('reports','view')`, scope derived from principal (no client branchId param — AD-6). Each view appends `report_audit` in the same transaction. Canonical-truth parity test asserts reports revenue ≡ `FinanceReadPort.revenueTotal` for the same window. Denied roles (doctor/receptionist) throw `ForbiddenError` before `runAs` → no audit row (correct: no view occurred).

## 7. Observability Review

`prom-client` registry: `http_request_duration_seconds` + `http_requests_total` {method, route, status}; `worker_jobs_total` {queue, status}; `outbox_unpublished_events` gauge; default process metrics. `/metrics` version-neutral, `@Public`, excluded from autolog. Worker metrics via `QueueEvents` — **zero S8 worker file diff** (verified in §11). Cardinality discipline enforced by test (no IDs in labels).

## 8. Security Review

- Scope: server-derived only; manager leak probe fails closed.
- RLS: new tables probed both directions (T1 spec) — org isolation, append-only, hq-only audit select, manager insert denied.
- Secrets: none added; PBI connection is parameterized (no credentials in repo); scan clean.
- **`/metrics` public:** see Review E — flagged REMEDIATION BEFORE PRODUCTION.

## 9. RBAC Review

Doctor `reports` cell amended from `view/own` → `NONE` with a documented comment citing the Phase-7 LOCK as authority (Q1) and the S6 D1 whatsapp-amendment precedent. Contract test updated in the same batch (T2 spec asserts doctor 403). No other matrix cell touched. See Review F.

## 10. Power BI Scope Review

See Specific Review G. PBIP tree is complete and validated (`te validate` 0 errors, tmdl-validate 0/0, hooks exit 0, BPA 17 findings with 5 documented exceptions). **No live-DB validation performed** (requires PBI Desktop + gateway — S10). No publish. No credentials.

## 11. S8 Immutability Review (verified against `c0ac25c`)

```
git diff --name-only c0ac25c -- backend/src/modules/{whatsapp,finance,marketing,clinical,appointments,patients}
                               backend/src/infrastructure/{outbox,queue}
→ EMPTY (zero S8 runtime diff)

git diff c0ac25c -- backend/drizzle/00[01]*  → only meta/_journal.json (idx append) + 0024 new file
git diff c0ac25c -- backend/test/            → only 3 new s9-* specs (zero S8 test edits)
```

**Exceptions to "S8 untouched" (all sanctioned/additive):**

| File | Change | Sanction |
|---|---|---|
| `architecture.contract.ts` | doctor.reports `view/own`→`NONE` + comment | Q1 governance decision (Review F) |
| `main.ts` | `+ 'metrics'` in prefix-exclusion | additive, required for /metrics |
| `logger.module.ts` | autolog ignore `+ /metrics` | additive, health precedent |
| `app.module.ts` | `+ ReportsModule`, `+ ObservabilityModule` imports/registration | sanctioned registration-only |
| `schema.ts` | +2 pgTable sections appended at end | additive (skill rule) |
| 3 read ports | +aggregate methods appended | additive, no signature changes |
| `ci.yml`, `_journal.json` | +0024 entries | migration mechanism |
| `package.json`/lock | +prom-client | Review D |

No unrelated refactor. No S8 behavior change.

---

## 12. Test Quality Review

| Claim | Proven by | Strength |
|---|---|---|
| Revenue parity (reports ≡ finance port) | s9-reports.spec parity block | **STRONG** (live DB, same window) |
| Branch isolation (manager) | s9-reports.spec (b1-only rows) | **STRONG** |
| HQ org-wide access | s9-reports.spec (2-branch aggregate) | **STRONG** |
| Doctor denial | s9-reports.spec 403 + scope unit test | **STRONG** |
| Receptionist denial | s9-reports.spec 403 | **STRONG** |
| Audit persistence (actor/view/filter) | s9-reports.spec 7-row assertion | **STRONG** |
| Audit immutability | s9-foundation RLS probe (UPDATE/DELETE 42501/0-rows dual) | **STRONG** |
| KPI calculations (rates, divide-by-zero) | kpi-formulas unit tests | **STRONG** |
| Period boundaries | period-resolver unit tests (inclusive ranges) | **STRONG** |
| Empty/null data → honest unavailable | s9-reports.spec empty-org block | **STRONG** |
| Cross-branch leakage | manager pinned + RLS org isolation probe | **STRONG** |
| Metrics cardinality (no IDs) | s9-observability label assertions | **STRONG** |
| Metrics secret/PII leakage | cardinality test + redaction unchanged | **ADEQUATE** (no PII in labels by construction; no explicit PII probe) |
| Migration replay | scratch 0000→0024 (69 tables, 4 seeds) | **STRONG** |
| Regression | 461 S8 tests still pass ×3 | **STRONG** |
| Worker metrics actually increment on a real BullMQ job | **MISSING** — counter tested via direct `.inc()`, not via a live QueueEvents emission (Redis-dependent; documented) | **WEAK** |
| `/metrics` returns text from a real HTTP scrape through the running app | **MISSING** — controller tested at service level, not booted-app level | **WEAK** |
| PBI DAX measures against live data | **MISSING** — deferred (requires Desktop/gateway, S10) | **DEFERRED** (documented) |

---

## 13–15. KEEP / REMOVE / DEFER Summary

- **KEEP (REQUIRED):** 6 endpoints, KPI strip, revenue-by-branch, treatment mix, appointment trends, doctor production, KPI registry, period pills, scope model, migration 0024, `report_audit`, `/metrics`, HTTP + worker metrics, outbox gauge, alert rules doc, `RecallReadPort`, `prom-client`.
- **KEEP (JUSTIFIED):** QueueEvents approach (zero S8 diff), omission of `report_definitions`/`report_views` tables (AD-1), honest chair card (Q2).
- **REMOVE:** none identified.
- **DEFER:** none required for correctness; PBI live validation + Service publish already deferred (S10).

## 16. Governance Decisions Required

1. **`kpi_definitions` table** — confirm persisted-registry vs code-defined (Review A).
2. **Doctor RBAC amendment** — confirm the Q1 amendment stands as the locked behavior (Review F).
3. **Power BI PBIP in S9** — confirm foundation-only inclusion vs moving the whole tree to S10 (Review G).

## 17. Required Remediation

| # | Item | When |
|---|---|---|
| R-01 | `/metrics` network restriction (bind to infra network / reverse-proxy ACL, or add metrics bearer token) | **BEFORE PRODUCTION** (S10) — documented in OBSERVABILITY.md; not a code change for S9 |
| R-02 (optional) | Add a live-QueueEvents worker-metric test behind a Redis-available gate | S10 hardening |
| R-03 (optional) | Booted-app `/metrics` scrape test | S10 hardening |

---

## SPECIFIC REVIEWS

### A — kpi_definitions

1. **Why a table?** §24 explicitly lists `kpi_definitions` as schema; LOCK §6 domain contract says Reports OWNS KpiDefinition.
2. **Blueprint require persistence?** UNCLEAR at §28 level (one line); §24 architecture doc lists the table — that is the design authority.
3. **Could RPT_KPIS be code-defined?** YES — the formulas are stable and the service already has pure-formula mirrors.
4. **Second source of truth?** Managed risk: the table stores definitions (metadata), the service computes from domain-owner ports (facts). Parity is documented, not yet machine-enforced between table formula text and code formula.
5. **Owner:** Reports domain (HQ governed; HQ-only insert/update by RLS).
6. **Expected to change without deployment?** Not in v1 — versioned changes are governance events.
7. **Power BI depend on it?** Not at runtime — the DAX measures mirror it by documented mapping (POWER-BI-ARCHITECTURE.md), they don't query the table.
8. **Removing it break S9?** Removing the table would drop the `/kpi-registry` endpoint's data source and the LOCK's "canonical registry inspectable" requirement.

**Recommendation:** 🟡 **GOVERNANCE DECISION REQUIRED** — my engineering recommendation is **KEEP**: §24 lists it, the registry endpoint needs it, and a persisted, versioned, HQ-governed registry is exactly what "canonical, inspectable, never-duplicated" means in a multi-consumer (backend + Power BI) world. But it is legitimately arguable as code-defined, so governance should confirm.

### B — report_audit

1. **Exact requirement:** LOCK §16 "Setiap: report view opened (who/view/filter), filter change, export… Immutable." Domain contract: Reports OWNS ReportAudit.
2. **Existing audit infra?** `audit_log` exists BUT `AuditService`'s own contract bars view-only records from the shared trail — using it would contradict the S0/S2 design.
3. **Dedicated table why?** Domain ownership + volume isolation + the view-only exclusion above.
4. **Append-only enforced?** YES — RLS: no UPDATE/DELETE permissives + GRANT SELECT/INSERT only; probed live (dual-mechanism assertion).
5. **Actor identity?** YES — actor_id + actor_role per row.
6. **Report+period+scope captured?** YES — view + filter jsonb (period recorded; effective scope is derivable: principal role + branch recorded implicitly by RLS org/branch context of the write).
7. **RLS applies?** YES — org isolation + hq-only select.
8. **Duplicate audit architecture?** NO — it is the domain's single audit channel; shared audit_log untouched.

**Recommendation:** 🟢 **KEEP — JUSTIFIED.**

### C — RecallReadPort

1. **Which KPI needs recall data?** `recall_rate` (RPT_KPIS, LOCK §5 KPI strip).
2. **Recall in approved S9 baseline?** YES — recall rate is one of the 4 locked KPIs.
3. **Existing source reusable?** No — marketing.repository is module-internal (write-side); no read port existed for recall_cases (Q7).
4. **Unnecessary architecture?** NO — it follows the exact sanctioned read-port pattern (FinanceReadPort etc.).
5. **If removed, what breaks?** `recall_rate` card + `GET /reports/kpis` recall card — a locked KPI.

**Recommendation:** 🟢 **KEEP — REQUIRED.**

### D — prom-client

1. **Prometheus /metrics explicitly required?** Blueprint §28 says "metrics/tracing/alerting"; Phase-1 approved Prometheus-compatible text format (AD-4).
2. **Existing deps sufficient?** No — no metrics library existed; hand-rolling a Prometheus serializer would be worse than the de-facto standard.
3. **Minimal accepted?** YES — prom-client is the standard Node Prometheus client (MIT, widely audited), version-pinned.
4. **Metrics exposed?** HTTP duration/counts, worker job counts, outbox backlog, process defaults.
5. **Labels bounded?** YES — constant label sets only (method/route/status/queue/state); test-enforced.
6. **Cardinality safe?** YES (test asserts no IDs).
7. **Secrets/PII excluded?** YES — no label carries identifiers; redaction paths unchanged; metrics are counts/latencies only.

**Recommendation:** 🟢 **KEEP — JUSTIFIED.**

### E — /metrics security

1. **Public?** YES (`@Public`, version-neutral).
2. **Why?** Prometheus scrapers are infra peers, not authenticated users; mirrors `/health` precedent (Q6 decision).
3. **Unauthenticated user sees:** metric names + constant labels (route patterns like `/api/v1/reports/kpis`, queue names like `whatsapp-send`, status codes), counts, latency buckets, process stats.
4. **Exposes:** route names YES, queue names YES, internal service name YES (`medini-crm-backend` default label), error info (rates only, no messages), identifiers NO, business values NO (counts of appointments/revenue are NOT exposed — only request/job counts), PII NO, secrets NO.
5. **Network restriction required:** scrape-only access from the monitoring network (reverse-proxy ACL or bind restriction).
6. **Enforced now or S10?** **Only planned** — application exposes it publicly; restriction is deploy-time (S10).
7. **Safely public before infra deployment?** On the single-VPS topology, exposure risk is LOW (operational metadata only), but it is NOT zero (queue/route names aid reconnaissance).

**Classification:** 🔴 **`REMEDIATION REQUIRED BEFORE PRODUCTION`** (R-01). Safe to keep in S9 LOCK (backend not deployed); must be restricted at first production deploy.

### F — Doctor RBAC

1. **Authoritative document:** `REPORTS-ANALYTICS-LOCKED.md` (Phase-7, 13 Aug 2026) is the newer, domain-specific authority; the matrix cell predates it (S6-era).
2. **Why changed to NONE:** LOCK §10 table explicitly blocks Doctor from reports.
3. **Amendment documented?** YES — code comment citing Q1 + S6 D1 precedent + this report.
4. **Contract test?** YES — doctor 403 asserted in s9-reports.spec; scope unit test asserts denied.
5. **Affect existing Doctor functionality?** NO — doctor never had a reports endpoint before S9; nothing is taken away operationally.
6. **S9 requirement or architecture decision?** It is the resolution of a conflict between two locked artifacts — by definition a governance-level amendment (mirrors S6 D1 whatsapp amendment).

**Recommendation:** 🟡 **GOVERNANCE DECISION REQUIRED** (confirm the amendment stands). Engineering position: the amendment is correct — it follows the newer domain lock.

### G — Power BI

1. **Explicitly part of S9?** NOT in Blueprint §28 text. Added by Bos ruling (18 Aug) as "Power BI foundation = S9-T6" within backend-only scope.
2. **PBIP required by Blueprint §28?** NO — §28 mentions only "RPT_KPIS, dashboards, metrics/tracing/alerting". PBI enters via the locked Phase-7 doc's production note ("BI embed/server-side charts") and Bos's explicit direction.
3. **Only a future consumer?** Correct — PBI consumes the same canonical truth; S9 backend does not depend on it.
4. **S9 backend depend on PBI?** NO.
5. **PBIP need live DB validation?** For production use, YES — that is S10 (needs Desktop + gateway).
6. **Publishing belongs to S10?** YES (activation checklist documented).
7. **Keeping PBIP in S9 increase release risk?** LOW — isolated `power-bi/` tree, zero backend coupling, validated statically (te validate 0 errors).
8. **Treated as documentation/foundation only?** YES — that is exactly its current state.

**Recommendation:** 🟡 **GOVERNANCE DECISION REQUIRED** — recommend **KEEP IN S9 as foundation-only** (validated skeleton + canonical DAX mapping, no publish). If governance prefers minimal S9 surface, the whole `power-bi/` tree can move to S10 with zero backend impact.

### H — S8 immutability

Covered in §11. **PASS** — zero S8 runtime/migration/test diffs; only sanctioned additive changes + the Q1 contract amendment (documented).

### I — Test quality

Covered in §12. 13 STRONG, 1 ADEQUATE, 2 WEAK (Redis/booted-app metrics probes), 1 DEFERRED (PBI live). No fabricated-confidence tests: worker metrics tested at the registry/label level; live-emission probe recommended as S10 hardening (R-02).

---

## 18. Final Scope Recommendation

S9 as implemented is **tight, additive, and honest**. No removals recommended. Three confirmations requested (kpi_definitions persistence, doctor amendment, PBI foundation inclusion). One remediation flagged **for production, not for lock** (/metrics network restriction). Two optional test hardening items for S10.

## 19. Proposed S9 Lock State

If governance approves:

- Lock commit includes: migration 0024 + journal + ci, reports module, observability module, read-port extensions, recall port, contract amendment (Q1), 3 new specs, `power-bi/` foundation, 5 docs.
- Lock message pattern: `feat(crm): complete and lock sprint 9 reports, observability, power-bi foundation`
- Record in lock: 475/475 ×3, replay 0000→0024, Q1 amendment, R-01 production remediation carried into S10, PBI foundation = validated-not-published.

---

**S9 GOVERNANCE RECONCILIATION COMPLETE — AWAITING CHATGPT GOVERNANCE DECISION**
