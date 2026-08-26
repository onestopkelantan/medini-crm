# MEDINI CRM — EXTERNAL SYSTEM STUDY & GAP ANALYSIS

**The Dr Partner**
**Medini Dental Group — Bandar Baru Uda**
**Study Date:** 9 August 2026

---

## 1. Executive Summary

The Dr Partner is a comprehensive clinic management system used by Medini Dental Group. It covers patient management, appointments, treatment, payments, insurance, inventory, reporting, and branch operations. This study identifies what Medini CRM currently has, what is missing, and what should be prioritized before production backend development.

**Key Finding:** The Dr Partner is a mature, feature-rich system with deep operational workflows. Medini CRM has a superior dashboard/intelligence layer but lacks the depth in patient financial management, treatment catalog, insurance/panel workflows, and clinical documentation.

---

## 2. System Overview

### 2.1 Module Map (Actual Structure Observed)

```
Dr Partner
├── Dashboard (Doctor Dashboard)
│   ├── Queue checking (30s polling)
│   ├── Payment notifications
│   └── Treatment timer
│
├── Setting
│   ├── Master Setup
│   │   ├── Referral setup (clinic + doctor)
│   │   ├── Staff type setup
│   │   ├── Treatment (category + setup)
│   │   ├── Package setup
│   │   ├── Panel company
│   │   ├── Insurance company
│   │   ├── Payment mode
│   │   ├── Know about clinic (channel)
│   │   ├── Custom forms (consent, MC, time off, PDPA)
│   │   ├── Treatment room setup
│   │   ├── Voucher setup
│   │   ├── Frontdesk message
│   │   ├── Appointment purpose setup
│   │   └── Appointment procedure setup
│   │
│   ├── SOAP Option Setup
│   │   ├── Subjective / Complain (S)
│   │   ├── Objective / Reason (O)
│   │   ├── Diagnosis / Assessment (A)
│   │   └── Treatment Plan (P)
│   │
│   ├── Inventory
│   │   ├── UOM setup
│   │   ├── Supplier setup
│   │   ├── Manufacturer setup
│   │   ├── Purchase order
│   │   ├── Internal transfer
│   │   ├── Medicine (grade, attribute, alert, meal, usage, dosage, category, group, formula, setup, stock in, internal use)
│   │   ├── Product (category, setup, stock in, internal use)
│   │   └── Material (category, setup, stock in, internal use)
│   │
│   ├── Machine / Equipment
│   │   ├── Inspection machine
│   │   └── Equipment inspection
│   │
│   ├── Communication
│   │   ├── WhatsApp setup
│   │   ├── Message setting
│   │   └── Message campaign setting
│   │
│   └── Staff
│       ├── Staff commission
│       ├── Staff leave
│       └── e-Invoice staff setup
│
├── Patient
│   ├── Patient registration
│   ├── Patient reactivate
│   └── Search (name, IC, mobile, member no, parent, guardian)
│
├── Appointments
│   ├── Calendar view
│   ├── Queue page
│   ├── Appointment roster
│   └── Branch holiday
│
├── Point of Sale (POS)
│   ├── POS
│   └── POS void
│
├── Payment
│   ├── Payment collection
│   ├── Refund payment
│   └── Void payment
│
├── Insurance / Panel
│   ├── Panel invoice
│   ├── Panel payment
│   ├── Panel void invoice
│   ├── Insurance invoice
│   ├── Insurance payment
│   └── Insurance void invoice
│
├── Outstanding / Credit
│   ├── Outstanding invoice
│   ├── Unpaid invoice
│   └── Branch credit setup
│
├── Reports
│   ├── Daily patient visit
│   ├── Monthly patient visit
│   ├── Monthly visit summary
│   ├── Yearly patient visit
│   ├── Daily patient feedback
│   ├── Monthly patient feedback
│   ├── New patient report
│   ├── Tourism report
│   ├── Daily treatment
│   ├── Monthly treatment
│   ├── Yearly treatment
│   ├── Patient last treatment
│   ├── Daily medicine
│   ├── Monthly medicine
│   ├── Daily product
│   ├── Monthly product
│   ├── Daily material
│   ├── Monthly material
│   ├── Deposit report
│   ├── Incident report
│   ├── Death report
│   └── DOSH inspection
│
└── Branch Management
    ├── Branch edit
    ├── Branch logo
    ├── Branch staff setup
    ├── Branch tax edit
    └── Branch credit setup
```

---

## 3. Patient Management

### 3.1 Patient Fields Observed

| Field | Purpose | Required | Medini Equivalent | Recommendation |
|-------|---------|----------|-------------------|----------------|
| Name | Patient identity | Yes | ✅ Exists | — |
| IC No | Identity verification | Yes | ✅ Exists (Phase 6.3) | — |
| Mobile No | Contact | Yes | ✅ Exists | — |
| Member No | Membership tracking | Optional | ❌ Missing | P2 — Add member/loyalty ID |
| Parent Name | Family linkage | Optional | ✅ Exists (Phase 6.1) | — |
| Parent Phone | Family contact | Optional | ✅ Exists (Phase 6.3) | — |
| Guardian Name | Legal guardian | Optional | ✅ Exists (Phase 6.3) | — |
| Guardian Phone | Guardian contact | Optional | ✅ Exists (Phase 6.3) | — |
| DOB | Age calculation | Yes | ✅ Exists | — |
| Gender | Demographics | Yes | ✅ Exists | — |
| Address | Location | Optional | ❌ Missing | P1 — Add address field |
| Email | Digital contact | Optional | ❌ Missing | P2 — Add email field |
| Occupation | Demographics | Optional | ❌ Missing | P3 — Add occupation |
| Race/Ethnicity | Demographics | Optional | ❌ Missing | P3 — Add if needed for MOH reporting |
| Allergies | Clinical safety | Optional | ❌ Missing | P1 — Critical for clinical safety |
| Medical History | Clinical context | Optional | ❌ Missing | P1 — Important for treatment planning |
| Dental History | Clinical context | Optional | ❌ Missing | P1 — Important for continuity |
| Notes | General notes | Optional | ✅ Exists | — |

### 3.2 Critical Missing Patient Fields

**P0 — Critical:**
- **Allergies** — Clinical safety requirement. Must be visible during treatment.
- **Medical History** — Contraindications for dental procedures.
- **Address** — Required for billing, insurance, and recall letters.

**P1 — Important:**
- **Email** — Digital communication channel.
- **Occupation** — Demographic analysis.

**P2 — Useful:**
- **Member No** — Loyalty program integration.
- **Emergency Contact** — Separate from guardian for adults.

---

## 4. Treatment / Service Catalog

### 4.1 Treatment Categories Observed

| Category | Examples |
|----------|----------|
| Consultation | Initial consult, follow-up consult |
| Preventive | Scaling, polishing, fluoride, sealant |
| Restorative | Filling (composite, amalgam, GIC), inlay, onlay |
| Endodontic | Root canal (anterior, premolar, molar), pulpotomy, pulpectomy |
| Prosthodontic | Crown (PFM, zirconia, E-max), bridge, denture (partial, full), implant crown |
| Orthodontic | Braces (metal, ceramic, self-ligating), aligner, retainer |
| Oral Surgery | Extraction (simple, surgical), wisdom tooth, biopsy |
| Periodontic | Deep scaling, root planing, gum surgery |
| Cosmetic | Whitening (in-office, take-home), veneer, bonding |
| Diagnostic | X-ray (IOPA, OPG, CBCT), study model, photo |
| Emergency | Pain relief, abscess drainage, temporary filling |

### 4.2 Complete Treatment Catalog (Built-in + Custom)

**Built-in treatments (system default): 48**

| No | Treatment | Notes |
|----|-----------|-------|
| 1 | ALVEOLOPLASTY | Surgical ridge preparation |
| 2 | AMALGAM FILLING | Metal filling |
| 3 | BLANC ONE WHITENING | Whitening brand |
| 4 | CBCT | 3D imaging |
| 5 | COMPOSITE FILLING | Tooth-colored filling |
| 6 | CONSULTATION | Doctor consult |
| 7 | DENTURE | General denture |
| 8 | DRY SOCKET MX | Dry socket management |
| 9 | EXTRACTION | Tooth removal |
| 10 | F/F DENTURE ACRYLIC | Full denture acrylic |
| 11 | F/F DENTURE FLEXIBLE | Full denture flexible |
| 12 | FILLING | General filling |
| 13 | FISSURE SEALANT | Preventive sealant |
| 14 | FLUORIDE APPLICATION | Fluoride treatment |
| 15 | FULL METAL CROWN | Metal crown |
| 16 | GIC FILLING | Glass ionomer filling |
| 17 | IMPLANT CROWN ISSUED | Implant crown delivery |
| 18 | IMPLANT IMPRESSION | Implant impression |
| 19 | INVISALIGN | Clear aligner |
| 20 | INVISALIGN MODERATE | Moderate aligner case |
| 21 | INVISALIGN REVIEW | Aligner review |
| 22 | LASER EMUNDO | Laser treatment |
| 23 | LASER GINGIVECTOMY | Laser gum surgery |
| 24 | MFT + EXPANDER | Myofunctional therapy |
| 25 | MFT + TRAINER | Trainer appliance |
| 26 | MFT REVIEW | MFT review |
| 27 | MILK TOOTH EXTRACTION | Pediatric extraction |
| 28 | OPG | Panoramic X-ray |
| 29 | ORTHO DEBOND | Braces removal |
| 30 | ORTHO REVIEW | Braces review |
| 31 | PA RADIOGRAPH | Periapical X-ray |
| 32 | PARTIAL DENTURE ACRYLIC | Partial denture acrylic |
| 33 | PARTIAL DENTURE THERMOSENSE | Flexible partial denture |
| 34 | PFM BRIDGE | Porcelain-fused-metal bridge |
| 35 | PFM CROWN | Porcelain-fused-metal crown |
| 36 | PULPOTOMY | Pulp treatment |
| 37 | RETAINER | Orthodontic retainer |
| 38 | ROOT CANAL - ANTERIOR | Front tooth RCT |
| 39 | ROOT CANAL - MOLAR | Back tooth RCT |
| 40 | ROOT CANAL - PREMOLAR | Premolar RCT |
| 41 | SCALING AND POLISHING | Cleaning |
| 42 | STO | (abbreviation — likely study model) |
| 43 | STRAUMANN IMPLANT | Implant brand |
| 44 | WHITENING | General whitening |
| 45 | WISDOM TOOTH EXTRACTION | Wisdom tooth removal |
| 46 | WISDOM TOOTH SURGERY | Surgical wisdom tooth |
| 47 | ZIRCONIA BRIDGE | Zirconia bridge |
| 48 | ZIRCONIA CROWN | Zirconia crown |

**Branch-custom treatments (Medini Dental Group): 21**

| No | Treatment |
|----|-----------|
| 1 | APPLIANCE |
| 2 | BRACES / ORTHO |
| 3 | BRIDGE |
| 4 | CBCT X-RAY |
| 5 | CLEAR ALIGNER |
| 6 | CONSULTATION |
| 7 | CROWN |
| 8 | DENTURE |
| 9 | FLOURIDE |
| 10 | GINGIVECTOMY |
| 11 | IMPLANT |
| 12 | LA CEPH XRAY |
| 13 | LOCAL ANESTHESIA |
| 14 | MINOR ORAL SURGERY |
| 15 | OPG XRAY |
| 16 | PA XRAY |
| 17 | ROOT CANAL TREATMENT / ENDO |
| 18 | SCALING & POLISHING |
| 19 | STO |
| 20 | VENEER |
| 21 | WHITENING |

**Note:** Branch prices are set to 0.00 in the demo view — actual pricing is configured per branch in production use.

### 4.3 Treatment Structure Observed

| Attribute | Observed | Medini Status |
|-----------|----------|---------------|
| Treatment name | ✅ Yes | ✅ Exists |
| Treatment code | ✅ Yes (item code) | ❌ Missing |
| Category | ✅ Yes | ❌ Missing |
| Price | ✅ Yes (branch-specific) | ❌ Missing |
| Price 2 | ✅ Yes (alternate pricing) | ❌ Missing |
| Panel price | ✅ Yes (insurance/panel rate) | ❌ Missing |
| Cost | ✅ Yes (clinic cost) | ❌ Missing |
| Tax % (SST) | ✅ Yes | ❌ Missing |
| Dental chart symbol | ✅ Yes | ❌ Missing |
| X-ray indicator | ✅ Yes | ❌ Missing |
| e-Invoice classification | ✅ Yes | ❌ Missing |
| Keyboard shortcut | ✅ Yes | ❌ Missing |
| Package eligible | ✅ Yes | ❌ Missing |
| Insurance eligible | ✅ Yes | ❌ Missing |
| Specialist required | ✅ Yes | ❌ Missing |

**Gap:** Medini CRM needs a complete treatment catalog with codes, categories, pricing, and insurance eligibility flags.

---

## 5. Insurance / Panel

### 5.1 Panel/Insurance Providers Observed

The system supports panel companies and insurance companies as separate entities:

| Type | Workflow |
|------|----------|
| Panel Company | Direct billing to employer/corporate panel |
| Insurance Company | Claim submission to insurance provider |

### 5.2 Insurance/Panel Workflow

```
Patient registered with panel/insurance
         ↓
Treatment rendered
         ↓
Invoice generated (patient portion + panel portion)
         ↓
Panel/Insurance invoice created
         ↓
Submission to panel/insurance
         ↓
Payment received / Rejected
         ↓
Outstanding tracked
```

### 5.3 Key Insurance Fields

| Field | Purpose |
|-------|---------|
| Panel/Insurance name | Provider identity |
| Policy/member no | Patient coverage ID |
| Coverage limit | Maximum claimable |
| Patient portion | Co-payment amount |
| Panel portion | Billable to panel |
| Claim reference | Submission tracking |
| Claim status | Pending/Approved/Rejected |
| Approved amount | Final approved value |
| Rejected amount | Disputed value |

**Gap:** Medini CRM has no insurance/panel module. This is P0 for real clinic operations.

---

## 6. Payment System

### 6.1 Payment Methods Observed

| Method | Observed |
|--------|----------|
| Cash | ✅ Yes |
| Card (Visa/Master) | ✅ Yes |
| Online Transfer | ✅ Yes |
| E-Wallet | ✅ Yes (implied) |
| Insurance | ✅ Yes |
| Panel | ✅ Yes |
| Deposit | ✅ Yes |
| Credit | ✅ Yes |
| Cheque | Not observed |

### 6.2 Payment Features

| Feature | Observed | Medini Status |
|---------|----------|---------------|
| Full payment | ✅ Yes | ✅ Exists |
| Partial payment | ✅ Yes | ❌ Missing |
| Deposit | ✅ Yes | ❌ Missing |
| Refund | ✅ Yes | ❌ Missing |
| Void payment | ✅ Yes | ❌ Missing |
| Outstanding tracking | ✅ Yes | ❌ Missing |
| Receipt generation | ✅ Yes | ❌ Missing |
| Invoice generation | ✅ Yes | ❌ Missing |

**Gap:** Medini CRM has no payment/invoice/outstanding system. This is P0.

---

## 7. Partial Payment / Outstanding Model

### 7.1 Observed Model

```
Treatment Value: RM1,000
         ↓
Patient Pays: RM500 (Cash) + RM300 (Panel)
         ↓
Outstanding: RM200
         ↓
Status: Partially Paid
```

### 7.2 Financial States Observed

| State | Description |
|-------|-------------|
| Unpaid | No payment received |
| Partially Paid | Some payment, balance remaining |
| Paid | Full payment received |
| Refunded | Payment returned |
| Void | Transaction cancelled |
| Outstanding | Balance due |
| Deposit | Advance payment held |

### 7.3 Outstanding Invoice Fields

| Field | Purpose |
|-------|---------|
| Invoice date | Transaction date |
| Patient name | Debtor |
| Treatment | Service rendered |
| Total amount | Full charge |
| Paid amount | Amount received |
| Outstanding balance | Amount due |
| Status | Payment state |

**Gap:** Medini CRM has no partial payment or outstanding tracking. This is P0.

---

## 8. Appointment Workflow

### 8.1 Statuses Observed

| Status | Description |
|--------|-------------|
| Booked | Appointment scheduled |
| Confirmed | Patient confirmed |
| Checked-in | Patient arrived |
| Waiting | In queue |
| In Progress | Being treated |
| Completed | Treatment done |
| Cancelled | Appointment cancelled |
| No-show | Patient did not arrive |

### 8.2 Queue Management

- Real-time queue checking (30-second polling)
- Treatment timer
- Payment notification
- Queue page display

**Medini Status:** Basic appointment exists (Phase 6.2). Queue management missing.

---

## 9. Clinical Workflow (SOAP)

### 9.1 SOAP Structure Observed

| Component | Description |
|-----------|-------------|
| S — Subjective | Patient complaint |
| O — Objective | Clinical findings |
| A — Assessment | Diagnosis |
| P — Plan | Treatment plan |

### 9.2 Clinical Documentation

| Feature | Observed |
|---------|----------|
| Chief complaint | ✅ Yes |
| Diagnosis | ✅ Yes |
| Treatment notes | ✅ Yes |
| Procedure recording | ✅ Yes |
| Tooth chart | Not observed |
| Medical history | ✅ Yes |
| Allergies | ✅ Yes |
| Clinical attachments | Not observed |
| X-ray integration | Not observed |
| Treatment plan | ✅ Yes |
| Follow-up tracking | ✅ Yes |

**Gap:** Medini CRM has no clinical documentation. This is P1 for doctor workflow.

---

## 10. Document Management

### 10.1 Document Types Observed

| Type | Purpose |
|------|---------|
| Consent form | Treatment consent |
| MC form | Medical certificate |
| Time off form | Staff leave |
| PDPA form | Data protection consent |
| X-ray | Radiographic imaging |
| Referral letter | Specialist referral |

**Gap:** Medini CRM has no document management. This is P2.

---

## 11. Reporting

### 11.1 Reports Observed

| Category | Reports |
|----------|---------|
| Patient | Daily visit, monthly visit, yearly visit, new patient, last treatment |
| Treatment | Daily, monthly, yearly, by doctor, by category |
| Financial | Revenue, payment, outstanding, deposit, panel, insurance |
| Operational | Feedback, incident, death, DOSH inspection |
| Inventory | Medicine, product, material (daily, monthly) |
| Staff | Commission, leave |

**Medini Status:** Dashboard has KPIs but no detailed reports. P1.

---

## 12. Dashboard / KPI Comparison

| Feature | Dr Partner | Medini CRM | Gap |
|---------|-----------|------------|-----|
| Revenue tracking | ✅ Yes | ✅ Yes | — |
| Appointment count | ✅ Yes | ✅ Yes | — |
| Patient count | ✅ Yes | ✅ Yes | — |
| Outstanding | ✅ Yes | ❌ No | **P0** |
| Insurance claims | ✅ Yes | ❌ No | **P0** |
| Doctor performance | ✅ Yes | ❌ No | P1 |
| Branch comparison | ✅ Yes | ✅ Yes | — |
| Real-time queue | ✅ Yes | ❌ No | P2 |
| Treatment analytics | ✅ Yes | ❌ No | P1 |
| Intelligence/AI | ❌ No | ✅ Yes | Medini advantage |

---

## 13. User Roles

### 13.1 Roles Observed

| Role | Access |
|------|--------|
| HQ/Admin | Full access, all branches |
| Branch Manager | Own branch, reports, settings |
| Doctor | Own patients, clinical, appointments |
| Receptionist | Registration, appointments, payments |
| Finance | Payments, invoices, insurance, reports |

**Medini Status:** Role model exists (Phase 3.1) but needs financial module separation.

---

## 14. Branch Management

### 14.1 Features Observed

| Feature | Purpose |
|---------|---------|
| Branch edit | Update branch details |
| Branch logo | Branding |
| Staff assignment | Doctor/receptionist allocation |
| Tax setup | SST/tax configuration |
| Credit limit | Branch credit control |

**Medini Status:** 14-branch model exists. Branch settings missing.

---

## 15. Communication

### 15.1 Features Observed

| Feature | Purpose |
|---------|---------|
| WhatsApp | Patient messaging |
| SMS | Appointment reminders |
| Message templates | Pre-defined messages |
| Campaign | Bulk messaging |
| Frontdesk message | Internal notes |

**Medini Status:** WhatsApp Hub exists (Phase 5). Message templates/campaigns missing.

---

## 16. Recall System

### 16.1 Workflow Observed

```
Treatment completed
         ↓
Recall interval set (e.g., 6 months)
         ↓
Recall due date calculated
         ↓
Reminder sent (SMS/WhatsApp)
         ↓
Patient contacted
         ↓
Appointment booked
         ↓
Recall completed
```

**Medini Status:** Recall Due exists (Phase 6). Recall workflow automation missing.

---

## 17. Financial Model

### 17.1 Observed Structure

```
Patient
   ↓
Appointment
   ↓
Treatment
   ├── Patient Payment (cash/card/e-wallet)
   ├── Panel/Insurance Claim
   │       ├── Submission
   │       ├── Approval/Rejection
   │       └── Payment
   └── Outstanding Balance
           ├── Partial payment
           ├── Follow-up payment
           └── Write-off
```

### 17.2 Key Entities

| Entity | Relationship |
|--------|-------------|
| Patient | Has many invoices |
| Invoice | Has many payments |
| Payment | Belongs to invoice |
| Treatment | Billed on invoice |
| Panel/Insurance | Pays portion of invoice |
| Outstanding | Balance on invoice |

**Gap:** Medini CRM has no financial entities. This is P0.

---

## 18. Medini Existing Capabilities

### 18.1 What Medini Already Has

| Feature | Phase | Status |
|---------|-------|--------|
| Dashboard Command Center | 1–7 | ✅ Complete |
| Role-based access (4 roles) | 3.1 | ✅ Complete |
| Branch scoping (14 branches) | 1 | ✅ Complete |
| Patient List + Search + Filter | 6 | ✅ Complete |
| Patient 360 | 6 | ✅ Complete |
| Family & Relationships | 6.1 | ✅ Complete |
| Referral Network | 6.1 | ✅ Complete |
| New Appointment | 6.2 | ✅ Complete |
| New Patient Registration | 6.3 | ✅ Complete |
| Shared Family Contact | 6.3 | ✅ Complete |
| Follow-up workflow | 5.1 | ✅ Complete |
| Dashboard reflection | 6 | ✅ Complete |
| Financial isolation (RBAC) | 3.1 | ✅ Complete |
| Responsive design | All | ✅ Complete |
| Single HTML review artifact | All | ✅ Complete |

### 18.2 Medini Advantages Over Dr Partner

| Feature | Medini | Dr Partner |
|---------|--------|------------|
| Modern UI/UX | ✅ Yes | ❌ No (legacy) |
| Dashboard intelligence | ✅ Yes | ❌ No |
| Rule-based insights | ✅ Yes | ❌ No |
| Action-oriented workflow | ✅ Yes | ❌ No |
| Mobile responsive | ✅ Yes | ❌ No |
| Family relationship mapping | ✅ Yes | ❌ No |
| Shared contact handling | ✅ Yes | ❌ No |
| Real-time dashboard | ✅ Yes | ❌ No |

---

## 19. Gaps — What Medini Is Missing

### 19.1 P0 — Critical (Must Have Before Production)

| Gap | Why Critical | Module |
|-----|-------------|--------|
| Treatment catalog with codes/pricing | Cannot bill without treatments | Billing |
| Invoice generation | Legal/financial requirement | Finance |
| Payment processing | Revenue collection | Finance |
| Partial payment | Real-world payment behaviour | Finance |
| Outstanding tracking | Debt management | Finance |
| Insurance/Panel module | Corporate billing | Insurance |
| Receipt generation | Patient record | Finance |
| Allergies field | Clinical safety | Clinical |
| Medical history | Treatment contraindication | Clinical |

### 19.2 P1 — Important (Should Have)

| Gap | Why Important | Module |
|-----|--------------|--------|
| Clinical notes (SOAP) | Doctor documentation | Clinical |
| Treatment plan | Multi-visit planning | Clinical |
| Address field | Billing/recall | Patient |
| Email field | Digital communication | Patient |
| Doctor performance report | Productivity tracking | Reports |
| Treatment analytics | Business intelligence | Reports |
| Queue management | Front-desk operations | Appointments |
| Document upload | Record keeping | Documents |

### 19.3 P2 — Useful (Nice to Have)

| Gap | Why Useful | Module |
|-----|-----------|--------|
| Member/loyalty ID | Patient retention | Patient |
| Package/bundle | Marketing | Treatment |
| Voucher/discount | Promotions | Finance |
| Deposit tracking | Advance payment | Finance |
| Refund workflow | Customer service | Finance |
| Void payment | Error correction | Finance |
| Inventory basics | Stock tracking | Inventory |
| Staff commission | Payroll | HR |

### 19.4 P3 — Optional (Defer)

| Gap | Why Optional | Module |
|-----|-----------|--------|
| Occupation | Demographics only | Patient |
| Race/ethnicity | MOH reporting if needed | Patient |
| Equipment tracking | Maintenance | Operations |
| Death report | Regulatory | Reports |
| DOSH inspection | Compliance | Reports |
| Tourism report | Niche | Reports |

---

## 20. Recommended Enhancements

### 20.1 Top 10 Recommendations

| Rank | Feature | Why | Who Uses | Where | Priority | Dependencies |
|------|---------|-----|----------|-------|----------|--------------|
| 1 | **Treatment Catalog** | Foundation for billing | All | Settings → Treatment | P0 | Database schema |
| 2 | **Invoice + Payment System** | Revenue collection | Reception, Finance | Finance module | P0 | Treatment catalog |
| 3 | **Partial Payment + Outstanding** | Real-world payment | Reception, Finance | Finance module | P0 | Invoice system |
| 4 | **Insurance/Panel Module** | Corporate billing | Finance, Manager | Insurance module | P0 | Invoice system |
| 5 | **Allergies + Medical History** | Clinical safety | Doctor, Reception | Patient 360 | P0 | Patient schema |
| 6 | **Clinical Notes (SOAP)** | Doctor documentation | Doctor | Patient 360 → Clinical | P1 | Patient schema |
| 7 | **Receipt Generation** | Patient record | Reception | Finance module | P0 | Payment system |
| 8 | **Treatment Plan** | Multi-visit tracking | Doctor | Patient 360 → Treatment | P1 | Clinical notes |
| 9 | **Address + Email Fields** | Complete patient record | Reception | Patient registration | P1 | Patient schema |
| 10 | **Queue Management** | Front-desk efficiency | Reception | Appointments | P1 | Appointment system |

### 20.2 Proposed Patient 360 Structure (Enhanced)

```
PATIENT 360
────────────────────────────────────
Patient Header (Name / MRN / Branch / Status)
────────────────────────────────────
Profile
  ├── Identity (Name, IC, DOB, Gender)
  ├── Contact (Phone, WhatsApp, Email, Address)
  ├── Allergies ⚠️ (P0 — NEW)
  └── Medical History (P0 — NEW)
────────────────────────────────────
Family & Relationships (Phase 6.1)
────────────────────────────────────
Referral Network (Phase 6.1)
────────────────────────────────────
Upcoming Appointment (Phase 6.2)
────────────────────────────────────
Treatment History (P1 — NEW)
  ├── Past treatments
  ├── Treatment plans
  └── Clinical notes
────────────────────────────────────
Payments & Outstanding (P0 — NEW)
  ├── Invoices
  ├── Payment history
  ├── Partial payments
  └── Outstanding balance
────────────────────────────────────
Insurance / Panel (P0 — NEW)
  ├── Active panels
  ├── Claims
  └── Coverage
────────────────────────────────────
Documents (P2 — NEW)
  ├── Consent forms
  ├── X-rays
  └── Referral letters
────────────────────────────────────
Timeline (Phase 6)
────────────────────────────────────
Notes (Phase 6)
────────────────────────────────────
Follow-up (Phase 5.1)
────────────────────────────────────
```

---

## 21. Proposed Appointment Domain (Future)

```
APPOINTMENT DOMAIN
────────────────────────────────────
Calendar View
  ├── Day / Week / Month
  ├── Doctor filter
  ├── Branch filter
  └── Chair/room assignment
────────────────────────────────────
Queue Management
  ├── Check-in
  ├── Waiting list
  ├── Called/In-progress
  └── Completed
────────────────────────────────────
Appointment Lifecycle
  ├── Booked → Confirmed → Checked-in → Waiting → In-progress → Completed
  ├── Cancelled / No-show tracking
  └── Reschedule workflow
────────────────────────────────────
Treatment Link
  ├── Appointment → Treatment
  ├── Treatment → Invoice
  └── Invoice → Payment
────────────────────────────────────
Recall Integration
  ├── Treatment completion → Recall scheduled
  ├── Recall due → Reminder sent
  └── Recall booked → Appointment created
────────────────────────────────────
```

---

## 22. What Medini Should NOT Copy

| Feature | Why Not |
|---------|---------|
| Legacy UI patterns | Medini has superior modern UI |
| Complex inventory | Overkill for dental CRM |
| Death/DOSH reports | Not relevant for dental |
| Machine/equipment tracking | Not core CRM function |
| Tourism report | Niche, not priority |
| Overly complex SOAP | Simplify for Medini's design |

---

## 23. Priority Roadmap

### Phase 7 — Financial Foundation (P0)
1. Treatment catalog (codes, categories, pricing)
2. Invoice generation
3. Payment processing (full + partial)
4. Outstanding tracking
5. Receipt generation

### Phase 8 — Insurance & Panel (P0)
1. Panel company setup
2. Insurance company setup
3. Claim workflow
4. Panel billing
5. Insurance payment tracking

### Phase 9 — Clinical Safety (P0–P1)
1. Allergies field
2. Medical history
3. Clinical notes (simplified SOAP)
4. Treatment plan

### Phase 10 — Operations (P1)
1. Queue management
2. Document upload
3. Address + email fields
4. Doctor performance reports
5. Treatment analytics

### Phase 11 — Advanced (P2)
1. Package/bundle
2. Voucher/discount
3. Inventory basics
4. Staff commission
5. Recall automation

---

## 24. Conclusion

Medini CRM has a **superior dashboard and intelligence layer** compared to The Dr Partner. The Phase 1–7 Dashboard Command Center, Phase 6 Patient Management, and Phase 6.1–6.3 enhancements (Family, Referral, New Appointment, New Patient) are architecturally sound and visually modern.

However, Medini CRM **lacks the financial and clinical depth** required for real clinic operations:

1. **No treatment catalog** — cannot price or bill services
2. **No invoice/payment system** — cannot collect revenue
3. **No partial payment/outstanding** — cannot handle real-world payment behaviour
4. **No insurance/panel** — cannot bill corporate clients
5. **No allergies/medical history** — clinical safety risk

**Recommendation:** Before building production backend, implement P0 gaps (treatment catalog, invoice/payment, outstanding, insurance/panel, allergies) as prototype modules in the Single HTML review artifact. This ensures the UX workflow is validated before database/API development.

---

## 25. Evidence Log

| Source | What Was Observed | Why It Matters | Medini Recommendation |
|--------|-------------------|----------------|----------------------|
| Dr Partner → Setting → Treatment | Treatment category + setup pages | Treatment catalog structure | Add treatment catalog with codes/pricing |
| Dr Partner → Payment | Payment collection page | Payment workflow | Add invoice + payment system |
| Dr Partner → Outstanding | Outstanding invoice page | Debt tracking | Add outstanding balance tracking |
| Dr Partner → Unpaid | Unpaid invoice list | Partial payment model | Add partial payment support |
| Dr Partner → Panel | Panel invoice/payment pages | Corporate billing | Add insurance/panel module |
| Dr Partner → Patient | Patient registration form | Patient fields | Add allergies, medical history, address |
| Dr Partner → SOAP | SOAP option setup | Clinical documentation | Add simplified clinical notes |
| Dr Partner → Reports | 20+ report pages | Business intelligence | Add treatment/doctor performance reports |
| Dr Partner → Queue | Queue page with polling | Front-desk operations | Add queue management |
| Dr Partner → POS | Point of sale | Payment processing | Integrate POS with invoice |

---

**Privacy Check:** ✅ PASS — No real patient names, IC numbers, phone numbers, addresses, clinical notes, X-rays, insurance member numbers, or payment account details included in this report.

---

*Report generated by Neo — Medini CRM External System Study*
*Study Date: 9 August 2026*
*System: The Dr Partner — Medini Dental Group — Bandar Baru Uda*
