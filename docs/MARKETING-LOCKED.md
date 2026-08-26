# MARKETING MANAGEMENT v1.0 — LOCKED

**Locked:** 10 August 2026 · **Baseline:** KISS Architecture v1.0 + Single HTML Full UX Prototype (3 modules)

---

## 1. Objective

Deliver **DOMAIN 4 — MARKETING MANAGEMENT v1.0** as a KISS architecture + complete interactive UX prototype in the Single HTML artifact — additive on the locked Medini build (Phases 1–7, D1 Patient, D2 Appointment, D3 Clinical, Finance v1.1).

## 2. Deliverables

### 2.1 Architecture Document

**File:** `docs/MARKETING-ARCHITECTURE.md` — purpose, scope, 3 modules, ownership, recall formula, campaign engine, WhatsApp boundary, RBAC, audit, data protection, cross-domain relationships, exclusions.

### 2.2 Single HTML Full UX Prototype

**Files:** `CURRENT-MEDINI-REVIEW.html` (root) + `app/reviews/CURRENT-MEDINI-REVIEW.html` (identical, MD5-verified)

**Implemented (KISS — 3 modules):**

| # | Capability | Interaction |
|---|-----------|-------------|
| 1 | Marketing dashboard | KPIs (Due Recall / Overdue / Inactive / Follow-ups / Active Campaigns) — all clickable; What Needs Your Attention; branch scope + + Create Campaign |
| 2 | Audience | All Patients / Leads / Due / Overdue / Inactive / Custom Segment — search, validation summary (selected/duplicates/invalid/opted-out/final), View Patient → Patient 360 |
| 3 | Leads | Simple capture (name/phone/source/interested/branch), statuses NEW→LOST, Open → Contacted/Interested/Lost/Book Appointment/Convert to Patient (link, no duplicate) |
| 4 | Due/Overdue Recall | Patient list with last visit, treatment, interval, days overdue, branch; Create Campaign per audience |
| 5 | Custom Segment | Friendly filters (branch/treatment/recall/consent) → result count → Create Campaign |
| 6 | Campaigns | All/Scheduled/Running/Completed/Templates; results (sent/delivered/read/replied/appointments); detail drawer with audit |
| 7 | Campaign wizard | 6 steps: Audience → Message → Personalize → Schedule → Review & Safety → Send/Schedule (via Communication Hub simulation) |
| 8 | Templates | Create/Edit/Duplicate/Activate/Deactivate; merge-field personalization + invalid-field validation; archive not delete |
| 9 | Recall & Follow-up | Recall dashboard (clickable), due/overdue/inactive lists, follow-ups (create/complete/send via Hub), recall rules editor |
| 10 | Recall rules | Intervals configurable (Scaling 6m etc.), branch override, save → audience recalculated |
| 11 | Inactive threshold | Configurable (default 12 months) → audience recalculated |
| 12 | Opt-out safety | Validation engine excludes duplicates/invalid/opted-out; campaign flow cannot bypass |
| 13 | WhatsApp boundary | Campaign/follow-up send → Communication Hub simulation (queue → safety → device → send) — no direct sending, no ban-bypass |
| 14 | Appointment integration | Book Appointment routes to Appointment Management (it owns booking) |
| 15 | Branch RBAC | HQ all-branch; branch users own-branch only; unauthorized blocked at state layer |
| 16 | Audit | Campaign/template/recall rule/inactive threshold/lead/follow-up mutations logged |

**Demo scenarios:** A) Due Recall → campaign; B) Overdue → reactivation campaign; C) Inactive → segment → campaign; D) Lead → follow-up → appointment; E) Recall config change updates state; F) Campaign safety (audience validation).

## 3. Test Results

```text
Existing tests (V9 QA + Phases 5–7 + D1/D2/D3 + Finance)  : 318/318 PASS
Marketing tests (MKT-01..MKT-45)                          : 45/45  PASS
TOTAL                                                      : 363/363 PASS
```

| Group | Coverage | Result |
|-------|----------|--------|
| MKT-01..MKT-06 | Navigation, dashboard, all KPIs clickable | ✅ |
| MKT-07..MKT-12 | Audiences (all/leads/custom), validation (duplicate/invalid/opt-out) | ✅ |
| MKT-13..MKT-25 | Campaign wizard, template CRUD, personalization, validation, schedule, review, send→Hub, results, pause/resume | ✅ |
| MKT-26..MKT-30 | Recall rule config, calculation, interval→audience, inactive threshold | ✅ |
| MKT-31..MKT-36 | Follow-up lifecycle, Hub link, lead create/convert, book appointment | ✅ |
| MKT-37..MKT-45 | Branch RBAC (own/all/blocked), audit, historical intact, no dead controls, full journey | ✅ |

## 4. Screenshots (app/smoke-shots/)

`marketing-dashboard.png` · `marketing-audience.png` · `marketing-due-recall.png` · `marketing-overdue-recall.png` · `marketing-inactive.png` · `marketing-leads.png` · `marketing-campaigns.png` · `marketing-create-campaign.png` · `marketing-template.png` · `marketing-personalization.png` · `marketing-schedule.png` · `marketing-campaign-review.png` · `marketing-campaign-result.png` · `marketing-follow-up.png` · `marketing-recall-rules.png` · `marketing-recall-config.png` · `marketing-optout.png` · `marketing-full-journey.png` (18 planned; 11 captured in validation run)

## 5. Files

| File | Change |
|------|--------|
| `docs/MARKETING-ARCHITECTURE.md` | Architecture v1.0 — NEW |
| `CURRENT-MEDINI-REVIEW.html` (root) | Marketing KISS prototype added (additive) |
| `app/reviews/CURRENT-MEDINI-REVIEW.html` | Synced — MD5 identical |
| `app/smoke-review.mjs` | +45 Marketing tests (MKT-01..MKT-45) |
| `app/smoke-shots/marketing-*.png` | Screenshots |
| `docs/CURRENT-STATE.md` | Updated — Marketing FULL UX PROTOTYPE COMPLETE |
| `docs/MARKETING-LOCKED.md` | This lock file |

## 6. Declaration

```text
Architecture Complete (KISS 3 modules)  : YES
Audience / Leads / Recall / Campaigns   : YES (all interactive)
Campaign wizard + templates + personalization + schedule + review : YES
Communication Hub boundary simulation   : YES (queue → safety → device → send)
Opt-out protection                      : YES (validation engine, cannot bypass)
Recall rules + inactive threshold config: YES (formula locked, params editable)
Branch RBAC (state layer)               : YES
Audit + historical protection           : YES
Single HTML Prototype                   : YES (363/363 PASS, root/app MD5 identical)
Production Backend                      : NOT implemented (Single HTML is the visual specification)
```

## 7. Remaining Limitations (prototype)

| Item | Status |
|------|--------|
| Real WhatsApp sending | Simulated via Communication Hub boundary — no real transport (by design) |
| Production backend / DB / API | Not started |
| Real template approval (WhatsApp Business) | Not modelled — prototype uses internal templates |
| Advanced analytics / ROI | Excluded by KISS (belongs to Analytics domain) |
| Drip/sequence automation | Minimal (out of scope for v1.0) |

## 8. STOP Condition

```text
MARKETING MANAGEMENT v1.0 — KISS ARCHITECTURE — LOCKED ✅

STOP. Do NOT start:
- Production Backend / PostgreSQL / Production API
- Real WhatsApp Business API integration
- Complex sales CRM / pipeline / ROI engine
- Marketing BI / analytics platform
- Advanced automation builders

Wait for next instruction.
```
