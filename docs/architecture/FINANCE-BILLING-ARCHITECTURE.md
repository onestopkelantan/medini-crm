# FINANCE & BILLING — ENTERPRISE BUSINESS ARCHITECTURE v1.0

**Domain:** Financial Management · **Artifact:** `docs/FINANCE-BILLING-ARCHITECTURE.md`
**Status:** Architecture v1.0 — basis for the Single HTML Full UX Prototype
**Baseline:** Builds on Domain 1 (Patient), Domain 2 (Appointment v2), Domain 3 (Clinical) — all LOCKED

---

## 1. Finance Purpose

The Finance domain gives Medini Dental Group a single, interactive **Finance Command Center** that answers, for any permitted scope (HQ all-branches, or one branch):

> **What did we sell → What did we collect → What is outstanding → What is overdue → What did we spend → Who do we owe → What must we pay next → What is at risk → How is each branch performing → What is our cash position → What action must Finance take?**

Finance is a **Command Center / Operating System UX**, not a static dashboard. Every number is clickable and drillable to its source record.

## 2. Scope

In scope:

* Revenue & Collection (Sales, Invoices, Payments, Outstanding, Overdue, Aging, Collection Tracker)
* Expenses (Utilities, Payroll, Doctor Commission, Insurance, Taxes & Government, Premises, Maintenance, Supplies, Professional Services)
* Accounts Payable (who we must pay)
* Recurring Commitments (auto-tracked repeating obligations)
* Finance Alerts (action-required centre)
* Cash Flow (Money In vs Money Out, Net Position)
* Branch Finance (multi-branch performance + drill-down)
* Financial Reports
* Finance Configuration
* Approval flow, Audit trail, Adjustment/Void/Refund (workflow/state level)

Out of scope (separate domains, do not duplicate):

* Clinical treatment logic (Domain 3 owns care)
* Appointment scheduling (Domain 2)
* Patient identity (Domain 1)
* Insurance **panel/claim engine** (separate Insurance & Panel domain). Finance only tracks insurance as a **business expense/payable** (e.g. clinic's own policies).
* Real payment gateway integration (prototype UX only)
* Full HR/payroll engine (Finance records the financial side only)
* Full inventory management (Finance records the financial transaction only)

## 3. Boundary (Domain Ownership)

| Domain | Owns |
|---|---|
| Patient Management | Patient identity |
| Appointment Management | Scheduling |
| Clinical | Clinical care / treatment delivered |
| **Finance** | **Money** |
| Communication | Communication |

Flow:

```text
Clinical (treatment delivered)
        ↓
Finance (billable event)
        ↓
Invoice / charge
        ↓
Payment
        ↓
Collected / Outstanding
```

Finance **consumes** clinical/appointment/patient capabilities; it never recreates them.

## 4. Modules (Top Level)

```text
FINANCE
├── Finance Dashboard (Command Center)
├── Revenue & Collection
├── Expenses
├── Payables
├── Cash Flow
├── Branch Finance
├── Recurring Commitments
├── Finance Alerts
├── Financial Reports
└── Finance Configuration
```

## 5. Submodules

### Revenue & Collection
```text
Sales · Invoices · Payments · Outstanding · Overdue · Aging · Collection Tracker
```

### Expenses
```text
All Expenses · Utilities · Payroll · Doctor Commission · Insurance ·
Taxes & Government · Premises · Maintenance · Supplies · Professional Services
```

### Payables
```text
All · Pending Approval · Due Soon · Overdue · Paid
```

### Finance Alerts
```text
🔴 Critical · 🟠 Due Soon · 🟡 Upcoming · 🔵 Awaiting Approval · 🟢 Resolved
```

## 6. Entities

* **Invoice** — id, patient, branch, treatment, amount, paid, outstanding, dueDate, status
* **Payment** — id, invoice, patient, branch, amount, method, date, status, reference
* **Expense** — id, category, subcategory, branch, payee, amount, period, dueDate, status, recurring
* **Payable** — id, payee, category, branch, amount, dueDate, status, priority, approval
* **RecurringCommitment** — id, name, category, branch, amount, frequency, nextDue, autoCreate, status
* **DoctorCommission** — doctor, branch, period, treatmentRevenue, rate, gross, adjustment, netPayable, status
* **FinanceAlert** — id, severity, category, message, amount, branch, refType, refId, status
* **BillableEvent** — treatment/encounter ref → amount (Clinical → Finance bridge)
* **AuditEntry** — who, what, when, before, after, reason
* **Approval** — refType, refId, threshold, state, approver

## 7. Relationships

```text
Patient (D1) ──< Invoice >── Branch
Encounter/Treatment (D3) ──< BillableEvent >── Invoice
Invoice ──< Payment
Invoice ──< FinanceAlert (overdue)
Expense ──< Payable (when unpaid)
RecurringCommitment ──> generates Expense/Payable
DoctorCommission ── doctor, branch, period, from Treatment revenue
Payable/Expense/Commission ──< Approval (if over threshold)
All finance objects ──< AuditEntry
```

## 8. Source of Truth

| Data | Owner |
|---|---|
| Patient identity | Patient Management |
| Appointment | Appointment Management |
| Treatment | Clinical |
| Treatment delivered | Clinical |
| Billable amount | Finance |
| Invoice | Finance |
| Payment | Finance |
| Expense | Finance |
| Payable | Finance |
| Commission calculation | Finance |
| Financial alert | Finance |
| Branch financial view | Finance |
| Financial analytics | Finance / Analytics |

Finance does **not** duplicate patient or clinical ownership.

## 9. Revenue

Total sales across permitted scope. KPI clickable → Revenue & Collection filtered to Sales. Sales view: total, count, by branch / treatment / doctor / period, trend. Each segment drills down.

## 10. Collection

Total money received. KPI → Payments/Collection view. Collection Tracker shows target vs collected vs progress %.

## 11. Invoice

Statuses: `Draft · Issued · Partially Paid · Paid · Overdue · Cancelled · Refunded`. Click → invoice detail (patient, branch, treatment, amount, paid, outstanding, due date, payment history, audit).

## 12. Payment

Methods (conceptual): Cash, Card, FPX, Bank Transfer, E-Wallet, other configured. Fields: id, invoice, patient, branch, amount, method, date, status, reference. No real gateway — UX only.

## 13. Outstanding

Money still unpaid. Broken down by branch / age / patient / invoice / doctor-treatment. Total + per-segment, all clickable.

## 14. Aging

Buckets: `Current · 1–30 · 31–60 · 61–90 · 90+`. Click a bucket → invoices; click invoice → detail.

## 15. Expenses

Categories: Utilities, Payroll, Doctor Commission, Insurance, Taxes & Government, Premises, Maintenance, Supplies, Professional Services. Each record: provider/payee, branch, amount, period, due date, status, recurring, payment status. Every category clickable.

## 16. Payables

"Who do we need to pay?" Statuses: `Draft · Pending Approval · Approved · Due Soon · Overdue · Paid · Cancelled`. Payable detail: payee, ref, category, amount, branch, due, recurring, approval, payment history, notes. Actions: Approve, Schedule Payment, Mark Paid, View History.

## 17. Recurring Commitments

Finance must not manually remember monthly bills. Each: name, category, branch, amount, frequency, next due, auto-create, status (`Active · Paused · Expired · Cancelled`). Grouped Upcoming Payments: Today / Next 7 / Next 30 / Next 90 days.

## 18. Alerts

Primary feature. Severity: Critical / Due Soon / Upcoming / Awaiting Approval / Resolved. Driven by meaningful finance states (overdue invoice/payable, missing payment, recurring bill approaching, insurance renewal, tax due, commission pending, approval pending, large unexpected expense, outstanding over threshold). Thresholds configurable (demo config, not hardcoded business rules). Click alert → underlying record.

## 19. Cash Flow

Money In (Sales, Collections, other income) vs Money Out (Expenses, Payroll, Commission, Utilities, Insurance, Tax, Suppliers, Maintenance). Net Cash Flow. Interactive Cash In vs Cash Out graph (Daily/Weekly/Monthly/Quarterly/Yearly), click → breakdown. Net Position: Opening + In − Out = Closing (operational cash visibility, not accounting-grade balance sheet).

## 20. Branch Finance

Medini is multi-branch. **HQ sees all branches; branch users see only their own branch.** Branch Financial Performance table (Sales / Collected / Outstanding / Overdue / Expenses / Net per branch) — every row clickable → branch dashboard.

## 21. Doctor Commission

Important for Medini. Per doctor: branch, period, treatment revenue, commission rate, gross, adjustment, net payable, payment status. Click doctor → treatment-level breakdown.

## 22. Taxes

Taxes & Government: Cukai Pintu / Assessment, Cukai Tanah / Land Tax, corporate tax, statutory payments, government fees. Each: type, branch/HQ, amount, due, status, recurring, reference, payment status. **No hardcoded tax rates** — finance tracking UX only.

## 23. Insurance Expenses

Business expense/payable for the clinic's own policies: doctor insurance, vehicle, fire, property, other business insurance. Fields: policy, provider, branch, amount, renewal date, payment status. **Not** the Insurance & Panel claim domain.

## 24. Approval

Sensitive finance actions follow: `Draft → Pending Approval → Approved → Scheduled → Paid`. Examples: large expense, doctor commission, tax payment, insurance payment. Approval thresholds configurable.

## 25. Audit

Every finance object shows audit history: who, what, when, before, after, reason. Applies to invoice, payment, expense, payable, commission, alert, approval, adjustment.

## 26. RBAC

| Role | Finance scope |
|---|---|
| HQ | ALL branches |
| Branch Finance | Own branch only |
| Branch Manager | Own branch finance |
| Receptionist | Only permitted financial visibility; cannot alter finance unless authorized |

Unauthorized branch access is **blocked at the state layer**, not merely hidden in the menu.

## 27. Multi-Branch

HQ dashboard = All Branches aggregate + branch drill-down. Branch filter updates KPIs, graphs, revenue, collection, expenses, payables, alerts, cash flow — stateful filtering, numbers actually change.

## 28. Reporting

Reports: Revenue, Collection, Outstanding, Aging, Expense, Payables, Branch Performance, Cash Flow, Doctor Commission, Recurring Commitment, Finance Alert. Filters: date, branch, category, status. Export UI (no real file export in prototype).

## 29. UX

Professional, clean, fast, clear, enterprise-grade, low cognitive load. Uses KPI cards, interactive graphs, drill-down, tables, drawers, modals, tabs, filters, status badges, alerts, timeline. **Not** a giant spreadsheet. Prominent "What Needs Your Attention?" — each item clickable.

## 30. Cross-Domain Integration

Finance integrates with D1 (Patient), D2 (Appointment), D3 (Clinical), Analytics. Consumption only — Finance never re-implements those domains.

## 31. Clinical Integration

`Treatment → Treatment Completed → Billable Event → Invoice → Payment → Collected`. Demo data; clicking a treatment in Finance shows the related financial record.

## 32. Appointment Integration

Completed appointments/encounters drive billable events. Finance reads completion state; it does not manage scheduling.

## 33. Patient 360 Integration

Patient 360 can show financial summary where permitted: outstanding, paid, invoices, payment history. Sensitive financial info hidden from unauthorized roles.

## 34. Analytics Integration

Finance analytics (revenue trend, aging, cash flow) feed the Finance / Analytics layer; consistent with the Phase 2 analytics engine conventions.

## 35. Future Backend Implications

* Single HTML prototype is the **visual specification**, not production code.
* Backend will need: invoices, payments, expenses, payables, recurring engine (auto-create), commission calc, alerts engine (threshold-driven), approvals, audit log, RBAC/branch-scope enforcement **server-side**.
* Money must be stored as integer cents; statuses as enums; audit append-only.

## 36. Risks

* Scope creep into HR/inventory/insurance-panel — mitigated by strict boundary (§3).
* Fake/dead interactions — forbidden; every control must change visible state.
* Branch data leakage — mitigated by state-layer RBAC, not UI hiding.
* Hardcoded business rules — thresholds/rates are demo configuration.

## 37. Decisions

* **D-F01:** Finance = Command Center UX, not a static dashboard.
* **D-F02:** Branch scope enforced at prototype state layer (mirrors server-enforced model).
* **D-F03:** Payment gateway, payroll engine, inventory, insurance-panel deferred to their own domains/backend.
* **D-F04:** Insurance tracked here = business expense/payable only.
* **D-F05:** No hardcoded tax rates / commission rules — configurable demo values.
* **D-F06:** Net cash position is operational visibility, not accounting-grade.

## 38. Final Architecture

Finance & Billing v1.0 is an **additive** Single HTML full UX prototype on top of the existing locked Medini build. It introduces a Finance Command Center with 10 top-level modules, full drill-down, interactive graphs, branch-scoped RBAC, alerts, approvals, audit, scenarios, and reports — consuming Clinical/Appointment/Patient capabilities without duplicating them. Production backend is explicitly out of scope and follows after prototype validation.

```text
FINANCE & BILLING v1.0 — ARCHITECTURE — COMPLETE
```

---

## 39. v1.1 — CONFIGURATION ENGINE (added)

**Core principle:** **USERS configure DATA & PARAMETERS. SYSTEM owns FORMULAS & core logic.**

```text
BUSINESS CONFIGURATION
        ↓
FINANCE ENGINE (locked formulas)
        ↓
CALCULATED RESULTS → Dashboard · Revenue · Collection · Expenses · Payables · Cash Flow · Alerts · Reports · Branch Finance
```

When configuration changes, all dependent modules reflect the new configuration automatically (propagation).

### Locked formulas (code-owned, never user-editable)

```text
Outstanding      = Invoice Amount − Paid Amount − Valid Adjustments
Commission       = Configured Commission Base × Configured Commission Rate
Net Cash Flow    = Money In − Money Out
Days Outstanding = Today − Due Date
Alert State      = Configured Rules + Current Financial State
Lab Block        = Lab Outstanding > Configured Threshold → Block
```

Users edit **rate / amount / date / frequency / threshold / category / rule parameter** — never the formula.

### Editable configuration (14 submodules)

Company · Branches · Payment Methods · Expense Categories · Commission Rules · Recurring Categories · Recurring Commitments · Alert Thresholds · Due Date Rules · Financial Period · Approval Rules · Tax/Statutory · Insurance · Lab Rules · Finance Preferences (+ History).

### Precedence (deterministic)

```text
Global Default → Branch Override → Effective Configuration
```

### Versioned configuration + historical protection

Config changes carry version, effective date, who/what/old→new/when/why (history + audit). Changes apply to **future** calculations; **historical transactions are never rewritten** unless an explicit authorized adjustment workflow runs.

### Commission configuration (default)

- **Rate:** 40%
- **Basis:** Treatment Revenue / Billable Treatment Revenue (configurable: Net / Collected / Fixed)
- **Payout:** Twice Monthly (15th & 30th; configurable: Monthly / Weekly / Custom)

Changing 40%→45% propagates: commission → payables → cash flow → reports. Impact preview shown before save.

## 40. v1.1 — LAB PAYMENTS (added)

Dental labs create financial obligations. **Clinical owns the lab case/clinical requirement; Finance owns the money owed to the lab.**

```text
Clinical Treatment → Lab Case → Lab Cost → Finance Payable → Payment → Lab Paid
```

Lab payments integrate into **Expenses (Lab Fees) · Payables · Alerts · Reports** — no duplicate ownership.

### Lab blocking (REQUIRED)

If a lab's outstanding exceeds the **configured threshold**, a new lab case is **BLOCKED**:

```text
Lab Outstanding > Configured Lab Threshold → New Lab Case → BLOCKED
```

The threshold is configurable (default RM5,000); the block formula is locked. Recording a lab payment reduces outstanding and **removes the block** when back under threshold.

## 41. v1.1 — ATTENTION → DETAIL DRAWERS (added)

Every "What Needs Your Attention" item opens a **contextual detail drawer** (not silent navigation) showing what/amount/branch/due/status/why/actions, then drills to the underlying record (invoice, payable, recurring, commission, lab).

---

## 42. v1.2 — FINANCE ENHANCEMENT ROADMAP (6 phases)

```text
PHASE 1  Treatment Cost Linking          ✅ COMPLETE / LOCKED
PHASE 2  Lab Payables                    ✅ COMPLETE / LOCKED
PHASE 3  Doctor Commission Engine        ✅ COMPLETE / LOCKED (CURRENT)
PHASE 4  Accounting Connector / Bukku API ⏳ NOT IMPLEMENTED (future)
PHASE 5  Two-Way Related Data Sync       ⏳ NOT IMPLEMENTED (future)
PHASE 6  Reconciliation + Final QA       ⏳ NOT IMPLEMENTED (future)
```

## 43. PHASE 1 — TREATMENT COST LINKING (implemented)

**Objective:** when a dentist performs a treatment that creates an external lab cost, the cost is recorded against the **Treatment Case** with a traceable **Lab Invoice Number**, and Finance can immediately see and trace that cost back to the Patient and Clinical Treatment Case.

```text
🦷 CLINICAL
└── Treatment Case
      ├── Patient / Doctor / Branch / Treatment / Encounter / Plan
      └── External Cost (Lab)
            ├── Lab Name / Invoice Number / Invoice Date / Case Reference / Amount / Notes
            ↓
💰 FINANCE
   Treatment Costs (Phase 1 view)
            ↓
   Phase 2 Lab Payables → Phase 3 Commission → Phase 4 Bukku → Phase 5 Sync → Phase 6 Reconciliation
```

### Clinical changes

- Treatment Case supports **External Treatment Cost** (multi-cost capable, Phase 1 prototypes Lab Cost)
- UX: "Does this treatment involve an external lab? [Yes/No]" → Lab select + Invoice No + Invoice Date + Case Reference + Amount + Notes
- Validation (locked): invoice number non-blank when enabled, amount numeric > 0, lab required, invoice date valid

### Finance changes

- New module **🧾 Treatment Costs** (module #11, after Configuration)
- Table: Date / Branch / Patient / Doctor / Treatment / Lab / Invoice / Cost / Status (`Linked` | `Pending Finance Review`)
- Click row → detail drawer (patient, doctor, branch, treatment, lab, invoice, date, case ref, amount, source `Clinical Treatment Case`) with [View Patient → Patient 360] and [View Treatment Case → Clinical]
- Filters: date / branch / lab / status; search: patient, invoice, lab, doctor, treatment
- Dashboard KPI: **Treatment Costs** (clickable → Treatment Costs view) — NOT labelled "Lab Payables" (Phase 2)
- Monthly lab statement: **1 statement → many entries → many patients/cases** (e.g. Super Dental Lab July 2023, 5 entries, total RM706); each entry links to its Treatment Case

### Key reference

The **Lab Invoice Number** (e.g. `SIV 100450`) is the linkage key between Clinical and Finance — never patient name or treatment name alone.

### Explicitly NOT implemented (Phase 1 boundary)

- Lab Payables engine (Phase 2) — statuses only `Linked` / `Pending Finance Review`, no Payable/Paid/Overdue
- Doctor Commission calculation (Phase 3) — cost record carries enough data for future `Gross Revenue − Eligible Direct Costs = Commissionable Base`
- Bukku API (Phase 4) — **no API calls, no fake endpoints, no invented responses**
- Two-way sync (Phase 5), Reconciliation (Phase 6)

## 44. BUKKU — FUTURE INTEGRATION DEPENDENCY (documented)

```text
Accounting Platform : Bukku
Official API docs   : https://developers.bukku.my/
Integration status  : PLANNED
Current phase       : NOT IMPLEMENTED
Target phase        : PHASE 4
```

Preserved for future implementation. No fake API connectivity, no hardcoded fake responses, no invented endpoint names, no credentials/tokens.

## 45. DATA RELATIONSHIP (Phase 1)

```text
Patient
  └── Treatment Case
        ├── Treatment / Doctor / Branch
        └── Lab Cost (Lab / Invoice No / Invoice Date / Case Ref / Amount)
Finance reads: Treatment Case → Lab Cost  (no duplicated clinical records)
```

Operating expenses (electricity, water, internet, rent, insurance, general maintenance) are **NOT** treatment costs — they remain normal Finance expenses. Lab cost is a potential **direct** treatment cost (future commission-deductible category per Phase 3 rules).

---

## 46. PHASE 2 — LAB PAYABLES ENGINE (implemented)

**Objective:** Finance converts a Phase 1 Treatment Cost into a **Lab Payable** — the obligation owed to the lab — and tracks when due, how much paid, what remains outstanding, and how payment affects operational cash flow.

```text
Clinical Treatment Case → Lab Cost (Phase 1) → Lab Payable (Phase 2) → Outstanding → Payment → PAID
```

### Lab Payable lifecycle

`DRAFT → OUTSTANDING → PARTIALLY PAID → PAID` (+ `VOID`). Overpayment is **blocked**. Status engine (locked):

```text
Outstanding = Original − Paid (− Adjustments)
Overdue     = Outstanding > 0 AND Today > Due Date
OverdueDays = Today − Due Date
```

### Auto-creation from Treatment Cost

When a valid Phase 1 Lab Cost exists, Finance creates the payable **without retyping** patient/lab/invoice/treatment/amount — all come from the linked Treatment Cost. Source preserved: `Clinical Treatment Case` + `Treatment Cost ID` + `Lab Invoice Number`. **Duplicate protection:** Lab + Invoice Number (+ Case Reference) prevents accidental double-payable.

### Due date (formula locked)

`Due Date = Invoice Date + Effective Payment Term`. Payment term configurable via **Lab Payment Rules**: Global default (Net 30) → Lab override (e.g. Lab A = 14 days) → Effective rule. Existing payables keep the term applicable at creation (effective-date integrity).

### Payment recording

Fields: Payment Date / Amount / Method / Reference / Notes. Full and partial payments supported; every payment updates Cash Flow (Money Out) and writes an audit entry (actor/date/amount/method/ref/old→new status). Historical payments are never deleted (Void/Adjustment pattern).

### Finance integration

- Payables module → **🧪 Lab Payables** tab (KPIs: Outstanding / Due This Week / Overdue)
- Monthly lab statement entries → Create Payable per entry (1 statement → many entries → many payables)
- Cash Flow Money Out includes Lab Payments (single underlying transaction, no double-count)
- Branch RBAC preserved (HQ all / branch own / unauthorized blocked at state layer)

### Phase 3/4 boundary (preserved, not implemented)

- Lab Payable preserves the cost linkage needed by Phase 3 commission (`Gross Revenue − Eligible Lab Cost = Commissionable Base`).
- Future sync fields (`accountingRef`, `externalPayRef`, `lastSync`) are placeholders — **not synced**, no Bukku calls (Phase 4).

---

## 47. PHASE 3 — DOCTOR COMMISSION ENGINE (implemented)

**Objective:** answer per doctor — "berapa production/treatment yang dihasilkan, berapa direct clinical cost, berapa commission yang layak, berapa approved/paid, berapa net tinggal?" Doctor = commission beneficiary. **NO branch commission domain.**

```text
Clinical Treatment Case (Doctor / Treatment / Revenue / Lab / X-Ray / Add-on)
        ↓
DOCTOR COMMISSION ENGINE (rules + eligibility + calculation)
        ↓
Commission Ledger (single source of truth)
        ↓
Approval → Schedule → Payout → Paid
        ↓
Doctor View (own) / HQ Control Tower (all)
```

### Formula (locked, from config — never hardcoded in views)

```text
Eligible Revenue − Eligible Direct Clinical Costs = Commission Base
Commission = Commission Base × Commission Rate
```

Direct clinical costs: **Lab Cost** (consumes Phase 1/2 linkage, no duplicate payable), **X-Ray**, **Add-on**. General business expenses (rent, utilities, staff salary, marketing, tax) are NOT doctor deductions.

### Lifecycle

`CALCULATED → PENDING REVIEW → APPROVED → SCHEDULED → PAID` (+ `REJECTED` / `ADJUSTED` / `VOID`). No hard delete — historical trace retained.

### Commission Ledger (single record)

Commission ID · Doctor ID/Name · Branch · Treatment Case ID · Patient/MRN · Treatment · Date · Gross Revenue · Lab/X-Ray/Add-on/Other costs · Base · Rate · Commission · Period · Rule Version · Status · Approval/Payout info · Source references · Adjustments (original/adjustment/final/reason/who/when).

### Key behaviours

- **Duplicate protection:** one commission per Doctor + Treatment Case + Rule Version + Period — no double records
- **Adjustment:** original retained; adjustment stored with reason + actor; audit mandatory
- **Void/refund/correction:** safe via adjustment/void/recalculation, never silent delete
- **Effective dates / rule versions:** historical calculations preserved under the rule applicable at the time
- **Payout:** separate from calculation; payout record = ID/doctor/period/amount/date/method/ref/status/approved-by/paid-by

### RBAC (state-layer, not UI hiding)

- **HQ:** all doctors, all branches — Control Tower + approve/schedule/pay/adjust/reject
- **Doctor:** own doctor ID only — My Commission (summary + treatment breakdown + cost breakdown + history + payouts); self-approval blocked; other doctor/branch blocked
- **Branch Manager:** existing own-branch scope (no branch commission authority)
- **Receptionist:** no commission financial truth

### Views

- **HQ Control Tower** (Finance → Expenses → Doctor Commission): KPIs (Gross Production / Direct Costs / Base / Calculated / Pending / Approved / Scheduled / Paid) + per-doctor drill → treatment breakdown → commission detail
- **Doctor My Commission** (Finance → Expenses → Doctor Commission + workspace 💰 My Commission card): summary, treatment breakdown (traceable to case), **cost breakdown not collapsed** (Lab/X-Ray/Add-ons visible so doctor understands "kenapa income aku jadi RM1,600?"), payout history

### Phase 4 boundary

No Bukku calls. `accountingRef`/`externalPayRef`/`lastSync` remain future placeholders.

## 48. PHASE 4 — BUKKU ACCOUNTING CONNECTOR (implemented — REAL API v1.2.1)

**Status:** ✅ CONNECTED via real Bukku API (https://api.bukku.my). API key diterima dari client 13 Aug 2026 — verified 1,747 transactions.

### Objective

Accounting integration with Bukku (https://developers.bukku.my/) — credentials, sync queue, field mapping, real connection. Real API calls aktif (bukan boundary lagi).

### API details

| Item | Value |
|------|-------|
| Base URL | `https://api.bukku.my` (production) |
| Auth | `Authorization: Bearer <AccessToken>` |
| Company ID | `Company-Subdomain: medinidentalgroup` |
| Accept | `application/json` |
| Rate limit | 600 req/min |
| Verified | 13 Aug 2026 — GET /sales/invoices → HTTP 200, 1,747 transactions |

### Implemented

| Component | Detail |
|-----------|--------|
| `BUKKU` state object | `creds` (apiKey, companyId, baseUrl), `status` (AWAITING_CREDENTIALS → READY → CONNECTED/ERROR), `queue`, `mapping`, `lastSync`, `lastConnTest`, `liveInvoices[]`, `liveTotal`, `audit` |
| `bukkuInit` | Load credentials dari localStorage (key TIDAK hardcode dalam source — hanya di browser user) |
| `bukkuFetch` | Real fetch wrapper — Authorization Bearer + Company-Subdomain + Accept headers, JSON parse, { ok, status, data } |
| Credentials form | HQ-only, API key password-type, company subdomain + base URL editable, saved ke localStorage |
| Test Connection | **REAL** — GET /sales/invoices?page=1&per_page=1 → status CONNECTED + liveTotal transactions |
| Pull Invoices | **REAL** — GET /sales/invoices?page=1&per_page=8 → liveInvoices[] dipapar dalam UI |
| Push (Real) | **REAL gated** — POST /sales/invoices → create transaction sebenar; confirmation dialog sebelum create; status → SYNCED + Bukku transaction id |
| Sync queue | Invoices (first 5), Payables (first 3), Commission Payouts (first 2) auto-enqueued QUEUED |
| Field mapping view | Invoice → /sales/invoices, Payment → /sales/payments, Payable → /purchases/bills, Commission Payout → /journal_entries |
| Module + route | `🔗 Bukku Connector` in Finance nav (`bukku` → `bukkuQueueView`) |
| Live table | Selepas pull — invoice number, date, contact, amount, status dari Bukku real |

### Security notes

- API key **tidak pernah** dalam source code / repo — disimpan localStorage browser HQ
- Push real ada confirmation gate (prevent accidental transaction dalam production account)
- Key dalam chat/email perlu rotate selepas setup (key terdedah semasa transit)

## 49. PHASE 5 — TWO-WAY RELATED DATA SYNC (implemented — boundary only)

**Status:** SIMULATED — awaiting real API key from client. Virtual Bukku DB in-memory. All buttons functional.

### Objective

Bina two-way sync simulation antara Medini CRM dan Bukku (masih boundary — tiada real API):
1. **Medini → Bukku (Push):** invoice created/updated, payment recorded, lab payable paid, commission payout → queue for sync
2. **Bukku → Medini (Pull):** simulated Bukku changes (e.g. invoice marked paid in Bukku) → reflect in Medini; conflict detection (same record edited both sides) → resolution UI; sync status per record (SYNCED / PENDING / CONFLICT / ERROR)
3. **Sync Dashboard:** last sync time, records synced today, pending queue, conflicts requiring attention, error log
4. **Data consistency:** Medini ID ↔ Bukku ID mapping, version tracking (optimistic locking simulation), audit trail for all sync operations

### Architecture

```
┌─────────────┐   PUSH (queue → VIRTUAL_BUKKU store)   ┌──────────────┐
│  MEDINI CRM │ ─────────────────────────────────────→  │  VIRTUAL     │
│  (real UI)  │ ←─────────────────────────────────────  │  BUKKU DB    │
└─────────────┘   PULL (version check → conflict? →    └──────────────┘
                 apply update / raise conflict)
```

### Implemented components

| Component | Detail |
|-----------|--------|
| `VIRTUAL_BUKKU` | In-memory "other side": `invoices` / `payments` / `payables` / `commissionPayouts` stores + `idMap` (mediniId → bukkuId `BK-<refId>`) + `version` (optimistic locking) |
| `SYNC` state | `lastSync`, `syncedToday`, `conflicts[]`, `audit[]` (max 50), `status` (IDLE/SYNCING/ERROR) |
| Push engine | `syncPushRecord(type, mediniId, data)` — type normalization via `syncTypeStore` (invoice/payment/payable/commissionPayout), creates ID mapping, increments version, updates queue → SYNCED, writes audit |
| Pull engine | `syncPullRecord(type, bukkuId)` — version compare (Medini one-behind simulation), conflict detection via `syncConflictCheck`, applies non-conflict updates to Medini (e.g. invoice status), writes audit |
| Bukku edit simulation | `syncSimulateBukkuChange` + `syncSimulateRandomBukkuChange` — external edit → version bump → next pull raises conflict |
| Conflict resolution | `syncResolveConflict(conflictId, 'medini'|'bukku')` — Use Medini pushes Medini value to Bukku; Use Bukku pulls Bukku value into Medini; status → RESOLVED_MEDINI / RESOLVED_BUKKU |
| Sync Dashboard | `syncDashboardView()` — 4 KPI cards (Last Sync / Synced Today / Pending Queue / Conflicts) + controls (Run Full Sync, Push Pending Only, Pull from Bukku Only, Simulate Bukku Edit) + conflicts panel + queue table with version column + audit trail (latest 20) + Virtual Bukku DB status |
| Module + route | `🔄 Sync Dashboard` in Finance nav (`sync` → `syncDashboardView`); link button from Bukku Connector view |
| RBAC | `bukkuCanUse()` = role HQ + creds present — all sync controls gated |

### Sync status lifecycle

```
QUEUED → SYNCED   (push succeeds)
QUEUED → ERROR    (push fails — reserved)
SYNCED → CONFLICT (external edit detected on pull)
CONFLICT → RESOLVED_MEDINI | RESOLVED_BUKKU (resolution action)
```

### Boundary rules (sama macam Phase 4)

- ❌ NO real API calls to Bukku
- ❌ NO fake credentials
- ❌ NO real HTTP requests
- ✅ All simulated in-memory
- ✅ Status shows "SIMULATED — awaiting real API key"
- ✅ HQ-only access for sync controls
- ✅ Real API swap path: replace `VIRTUAL_BUKKU` store writes with HTTP calls to https://developers.bukku.my/ — sync logic (queue/conflict/version/audit) is interface-based and carries over unchanged

## 50. PHASE 6 — RECONCILIATION + FINAL QA (implemented — read-only)

**Status:** ✅ LOCKED. Finance v1.2 roadmap complete (6/6). Reconciliation is deliberately **read-only**: it does not create, update, or delete a Bukku transaction.

### Objective

Provide an HQ finance control point to compare Medini records against the currently pulled Bukku invoice dataset, identify discrepancies, document a review decision, export evidence, and run final integrity checks before a production accounting workflow is relied upon.

### Reconciliation model

| Status | Meaning | Action |
|--------|---------|--------|
| `MATCHED` | A Medini invoice found a Bukku match and the amount is equal | No action required |
| `MISMATCH` | Matching record found but amount differs | Investigate, then Mark Reviewed |
| `MISSING_IN_BUKKU` | Medini invoice has no matching Bukku record | Investigate, then Mark Reviewed |
| `UNMATCHED_BUKKU` | Pulled Bukku invoice has no Medini match | Investigate, then Mark Reviewed |
| `REVIEWED` | HQ documented an accepted/investigated decision | Retained on re-run via reconciliation identity |

### Matching and safety rules

- Matching normalises document numbers (letters/digits only, uppercase), then checks a known Medini↔Bukku mapping when available.
- Amount comparison uses a MYR tolerance of `< 0.01`.
- Each reconciliation identity is unique (`RC-MD-<index>-<MediniID>` / `RC-BK-<index>-<BukkuID>`), preventing duplicate results.
- Existing review decisions survive a re-run for the same Medini/Bukku identity.
- `reconRun()` reads only `BUKKU.liveInvoices` (real pull cache) or the Phase 5 virtual invoice store as fallback; it does not invoke POST/PUT/PATCH/DELETE.
- Export creates a local CSV (`medini-bukku-reconciliation.csv`); export itself is audited.

### Implemented components

| Component | Detail |
|-----------|--------|
| `RECON` state | `runAt`, `records[]`, `audit[]` (max 50), `filter`, `qa[]` |
| `reconBuildRecords` | Compares up to 12 scoped Medini invoices against pulled real Bukku invoice data or virtual fallback; adds unmatched Bukku rows |
| `reconRun` | HQ-only read-only run; builds records, sets KPIs, creates QA checks and audit event |
| `reconResolve` | HQ-only Mark Reviewed decision; records auditable resolution without changing accounting data |
| `reconExport` | HQ-only local CSV export containing status, references, amounts, findings and resolution |
| `reconcileView` | Finance `⚖️ Reconciliation` module: run/export controls, 5 KPI cards, filters, results table, QA panel, reconciliation audit trail |
| RBAC | Non-HQ sees access-required state; state-level guards block run, review, and export |

### Final QA checks

1. Bukku connection/cache state available.
2. No duplicate reconciliation identities.
3. Every reconciliation record has an explicit status.
4. Reconciliation audit trail is enabled.

### Test coverage

`P6-01..P6-25`: route/workspace, reconciliation run, status/identity integrity, KPI/filter/table UI, discrepancy detection, reviewed resolution, audit, QA, read-only cache guarantee, CSV export, HQ RBAC, amount normalisation, safety disclosure, co-existence with Sync Dashboard, and zero JS errors.

**Result:** 25/25 PASS. Full finance prototype regression: **534/534 PASS**.
