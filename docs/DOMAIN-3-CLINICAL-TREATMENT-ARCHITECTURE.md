# MEDINI CRM — DOMAIN 3
# CLINICAL & TREATMENT MANAGEMENT
# ENTERPRISE BUSINESS ARCHITECTURE v1.0

**Document Status:** COMPLETE — READY FOR LOCK  
**Date:** 9 August 2026  
**Author:** Neo (Lead Healthcare Product Architect)  
**Baseline:** Phase D3.1 LOCKED (Foundation & Evidence)

---

# 1. EXECUTIVE SUMMARY

Domain 3 — Clinical & Treatment Management is the clinical core of Medini CRM. It answers: **WHY** the patient is being treated, **WHAT** is clinically required, **WHAT** treatment is planned, **WHAT** was performed, **WHAT** was the outcome, and **WHAT** happens next.

This domain does not replace Patient Management (WHO), Appointment Management (WHEN), Financial Management (HOW MUCH), or Communication (HOW). It integrates with all four to form a complete clinical operating picture.

**Key Architectural Decisions (Phase D3.1 Preview):**

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Tooth-level model | **Adopt FDI notation** with optional Universal mapping | FDI is ISO 3950 standard, used in Malaysia/MOH; Universal (US) is not locally relevant. FDI supports primary + permanent dentition natively. |
| SOAP structure | **Adapt, not copy** — simplified 4-field clinical note with structured templates | Dr Partner's SOAP is overly complex. Medini will use a guided, template-driven note builder that preserves clinical rigor without legacy UI burden. |
| Treatment Master | **Global catalog + Branch Override** pattern | Prevents duplication of 69+ treatments across 14 branches. Branch can override price, availability, and configuration without cloning the entity. |
| Clinical Encounter | **Distinct from Appointment** | An appointment is a scheduling event; an encounter is a clinical event. One appointment may produce zero or one encounter. An encounter may exist without an appointment (walk-in, emergency). |
| Clinical Documentation | **Immutable after signing** with amendment workflow | Signed notes cannot be edited. Corrections require a linked amendment note preserving the original. Full audit trail. |
| AI Role | **Assistive only** — no silent writes to clinical records | All AI outputs require explicit human approval before persisting. AI is read-only on clinical data unless a doctor explicitly approves a suggestion. |

---

# 2. DOMAIN PURPOSE

Domain 3 exists to:

1. **Ensure clinical safety** — Allergies, medical history, contraindications, and risk flags are captured, visible, and enforced before and during treatment.
2. **Support clinical decision-making** — Structured assessment, diagnosis, and treatment planning with full history and context.
3. **Enable treatment execution** — From single-visit procedures to complex multi-session orthodontic and implant workflows.
4. **Maintain clinical accountability** — Immutable, auditable clinical records with authorship, timestamps, and amendment trails.
5. **Drive continuity of care** — Follow-up, recall, and outcome tracking that links back to the clinical record.
6. **Support multi-branch operation** — Clinical data is branch-scoped where required, but patient clinical history follows the patient across branches.
7. **Prepare for financial integration** — Treatment delivered is the trigger for billing; Domain 3 owns the clinical truth of what was done.

---

# 3. DOMAIN SCOPE

## 3.1 In Scope

| Area | Description |
|------|-------------|
| Clinical Encounter Management | Consultation, visit context, encounter lifecycle |
| Clinical Assessment | Subjective, Objective, Assessment, Diagnosis (SOAP-adapted) |
| Clinical Safety | Allergies, medical history, dental history, warnings, contraindications |
| Treatment Master / Catalog | Treatment definitions, codes, categories, pricing references, eligibility flags |
| Dental Classification | Dental-specific treatment categories and tooth-level clinical model |
| Treatment Planning | Multi-visit plans, sequencing, versions, patient acceptance |
| Treatment Execution | Sessions, procedures, outcomes, complications |
| Clinical Documentation | Notes, attachments, immutable signing, amendments |
| Diagnostic & Imaging | X-ray, IOPA, OPG, CBCT, clinical photos (metadata + reference, not PACS) |
| Clinical Consent | Templates, versions, digital signature reference, expiry, withdrawal |
| Clinical Referral | Internal/external referral, specialist linkage, outcome tracking |
| Follow-up & Recall | Clinical follow-up, recall intervals, appointment creation trigger |
| Clinical Outcome | Success criteria, complications, adverse events, before/after |
| Clinical Timeline | Unified event stream for Patient 360 consumption |
| Packages / Bundles | Treatment packages, eligibility, consumption tracking |
| Clinical Audit | Who, what, when, before/after, reason, branch |
| Clinical AI (Future) | Summarization, documentation assistance, risk flagging — assistive only |
| Clinical Reporting | Treatment volume, outcomes, plan conversion, recall compliance |

## 3.2 Out of Scope (Owned by Other Domains)

| Area | Owner Domain | Why Out of Scope |
|------|-------------|------------------|
| Patient identity, demographics, family | Patient Management | Domain 3 consumes patient identity; it does not own it |
| Appointment scheduling, calendar, queue | Appointment Management | Domain 3 receives appointments; it does not schedule them |
| Invoice, payment, outstanding, receipt | Financial Management | Domain 3 marks treatment as delivered; Finance bills it |
| Insurance claim submission, panel billing | Insurance / Panel | Domain 3 provides clinical documentation to support claims |
| WhatsApp, SMS, campaign messaging | Communication Hub | Domain 3 triggers communication events; it does not send messages |
| Inventory, stock, materials management | Inventory (Future) | Domain 3 references materials used; it does not track stock |
| Staff roster, leave, commission | HR / Staff Management | Domain 3 records practitioner per encounter; it does not manage HR |
| Equipment maintenance, machine tracking | Operations | Domain 3 references equipment used; it does not maintain it |

---

# 4. DOMAIN BOUNDARY

| Domain | Question Answered | Domain 3 Relationship |
|--------|-------------------|----------------------|
| **Patient Management** | WHO is the patient? | Domain 3 reads patient identity, family, guardian, referral network. Domain 3 writes clinical profile (allergies, medical history) back to Patient 360. |
| **Appointment Management** | WHEN is the patient scheduled? | Domain 3 consumes appointment as the entry point for clinical encounter. Appointment status triggers encounter creation. |
| **Clinical & Treatment Management** | WHY treated, WHAT required, WHAT planned, WHAT performed, WHAT outcome, WHAT next | **This domain.** |
| **Financial Management** | HOW MUCH charged, paid, outstanding, refunded, claimed | Domain 3 emits "treatment delivered" event. Finance consumes it to generate invoice. Domain 3 does not own pricing or payment. |
| **Communication** | HOW do we communicate? | Domain 3 emits clinical triggers (follow-up due, recall due, post-treatment instruction). Communication Hub sends the message. |

**Boundary Rule:** No entity is owned by two domains. If a data element appears in two domains, one is the source of truth and the other is a read-only projection.

---

# 5. DESIGN PRINCIPLES

1. **Clinical Safety First** — Allergies and medical history are P0. No treatment can be finalized if critical safety data is unresolved.
2. **Single Source of Truth** — Every entity has one owner. Cross-domain references are read-only projections.
3. **Branch-Scoped, Patient-Centric** — Clinical encounters and sessions are branch-scoped. Patient clinical history is patient-scoped and follows the patient across branches.
4. **Immutable Clinical Record** — Signed clinical notes cannot be edited. Amendments are linked, not overwritten.
5. **Progressive Disclosure** — Complex dental workflows (ortho, implant, endo) are built from universal primitives, not hardcoded per treatment type.
6. **Global Master, Local Override** — Treatment catalog is global. Branches override price, availability, and configuration without duplication.
7. **Audit Everything** — Every clinical create, read, update, delete, sign, approve, finalize, and override is audited.
8. **AI Assists, Never Decides** — AI can summarize, suggest, and flag. It cannot silently write to clinical records.
9. **Mobile-First, Role-Aware** — Doctor workspace is optimized for chairside tablet use. Reception is optimized for speed. Manager is optimized for oversight.
10. **Prototype Before Backend** — All Domain 3 workflows must be validated in the Single HTML review artifact before database/API development.

---

# 6. EXTERNAL EVIDENCE — THE DR PARTNER

## 6.1 Observed Evidence (Direct from Study)

| Feature | Observed in Dr Partner | Source |
|---------|------------------------|--------|
| Treatment categories | Yes — 11 categories (Consultation, Preventive, Restorative, Endodontic, Prosthodontic, Orthodontic, Oral Surgery, Periodontic, Cosmetic, Diagnostic, Emergency) | Section 4.1 |
| Treatment setup with codes | Yes — item code, name, category | Section 4.3 |
| Pricing (price, price2, panel, cost, tax) | Yes — branch-specific pricing, SST, e-Invoice classification | Section 4.3 |
| Package eligibility | Yes — package setup module | Section 2.1, 4.3 |
| Insurance eligibility | Yes — insurance eligible flag | Section 4.3 |
| Specialist requirement | Yes — specialist required flag | Section 4.3 |
| X-ray indicator | Yes — xray required flag | Section 4.3 |
| Dental chart symbol | Yes — dental chart symbol field | Section 4.3 |
| SOAP configuration | Yes — Subjective/Complain, Objective/Reason, Diagnosis/Assessment, Treatment Plan setup | Section 2.1, 9.1 |
| Patient medical history | Yes — field in patient registration | Section 3.1 |
| Allergies | Yes — field in patient registration | Section 3.1 |
| Treatment notes | Yes — clinical documentation | Section 9.2 |
| Procedure recording | Yes — procedure recording | Section 9.2 |
| Follow-up tracking | Yes — follow-up tracking | Section 9.2 |
| Consent forms | Yes — custom forms (consent, MC, time off, PDPA) | Section 2.1, 10.1 |
| Referral documents | Yes — referral letter | Section 10.1 |
| X-ray references | Yes — X-ray document type | Section 10.1 |
| Tooth chart | **Not observed** | Section 9.2 |
| Clinical attachments | **Not observed** | Section 9.2 |
| X-ray integration (DICOM/PACS) | **Not observed** | Section 9.2 |

## 6.2 Existing Medini Capability (Already Built)

| Feature | Medini Status | Phase |
|---------|-------------|-------|
| Treatment catalog (69 treatments) | ✅ Exists — 48 built-in + 21 custom | Phase 2 Appointment v2 |
| Treatment categories | ✅ Exists — 11 categories | Phase 2 Appointment v2 |
| Treatment-linked appointment | ✅ Exists — appointment references treatmentId | Phase 2 Appointment v2 |
| Patient 360 | ✅ Exists — comprehensive patient view | Phase 6 |
| Family relationships | ✅ Exists | Phase 6.1 |
| Referral network | ✅ Exists | Phase 6.1 |
| Follow-up workflow | ✅ Exists | Phase 5.1 |
| Branch scoping (14 branches) | ✅ Exists | Phase 1 |
| RBAC (4 roles) | ✅ Exists | Phase 3.1 |
| Financial isolation | ✅ Exists | Phase 3.1 |
| Dashboard intelligence | ✅ Exists | Phase 4 |
| Timeline aggregation | ✅ Exists | Phase 6 |

## 6.3 Medini Architectural Recommendation (New for Domain 3)

| Feature | Recommendation | Rationale |
|---------|---------------|-----------|
| Tooth-level clinical model | **Medini recommendation** — FDI-based tooth chart with surface-level detail | Not observed in Dr Partner, but critical for dental clinical accuracy. Medini should lead here. |
| Simplified SOAP note builder | **Medini recommendation** — Template-driven, not free-form legacy SOAP | Dr Partner's SOAP is powerful but complex. Medini will use structured templates with quick-select options. |
| Immutable signed notes | **Medini recommendation** — Sign → lock → amend workflow | Not observed in Dr Partner. Medini will enforce clinical governance. |
| Treatment plan versioning | **Medini recommendation** — Draft → Proposed → Accepted → Active → Completed with revision history | Not observed in Dr Partner. Essential for multi-visit orthodontic/implant workflows. |
| Clinical encounter as distinct entity | **Medini recommendation** — Separate from appointment | Dr Partner conflates appointment and encounter. Medini separates scheduling from clinical event. |
| Global treatment master + branch override | **Medini recommendation** — Inheritance pattern | Dr Partner appears to have branch-specific setup. Medini will use a cleaner global+override model. |
| Clinical timeline event sourcing | **Medini recommendation** — Unified event stream | Dr Partner has no unified timeline. Medini already has timeline infrastructure (Phase 6). |
| AI clinical summarization | **Medini recommendation** — Assistive AI with human approval | Not observed in Dr Partner. Medini's AI-first architecture enables this safely. |
| Consent versioning + expiry | **Medini recommendation** — Template version + patient acceptance + expiry tracking | Dr Partner has consent forms but no observed version/expiry workflow. |
| Clinical outcome measurement | **Medini recommendation** — Structured outcome with success criteria | Not observed in Dr Partner. Medini will track clinical outcomes for quality and analytics. |

---

# 7. GAP ANALYSIS

## 7.1 Critical Gaps (P0 — Must Have)

| Gap | Evidence | Impact | Domain 3 Solution |
|-----|----------|--------|-------------------|
| Allergies field | Dr Partner has it; Medini missing | Clinical safety risk | D3.3 Clinical Safety — patient-level allergy record with severity, reaction, confirmed status |
| Medical history | Dr Partner has it; Medini missing | Contraindication risk | D3.3 Clinical Safety — structured medical history with condition, status, notes |
| Dental history | Dr Partner has it; Medini missing | Continuity of care | D3.3 Clinical Safety — previous treatments, existing restorations, missing teeth |
| Treatment codes | Dr Partner has it; Medini missing | Billing/integration readiness | D3.4 Treatment Master — unique treatment code per treatment |
| Treatment pricing reference | Dr Partner has it; Medini missing (0.00 demo) | Financial integration blocked | D3.4 Treatment Master — price, alternate price, panel price, cost, tax classification |
| Clinical documentation | Dr Partner has SOAP; Medini missing | Doctor workflow blocked | D3.2 Assessment + D3.9 Clinical Documentation |
| Treatment plan | Dr Partner has it; Medini missing | Multi-visit tracking blocked | D3.7 Treatment Planning |
| Clinical encounter | Dr Partner conflates with appointment; Medini missing | Clinical accountability unclear | D3.1 Clinical Encounter Management |

## 7.2 Important Gaps (P1 — Should Have)

| Gap | Evidence | Impact | Domain 3 Solution |
|-----|----------|--------|-------------------|
| Tooth-level treatment tracking | Not observed in Dr Partner; Medini missing | Dental clinical accuracy limited | D3.6 Tooth-Level Clinical Model |
| Clinical consent workflow | Dr Partner has forms; Medini missing | Legal/compliance risk | D3.11 Clinical Consent |
| Diagnostic imaging reference | Dr Partner has X-ray doc type; Medini missing | Clinical context incomplete | D3.10 Diagnostic & Imaging |
| Clinical referral workflow | Dr Partner has referral letter; Medini missing | Specialist coordination blocked | D3.12 Clinical Referral |
| Clinical outcome tracking | Not observed in Dr Partner; Medini missing | Quality measurement absent | D3.14 Clinical Outcome |
| Treatment packages | Dr Partner has package setup; Medini missing | Marketing/revenue opportunity | D3.16 Packages / Bundles |

## 7.3 Useful Gaps (P2 — Nice to Have)

| Gap | Evidence | Impact | Domain 3 Solution |
|-----|----------|--------|-------------------|
| Clinical attachments | Not observed in Dr Partner; Medini missing | Record completeness | D3.9 Clinical Documentation — attachment reference |
| Clinical AI summarization | Not observed in Dr Partner; Medini has AI infrastructure | Efficiency gain | D3.39 AI Architecture (future) |
| Clinical analytics | Dr Partner has reports; Medini missing | Business intelligence | D3.40 Reporting & Analytics |

---

# 8. COPY / ADAPT / IMPROVE / REJECT MATRIX

| Dr Partner Feature | Verdict | Medini Action | Reason |
|--------------------|---------|-------------|--------|
| Treatment categories (11) | **COPY** | Adopt as-is for Domain 3 classification | Clinically standard, comprehensive |
| Treatment codes | **COPY** | Adopt unique code per treatment | Essential for billing and integration |
| Pricing structure (price, price2, panel, cost, tax) | **COPY** | Adopt with branch override | Real clinic pricing requires this flexibility |
| Package eligibility flag | **COPY** | Adopt boolean flag on treatment | Simple, effective |
| Insurance eligibility flag | **COPY** | Adopt boolean flag on treatment | Simple, effective |
| Specialist required flag | **COPY** | Adopt boolean flag on treatment | Safety and RBAC enforcement |
| X-ray required flag | **COPY** | Adopt boolean flag on treatment | Clinical workflow trigger |
| Dental chart symbol | **ADAPT** | Map to tooth-level model instead of simple symbol | Dr Partner's symbol is a visual shorthand; Medini will use structured tooth data |
| SOAP configuration | **ADAPT** | Simplify to template-driven clinical note builder | Dr Partner's SOAP setup is overly complex for daily use |
| Medical history field | **ADAPT** | Structured condition list + free text, not just text | Better querying, alerting, and reporting |
| Allergies field | **ADAPT** | Structured allergy record with severity and confirmation workflow | Clinical safety requires more than a text field |
| Consent forms | **ADAPT** | Template + version + digital signature reference + expiry | Dr Partner has forms but no observed lifecycle management |
| Referral documents | **ADAPT** | Structured referral entity + document attachment | Better tracking and follow-up |
| Treatment plan | **IMPROVE** | Multi-version plan with acceptance workflow and session linkage | Dr Partner's plan is basic; Medini supports complex multi-visit workflows |
| Clinical notes | **IMPROVE** | Immutable signed notes with amendment trail | Dr Partner allows editing; Medini enforces clinical governance |
| Tooth chart | **IMPROVE** | Full FDI tooth-level model with surfaces and conditions | Not observed in Dr Partner; Medini leads |
| Clinical timeline | **IMPROVE** | Unified event sourcing from all clinical activities | Dr Partner has no unified timeline |
| AI clinical assistance | **IMPROVE** | Assistive AI with approval workflow | Not observed in Dr Partner; Medini's differentiator |
| Legacy UI patterns | **REJECT** | Do not copy | Medini has superior modern UX |
| Complex inventory | **REJECT** | Out of scope for Domain 3 | Belongs to future Inventory domain |
| Death/DOSH reports | **REJECT** | Out of scope | Not relevant for dental clinic operations |
| Machine/equipment tracking | **REJECT** | Out of scope | Belongs to Operations, not Clinical |
| Tourism report | **REJECT** | Out of scope | Niche, not priority |
| Overly complex SOAP free-form | **REJECT** | Replace with structured templates | Reduces doctor documentation burden |

---

# 9. MODULE ARCHITECTURE

Domain 3 is organized into 16 modules. Each module owns a distinct clinical capability. No module duplicates ownership of another domain's entities.

## D3.1 Clinical Encounter Management
**Purpose:** Define the clinical event — when a patient is seen by a practitioner for clinical purposes.  
**Key Entities:** Clinical Encounter, Encounter Type, Encounter Status, Visit Context  
**Boundary:** Distinct from Appointment (scheduling) and Treatment Session (procedure execution). One appointment may trigger one encounter. An encounter may exist without an appointment (walk-in, emergency).

## D3.2 Clinical Assessment
**Purpose:** Capture the clinical reasoning process — subjective complaint, objective findings, assessment, diagnosis.  
**Key Entities:** Assessment, Subjective, Objective, Diagnosis, Clinical Finding, Severity  
**Boundary:** Uses SOAP as a conceptual framework but implements a simplified, template-driven experience. Does not copy Dr Partner's complex SOAP setup.

## D3.3 Clinical Safety & Patient Clinical Profile
**Purpose:** Maintain patient-level clinical safety data that persists across all encounters and branches.  
**Key Entities:** Allergy, Medical History, Dental History, Clinical Warning, Contraindication, Risk Flag, Emergency Info  
**Boundary:** Patient-scoped, not encounter-scoped. Visible in Patient 360 and during every clinical encounter.

## D3.4 Treatment Master / Treatment Catalog
**Purpose:** Single source of truth for all treatable services.  
**Key Entities:** Treatment, Treatment Code, Category, Subcategory, Price Reference, Tax Classification, Eligibility Flags, Branch Override  
**Boundary:** Global master with branch override. Does not duplicate per branch. Existing 69-treatment catalog from Appointment v2 is absorbed here.

## D3.5 Dental Treatment Classification
**Purpose:** Dental-specific categorization that maps to clinical workflows.  
**Key Entities:** Treatment Category, Treatment Subcategory, Dental Specialty Mapping  
**Boundary:** Classification layer on top of Treatment Master. Does not own treatment definitions.

## D3.6 Tooth-Level Clinical Model
**Purpose:** Track clinical state at the individual tooth level.  
**Key Entities:** Tooth, Tooth Number (FDI), Dentition, Tooth Status, Tooth Condition, Tooth Diagnosis, Tooth Treatment, Treatment Surface  
**Boundary:** Dental-specific. Not observed in Dr Partner. Medini architectural recommendation.

## D3.7 Treatment Planning
**Purpose:** Plan multi-visit treatment sequences with versioning and patient acceptance.  
**Key Entities:** Treatment Plan, Plan Version, Plan Item, Plan Status, Diagnosis Linkage, Treatment Sequence, Patient Acceptance  
**Boundary:** Clinical planning only. Does not schedule appointments (Appointment Management does that). Does not price (Finance does that).

## D3.8 Treatment / Procedure Execution
**Purpose:** Record what was actually done during a treatment session.  
**Key Entities:** Treatment Session, Procedure, Procedure Step, Practitioner, Assistant, Clinical Outcome, Complication, Post-Treatment Instruction  
**Boundary:** Session is the execution event. Distinct from Appointment (scheduled), Encounter (clinical context), and Plan (intention).

## D3.9 Clinical Documentation
**Purpose:** Immutable, auditable clinical notes and attachments.  
**Key Entities:** Clinical Note, SOAP Note (adapted), Consultation Note, Treatment Note, Procedure Note, Progress Note, Clinical Attachment, Amendment  
**Boundary:** Notes are signed and immutable. Amendments are linked, not edited. Attachments are references, not stored files (future: secure object storage).

## D3.10 Diagnostic & Imaging
**Purpose:** Reference diagnostic images and results.  
**Key Entities:** Diagnostic Request, Imaging Record, X-ray (IOPA/OPG/CBCT), Clinical Photo, Imaging Result, Tooth Linkage  
**Boundary:** Medini stores metadata and external references, not DICOM/PACS files. Future integration is possible but not in v1.0.

## D3.11 Clinical Consent
**Purpose:** Manage patient consent for treatments, procedures, and data processing.  
**Key Entities:** Consent Type, Consent Template, Consent Version, Consent Request, Consent Status, Digital Signature Reference, Expiry, Withdrawal  
**Boundary:** Clinical consent is distinct from general PDPA consent (which may be owned by Patient Management or Communication). Domain 3 owns treatment/procedure-specific consent.

## D3.12 Clinical Referral
**Purpose:** Refer patient to internal or external specialists with clinical context.  
**Key Entities:** Referral, Referral Type, Specialist, Referral Reason, Clinical Summary, Referral Document, Referral Outcome  
**Boundary:** Integrates with existing Patient 360 Referral Network (Phase 6.1). Does not duplicate the network.

## D3.13 Follow-up & Recall
**Purpose:** Ensure continuity of care through scheduled follow-ups and recalls.  
**Key Entities:** Clinical Follow-up, Follow-up Type, Recall Interval, Recall Due Date, Follow-up Status, Reminder Trigger, Appointment Creation  
**Boundary:** Clinical follow-up is triggered by clinical events (treatment completion, outcome review). General patient follow-up exists in Phase 5.1. Domain 3 extends it with clinical context.

## D3.14 Clinical Outcome
**Purpose:** Measure and record the result of treatment.  
**Key Entities:** Treatment Outcome, Clinical Progress, Success Criteria, Outcome Measurement, Complication, Adverse Event, Before/After State  
**Boundary:** Outcome is clinical, not financial. Success is measured clinically, not by payment.

## D3.15 Clinical Timeline
**Purpose:** Unified event stream for Patient 360 and audit.  
**Key Entities:** Clinical Event, Event Source, Event Timestamp, Actor, Branch, Audit Relationship  
**Boundary:** Aggregates events from all Domain 3 modules. Patient 360 consumes this timeline. Does not duplicate the existing timeline infrastructure.

## D3.16 Packages / Bundles
**Purpose:** Group treatments into sellable packages with consumption tracking.  
**Key Entities:** Treatment Package, Package Item, Package Price, Package Eligibility, Package Consumption, Package Balance, Package Expiry  
**Boundary:** Package references Treatment Master. It is not a duplicate catalog. Package consumption triggers financial events.

---

# 9.1 SUBMODULE ARCHITECTURE (Summary)

| Module | Submodules |
|--------|-----------|
| D3.1 Clinical Encounter | Encounter creation, encounter status workflow, visit context, encounter timeline |
| D3.2 Clinical Assessment | Subjective capture, objective capture, assessment/diagnosis, severity grading, assessment history |
| D3.3 Clinical Safety | Allergy management, medical history, dental history, risk flags, safety alerts, contraindication checking |
| D3.4 Treatment Master | Treatment definition, pricing reference, eligibility flags, branch override, treatment versioning |
| D3.5 Dental Classification | Category management, specialty mapping, treatment-to-category assignment |
| D3.6 Tooth-Level Model | Tooth chart, tooth status tracking, surface-level treatment, dentition management |
| D3.7 Treatment Planning | Plan creation, item sequencing, version management, patient acceptance, plan completion |
| D3.8 Treatment Execution | Session management, procedure recording, outcome capture, complication tracking |
| D3.9 Clinical Documentation | Note authoring, signing, amendment, attachment management |
| D3.10 Diagnostic & Imaging | Imaging request, result recording, tooth linkage, external reference |
| D3.11 Clinical Consent | Template management, consent capture, expiry tracking, withdrawal |
| D3.12 Clinical Referral | Referral creation, specialist assignment, outcome tracking, document generation |
| D3.13 Follow-up & Recall | Follow-up scheduling, recall interval management, reminder triggering, completion tracking |
| D3.14 Clinical Outcome | Outcome definition, measurement, complication recording, success evaluation |
| D3.15 Clinical Timeline | Event aggregation, timeline rendering, audit trail |
| D3.16 Packages | Package definition, eligibility checking, consumption tracking, balance management |

---
# 10. ENTITY ARCHITECTURE

> **Scope note:** Patient identity entity (Name, IC, DOB, Gender, Contact) is OWNED by Patient Management (Phase 6/6.3). Domain 3 references it but does not re-define it. All entities below are Domain 3-owned unless marked EXTERNAL.

## 10.1 Entity Inventory

| # | Entity | Owner Module | Purpose | Branch Scope |
|---|--------|-------------|---------|--------------|
| E1 | Patient | Patient Mgmt (EXTERNAL ref) | Patient identity | PATIENT-SCOPED |
| E2 | Clinical Profile | D3.3 | Patient-level clinical summary aggregation | PATIENT-SCOPED |
| E3 | Allergy | D3.3 | Allergen + severity + reaction + confirmation | PATIENT-SCOPED |
| E4 | Medical History | D3.3 | Systemic conditions relevant to dental care | PATIENT-SCOPED |
| E5 | Dental History | D3.3 | Past dental events, existing restorations, notes | PATIENT-SCOPED |
| E6 | Clinical Encounter | D3.1 | One clinical visit event | ENCOUNTER-SCOPED |
| E7 | Assessment | D3.2 | SOAP-adapted clinical reasoning block | ENCOUNTER-SCOPED |
| E8 | Diagnosis | D3.2 | Clinical conclusion(s) | ENCOUNTER-SCOPED |
| E9 | Treatment | D3.4 | Catalog service definition | GLOBAL + BRANCH OVERRIDE |
| E10 | Treatment Category | D3.5 | Classification (11 categories) | GLOBAL |
| E11 | Treatment Plan | D3.7 | Multi-visit plan (versioned) | BRANCH-SCOPED |
| E12 | Treatment Plan Item | D3.7 | Line item in plan | BRANCH-SCOPED |
| E13 | Treatment Session | D3.8 | Execution event of treatment | BRANCH-SCOPED |
| E14 | Procedure | D3.8 | Individual procedure step | SESSION-SCOPED |
| E15 | Clinical Note | D3.9 | Immutable signed documentation | ENCOUNTER/SESSION-SCOPED |
| E16 | Clinical Attachment | D3.9 | Document/image reference | ENCOUNTER/SESSION-SCOPED |
| E17 | Consent | D3.11 | Patient acceptance of treatment | BRANCH-SCOPED |
| E18 | Referral | D3.12 | Internal/external specialist referral | BRANCH-SCOPED |
| E19 | Imaging Record | D3.10 | X-ray/photo metadata + reference | ENCOUNTER-SCOPED |
| E20 | Clinical Outcome | D3.14 | Result of treatment | SESSION-SCOPED |
| E21 | Follow-up | D3.13 | Clinical follow-up/recall | BRANCH-SCOPED |
| E22 | Recall | D3.13 | Scheduled recall instance | BRANCH-SCOPED |
| E23 | Tooth | D3.6 | Tooth state (FDI) | PATIENT-SCOPED |
| E24 | Tooth Condition | D3.6 | Condition record per tooth | TOOTH-SCOPED (patient-level) |
| E25 | Tooth Treatment | D3.6 | Treatment record linked to tooth+surfaces | SESSION-SCOPED |
| E26 | Clinical Event | D3.15 | Timeline event (append-only) | BRANCH-SCOPED (event source) |
| E27 | Treatment Package | D3.16 | Package of treatments | BRANCH-SCOPED |
| E28 | Package Consumption | D3.16 | Used balance per package | BRANCH-SCOPED |

## 10.2 Entity Specifications

### E2 — Clinical Profile
- **Purpose:** Aggregated, always-current clinical safety view per patient (allergies + conditions + warnings + emergency info).
- **Primary ID:** `clinicalProfileId` (1:1 with patientId)
- **Key fields:** patientId, allergySummary, conditionSummary, activeWarnings[], emergencyContact, emergencyNotes, lastReviewedAt, lastReviewedBy
- **Relationships:** 1:1 Patient; 1:N Allergy; 1:N MedicalHistory; 1:N DentalHistory; 1:N ClinicalWarning
- **Lifecycle:** Always Active (updated in place via linked records; never deleted)
- **Audit:** Every underlying record change audited; profile itself is a projection (no direct writes)

### E3 — Allergy
- **Purpose:** Clinical safety record of allergen exposure risk.
- **Primary ID:** `allergyId`
- **Key fields:** patientId, allergen, allergyType (drug/material/food/other), severity (mild/moderate/severe), reaction, status (unconfirmed/confirmed/inactive), recordedById, confirmedById, confirmedAt, notes
- **Relationships:** N:1 Patient; N:1 ClinicalProfile
- **Lifecycle:** Unconfirmed → Confirmed; any → Inactive (not deleted)
- **Audit:** Create/edit/confirm all audited; P0 safety data

### E4 — Medical History
- **Purpose:** Systemic conditions affecting dental treatment.
- **Primary ID:** `medicalHistoryId`
- **Key fields:** patientId, condition, category (cardiac/diabetic/bleeding/respiratory/pregnancy/neurological/other), status (active/resolved), details, recordedById, recordedAt, source
- **Relationships:** N:1 Patient
- **Lifecycle:** Active → Resolved (history preserved)
- **Audit:** Create/edit audited; P0 safety data

### E5 — Dental History
- **Purpose:** Longitudinal dental narrative + derived tooth state.
- **Primary ID:** `dentalHistoryId` (one current record per patient; revisions preserved)
- **Key fields:** patientId, previousTreatmentsSummary, existingRestorations (derived from Tooth records), missingTeeth (derived), notes, updatedById, updatedAt
- **Relationships:** 1:1 Patient; 1:N Tooth
- **Lifecycle:** Always current; derived fields auto-recompute from Tooth/Treatment data
- **Audit:** Manual edits audited; derived changes logged

### E6 — Clinical Encounter
- **Purpose:** One clinical visit — the WHY/WHAT context container.
- **Primary ID:** `encounterId` (ENC-0001)
- **Key fields:** encounterId, patientId, appointmentId (nullable), practitionerId, assistantId (nullable), branchId, encounterType (consultation/treatment/review/emergency/walk-in), dateTime, chiefComplaint, visitContext, status (draft/open/completed/finalized), clinicalSummary, createdById, finalizedById, finalizedAt
- **Relationships:** N:1 Patient; 0..1:1 Appointment (EXTERNAL); 1:N Assessment; 1:N ClinicalNote; 1:N ImagingRecord; 1:N TreatmentSession; 1:N Referral
- **Lifecycle:** Draft → Open → Completed → Finalized
- **Audit:** Full lifecycle audit; finalization locks encounter

### E7 — Assessment
- **Purpose:** SOAP-adapted reasoning block (S/O/A captured here; P links to Treatment Plan).
- **Primary ID:** `assessmentId`
- **Key fields:** encounterId, subjective, objective, assessmentText, templateId, practitionerId, severity, status (draft/complete)
- **Relationships:** N:1 Encounter; 1:N Diagnosis
- **Lifecycle:** Draft → Complete (linked to encounter lifecycle)
- **Audit:** Edits before completion logged; after completion → amendment only

### E8 — Diagnosis
- **Purpose:** Clinical conclusion; may be tooth-linked.
- **Primary ID:** `diagnosisId`
- **Key fields:** encounterId, assessmentId, patientId, code (optional future ICD-10/ICD-DA), description, toothId (nullable), severity, status (provisional/confirmed/resolved), isDifferential (bool), confirmedById, confirmedAt
- **Relationships:** N:1 Assessment; 0..1 Tooth; N:1 Patient; 1:N TreatmentPlan (informs)
- **Lifecycle:** Provisional → Confirmed → Resolved
- **Audit:** Create/confirm/resolve audited

### E9 — Treatment (see Section 13 for full spec)
- **Primary ID:** `treatmentId` (T001…T069 + branch customs)
- **Purpose:** Master catalog service definition. GLOBAL with branch override.

### E11 — Treatment Plan
- **Primary ID:** `planId` (PLN-0001)
- **Key fields:** planId, patientId, originEncounterId, diagnosisIds[], practitionerId, branchId, version, status (draft/proposed/accepted/active/completed/cancelled/superseded), estimatedSessions, estimatedDurationDays, priority, items[], presentedAt, acceptedAt, acceptedById, declinedReason, completedAt
- **Relationships:** 1:N Patient; 1:N PlanItem; N:M Diagnosis; 1:N TreatmentSession (via items); 1:N Consent (linked)
- **Lifecycle:** Draft → Proposed → Accepted → Active → Completed / Cancelled / Superseded
- **Audit:** Every version + transition audited

### E12 — Treatment Plan Item
- **Primary ID:** `planItemId`
- **Key fields:** planId, sequence, treatmentId, treatmentSnapshot, toothIds[] (nullable), surfaces[] (nullable), plannedSessions, dependencies (planItemId refs), priority, status (planned/in-progress/completed/cancelled), completedAt
- **Relationships:** N:1 Plan; N:1 Treatment; 0..N Tooth; 0..N TreatmentSession (executions)
- **Lifecycle:** Planned → In-Progress → Completed / Cancelled
- **Audit:** State transitions audited

### E13 — Treatment Session
- **Primary ID:** `sessionId` (SES-0001)
- **Key fields:** sessionId, planId (nullable), planItemId (nullable), appointmentId (nullable), encounterId (nullable), patientId, branchId, practitionerId, assistantId, treatmentId, toothIds[] (nullable), startTime, endTime, status (scheduled/checked-in/in-progress/completed/finalized/cancelled), notes, outcomeId (nullable)
- **Relationships:** N:1 Patient; 0..1 PlanItem; 0..1 Appointment (EXTERNAL); 0..1 Encounter; 1:N ClinicalNote; 1:0..1 Outcome; 0..N Followup
- **Lifecycle:** Scheduled → Checked-in → In-Progress → Completed → Finalized / Cancelled
- **Audit:** Full audit; finalization locks session

### E14 — Procedure
- **Primary ID:** `procedureId`
- **Key fields:** sessionId, procedureName (e.g. "Crown preparation", "Impression"), sequence, startTime, endTime, materialsUsed[], equipmentRef (nullable), practitionerId, assistantId, status, notes
- **Relationships:** N:1 Session
- **Lifecycle:** Pending → In-Progress → Completed / Skipped
- **Audit:** Recorded + timestamps

### E15 — Clinical Note
- **Primary ID:** `noteId`
- **Key fields:** noteId, patientId, encounterId (nullable), sessionId (nullable), noteType (consultation/treatment/procedure/progress), content, templateId, status (draft/signed/amended), authorId, signedAt, amendedViaId (nullable)
- **Relationships:** N:1 Patient; 0..1 Encounter; 0..1 Session; 1:0..1 Amendment (self)
- **Lifecycle:** Draft → Signed → Amended (via linked amendment, original never edited)
- **Audit:** Author, timestamp, content hash; immutable after sign

### E16 — Clinical Attachment
- **Primary ID:** `attachmentId`
- **Key fields:** attachmentId, patientId, noteId (nullable), imagingId (nullable), fileName, fileType, mimeType, sizeBytes, storageRef (object storage ref), uploadedById, uploadedAt, category
- **Relationships:** N:1 Patient; 0..1 Note; 0..1 Imaging
- **Lifecycle:** Active → Archived (never deleted)
- **Audit:** Upload + access audited

### E17 — Consent
- **Primary ID:** `consentId`
- **Key fields:** consentId, patientId, consentType (treatment/procedure/imaging/pdpa), templateVersionId, planId (nullable), treatmentId (nullable), status (pending/accepted/expired/withdrawn), acceptedAt, acceptedById, signatureRef (digital signature reference), withdrawnAt, withdrawnById, withdrawnReason, expiryDate
- **Relationships:** N:1 Patient; 0..1 Plan; 0..1 Treatment; N:1 ConsentTemplate
- **Lifecycle:** Pending → Accepted → Expired / Withdrawn
- **Audit:** Full lifecycle audit; signature ref immutable

### E18 — Referral
- **Primary ID:** `referralId`
- **Key fields:** referralId, patientId, referralType (internal/external), fromPractitionerId, toPractitionerId (nullable), toSpecialty, toInstitution (nullable), reason, clinicalSummary, referralDate, documentRef (nullable), status (draft/sent/received/in-progress/completed/closed), outcome, followUpId (nullable)
- **Relationships:** N:1 Patient; 0..1 Encounter; 0..1 Document; integrates with Referral Network (Phase 6.1) — network is PATIENT-level; Referral is CLINICAL-event-level
- **Lifecycle:** Draft → Sent → Received → In-Progress → Completed / Closed
- **Audit:** Full audit

### E19 — Imaging Record
- **Primary ID:** `imagingId`
- **Key fields:** imagingId, patientId, encounterId (nullable), imagingType (IOPA/OPG/CBCT/photo/study-model), toothIds[] (nullable), requestPractitionerId, resultSummary, reportText (nullable), imagingDate, storageRef (object storage), status (requested/uploaded/reported), branchId
- **Relationships:** N:1 Patient; 0..1 Encounter; 0..N Tooth; 1:0..1 Attachment
- **Lifecycle:** Requested → Uploaded → Reported
- **Audit:** Upload + report + access audited. NOTE: metadata + reference only; NO DICOM/PACS engine in v1.0 (Medini recommendation — separate current from future)

### E20 — Clinical Outcome
- **Primary ID:** `outcomeId`
- **Key fields:** outcomeId, sessionId, patientId, outcome (success/partial/complication/failed), successCriteria[], measurement, complication (nullable), adverseEvent (nullable), reviewedById, reviewedAt, beforeStateRef, afterStateRef
- **Relationships:** 1:1 Session; N:1 Patient
- **Lifecycle:** Recorded → Reviewed → Closed
- **Audit:** Full audit; adverse event = mandatory report flag

### E21 — Follow-up
- **Primary ID:** `followUpId`
- **Key fields:** followUpId, patientId, sessionId (nullable), treatmentId (nullable), followUpType (post-treatment/recall/review), intervalDays, dueDate, status (pending/due/contacted/booked/completed/closed), communicationTriggered (bool), appointmentCreatedId (nullable), outcome
- **Relationships:** N:1 Patient; 0..1 Session; 0..1 Appointment (created)
- **Lifecycle:** Pending → Due → Contacted → Booked → Completed / Closed
- **Audit:** State transitions audited

### E22 — Recall
- **Primary ID:** `recallId`
- **Key fields:** recallId, patientId, baseTreatmentId, intervalMonths, lastDueDate, nextDueDate, status, reminderSentAt, bookedAppointmentId
- **Relationships:** N:1 Patient; 0..1 Appointment
- **Lifecycle:** Scheduled → Due → Reminded → Booked / Completed / Closed
- **Audit:** Reminder + booking audited

### E23 — Tooth
- **Primary ID:** `toothId` (patientId + FDI number unique)
- **Key fields:** patientId, fdiNumber (11–48 permanent, 51–85 primary), dentition (permanent/primary/mixed), status (present/missing/extracted/impacted/erupting/not-erupted), condition (healthy/caries/restored/rct/crowned/implant/bridge-pontic/watch/fractured), lastUpdatedById, lastUpdatedAt
- **Relationships:** N:1 Patient; 1:N ToothCondition; 1:N ToothTreatment; 0..N Imaging
- **Lifecycle:** Present → (Extracted/Missing); conditions accumulate, never overwritten silently
- **Audit:** Every condition change audited (dental chart is a clinical record)

### E24 — Tooth Condition
- **Primary ID:** `toothConditionId`
- **Key fields:** toothId, conditionType, surfaces[] (M/O/D/B/L or M/D/I/L), fromDate, toDate (nullable), note, recordedById
- **Relationships:** N:1 Tooth
- **Lifecycle:** Active → Resolved (history preserved)
- **Audit:** Audited

### E25 — Tooth Treatment
- **Primary ID:** `toothTreatmentId`
- **Key fields:** toothId, sessionId, planItemId (nullable), treatmentId, surfaces[], beforeState, afterState, completedAt, practitionerId
- **Relationships:** N:1 Tooth; N:1 Session; 0..1 PlanItem
- **Lifecycle:** Planned → Completed (mirrors session)
- **Audit:** Audited

### E26 — Clinical Event
- **Primary ID:** `eventId` (append-only)
- **Key fields:** eventId, patientId, entityType, entityId, action (created/updated/signed/finalized/cancelled/etc.), actorId, actorRole, branchId, timestamp, dataHash, metadata (JSON)
- **Relationships:** N:1 Patient; N:1 Actor
- **Lifecycle:** Append-only (immutable)
- **Audit:** This entity IS the audit + timeline backbone

### E27 — Treatment Package
- **Primary ID:** `packageId`
- **Key fields:** packageId, name, description, branchId (nullable = global), items[], price, validityDays, status (draft/active/inactive), taxClass, eInvoiceClass
- **Relationships:** 1:N PackageItem (references Treatment); 1:N PackageConsumption
- **Lifecycle:** Draft → Active → Inactive
- **Audit:** Setup audited

### E28 — Package Consumption
- **Primary ID:** `consumptionId`
- **Key fields:** packageId, patientId, packagePurchaseRef (EXTERNAL to Finance), totalSessions, usedSessions, remainingBalance, expiryDate, status
- **Relationships:** N:1 Package; N:1 Patient
- **Lifecycle:** Active → Expired / Exhausted
- **Audit:** Consumption events audited

---

# 11. DATA DICTIONARY

> Conventions: `S` = Sensitive clinical, `P0` = safety-critical, `AUD` = audited. Types are conceptual (no SQL types yet).

## 11.1 Clinical Encounter

| Field | Meaning | Type | Req | Source of Truth | Validation | Editable By | Scope | Sens | Audit |
|-------|---------|------|-----|-----------------|-----------|-------------|-------|------|-------|
| encounterId | Unique encounter number | Text (ENC-xxxx) | Y | Clinical | Auto-generated | System | ENC | - | - |
| patientId | Patient reference | Ref | Y | Patient Mgmt | Exists | System | PAT | - | - |
| appointmentId | Source appointment (nullable) | Ref | N | Appointment Mgmt | Status not cancelled | System | ENC | - | - |
| practitionerId | Doctor in charge | Ref | Y | Staff | Valid doctor | Doctor/Manager | ENC | - | AUD |
| assistantId | Nurse/assistant (nullable) | Ref | N | Staff | Valid staff | Doctor/Manager | ENC | - | - |
| branchId | Branch where care delivered | Ref | Y | Branch | In allowed scope | System (from context) | ENC | - | AUD |
| encounterType | consultation/treatment/review/emergency/walk-in | Enum | Y | Clinical | Allowed set | Doctor/Reception | ENC | - | - |
| dateTime | Encounter start | DateTime | Y | Clinical | Not future > 1h | Doctor | ENC | - | AUD |
| chiefComplaint | Patient presenting complaint | Text (short) | Y | Clinical | 3-500 chars | Doctor/Reception | ENC | S | AUD |
| visitContext | Reason/context free text | Text | N | Clinical | - | Doctor | ENC | S | - |
| status | draft/open/completed/finalized | Enum | Y | Clinical | Transition rules | Doctor | ENC | - | AUD |
| clinicalSummary | Auto/summary of visit | Text | N | Clinical | Post-completion | Doctor (AI assist) | ENC | S | AUD |
| finalizedAt | Lock timestamp | DateTime | N | Clinical | On finalize | System | ENC | - | AUD |

## 11.2 Assessment (SOAP-adapted)

| Field | Meaning | Type | Req | Source of Truth | Validation | Editable By | Scope | Sens | Audit |
|-------|---------|------|-----|-----------------|-----------|-------------|-------|------|-------|
| assessmentId | ID | Text (ASM-xxxx) | Y | Clinical | Auto | System | ENC | - | - |
| encounterId | Parent encounter | Ref | Y | Clinical | Exists | System | ENC | - | - |
| subjective (S) | Complaint, history in patient words | Text | Y | Clinical | Free text + templates | Doctor | ENC | S | AUD |
| objective (O) | Clinical findings, exam | Text | Y | Clinical | Free text + templates | Doctor | ENC | S | AUD |
| assessmentText (A) | Clinician interpretation | Text | Y | Clinical | Free text | Doctor | ENC | S | AUD |
| templateId | Quick-select template used | Ref | N | Clinical | Valid template | Doctor | ENC | - | - |
| severity | mild/moderate/severe | Enum | N | Clinical | - | Doctor | ENC | S | AUD |
| status | draft/complete | Enum | Y | Clinical | Draft-Complete | Doctor | ENC | - | AUD |

## 11.3 Diagnosis

| Field | Meaning | Type | Req | Source of Truth | Validation | Editable By | Scope | Sens | Audit |
|-------|---------|------|-----|-----------------|-----------|-------------|-------|------|-------|
| diagnosisId | ID | Text (DX-xxxx) | Y | Clinical | Auto | System | ENC | - | - |
| code | Optional ICD-10/ICD-DA code | Text | N | Clinical | Future coding | Doctor | ENC | S | AUD |
| description | Diagnosis text | Text | Y | Clinical | 3-500 chars | Doctor | ENC | S | AUD |
| toothId | Tooth linkage (nullable) | Ref | N | Clinical | FDI valid | Doctor | ENC | S | AUD |
| severity | mild/moderate/severe | Enum | N | Clinical | - | Doctor | ENC | S | AUD |
| status | provisional/confirmed/resolved | Enum | Y | Clinical | Transition rules | Doctor | ENC | S | AUD |
| isDifferential | Flag: differential dx | Bool | Y | Clinical | - | Doctor | ENC | - | - |
| confirmedById | Confirming clinician | Ref | N | Clinical | Doctor only | Doctor | ENC | - | AUD |
| confirmedAt | Confirmation time | DateTime | N | Clinical | System | System | ENC | - | AUD |

## 11.4 Allergy (P0)

| Field | Meaning | Type | Req | Source of Truth | Validation | Editable By | Scope | Sens | Audit |
|-------|---------|------|-----|-----------------|-----------|-------------|-------|------|-------|
| allergyId | ID | Text | Y | Clinical | Auto | System | PAT | S/P0 | - |
| patientId | Patient | Ref | Y | Patient Mgmt | Exists | System | PAT | S/P0 | - |
| allergen | Allergen name | Text | Y | Clinical | 2-200 chars | Reception (record) / Doctor | PAT | S/P0 | AUD |
| allergyType | drug/material/food/other | Enum | Y | Clinical | Allowed set | Reception/Doctor | PAT | S/P0 | AUD |
| severity | mild/moderate/severe | Enum | Y | Clinical | - | Doctor | PAT | S/P0 | AUD |
| reaction | Reaction description | Text | N | Clinical | - | Doctor | PAT | S/P0 | AUD |
| status | unconfirmed/confirmed/inactive | Enum | Y | Clinical | Unconfirmed-Confirmed | Doctor confirms | PAT | S/P0 | AUD |
| confirmedById | Clinician who confirmed | Ref | N | Clinical | Doctor only | Doctor | PAT | S/P0 | AUD |
| recordedById | Who entered it | Ref | Y | Clinical | Staff | System | PAT | S/P0 | AUD |

## 11.5 Medical History (P0)

| Field | Meaning | Type | Req | Source of Truth | Validation | Editable By | Scope | Sens | Audit |
|-------|---------|------|-----|-----------------|-----------|-------------|-------|------|-------|
| medicalHistoryId | ID | Text | Y | Clinical | Auto | System | PAT | S/P0 | - |
| condition | Condition name | Text | Y | Clinical | 2-200 chars | Doctor/Reception | PAT | S/P0 | AUD |
| category | cardiac/diabetic/bleeding/respiratory/pregnancy/neurological/other | Enum | Y | Clinical | Allowed set | Doctor | PAT | S/P0 | AUD |
| status | active/resolved | Enum | Y | Clinical | - | Doctor | PAT | S/P0 | AUD |
| details | Clinical detail | Text | N | Clinical | - | Doctor | PAT | S/P0 | AUD |
| recordedById | Who entered | Ref | Y | Clinical | Staff | System | PAT | S/P0 | AUD |
| recordedAt | Entry time | DateTime | Y | Clinical | System | System | PAT | S/P0 | AUD |

## 11.6 Treatment (see Section 13 for full versioning spec)

| Field | Meaning | Type | Req | Source of Truth | Validation | Editable By | Scope | Sens | Audit |
|-------|---------|------|-----|-----------------|-----------|-------------|-------|------|-------|
| treatmentId | ID | Text (T001) | Y | Treatment Master | Auto | System | GLOBAL | - | - |
| code | Short code | Text | Y | Treatment Master | Unique | HQ | GLOBAL | - | AUD |
| name | Display name | Text | Y | Treatment Master | Unique per code | HQ | GLOBAL | - | AUD |
| category | 11 categories | Ref | Y | D3.5 | Valid | HQ | GLOBAL | - | AUD |
| source | builtin / medini-custom / branch-custom | Enum | Y | Treatment Master | - | HQ/Manager | GLOBAL/BR | - | AUD |
| price / price2 / panelPrice / cost | Pricing references | Money | N (demo 0) | Finance ref (not owner) | >= 0 | HQ/Manager (branch override) | BR | - | AUD |
| taxPercent | SST % | Decimal | N | Finance ref | 0-100 | HQ | BR | - | AUD |
| eInvoiceClassification | e-Invoice class | Text | N | Finance ref | Valid class | HQ | BR | - | AUD |
| dentalChartSymbol | Chart glyph | Text | N | Treatment Master | Symbol map | HQ | GLOBAL | - | - |
| xrayRequired | X-ray needed flag | Bool | Y | Treatment Master | - | HQ | GLOBAL | - | - |
| specialistRequired | Specialist flag | Bool | Y | Treatment Master | - | HQ | GLOBAL | - | AUD |
| packageEligible | Can be in package | Bool | Y | Treatment Master | - | HQ | GLOBAL | - | - |
| insuranceEligible | Claimable flag | Bool | Y | Treatment Master | - | HQ | GLOBAL | - | - |
| active | Active/inactive | Bool | Y | Treatment Master | Inactive = no new booking | HQ/Manager | GLOBAL/BR | - | AUD |
| effectiveDate / version | Versioning | Date/Int | Y | Treatment Master | - | System | GLOBAL | - | AUD |

## 11.7 Treatment Plan

| Field | Meaning | Type | Req | Source of Truth | Validation | Editable By | Scope | Sens | Audit |
|-------|---------|------|-----|-----------------|-----------|-------------|-------|------|-------|
| planId | ID | Text (PLN-xxxx) | Y | Clinical | Auto | System | BR | - | - |
| patientId | Patient | Ref | Y | Patient Mgmt | Exists | System | PAT | - | - |
| originEncounterId | Encounter where plan created | Ref | N | Clinical | Exists | System | BR | - | AUD |
| diagnosisIds[] | Linked diagnoses | Ref[] | N | Clinical | Exists | Doctor | BR | S | AUD |
| practitionerId | Planning doctor | Ref | Y | Staff | Doctor | Doctor | BR | - | AUD |
| version | Plan version | Int | Y | Clinical | Auto-increment | System | BR | - | AUD |
| status | draft/proposed/accepted/active/completed/cancelled/superseded | Enum | Y | Clinical | State machine | Doctor/Patient | BR | - | AUD |
| estimatedSessions | Expected visits | Int | N | Clinical | >=1 | Doctor | BR | - | - |
| priority | low/normal/high/urgent | Enum | N | Clinical | - | Doctor | BR | - | - |
| acceptedAt / acceptedById | Acceptance | Date/Ref | N | Clinical | Doctor confirms | Doctor | BR | - | AUD |

## 11.8 Treatment Plan Item

| Field | Meaning | Type | Req | Source of Truth | Validation | Editable By | Scope | Sens | Audit |
|-------|---------|------|-----|-----------------|-----------|-------------|-------|------|-------|
| planItemId | ID | Text | Y | Clinical | Auto | System | BR | - | - |
| sequence | Order in plan | Int | Y | Clinical | >=1 | Doctor | BR | - | - |
| treatmentId | Treatment | Ref | Y | Treatment Master | Active | Doctor | BR | - | AUD |
| treatmentSnapshot | Copy of treatment at plan time | JSON | Y | Treatment Master | Frozen | System | BR | - | AUD |
| toothIds[] / surfaces[] | Tooth/plan surfaces | Ref[]/Text[] | N | Clinical | FDI valid | Doctor | BR | S | AUD |
| plannedSessions | Sessions needed | Int | Y | Clinical | >=1 | Doctor | BR | - | - |
| dependencies | Must-run-after items | Ref[] | N | Clinical | No cycle | Doctor | BR | - | - |
| status | planned/in-progress/completed/cancelled | Enum | Y | Clinical | Rules | Doctor/System | BR | - | AUD |

## 11.9 Treatment Session

| Field | Meaning | Type | Req | Source of Truth | Validation | Editable By | Scope | Sens | Audit |
|-------|---------|------|-----|-----------------|-----------|-------------|-------|------|-------|
| sessionId | ID | Text (SES-xxxx) | Y | Clinical | Auto | System | BR | - | - |
| planItemId | Plan item executed | Ref | N | Clinical | Exists | Doctor | BR | - | AUD |
| appointmentId | Linked appointment | Ref | N | Appt Mgmt | Not cancelled | System | BR | - | - |
| encounterId | Encounter container | Ref | N | Clinical | Exists | System | BR | - | - |
| treatmentId | Treatment delivered | Ref | Y | Treatment Master | Active or historical | Doctor | BR | - | AUD |
| toothIds[] | Teeth involved | Ref[] | N | Clinical | FDI valid | Doctor | BR | S | AUD |
| practitionerId / assistantId | Team | Ref | Y/N | Staff | Valid | Doctor/Manager | BR | - | AUD |
| startTime / endTime | Execution window | DateTime | Y | Clinical | start < end | Doctor/System | BR | - | AUD |
| status | scheduled/checked-in/in-progress/completed/finalized/cancelled | Enum | Y | Clinical | State machine | Doctor | BR | - | AUD |
| notes | Session notes | Text | N | Clinical | - | Doctor | BR | S | AUD |

## 11.10 Clinical Note

| Field | Meaning | Type | Req | Source of Truth | Validation | Editable By | Scope | Sens | Audit |
|-------|---------|------|-----|-----------------|-----------|-------------|-------|------|-------|
| noteId | ID | Text (NTE-xxxx) | Y | Clinical | Auto | System | BR | - | - |
| noteType | consultation/treatment/procedure/progress | Enum | Y | Clinical | - | Doctor | BR | - | - |
| content | Note body | Text | Y | Clinical | 1-20k chars | Doctor (draft only) | BR | S | AUD |
| status | draft/signed/amended | Enum | Y | Clinical | Draft-Signed-Amended | Doctor | BR | - | AUD |
| authorId | Author | Ref | Y | Clinical | Doctor | System (fixed) | BR | - | AUD |
| signedAt | Immutability point | DateTime | N | Clinical | System | System | BR | - | AUD |
| amendedViaId | Linked amendment | Ref | N | Clinical | Self-ref | System | BR | - | AUD |
| contentHash | Integrity hash | Hash | N | Clinical | Computed at sign | System | BR | - | AUD |

## 11.11 Consent

| Field | Meaning | Type | Req | Source of Truth | Validation | Editable By | Scope | Sens | Audit |
|-------|---------|------|-----|-----------------|-----------|-------------|-------|------|-------|
| consentId | ID | Text | Y | Clinical | Auto | System | BR | - | - |
| consentType | treatment/procedure/imaging/pdpa | Enum | Y | Clinical | - | Doctor/Reception | BR | - | AUD |
| templateVersionId | Version of form used | Ref | Y | Clinical | Active template | System | BR | - | AUD |
| treatmentId / planId | What consent covers | Ref | N | Clinical | Exists | Doctor | BR | S | AUD |
| status | pending/accepted/expired/withdrawn | Enum | Y | Clinical | State machine | Doctor/Patient | BR | - | AUD |
| acceptedAt / acceptedById | Acceptance | Date/Ref | N | Clinical | Staff witness | System | BR | - | AUD |
| signatureRef | Digital signature reference | Ref | N | Clinical | Signing device | System | BR | - | AUD |
| expiryDate | Expiry | Date | N | Clinical | - | Doctor | BR | - | - |
| withdrawnAt / reason | Withdrawal | Date/Text | N | Clinical | Patient/doctor | Doctor | BR | - | AUD |

## 11.12 Referral

| Field | Meaning | Type | Req | Source of Truth | Validation | Editable By | Scope | Sens | Audit |
|-------|---------|------|-----|-----------------|-----------|-------------|-------|------|-------|
| referralId | ID | Text | Y | Clinical | Auto | System | BR | - | - |
| referralType | internal/external | Enum | Y | Clinical | - | Doctor | BR | - | - |
| fromPractitionerId | Referring doctor | Ref | Y | Staff | Doctor | Doctor | BR | - | AUD |
| toPractitionerId / toSpecialty / toInstitution | Target | Ref/Text | Y | Referral Network | Specialty valid | Doctor | BR | S | AUD |
| reason / clinicalSummary | Clinical content | Text | Y | Clinical | - | Doctor | BR | S | AUD |
| documentRef | Referral letter | Ref | N | Docs | - | Doctor | BR | S | AUD |
| status | draft/sent/received/in-progress/completed/closed | Enum | Y | Clinical | State machine | Doctor/Reception | BR | - | AUD |
| outcome | Result | Text | N | Clinical | - | Doctor | BR | S | - |

## 11.13 Imaging Record

| Field | Meaning | Type | Req | Source of Truth | Validation | Editable By | Scope | Sens | Audit |
|-------|---------|------|-----|-----------------|-----------|-------------|-------|------|-------|
| imagingId | ID | Text | Y | Clinical | Auto | System | BR | - | - |
| imagingType | IOPA/OPG/CBCT/photo/study-model | Enum | Y | Clinical | - | Doctor/Reception | BR | - | - |
| toothIds[] | Linkage | Ref[] | N | Clinical | FDI valid | Doctor | BR | S | - |
| requestPractitionerId | Requester | Ref | Y | Staff | Doctor | Doctor | BR | - | AUD |
| resultSummary / reportText | Findings | Text | N | Clinical | - | Doctor (radiologist future) | BR | S | AUD |
| storageRef | Object storage reference | Ref | Y | Storage svc | Valid | System | BR | - | AUD |
| status | requested/uploaded/reported | Enum | Y | Clinical | Requested-Uploaded-Reported | Doctor | BR | - | AUD |

## 11.14 Tooth and Tooth Treatment

| Field | Meaning | Type | Req | Source of Truth | Validation | Editable By | Scope | Sens | Audit |
|-------|---------|------|-----|-----------------|-----------|-------------|-------|------|-------|
| toothId | patientId+FDI composite | Ref | Y | Clinical | FDI 11-48/51-85 | System | PAT | S | - |
| fdiNumber | Tooth number | Int | Y | Clinical | Range valid | System | PAT | - | - |
| dentition | permanent/primary/mixed | Enum | Y | Clinical | - | Doctor | PAT | - | - |
| status | present/missing/extracted/impacted/erupting | Enum | Y | Clinical | Present-Extracted | Doctor | PAT | S | AUD |
| condition | healthy/caries/restored/rct/crowned/implant/pontic/watch/fractured | Enum | Y | Clinical | Accumulates | Doctor | PAT | S | AUD |
| surfaces[] | M/O/D/B/L or M/D/I/L | Text[] | N | Clinical | Valid set | Doctor | PAT | S | AUD |
| toothTreatmentId | Record | Text | Y | Clinical | Auto | System | SES | S | - |
| treatmentId | What was done | Ref | Y | Treatment Master | - | Doctor | SES | S | AUD |
| beforeState / afterState | Clinical state change | Enum | Y | Clinical | Valid pair | Doctor | SES | S | AUD |

## 11.15 Follow-up / Recall

| Field | Meaning | Type | Req | Source of Truth | Validation | Editable By | Scope | Sens | Audit |
|-------|---------|------|-----|-----------------|-----------|-------------|-------|------|-------|
| followUpId | ID | Text | Y | Clinical | Auto | System | BR | - | - |
| followUpType | post-treatment/recall/review | Enum | Y | Clinical | - | Doctor | BR | - | - |
| intervalDays / dueDate | Timing | Int/Date | Y | Clinical | dueDate = created + interval | Doctor/System | BR | - | - |
| status | pending/due/contacted/booked/completed/closed | Enum | Y | Clinical | State machine | Reception/Doctor | BR | - | AUD |
| communicationTriggered | Reminder sent flag | Bool | N | Comm Hub | External | System | BR | - | AUD |
| appointmentCreatedId | Booked appointment | Ref | N | Appt Mgmt | Exists | System | BR | - | AUD |
| recallId | ID | Text | Y | Clinical | Auto | System | BR | - | - |
| intervalMonths | Recall cycle | Int | Y | Clinical | e.g. 6 | Doctor/Manager | BR | - | - |
| nextDueDate | Next due | Date | Y | Clinical | Auto-calc | System | BR | - | - |

## 11.16 Clinical Outcome

| Field | Meaning | Type | Req | Source of Truth | Validation | Editable By | Scope | Sens | Audit |
|-------|---------|------|-----|-----------------|-----------|-------------|-------|------|-------|
| outcomeId | ID | Text | Y | Clinical | Auto | System | SES | - | - |
| outcome | success/partial/complication/failed | Enum | Y | Clinical | - | Doctor | SES | S | AUD |
| successCriteria[] | How success measured | Text[] | N | Clinical | - | Doctor | SES | - | - |
| complication | Complication text | Text | N | Clinical | Required if outcome=complication | Doctor | SES | S | AUD |
| adverseEvent | Adverse event flag | Bool | N | Clinical | Mandatory report if true | Doctor | SES | S | AUD |
| reviewedById / reviewedAt | Clinical review | Ref/Date | N | Clinical | Doctor | Doctor | SES | - | AUD |
| beforeStateRef / afterStateRef | State refs | Ref | N | Clinical | Tooth/photo refs | Doctor | SES | S | AUD |

## 11.17 Clinical Event (Audit/Timeline)

| Field | Meaning | Type | Req | Source of Truth | Validation | Editable By | Scope | Sens | Audit |
|-------|---------|------|-----|-----------------|-----------|-------------|-------|------|-------|
| eventId | Append-only ID | Text | Y | Clinical | Auto | System | BR | - | - |
| entityType / entityId | What changed | Ref | Y | Clinical | Valid entity | System | BR | - | - |
| action | created/updated/signed/finalized/cancelled/amended/confirmed/withdrawn | Enum | Y | Clinical | Valid per entity | System | BR | - | - |
| actorId / actorRole | Who | Ref/Enum | Y | Auth | Valid session | System | BR | - | - |
| branchId | Where | Ref | Y | Branch | Valid | System | BR | - | - |
| timestamp | When | DateTime | Y | Clinical | Monotonic | System | BR | - | - |
| dataHash | Integrity | Hash | N | Clinical | Computed | System | BR | - | - |
| metadata | Before/after diff JSON | JSON | N | Clinical | - | System | BR | - | - |

---

# 12. RELATIONSHIP MODEL

```
PATIENT (Patient Mgmt - EXTERNAL)
 |-- 1:1 Clinical Profile (D3.3)
 |-- 1:N Allergy (D3.3)
 |-- 1:N Medical History (D3.3)
 |-- 1:N Dental History (D3.3)
 |-- 1:N Tooth (D3.6)  [toothId = patientId + FDI]
 |-- 1:N Clinical Encounter (D3.1)
 |-- 1:N Treatment Plan (D3.7)
 |-- 1:N Treatment Session (D3.8)
 |-- 1:N Clinical Note (D3.9)
 |-- 1:N Consent (D3.11)
 |-- 1:N Referral (D3.12)
 |-- 1:N Imaging Record (D3.10)
 |-- 1:N Follow-up (D3.13)
 |-- 1:N Recall (D3.13)
 |-- 1:N Clinical Event (D3.15)
 |-- 1:N Package Consumption (D3.16)

APPOINTMENT (Appt Mgmt - EXTERNAL; status machine: booked-confirmed-checked-in-waiting-called-in-progress-completed + cancelled/no-show)
 |-- 0..1:1 Clinical Encounter   (appointment IN PROGRESS triggers encounter creation; or at check-in)
 |-- 0..1:1 Treatment Session    (session references appointment; emergency/walk-in has no appointment)
 |-- 1:0..1 Follow-up booking    (follow-up/recall completion creates appointment)

CLINICAL ENCOUNTER (D3.1)
 |-- 1:N Assessment (D3.2)
 |-- 1:N Diagnosis (D3.2, via assessment)
 |-- 1:N Clinical Note (D3.9)
 |-- 1:N Imaging Record (D3.10)
 |-- 1:N Treatment Session (D3.8)
 |-- 1:N Referral (D3.12)
 |-- 0..1 Treatment Plan origin (D3.7)

ASSESSMENT (D3.2)
 |-- 1:N Diagnosis
 |-- N:1 Encounter

DIAGNOSIS (D3.2)
 |-- N:1 Assessment
 |-- 0..1 Tooth (D3.6)
 |-- N:M Treatment Plan (informs; plan links diagnosisIds[])

TOOTH (D3.6)
 |-- 1:N Tooth Condition (accumulates, never overwritten)
 |-- 1:N Tooth Treatment
 |-- 0..N Imaging Record (linkage)
 |-- 0..N Diagnosis / Plan Item / Session (referenced)

TREATMENT (D3.4 - GLOBAL master)
 |-- N:1 Treatment Category (D3.5)
 |-- 1:N Branch Override (per-branch price/availability/config)
 |-- 1:N Treatment Plan Item (referenced, with snapshot)
 |-- 1:N Treatment Session (delivered)
 |-- 0..N Consent (may require)
 |-- 0..N Tooth Treatment (via session)
 |-- 0..N Follow-up (may trigger)
 |-- 0..N Package Item (D3.16)

TREATMENT PLAN (D3.7)
 |-- 1:N Treatment Plan Item
 |-- 1:N Plan Version (superseded versions preserved)
 |-- 1:N Consent (linked for consent-required treatments)
 |-- 0..N Treatment Session (via items)
 |-- N:M Diagnosis

TREATMENT PLAN ITEM
 |-- N:1 Plan
 |-- N:1 Treatment (snapshot)
 |-- 0..N Treatment Session (executions; 1 session per planned visit)
 |-- 0..N Tooth (planned teeth/surfaces)
 |-- 0..N dependencies (item-to-item ordering)

TREATMENT SESSION (D3.8)
 |-- 0..1 Plan Item
 |-- 0..1 Appointment (EXTERNAL)
 |-- 0..1 Encounter
 |-- 1:N Procedure
 |-- 1:N Clinical Note
 |-- 1:0..1 Clinical Outcome
 |-- 0..N Tooth Treatment
 |-- 0..N Follow-up
 |-- 1:N Clinical Event (audit)

PROCEDURE
 |-- N:1 Session

CLINICAL NOTE (D3.9)
 |-- N:1 Patient
 |-- 0..1 Encounter
 |-- 0..1 Session
 |-- 1:0..1 Amendment (self-ref, amendedViaId)
 |-- 0..N Clinical Attachment

CONSENT (D3.11)
 |-- N:1 Patient
 |-- 0..1 Treatment
 |-- 0..1 Treatment Plan
 |-- N:1 Consent Template (versioned)
 |-- 1:N Consent History (status changes)

REFERRAL (D3.12)
 |-- N:1 Patient
 |-- 0..1 Encounter
 |-- 0..1 Document (letter)
 |-- 0..1 Follow-up (outcome follow-up)
 |-- N:1 Referral Network (Phase 6.1 - EXTERNAL patient-level network; this is the clinical event instance)

IMAGING RECORD (D3.10)
 |-- N:1 Patient
 |-- 0..1 Encounter
 |-- 0..N Tooth
 |-- 0..1 Attachment (file ref)
 |-- 1:N Clinical Event

CLINICAL OUTCOME (D3.14)
 |-- 1:1 Session

FOLLOW-UP (D3.13)
 |-- N:1 Patient
 |-- 0..1 Session (origin)
 |-- 0..1 Recall
 |-- 0..1 Appointment (created - EXTERNAL)

RECALL (D3.13)
 |-- N:1 Patient
 |-- 0..1 Appointment (booked)
 |-- 0..1 Follow-up

TREATMENT PACKAGE (D3.16)
 |-- 1:N Package Item --> N:1 Treatment (referenced, NOT cloned)
 |-- 1:N Package Consumption --> N:1 Patient
 |-- 1:0..1 Purchase/Invoice (EXTERNAL to Finance)

CLINICAL EVENT (D3.15)
 |-- N:1 of every domain entity (event source: entityType+entityId)

CROSS-DOMAIN EXTERNAL REFERENCES (read-only projections):
 |-- Patient identity --> Patient Mgmt
 |-- Appointment --> Appt Mgmt
 |-- Invoice/Payment --> Finance (Domain 3 never writes)
 |-- Insurance/Panel claim --> Insurance/Finance (Domain 3 provides clinical docs only)
 |-- Communication send --> Comm Hub (Domain 3 emits triggers only)
 |-- Purchase of package --> Finance (Domain 3 records consumption only)
```

---

# 13. TREATMENT MASTER / TREATMENT CATALOG

> **Existing Medini Capability:** The 69-treatment catalog already exists in Appointment v2 (48 built-in + 21 Medini custom) with 16 fields. This section EXTENDS it into the full Domain 3 Treatment Master. No existing field is removed.

## 13.1 Treatment Entity — Full Field Specification

| Field | Meaning | Type | Req | Ownership | Notes |
|-------|---------|------|-----|-----------|-------|
| treatmentId | Unique ID | Text (T001-T069+) | Y | System | Stable; referenced everywhere |
| code | Short code | Text | Y | HQ | Unique; e.g. SCL-01, RCT-M |
| name | Display name | Text | Y | HQ | e.g. "SCALING AND POLISHING" |
| category | Classification | Ref (D3.5) | Y | HQ | 11 categories |
| subcategory | Optional finer grouping | Ref | N | HQ | e.g. Category=Endodontic, Sub=RCT |
| clinicalDescription | What the treatment is | Text | N | HQ | Used in consent + patient info |
| treatmentType | single-visit / multi-visit / package-only / diagnostic | Enum | Y | HQ | Drives session planning |
| source | builtin / medini-custom / branch-custom | Enum | Y | HQ/Manager | Provenance |
| standardDuration | Minutes | Int | N | HQ/Manager | Used for booking estimate |
| price | Default price | Money | N | Finance ref | Branch overridable |
| price2 | Alternate price | Money | N | Finance ref | e.g. member price |
| panelPrice | Panel rate | Money | N | Finance ref | Insurance/panel |
| cost | Clinic cost | Money | N | Finance ref | Internal |
| taxPercent | SST % | Decimal | N | Finance ref | 0-100 |
| eInvoiceClassification | e-Invoice class | Text | N | Finance ref | e.g. service category code |
| dentalChartSymbol | Chart glyph | Text | N | HQ | Renders on tooth chart |
| xrayRequired | X-ray needed | Bool | Y | HQ | Workflow trigger |
| specialistRequired | Specialist only | Bool | Y | HQ | RBAC enforcement |
| consentRequired | Consent needed | Bool | Y | HQ | Blocks finalize without valid consent |
| followUpRequired | Follow-up needed | Bool | Y | HQ | Auto-creates follow-up on completion |
| defaultRecallIntervalMonths | Recall cycle | Int | N | HQ | e.g. 6 for scaling |
| packageEligible | Can be in package | Bool | Y | HQ | |
| insuranceEligible | Claimable | Bool | Y | HQ | |
| keyboardShortcut | POS shortcut | Text | N | HQ | Dr Partner legacy, kept |
| active | Active/inactive | Bool | Y | HQ/Manager | Inactive = no new booking |
| effectiveDate | When version takes effect | Date | Y | HQ | |
| version | Definition version | Int | Y | System | Increments on change |
| dependencies | Must precede/follow | Ref[] | N | HQ | e.g. Implant Crown depends on Implant |
| contraindications | Clinical contraindications | Text[] | N | HQ | Cross-checked vs patient profile |
| addOns | Optional add-on treatments | Ref[] | N | HQ | e.g. Local Anesthesia |
| packageCompatibility | Package rules | Ref | N | HQ | Which packages may include it |

## 13.2 System vs Branch-Custom Treatments (Inheritance & Override)

### Inheritance Model

```
GLOBAL TREATMENT (system or HQ-defined)
   |-- BRANCH OVERRIDE (branchId, effectiveDate)
         |-- price / price2 / panelPrice / cost
         |-- active (branch-level enable/disable)
         |-- standardDuration
         |-- availability (which chairs/rooms)
         |-- local name alias (optional)
```

### Rules

1. **One global definition per code.** A branch can NEVER create a duplicate code; it creates an override.
2. **Override whitelist only.** Branch may override: price, price2, panelPrice, cost, active, standardDuration, availability, local alias. It CANNOT override: code, name, category, clinicalDescription, contraindications, specialistRequired, insuranceEligible, packageEligible, eInvoiceClassification.
3. **Default inheritance.** If no override exists, the branch inherits the global value.
4. **Global deactivation cascades.** If a global treatment is deactivated, all branch overrides are ignored for NEW bookings. Historical records remain readable.
5. **Override audit.** Every override create/edit is audited (who, branch, field, before, after).
6. **Branch-custom treatments** (21 existing Medini customs) become global-level treatments with `source=medini-custom` so they are consistent across the group; a branch can additionally mark them inactive locally if not offered there.
7. **No per-branch duplication of the entity.** "14 branches x 69 treatments" is never materialized as 966 rows of definitions. Only overrides (sparse) are stored.

## 13.3 Versioning

- Any change to clinical-affecting fields (name, category, contraindications, specialistRequired, consentRequired, dentalChartSymbol) increments `version` and creates a new effective version with `effectiveDate`.
- Pricing/availability changes do NOT create clinical versions; they are branch override values with their own audit.
- **Historical preservation:** Treatment Session and Treatment Plan Item store a `treatmentSnapshot` (JSON copy of the definition at execution/plan time). Historical data therefore remains fully readable even when the master changes.

## 13.4 Treatment Lifecycle

```
Draft --> Active --> Inactive --> Retired
            |          |
            |          +--> (re-activated -> Active)
            +-- (edit -> new version, stays Active)
```

| Transition | Trigger | Actor | Guard |
|-----------|---------|-------|-------|
| Draft->Active | Publish | HQ | Clinical fields complete |
| Active->Inactive | Deactivate | HQ/Manager | No active plans referencing in required state (soft block with override) |
| Inactive->Active | Re-activate | HQ/Manager | Audit |
| Active/Inactive->Retired | Retire | HQ | No new bookings ever; historical only |

**Business rule:** Inactive treatment cannot be newly booked, planned, or added to a package. Historical sessions/plans referencing it remain fully readable (snapshot).

## 13.5 Mapping Existing 69-Treatment Catalog

| Source | Count | How It Maps |
|--------|-------|-------------|
| Built-in (Dr Partner system default) | 48 | Become global treatments, `source=builtin`, category per existing mapping (Consultation/Preventive/Restorative/Endodontic/Prosthodontic/Orthodontic/Oral Surgery/Periodontic/Cosmetic/Diagnostic/Emergency) |
| Medini custom | 21 | Become global treatments, `source=medini-custom`, deduplicated where same concept exists (e.g. "CONSULTATION" builtin vs custom "CONSULTATION" -> single global treatment with alias list) |

**Deduplication rule:** Where a built-in and a Medini custom treatment are semantically identical (same name/category), keep ONE global treatment (builtin wins as canonical), record the custom name as `alias[]`. The appointment dropdown continues to search aliases so nothing breaks.

---

# 14. DENTAL CLINICAL MODEL (TOOTH-LEVEL)

> **Not observed in the Dr Partner study.** The study explicitly recorded: "Tooth chart — Not observed" (Section 9.2). This is therefore a **Medini architectural recommendation**.

## 14.1 Numbering Standard — FDI (ISO 3950)

**Decision: FDI two-digit notation** for permanent (11-48) and primary (51-85) dentition.

| Why FDI | Why NOT Universal (US) |
|---------|------------------------|
| ISO 3950 international standard | US-centric; rarely used in Malaysia |
| Standard in Malaysian dental education + MOH documentation | Confusion with primary dentition letters |
| Two-digit avoids quadrant ambiguity | Lettering (A-T) is unfamiliar locally |
| Native support for primary + permanent + mixed dentition | Mixing primary/permanent is awkward |

- Permanent: quadrants 1-4, teeth 1-8 per quadrant (11-18, 21-28, 31-38, 41-48).
- Primary: quadrants 5-8, teeth 1-5 per quadrant (51-55, 61-65, 71-75, 81-85).
- Mixed dentition: both sets coexist for the same patient; each tooth record carries its own dentition flag.

## 14.2 Tooth Entity

| Field | Meaning | Values |
|-------|---------|--------|
| fdiNumber | Tooth identifier | 11-48, 51-85 |
| dentition | Set | permanent / primary / mixed |
| status | Presence | present / missing / extracted / impacted / erupting / not-erupted |
| condition | Current main condition | healthy / caries / restored / rct / crowned / implant / bridge-pontic / watch / fractured |
| conditionSurfaces[] | Affected surfaces | M/O/D/B/L (posterior), M/D/I/L (anterior) |
| notes | Clinical note per tooth | Text |
| attachments[] | Per-tooth refs | Photo/imaging refs |

**Surfaces:**
- Posterior (molars/premolars): Mesial (M), Occlusal (O), Distal (D), Buccal (B), Lingual (L)
- Anterior (incisors/canines): Mesial (M), Distal (D), Incisal (I), Labial (Lb), Lingual (L)

## 14.3 Tooth-Level Diagnosis & Treatment

| Concept | Model |
|---------|-------|
| Diagnosis per tooth | Diagnosis entity with toothId; e.g. "Dental caries 26 O" |
| Planned treatment per tooth | Plan Item with toothIds[] + surfaces[]; e.g. "Composite filling 26 O" |
| Completed treatment per tooth | Tooth Treatment record tied to Session: treatmentId + toothId + surfaces[] + beforeState/afterState |
| Tooth treatment history | All Tooth Treatment records per tooth, chronological |
| Missing/extracted teeth | Tooth status change Present->Extracted with session link + date; never silently deleted |
| Existing restoration | Tooth condition=restored + surfaces; history preserved |
| Before/after state | beforeState/afterState on Tooth Treatment (e.g. caries -> restored) |

## 14.4 Dental Chart UI Concept (Prototype)

- Visual chart: two arches (upper/lower), FDI positions; primary teeth render smaller/separate layer for children.
- Click tooth -> detail panel: current condition, surfaces, condition history, imaging refs, planned treatments, completed treatments.
- Dental chart symbol from Treatment Master maps to chart rendering glyphs (e.g. X=extraction, black shading=caries, crown outline=crown).
- Colors/patterns are derived from Tooth Condition + Treatment history (never hand-drawn free text).
- Tooth-level data is optional: treatments flagged `dentalChartRequired=true` force tooth selection before finalize.

## 14.5 Tooth-Level Rules

1. Tooth selection is REQUIRED for treatments with `dentalChartRequired=true` (fillings, RCT, extraction, crown).
2. Whole-mouth treatments (scaling/polishing, whitening, fluoride, OPG, CBCT) do NOT require tooth selection.
3. A tooth cannot be treated if its `status=missing/extracted` (hard block) unless the treatment is an implant/space-maintainer case explicitly allowed.
4. Tooth condition changes are additive: recording "restored" does not erase prior "caries" history.
5. Extraction is irreversible: requires doctor confirmation + consent if consentRequired; recorded with before/after state.
6. Mixed dentition: chart shows both; child patients default to primary+mixed view.

---

# 15. CLINICAL ENCOUNTER MANAGEMENT

> **Not observed as a distinct concept in the Dr Partner study** (appointment conflated with the clinical event). **Medini architectural recommendation.**

## 15.1 Definition

A Clinical Encounter is the **clinical container** for one patient visit: the WHY (chief complaint), the WHO (practitioner), the WHAT (assessments, notes, imaging, sessions started), and the WHEN (date/time/branch). It is the anchor that Patient 360 clinical timeline groups by.

## 15.2 Encounter vs Appointment vs Session (No Duplication)

| Concept | Owns | Example |
|---------|------|---------|
| Appointment (Appt Mgmt) | SCHEDULING: when booked, status lifecycle, chair/doctor/conflict | "10:00 booking, Dr Aina, Chair 1, Scaling" |
| Clinical Encounter (D3.1) | CLINICAL VISIT: what happened clinically | "Encounter #12: complaint pain 26, exam, diagnosis caries, plan started" |
| Treatment Session (D3.8) | EXECUTION: one treatment delivery | "Session #7: Composite filling 26 O completed" |

- 1 Appointment may produce 0..1 Encounter (no-show/cancel -> no encounter; completed -> 1 encounter).
- 1 Encounter may contain 0..N Treatment Sessions (e.g. consult + extraction + suture in one visit).
- Emergency/walk-in: Encounter created WITHOUT appointment. Session can also exist without appointment.
- Appointment "IN PROGRESS" status or reception "Start Encounter" action creates the encounter; auto-link by patient+branch+date.

## 15.3 Encounter Fields

Per Data Dictionary 11.1. Key additions:
- `chiefComplaint` — required, short (patient words).
- `visitContext` — optional context (routine review / follow-up / emergency / second opinion).
- `clinicalSummary` — auto-generated post-finalize (AI assist draft, doctor approves).

## 15.4 Encounter Lifecycle

```
Draft --> Open --> Completed --> Finalized
             ^                       |
             +---- (reopen guard) ---+
```

| From | To | Trigger | Actor | Guard |
|------|----|---------|-------|-------|
| Draft | Open | Start consultation | Doctor/Reception | Encounter created |
| Open | Completed | End consultation; assessment complete | Doctor | Assessment + chief complaint recorded |
| Completed | Finalized | Finalize encounter | Doctor | All required docs signed; consent satisfied; open sessions closed |
| Completed/Finalized | Open | Reopen | Doctor | With reason + audit (clinical correction) |

**Finalization rules:**
- Finalized encounter = locked. No new assessments/notes/sessions attach (except amendments).
- Before finalize, system checks: unresolved P0 safety data, missing required consent, unsigned clinical notes (warn only, configurable per branch), active open sessions.
- Finalize writes: finalizedAt, finalizedById, clinicalSummary.

## 15.5 Encounter Timeline

Every encounter generates Clinical Events on: creation, status change, assessment added, diagnosis confirmed, note signed, session started/completed, imaging uploaded, referral created, consent accepted. These feed the unified Clinical Timeline (D3.15) and Patient 360.

---

# 16. CLINICAL ASSESSMENT (SOAP-ADAPTED)

> **Observed Evidence:** Dr Partner has full SOAP option setup (Subjective/Complain, Objective/Reason, Diagnosis/Assessment, Treatment Plan) with configurable option lists.
> **Existing Medini Capability:** None (clinical documentation not yet built).
> **Medini Architectural Recommendation:** Keep SOAP as a *conceptual framework*, not a heavy configuration system. Guided, template-driven documentation.

## 16.1 Medini Simplified Model

```
S - SUBJECTIVE   : Chief complaint + history (patient words, guided templates)
O - OBJECTIVE    : Clinical findings, exam, observations (guided templates)
A - ASSESSMENT   : Interpretation -> Diagnosis(es) (structured)
P - PLAN         : Link to Treatment Plan (not free text duplication)
```

| Design Decision | Dr Partner (observed) | Medini (recommended) |
|-----------------|----------------------|----------------------|
| SOAP setup | Full admin config of option lists per clinic | Fixed simple structure + template library per specialty; no admin config burden |
| Subjective | Option-list driven | Template quick-picks + free text; chief complaint captured at encounter level |
| Objective | Option-list driven | Template quick-picks + free text + tooth-linked findings |
| Assessment | Diagnosis list | Structured Diagnosis entity (code optional, tooth-linkable, severity, status) |
| Plan | Text | Structured link to Treatment Plan entity |
| Entry speed | Slow (many dropdowns) | Fast (chairside: quick picks, autocomplete, dictation-ready) |

## 16.2 Assessment Entity

- Attached to Encounter (1:N).
- `subjective`, `objective`, `assessmentText` captured via template chips + free text.
- `templateId` records which clinical template guided the note (auditable).
- `status`: draft -> complete (locks fields; later edits -> amendment).

## 16.3 Diagnosis Entity

| Field | Notes |
|-------|-------|
| code | Optional ICD-10 / ICD-DA code (future coding layer; not required for v1.0) |
| description | Required free text (e.g. "Dental caries 26 O") |
| toothId | Optional tooth linkage |
| severity | mild/moderate/severe |
| status | provisional -> confirmed -> resolved |
| isDifferential | Flag for differential diagnosis list |
| confirmedById/At | Doctor confirms |

- A diagnosis may be linked to MULTIPLE teeth (via separate Diagnosis records per tooth or a diagnosis covering a tooth set) — v1.0: one record per tooth for charting accuracy; whole-mouth conditions (gingivitis) have no toothId.
- Diagnosis history per patient is queryable at any time (Diagnosis History tab in Patient 360).

## 16.4 Assessment History

- All Assessments and Diagnoses are immutable history once the encounter is finalized (amendment workflow only).
- Patient 360 shows: chronological list, filterable by tooth, category, practitioner, branch, date range.

## 16.5 Safety Checkpoint

- Assessment entry surfaces the patient's active allergies + conditions banner (P0) — doctor must acknowledge (single tap "Acknowledged") before finalizing the assessment. Acknowledgment is audited.

---

# 17. CLINICAL SAFETY & PATIENT CLINICAL PROFILE

> **Observed Evidence:** Dr Partner has Allergies and Medical History fields in patient registration.
> **Existing Medini Capability:** None.
> **Medini Architectural Recommendation:** Elevate from plain fields to structured, governed clinical safety records with confirmation workflow, prominence rules, and hard-stop enforcement.

## 17.1 Allergy Management

| Aspect | Specification |
|--------|---------------|
| Record | allergen, allergyType (drug/material/food/other), severity (mild/moderate/severe), reaction, status |
| Status flow | unconfirmed -> confirmed (doctor confirms) ; any -> inactive (never deleted) |
| Who records | Reception can RECORD (unconfirmed); Doctor confirms; Doctor/HQ edits; all audited |
| Display | Red banner in Patient 360 header + every encounter + every session screen |
| Unconfirmed | Still displayed prominently (amber "unconfirmed" badge) — never hidden |

**Critical rule:** An unconfirmed allergy is shown with warning styling; a CONFIRMED SEVERE allergy is a hard safety flag. No treatment touching the allergen class may be finalized without doctor override + reason (audited).

## 17.2 Medical History

| Aspect | Specification |
|--------|---------------|
| Record | condition, category (cardiac/diabetic/bleeding/respiratory/pregnancy/neurological/other), status (active/resolved), details |
| Who records | Reception (record) / Doctor (confirm + edit) |
| Categories map to risk | e.g. bleeding disorder -> extraction/periodontal risk; pregnancy -> avoid certain procedures/meds |
| Display | Amber/red flags in safety banner per condition severity |

## 17.3 Dental History

- Manual narrative (previousTreatmentsSummary) + DERIVED state from Tooth model (missing teeth, existing restorations, RCT history).
- Derived fields auto-recompute from Tooth/Treatment records; manual narrative preserved separately.
- Displayed in Patient 360 Dental History tab.

## 17.4 Warnings & Contraindications Engine

| Trigger | Where Checked | Result |
|---------|---------------|--------|
| Treatment contraindications vs patient allergies/conditions | Booking (Appointment) AND Session start | Warning or hard block |
| xrayRequired vs patient pregnancy flag | Booking + imaging request | Hard block unless doctor override |
| specialistRequired vs practitioner | Booking + session | Hard block: non-specialist cannot start |
| consentRequired vs consent status | Session finalize | Hard block until valid consent |
| Severe allergy vs allergen-class treatment | Session finalize | Hard block + override-with-reason |

**Implementation:** A safety-check service runs at 3 checkpoints (booking, session start, session finalize). Returns structured alerts: WARN (proceed with acknowledge) or BLOCK (cannot proceed; doctor override with reason + audit allowed only for BLOCK types).

## 17.5 Prominence Rules (UI)

1. Allergies + severe conditions = RED banner, always visible in: Patient 360 header, encounter screen, session screen, appointment detail.
2. Unconfirmed allergies = AMBER banner with "unconfirmed" badge.
3. Acknowledge control on every clinical screen before finalize ("I acknowledge the safety banner").
4. No way to collapse/hide the banner (admin-enforced).

## 17.6 RBAC & Audit (P0 data)

| Action | Reception | Doctor | Manager | HQ |
|--------|-----------|--------|---------|-----|
| Record allergy/condition (unconfirmed) | YES | YES | YES | YES |
| Confirm allergy/condition | NO | YES | NO | YES (clinical admin) |
| Edit | NO | YES | NO | YES |
| View | YES (banner) | YES | YES | YES |
| Delete | NEVER (inactive only) | NEVER | NEVER | NEVER (inactive only) |

Every create/edit/confirm/inactivation of allergy or medical history is an audited Clinical Event (who, what, when, before, after, branch, reason).

---

# 18. TREATMENT PLANNING

> **Observed Evidence:** Dr Partner has Treatment Plan within SOAP setup and follow-up tracking.
> **Existing Medini Capability:** None (only treatment dropdown in appointments).
> **Medini Architectural Recommendation:** Full versioned plan entity supporting single-visit and multi-visit clinical pathways.

## 18.1 Treatment Plan Entity

| Field | Notes |
|-------|-------|
| planId | PLN-xxxx |
| patientId, branchId, practitionerId | Ownership |
| originEncounterId | Where plan was born |
| diagnosisIds[] | Linked diagnoses |
| version | Auto-increment; superseded versions preserved read-only |
| status | draft/proposed/accepted/active/completed/cancelled/superseded |
| items[] | Plan Items (ordered) |
| estimatedSessions, estimatedDurationDays | Planning estimates |
| priority | low/normal/high/urgent |
| presentedAt, acceptedAt, acceptedById, declinedReason | Acceptance workflow |

## 18.2 Treatment Plan Item

| Field | Notes |
|-------|-------|
| sequence | Order of execution |
| treatmentId + treatmentSnapshot | Reference + frozen definition copy |
| toothIds[] + surfaces[] | Optional tooth/surface scope |
| plannedSessions | How many sessions this item needs |
| dependencies[] | Item must complete before another begins (no cycles) |
| priority | Within-plan priority |
| status | planned / in-progress / completed / cancelled |

## 18.3 Lifecycle State Machine

```
Draft --> Proposed --> Accepted --> Active --> Completed
             |            |            |
             |            |            +--> Cancelled
             |            +---> Superseded (on revision)
             +-----> Cancelled (never proposed)
             +-----> Superseded (revision of draft/proposed)
```

| From | To | Trigger | Actor | Guard |
|------|----|---------|-------|-------|
| Draft | Proposed | Present to patient | Doctor | Items non-empty |
| Proposed | Accepted | Patient accepts | Doctor (witnessed) | Acceptance recorded; consent for consent-required items |
| Proposed | Declined/Cancelled | Patient declines | Doctor | declinedReason recorded; plan kept for history |
| Accepted | Active | First session starts | System | Appointment/session scheduled |
| Active | Completed | All items completed/cancelled | System | Auto-computed |
| Active | Cancelled | Plan stopped | Doctor | Reason required |
| Any (non-completed) | Superseded | Revision | Doctor | New version created; old preserved read-only |
| Superseded | (none) | Terminal | - | Read-only history |

## 18.4 Patient Acceptance

- Presented -> Accepted (verbal, witnessed by doctor, recorded with timestamp) OR via Consent if consentRequired treatment.
- Declined plans remain visible in history (never deleted) with declinedReason.
- Acceptance is audited (who witnessed, when, what version).

## 18.5 Revision Workflow

1. Doctor edits an Accepted/Active plan -> system creates NEW VERSION (version+1), status=superseded on old.
2. Old version: read-only, linked sessions remain attached.
3. Diff view: doctor sees what changed between versions before confirming.
4. Only the latest version can be Active/Accepted; sessions always reference the plan ITEM, which snapshots its version.

## 18.6 Single-Visit vs Multi-Visit

**Single-visit (e.g. Scaling):** Plan with 1 item, 1 session. Plan may be created implicitly from the appointment treatment and auto-completed on session finalize.

**Multi-visit (e.g. RCT molar):**
```
Consultation --> Diagnosis --> Plan v1 (Proposed)
  -> Accepted
  -> Session 1: Access opening + pulpectomy (item 1, session 1/3)
  -> Session 2: Instrumentation + medication (item 1, session 2/3)
  -> Session 3: Obturation (item 1, session 3/3 -> item completed)
  -> Item 2: Crown (after obturation; dependency)
  -> Plan Completed
  -> Follow-up created
```

**Orthodontic example:** Plan items = separators, bonding, monthly adjustments (N sessions), debond, retainer. Adjustments are same-item repeated sessions with progress notes.

## 18.7 Linkage Rules

- Session references planItemId (optional for walk-in single treatment).
- Plan completion auto-computed: all items completed or cancelled.
- Item completion auto-computed: all planned sessions completed.
- Cannot complete a session whose item has unsatisfied dependencies.
- A plan cannot be finalized (locked) while items are in-progress without reason.
- Historical plan data remains readable even if treatment master changes (snapshot).

---

# 19. TREATMENT / PROCEDURE EXECUTION

> **Observed Evidence:** Dr Partner records treatment notes and procedure recording.
> **Existing Medini Capability:** Appointment status lifecycle (booked → completed); no clinical execution layer.
> **Medini Architectural Recommendation:** Full Treatment Session + Procedure model with clear separation from Appointment/Encounter/Plan.

## 19.1 Concept Separation (No Duplication)

| Concept | Owns | Created By |
|---------|------|-----------|
| Appointment | Scheduling + status lifecycle + chair/doctor/conflict | Appointment Mgmt |
| Clinical Encounter | Clinical visit container (WHY/WHO/WHEN) | D3.1 |
| Treatment Plan | Intention: what SHOULD happen, in what order | D3.7 |
| Treatment Session | Execution: what IS being done NOW | D3.8 |
| Procedure | Granular step inside a session | D3.8 |

- A Session MAY come from a Plan Item, from an Appointment, or standalone (walk-in/emergency).
- A Session MUST belong to one Encounter (auto-created if missing).
- An Appointment may map to 0..N Sessions (e.g. consult session + extraction session).

## 19.2 Treatment Session

| Field | Notes |
|-------|-------|
| sessionId | SES-xxxx |
| planItemId | Optional; plan-driven sessions carry it |
| appointmentId | Optional; appointment-linked |
| encounterId | Required (auto-create encounter if absent) |
| treatmentId | The treatment being executed (may be historical snapshot via plan item) |
| toothIds[] + surfaces[] | Optional dental scope |
| practitionerId / assistantId | Team |
| startTime / endTime | Real execution window |
| status | scheduled → checked-in → in-progress → completed → finalized / cancelled |
| notes | Session notes |
| outcomeId | Linked outcome |

## 19.3 Session Lifecycle

```
Scheduled --> Checked-in --> In Progress --> Completed --> Finalized
   |              |              |              |
   +----> Cancelled <------------+--------------+
```

| From | To | Trigger | Actor | Guard |
|------|----|---------|-------|-------|
| Scheduled | Checked-in | Patient in chair | Doctor/Reception | Safety banner acknowledged |
| Checked-in | In Progress | Start procedure | Doctor | specialistRequired satisfied; consent valid (if required) |
| In Progress | Completed | All procedures done | Doctor | Required notes drafted |
| Completed | Finalized | Finalize session | Doctor | Outcome recorded; notes signed; consent satisfied |
| Any | Cancelled | Stop/cancel | Doctor | Reason required; audit |

**Finalization guards:** safety checkpoints pass (17.4), required consent valid, outcome recorded, notes signed. Finalize locks the session (amendments only afterwards).

## 19.4 Procedure

| Field | Notes |
|-------|-------|
| procedureId | Auto |
| sessionId | Parent |
| procedureName | e.g. "Crown preparation", "Impression", "Cementation" |
| sequence | Order |
| startTime / endTime | Step window |
| materialsUsed[] | Material references (future Inventory ref, not stock control) |
| equipmentRef | Optional equipment reference |
| practitionerId / assistantId | Step team |
| status | pending → in-progress → completed / skipped |
| notes | Step notes |

- Procedure templates per treatment type (e.g. RCT: access → instrumentation → obturation) are DEFAULT step lists a doctor can edit per session — not hardcoded workflows.
- Materials/equipment references are informational in v1.0 (no stock decrement; Inventory is a future domain).

## 19.5 Clinical Outcome Capture (at Completion)

- Doctor records outcome per session: success / partial / complication / failed.
- Complication requires free text; adverse event sets mandatory report flag.
- Outcome feeds D3.14 and analytics.

## 19.6 Post-Treatment Instructions

- Templates per treatment category (e.g. extraction aftercare, RCT aftercare).
- Doctor selects + edits; instructions saved as part of session record AND trigger Communication Hub send (patient copy) — Domain 3 emits the trigger; Communication Hub sends.

## 19.7 Tooth Linkage

- If treatment has dentalChartRequired or toothIds provided, session updates Tooth records (Tooth Treatment rows with beforeState/afterState) on completion.
- Extraction: tooth status present → extracted (with confirmation).

---

# 20. CLINICAL DOCUMENTATION

> **Observed Evidence:** Dr Partner has treatment notes; clinical attachments not observed; X-ray integration not observed.
> **Existing Medini Capability:** None.
> **Medini Architectural Recommendation:** Immutable signed notes + amendment workflow + attachment references.

## 20.1 Note Types

| Type | Purpose | Attached To |
|------|---------|-------------|
| Consultation Note | Initial/follow-up consultation | Encounter |
| Treatment Note | What was done in a session | Session |
| Procedure Note | Step-level detail | Procedure (within session) |
| Progress Note | Multi-visit progress (ortho/endo) | Session / Plan |
| SOAP Note | Full S/O/A (P = plan link) | Encounter |

## 20.2 Note Lifecycle & Immutability

```
Draft --> Signed --> Amended
              ^          |
              +----------+ (amendment creates new linked note; original UNCHANGED)
```

| Rule | Detail |
|------|--------|
| Draft | Editable by author only; not visible to other clinicians until signed (or visible read-only with draft badge — branch configurable) |
| Signed | Locked. contentHash computed; author + signedAt fixed; visible to all authorized roles |
| Amend | New note linked via amendedViaId; original retained byte-for-byte; amendment shows reason + who + when; diff view between versions |
| Delete | NOT possible for signed notes. Draft notes may be deleted by author (audited) |
| Edit after sign | NOT possible. Only amendment |

## 20.3 Author & Attribution

- authorId is fixed at creation; cannot be reassigned.
- Co-signing (future): supervisor countersign for junior dentists — noted as future capability (Medini recommendation, deferred).
- AI draft assistance: AI may DRAFT (input = assessment/diagnosis/session data); doctor must edit + sign; AI-generated content explicitly tagged "AI-assisted draft" in note metadata (audit + safety).

## 20.4 Attachments

| Field | Notes |
|-------|-------|
| attachmentId | Auto |
| fileName / fileType / mimeType / sizeBytes | Metadata |
| storageRef | Object storage reference (secure bucket, access-controlled) — NOT embedded in DB in v1.0 |
| category | consent / xray / photo / referral-letter / lab-slip / other |
| linkedTo | noteId / imagingId / consentId / referralId |
| uploadedById / uploadedAt | Audit |

- Attachments are REFERENCES to object storage (future: S3/MinIO). v1.0 prototype: data-URL or local file reference in Single HTML artifact.
- Clinical attachments are sensitive: access audited (view + download events).
- No PACS/DICOM engine in v1.0. **Separate current architecture (file reference) from future integration (DICOM/PACS viewer).**

## 20.5 Documentation Completion (Analytics + AI)

- Documentation completeness score per encounter/session: required note types signed vs missing.
- AI (future) detects missing documentation and suggests prompts — assistive only.

---

# 21. DIAGNOSTIC & IMAGING

> **Observed Evidence:** Dr Partner supports X-ray as a document type (IOPA/OPG/CBCT observed in treatment catalog); no PACS/DICOM integration observed.
> **Existing Medini Capability:** None.
> **Medini Architectural Recommendation:** Imaging Record = metadata + reference; files in secure object storage; NO DICOM/PACS engine in v1.0.

## 21.1 Imaging Types

| Type | Code | Notes |
|------|------|-------|
| Periapical | IOPA (PA) | Tooth-level |
| Panoramic | OPG | Whole mouth |
| Cone Beam CT | CBCT | 3D (specialist/lab) |
| Cephalometric | LA CEPH | Ortho |
| Clinical Photo | PHOTO | Intra-oral / extra-oral |
| Study Model | STO | Model reference |

## 21.2 Imaging Record

| Field | Notes |
|-------|-------|
| imagingId | Auto |
| patientId / encounterId | Context |
| imagingType | Enum above |
| toothIds[] | Linkage (IOPA → specific teeth) |
| requestPractitionerId | Who requested |
| imagingDate | When taken |
| resultSummary | Short findings |
| reportText | Full report (future: radiologist) |
| storageRef | Object storage reference |
| status | requested → uploaded → reported |

## 21.3 Workflow

```
Request (doctor, from encounter or treatment xrayRequired trigger)
  --> Upload (reception/radiographer; file → object storage)
  --> Report (doctor; findings + tooth linkage)
  --> View (encounter, session, tooth chart, Patient 360)
```

- xrayRequired treatments auto-flag "imaging needed" on booking + session start (safety checkpoint WARN/BLOCK per config).
- Pregnancy flag (medical history) blocks CBCT unless doctor override with reason.

## 21.4 Current vs Future

| Layer | v1.0 (Current) | Future |
|-------|----------------|--------|
| Storage | Object storage reference (S3/MinIO or local demo file ref) | Same + DICOM store |
| Viewing | Image embed/preview in Single HTML prototype | DICOM viewer, measurements, side-by-side |
| AI | Not in scope | AI image triage/flagging (assistive, human-reviewed) |
| Integration | Manual upload/reference | PACS/radiology integration |

---

# 22. CLINICAL CONSENT

> **Observed Evidence:** Dr Partner has custom forms including consent, MC, time off, PDPA (Section 2.1/10.1).
> **Existing Medini Capability:** None.
> **Medini Architectural Recommendation:** Versioned consent templates + acceptance lifecycle + digital signature reference + expiry/withdrawal.

## 22.1 Consent Types

| Type | Covers | Default Required |
|------|--------|------------------|
| Treatment consent | Specific treatment(s) | Yes if treatment.consentRequired |
| Procedure consent | Specific procedure | Yes for invasive procedures (extraction, surgery, implant) |
| Imaging consent | X-ray/photo | Yes for CBCT; optional others |
| PDPA consent | Data processing | Yes at registration (may be owned jointly with Patient Mgmt — PDPA record lives in Patient; clinical consent lives in Domain 3) |

**Boundary rule:** PDPA consent record = Patient Management/Compliance ownership. Treatment/procedure/imaging consent = Domain 3 (D3.11). No duplication: Domain 3 references the PDPA record when validating.

## 22.2 Consent Template & Version

| Field | Notes |
|-------|-------|
| templateId | Which form |
| version | Template version (content changes → new version) |
| contentRef | Form content (HTML/text ref) |
| active | Only active versions can be used for new requests |
| effectiveFrom | Version effective date |

- Patient always signs the CURRENT active version at time of consent.
- Historical consents keep their template version snapshot (readable forever).

## 22.3 Consent Lifecycle

```
Pending --> Accepted --> Expired / Withdrawn
```

| From | To | Trigger | Actor | Guard |
|------|----|---------|-------|-------|
| Pending | Accepted | Patient accepts + signature | Doctor/Reception (witness) | Signature captured or confirmed verbal (recorded) |
| Accepted | Expired | expiryDate passed | System | Auto |
| Accepted | Withdrawn | Patient withdraws | Doctor | withdrawnReason required; triggers workflow stop for planned work |

## 22.4 Consent ↔ Treatment Linkage

- Treatment master flag consentRequired → consent request auto-created when plan item/session scheduled.
- Session finalize BLOCKED until valid (non-expired, non-withdrawn) consent for the treatment exists.
- Consent can cover a whole PLAN (plan-level consent) or a single treatment (item-level).
- Withdrawn consent → in-progress sessions warned; planned sessions blocked; doctor decision recorded.

## 22.5 Digital Signature

- v1.0 prototype: signature capture (canvas/stylus) or verbal-witnessed checkbox with timestamp.
- Production: signature reference stored with consent record (device, timestamp, hash); full e-signature vendor integration = future.

## 22.6 Audit

- Every consent state change audited (who, when, before, after, reason).
- Template version changes audited.
- Access to consent records audited.

---

# 23. CLINICAL REFERRAL

> **Observed Evidence:** Dr Partner has referral letter documents and Referral setup (clinic + doctor).
> **Existing Medini Capability:** Patient 360 Referral Network (Phase 6.1) — patient-level referral relationships.
> **Medini Architectural Recommendation:** Clinical Referral entity (event-level) layered ON the existing network — no duplicate network.

## 23.1 Relationship to Referral Network

| Layer | Owns | Example |
|-------|------|---------|
| Referral Network (Phase 6.1, Patient Mgmt) | WHO refers the patient to WHOM (persistent relationship) | "Aina refers to specialist Dr. Lim (oral surgery)" |
| Clinical Referral (D3.12) | A SPECIFIC clinical referral event | "Referral #7: Aina → Dr. Lim, reason: impacted 38, letter sent 2026-08-09" |

- Creating a Clinical Referral AUTO-creates/links the network relationship (if not existing).
- The network is the master of referrer/referral-party identity; D3.12 references it.

## 23.2 Referral Entity

| Field | Notes |
|-------|-------|
| referralId | Auto |
| referralType | internal (within Medini group/specialist) / external |
| fromPractitionerId | Referring doctor |
| toPractitionerId / toSpecialty / toInstitution | Target |
| reason | Clinical reason |
| clinicalSummary | Structured summary (auto-draft from encounter/assessment via AI, doctor approves) |
| referralDate | Date sent |
| documentRef | Referral letter attachment |
| status | draft → sent → received → in-progress → completed / closed |
| outcome | Result (e.g. surgery done, patient returned) |
| followUpId | Optional follow-up created for review |

## 23.3 Lifecycle

```
Draft --> Sent --> Received --> In Progress --> Completed / Closed
```

| From | To | Trigger | Actor | Guard |
|------|----|---------|-------|-------|
| Draft | Sent | Send letter | Doctor | Letter attached; summary complete |
| Sent | Received | Target acknowledges | Reception/Doctor | Acknowledgement recorded |
| Received | In Progress | Specialist sees patient | Specialist/Doctor | Appointment/visit recorded |
| In Progress | Completed | Outcome known | Doctor | Outcome recorded |
| Any | Closed | No further action | Doctor | Reason |

## 23.4 Document

- Referral letter generated from template + clinical summary (doctor edits before send).
- Letter stored as attachment (documentRef); access audited.

## 23.5 Follow-up

- Optional follow-up auto-created (e.g. "review after specialist visit") → links to D3.13.

---

# 24. FOLLOW-UP & RECALL

> **Observed Evidence:** Dr Partner has follow-up tracking and a recall workflow (treatment completed → interval set → due date → reminder → contact → appointment → recall complete).
> **Existing Medini Capability:** Follow-up workflow (Phase 5.1) and Recall Due (Phase 6) exist at dashboard/action level.
> **Medini Architectural Recommendation:** Clinical follow-up/recall as Domain 3 entities that TRIGGER existing Communication + Appointment capabilities (no duplication).

## 24.1 Follow-up

| Field | Notes |
|-------|-------|
| followUpId | Auto |
| followUpType | post-treatment / recall / review |
| origin | sessionId / treatmentId / referralId |
| intervalDays | e.g. 7 days post-extraction review |
| dueDate | computed = created + interval |
| status | pending → due → contacted → booked → completed / closed |
| communicationTriggered | Comm Hub trigger flag |
| appointmentCreatedId | When follow-up → booking |

## 24.2 Recall

| Field | Notes |
|-------|-------|
| recallId | Auto |
| baseTreatmentId | e.g. scaling (recall in 6 months) |
| intervalMonths | 3/6/12 |
| lastDueDate / nextDueDate | Rolling |
| status | scheduled → due → reminded → booked → completed / closed |

## 24.3 Lifecycle (unified)

```
Pending/Scheduled --> Due --> Contacted --> Booked --> Completed
                                    |            |
                                    +----> Closed (patient declined / unreachable / cancelled)
```

| From | To | Trigger | Actor | Guard |
|------|----|---------|-------|-------|
| Pending | Due | dueDate reached | System | Auto |
| Due | Contacted | Comm triggered (WhatsApp/SMS) | System (Comm Hub) | communicationTriggered=true |
| Contacted | Booked | Patient accepts → appointment created | Reception | Appointment booked (Appt Mgmt) |
| Booked | Completed | Appointment completed | System | Appt status = completed |
| Any | Closed | Declined/unreachable | Reception/Doctor | Reason |

## 24.4 Integration Rules

- Domain 3 OWNS the clinical follow-up/recall RECORD (interval, due date, status).
- Appointment creation = Appointment Mgmt (D3.13 calls apptCreate — external ref).
- Message sending = Communication Hub (D3.13 emits trigger; Hub sends).
- Existing Phase 5.1/Phase 6 follow-up dashboards consume D3.13 data via the same API.
- Auto-recalls: treatments with defaultRecallIntervalMonths auto-create recall on session completion (e.g. scaling → 6-month recall).

## 24.5 Reminder Cadence (Medini recommendation)

- T-3 days: first reminder (WhatsApp/SMS).
- T-1 day: second reminder.
- No-show → auto-rebook suggestion + follow-up status stays booked (appointment no-show) → new due cycle.
- Configurable per branch (Comm settings), not hardcoded.

---

# 25. CLINICAL OUTCOME

> **Not observed as a structured concept in the Dr Partner study.** **Medini architectural recommendation.**

## 25.1 Outcome Entity

| Field | Notes |
|-------|-------|
| outcomeId | Auto |
| sessionId | 1:1 with session |
| outcome | success / partial / complication / failed |
| successCriteria[] | Predefined criteria per treatment category (e.g. RCT: symptom-free, obturation complete) |
| measurement | Result measurement (e.g. pocket depth, mobility score) |
| complication | Text (required if outcome=complication) |
| adverseEvent | Bool (mandatory report if true) |
| beforeStateRef / afterStateRef | Tooth state / photo refs |
| reviewedById / reviewedAt | Clinical review |
| status | recorded → reviewed → closed |

## 25.2 Outcome Lifecycle

```
Recorded (doctor, at session completion)
  --> Reviewed (doctor/higher review, optional)
  --> Closed (final)
```

- Adverse event = auto-generates incident flag visible to Branch Manager + HQ (governance), NOT hidden.
- Outcome history per patient per treatment type → analytics + AI risk insight.

## 25.3 Success Criteria

- Default criteria per treatment category seeded in Treatment Master (e.g. category=Endodontic → "asymptomatic", "obturation within 2mm").
- Doctor can edit criteria per session; edited criteria recorded (audit).

## 25.4 Before/After

- beforeStateRef: tooth condition + optional photo before treatment.
- afterStateRef: tooth condition + optional photo after.
- Rendered as comparison in Patient 360 treatment history.

---

# 26. CLINICAL TIMELINE

> **Not observed as a unified concept in the Dr Partner study.** **Medini architectural recommendation.** (Medini already has timeline infrastructure from Phase 6 — this extends it.)

## 26.1 Definition

The Clinical Timeline is the **unified, append-only event stream** of every clinical activity for a patient. It is the backbone of Patient 360 clinical views and clinical audit.

## 26.2 Event Sources (What Generates Events)

| Source | Event Examples |
|--------|----------------|
| D3.1 Encounter | created, opened, completed, finalized, reopened |
| D3.2 Assessment | drafted, completed; diagnosis added, confirmed, resolved |
| D3.3 Safety | allergy recorded, confirmed, inactivated; condition added, resolved |
| D3.4 Treatment Master | treatment published, deactivated, retired, branch override changed |
| D3.6 Tooth | condition changed, extraction recorded |
| D3.7 Plan | proposed, accepted, revised (v2), completed, cancelled |
| D3.8 Session | started, procedure completed, completed, finalized, cancelled |
| D3.9 Notes | drafted, signed, amended |
| D3.10 Imaging | requested, uploaded, reported |
| D3.11 Consent | requested, accepted, expired, withdrawn |
| D3.12 Referral | sent, received, completed, closed |
| D3.13 Follow-up | due, contacted, booked, completed, closed |
| D3.14 Outcome | recorded, reviewed, closed; adverse event |
| External (Appt Mgmt) | appointment booked, completed, cancelled, no-show |

## 26.3 Event Record

| Field | Notes |
|-------|-------|
| eventId | Append-only |
| patientId | Subject |
| entityType / entityId | Source object |
| action | created/updated/signed/finalized/cancelled/amended/confirmed/withdrawn/etc. |
| actorId / actorRole | Who |
| branchId | Where (event source branch) |
| timestamp | When |
| dataHash | Integrity |
| metadata | Before/after diff JSON |

## 26.4 Rules

- Append-only: no event is ever deleted or edited (correction = new event).
- Timeline renders grouped by encounter where applicable; standalone events (safety changes, recalls) render independently.
- Patient-scoped: timeline FOLLOWS the patient across branches (patient treated at 2 branches → both visible; each event retains its branch).
- Timeline powers: Patient 360 Clinical tab, audit queries, AI summarization input, recall/outcome analytics.

---

# 26A. TREATMENT PACKAGES / BUNDLES

> **Observed Evidence:** Dr Partner has Package setup (Master Setup).
> **Existing Medini Capability:** None.
> **Medini Architectural Recommendation:** Packages reference Treatment Master items (never clone). Consumption tracked; balance + expiry lifecycle.

## 26A.1 Package Model

| Field | Notes |
|-------|-------|
| packageId | Auto |
| name / description | e.g. "Dental Cleaning Package (4 visits)" |
| branchScope | Global or branch-specific |
| items[] | Package Items → treatmentId + qty (e.g. 4× scaling, 2× polish) |
| price / taxClass / eInvoiceClass | Finance refs |
| validityDays | e.g. 365 |
| status | draft → active → inactive |

## 26A.2 Package Item Rules

- References Treatment by treatmentId (single source of truth — package item is a qty wrapper, not a clone).
- Item eligible only if treatment.packageEligible=true.
- Add-ons allowed where treatment.addOns defined.
- Package eligibility check at purchase AND at consumption.

## 26A.3 Consumption

| Field | Notes |
|-------|-------|
| consumptionId | Auto |
| packageId / patientId | Subject |
| purchaseRef | EXTERNAL: Finance invoice/payment ref |
| totalSessions / usedSessions | Balance math |
| remainingBalance | Derived |
| expiryDate | purchase + validityDays |
| status | active → exhausted / expired |

- Each consumed session decrements balance (session finalize → consumption event).
- Cannot consume beyond balance (hard block).
- Package session still creates normal Treatment Session + Outcome + Clinical Note — package is a PAYMENT/ENTITLEMENT wrapper, never a separate clinical record.

## 26A.4 Boundary

- Package definition + eligibility + consumption = Domain 3 (D3.16).
- Package PRICE + SALE + INVOICE = Finance (Domain 3 emits consumption events; Finance bills).
- No duplicate catalog: packages never define their own treatments.

---

# 26B. DENTAL-SPECIFIC ARCHITECTURE REVIEW

> **Purpose:** Validate that Domain 3's universal primitives support real dental workflows without hardcoding per-treatment logic.

## 26B.1 Dental Workflow Coverage Matrix

| Workflow | Supported By | Tooth-Level? | Multi-Session? | Notes |
|----------|-------------|--------------|----------------|-------|
| Restoration (filling) | Session + Procedure + Tooth | Yes (surfaces) | No | Composite/amalgam/GIC = same primitive, different treatmentId |
| Root Canal (RCT) | Plan + repeated Sessions | Yes | Yes (2-4) | Same plan item, repeated sessions w/ progress notes |
| Extraction | Session + Tooth status change | Yes | No | Confirmation + consent if required |
| Scaling & Polishing | Session | No (whole mouth) | No | Recall auto-created (6m) |
| Whitening | Session + Procedure | Optional | Optional (take-home) | In-office vs take-home = procedure steps |
| Crown / Bridge | Plan + Sessions + Tooth | Yes | Yes (2-3) | Prep session → lab → cementation session |
| Denture (partial/full) | Plan + Sessions | Partial (abutments) | Yes (2-4) | Impression → try-in → delivery → review |
| Implant | Plan + Sessions + Tooth | Yes | Yes (3+) | Surgery → healing → abutment → crown; long timeline |
| Braces / Ortho | Plan + repeated Sessions | Yes | Yes (12-24) | Adjustments = same item repeated sessions |
| Aligners (Invisalign) | Plan + Sessions + Imaging | Yes | Yes | Reviews at intervals; imaging refs |
| Emergency | Encounter(type=emergency) + Session | Optional | No | No appointment required |
| Endo multi-session | Plan item + repeated sessions | Yes | Yes | Dependencies (crown after RCT) |
| Prosthodontic sequence | Plan with dependencies | Yes | Yes | Bridge: abutment prep → crown → cement |

## 26B.2 Findings

1. **All dental workflows are covered** by: Encounter + Assessment + Diagnosis + Plan (items, sessions, dependencies) + Session/Procedure + Tooth + Outcome + Follow-up. No hardcoded specialty modules needed.
2. **Multi-visit = repeated sessions on the same plan item** with progress notes — works for RCT, ortho, implant, dentures uniformly.
3. **Dependencies** handle sequencing (RCT → crown; extraction → implant placement → healing → crown).
4. **Tooth chart** is the only dental-specific UI; its DATA is generic (Tooth entity) so future specialties (pedo, perio surgery) fit without schema change.

## 26B.3 Recommendation

- Do NOT build per-specialty modules (no "Ortho module", no "Endo module").
- Build: (1) universal clinical primitives (26C), (2) tooth chart component, (3) treatment-specific PROCEDURE TEMPLATES + NOTE TEMPLATES + POST-OP INSTRUCTIONS as CONFIGURATION seeded per category.

---

# 26C. UNIVERSAL CLINICAL PRIMITIVES

> **Medini architectural recommendation** — the reuse layer that keeps Domain 3 scalable.

## 26C.1 Primitive Set

| Primitive | Definition | Reused By |
|-----------|------------|-----------|
| Encounter | Clinical visit container | All visits |
| Assessment | S/O/A reasoning block | Consult, review, follow-up |
| Diagnosis | Clinical conclusion (tooth-linkable) | All specialties |
| Treatment | Catalog service | Everything billable |
| Treatment Plan | Ordered intention w/ versions | Multi-visit work |
| Treatment Session | One execution event | Every treatment delivery |
| Procedure | Granular step | Complex treatments |
| Clinical Note | Immutable documentation | All notes |
| Consent | Acceptance record | Treatments, procedures, imaging |
| Referral | Specialist handoff | Internal/external |
| Imaging | Image metadata + ref | Diagnostics |
| Outcome | Result measurement | Every session |
| Follow-up | Continuity trigger | Post-treatment, recall, review |
| Tooth | Dental unit of care | Charting, tooth-level records |
| Clinical Event | Append-only audit/timeline | Everything |

## 26C.2 How Primitives Combine (Examples)

```
Simple:  Encounter → Session → Note → Outcome
Multi:   Encounter → Assessment → Diagnosis → Plan(v1..vN) → Item → Session×N → Note ×N → Outcome → Follow-up → Recall
Special: Encounter → Referral → (external) → Outcome review
Safety:  Profile → Warning → Block at Session start → Override (reason)
```

## 26C.3 Rules

- No primitive duplicates another (each has ONE owner table).
- Any future treatment type = new Treatment row + templates, NOT new code path.
- Template configuration (note templates, procedure templates, post-op instructions, consent templates) is data, not logic.

---

# 27. WORKFLOW ARCHITECTURE

## 27.1 End-to-End Clinical Journey

```
Patient books appointment (Appt Mgmt) ──┐
                                        v
Check-in (Appt) → Encounter created (D3.1)
  → Safety banner shown + acknowledged (D3.3)
  → Assessment: S/O → Diagnosis (D3.2)
  → Treatment Plan created/proposed/accepted (D3.7)
  → Consent (if required) (D3.11)
  → Session started (D3.8)
  → Procedures executed (D3.8)
  → Notes drafted + signed (D3.9)
  → Outcome recorded (D3.14)
  → Session finalized (D3.8) → Treatment delivered event → Finance
  → Follow-up/Recall auto-created (D3.13) → Comm Hub triggers
  → Tooth records updated (D3.6)
  → Timeline events appended (D3.15)
```

## 27.2 Key Workflows (Summary)

| Workflow | Trigger | Steps | Owner |
|----------|---------|-------|-------|
| New consultation | Appointment in-progress / walk-in | Encounter → Assessment → Diagnosis → (Plan if needed) | D3.1/D3.2/D3.7 |
| Single treatment | Appointment / direct | Encounter → Session → Procedures → Note → Outcome | D3.8/D3.9/D3.14 |
| Multi-visit plan | Diagnosis | Plan → Accept → Session loop → Complete | D3.7/D3.8 |
| Emergency | Walk-in | Emergency Encounter → immediate Session → Outcome → follow-up | D3.1/D3.8 |
| Consent capture | Plan acceptance / session | Template → present → sign → store | D3.11 |
| Recall cycle | Session completion | Recall → Due → Remind → Book → Complete | D3.13 |
| Adverse event | Session completion | Outcome=adverse → flag → manager/HQ report | D3.14 |
| Referral | Diagnosis complexity | Referral → letter → send → track → outcome | D3.12 |

## 27.3 Checkpoint Enforcement

Safety checks at: booking (Appt), session start, session finalize. Results: WARN (acknowledge) or BLOCK (override w/ reason + audit).

---

# 28. LIFECYCLE / STATE MACHINES (Consolidated)

| Entity | States (valid order) |
|--------|---------------------|
| Clinical Encounter | Draft → Open → Completed → Finalized (↔ Reopen w/ reason) |
| Assessment | Draft → Complete |
| Diagnosis | Provisional → Confirmed → Resolved |
| Allergy | Unconfirmed → Confirmed ; any → Inactive |
| Medical History | Active → Resolved |
| Treatment (Master) | Draft → Active → Inactive → Retired (↔ Reactivate) |
| Treatment Plan | Draft → Proposed → Accepted → Active → Completed / Cancelled / Superseded |
| Plan Item | Planned → In-Progress → Completed / Cancelled |
| Treatment Session | Scheduled → Checked-in → In-Progress → Completed → Finalized / Cancelled |
| Procedure | Pending → In-Progress → Completed / Skipped |
| Clinical Note | Draft → Signed → Amended |
| Consent | Pending → Accepted → Expired / Withdrawn |
| Referral | Draft → Sent → Received → In-Progress → Completed / Closed |
| Follow-up | Pending → Due → Contacted → Booked → Completed / Closed |
| Recall | Scheduled → Due → Reminded → Booked → Completed / Closed |
| Outcome | Recorded → Reviewed → Closed |
| Imaging | Requested → Uploaded → Reported |
| Package | Draft → Active → Inactive |
| Package Consumption | Active → Exhausted / Expired |

**Global rules:**
- No state may be skipped unless explicitly allowed (see per-entity tables).
- Cancelled/withdrawn/closed states are TERMINAL for active use but records remain readable.
- Every transition writes a Clinical Event (audit + timeline).

---

# 29. BUSINESS RULES

## 29.1 Clinical Safety Rules

| # | Rule | Enforcement |
|---|------|-------------|
| BR-01 | Cannot finalize a treatment session if required clinical safety information is unresolved (severe allergy unconfirmed-blocked, active contraindication) | BLOCK at session finalize; doctor override + reason + audit |
| BR-02 | Unconfirmed allergies are ALWAYS visible (amber); never hidden | UI enforcement (no collapse) |
| BR-03 | Confirmed severe allergy blocks treatments touching the allergen class | BLOCK + override w/ reason |
| BR-04 | Pregnancy flag blocks CBCT unless doctor override | BLOCK + override |
| BR-05 | Allergy/medical history edits require audit; deletion impossible (inactive only) | System rule |

## 29.2 Treatment Master Rules

| # | Rule | Enforcement |
|---|------|-------------|
| BR-06 | Inactive treatment cannot be newly booked, planned, or added to package | Block at booking/plan/package |
| BR-07 | Specialist-required treatment cannot be assigned to non-specialist practitioner | BLOCK at booking + session start |
| BR-08 | Consent-required treatment cannot be finalized without valid (non-expired, non-withdrawn) consent | BLOCK at finalize |
| BR-09 | Branch cannot create duplicate treatment codes (override, not clone) | Uniqueness constraint |
| BR-10 | Global deactivation cascades to all branches for NEW bookings | Cascade rule |
| BR-11 | Historical sessions/plans readable even if master changes | Snapshot in session/plan item |
| BR-12 | Whole-mouth treatments do not require tooth selection; dentalChartRequired treatments do | Chart validation |

## 29.3 Clinical Record Rules

| # | Rule | Enforcement |
|---|------|-------------|
| BR-13 | Signed clinical notes are immutable; corrections = linked amendment | System rule (no edit path) |
| BR-14 | Clinical notes preserve authorship (authorId fixed) | System rule |
| BR-15 | Cancelled treatments/plans never disappear from history | Read-only terminal states |
| BR-16 | Plan revisions preserve previous versions (superseded, read-only, diff visible) | Versioning |
| BR-17 | Tooth condition changes are additive (history preserved) | System rule |
| BR-18 | Extraction is irreversible; requires confirmation + consent if flagged | Confirmation dialog + audit |
| BR-19 | Finalized encounters/sessions cannot accept new clinical data (amendments only) | Finalize lock |
| BR-20 | Adverse events auto-flag to Branch Manager + HQ | Outcome workflow |

## 29.4 Branch & Access Rules

| # | Rule | Enforcement |
|---|------|-------------|
| BR-21 | Branch users cannot access unauthorized branch clinical records | Server-side scope (Phase 3.1 pattern) |
| BR-22 | Patient clinical history (allergies, medical history, tooth chart, timeline) follows patient across branches | Patient-scoped reads |
| BR-23 | Encounters/sessions/plans are branch-scoped (created in the branch where care occurred) | Branch context |
| BR-24 | Clinical data visible cross-branch to HQ only; manager sees own branch | RBAC |
| BR-25 | Doctor sees only own patients' clinical records (doctorId=self enforcement) | Server-side (Phase 3.1 pattern) |

## 29.5 Consent & Documentation Rules

| # | Rule | Enforcement |
|---|------|-------------|
| BR-26 | Only active consent template versions can be used for new requests | Template validation |
| BR-27 | Consent expiry/withdrawal blocks planned sessions for covered treatments | Consent state check |
| BR-28 | PDPA consent owned by Patient/Compliance; Domain 3 references only | Boundary rule |
| BR-29 | AI may draft but never silently write; all AI outputs require doctor approval | AI approval workflow |

## 29.6 Package Rules

| # | Rule | Enforcement |
|---|------|-------------|
| BR-30 | Package items must reference eligible treatments (packageEligible=true) | Validation |
| BR-31 | Cannot consume beyond package balance | Hard block |
| BR-32 | Package sessions still produce full clinical records (session/note/outcome) | Design invariant |

---

# 30. RBAC — DOMAIN 3 PERMISSION MATRIX

> Legend: V=View, C=Create, E=Edit, D=Delete (inactive/soft only), S=Sign, A=Approve, F=Finalize, X=Export, O=Override (with reason), — = none. Server-enforced (not UI-hidden).

## 30.1 Module-Level Matrix

| Module | HQ/Admin | Branch Manager | Doctor | Receptionist | Finance |
|--------|----------|----------------|--------|--------------|---------|
| Encounter (D3.1) | V,A,F | V,A | C,E,S,F | C (create walk-in/check-in), V | V (billing ref) |
| Assessment (D3.2) | V | V | C,E,S,F | — | — |
| Diagnosis (D3.3) | V | V | C,E,S | — | — |
| Allergy (D3.3) | V,C,E,A | V | C,E,S (confirm) | C (record unconfirmed) | — |
| Medical History (D3.3) | V,C,E,A | V | C,E,S | C (record) | — |
| Dental History (D3.3) | V | V | C,E | — | — |
| Treatment Master (D3.4) | C,E,A (global) | E (branch override) | V | V | V (price ref) |
| Tooth Chart (D3.6) | V | V | C,E,S | V (read) | — |
| Treatment Plan (D3.7) | V | V,A | C,E,S,A (accept) | V | V (value ref) |
| Treatment Session (D3.8) | V | V,A | C,E,S,F | C (scheduled/check-in), V | V (billing ref) |
| Clinical Note (D3.9) | V | V | C,E (draft), S, F | — | — |
| Imaging (D3.10) | V | V,A | C,E,S (report) | C (upload) | V |
| Consent (D3.11) | V | V,A | C,E (accept witness) | C (present/witness) | — |
| Referral (D3.12) | V | V | C,E,S | C (send/ack) | — |
| Follow-up/Recall (D3.13) | V | V,A | C,E | C,E (contact/book) | — |
| Outcome (D3.14) | V | V,A (adverse) | C,E,S | — | — |
| Timeline (D3.15) | V (all) | V (own branch) | V (own patients) | V (own branch) | V |
| Packages (D3.16) | C,E,A | E (branch) | V | C (sell) | V (price/sale) |

## 30.2 Special Attention Items

| Item | Rule |
|------|------|
| Clinical notes | Only Doctor signs. Draft editable by author only. Signed immutable. Finance/HQ view-only. |
| Diagnosis | Doctor-only create/confirm. Manager/HQ view. Never deletable (resolved keeps history). |
| Treatment plans | Doctor creates/edits/proposes. Manager approves. Patient acceptance witnessed by doctor. |
| Allergies | Reception records UNCONFIRMED only. Doctor confirms. Only doctor/HQ edit. Never delete. |
| Medical history | Same pattern as allergies. |
| Consent | Reception may present/witness; doctor witnesses for invasive. Withdrawal requires doctor. |
| Treatment completion | Only doctor finalizes session (outcome + notes + consent satisfied). |
| Override | Doctor-only for clinical BLOCKs, with reason + audit. Manager may NOT override clinical blocks. |

## 30.3 Deletion Policy

- NO hard delete of clinical records anywhere in Domain 3.
- Soft states: inactive (allergy/condition/treatment), cancelled (plan/session/referral), closed (follow-up), superseded (plan), withdrawn (consent).
- Draft notes: author may delete (audited).
- Everything else: terminal state + history.

---

# 31. MULTI-BRANCH ARCHITECTURE

## 31.1 Scope Classification (Complete List)

| Data | Scope | Detail |
|------|-------|--------|
| Treatment definition (name, category, contraindications, flags) | GLOBAL | Single definition per code |
| Treatment price / price2 / panelPrice / cost | BRANCH | Branch override; default = global |
| Treatment active / availability / duration | BRANCH | Branch override |
| Branch-custom treatments | GLOBAL (source=medini-custom) + BRANCH availability | Shared across group, branch can disable |
| Consent templates | GLOBAL (HQ) | Branch may use subset |
| Allergy / Medical / Dental history | PATIENT | Follows patient |
| Tooth chart | PATIENT | Follows patient |
| Clinical timeline | PATIENT | Follows patient (events retain branch) |
| Clinical Encounter | BRANCH | Created in branch of care |
| Assessment / Diagnosis | ENCOUNTER (branch of encounter) | Inherits encounter branch |
| Treatment Plan | BRANCH | Where planned; visible cross-branch to treating doctor w/ patient |
| Treatment Session | BRANCH | Where executed |
| Clinical Note | ENCOUNTER/SESSION | Branch of container |
| Consent | BRANCH | Where captured |
| Referral | BRANCH | Where initiated |
| Follow-up / Recall | BRANCH | Where managed |
| Imaging | BRANCH | Where taken |
| Outcome | SESSION | Branch of session |
| Packages | GLOBAL or BRANCH | Per package definition |
| Package Consumption | BRANCH | Where purchased/consumed |

## 31.2 Cross-Branch Clinical Continuity

- Patient treated at Branch A, then Branch B: allergies, medical history, tooth chart, diagnosis history, treatment history, timeline ALL visible at Branch B (patient-scoped reads) — with branch tag on each record.
- Encounter/session data created at Branch A stays owned by Branch A for editing/finalization; Branch B can view (doctor at B with the patient).
- HQ sees everything; Manager sees own branch only; Doctor sees own patients (server-enforced).

## 31.3 Practitioner Assignment

- Practitioner assigned to branch(es); can only create sessions/encounters in assigned branches (server-enforced).
- Specialist flag on treatment cross-checked against practitioner specialty.

---

# 32. SOURCE OF TRUTH MATRIX

| Data | Owner | Domain 3 Role |
|------|-------|---------------|
| Patient identity, demographics, family, guardian, referral network | Patient Mgmt | Read-only reference |
| Appointment (schedule, status, chair, conflict) | Appointment Mgmt | Read-only reference + triggers encounter |
| Treatment definition, category, eligibility flags | D3.4 Treatment Master | OWN |
| Branch override (price, availability) | D3.4 + Finance ref | OWN (pricing ref = Finance contract) |
| Clinical diagnosis | D3.2 | OWN |
| Treatment plan + versions | D3.7 | OWN |
| Treatment session + procedure | D3.8 | OWN |
| Clinical note + amendments | D3.9 | OWN |
| Allergy / medical / dental history | D3.3 | OWN |
| Tooth chart state | D3.6 | OWN |
| Consent (clinical) | D3.11 | OWN |
| Referral (clinical event) | D3.12 | OWN (network = Patient Mgmt) |
| Imaging metadata + ref | D3.10 | OWN |
| Outcome | D3.14 | OWN |
| Follow-up / recall | D3.13 | OWN |
| Package definition + consumption | D3.16 | OWN (sale/price = Finance) |
| Invoice / payment / outstanding | Finance | Read-only (billing events emitted) |
| Insurance / panel claim | Insurance/Finance | Read-only (clinical docs provided) |
| Message sending / templates / campaigns | Communication Hub | Trigger emission only |
| Patient timeline (aggregate) | Timeline aggregation (D3.15 + Phase 6) | OWN clinical events; shared timeline service |
| Dashboard KPIs | Analytics layer | Consumes clinical events |

**Conflict prevention:** no two domains write the same field. Cross-domain refs are by ID + snapshot where semantics must freeze (treatmentSnapshot, templateVersionSnapshot).

---

# 33. CROSS-DOMAIN INTEGRATION

## 33.1 Patient Management

| Integration | Mechanism | Direction |
|-------------|-----------|-----------|
| Patient identity | Domain 3 references patientId (read-only) | Patient → D3 |
| Allergies/Medical history | Domain 3 OWNS; Patient 360 DISPLAYS via clinical profile projection | D3 → Patient 360 |
| Dental history | Domain 3 owns; Patient 360 displays | D3 → Patient 360 |
| Tooth chart | Domain 3 owns; Patient 360 displays chart component | D3 → Patient 360 |
| Diagnosis history | Domain 3 owns; Patient 360 displays | D3 → Patient 360 |
| Treatment history | Domain 3 owns; Patient 360 displays | D3 → Patient 360 |
| Referral network | Patient Mgmt owns network; D3.12 references + creates link | Bidirectional ref |
| Timeline | Shared timeline service; clinical events appended by D3 | D3 → Timeline → Patient 360 |
| Follow-up | Phase 5.1 dashboards consume D3.13 data | D3 → Dashboard |

**No duplicate Patient functionality:** Patient 360 is a VIEW; Domain 3 owns the underlying clinical entities.

## 33.2 Appointment Management

| Integration | Mechanism |
|-------------|-----------|
| Treatment → Appointment | Appointment stores treatmentId (existing Phase 2) — references D3.4 master |
| Appointment → Encounter | Appointment IN PROGRESS / check-in → Encounter auto-created (D3.1), linked by appointmentId |
| Appointment → Session | Session may reference appointmentId (execution layer) |
| Appointment → Plan | Bookings for multi-visit plans link planItemId in appointment (optional ref) |
| Treatment completion → Follow-up | Session finalize → Follow-up/Recall created → booking via Appt Mgmt |
| Safety at booking | Contraindication/allergy check runs at booking (WARN/BLOCK) — Appt Mgmt calls D3 safety service |

## 33.3 Financial Management (no finance inside D3)

| Integration | Mechanism |
|-------------|-----------|
| Treatment → Billable item | D3.4 master supplies treatmentId + price refs; Finance owns pricing contract |
| Plan → Potential value | Plan items reference treatmentId; Finance can compute potential value (read-only) |
| Session → Treatment delivered | Session finalize emits "treatment delivered" event (treatmentId, patientId, branchId, date) → Finance triggers invoice line |
| Package consumption → Billable | Consumption decrement emits event → Finance bills/validates |
| Source of truth | Clinical truth (what was done) = D3.8; financial truth (what was charged) = Finance |

## 33.4 Insurance / Panel (no claim engine inside D3)

| Integration | Mechanism |
|-------------|-----------|
| Treatment → Insurance eligibility | treatment.insuranceEligible flag consumed by Insurance module |
| Treatment → Panel price | panelPrice ref consumed by Insurance/Panel billing |
| Session → Claimable service | Session finalize → claim support packet (treatmentId, tooth, notes refs, date) |
| Clinical documentation → Claim support | Signed notes + imaging + outcome available to claim (read-only refs, access audited) |

## 33.5 Communication Hub (no sending inside D3)

| Integration | Mechanism |
|-------------|-----------|
| Appointment reminder | Existing Appt flow (unchanged) |
| Follow-up due | D3.13 emits trigger → Hub sends reminder |
| Recall due | D3.13 emits trigger → Hub sends recall message |
| Post-treatment instructions | D3.8 finalize → Hub sends instructions (template per category) |
| Clinical document notification | Signed note/imaging/consent → Hub notifies patient (configurable) |
| Referral notification | D3.12 sent → Hub notifies receiving clinic/doctor |

---

# 34. PATIENT 360 INTEGRATION

## 34.1 Enhanced Patient 360 Structure (Domain 3 additions)

```
PATIENT 360
───────────────────────────────
Patient Header (Name / MRN / Branch / Status)
  + Allergies ⚠️ RED/AMBER banner (D3.3) — always visible
───────────────────────────────
Profile (Patient Mgmt)
  ├── Identity / Contact
  └── Medical History (D3.3) / Dental History (D3.3)
───────────────────────────────
Family & Relationships (Phase 6.1 — Patient Mgmt)
───────────────────────────────
Referral Network (Phase 6.1 — Patient Mgmt) + Clinical Referrals (D3.12)
───────────────────────────────
Upcoming Appointment (Phase 6.2 — Appt Mgmt)
───────────────────────────────
Clinical ⚠️ (NEW — D3)
  ├── Encounter History (D3.1)
  ├── Assessment & Diagnosis History (D3.2)
  ├── Treatment Plans (D3.7) — active + superseded
  ├── Treatment History (D3.8) — sessions + procedures
  ├── Tooth Chart (D3.6) — interactive
  ├── Clinical Notes (D3.9) — signed + amendments
  ├── Imaging (D3.10)
  ├── Consent (D3.11)
  ├── Outcomes (D3.14)
  └── Follow-up / Recall (D3.13)
───────────────────────────────
Payments & Outstanding (Finance — read-only for D3)
───────────────────────────────
Insurance / Panel (Insurance — read-only for D3)
───────────────────────────────
Documents (attachments refs — D3.16)
───────────────────────────────
Timeline (D3.15 + Phase 6 shared service)
───────────────────────────────
Notes (Phase 6 — Patient Mgmt)
───────────────────────────────
Follow-up (D3.13 + Phase 5.1)
```

## 34.2 Section Ownership

| Section | Owner |
|---------|-------|
| Allergies banner | D3.3 (projection into header) |
| Medical/Dental history | D3.3 |
| Clinical tabs | D3.1–D3.15 |
| Payments/Outstanding | Finance |
| Insurance/Panel | Insurance |
| Documents | Attachments service (D3-owned refs) |
| Timeline | Shared timeline (D3.15 events + other domains) |
| Follow-up | D3.13 |

## 34.3 Rules

- Patient 360 remains a VIEW layer; it never writes clinical data directly.
- Clinical sections show data from ALL branches (patient-scoped) with branch badges.
- Doctor opening Patient 360 from any branch sees the patient's full clinical history (with permission).

---

# 35. APPOINTMENT INTEGRATION (Detail)

```
BOOKING (Appt Mgmt)
  - treatmentId from D3.4 master
  - safety check (D3.3) → WARN/BLOCK at booking
  - specialist check → BLOCK if wrong practitioner
CHECK-IN → Encounter created (D3.1) [status open]
IN PROGRESS → Session start (D3.8)
COMPLETED → Encounter finalized (D3.1) → follow-up created (D3.13)
CANCELLED / NO-SHOW → no encounter (or encounter cancelled w/ reason)
```

- Encounter lifecycle is DRIVEN by appointment status but owned by D3.1.
- An appointment cancelled AFTER clinical preparation (encounter already open) → encounter closed with reason, notes preserved (edge case 42.x).

---

# 36. FINANCE INTEGRATION (Detail)

```
Session Finalize (D3.8)
  → emits: treatmentDelivered { treatmentId, treatmentSnapshot, patientId, branchId, sessionId, date, qty }
  → Finance: creates invoice line (uses branch price override + tax + eInvoice class)
Plan Accepted (D3.7)
  → emits: planValue { planId, items[], estimatedValue } (informational — no billing)
Package Consumed (D3.16)
  → emits: packageConsumed { packageId, consumptionId, patientId, branchId }
Consent/Notes (D3.9/D3.11)
  → available to Finance/Insurance as read-only refs for claim support
```

**Invariant:** Domain 3 never writes invoice/payment fields. Finance never writes clinical fields.

---

# 37. INSURANCE INTEGRATION (Detail)

- Insurance module (future Phase 8) reads: treatment.insuranceEligible, panelPrice, session records, signed notes, imaging refs.
- Claim support packet = read-only assembly of clinical refs (no clinical writes from Insurance).
- Panel price per branch override consumed by Finance at billing time.

---

# 38. COMMUNICATION INTEGRATION (Detail)

| Trigger (D3) | Payload | Hub Action |
|--------------|---------|-----------|
| Follow-up due | patientId, dueDate, followUpType | Send reminder (WhatsApp/SMS template) |
| Recall due | patientId, intervalMonths | Send recall message |
| Post-op instructions | sessionId, templateId | Send instructions |
| Referral sent | referralId, toInstitution | Notify receiver |
| Adverse event (governance) | outcomeId | Internal staff alert (manager/HQ) — NOT patient comm |

**Invariant:** Domain 3 emits triggers via an event bus; Communication Hub owns templates, sending, opt-out, and delivery logs.

---

# 39. AI ARCHITECTURE

> **Not observed in the Dr Partner study.** **Medini architectural recommendation**, built on Medini's existing intelligence layer (Phase 4).

## 39.1 Core Principle

**AI ASSISTS, NEVER DECIDES. AI NEVER SILENTLY ALTERS CLINICAL RECORDS.**

Every AI output requires explicit human (doctor) approval before persistence. AI can READ clinical data for summaries/insights; it cannot WRITE without approval.

## 39.2 Capability Matrix

| # | Capability | Input | Output | Human Approval | Confidence | Safety Boundary |
|---|-----------|-------|--------|----------------|-----------|-----------------|
| AI-01 | Clinical summary | Encounter + assessment + notes | Draft summary text | Doctor edits + signs | Shown as % | Never auto-signed |
| AI-02 | Patient history summarization | Timeline + records | Condensed clinical narrative | Doctor approves | Shown | Read-only source |
| AI-03 | Treatment history summarization | Sessions + outcomes | Treatment history digest | Doctor approves | Shown | Read-only source |
| AI-04 | Recall prediction | History + recall patterns | Suggested next recall date | Doctor/Manager approves | Shown | Suggestion only |
| AI-05 | Follow-up suggestions | Outcome + treatment type | Suggested follow-up interval/type | Doctor approves | Shown | Suggestion only |
| AI-06 | Missing documentation detection | Encounter/session vs required docs | "Missing: outcome record, signed note" | Action by doctor | High | Read-only detection |
| AI-07 | Documentation assistance | Assessment/diagnosis/session data | Draft note content | Doctor edits + signs | Shown | Tagged "AI-assisted draft" |
| AI-08 | Treatment plan assistance | Diagnosis + history | Suggested plan items/order | Doctor builds final plan | Shown | Suggestion only |
| AI-09 | Risk flagging | Profile + treatment + history | Risk flags (e.g. bleeding risk) | Doctor reviews | Shown | Alert only; BLOCK still rule-based |
| AI-10 | Appointment preparation summary | Patient + next appointment | Doctor briefing card | Doctor views | Shown | Read-only |
| AI-11 | Doctor briefing | Patient 360 data | Pre-consult briefing | Doctor views | Shown | Read-only |
| AI-12 | Patient 360 clinical summary | All clinical data | Plain-language summary | Doctor approves before sharing | Shown | Never auto-sent to patient |

## 39.3 Technical Rules

| Rule | Detail |
|------|--------|
| Approval gate | Every AI WRITE (draft note, plan suggestion applied) passes through explicit doctor confirmation |
| Audit | AI suggestions logged (prompt inputs, output, model, confidence, approval action, actor) |
| Tagging | AI-generated content tagged "AI-assisted" in metadata (never presented as doctor-authored) |
| Read-only default | AI reads via the same permission layer as the requesting user (no privilege escalation) |
| Confidence | Confidence score displayed on all AI clinical output |
| Rollback | Applied AI suggestions reversible before signing (draft state) |
| Blocking | AI NEVER creates BLOCK states; safety enforcement is deterministic rules only (BR-01..BR-32) |

## 39.4 Safety Boundary Statement

- AI cannot: sign notes, confirm allergies, accept consents, finalize sessions, override blocks, create diagnoses as final, change tooth states, cancel plans.
- AI can: draft, summarize, suggest, flag, detect. All reversible and approved.

---

# 40. REPORTING & ANALYTICS

## 40.1 Report Categories

| Category | Audience | Reports |
|----------|----------|---------|
| Operational | Reception/Doctor | Today's clinical workload, session queue, pending documentation, consent expiry |
| Management | Branch Manager | Treatment volume, completion rate, follow-up compliance, recall compliance, clinical workload, treatment mix, diagnosis trends, documentation completion, outcome summary |
| Executive | HQ | Cross-branch treatment trends, treatment by category/branch/practitioner, plan conversion, adverse events, recall compliance by branch |
| Analytics | All | Treatment mix, diagnosis trends, outcome rates, recall compliance, clinical workload trends |
| AI Insights | Manager/HQ | Anomaly detection (e.g. recall dropout spike), prediction (recall load next month) — assistive |

## 40.2 KPI Definitions

| KPI | Definition | Source |
|-----|-----------|--------|
| Treatment volume | Sessions finalized per period | D3.8 |
| Treatment by category | Volume grouped by category | D3.8 + D3.4 |
| Treatment by branch | Volume per branch | D3.8 |
| Treatment by practitioner | Volume per doctor | D3.8 |
| Treatment completion rate | Completed vs scheduled sessions | D3.8 |
| Plan conversion | Accepted plans vs proposed | D3.7 |
| Plan completion | Completed vs active plans | D3.7 |
| Treatment outcome | Outcome distribution | D3.14 |
| Follow-up completion | Completed vs due | D3.13 |
| Recall compliance | Booked/completed vs due recalls | D3.13 |
| Clinical workload | Sessions per doctor per day/week | D3.8 |
| Diagnosis trends | Diagnosis counts by code/category/tooth | D3.2 |
| Documentation completion | Signed required notes vs total | D3.9 |
| Adverse events | Count per branch/period | D3.14 |

## 40.3 Dashboard Reflection

- Existing Dashboard Command Center (Phases 1–7) gains clinical widgets: today's sessions, pending documentation, consent expiring, recall due, adverse event alerts.
- KPI layer consumes clinical events (same analytics engine, Phase 2).

---

# 41. AUDIT & GOVERNANCE

## 41.1 Audit Coverage

| Entity | Events Audited |
|--------|----------------|
| Diagnosis | created, confirmed, resolved |
| Clinical notes | drafted, signed, amended |
| Allergies | recorded, confirmed, edited, inactivated |
| Medical history | recorded, edited, resolved |
| Treatment plan | proposed, accepted, revised, completed, cancelled |
| Treatment session | started, completed, finalized, cancelled |
| Consent | requested, accepted, expired, withdrawn |
| Referral | sent, received, completed, closed |
| Imaging | requested, uploaded, reported |
| Outcome | recorded, reviewed, closed; adverse event |
| Tooth | condition changed, extraction recorded |
| Treatment master | published, edited, branch override changed, deactivated, retired |

## 41.2 Audit Record (Who/What/When/Before/After/Reason/Branch)

| Field | Notes |
|-------|-------|
| actorId / actorRole | Who |
| action | What (verb) |
| timestamp | When |
| before / after | Field-level diff (metadata JSON) |
| reason | Required for overrides, cancellations, withdrawals, amendments |
| branchId | Where |
| device/session | Session ID where appropriate (mobile/tablet/desktop) |
| dataHash | Integrity hash for signed/finalized records |

## 41.3 Governance Rules

- Audit events are APPEND-ONLY (Clinical Event entity); no deletion.
- Sensitive data access (clinical notes view, imaging view/download) logged (access audit).
- Retention: clinical records + audit retained per regulatory requirement (Malaysia: minimum 7 years per MOH/PDPA practice; confirm with compliance — Decision D-05).
- Branch Manager can export own-branch audit; HQ can export all; export itself is audited.

## 41.4 Compliance Notes

- PDPA: consent records, data access logs, right-to-erasure handling (defer to compliance decision; clinical records exempt from erasure under medical record law — Decision D-05).
- Clinical governance: adverse event reporting flow to manager/HQ.
- e-Invoice: clinical treatment classification supports e-Invoice mapping (Finance consumes).

---

# 42. EDGE CASES

| # | Edge Case | Handling |
|---|-----------|----------|
| EC-01 | Patient changes branch | Patient-scoped data (allergies, history, tooth, timeline) follows patient; encounters/sessions stay branch-scoped with branch badge |
| EC-02 | Same patient treated at multiple branches | Full clinical history visible at both (patient-scoped reads); each record retains its branch; no data merge needed |
| EC-03 | Treatment discontinued | Plan item → cancelled (reason); sessions stopped; history preserved; follow-up adjusted |
| EC-04 | Treatment plan changed | Revision → new version (superseded old); diff view; active sessions continue under new version |
| EC-05 | Treatment partially completed | Plan item stays in-progress; outcome=partial on the session; next session continues the item |
| EC-06 | Treatment repeated | New session/plan item for same treatmentId; history shows repeated entries; tooth before/after states chain |
| EC-07 | Treatment cancelled | Session cancelled (reason); tooth state NOT changed; no billing event emitted (Finance sees cancelled) |
| EC-08 | Wrong treatment selected | Correct via amendment (signed records) or edit before sign; plan revision if planned; audit trail shows correction |
| EC-09 | Clinical note amended | Linked amendment note; original retained; diff view; amendment reason required |
| EC-10 | Consent withdrawn | Withdrawal recorded (reason); planned sessions blocked; in-progress warned; doctor decision documented |
| EC-11 | Expired consent | Blocked at finalize; re-consent flow (new request with current template version) |
| EC-12 | Allergy added after plan creation | Safety engine re-evaluates plan items → WARN/BLOCK; plan may need revision |
| EC-13 | Allergy discovered during treatment | Session pause; safety override w/ reason; allergy recorded immediately (audit); plan review |
| EC-14 | Practitioner changes mid-plan | Plan/session reassignment (new doctorId) audited; both practitioners visible in history; authorship preserved |
| EC-15 | Patient changes practitioner | Same as EC-14 at plan level; patient relationship updated |
| EC-16 | Appointment cancelled after clinical preparation | Encounter closed with reason (if opened); drafted notes preserved (not signed); follow-ups adjusted |
| EC-17 | Treatment completed without appointment | Walk-in/emergency: encounter auto-created; session standalone; billing still triggers |
| EC-18 | Emergency treatment | Encounter type=emergency; skips normal booking; safety banner still shown; consent flow simplified (emergency provision, documented) |
| EC-19 | Duplicate treatment | Prevented at booking (conflict detection); if executed anyway (two sessions same tooth same day) → both recorded, doctor reviews outcome |
| EC-20 | Historical treatment whose master changed | treatmentSnapshot preserves original definition; master change never corrupts history |
| EC-21 | Branch-specific treatment | Global definition + branch override; unavailable at other branches; history readable everywhere |
| EC-22 | Inactive treatment | Cannot be newly booked/planned; existing sessions/plans continue; history readable |
| EC-23 | Treatment package | Package consumption wrapper; clinical records normal; balance enforcement |
| EC-24 | Insurance-ineligible treatment | Flag visible; insurance module skips it; patient pays directly (Finance) |
| EC-25 | Specialist-only treatment | Non-specialist BLOCKED at booking + session start; override not allowed (manager cannot override) |
| EC-26 | Missing tooth treated | Hard block unless implant/space-maintainer explicitly allowed |
| EC-27 | Patient deceased (future) | Record-level status; clinical data retained per compliance (future capability, not v1.0) |
| EC-28 | Data entry error in allergy | Correct via edit (audited) — never delete; erroneous entry marked inactive with reason |
| EC-29 | Session finalized with unresolved warning | WARN acknowledged (audited) or BLOCK override w/ reason — no silent bypass |
| EC-30 | Multi-branch doctor | Doctor assigned to multiple branches; encounters/sessions branch-tagged; cross-branch view limited to own patients |

---

# 43. UX / WORKSPACE ARCHITECTURE

## 43.1 Doctor Workspace (chairside, tablet-first)

| Element | Detail |
|---------|--------|
| Primary screens | Today's patient queue (from Appt), Clinical workspace, Tooth Chart, Notes, Plan |
| Primary actions | Start encounter, acknowledge safety banner, S/O/A entry, tooth charting, sign notes, finalize session, record outcome |
| Information visibility | Own patients, own branch(s); full clinical history; allergies banner always visible |
| Alerts | Safety WARN/BLOCK, pending documentation, consent required, imaging needed |
| Shortcuts | Quick template chips (S/O/A), one-tap tooth select, quick-sign |

## 43.2 Reception Workspace

| Element | Detail |
|---------|--------|
| Primary screens | Check-in, New Encounter (walk-in), upload imaging, present consent, book follow-up |
| Primary actions | Check-in → encounter, record unconfirmed allergy/condition, upload X-ray, schedule follow-up/recall |
| Visibility | Own branch; patient clinical safety banner (view-only, no edit of confirmed data) |
| Alerts | Safety banner (must show, never hide), consent missing, imaging missing |
| Shortcuts | Quick check-in, quick consent present |

## 43.3 Branch Manager Workspace

| Element | Detail |
|---------|--------|
| Primary screens | Branch clinical dashboard (volume, completion, recalls), treatment master branch override, audit export, adverse event alerts |
| Primary actions | Approve plans, review outcomes/adverse events, set branch treatment prices/availability, review recalls |
| Visibility | Own branch only (server-enforced) |
| Alerts | Adverse events, documentation gaps, recall compliance drop |

## 43.4 HQ/Admin Workspace

| Element | Detail |
|---------|--------|
| Primary screens | Global treatment master, templates (notes/consent/procedure), cross-branch clinical analytics, global audit |
| Primary actions | Publish/deactivate treatments, manage templates, review cross-branch trends, export audit |
| Visibility | All 14 branches |
| Alerts | Cross-branch adverse events, compliance issues |

## 43.5 Finance (view-only clinical)

| Element | Detail |
|---------|--------|
| Screens | Billing context (treatment delivered events), claim support packet viewer |
| Visibility | Clinical refs needed for billing/claim — no clinical editing |

## 43.6 Patient 360 & Appointment Workspace

- Patient 360: new Clinical section (Section 34) with tabs.
- Appointment workspace: safety WARN/BLOCK at booking; treatment selector uses D3.4 master (existing 69-treatment dropdown upgraded with eligibility flags + xray/specialist indicators).

## 43.7 Design Language (KISS — cards over tables)

- Clinical timeline = card feed with icons per event type.
- Tooth chart = interactive visual, not table.
- Safety banner = persistent card, red/amber.
- Sessions/plans = card lists with status chips.
- Mobile-first breakpoints continue existing responsive system (390/768/1280/1440).

---

# 44. PROTOTYPE REQUIREMENTS

## 44.1 Must Prototype in Single HTML Review Artifact (Next Phase D3-P1)

| # | Prototype | Priority | Notes |
|---|-----------|----------|-------|
| P-01 | Clinical encounter creation + lifecycle | P0 | From appointment check-in / walk-in |
| P-02 | Patient clinical profile + allergies + medical history | P0 | Safety banner in header + management screens |
| P-03 | Treatment catalog (full master view) | P0 | Extend existing 69-treatment dropdown into master management |
| P-04 | Treatment plan (create/propose/accept/multi-visit) | P0 | Card-based plan builder |
| P-05 | Treatment session (start/complete/finalize) | P0 | From queue or plan |
| P-06 | Clinical SOAP note (simplified) | P0 | Template chips + free text + sign |
| P-07 | Tooth-level chart | P1 | Interactive FDI chart + condition + treatment per tooth |
| P-08 | Consent (template + accept + status) | P1 | Present/sign/withdraw flow |
| P-09 | Follow-up / recall (due/contact/book) | P1 | Integration with existing follow-up dashboard |
| P-10 | Clinical timeline | P1 | Unified feed in Patient 360 |
| P-11 | Imaging (upload + reference + view) | P2 | File ref + embed preview |
| P-12 | Referral (create/send/track) | P2 | Letter + status flow |
| P-13 | Clinical outcome (record + adverse flag) | P2 | At session completion |
| P-14 | Clinical documents (notes list + amendments) | P2 | Read + diff view |
| P-15 | Treatment packages (define + consume) | P2 | Balance display |

## 44.2 Prototype Principles

- P0 items must work END-TO-END (reception → doctor → finalize → follow-up) in ONE journey prototype.
- P1/P2 can be screen-level prototypes.
- Every prototype respects existing RBAC + branch scope patterns (server-enforced).
- Validation checklist per prototype: create → lifecycle transitions → invalid transition blocked → audit event visible → branch isolation test.

## 44.3 Not Prototyped (Deferred)

- AI features (phase after core clinical prototype validated)
- Full imaging viewer / PACS
- e-Signature vendor integration
- Real WhatsApp sending (existing hub handles)
- Inventory/material stock control

---

# 45. FUTURE BACKEND IMPLICATIONS

> These are implications for the future production backend — NOT implementation. No SQL/API in this document.

## 45.1 Storage & Data Layer Implications

| Area | Implication |
|------|-------------|
| Clinical records | Relational schema (entities E1–E28) with FK integrity; treatmentSnapshot/planSnapshot as frozen JSON |
| Timeline | Append-only event table (Clinical Event) with composite index (patientId, timestamp); event sourcing pattern |
| Immutability | contentHash + signed flags; DB-level guard against UPDATE on signed/finalized rows (trigger or app-layer) |
| Tooth chart | Patient+tooth composite key; condition history as child rows (additive) |
| Object storage | Attachments/imaging refs to secure bucket; access logging |
| Multi-branch | branchId on all branch-scoped tables; row-level scope checks in query layer (existing Phase 3.1 pattern extends) |
| Audit | Single audit event stream fed by domain services (no per-table audit log sprawl) |

## 45.2 Service Layer Implications

| Service | Responsibility |
|---------|----------------|
| Safety Engine | Deterministic rule evaluation (BR-01..BR-32) at booking/session-start/finalize checkpoints |
| State Machine Service | Centralized valid-transition enforcement per entity (no scattered if/else) |
| Template Service | Note/procedure/consent/post-op templates (data-driven) |
| Event Bus | Clinical events → timeline, audit, finance triggers, comm triggers |
| AI Service | Draft/summarize/flag only; approval gate; audit logging; confidence scores |
| Permission Service | Extends existing auth.ts matrix with D3 module permissions + server-side scope |

## 45.3 API Architecture Implications

- tRPC routers per module (existing pattern): clinicalRouter, safetyRouter, treatmentMasterRouter, planRouter, sessionRouter, noteRouter, consentRouter, referralRouter, imagingRouter, outcomeRouter, followupRouter, timelineRouter, packageRouter.
- Cross-domain calls via existing router layer (appt, patient, finance, comm) — no direct DB access between domains.
- Webhooks/events for finance triggers (treatmentDelivered) and comm triggers (followupDue).

## 45.4 Frontend Implications

- Doctor workspace becomes a new route family under existing roleGuard.
- Tooth chart = new reusable component.
- Patient 360 gains Clinical tab group (tabs within tab).
- Existing dashboard gains clinical widgets (read-only consumption of new routers).

---

# 46. IMPLEMENTATION DEPENDENCIES

| Dependency | On | Why |
|-----------|----|----|
| Treatment Master | D3.4 prototype | Everything references treatmentId |
| Safety (allergies/medical) | Patient record + D3.3 | Needed before any session |
| Encounter | Appointment (optional) + Patient | Container |
| Assessment/Diagnosis | Encounter | Clinical reasoning |
| Plan | Diagnosis + Treatment Master | Intention |
| Session | Encounter + Plan/Appointment (optional) | Execution |
| Notes | Session/Encounter | Documentation |
| Outcome | Session | Result |
| Follow-up/Recall | Session/Outcome + Appt Mgmt + Comm Hub | Continuity |
| Consent | Template + Treatment flags | Legal gate |
| Tooth chart | Patient + Sessions | Dental state |
| Packages | Treatment Master + Finance (sale) | Wrapper |
| Timeline | All modules | Aggregation |

**Build order (prototype phases):** Treatment Master → Safety Profile → Encounter → Assessment/Diagnosis → Session → Notes → Outcome → Plan → Follow-up → Consent → Tooth chart → Imaging → Referral → Timeline → Packages.

---

# 47. RISKS

| # | Risk | Severity | Mitigation |
|---|------|----------|-----------|
| R-01 | Clinical record tampering | High | Immutable signed notes + contentHash + append-only audit |
| R-02 | Allergy data not entered / missed | High | Mandatory banner + booking/session checkpoints + P0 flagging; reception can record unconfirmed |
| R-03 | Scope creep into finance/insurance | Medium | Boundary rules + SoT matrix enforced in review gates |
| R-04 | Over-complexity (replicating Dr Partner) | Medium | KISS principle; template-driven; universal primitives; no per-specialty modules |
| R-05 | Multi-branch data leakage | High | Server-enforced scope (existing pattern), patient-scoped reads, access audit |
| R-06 | Tooth chart data integrity (wrong tooth) | Medium | FDI validation + chart UX + confirmation on irreversible ops (extraction) |
| R-07 | AI silently altering records | High | Approval gate + audit + tagging; AI never signs/finalizes |
| R-08 | Consent expiry blocking care | Medium | Expiry reminders + re-consent flow; emergency provision |
| R-09 | Historical data loss on master changes | High | Snapshots in sessions/plans; no hard deletes |
| R-10 | Adoption friction for doctors | Medium | Chairside-first UX, template chips, one-tap actions, minimal clicks |
| R-11 | e-Invoice/tax misclassification | Medium | eInvoiceClassification on treatment master; HQ-controlled |
| R-12 | Documentation completeness | Medium | Required-doc checks at finalize + AI missing-doc detection |

---

# 48. DECISIONS REQUIRED

| # | Decision | Options | Recommendation | Reason | Impact |
|---|----------|---------|----------------|--------|--------|
| D-01 | Tooth numbering | FDI / Universal / Both | **FDI (ISO 3950)** | Malaysian standard, dual dentition native | Schema + chart UI |
| D-02 | SOAP depth | Full configurable SOAP (Dr Partner style) / simplified template SOAP | **Simplified template SOAP** | Doctor adoption, KISS | Note builder design |
| D-03 | Treatment Master model | Per-branch clone / Global + override | **Global + override** | No duplication, consistent group pricing controls | Schema + admin UX |
| D-04 | Encounter entity | Conflate with appointment / separate | **Separate** | Clinical accountability; walk-in/emergency support | New entity + integration |
| D-05 | Clinical record retention & erasure | Fixed 7y no-erasure / PDPA erasure on request | **7y retention, no erasure of clinical records (confirm with compliance)** | Malaysian medical record law vs PDPA | Compliance config |
| D-06 | Attachments storage | Embedded / object storage ref | **Object storage ref** (prototype: local/data-URL) | Scale, security, audit | Storage layer |
| D-07 | Imaging v1.0 | Reference only / attempt PACS | **Reference only (no PACS/DICOM v1.0)** | Scope control | Imaging module scope |
| D-08 | Consent signature | Verbal-witnessed / canvas capture / e-sign vendor | **Canvas capture + verbal-witnessed fallback in prototype; vendor later** | Cost, pragmatism | Consent UX |
| D-09 | AI in v1.0 prototype | None / read-only assistive / full | **Read-only assistive after core clinical validated** | Safety first | AI phase timing |
| D-10 | Tooth-level mandatory | Optional per treatment / always | **Optional via dentalChartRequired flag** | Scaling/whitening don't need teeth | Chart validation |
| D-11 | Draft note visibility | Author-only / visible read-only with badge | **Author-only until signed (branch-configurable)** | Privacy of work-in-progress | Note permission |
| D-12 | Package scope | Global only / branch packages | **Both (branch-scoped packages allowed)** | Local marketing | Package schema |

---

# 49. ARCHITECTURE VALIDATION CHECKLIST

| # | Quality Gate | Status |
|---|--------------|--------|
| 1 | No duplicate ownership (SoT matrix, §32) | ✅ PASS |
| 2 | No duplicate Patient functionality (Patient 360 = view) | ✅ PASS |
| 3 | No duplicate Appointment functionality (scheduling stays Appt Mgmt) | ✅ PASS |
| 4 | No duplicate Finance functionality (emits events only) | ✅ PASS |
| 5 | No duplicate Communication functionality (triggers only) | ✅ PASS |
| 6 | Full branch scoping (§31) | ✅ PASS |
| 7 | Full RBAC incl. sign/approve/finalize/override (§30) | ✅ PASS |
| 8 | Full auditability (§41, E26 append-only) | ✅ PASS |
| 9 | Clinical safety enforced (checkpoints, BR-01..05) | ✅ PASS |
| 10 | Treatment lifecycle complete (states + transitions §28) | ✅ PASS |
| 11 | Multi-visit treatment supported (plan/session loop) | ✅ PASS |
| 12 | Dental-specific support (FDI, tooth chart, surfaces, §14/26B) | ✅ PASS |
| 13 | Historical data preservation (snapshots, no hard delete) | ✅ PASS |
| 14 | AI safety boundaries (§39) | ✅ PASS |
| 15 | Analytics readiness (KPI definitions §40) | ✅ PASS |
| 16 | Future API readiness (routers per module, event bus) | ✅ PASS |
| 17 | Evidence discipline (Observed vs Existing vs Recommendation kept separate) | ✅ PASS |

---

# 50. FINAL RECOMMENDATION

## 50.1 Summary

Domain 3 — Clinical & Treatment Management v1.0 is a complete enterprise business architecture covering:

- **16 modules** (D3.1–D3.16), 28 entities, 17 data dictionaries, full relationship model
- **Dental-first** clinical model: FDI tooth chart, surfaces, tooth-level diagnosis/treatment
- **Safety-first**: allergies/medical history as P0 with enforcement checkpoints
- **No duplication**: SoT matrix + boundary rules prevent overlap with Patient/Appt/Finance/Insurance/Comm
- **Immutable clinical records**: signed notes + amendments + append-only audit
- **Assistive AI**: safe-by-design with approval gates
- **Multi-branch**: patient-centric continuity + branch-scoped operations
- **Implementation-ready**: prototype requirements, dependencies, risks, decisions, validation gates

## 50.2 Unresolved Decisions (must be resolved before build)

1. **D-05** — Clinical record retention/erasure policy (legal confirmation needed).
2. **D-08** — Consent signature approach for production (canvas vs vendor).
3. **D-11** — Draft note visibility policy per branch.
4. **D-09** — AI prototype phase timing (recommended: after core clinical validated).

All other decisions are RECOMMENDED and locked in this document (D-01..D-04, D-06, D-07, D-10, D-12).

## 50.3 Next Steps (Recommended Order)

1. **LOCK this architecture** (Phase D3.3 review).
2. Prototype Phase D3-P1: P0 items (encounter, safety profile, treatment master, plan, session, SOAP note) in the Single HTML review artifact.
3. Prototype Phase D3-P2: tooth chart, consent, follow-up, timeline.
4. Prototype Phase D3-P3: imaging, referral, outcome, documents, packages.
5. Then backend: schema + routers per §45, with the same quality gates.

---

# DOMAIN 3 STATUS

## **READY FOR LOCK** ✅

Domain 3 — Clinical & Treatment Management Enterprise Business Architecture v1.0 is complete: 50 sections + 2 extension sections (26A, 26B) + universal primitives (26C), evidence-disciplined, enterprise-grade, dental-specific, multi-branch, AI-safe, and implementation-ready.

**Blocker check:** The 4 unresolved decisions (D-05, D-08, D-09, D-11) are BUSINESS/LEGAL decisions, not architecture blockers. They do not prevent locking the architecture; they must be resolved before production build.

**Recommendation:** LOCK Domain 3 v1.0 and proceed to the Single HTML prototype phase (D3-P1) — matching the established Medini workflow (architecture → prototype → validate → backend).

---
