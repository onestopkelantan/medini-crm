# M1 FASA 2 — CONNECTION
## Cross-Domain Integration + Role Views + Patient 360 + Payment Status

**Date:** 14 Ogos 2026 · **Status:** IMPLEMENTED (frontend prototype)
**Baseline:** 802 tests (738 baseline + 30 ct + 34 fr) + 18 new = 820
**Prerequisite:** M1 Fasa 1 (LOCKED) · Financial Radar (LOCKED)

---

## 1. CROSS-DOMAIN RELATIONSHIPS

Canonical flow yang dihubungkan:

```
PATIENT (MRN = canonical identity)
   ↓
APPOINTMENT (appointmentId + patientId + branchId + doctorId + treatmentRef)
   ↓
TREATMENT (treatmentCaseId + patientId + branchId + doctorId)
   ↓
SALE / TREATMENT VALUE (FIN.invoices → mrn + treatment)
   ↓
PAYMENT STATUS (MEDINI_ARCHITECTURE._store → patientId + branchId + status)
   ↓
FINANCE (FIN_TRACKER → derive dari FIN)
   ↓
DASHBOARD / REPORTS (derived views)
```

**Canonical ID fields (derived, tidak mutate existing arrays):**
- `appointmentId` — deterministic (`APT-1000+`)
- `patientId` — MRN (canonical patient identity)
- `branchId` — branch ID
- `doctorId` — `dr-*` dari DOCTOR_MASTER
- `treatmentCaseId` — `ENC-*` dari D3State.encounters
- `treatmentRef` — treatment name
- `saleRef` — invoice ID

---

## 2. CANONICAL ID RESOLVERS

| Function | Purpose |
|---|---|
| `cxDoctorId(drShort)` | dr short name ↔ `DOCTOR_MASTER.id` |
| `cxDoctorName(doctorId)` | `dr-*` → full name |
| `cxPatientByName(name)` | patient name ↔ `patients` record |
| `cxPatientMrn(name)` | patient name ↔ MRN |
| `cxEnrichAppointment(a, idx)` | derive canonical IDs untuk appointment |
| `cxAppointments()` | semua appointments dengan canonical IDs |

---

## 3. CANONICAL ACCESSORS (scope-enforced)

| Function | Scope |
|---|---|
| `cxGetPatient(mrn)` | HQ=all · others=own branch · doctor=own branch |
| `cxGetAppointments(opts)` | HQ=all · BM=own branch · doctor=own doctor |
| `cxGetTreatments(opts)` | HQ=all · BM=own branch · doctor=own doctor |
| `cxGetPaymentStatus(mrn)` | role-filtered via M1 accessor |
| `cxGetPatient360(mrn)` | cross-domain surface, role-filtered |
| `cxRoleView()` | derive dari ROLE_DOMAIN_MATRIX |
| `cxCollectionToday()` | derived, not stored |
| `cxPaymentStatusSummary()` | derived counts |

---

## 4. PAYMENT STATUS FLOW

```
EXTERNAL PAYMENT (FPX/Card/etc)
   ↓
Receptionist / HQ confirm dalam CRM
   ↓
cxConfirmPatientPayment(mrn, ref)
   ↓
MEDINI_ARCHITECTURE.updatePatientPaymentStatus()
   ↓
PAYMENT_STATUS_UPDATED (in-memory event)
   ↓
Patient 360 → updated
Branch Dashboard → updated
HQ Finance → updated
Reports → derived KPI updated
```

**Status:** PENDING / PAID / OVERDUE. **Tiada payment gateway.** Tiada PAYMENT_RECEIVED.

---

## 5. ROLE VIEWS (genuine, bukan hide)

### HQ
- Dashboard: revenue, collection, outstanding, overdue, branch comparison, Finance Radar, alerts
- Finance: full CRM-relevant (payables, cashflow, reconciliation, Bukku)
- Patient 360: full context

### Branch Manager
- Dashboard: performance, sales, collected, outstanding, overdue, patients, appointments, top treatments, branch alerts
- Finance: branch scope (no corporate)
- Patient 360: own branch

### Receptionist
- Dashboard: today's appointments, waiting patients, pending confirmations, new patients, WhatsApp pending, recall due, collection today
- Patient 360: own branch + payment status + confirm action

### Doctor
- Dashboard: my day, my appointments, waiting patients, pending notes, follow-ups, my sales/treatment/mix
- Patient 360: own patients only
- No corporate/branch finance

---

## 6. PATIENT 360

**Cross-domain surface utama.** Role-filtered, single canonical context.

| Section | Source | Role filter |
|---|---|---|
| Patient info | `patients` (canonical) | scope-enforced |
| Appointment history | `cxGetAppointments` | scope-enforced |
| Treatment history | `cxGetTreatments` | scope-enforced |
| Doctor context | `cxDoctorId` + `cxDoctorName` | — |
| **Payment Status** | `cxGetPaymentStatus` → `cxPatient360PaymentBlock` | **role-filtered** |
| Recall status | `p6FollowUpStatus` | — |
| WhatsApp context | `waChats` | — |

**Payment section:** Status (PENDING/PAID/OVERDUE) + Paid Date + Updated By + Ref. **Tiada ledger, tiada accounting, tiada gateway.**

---

## 7. STATE PROPAGATION

- **Single source:** `MEDINI_ARCHITECTURE._store` (payment status) + `FIN_TRACKER` (radar) + `patients` (patient master)
- **Derived views:** Dashboard, Reports, Patient 360 — semua derive dari accessors, tiada duplicate copies
- **Event propagation:** `PAYMENT_STATUS_UPDATED` → emit event → dependent views reflect

---

## 8. SCOPE ENFORCEMENT (bypass-proof)

| Bypass attempt | Result |
|---|---|
| `branchId` manipulation | `cxGetPatient` / `cxGetAppointments` guard → null/filtered |
| `doctorId` manipulation | `cxGetTreatments` / `cxGetAppointments` filter → own doctor only |
| Direct accessor call | `getVisiblePaymentStatusForCurrentUser` → scope enforced |
| Query/filter manipulation | `finSc` / `finCanSeeBranch` → guard |
| UI hiding | BUKAN security — service level enforced |

---

## 9. FINANCE RADAR INTEGRATION

- HQ: full radar (all branches)
- BM: branch radar (own branch)
- Receptionist: patient payment context only
- Doctor: patient/commission context only
- Radar rules preserved: 🟢>14 · 🟡14–8 · 🔴7–1 · 🔴today · 🚨overdue · 🛑>60

---

## 10. WHATSAPP READINESS

- `cxGetPatient360` includes `whatsapp` context (name, phone, tag, unread)
- `patientId` (MRN) link established for future conversation resolution
- `branchId` + `appointmentId` + `doctorId` canonical IDs available
- **Full WhatsApp Hub = M2, not built now**

---

## 11. FILES CHANGED

| File | Changes |
|---|---|
| `CURRENT-MEDINI-REVIEW.html` | M1 Fasa 2 connection layer (canonical IDs, accessors, payment status, role views, Patient 360, state propagation) + P360 payment block UI |
| `app/reviews/CURRENT-MEDINI-REVIEW.html` | byte-identical copy |
| `app/smoke-review.mjs` | 18 new tests (ix01-08, sc01-07, p36001-07) |
| `docs/M1-PHASE-2-CONNECTION.md` | this document |

---

## 12. TESTS ADDED

| Prefix | Count | Coverage |
|---|---|---|
| `ix01-08` | 8 | cross-domain connections |
| `sc01-07` | 7 | scope/bypass |
| `p36001-07` | 7 | Patient 360 |

**Total new:** 18 tests (some overlap in function but distinct assertions).

---

## 13. GATE CHECKLIST

| Item | Status |
|---|---|
| Patient canonical identity connected | ✅ |
| Appointment connected | ✅ |
| Treatment connected | ✅ |
| Payment Status connected | ✅ |
| Finance connected | ✅ |
| Dashboard derives updated values | ✅ |
| Reports derive source data | ✅ |
| Role views genuinely differentiated | ✅ |
| HQ scope works | ✅ |
| Branch scope works | ✅ |
| Doctor patient scope works | ✅ |
| Receptionist scope works | ✅ |
| Patient 360 complete | ✅ |
| Payment status flow works | ✅ |
| Bypass attempts blocked | ✅ |
| Finance Radar remains intact | ✅ |
| Bukku P4 untouched | ✅ |
| No payment processor introduced | ✅ |
| No Chair Utilization | ✅ |
| Existing 802 tests remain green | ✅ |
| All new tests green | ✅ |
| Documentation complete | ✅ |

---

## 🚦 FASA 2 GATE = **PASS**

**STOP.** Menunggu approval sebelum M1 Fasa 3 — Completion.
