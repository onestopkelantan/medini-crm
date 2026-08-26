# MEDINI FINANCE ↔ BUKKU — SCOPE & BOUNDARY v1.0

**Artifact:** `docs/MEDINI-FINANCE-BUKKU-SCOPE.md`
**Date:** 14 Ogos 2026 · **Author:** Neo (Principal Solution Architect)
**Status:** AUDIT + ARCHITECTURE ONLY — NO IMPLEMENTATION. M1 Fasa 2 belum start. 768 tests untouched.
**Source:** `CURRENT-MEDINI-REVIEW.html` (actual HTML sebagai source of truth, bukan andaian)

> ## CORE PRINCIPLE (LOCKED)
> **Medini Finance** = Operational Financial Tracker + Alert/Due-Date Tracker + CRM-relevant visibility + HQ/Branch operational control.
> **Bukku** = Accounting + Financial Transaction System + Ledger + Complete Financial Record.
> **MEDINI ≠ MIRROR OF BUKKU.** Hanya CRM-relevant records di-project ke Medini Finance.

---

## 1. FINANCE DOMAIN PURPOSE

Medini Finance menjawab soalan operasi klinik, BUKAN soalan accounting:

> "Apa yang kami jual → apa yang dah kutip → apa yang outstanding → apa yang overdue → bil apa yang kena bayar → bila due → komisen doctor berapa → kos rawatan berapa → cawangan mana perform → apa yang HQ kena bayar minggu ni?"

Medini Finance **BUKAN**:
- ❌ Accounting software
- ❌ ERP / Inventory system
- ❌ Full Bukku clone
- ❌ Ledger / journal engine
- ❌ Payment gateway

---

## 2. CURRENT FINANCE INVENTORY (dari HTML sebenar)

**14 Finance modules** (`FIN_MODULES`, line 8642):

| # | Module | Purpose | Record Type | Source |
|---|---|---|---|---|
| 1 | 📊 Dashboard | Finance KPIs + attention | aggregated | FIN_MODEL |
| 2 | 💵 Revenue & Collection | sales, invoices, payments, outstanding, aging, collection | FIN.invoices/payments | finBuild (deterministic demo) |
| 3 | 📉 Expenses | expenses + **lab expenses** sub-view | FIN.expenses, FIN.labPayments | finBuild |
| 4 | 💸 Payables | bills to pay + approval | FIN.payables | finBuild |
| 5 | 🏦 Cash Flow | money in/out, net position | derived | FIN_MODEL |
| 6 | 🏬 Branch Finance | per-branch performance | derived | FIN_MODEL |
| 7 | 🔁 Recurring | recurring commitments + upcoming payments | FIN.recurring | finBuild |
| 8 | 🚨 Alerts | finance alert centre | FIN.alerts | finRebuildAlerts |
| 9 | 📑 Reports | financial reports | derived | finViewReports |
| 10 | ⚙️ Config | payment methods, categories, thresholds, lab rules | FIN_CFG / FINCONF | static config |
| 11 | 🧾 Treatment Costs | clinical-linked costs + lab statements | TC_STATE.costs, TC_STATEMENTS | tcBuild |
| 12 | 🔗 Bukku Connector | connection + sync queue + push | BUKKU | bukkuFetch (REAL) |
| 13 | 🔄 Sync Dashboard | two-way sync simulation | VIRTUAL_BUKKU / SYNC | SIMULATED |
| 14 | ⚖️ Reconciliation | Medini↔Bukku read-only compare | RECON | reconBuildRecords (PARTIAL) |

### Current Finance record structures (verified)

**FIN store (line 8360):** `{ invoices, payments, expenses, payables, recurring, commissions, alerts, audit, trend, labPayments }`

| Record | Fields (verified) | Nature |
|---|---|---|
| `FIN.invoices` | id, patient, mrn, branch, treatment, doctor, doctorId, amount, paid, outstanding, due, status (Paid/Partially Paid/Issued/Overdue/Draft) | deterministic demo |
| `FIN.payments` | id, invoice, patient, branch, amount, method, date, status (Completed), ref | deterministic demo |
| `FIN.expenses` | id, category, sub, payee, branch, amount, period, due, status, recurring, ref | deterministic demo |
| `FIN.payables` | id, payee, category, branch, amount, due, status, priority, approval, ref | deterministic demo |
| `FIN.recurring` | id, name, category, branch, amount, frequency, nextDue, autoCreate, status | deterministic demo |
| `FIN.commissions` | doctor, branch, netPayable, status, ... | finBuildCommissions |
| `FIN.labPayments` | id, lab, caseType, caseRef, patient, branch, amount, paid, outstanding, due, status | finBuildLab |
| `FIN.alerts` | id, severity, category, message, amount, branch, refType, refId, status | finRebuildAlerts |

### Config (FIN_CFG, line 8312) — VERIFIED
- `paymentMethods`: Cash, Card, FPX, Bank Transfer, E-Wallet, Insurance
- `expenseCategories`: Utilities, Payroll, Doctor Commission, Insurance, Taxes & Government, Premises, Maintenance, Supplies, Professional Services
- `recurringCategories`: Utilities, Rent, Insurance, Software, Maintenance, Subscription, Tax, Other
- `approvalThreshold: 10000`, `commissionRate: 0.20`, `outstandingThreshold: 200000`, `collectionTarget: 500000`

---

## 3. CURRENT BUKKU INTEGRATION

| Capability | Status | Evidence |
|---|---|---|
| API helper `bukkuFetch` | ✅ REAL | Bearer + Company-Subdomain header (10688) |
| Test connection | ✅ REAL | GET `/sales/invoices?page=1&per_page=1` (10725) |
| Pull invoices | ✅ REAL (read-only) | GET `/sales/invoices` (10750) |
| Push invoice | ✅ REAL (gated, HQ+confirm) | POST `/sales/invoices` (10797) |
| Sync queue | ✅ REAL | BUKKU.queue (10821) |
| Two-way sync | ⚠️ SIMULATED | VIRTUAL_BUKKU (10882) |
| Conflict detection | ⚠️ SIMULATED | syncConflictCheck (10905) |
| Reconciliation | ⚠️ PARTIAL | reconBuildRecords (11214), match by normalized number |
| Pull payments | ❌ MISSING | endpoint belum dipanggil |
| Webhook | ❓ UNVERIFIED | tiada dalam code/docs |
| Incremental cursor | ❌ MISSING | tiada `updated_at` filter |

**Field mapping existing (line 10856):** Invoice→`/sales/invoices`, Payment→`/sales/payments`, Payable→`/purchases/bills`, Commission→`/journal_entries`.

---

## 4. RECURRING PAYMENT AUDIT

### Dalam Medini Finance (FIN.recurring) — VERIFIED WUJUD

`finBuild` (8401) generate recurring per branch:
- **Electricity (TNB)** — Utilities, Monthly
- **Water (SAJ)** — Utilities, Monthly
- **Internet (Unifi)** — Utilities, Monthly
- **Clinic Rent** — Rent, Monthly
- **Fire Insurance** — Insurance, **Yearly**
- **Software Subscription** — Software, Monthly

Frequency support: **Monthly, Yearly** (line 8403: `ri===4 ? 'Yearly' : 'Monthly'`).

### Recurring categories (FIN_CFG) — VERIFIED
Utilities, Rent, Insurance, Software, Maintenance, Subscription, Tax, Other

### Status kewajipan berulang dalam prompt vs HTML:

| Item | Dalam Medini | Dalam Bukku | Status |
|---|---|---|---|
| Electricity | ✅ FIN.recurring (TNB) | ❓ UNVERIFIED | EXISTING (Medini), UNVERIFIED (Bukku) |
| Water | ✅ FIN.recurring (SAJ) | ❓ UNVERIFIED | EXISTING / UNVERIFIED |
| Internet/WiFi | ✅ FIN.recurring (Unifi) | ❓ UNVERIFIED | EXISTING / UNVERIFIED |
| Rent | ✅ FIN.recurring (Clinic Rent) | ❓ UNVERIFIED | EXISTING / UNVERIFIED |
| Clinic insurance | ✅ FIN.recurring (Fire Insurance) | ❓ UNVERIFIED | EXISTING / UNVERIFIED |
| Doctor insurance | ⚠️ expenses (Doctor Indemnity sub) | ❓ UNVERIFIED | PARTIAL |
| Assessment / Cukai Pintu | ⚠️ expenses (Taxes & Government sub) | ❓ UNVERIFIED | PARTIAL |
| Doctor commission | ✅ FIN.commissions | ⚠️ `/journal_entries` mapping | EXISTING / PARTIAL |
| Lab payment | ✅ FIN.labPayments | ❓ UNVERIFIED | EXISTING / UNVERIFIED |
| Supplier payment | ⚠️ payables (generic payee) | ❓ UNVERIFIED | PARTIAL |
| Maintenance | ⚠️ expenseCategories | ❓ UNVERIFIED | PARTIAL |
| Software subscription | ✅ FIN.recurring | ❓ UNVERIFIED | EXISTING / UNVERIFIED |

**PENTING:** Semua data Medini ni = **deterministic DEMO data** (`mulberry32` PRNG), BUKAN real Bukku data. Bukku side = **UNVERIFIED** sebab aku tak boleh query Bukku API dari sini (perlu credentials + network). Aku **TAK invent** Bukku data.

---

## 5. CRM-RELEVANT FINANCIAL RECORDS (Class A)

Records yang **MESTI / patut** muncul dalam Medini Finance Tracker — kerana ia membantu klinik beroperasi, track obligation, faham patient payment, monitor branch, atau bantu HQ decide.

| Record | Kenapa CRM-relevant | Medini status |
|---|---|---|
| Patient payment status | Front-desk perlu tahu PAID/PENDING/OVERDUE | ✅ (M1 contract layer) |
| Patient invoice (treatment value) | kaitan treatment→payment | ✅ FIN.invoices |
| Patient outstanding/overdue | collection tracking | ✅ FIN.invoices |
| Treatment cost (clinical-linked) | margin per treatment | ✅ TC_STATE.costs |
| Lab payment / lab cost | blocking rule bila outstanding | ✅ FIN.labPayments |
| Doctor commission (summary) | payout tracking | ✅ FIN.commissions |
| Branch bills (utilities/rent/internet) | due-date + payment status tracking | ✅ FIN.recurring/payables |
| Clinic insurance | renewal alert | ✅ FIN.recurring |
| Recurring commitments | "apa yang kena bayar bulan ni" | ✅ FIN.recurring |
| Branch operating expenses | branch P&L visibility | ✅ FIN.expenses |
| Payables (bills to pay) | HQ payment queue | ✅ FIN.payables |
| Collection (money in) | cash position | ✅ FIN.payments |

## 6. BUKKU-ONLY FINANCIAL RECORDS (Class C)

Records yang **kekal dalam Bukku** — accounting-level, tak membantu operasi klinik secara langsung.

| Record | Kenapa Bukku-only |
|---|---|
| General ledger entries (jurnal am) | accounting detail, bukan operational |
| Chart of accounts | accounting structure |
| Tax computation/detail (SST/corporate) | accounting compliance — Medini hanya track *obligation* (due date), bukan computation |
| Bank reconciliation detail | accounting process |
| Depreciation / asset accounting | accounting-only |
| Stock valuation (jika ada) | inventory accounting |
| Journal adjustments / corrections | accounting-only |
| Opening balance / equity | accounting-only |
| Full audit ledger | Bukku = complete record |

**Nota:** Ini **cadangan klasifikasi**, bukan keputusan final — prompt section 4 arah jangan hardcode. Business owner verify.

## 7. OPTIONAL / CONFIGURABLE FINANCIAL RECORDS (Class B)

Boleh muncul **kalau HQ configure** — tak wajib, tapi disokong oleh configurable tracker.

| Record | Default | Configurable |
|---|---|---|
| Security system maintenance | OFF | ✅ HQ boleh tambah |
| Dental equipment service contract | OFF | ✅ |
| New supplier payment | OFF | ✅ |
| Marketing software subscription | OFF | ✅ |
| Professional services (accounting/audit/legal) | ✅ dalam expenses | ✅ toggle detail |
| Cukai Tanah / Cukai Pintu | ⚠️ sebagai expense | ✅ boleh jadi recurring tracker |

---

## 8. PATIENT FINANCE BOUNDARY

Patient finance = **SPECIAL**, diasingkan dari operational expenses.

```
PATIENT → TREATMENT → EXTERNAL PAYMENT → BUKKU/FINANCE → PAYMENT STATUS → MEDINI
```

- CRM payment status: **PENDING / PAID / OVERDUE** (M1 contract layer, LOCKED).
- Patient payment **BUKAN** generic supplier bill.
- Patient identity: **patientId / MRN / approved mapping** — JANGAN guna nama sahaja.
- Patient invoice boleh sync ke Bukku (M→B) sebagai sales invoice.
- Patient payment status sync dari Bukku (B→M) sebagai projection.
- Patient finance muncul dalam Patient 360 (contextual, bukan Finance module access).

---

## 9. HQ FINANCE BOUNDARY

HQ = payment execution + financial control.

**HQ nampak & buat:**
- Full CRM-relevant Finance Tracker (semua branch)
- Review / Approve / Pay / Reconcile
- Update Bukku (push)
- Recurring commitments management
- Commission approval
- Bills payment (payables)
- Sync status + reconciliation
- Corporate finance (payroll, tax, insurance, cash flow)

**HQ sahaja** boleh: configure Finance Tracker categories, manage Bukku credentials, resolve conflicts, run reconciliation.

## 10. BRANCH FINANCE BOUNDARY

Branch = report / track / submit / view status. **BUKAN accounting department.**

| Role | Nampak | BOLEH | TIDAK BOLEH |
|---|---|---|---|
| **Branch Manager** | own branch sales, collection, outstanding, overdue, expenses, treatment costs, branch bills, payment tracker, alerts | submit bill (M1 Fasa 3 Bill Tracker), track status | corporate finance, payroll, tax, Bukku credentials, reconciliation, other branches |
| **Receptionist** | patient payment status, collection status, patient financial context | confirm patient payment (PENDING→PAID) | corporate finance, payables, branch P&L, Bukku |
| **Doctor** | own patient payment status, own treatment value, own commission (where permitted) | view own clinical-financial context | branch finance, HQ controls, other doctors' finance |

---

## 11. CONFIGURABLE TRACKER MODEL

**Prinsip:** Finance = SATU domain. Tambah tracker item ≠ tambah domain baru.

### Generic Financial Item structure
```
FinancialItem
├── id              (TRK-XXXX)
├── category        (configurable: Utilities/Rent/Insurance/Supplier/...)
├── subcategory     (optional)
├── description
├── payee / vendor
├── amount
├── frequency       (one-off/weekly/monthly/quarterly/yearly)
├── dueDate
├── nextDueDate     (computed dari frequency)
├── status          (PENDING/DUE_SOON/OVERDUE/PAID/CANCELLED)
├── priority        (High/Medium/Low)
├── branchId
├── responsibleTeam
├── reference       (Medini ref)
├── source          (MANUAL | BUKKU_SYNC | RECURRING_ENGINE)
├── bukkuRef        (Bukku transaction ID, kalau synced)
├── lastSync
└── notes
```

### Statuses (KISS)
```
PENDING    — belum bayar, belum near due
DUE_SOON   — near due (dalam tempoh amaran)
OVERDUE    — dah lepas due
PAID       — dah settle
CANCELLED  — dibatalkan
```

### Configurability
HQ boleh tambah **category baru** + **item baru** tanpa developer:
- Category = configurable list (existing `FIN_CFG.expenseCategories`/`recurringCategories` pattern).
- Item = FinancialItem dengan category dari list.
- Tambah item baru → auto masuk tracker + dashboard + alerts.
- **TIDAK** auto-create accounting transaction — mapping ke Bukku perlu explicit (section 12).

---

## 12. BUKKU MAPPING MODEL

Bila HQ create Finance Tracker item, mapping ke Bukku:

```
FinanceTracker item
   ↓
Integration Mapping
   ↓
┌─────────────────────────────────┐
│ mapping known?                  │
│  YES → SYNCABLE                 │
│  NO  → REQUIRES_MAPPING         │
└─────────────────────────────────┘
```

### Mapping table (per category → Bukku endpoint)
| Finance Category | Bukku Endpoint | Sync direction | Default |
|---|---|---|---|
| Patient invoice | `/sales/invoices` | M→B + B→M | SYNCABLE |
| Patient payment | `/sales/payments` | M→B + B→M | SYNCABLE |
| Branch bill (utilities/rent) | `/purchases/bills` | M→B (submit) + B→M (status) | SYNCABLE |
| Doctor commission | `/journal_entries` | M→B (posting) | SYNCABLE |
| Supplier payment | `/purchases/bills` | M→B + B→M | SYNCABLE |
| Custom/new category | unknown | — | **REQUIRES_MAPPING** |

### Rules
- **SYNCABLE** — mapping verified, boleh sync dua arah (dengan idempotency).
- **REQUIRES_MAPPING** — mapping belum verify → jangan auto-post, masuk review.
- **JANGAN** invent Bukku account codes.
- **JANGAN** auto-post unverified financial record.
- Custom item → default REQUIRES_MAPPING sampai HQ assign endpoint/category Bukku.

---

## 13. BIDIRECTIONAL SYNC SCOPE

### A. Medini → Bukku (HQ/receptionist action)
```
MEDINI (payment status / bill submit)
   ↓ Integration Layer
   ↓ validate permission (HQ/receptionist)
   ↓ validate identity (mapping contract)
   ↓ idempotency check
   ↓ Bukku API
   ↓ store Bukku reference
   ↓ audit
MEDINI = PAID / SYNCED
```

### B. Bukku → Medini (HQ payment in Bukku / poller detect)
```
BUKKU (payment recorded / status change)
   ↓ Integration Layer (poll / webhook)
   ↓ match Finance Tracker item (mapping contract)
   ↓ validate identity
   ↓ apply sync policy
   ↓ update MEDINI = PAID
   ↓ emit PAYMENT_STATUS_UPDATED
   ↓ dashboard updated
   ↓ audit
```

Guna architecture sedia ada (dari `BUKKU-MEDINI-BIDIRECTIONAL-SYNC-ARCHITECTURE.md`): idempotency, identity mapping, sync state machine, conflict handling, audit trail, reconciliation. **Tiada duplicate transactions.**

---

## 14. SOURCE-OF-TRUTH MATRIX (Finance-specific)

| Data | Truth | Medini role | Sync |
|---|---|---|---|
| Patient identity | Medini | master | M→B (contact ref) |
| Treatment/cost | Medini | master | M→B (line item) |
| Patient invoice | Bukku | projection | bidirectional |
| Patient payment status | Bukku (state) / Medini (projection) | projection | bidirectional |
| Amount | Bukku | read | B→M (HQ review on conflict) |
| Branch bill | Bukku (execution) | tracker | M→B submit, B→M status |
| Recurring obligation | Medini (tracker) | master (tracker) | M→B (optional create payable) |
| Commission rules | Medini | master (calc) | M→B (posting) |
| Ledger/journal | Bukku | — | Bukku-only |
| Reconciliation | Integration Layer | read report | computed |

---

## 15. DASHBOARD METRICS (feed existing HQ/Owner dashboard)

Finance Tracker data mesti feed dashboard interaktif sedia ada:

| Metric | Source | Viewer |
|---|---|---|
| Total financial obligations | tracker sum | HQ |
| Paid / Pending / Due Soon / Overdue | tracker status count | HQ + BM (branch) |
| Monthly recurring commitments | recurring engine | HQ + BM |
| Branch expenses | expenses by branch | HQ (all) + BM (own) |
| Patient collections | payments | HQ + BM |
| Treatment-related costs | TC_STATE.costs | HQ + BM |
| Doctor commissions | commissions | HQ (all) + Doctor (own, where permitted) |
| Upcoming payments | recurring nextDue + payables due | HQ + BM |
| Cash position | cashflow | HQ only |

**Owner jawab "where are we financially" tanpa buka Bukku untuk soalan operasi.** Tapi **JANGAN** duplicate Bukku accounting dashboard — Medini tunjuk **operational financial intelligence** sahaja.

---

## 16. ALERT MODEL

Existing `finRebuildAlerts` (9154) dah comprehensive. Kekalkan + generalize:

| Alert | Trigger | Severity |
|---|---|---|
| Invoice overdue | patient invoice overdue | Critical |
| Payable overdue | bill overdue | Critical |
| Bill due soon | payable near due | Due Soon |
| Insurance renewal | recurring insurance approaching | Upcoming |
| Recurring bill due | recurring near due | Upcoming |
| Commission pending approval | commission awaiting | Awaiting Approval |
| Lab payment overdue | lab outstanding | Critical |
| Lab case blocked | outstanding > threshold | Critical |
| Tax due | tax approaching | Upcoming |
| Outstanding threshold | group outstanding > threshold | Due Soon |

**Generalize:** Finance Tracker item (configurable) → auto-generate DUE_SOON/OVERDUE alerts dari `nextDueDate`. Tiada hardcode per bill type.

---

## 17. FUTURE EXTENSION MODEL

HQ tambah category/item baru tanpa developer:

```
HQ → Settings/Finance Config → + Add Category / + Add Tracker Item
   ↓
Category list update (configurable)
   ↓
New FinancialItem (category dari list)
   ↓
Auto masuk: tracker + dashboard + alerts
   ↓
Bukku mapping: SYNCABLE (kalau category mapped) / REQUIRES_MAPPING (kalau baru)
```

**Finance kekal SATU domain.** Extension = data-driven (config), bukan code-driven.

---

## 18. EXPLICIT OUT-OF-SCOPE LIST

Medini Finance **TIDAK**:
- ❌ General ledger / journal entries (Bukku-only)
- ❌ Chart of accounts
- ❌ Tax computation (track obligation sahaja)
- ❌ Bank reconciliation detail
- ❌ Depreciation / asset accounting
- ❌ Stock/inventory valuation
- ❌ Payment gateway / FPX / card processing
- ❌ Full payroll engine (track commission/expense sahaja)
- ❌ Full inventory management
- ❌ Accounting adjustments/corrections
- ❌ Mirror semua Bukku records

---

## FINAL SCOPE TABLE (canonical reference)

| Financial Item | Medini Finance | Bukku | Sync M→B | Sync B→M | Patient | Recurring | HQ | Branch | Configurable | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Patient payment status | ✅ projection | ✅ state | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ (status) | ❌ | PENDING/PAID/OVERDUE |
| Patient invoice | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ (own) | ❌ | treatment-linked |
| Patient outstanding/overdue | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | derived |
| Treatment cost | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | clinical-linked |
| Lab payment/cost | ✅ | ❓ | ⚠️ | ❓ | ✅ | ❌ | ✅ | ✅ | ❌ | blocking rule |
| Doctor commission | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | Doctor own | ❌ | `/journal_entries` |
| Electricity (TNB) | ✅ tracker | ❓ | ⚠️ | ❓ | ❌ | ✅ Monthly | ✅ | ✅ view | ✅ | recurring |
| Water (SAJ) | ✅ tracker | ❓ | ⚠️ | ❓ | ❌ | ✅ Monthly | ✅ | ✅ view | ✅ | recurring |
| Internet (Unifi) | ✅ tracker | ❓ | ⚠️ | ❓ | ❌ | ✅ Monthly | ✅ | ✅ view | ✅ | recurring |
| Rent | ✅ tracker | ❓ | ⚠️ | ❓ | ❌ | ✅ Monthly | ✅ | ✅ view | ✅ | recurring |
| Clinic insurance | ✅ tracker | ❓ | ⚠️ | ❓ | ❌ | ✅ Yearly | ✅ | ✅ view | ✅ | recurring |
| Doctor insurance | ✅ expense | ❓ | ⚠️ | ❓ | ❌ | ✅ Yearly | ✅ | ❌ | ✅ | expense sub |
| Cukai Pintu / assessment | ✅ expense | ❓ | ⚠️ | ❓ | ❌ | ✅ Yearly | ✅ | ❌ | ✅ | tax obligation |
| Supplier payment | ✅ payable | ❓ | ⚠️ | ❓ | ❌ | ⚠️ | ✅ | ✅ view | ✅ | generic payee |
| Maintenance | ✅ expense | ❓ | ⚠️ | ❓ | ❌ | ⚠️ | ✅ | ✅ view | ✅ | category |
| Software subscription | ✅ recurring | ❓ | ⚠️ | ❓ | ❌ | ✅ Monthly | ✅ | ❌ | ✅ | recurring |
| Payroll | ✅ expense | ❓ | ⚠️ | ❌ | ❌ | ✅ Monthly | ✅ | ❌ | ❌ | HQ only |
| Custom category (future) | ✅ tracker | ❓ | ⚠️ | ❓ | ⚠️ | ⚠️ | ✅ | ⚠️ | ✅ | REQUIRES_MAPPING |
| **General ledger** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | Bukku-only |
| **Chart of accounts** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | Bukku-only |
| **Tax computation** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | Bukku-only |
| **Bank recon detail** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | Bukku-only |

**Legend:** ✅ confirmed/wujud · ⚠️ partial/unverified · ❓ Bukku UNVERIFIED (tak boleh query dari sini) · ❌ no

---

## FINAL ANSWERS (10 soalan bisnes)

1. **Apa Medini Finance patut track?** Patient payment status/outstanding, treatment cost, lab payment, doctor commission, branch bills (utilities/rent/internet/insurance), recurring commitments, payables, collections, branch expenses.
2. **Apa kekal dalam Bukku?** General ledger, chart of accounts, tax computation, bank recon detail, depreciation, accounting adjustments, full journal.
3. **Apa patut sync?** Patient invoice/payment status, branch bills, commission posting — dengan idempotency + mapping.
4. **Apa TIDAK patut sync?** Ledger, COA, tax detail, accounting-only records.
5. **Apa patut configurable?** Finance Tracker categories + items (HQ tambah tanpa developer), mapping endpoint, thresholds.
6. **Macam mana HQ payment dalam Bukku flow ke CRM?** Poller/webhook detect → match tracker item (mapping) → update MEDINI=PAID → emit event → dashboard update → audit.
7. **Macam mana CRM update flow ke Bukku?** HQ/receptionist action → validate permission + identity + idempotency → Bukku API → store ref → audit.
8. **Macam mana Owner dashboard visualize?** Feed existing HQ dashboard — obligations, paid/pending/due/overdue, recurring commitments, branch expenses, collections, treatment costs, commissions, upcoming payments. Operational intelligence, BUKAN accounting dashboard clone.
9. **Finance domain perlu restructure?** **Tidak major.** Structure dah baik (14 modules). Yang perlu: (a) generalize tracker jadi configurable FinancialItem model, (b) tambah patient payment status accessor (M1 Fasa 1 dah ada), (c) tighten Bukku mapping, (d) backend Integration Layer (post-M1).
10. **Architecture masih KISS?** **Ya.** Satu Finance domain, configurable categories, generic tracker, tiada domain baru, tiada accounting engine. Lulus ujian: "kalau tak membantu klinik operate/track obligation/faham patient payment/monitor branch/bantu HQ decide — tak patut ada dalam Medini Finance."

---

## 🚦 FINAL GATE

**STATUS: AUDIT + ARCHITECTURE COMPLETE.** Tiada kod diubah. 768 tests untouched. M1 Fasa 2 belum start.

**STOP.** Menunggu approval eksplisit business owner untuk Finance boundary SEBELUM sebarang code change.
