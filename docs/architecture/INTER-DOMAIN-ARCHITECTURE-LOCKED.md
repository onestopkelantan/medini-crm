# INTER-DOMAIN ARCHITECTURE — LOCKED (M1 Final)
## Medini CRM · Canonical Cross-Domain Contract · Version 1.0

**Date locked:** 14 Ogos 2026
**Status:** 🔒 **LOCKED** — sebarang perubahan mesti explicitly versioned
**Baseline:** 824/824 tests PASS (738 baseline + 30 ct + 34 fr + 22 ix/sc/p360 + 15 cu/f3)
**Source of truth:** `window.MEDINI_ARCHITECTURE` + `FIN_TRACKER` (derive dari `FIN`)

> **M1 = satu source of truth → connected domains → role-specific views → correct scope → deterministic state propagation.**
> Medini CRM = CRM/operational system. Bukku = accounting. Medini Finance = Financial Radar (tracker), BUKAN accounting.

---

## 1. DOMAIN REGISTRY (13 canonical)

Dashboard · Patient Management · Appointment Management · Clinical · Documents · Finance · Reports & Analytics · Marketing · Operations · WhatsApp Hub · AI · Administration · Settings.

**Tiada domain tambahan.** Bill Tracker CANCELLED (Financial Radar dah cover). Tiada Inventory/Vendor/AP/Accounting domain.

## 2. DOMAIN OWNERSHIP

| Record | Owner | Nota |
|---|---|---|
| patientMaster | patients | MRN = canonical identity |
| appointmentMaster | appointments | |
| clinicalRecords | clinical | treatmentCaseId = ENC-* |
| documentRecords | documents | |
| financialRecords | finance | FIN_TRACKER derive dari FIN |
| marketingRecords | marketing | |
| operationalRecords | operations | |
| whatsappRecords | whatsapp | |
| aiRecords | ai | |
| adminRecords | admin | |
| settingsRecords | settings | |
| dashboardView | dashboard | READ-ONLY derived |
| **reports** | **READ_ONLY** | derive, tiada duplicate source |

## 3. CROSS-DOMAIN RELATIONSHIPS (canonical flow)

```
PATIENT (MRN) → APPOINTMENT → TREATMENT/CASE → SALE/VALUE → PAYMENT STATUS → FINANCE → DASHBOARD/REPORTS
PATIENT ↕ WHATSAPP ↕ APPOINTMENT  (cross-cutting; future AI/human handoff)
```

## 4. CANONICAL IDs (derived, tidak mutate existing arrays)

| ID | Format | Source |
|---|---|---|
| patientId | MRN (MDN-XXXX) | patients.mrn |
| appointmentId | APT-XXXX | derived deterministic |
| branchId | slug (gelang-patah, dll) | MEDINI_MAIN_BRANCHES |
| doctorId | dr-* | DOCTOR_MASTER |
| treatmentCaseId | ENC-XXXX | D3State.encounters |
| treatmentRef | treatment name | appts.tx |
| saleRef | INV-2026-XXXX | FIN.invoices |

Resolvers: `cxDoctorId/cxDoctorName/cxPatientByName/cxPatientMrn/cxEnrichAppointment`.

## 5. EVENT CONTRACTS (in-memory, M1)

PATIENT_CREATED · APPOINTMENT_CREATED · APPOINTMENT_COMPLETED · TREATMENT_STARTED · TREATMENT_COMPLETED · **PAYMENT_STATUS_UPDATED** · BILL_SUBMITTED · BILL_APPROVED · BILL_REJECTED · BILL_PAID · RECALL_DUE · WHATSAPP_MESSAGE_RECEIVED · AI_ESCALATED.

**Tiada PAYMENT_RECEIVED** (bukan payment processing). Tiada second event system. Backend bus = future.

## 6. ROLE × DOMAIN MATRIX (ringkasan scope)

| Role | Scope | Finance | Payment visibility |
|---|---|---|---|
| **HQ** | all | full CRM-relevant (radar, payables, cashflow, recon, Bukku connector) | all |
| **Branch Manager** | branch | branch radar, branch sales/collection/expenses | own branch |
| **Receptionist** | branch | patient payment status + confirm PENDING→PAID | own branch patients |
| **Doctor** | own | own patient payment status + commission | own/assigned patients |

`can(role, domain, action, context)` — service-level, BUKAN UI hiding.

## 7. PATIENT 360

Cross-domain surface: Patient + Appointment + Treatment + Doctor + **Payment Status (PENDING/PAID/OVERDUE)** + Recall + WhatsApp. Role-filtered, scope-guarded. BUKAN Finance page — tiada ledger/gateway/receipt/accounting.

## 8. PAYMENT STATUS ARCHITECTURE

External payment (FPX/Card). CRM = status layer sahaja: **PENDING/PAID/OVERDUE**. Metadata minimal: patientId, status, paidDate, updatedBy, updatedAt, paymentReference. Receptionist confirm PENDING→PAID + audit + PAYMENT_STATUS_UPDATED propagation. Tiada payment gateway/processor/invoice engine.

## 9. FINANCIAL RADAR ARCHITECTURE (single finance tracker)

`FIN_TRACKER` derive dari `FIN` (single source, no duplicate). Configurable FinancialItem. Rules: 🟢>14 · 🟡14–8 · 🔴7–1 · 🔴today · 🚨overdue · 🛑>60 critical. Ageing 1–7/8–30/31–60/>60. DEFERRED/RESCHEDULED preserve original dueDate. Recurring nextDueDate. Status: PENDING/PAID/OVERDUE/CANCELLED + action DEFERRED/RESCHEDULED. **Covers bills/obligations — no separate Bill Tracker.**

## 10. BUKKU BOUNDARY

Bukku = accounting truth (GL/COA/tax/ledger/bank recon/depreciation). Medini = operational projection. Mapping per item: SYNCABLE / REQUIRES_MAPPING / BUKKU_ONLY. P4 Real API protected. Bidirectional sync = future backend phase (rujuk `BUKKU-MEDINI-BIDIRECTIONAL-SYNC-ARCHITECTURE.md`). **No real sync in M1.**

## 11. REPORTS ARCHITECTURE

READ-ONLY. Derive dari canonical source (RPT_KPIS = 3 KPI definitions: Revenue/Appointment, Recall Rate, No-Show Rate). HQ aggregate / BM branch / Doctor own / Receptionist operational. Tiada duplicate store, tiada mutate source.

## 12. WHATSAPP READINESS

Canonical refs available: conversationId(future), patientId(MRN), branchId, assignedUserId, appointmentId, treatmentContext, aiState, humanHandoffState, lastMessageAt, unreadCount. P360 whatsapp context wujud. **M2 akan build actual Hub.**

## 13. CHAIR UTILIZATION — REMOVED (permanent)

KPI concepts (Chair Utilization/Occupancy/Capacity/Efficiency) dibuang dari dashboard + RPT_KPIS + report chips. Guard test `cu01-03` halang reintroduction. Clinical refs (dental chair, chair/room selector) dikekalkan.

## 14. CROSS-ROLE INTEGRATION (verified)

HQ↔BM (aggregate/branch) · HQ↔Receptionist (payment confirm→collection) · HQ↔Doctor (treatment→performance) · BM↔Receptionist (same branch canonical) · BM↔Doctor (treatment perf) · Receptionist↔Doctor (shared patient/appointment). Semua melalui canonical data + permission + events + derived views — **tiada data copy**.

## 15. KISS PRINCIPLES

Satu source of truth · satu owner per domain · derive jangan duplicate · existing domain handle function (tiada domain baru) · UI simple, architecture connected · every KPI jawab soalan operasi sebenar.

## 16. FINAL QA

**824/824 tests PASS · 0 FAIL.** Root ↔ app/reviews byte-identical. Bukku P4 untouched. No backend. No payment processor. No Chair KPI.

---

## 🔒 LOCK DECLARATION

M1 architecture = **LOCKED**. Future development TIDAK boleh silently ubah: domain ownership · role scope · payment architecture · Financial Radar · patient identity · canonical IDs · cross-domain contracts. Sebarang perubahan mesti explicitly versioned.

**Next (post-approval):** M2 WhatsApp Hub → P9 Final QA → Backend → Bukku production sync.
