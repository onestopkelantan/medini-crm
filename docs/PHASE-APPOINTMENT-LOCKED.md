# PHASE 2 — APPOINTMENT MANAGEMENT v2 — LOCKED

**Locked:** 9 August 2026 · **Baseline:** Phase 6.3 COMPLETE + Phase 7 LOCKED

## 1. Objective

Complete DOMAIN 2 — APPOINTMENT MANAGEMENT as a fully functional prototype within the existing Medini CRM architecture.

## 2. What Was Implemented

### 2.1 Treatment Catalog (69 treatments)

**Built-in (Dr Partner system default): 48 treatments**
- Categories: Consultation, Preventive, Restorative, Endodontic, Prosthodontic, Orthodontic, Oral Surgery, Periodontic, Cosmetic, Diagnostic, Emergency
- Each treatment has: id, code, name, category, source, price, price2, panelPrice, cost, taxPercent, dentalChartSymbol, xrayRequired, eInvoiceClassification, keyboardShortcut, packageEligible, insuranceEligible, specialistRequired

**Medini Dental Group custom: 21 treatments**
- Branch-specific treatments configured for Medini clinics

**Treatment Dropdown:**
- Searchable by name, category, or code
- Grouped by category
- Shows source (Built-in / Medini Custom)
- Shows indicators (X-ray, Specialist)
- Selection stores treatmentId (not free-text)

### 2.2 Appointment Calendar

**Views:**
- Day view — hourly schedule (08:00–17:00)
- Week view — 7-day grid with appointment counts
- Month view — calendar month with daily counts
- List view — full table with all columns
- Queue view — today's active queue

**Navigation:**
- Previous / Next / Today buttons
- Date label display

**Filters:**
- Branch (scope-aware: HQ=all 14, others=own branch)
- Doctor (branch-scoped)
- Status (all 9 statuses)
- Search (patient name, MRN, treatment)

### 2.3 Appointment Data Model

```javascript
{
  appointmentId: 'APT-0001',
  patientId: 'MDN-0042',
  patientName: 'Nurul Izzah binti Ahmad',
  phone: '+60 12-882 3410',
  ic: '980515-10-1234',
  branchId: 'gelang-patah',
  branchName: 'Gelang Patah',
  doctorId: 'dr-aina',
  doctorName: 'Dr. Aina',
  treatmentId: 'T041',
  treatmentName: 'SCALING AND POLISHING',
  treatmentCategory: 'Preventive',
  treatmentSource: 'builtin',
  chairId: 'chair-1',
  chairName: 'Chair 1',
  date: '2026-08-15',
  time: '10:00',
  duration: 30,
  status: 'booked',
  notes: null,
  createdAt: '2026-08-09T18:00:00.000Z',
  confirmedAt: null,
  checkedInAt: null,
  calledAt: null,
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
  noShowAt: null,
  rescheduleHistory: []
}
```

### 2.4 Status Workflow

```
BOOKED
  ↓
CONFIRMED
  ↓
CHECKED-IN
  ↓
WAITING
  ↓
CALLED
  ↓
IN PROGRESS
  ↓
COMPLETED
```

**Alternative flows:**
- BOOKED → CANCELLED
- BOOKED → NO-SHOW
- Any → CANCELLED (with reason)
- CONFIRMED → NO-SHOW

**Invalid transitions blocked:**
- BOOKED → COMPLETED ❌
- BOOKED → IN PROGRESS ❌
- COMPLETED → WAITING ❌
- COMPLETED → BOOKED ❌
- CANCELLED → COMPLETED ❌
- NO-SHOW → COMPLETED ❌

### 2.5 Conflict Detection

**Doctor conflict:**
- Same doctor, same date, same time → BLOCKED

**Chair conflict:**
- Same chair, same date, same time → BLOCKED

### 2.6 Queue Management

**Today's Queue shows:**
- Patient name + avatar
- Treatment + Doctor
- Current status
- Action buttons (Call / Start / Complete)

**Queue statuses:**
- Checked-in → Waiting → Called → In Progress → Completed

### 2.7 Actions

| Action | From Status | To Status | Timestamp |
|--------|-------------|-----------|-----------|
| Confirm | booked | confirmed | confirmedAt |
| Check-in | confirmed | checked-in | checkedInAt |
| Waiting | checked-in | waiting | — |
| Call | waiting | called | calledAt |
| Start | called | in-progress | startedAt |
| Complete | in-progress | completed | completedAt |
| Cancel | any active | cancelled | cancelledAt |
| No-show | booked/confirmed | no-show | noShowAt |

### 2.8 Patient 360 Integration

- Appointment booked → Timeline event added
- Appointment status change → Timeline event added
- Upcoming Appointment section shows next appointment

### 2.9 Dashboard Reflection

- Dashboard shows appointment counts
- Intelligence signals reflect appointment state
- Recommended actions link to Appointment domain

### 2.10 RBAC / Branch Scope

| Role | Branch Access |
|------|-------------|
| HQ | All 14 branches |
| Branch Manager | Own branch only |
| Receptionist | Own branch only |
| Doctor | Own branch only |

**Enforcement:**
- Branch selector disabled for non-HQ roles
- Server-side scope check in apptCreate()
- Conflict detection respects branch scope

## 3. Test Results

### 3.1 New Appointment Tests (AP1–AP42)

| Test | Description | Result |
|------|-------------|--------|
| AP1 | Calendar loads | ✅ |
| AP2 | Day view | ✅ |
| AP3 | Week view | ✅ |
| AP4 | Month view | ✅ |
| AP5 | Appointment list | ✅ |
| AP6 | Search | ✅ |
| AP7 | Status filter | ✅ |
| AP8 | Doctor filter | ✅ |
| AP9 | Branch filter | ✅ |
| AP10 | Treatment search | ✅ |
| AP11 | Treatment category filter | ✅ |
| AP12 | New Appointment | ✅ |
| AP13 | Patient selection | ✅ |
| AP14 | Branch scope | ✅ |
| AP15 | Doctor scope | ✅ |
| AP16 | Treatment dropdown | ✅ |
| AP17 | Treatment selection stores ID | ✅ |
| AP18 | Doctor availability | ✅ |
| AP19 | Doctor conflict blocked | ✅ |
| AP20 | Chair conflict blocked | ✅ |
| AP21 | Booked → Confirmed | ✅ |
| AP22 | Confirmed → Checked-in | ✅ |
| AP23 | Checked-in → Waiting | ✅ |
| AP24 | Waiting → Called | ✅ |
| AP25 | Called → In Progress | ✅ |
| AP26 | In Progress → Completed | ✅ |
| AP27 | Cancel | ✅ |
| AP28 | No-show | ✅ |
| AP29 | Reschedule | ✅ |
| AP30 | Reschedule conflict blocked | ✅ |
| AP31 | Invalid transition blocked | ✅ |
| AP32 | Appointment history | ✅ |
| AP33 | Patient 360 reflection | ✅ |
| AP34 | Dashboard reflection | ✅ |
| AP35 | Queue reflection | ✅ |
| AP36 | Recall → Appointment | ✅ |
| AP37 | Unauthorized branch blocked | ✅ |
| AP38 | Doctor foreign scope blocked | ✅ |
| AP39 | Financial isolation | ✅ |
| AP40 | State survives navigation | ✅ |
| AP41 | Mobile 390px | ✅ |
| AP42 | No JS errors | ✅ |

### 3.2 Full Test Suite

```text
TypeScript                 : 0 errors
Vitest                     : 25/25 PASS
Production build           : PASS
UI smoke (4 roles)         : 54/54 PASS
Branch context smoke       : 6/6 PASS
Single HTML validation     : 197/197 PASS (155 existing + 42 appointment tests)
V9 built-in QA             : 83/83 PASS
Responsive 390px           : PASS
Responsive 768px           : PASS
Responsive 1280px          : PASS
Responsive 1440px          : PASS
JS errors                  : 0
```

## 4. Files Changed

| File | Change |
|------|--------|
| `app/reviews/CURRENT-MEDINI-REVIEW.html` | +TREATMENT_CATALOG (69 treatments), +TREATMENT_CATEGORIES, +ApptMgmt, +APPT_STATUS_FLOW, +APPT_STATUS_LABEL, +APPT_STATUS_COLOR, +apptView(), +apptNav(), +renderApptView(), +getFilteredAppointments(), +renderDayView(), +renderWeekView(), +renderMonthView(), +renderListView(), +renderQueueView(), +renderApptCard(), +renderApptActions(), +apptSetStatus(), +openApptDetail(), +initAppointments(), +apptSearchTreatment(), +apptSelectTreatment(), +apptClearTreatment(), +apptShowTreatmentDropdown(), Appointments page HTML (5 views + filters), New Appointment modal (treatment dropdown + chair), apptCreate() (treatmentId + chair + conflict detection) |
| `app/smoke-review.mjs` | +42 appointment tests (AP1–AP42) |
| `CURRENT-MEDINI-REVIEW.html` (root) | Synced — `cmp` IDENTICAL |
| `docs/PHASE-APPOINTMENT-LOCKED.md` | 🆕 this document |
| `docs/CURRENT-STATE.md` | ✏️ Phase 2 = LOCKED |

## 5. Demo Limitations

| Item | Status |
|------|--------|
| Treatment pricing | Not configured (0.00 in demo) |
| Doctor schedule | Static demo data |
| Chair availability | Static 4 chairs |
| Reschedule UI | Not implemented (status change only) |
| Appointment detail drawer | Toast only (full drawer deferred) |
| Recurring appointments | Not implemented |
| Waitlist | Not implemented |
| SMS/WhatsApp reminders | Not implemented |

## 6. Security / RBAC

- Branch scope enforced for all appointment operations
- Doctor scope enforced (doctor sees own branch only)
- Financial isolation preserved (no price/invoice/payment in appointment)
- No unauthorized branch access

## 7. Known Issues

None.

## 8. STOP Condition

```text
PHASE 2 — APPOINTMENT MANAGEMENT v2 — LOCKED ✅

STOP. Do NOT start:
- Finance / Payment / Invoice / Outstanding
- Insurance / Panel
- Clinical SOAP / Treatment Plan
- Inventory
- Production Backend
- PostgreSQL
- Production API
- Real WhatsApp backend

Wait for next instruction.
```
