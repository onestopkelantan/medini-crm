# CURRENT-STATE — Medini CRM Dashboard

**Updated:** 15 August 2026 · **Authority:** This document is the primary project orientation file.

> **🔒 P9 FINAL QA & LOCK: PASS (15 Aug 2026).** Blueprint 100% complete — 966/966 regression green, all 13 domains locked, architecture boundaries + RBAC + cross-domain flows verified. Report: `docs/P9-FINAL-QA-LOCK.md`.
>
> **📐 PRODUCTION BACKEND BLUEPRINT v1.0: COMPLETE (15 Aug 2026).** `docs/PRODUCTION-BACKEND-BLUEPRINT-v1.0.md` — B0–B11 all phases, 32 sections, 10 ADRs, dependency graph, implementation sequence (Sprints 0–10), 4 open decisions, 10 risks. **No backend code written.** ⛔ Production backend implementation = AWAITING APPROVAL.

---

## Project

Medini CRM Dashboard (MediniOne) — AI-first dental CRM untuk Medini Dental Group.

## Current Status

```text
Phase 1   — Branch Context & Dashboard Architecture      : LOCKED
Phase 2   — Data Consistency & Analytics Engine          : LOCKED
Phase 3   — Role-Based Dashboard & Workspace             : COMPLETE
Phase 3.1 — Hardening + QA + Security Isolation          : LOCKED
Phase 4   — Dashboard Intelligence                       : LOCKED
Phase 5   — Action & Workflow Dashboard                  : LOCKED
Phase 5.1 — Action & Workflow Integrity Hardening        : LOCKED
Phase 6   — Domain 1: Patient Management / Patient 360   : LOCKED
Phase 6.1 — Patient 360 Relationship Enhancement         : COMPLETE
Phase 6.2 — New Appointment Functionality                : COMPLETE
Phase 6.3 — New Patient + Shared Family Contact          : COMPLETE
Phase 2   — Appointment Management v2                    : LOCKED
Phase 7   — Dashboard Command Center Finalization        : LOCKED
Domain 3  — Clinical & Treatment Management              : LOCKED — FULL UX PROTOTYPE COMPLETE
            (docs/DOMAIN-3-CLINICAL-TREATMENT-ARCHITECTURE.md
             + docs/DOMAIN-3-LOCKED.md + Single HTML full UX prototype D3-P2)
Finance   — Finance & Billing v1.2                         : COMPLETE — 6/6 PHASES LOCKED
            (docs/FINANCE-BILLING-ARCHITECTURE.md + FINANCE-BILLING-LOCKED.md
             P1 Treatment Cost; P2 Lab Payables; P3 Doctor Commission;
             P4 Bukku Connector REAL API (connection/pull real, push gated;
             1,747 transactions verified); P5 Two-Way Sync prototype;
             P6 Reconciliation + Final QA: HQ-only read-only comparison,
             resolution audit, CSV export, QA checks — 534/534 PASS)
Marketing — Marketing Management v1.0 (Domain 4)          : FULL UX PROTOTYPE COMPLETE / LOCKED
            (docs/MARKETING-ARCHITECTURE.md + docs/MARKETING-LOCKED.md
             KISS 3-module: Audience / Campaigns / Recall & Follow-up — 363/363 PASS)
Administration — Blueprint Lock Phase 1 (Group A)         : LOCKED
            (docs/ADMINISTRATION-ARCHITECTURE.md + docs/ADMINISTRATION-LOCKED.md
             Organization/Branch/Staff/Role/Permission single truth, versioned
             role assignment, governance audit, last-HQ protection — 559/559 PASS)
Settings — Blueprint Lock Phase 2 (Group A)               : LOCKED
            (docs/SETTINGS-ARCHITECTURE.md + docs/SETTINGS-LOCKED.md
             5-level config hierarchy, versioned + audited, branch override
             inheritance, secrets masked boundary, integrations — 584/584 PASS)
Operations — Blueprint Lock Phase 4 (Group B)             : LOCKED
            (docs/OPERATIONS-ARCHITECTURE.md + docs/OPERATIONS-LOCKED.md
             Doctor Live Status board, checklist/tasks/incidents/lab coordination,
             operational alerts, branch-scoped — 609/609 PASS)
WhatsApp Hub — Blueprint Lock Phase 5 (Group C)           : LOCKED
            (docs/WHATSAPP-HUB-ARCHITECTURE.md + docs/WHATSAPP-HUB-LOCKED.md
             WAHA-mapped channels, conversation lifecycle, assignment, escalation,
             templates, campaign queue, SLA, audit — 634/634 PASS)
AI Manager — Blueprint Lock Phase 6 (Group C)             : LOCKED
            (docs/AI-MANAGER-ARCHITECTURE.md + docs/AI-MANAGER-LOCKED.md
             AI workforce control plane: agents, capabilities, knowledge, automations,
             guardrails & approvals, performance & audit — 685/685 PASS)
Reports & Analytics — Blueprint Lock Phase 7 (Group D)    : LOCKED
            (docs/REPORTS-ANALYTICS-ARCHITECTURE.md + docs/REPORTS-ANALYTICS-LOCKED.md
             Read-only intelligence layer, canonical KPI registry (4 KPIs with source
             domain), scope-aware charts, Insights AI governed — 710/710 PASS)
Cross-Domain — Blueprint Lock Phase 8 (Group E)           : LOCKED
            (docs/CROSS-DOMAIN-CONSOLIDATION.md
             13-domain ownership matrix, event contracts, no circular ownership,
             RBAC/scope/naming consistency verified — 738/738 PASS)

## Domain Consolidation (13 August 2026) — COMPLETE 7/7

Master direction: Marketing = outreach intent · WhatsApp Hub = manage conversations · AI Manager = AI workforce control plane.
- Part 1 Audit (docs/AUDIT-PART1-CURRENT-STATE.md)
- Part 2 Target Architecture (docs/TARGET-ARCHITECTURE.md)
- Part 3 WhatsApp Hub consolidation (campaign queue removed, quick replies only)
- Part 4 Marketing consolidation (terminology → WhatsApp Hub, ownership verified)
- Part 5 AI Manager rebuild (control plane: Agents/Capabilities/Knowledge/Automations/Guardrails/Performance)
- Part 6 Cross-domain integration (governance hooks: AI Suggest + campaign send gated by AI Manager)
- Part 7 Regression QA — TOTAL 676 | PASS 676 | FAIL 0
- Final MD5 root↔reviews: 1c11b67a8a1899affb24eb9b04e06e6b
```

## M1 — Inter-Domain Integration (14 August 2026)

Master prompt: M1 v1.1 — Foundation → Connection → Completion & Lock. Role × Domain × Data × Workflow × Cross-Domain Contract.

```text
M1 Fasa 1 — Foundation (Audit + Contract Layer)              : LOCKED — GATE PASS
            (docs/INTER-DOMAIN-AUDIT.md — 9-dimension audit (P0=1, P1=6, P2=25+ verified);
             window.MEDINI_ARCHITECTURE contract layer:
             DOMAIN_REGISTRY=13 canonical · ROLE_DOMAIN_MATRIX 4 role × 13 domain ·
             DATA_OWNERSHIP (1 owner/domain, reports=READ_ONLY) ·
             CROSS_DOMAIN_EVENTS 13 contracts (PAYMENT_STATUS_UPDATED canonical,
             no PAYMENT_RECEIVED) · PERMISSION_MATRIX can(role,domain,action,context)
             service-level scope · accessor pattern getVisiblePaymentStatusForCurrentUser();
             payment status model PENDING/PAID/OVERDUE (external payment, CRM=status layer);
             Bukku P4 Real API protected — 768/768 PASS [738 baseline + 30 ct])

Financial Radar — Finance Tracker + Alert System              : COMPLETE / LOCKED
            (docs/MEDINI-FINANCIAL-RADAR.md; FIN_TRACKER derive dari FIN (single source);
             radar levels 🟢>14 🟡14–8 🔴7–1 🔴today 🚨overdue · ageing 1–7/8–30/31–60/>60 critical;
             DEFERRED/RESCHEDULED preserve original dueDate (no falsify);
             recurring nextDueDate weekly/monthly/quarterly/yearly;
             configurable FinancialItem (HQ add, no new domain);
             Bukku boundary SYNCABLE/REQUIRES_MAPPING/BUKKU_ONLY;
             role scope HQ full / BM branch / Receptionist patient / Doctor patient+commission —
             802/802 PASS [+34 fr])

M1 Fasa 2 — Connection (Cross-Domain + Role Views + P360)    : COMPLETE — GATE PASS
            (docs/M1-PHASE-2-CONNECTION.md; canonical IDs derived
             (appointmentId/patientId=MRN/branchId/doctorId/treatmentCaseId/saleRef);
             canonical accessors cxGetPatient/cxGetAppointments/cxGetTreatments/
             cxGetPaymentStatus/cxGetPatient360 (service-level scope, bypass-proof);
             payment status connection + PAYMENT_STATUS_UPDATED propagation;
             receptionist confirm PENDING→PAID (external payment, audit trail);
             Patient 360 role-filtered cross-domain surface (payment status block +
             confirm action); role views derived dari ROLE_DOMAIN_MATRIX (bukan hide);
             state propagation single source → derived views;
             Finance Radar integrated per role; WhatsApp readiness (patientId/branchId/
             appointmentId/doctorId canonical refs) — 824/824 PASS [+22 ix/sc/p360])

M1 Fasa 3 — Completion (Chair Cleanup + Verify + Lock)      : COMPLETE — 🔒 M1 LOCKED
            (docs/M1-PHASE-3-COMPLETION.md + docs/INTER-DOMAIN-ARCHITECTURE-LOCKED.md;
             Bill Tracker CANCELLED — Financial Radar = single finance tracker (no duplicate);
             Chair Utilization KPI removed permanently (dashboard→Appointment Load,
             RPT_KPIS 4→3, chips) + guard cu01-03, clinical chair refs preserved;
             cross-role integration verified: HQ↔BM↔Receptionist↔Doctor (canonical data +
             permission + events + derived views, no data copy);
             Reports read-only derive; WhatsApp readiness; Bukku P4 untouched;
             no payment processor; no backend; R-03/R-04/R-19 updated ikut architecture baru —
             839/839 PASS [+15 cu/f3]; md5 8fc59e57… byte-identical)
```

**🔒 M1 ARCHITECTURE = LOCKED.** Future changes must be explicitly versioned. Next (post-approval): M2 WhatsApp Hub → P9 Final QA → Backend → Bukku production sync.

## M2 Fasa 1 — Anti-Ban Safety Engine + Device Health Score (🔒 LOCKED, 879/879)

- `waSafetyCheck()` 6 gates berurutan: CHANNEL_UNAVAILABLE → LOW_HEALTH (<70) → DAILY_CAP (50) → OUTSIDE_SENDING_WINDOW (9–18) → RATE_LIMIT (interval 60–180s) → AUTO_PAUSED (25→15min)
- `waDeviceHealth()` 0–100 per fon; warming <70; `WAH.sentLog` + `WAH.blocked` (send_blocked audit)
- Role scope: HQ semua channels, BM branch sendiri, Doctor none
- Tests wah01-11, docs/M2-WHATSAPP-HUB.md

## M2 Fasa 2 — Campaign + Human-Like AI Response (🔒 LOCKED, 903/903)

**Fasa 2A — Drip + Spin (wah27-35):**
- `waSpinResolve()` `{Hi|Hey|Salam} {name}` — validate, preview, NEVER send unresolved
- `waDripAudience()` 4 jenis derive dari canonical: birthday (patients/dob), appointment_reminder (−3d, cxAppointments), post_visit (+7d completed), recall_due (existing logic)
- Campaign flow: create → audience → template → preview → schedule → safety → queue → audit. Blocked = no send + send_blocked audit
- Campaign wizard UI (`waCampaignWizard`)

**Fasa 2B — Human-Like AI Response (wah12-26):**
- `WAH_CONV_QUEUE` state machine: RECEIVED → BUFFERING → PROCESSING → RESPONDED/WAITING/HANDOFF/CLOSED
- FIFO priority (receivedAt + sequence); human handoff boleh override
- Buffer 15–20s configurable; message batching (3 rapid messages = 1 batch); timer reset on new message
- Conversation lock (`conv.lock`) — no duplicate AI response, one batch → one response
- `waBuildAIContext()` canonical + role-scoped; AI response PASS `waSafetyCheck` (same engine, no bypass)
- `waHumanHandoff()` stops AI auto-reply; `waVisibleConversations()` role scope (HQ global / BM+Receptionist branch / Doctor patient-only)

**Root cause wah16/26 lesson:** patch pada root HTML sahaja tanpa `cp` ke `app/reviews/` — harness load file reviews. SENTIASA sync selepas setiap patch HTML.

Docs: docs/M2-WHATSAPP-HUB.md (full architecture). HTML md5 `93eb58ef3d5f54690cee03ec99c0016c` (root = app/reviews, byte-identical).

## M2 Fasa 3 — WhatsApp Hub Completion (🔒 LOCKED, 925/925)

**Fixes (audit findings):**
- Debug text `/* PHASE 3 §52 */` rendered as visible text — removed
- Context panel fake data (Balance RM0, Loyalty Silver) — replaced canonical (MRN link, appointment via cxGetAppointments, payment status via cxGetPaymentStatus — status only, hidden from doctor)
- `waSend` fake AI echo — removed; human reply real + channel check + audit
- "View 360" navigate-away — replaced nested P360 drawer (FIN_DRAWER_STACK, Back/Close)
- Campaign wizard role guard — doctor/receptionist blocked; BM branch-locked (local campaign)
- Doctor scope hardened — own doctor-patient relationship (appointment/treatment with own doctorId), not whole branch
- AI state badges (AI Active / memahami mesej… / Human Handoff + Assigned To), sender labels, `waHandoffChat`/`waReturnToAIChat` UI

**Design decision:** Human manual reply = channel-availability only. Anti-Ban gates = automated sends (campaign + AI) only (D9/Part C). Fixed W-05/06/22/24 without weakening automated gates.

Docs: docs/M2-PHASE-3-COMPLETION.md. HTML md5 `09eb1552abbda7bbfbb191ebe524296a` (byte-identical).

**🔒 M2 WHATSAPP HUB = COMPLETE / LOCKED.** STOP — no P9/Backend/Production without explicit approval.

## Targeted UI Fix (🔒 LOCKED, 936/936)

3 existing interactive-looking elements made functional — reuses EXISTING functions/routes only, no architecture/domain/store change:

1. **Header AI button** → `openAiManager()` → `showPage('ai')` (existing AI Manager: Agents/Capabilities/Knowledge/Automations/Guardrails/Approvals/Audit). Role-gated via `canAccessPage` (HQ+BM; receptionist/doctor blocked gracefully).
2. **Notification bell (15)** → `openNotificationCentre()` → derived READ surface (Recall / Finance Radar overdue / WhatsApp escalation-handoff / AI approvals / doctor own-appointments), role-scoped, click → `uiFixGo(dest)` → existing route (`showPage`). No separate notification DB.
3. **Recall Due KPI (18)** → `openRecallDue()` → canonical audience via `p6FollowUpStatus` + role scope (BM branch / doctor own-patient relationship) → `uiFixOpenP360` (existing `openP360`) / `uiFixRecallCampaign` (existing `waCampaignWizard`, safety-gated).

Tests uiFix01-11. md5 `94203f36a1983c81d69e9136cdd93809` (byte-identical). M1/M2/Finance/Bukku unchanged.

## Final Interaction Hardening — Phase 1 Mandatory (🔒 LOCKED, 948/948)

Audit + fix semua state-changing + fake/misleading actions. KISS — connect to existing functions, no new domain/store/RBAC.

**Fixes:**
- **Schedule Payment (payable drawer)** — was `onclick="toast('Payment scheduled…')"` (fake). New `finSchedulePayable(id)` reuses same schedule logic (state→Scheduled + audit + scope guard) but re-opens `finOpenPayable` (bukan `finOpenExpense` — wrong record). Expense path `finSchedulePayment` unchanged.
- **Export PDF toast** — clarified: "PDF export is prototype-only (no file generated)" (sudah ada header label, toast kini jelas).
- Audit: 519+ onclick scanned — hanya 2 toast-only (kedua-duanya fixed). Semua state-changing buttons connect ke real functions.

**Role/scope enforcement verified (function-level, not just hiding):** finApprovePayable/finSchedulePayable guna `finCanSeeBranch`; cmApprove hq-only; cxGetPatient cross-branch null; doctor own-patient; WhatsApp channel BM scope.

Tests ui01-12. md5 `5750616b108224965a3218098b66aa32` (byte-identical). M1/M2 architecture unchanged. **Phase 2 NOT started — waiting approval.**

```text
M2 Fasa 1 — WhatsApp Hub Safety Foundation        : COMPLETE — GATE PASS
            (Anti-Ban Safety Engine: health gate (≥70), daily cap (50-100), sending window
             (9am-6pm), interval (60-180s), auto-pause (25 msg → 15 min), SAFE/CAREFUL presets;
             send_blocked audit (LOW_HEALTH, DAILY_CAP_REACHED, OUTSIDE_SENDING_WINDOW,
             RATE_LIMIT, AUTO_PAUSED, CHANNEL_UNAVAILABLE, PERMISSION_DENIED);
             Device Health Score 0-100: 🟢 Healthy (85+), 🟡 Ready (70-84), 🟠 Warming (40-69),
             🔴 Critical (<40); warming guidance for new numbers;
             Channel management: HQ all / BM own branch / Receptionist operational / Doctor none;
             role scope enforced service-level (waVisibleChannels, waCanManageChannel);
             channel bar shows health score per channel;
             879/879 PASS [868 baseline + 11 wah]; md5 91b0bca0… byte-identical)
```

**M2 Fasa 1 = LOCKED.** Next: M2 Fasa 2 — Drip Campaign + Spin Text + Campaign UX.

## Functional UI / Interaction Audit & Hardening (14 August 2026)

Global audit SEMUA 519 onclick interactive elements. Rule: "IF IT CAN BE CLICKED, IT MUST HAVE A CLEAR FUNCTION."

```text
Audit result: 519 onclick — 45 navigation, 41 detail/drill-down, 80 state-change,
18 filter/search, ~35 config, 10 FAKE toast-only (misleading).

Fake buttons fixed (no fake-success toast remains):
  1. Create Payable Now → finCreatePayableFromRecurring() — real payable creation +
     duplicate guard + audit + open new payable detail (fnx01-02)
  2. Pause → finPauseRecurring() — real status Active↔Paused toggle + audit (fnx03-04)
  3. Schedule Payment → finSchedulePayment() — real status → Scheduled + date + audit (fnx05)
  4. Export → finExportCalendar() — real CSV download + audit (fnx06)
  5. Upload → finUploadDocument() — real file input dialog (fnx07)
  6. AI Summarise → finAISummariseChat() — clearly labelled demo placeholder panel (fnx08)
  7. Task Open → finOpenTask() — proper detail drawer + Operations link (fnx09)
  8. KPI card → finOpenKpi() — navigate to relevant module (fnx10)
  9. Role scope: doctor blocked from other-branch payable (fnx11)

NO architecture change. NO new data store/domain. Role/branch scope preserved.
Tests: +11 fnx (interaction hardening). TOTAL 868/868 PASS (857 baseline + 11).
md5 9a6ee457… byte-identical. docs/FUNCTIONAL-UI-AUDIT-REPORT.md complete.
```

## Finance UX Fix (14 August 2026) — UI/UX ONLY, architecture unchanged

Global Finance workspace navigation + detail drill-down fix. "Content changes, context stays."

```text
Root causes fixed:
  1. finNav forced sc.scrollTo(0,0) on every intra-Finance nav → scroll reset
     FIX: removed forced scroll; finNav preserves scroll position
  2. Detail "flash popup": action handlers did finCloseDrawer(); finInit(); finOpenX(id)
     → close animates out (300ms) then reopen = visible flash + no Back stack
     FIX: finInitKeepScroll()/finViewRadarKeepScroll() re-render body in-place (preserve
     scroll, keep drawer open) + reopen same detail without close
  3. No nested drill-down: finDrawer had no history
     FIX: FIN_DRAWER_STACK + finDrawer(title,html,{replace:false}) pushes history,
     finDrawerBack() pops, ← Back button toggles; finCloseDrawer() resets stack

Modules audited (15): Dashboard, Radar, Revenue, Expenses, Payables, Cash Flow,
Branch, Recurring, Alerts, Reports, Config, Treatment Costs, Bukku, Sync, Reconciliation.
Handlers fixed: invoice payment, commission approve, payable approve/pay, lab payment,
radar markPaid/defer/reschedule. finDrawerRefresh() = in-place content swap (no flash).
Event bubbling: drawer overlay backdrop click closes intentionally; content clicks do NOT
bubble to close (verified). Role scope preserved (doctor blocked from other-branch detail).

NO architecture change: MEDINI_ARCHITECTURE / ownership / IDs / P360 / payment /
Radar rules / Bukku / WhatsApp readiness semua kekal. No new data store/domain.
Tests: +18 fin-ux (scroll, persistent detail, nested drill-down, back/close, filter,
role scope, Bukku). TOTAL 857/857 PASS (839 baseline + 18). md5 eff1a980… byte-identical.
```

## Supporting Architecture Docs (14 August 2026)

- `docs/BUKKU-MEDINI-BIDIRECTIONAL-SYNC-ARCHITECTURE.md` — bidirectional sync design (24 sections, DESIGN ONLY; hybrid polling-primary, webhook UNVERIFIED; per-field source-of-truth; idempotency + loop prevention; conflict → HQ review)
- `docs/MEDINI-FINANCE-BUKKU-SCOPE.md` — Finance ↔ Bukku boundary (486 lines; CRM-relevant vs Bukku-only classification; configurable tracker model; final scope table)
- `docs/MEDINI-FINANCIAL-RADAR.md` — Financial Radar implementation reference

## Domain 3 — Current Status Detail

```text
D3.1 — Foundation & Evidence (Sections 1–9)                 : LOCKED
D3.2 — Clinical Core (Sections 10–18)                       : LOCKED
D3.3 — Support Modules + Integration + Governance (19–50)   : LOCKED
Architecture document (2,898 lines)                         : COMPLETE / LOCKED
Single HTML full UX prototype (D3-P2)                       : COMPLETE
  - Clinical workspace (KPI strip, queue, pending work, search, scenario switcher)
  - Encounter workspace (drawer + pre-close checklist)
  - Interactive FDI tooth chart + tooth detail (surfaces, history, imaging)
  - Treatment plan detail + multi-session progression
  - Consent + consent templates UI
  - Documents + attachments + imaging + prescriptions
  - Outcome + adverse event + referral + follow-up + recall
  - Clinical timeline + audit trail
  - Patient 360 clinical integration
  - Safety enforcement (severe allergy block + acknowledge)
  - Consent blocking (plan activation gated)
Single HTML validation                                     : 248/248 PASS (197 + D3-01..D3-50)
Screenshots                                                : 20 (d3-*.png in app/smoke-shots/)
Next phase                                                  : Production backend / other domains (Finance, Insurance)
```

## Marketing Management v1.0 — Current Status Detail

```text
Marketing Architecture (MARKETING-ARCHITECTURE.md)      : COMPLETE (KISS v1.0)
Marketing UX (3 modules: Audience/Campaigns/Recall)     : COMPLETE
Marketing Prototype (Single HTML, additive)             : COMPLETE — 363/363 PASS
  - Dashboard (Due/Overdue/Inactive/Follow-ups/Active Campaigns KPIs — all clickable)
  - Audience (All/Leads/Due/Overdue/Inactive/Custom Segment + validation summary)
  - Leads (simple capture, statuses, convert→patient link, book appointment→Appointment Mgmt)
  - Campaigns (6-step wizard: audience→message→personalize→schedule→review→send via Comm Hub)
  - Templates (CRUD, merge fields, validation, archive not delete)
  - Recall & Follow-up (recall dashboard, due/overdue/inactive, follow-ups, recall rules config)
  - Recall rules + inactive threshold configurable (formula locked, params editable)
  - Opt-out/duplicate/invalid exclusion (validation engine, cannot bypass)
  - Communication Hub boundary simulation (queue→safety→device→send; no ban-bypass)
  - Branch RBAC (HQ all / branch own / unauthorized blocked at state layer)
  - Audit + historical protection
Production Backend                                       : NOT implemented (Single HTML is the visual specification)
```

## Finance & Billing v1.1 — Current Status Detail

## Canonical Branch Count

```text
14
```

Never use 15 as the branch count. Canonical 14 = 10 Medini Dental Clinics + 4 affiliated clinics (Norfaizah, Pearl, UDA, Meor Ahmad). Seed, selector, subtitle, Login — semuanya 14.

## Current Source of Truth

```text
app/
```

Tiada lagi HTML preview sebagai rujukan. React app dalam `app/` ialah satu-satunya kebenaran implementasi.

## Current Security Status

```text
Attack tests (server-side) : 17/17 PASS
Vitest regression          : 25/25 PASS (19 Phase 3.1 + 6 Phase 4 intelligence isolation)
TypeScript                 : 0 errors
Production build           : PASS
UI smoke (4 roles)         : 54/54 PASS
Branch context smoke       : 6/6 PASS
Single HTML validation     : 248/248 PASS (V9-based CURRENT-MEDINI-REVIEW.html; V9 QA 83/83; Phase 5/5.1 + Phase 6 D1–D12 + Phase 6.1 R1–R10 + Phase 6.2 A1–A20 + Phase 6.3 NP1–NP30 + Phase 2 AP1–AP42 + Phase 7 E1–E8 + V1–V11 + responsive 4 viewports + Domain 3 D3-01–D3-50)
```

### Isolation guarantees (server-enforced, not UI-hidden)

```text
Receptionist financial data : BLOCKED (7 keys stripped server-side)
Doctor financial data       : BLOCKED
Manager cross-branch        : BLOCKED (scopeBranch override)
Doctor cross-doctor         : BLOCKED (server forces doctorId=self)
HQ legitimate access        : WORKING
Manager scoped access       : WORKING
```

## Current Architecture Rule

Dashboard first. Full production backend/database/API/integrations come AFTER Dashboard Phase 1–7 are completed and rationalized. Domain 3 architecture is now defined and ready for prototype validation in the Single HTML artifact.

## Future Phase Policy

Each phase must build on the immediately preceding canonical state. Never start a phase from an old preview.

```text
CURRENT STATE → AUDIT → IMPLEMENT → TEST → FIX → VERIFY → LOCK → UPDATE CURRENT-STATE → NEXT PHASE
```

## Key File Map

```text
app/
├── api/
│   ├── auth.ts              ← RBAC core: permissionMatrix, scopeBranch, stripFinancialFields
│   ├── phase31.test.ts      ← 25 regression tests (Vitest)
│   ├── routers/             ← 12 tRPC routers (incl. intelligence.ts — Phase 4)
│   └── queries/connection.ts← SQLite + Drizzle (MEDINI_DB override for tests)
├── src/
│   ├── App.tsx              ← routes + roleGuard
│   ├── components/layout/AppLayout.tsx  ← shell + navByRole + branch selector
│   ├── hooks/               ← useAuth, useBranch (global context)
│   └── pages/               ← 16 pages (Dashboard incl. 3 role workspaces)
├── db/schema.ts + seed.ts   ← 14 branches canonical seed
├── smoke-ui.mjs             ← 54-check 4-role UI smoke (headless Chrome)
├── smoke-branch.mjs         ← 6-check branch context smoke
├── smoke-review.mjs         ← 30-check current-review journey validator
├── reviews/
│   └── CURRENT-MEDINI-REVIEW.html  ← THE ONE current review build (V9-based)
└── vitest.config.ts
```

## Domain 3 Documents

```text
docs/DOMAIN-3-CLINICAL-TREATMENT-ARCHITECTURE.md   ← THE Domain 3 architecture (2,898 lines)
docs/DOMAIN-3-LOCKED.md                            ← Domain 3 lock declaration + full UX prototype results
reports/DR-PARTNER-MEDINI-GAP-ANALYSIS.md/.pdf     ← Dr Partner external system study (evidence)
```

## Demo Logins (seed)

| Role | Username | Password |
|---|---|---|
| HQ | `hq` | `medini123` |
| Branch Manager | `manager` | `medini123` |
| Receptionist | `reception` | `medini123` |
| Doctor | `doctor` | `medini123` |

## Commands

```bash
npm run dev      # dev server (Vite + Hono/tRPC) :3000
npx tsc -b       # typecheck — must stay 0 errors
npm run build    # production build → dist/
npx vitest run   # regression suite — must stay 19/19
node smoke-ui.mjs     # 4-role UI smoke (needs dev server on :3001)
node smoke-branch.mjs # branch context smoke
```
