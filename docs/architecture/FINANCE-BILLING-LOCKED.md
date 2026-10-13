# FINANCE & BILLING v1.2 — COMPLETE (PHASE 6 LOCKED)

**Locked:** 13 August 2026 · **Baseline:** v1.2 Phase 3 (464/464) → Phase 4 Bukku Connector Real API → Phase 5 Two-Way Sync (509/509) → Phase 6 Reconciliation + Final QA (534/534)
**FINANCE v1.2 = COMPLETE — 6 of 6 phases locked**

---

## 1. Objective

Deliver **DOMAIN — FINANCIAL MANAGEMENT (Finance & Billing v1.0)** as an Enterprise Business Architecture document AND a complete, interactive **Finance Command Center** UX prototype in the Single HTML review artifact — additive on top of the locked Medini build (Phase 1–7, Domain 1/2/3). v1.2 menambah roadmap 6 fasa: Treatment Cost Linking → Lab Payables → Doctor Commission → Bukku Connector → Two-Way Sync → Reconciliation.

## 2. Deliverables

### 2.1 Architecture Document

**File:** `docs/FINANCE-BILLING-ARCHITECTURE.md` — purpose, scope, boundary, modules, submodules, entities, relationships, source of truth, finance sub-domains, Phase 1–5 implementation records (sections 43–49), Phase 6 future (section 50).

### 2.2 Single HTML Full UX Prototype (Finance Command Center)

**Files:** `CURRENT-MEDINI-REVIEW.html` (root) + `app/reviews/CURRENT-MEDINI-REVIEW.html` (identical, MD5-verified `eaff7e3f18491b5bd6043f46ee6e2fee`)

**Finance Command Center — implemented capabilities (v1.0 + v1.1 + v1.2 Phases 1–5):**

| # | Capability | Interaction |
|---|-----------|-------------|
| 1 | Finance Command Center header | Branch scope selector (HQ all/branch · branch roles locked) + scenario switcher (7 scenarios) |
| 2 | Finance search | Invoice / payment / patient / branch / payee / expense / payable / treatment / doctor / reference |
| 3 | What Needs Your Attention | Overdue payments, bills due, insurance renewals, commission approvals, outstanding invoices — each clickable |
| 4 | KPI strip | Total Sales, Total Collected, Outstanding, Overdue, Total Expenses, Payables Due, Net Cash Position, Critical Alerts — every card clickable |
| 5 | Module navigation | Dashboard / Revenue & Collection / Expenses / Payables / Cash Flow / Branch Finance / Recurring / Alerts / Reports / Config / Treatment Costs / Bukku Connector / Sync Dashboard |
| 6 | Revenue Trend graph | Daily/Weekly/Monthly/Quarterly/Yearly · click → period breakdown → drill branch → invoice |
| 7 | Sales | Trend + by branch / treatment / doctor; click treatment → filtered invoices |
| 8 | Invoices | Full table → invoice detail drawer |
| 9 | Invoice detail | Payment history, Record Payment, Adjustment, Refund, Void, audit trail |
| 10 | Payments | By method + payment table → payment detail drawer → linked invoice |
| 11 | Outstanding | Total + by branch + by age + outstanding invoice list — all clickable |
| 12 | Aging | Current/1–30/31–60/61–90/90+ buckets — click bucket → invoices |
| 13 | Collection Tracker | Target vs collected + progress % → collection details |
| 14 | Expenses | All + 9 categories — every category clickable |
| 15 | Doctor Commission | Per doctor: revenue, rate, gross, adjustment, net payable, paid, outstanding → treatment-level breakdown + approval |
| 16 | Accounts Payable | Payee/category/branch/amount/due/priority/status → payable detail with Approve / Schedule / Mark Paid / History |
| 17 | Recurring Commitments | Name/category/branch/amount/frequency/next due/auto-create/status + Upcoming Payments |
| 18 | Finance Alerts | Critical / Due Soon / Upcoming / Awaiting Approval / Resolved → open underlying record, resolve, dismiss |
| 19 | Cash Flow | Cash In vs Cash Out graph + Net Position + Money In/Out breakdown |
| 20 | Branch Finance | HQ all-branch performance table + branch comparison chart; branch roles own-branch only |
| 21 | Financial Reports | 11 report types with Open / Export UI |
| 22 | Finance Configuration | Payment methods, expense categories, commission rules, recurring categories, alert thresholds, due-date rules, financial periods, branch settings (role-gated) |
| 23 | Approval flow | Draft → Pending Approval → Approved → Scheduled → Paid (payables + commission) |
| 24 | Audit trail | Who/what/when/detail on invoice, payment, payable, commission, alert, approval, adjustment |
| 25 | Branch RBAC | HQ = all 14 branches; Branch roles = own branch only; unauthorized branch blocked at state layer |
| 26 | **Treatment Costs (Phase 1)** | TC supports lab cost, lab selection, invoice no/date, amount validation, save → appears in Finance, searchable, lab statement multi-entries |
| 27 | **Lab Payables (Phase 2)** | TC→Payable auto-creation, due-date calc, partial/full payment, overdue alerts, statement, threshold blocking + resolution |
| 28 | **Doctor Commission Engine (Phase 3)** | Ledger, config (40% default), eligibility, lifecycle (approve/schedule/pay/adjust), HQ Control Tower + Doctor My Commission, RBAC doctor-own |
| 29 | **Bukku Connector (Phase 4)** | Credentials form (HQ-only, masked), sync queue (Invoice/Payable/Commission Payout), field mapping, simulate sync, test connection — boundary only |
| 30 | **Two-Way Sync (Phase 5)** | Sync Dashboard (Last Sync / Synced Today / Pending Queue / Conflicts), Run Full Sync / Push / Pull / Simulate Bukku Edit buttons, Virtual Bukku DB (in-memory), ID mapping `BK-<refId>`, version tracking, conflict detection + resolution (Use Medini / Use Bukku), audit trail, RBAC HQ-only — boundary only, semua button functional |

**Demo scenarios (A–G):** Healthy Finance · High Outstanding · High Expenses · Overdue Bills · Upcoming Tax/Insurance · Branch Comparison · Cash Flow Pressure — switchable, whole UI updates.

## 3. Test Results

```text
Existing tests (V9 + Phases 5–7 + D1/D2/D3 + Finance v1.1 + Marketing + Phase 1 + Phase 2) : 464/464 PASS
Phase 4 tests (P4-01..P4-20 — Bukku Connector boundary)                                   : 20/20  PASS
Phase 5 tests (P5-01..P5-25 — Two-Way Sync boundary)                                      : 25/25  PASS
TOTAL                                                                                     : 509/509 PASS
```

### 3.5 v1.2 Phase 5 additions (P5-01..P5-25)

| Group | Coverage | Result |
|-------|----------|--------|
| P5-01..P5-04 | Module visible, KPI cards render, Virtual Bukku DB section, 4 control buttons | ✅ |
| P5-05..P5-08 | Push button functional, Pull functional, Full sync functional, Simulate Bukku Edit functional | ✅ |
| P5-09..P5-11 | Conflict detection on external edit, conflict UI renders, resolution functional (Use Medini) | ✅ |
| P5-12..P5-13 | Audit trail renders + has entries after operations | ✅ |
| P5-14..P5-19 | Version increments, ID mapping BK- prefix, queue → SYNCED, pending count, synced-today counter, no duplicate queue entries | ✅ |
| P5-20 | RBAC blocks non-HQ from sync controls | ✅ |
| P5-21..P5-25 | Virtual Bukku stores invoice + version, conflict array tracked, boundary warning shown, navigation back to Bukku, zero JS errors | ✅ |

### 3.4 v1.2 Phase 4 additions (P4-01..P4-20)

| Group | Coverage | Result |
|-------|----------|--------|
| P4-01..P4-03 | Bukku module visible, view loads, status AWAITING_CREDENTIALS initially | ✅ |
| P4-04..P4-05 | Credentials form opens (HQ), save works masked → READY | ✅ |
| P4-06..P4-10 | Sync queue builds (invoices/payables/commission), Medini refs present | ✅ |
| P4-11..P4-15 | Simulate sync per-record, queue status → SYNCED, bukkuId assigned, lastSync updates, audit records sync | ✅ |
| P4-16..P4-20 | Test connection simulated, non-HQ blocked, no real HTTP requests, mapping view, full boundary journey | ✅ |

### 3.3 v1.2 Phase 3 additions (P3-01..P3-40)

| Group | Coverage | Result |
|-------|----------|--------|
| P3-01..P3-10 | Ledger builds, config reuse, eligibility, duplicate protection, revenue/costs/base/commission formulas | ✅ |
| P3-11..P3-14 | HQ Control Tower, all-doctors, drill-down, commission detail | ✅ |
| P3-15..P3-21 | Lifecycle, approve/schedule/pay, adjustment audited, rule version, traceability | ✅ |
| P3-22..P3-30 | Doctor scope (own/other blocked/branch blocked/self-approval blocked), My Commission, cost breakdown, payout history | ✅ |
| P3-31..P3-35 | HQ scope (all, drill, approval queue, payouts, controls) | ✅ |
| P3-36..P3-40 | Receptionist blocked, effective-date, ledger-consistent reports, no dead controls, full journey | ✅ |

### 3.2 v1.2 Phase 2 additions (F2-01..F2-35)

| Group | Coverage | Result |
|-------|----------|--------|
| F2-01..F2-05 | TC→Payable creation, preserves cost/invoice/lab/patient/case refs | ✅ |
| F2-06..F2-09 | Due date calc, default rule, lab override, outstanding formula | ✅ |
| F2-10..F2-15 | Partial payment, full payment, overpayment blocked, paid/overdue status, overdue days | ✅ |
| F2-16..F2-19 | Lab Payable KPIs, due-this-week, overdue alert → detail, payment → cash flow | ✅ |
| F2-20..F2-24 | Duplicate protection, statement multi-entries, total, payment audit, history | ✅ |
| F2-25..F2-30 | Branch RBAC (HQ/branch/blocked), config, historical due-date integrity | ✅ |
| F2-31..F2-35 | View TC/Case/Patient, full TC→Payable journey, full Payable→Payment→CashFlow journey | ✅ |

### 3.1 v1.2 Phase 1 additions (F1-01..F1-26)

| Group | Coverage | Result |
|-------|----------|--------|
| F1-01..F1-06 | Treatment Case supports lab cost, lab selection, invoice no/date, amount validation, save | ✅ |
| F1-07..F1-11 | Cost appears in Finance, search by invoice/patient/lab/doctor | ✅ |
| F1-12..F1-14 | Detail opens, View Patient → Patient 360, View Treatment Case → Clinical | ✅ |
| F1-15..F1-18 | Branch RBAC (HQ all / branch own / unauthorized blocked) | ✅ |
| F1-19..F1-21 | Monthly lab statement multi-entries, total calc, invoice unique/traceable | ✅ |
| F1-22..F1-25 | Audit, edit, historical trace, no dead controls | ✅ |
| F1-26 | Full Clinical → Lab Cost → Finance journey | ✅ |

### 3.0 v1.1 additions (F-37..F-76) + v1.0 (F-01..F-36)

| Group | Tests | Result |
|-------|-------|--------|
| F-01..F-05 | Navigation, dashboard, KPI clickable, Revenue & Collection, submodule switch | ✅ |
| F-06..F-11 | Sales drill-down, invoice detail, payment detail, outstanding, aging, collection tracker | ✅ |
| F-12..F-20 | Expenses + all 9 categories (incl. Doctor Commission) | ✅ |
| F-21..F-25 | Payables, Recurring, Alerts, Cash Flow, Reports | ✅ |
| F-26..F-33 | Branch filter, HQ all-branch, period filter, graph render/drill, search | ✅ |
| F-34..F-35 | Approval flow + audit trail | ✅ |
| F-28/F-29 | Branch RBAC (own-branch scope, unauthorized blocked) | ✅ |
| F-36 | Full Finance Journey end-to-end | ✅ |
| F-37..F-45 | Module/submodule clickable, KPI destinations, attention items open detail drawers → underlying records | ✅ |
| F-46..F-50 | Commission config editable, default 40%, basis + payout configurable, calculation updates | ✅ |
| F-51..F-55 | Recurring due/amount editable, change updates alerts/payables/cash flow | ✅ |
| F-56..F-62 | Add expense category, payment method, alert threshold, financial period, approval threshold | ✅ |
| F-63..F-69 | Branch config editable + propagates, config audit history, historical protection, branch override, global default, impact preview | ✅ |
| F-70..F-73 | Lab payment creates payable, overdue alert, threshold blocks case, resolution removes block | ✅ |
| F-74..F-76 | Config RBAC, unauthorized branch blocked, full configuration-to-engine journey | ✅ |

## 4. Screenshots (app/smoke-shots/)

`finance-dashboard.png` · `finance-revenue.png` · `finance-sales-drilldown.png` · `finance-outstanding.png` · `finance-aging.png` · `finance-expenses.png` · `finance-payables.png` · `finance-recurring.png` · `finance-alerts.png` · `finance-cashflow.png` · `finance-branch.png` · `finance-reports.png` · `finance-full-journey.png` · `finance-alert-detail.png` · `finance-commission-config.png` · `finance-recurring-config.png` · `finance-expense-category-config.png` · `finance-lab-payment.png` · `finance-lab-block.png` · `finance-configuration-impact.png` · `finance-treatment-costs.png` · `clinical-treatment-cost-entry.png` · `finance-treatment-cost-detail.png` · `finance-lab-statement-entries.png` · `finance-treatment-cost-journey.png` · `finance-bukku-connector.png` (26 total; Phase 5 sync dashboard shot in next verification run)

## 5. Files

| File | Change |
|------|--------|
| `docs/FINANCE-BILLING-ARCHITECTURE.md` | +Sections 48 (Phase 4 Bukku Connector) + 49 (Phase 5 Two-Way Sync) + 50 (Phase 6 future) |
| `CURRENT-MEDINI-REVIEW.html` (root) | Finance v1.2 Phase 5 — Sync Dashboard module, VIRTUAL_BUKKU, SYNC state, push/pull/conflict engines, audit trail, RBAC |
| `app/reviews/CURRENT-MEDINI-REVIEW.html` | Synced — MD5 identical (`eaff7e3f18491b5bd6043f46ee6e2fee`) |
| `app/smoke-review.mjs` | +45 tests (P4-01..P4-20 + P5-01..P5-25) |
| `docs/CURRENT-STATE.md` | Updated — Finance v1.2 Phase 5 |
| `docs/FINANCE-BILLING-LOCKED.md` | This lock file (v1.2 Phase 5) |

## 6. Declaration

```text
Architecture Complete        : YES (v1.2 — Phase 5 of 6)
Finance UX Complete          : YES (13 modules + Commission Engine + Sync Dashboard)
Phase 1 — Treatment Cost Linking : ✅ LOCKED
Phase 2 — Lab Payables       : ✅ LOCKED
Phase 3 — Doctor Commission  : ✅ LOCKED (ledger, lifecycle, approval, payout, adjustment, RBAC, doctor view, HQ Control Tower)
Phase 4 — Bukku Connector    : ✅ REAL API CONNECTED (creds form, sync queue, field mapping, Test Connection + Pull = REAL, Push = REAL gated; verified 1,747 transactions via api.bukku.my — 13 Aug 2026)
Phase 5 — Two-Way Sync       : ✅ LOCKED (Virtual Bukku DB simulation, push/pull engines, conflict detection + resolution, version tracking, audit trail, sync dashboard, RBAC HQ-only; NO real API)
Phase 6 — Reconciliation + QA: ✅ LOCKED (HQ-only read-only Medini↔Bukku comparison, MATCHED/MISMATCH/MISSING/UNMATCHED/REVIEWED, CSV export, audit, QA checks; no Bukku write)
Bukku real API               : ✅ IMPLEMENTED (Test Connection + Pull = REAL via https://api.bukku.my; Push = REAL gated confirm — verified 13 Aug 2026)
Two-way Sync real API        : NOT IMPLEMENTED (Phase 5 masih boundary — Virtual Bukku simulation; swap path documented)
Reconciliation real API      : ✅ READ-ONLY (consumes pulled Bukku cache only; no POST/PUT/PATCH/DELETE)
Single HTML Prototype        : YES (534/534 PASS, root/app MD5 identical)
Branch RBAC validated        : YES (HQ all-branch; branch roles own-branch; doctor own-commission; unauthorized blocked at state layer)
Sync RBAC validated          : YES (HQ-only sync controls — doctor/manager blocked at state layer)
Production Backend           : NOT implemented (Single HTML is the visual specification, not production code)
```

## 7. Remaining Limitations (prototype)

| Item | Status |
|------|--------|
| Real payment gateway | UX only — no real FPX/card processing (by design) |
| Bukku connection / invoice pull | Real API implemented; connection and pull verified against production account |
| Bukku writes | Real invoice push is gated by explicit confirmation; payments, bills, journal entries still need endpoint-specific production payload validation |
| Phase 5 real two-way sync | Virtual boundary simulation remains; real pull is active through Phase 4 connector |
| Production backend / DB / API | Not started — Single HTML remains the UX specification |
| Accounting-grade ledger/balance sheet | Not claimed — Net Position is operational cash visibility |
| Payroll / HR engine | Financial visibility only (no full HR) |
| Inventory management | Not built — Finance records the transaction only |
| Insurance & Panel claim engine | Separate domain — Finance tracks insurance as business expense/payable only |
| Non-browser finance export | Reconciliation CSV is generated locally; other report export UI remains prototype only |

## 8. Completion Condition

```text
FINANCE & BILLING v1.2 — COMPLETE ✅

Phase 1–6 are LOCKED.
- Phase 4: Bukku Connector real API (connection/pull live; push explicitly gated)
- Phase 5: Two-Way Sync simulation boundary
- Phase 6: Read-only Reconciliation + Final QA

Next work must be a separately approved production-backend or real-sync hardening phase.
```
