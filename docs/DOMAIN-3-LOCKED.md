# DOMAIN 3 — CLINICAL & TREATMENT MANAGEMENT — LOCKED

**Locked:** 10 August 2026 · **Baseline:** Architecture v1.0 LOCKED + Single HTML FULL UX PROTOTYPE (D3-P2) COMPLETE

---

## 1. Objective

Complete DOMAIN 3 — CLINICAL & TREATMENT MANAGEMENT as an **Enterprise Business Architecture v1.0** document AND a **complete, interactive UX prototype** in the Single HTML review artifact — the living visual specification of Domain 3.

## 2. Deliverables

### 2.1 Architecture Document (Business Architecture — NOT code)

**File:** `docs/DOMAIN-3-CLINICAL-TREATMENT-ARCHITECTURE.md` (2,898 lines · 174 KB)

| Part | Sections | Status |
|------|----------|--------|
| D3.1 — Foundation & Evidence | 1–9 | COMPLETE / LOCKED |
| D3.2 — Clinical Core | 10–18 | COMPLETE / LOCKED |
| D3.3 — Support + Integration + Governance | 19–50 + 26A/26B/26C | COMPLETE / LOCKED |

### 2.2 Single HTML Full UX Prototype (D3-P2)

**Files:** `CURRENT-MEDINI-REVIEW.html` (root) + `app/reviews/CURRENT-MEDINI-REVIEW.html` (identical, byte-verified)

**Implemented — complete clinical journey in one artifact:**

| # | Capability | Interaction |
|---|-----------|-------------|
| 1 | Clinical workspace header | Search patient/MRN/treatment/tooth/plan/encounter + scenario switcher (7 demo patients A–G) |
| 2 | KPI strip | Encounters Today, In Progress, Pending Notes, Active Plans, Follow-ups Due, Safety Alerts |
| 3 | Today's Clinical Queue | Check-in → creates encounter; safety badges (OK/⚠/🚨 CRITICAL) |
| 4 | What Needs Your Attention | Pending work list with contextual actions (SOAP, consent, safety, imaging, referral, session) |
| 5 | Clinical Encounters | Click → encounter workspace drawer |
| 6 | Encounter workspace | Patient header, safety banner, assessment/diagnosis/plan/consent/tooth/timeline summaries, pre-close checklist (safety, consent, docs) |
| 7 | Clinical Safety | Allergies (severity/reaction/status), medical history (category/status), safety detail drawer, Acknowledge flow |
| 8 | Clinical Assessment | Structured S/O/A modal with validation |
| 9 | SOAP editor | S/O/A + completion state (✓/✗), Save Draft, Sign (immutable), descriptive errors |
| 10 | SOAP signing | Draft → Signed → immutable (🔒); amendment workflow with reason |
| 11 | Interactive FDI tooth chart | Click tooth → detail drawer; condition colors; imaging indicator |
| 12 | Tooth detail | Status, surfaces (M/O/D/B/L toggle), diagnosis, planned treatment, history, imaging links |
| 13 | Treatment Plan detail | Items with tooth links, multi-session view, consent status, next-step actions |
| 14 | Multi-session treatment | Session list with ✓ completed / ● current / ○ planned; click → session detail; progression updates plan % |
| 15 | Treatment Session | Note, outcome, complete-session action, next session auto-advance |
| 16 | Clinical Notes | Table + note view; sign/amend; immutable lock display |
| 17 | Consent | Accept (signature ref), decline, withdraw; pending blocks completion |
| 18 | Consent Templates | View/create/activate/version/retire; active versions read-only |
| 19 | Clinical Documents | Create draft → review → sign → immutable; amendment with reason + version bump |
| 20 | Attachments | Link to documents (prototype ref) |
| 21 | Imaging | Add (requested) → report (reported); tooth linkage; access-audit note |
| 22 | Prescription | Draft → sign; allergy check blocks penicillin-class for allergic patient |
| 23 | Post-treatment care | Guidance data per plan (instructions, warnings, meds, next visit) |
| 24 | Clinical Outcome | Success/Partial/Complication/Adverse quick record |
| 25 | Adverse Event | Report → open → under-review → resolved → closed; escalate to HQ |
| 26 | Referral | Draft → sent → received → in-progress → completed; links existing network |
| 27 | Follow-up | Due → Book → appointment created (Appointment Mgmt) |
| 28 | Recall | 6-month check / scaling / ortho review; Book → appointment |
| 29 | Clinical Timeline | Event feed per patient; events append on every action; audit trail |
| 30 | Audit | Audit log (who/what/when) appended on every clinical action |
| 31 | Patient 360 | Clinical Safety, Tooth Chart, Treatment Plans, Consent sections (additive) |
| 32 | RBAC | Receptionist view-only; Doctor own-branch + clinical tools; HQ cross-branch visibility |

**Demo scenarios (A–G) via scenario switcher:**
- A: Routine (Nurul Izzah) — no severe safety issue
- B: Severe Allergy (Rajesh) — Penicillin severe → safety block demo
- C: Multi-visit RCT (Hakim) — RCT 46 + Crown, 3 sessions
- D: Multiple Tooth Conditions (Xin Yi) — 36 caries + whitening
- E: Consent Pending (Lim Jia Hui) — veneers blocked until consent
- F: Follow-up Due (Aishah) — scaling recall ready to book
- G: Referral (Ahmad Faizal) — impacted 38 → oral surgeon

## 3. Test Results

```text
Single HTML validation     : 248/248 PASS
  Existing (197)           : 197/197 PASS (V9 QA 83/83 + Phases 5–7 + responsive)
  New Domain 3 (D3-01..50) : 51/51 PASS
```

### 3.1 Domain 3 test summary

| Group | Tests | Result |
|-------|-------|--------|
| D3-01..D3-10 | Page shell, safety, encounters, plans, SOAP, tooth chart, consent, follow-up, RBAC basics | ✅ 10/10 |
| D3-11..D3-20 | Consent render, safety block, P360 integration, receptionist/doctor scope, walk-in, mobile | ✅ 10/10 |
| D3-21..D3-30 | KPI strip, queue badges, check-in→encounter, pending work, search, scenario switcher, encounter workspace, tooth detail, surface toggle, plan detail | ✅ 10/10 |
| D3-31..D3-40 | Session detail, multi-session progression, consent blocking/unblocking, template versioning, document lifecycle, amendment, imaging, prescription allergy block, outcome | ✅ 10/10 |
| D3-41..D3-50 | Adverse event, referral lifecycle, follow-up/recall booking, timeline+audit, full safety journey, receptionist/doctor/HQ RBAC, P360 integration | ✅ 10/10 |

## 4. Screenshots (app/smoke-shots/)

| File | Shows |
|------|-------|
| d3-clinical-hq.png | Clinical workspace: KPI strip, queue, pending work |
| d3-encounter-workspace.png | Encounter drawer with safety + checklist |
| d3-tooth-chart.png | Interactive FDI chart |
| d3-tooth-detail.png | Tooth 15 detail (implant) with surfaces/history/imaging |
| d3-treatment-plan.png | Plan PLN-0002 (RCT 46 + Crown) with items + sessions |
| d3-treatment-session.png | Session 2 (obturation) with outcome |
| d3-consent.png | Consent pending (Jia Hui veneers) |
| d3-consent-templates.png | Template management UI |
| d3-documents.png | Clinical documents list |
| d3-imaging.png | Imaging workspace |
| d3-prescription.png | Prescriptions with allergy flag |
| d3-outcome.png | Outcome recording |
| d3-referral.png | Referral detail (impacted 38) |
| d3-recall.png | Recalls list |
| d3-timeline.png | Clinical timeline |
| d3-adverse-event.png | Adverse event workflow |
| d3-safety-detail.png | Safety detail (Penicillin severe) |
| d3-p360-safety.png | Patient 360 clinical sections |
| d3-soap-modal.png | SOAP editor with completion state |
| d3-full-journey.png | End-state after interactive journey |

## 5. Files

| File | Change |
|------|--------|
| `docs/DOMAIN-3-CLINICAL-TREATMENT-ARCHITECTURE.md` | Architecture v1.0 (2,898 lines) — LOCKED |
| `CURRENT-MEDINI-REVIEW.html` (root) | Full UX prototype D3-P2 (514 KB) |
| `app/reviews/CURRENT-MEDINI-REVIEW.html` | Synced — byte-identical |
| `app/smoke-review.mjs` | 51 Domain 3 tests (D3-01..D3-50 + D3-06b) |
| `app/smoke-shots/d3-*.png` | 20 screenshots |
| `docs/CURRENT-STATE.md` | Updated — Domain 3 FULL UX PROTOTYPE COMPLETE |

## 6. Declaration

```text
Architecture Locked          : YES (v1.0, 50 sections + extensions)
Core Journey Complete        : YES (Appointment → Check-in → Encounter → Safety →
                                Assessment → Diagnosis → Tooth → Plan → Consent →
                                Session → Notes → SOAP Sign → Outcome → Complete →
                                Follow-up → Recall → Patient 360)
Full UX Prototype Complete   : YES (248/248 PASS, 20 screenshots, root/app identical)
Production Backend           : NOT implemented (Single HTML is the visual specification,
                                not production code — per architecture rule)
```

## 7. Remaining Limitations (prototype)

| Item | Status |
|------|--------|
| Treatment pricing | Not configured (0.00 in demo — existing Phase 2 limitation) |
| Imaging files | Metadata + reference only — no actual storage/PACS/DICOM (by design) |
| e-Signature | Simulated signature reference (canvas/vendor = production decision D-08) |
| AI clinical assistance | Deferred (post-core validation, decision D-09) |
| Full production backend | Not started (next major domain work) |

## 8. STOP Condition

```text
DOMAIN 3 — CLINICAL & TREATMENT MANAGEMENT v1.0 — FULL UX PROTOTYPE — LOCKED ✅

STOP. Do NOT start:
- Production Backend / PostgreSQL / Production API
- Finance / Payment / Invoice / Outstanding (separate domain)
- Insurance / Panel claim engine (separate domain)
- Real AI clinical features
- PACS/DICOM integration

Wait for next instruction.
```
