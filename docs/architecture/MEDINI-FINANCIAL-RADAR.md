# MEDINI FINANCIAL RADAR — v1.0

**Artifact:** `docs/MEDINI-FINANCIAL-RADAR.md`
**Date:** 14 Ogos 2026 · **Status:** IMPLEMENTED (frontend prototype)
**Baseline:** 768 tests (738 baseline + 30 ct) + 34 fr tests = 802

> Medini Finance = **FINANCIAL RADAR** (clinic's radar), BUKAN accounting system.
> Bukku = accounting truth. Medini = operational tracker + projection.

---

## 1. FINANCE TRACKER MODEL

Single canonical store `FIN_TRACKER`, **derive dari existing `FIN`** (tiada duplicate data store).

### FinancialItem fields
```
id, category, subcategory, description, payee/vendor, patientId, patientName,
amount, frequency, dueDate, financialStatus, action, newExpectedDate, priority,
branchId, responsibleTeam, reference, source, bukkuRef, bukkuMapping,
createdAt, updatedAt, notes
```

### Categories (configurable — HQ tambah tanpa domain baru)
Patient · Recurring · Payable · Expense · Lab · Commission · Utilities · Rent · Insurance · Supplier · Subscription · Maintenance · Tax · Other · **custom**

---

## 2. STATUS MODEL

### Financial Status (financial reality)
```
PENDING    — belum bayar
PAID       — dah settle
OVERDUE    — lepas due & belum PAID
CANCELLED  — dibatalkan
```

### Management Action (operational — TIDAK falsify due date)
```
null         — tiada tindakan
DEFERRED     — tangguh (dueDate preserved)
RESCHEDULED  — jadual semula (newExpectedDate; dueDate preserved)
```

**Asas:** Financial Status ≠ Management Action. Contoh: `OVERDUE + RESCHEDULED → 20 Aug`. Original due `1 Aug` **kekal**, tidak difalsify.

---

## 3. ALERT RULES (Radar Level)

| Due window | Level | Icon |
|---|---|---|
| >14 days | 🟢 GREEN (Upcoming) | normal |
| 14–8 days | 🟡 YELLOW (Due Soon) | mula plan |
| 7–1 days | 🔴 RED (Due ≤7) | perlu perhatian |
| today | 🔴 RED (Due Today) | kritikal |
| overdue | 🚨 ALARM | kritikal |

### Overdue ageing
| Days | Bucket | Escalation |
|---|---|---|
| 1–7 | `1-7` | alarm |
| 8–30 | `8-30` | alarm |
| 31–60 | `31-60` | alarm |
| >60 | `>60` | 🛑 **CRITICAL** (highly visible to HQ) |

Paparan: **"OVERDUE X DAYS"**. Overdue TIDAK disorok walaupun di-acknowledge — hanya action (DEFERRED/RESCHEDULED) yang berubah.

---

## 4. RECURRING MODEL (TRACK/ALERT/FORECAST sahaja)

`frequency → nextDueDate`: weekly +7d · monthly +1mo · quarterly +3mo · yearly +1yr · one-off (tiada).

`radarNextDue(item)` advance dari `dueDate` sehingga >= today. BUKAN accounting recurring engine.

Verified recurring (dari FIN.recurring): TNB, SAJ, Unifi, Rent (Monthly), Fire Insurance (Yearly), Software Subscription (Monthly).

---

## 5. FORECAST METRICS (dari data sebenar, tiada hardcode)

`radarSummary()`:
- Total Outstanding
- Due Next 7 / 14 / 30 Days (cumulative)
- Overdue Amount
- Monthly Recurring Commitments
- Counts: green/yellow/red/alarm/critical/paid

Feed existing Finance dashboard (`finRadarStrip()`) — guna design system sedia ada, tiada duplicate dashboard.

---

## 6. ROLE VISIBILITY (service-level scope, bukan UI hiding)

| Role | Radar scope | Boleh manage |
|---|---|---|
| **HQ** | semua branch, semua kategori | ✅ add item, markPaid, reschedule, defer |
| **Branch Manager** | own branch | ✅ manage own-branch item (no corporate control) |
| **Receptionist** | own branch, **Patient** kategori sahaja | confirm patient payment (PENDING→PAID) |
| **Doctor** | **Patient** + **Commission** kategori sahaja | ❌ view only |

Scope enforced via `radarItems()` + `radarCanManageBranch()` + `finSc` (branch scope). BUKAN `display:none`.

---

## 7. BUKKU BOUNDARY (mapping per item)

| bukkuMapping | Maksud |
|---|---|
| **SYNCABLE** | mapping verified (Patient/Recurring/Payable/Expense/Lab/Commission/Utilities/Rent/Insurance/Supplier/Subscription) |
| **REQUIRES_MAPPING** | kategori custom/baru — JANGAN auto-post, HQ assign mapping dulu |
| **BUKKU_ONLY** | accounting-only (GL, COA, tax computation, bank recon, depreciation) — kekal dalam Bukku |

Sync behaviour + idempotency + conflict + reconciliation: rujuk `docs/BUKKU-MEDINI-BIDIRECTIONAL-SYNC-ARCHITECTURE.md` (LOCKED). **Tiada duplicate transactions, tiada infinite loops, tiada auto-post unknown.**

---

## 8. CONFIGURABILITY

HQ tambah item baru (`radarAddItem`) — auto masuk tracker + radar + alerts. Kategori custom → default `REQUIRES_MAPPING`. **Tambah item ≠ tambah domain** (Finance kekal 1 domain, 13 canonical domains kekal).

---

## 9. PATIENT FINANCE

Patient payment = projection sahaja. `PENDING/PAID/OVERDUE`, identity via `patientId`/MRN (bukan nama). External payment (FPX/Card) → Receptionist confirm dalam CRM → sync Bukku. **Tiada payment gateway, tiada invoice/receipt engine dalam M1.**

---

## 10. IMPLEMENTATION FILES

| Fail | Perubahan |
|---|---|
| `CURRENT-MEDINI-REVIEW.html` (+`app/reviews/`) | FINANCIAL RADAR script block (engine + store + UI), FIN_MODULES + finRoute (radar module), finViewDashboard (radar strip) |
| `app/smoke-review.mjs` | 34 fr tests |
| `docs/MEDINI-FINANCIAL-RADAR.md` | dokumen ini |

**Byte-identical root ↔ app/reviews (cp + md5sum).** Bukku P4 Real API untouched. 768 baseline tests kekal hijau.

---

## KISS CHECK ✅
Finance = klinik's **FINANCIAL RADAR** — track, alert, plan, act on CRM-relevant finance. BUKAN ERP / Inventory / Accounting / Bukku clone.
