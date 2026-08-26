# CROSS-DOMAIN ARCHITECTURE CONSOLIDATION (P8)

**Status:** LOCKED · **Phase:** Blueprint Lock Program — Phase 8 (Group E: Enterprise)
**Date:** 14 August 2026 · **Author:** Neo (Senior Architect)
**Baseline:** P1-P7 LOCKED (723/723 PASS) + Consolidation 7/7 + WAHA Connection Flow

---

## 1. TUJUAN

Sahkan semua 13 domain dalam MediniOne seiring:
- Ownership jelas (setiap data/process ada SATU pemilik)
- Cross-domain dependencies konsisten (takde clash)
- Tiada circular ownership
- Events produced/consumed padan
- Semua contract document ikut 25-gate standard

Ini gate sebelum P9 (Final QA) — selepas ini blueprint boleh declare 100%.

---

## 2. DOMAIN OWNERSHIP MATRIX (13 domain canonical)

| # | Domain | OWNS (source of truth) | NOT owner | Status |
|---|---|---|---|---|
| 1 | Dashboard | Role context, KPI aggregation view | — | ✅ Phase 1-7 |
| 2 | Patients | Patient 360, family, referral, shared contact | Clinical data | ✅ Locked |
| 3 | Appointments | Booking, lifecycle, conflict, recall link | Patient master | ✅ Locked |
| 4 | Clinical | FDI chart, treatment plan, consent, timeline | Documents storage | ✅ Locked |
| 5 | X-Ray & Documents | Document/imaging registry (HOLD) | — | ⏸️ P3 hold |
| 6 | Finance | Treatment cost, lab payable, commission, invoice, Bukku | Payment gateway | ✅ 6/6 |
| 7 | Reports & Analytics | KPI definitions (canonical registry) | Raw facts (baca je) | ✅ P7 |
| 8 | Marketing | Audience, campaigns, recall, follow-up, config | WhatsApp delivery | ✅ Locked |
| 9 | Operations | Doctor live status, checklist, tasks, incidents, lab coordination | Stock (buang) | ✅ P4 |
| 10 | WhatsApp Hub | Conversations, messages, channels, assignment, SLA | Campaign intent | ✅ P5 + WAHA flow |
| 11 | AI Manager | Agents, capabilities, knowledge, automations, guardrails, approvals, audit | Operational chat | ✅ P6 |
| 12 | Administration | Organization, branch, staff, roles, permissions | Business data | ✅ P1 |
| 13 | Settings | Config hierarchy, secrets boundary, integration creds | Operational data | ✅ P2 |

---

## 3. EVENT CONTRACTS (produced → consumed)

### Produced by domain → Consumed by
```
Dashboard     → dashboard.*            → (consume semua)
Patients      → patient.*              → Appointments, Clinical, Marketing, WhatsApp, Finance
Appointments  → appointment.booked     → WhatsApp (confirmation), AI Manager (Booking AI), Marketing (recall)
              → appointment.status_changed → Reports
Clinical      → clinical.treatment_completed → Finance (cost link), Reports
Finance       → finance.invoice_created → Reports, AI Manager (Finance AI)
              → invoice.overdue        → AI Manager (reminder trigger), Operations (alert)
Marketing     → marketing.campaign_approved → WhatsApp Hub (delivery)
              → marketing.campaign_completed → Reports
WhatsApp Hub  → wa.message_received    → AI Manager (automation trigger)
              → wa.conversation_*      → Reports (volume/SLA)
Operations    → ops.incident_*         → Dashboard (attention)
AI Manager    → ai.decision_made       → WhatsApp Hub (execute), Marketing
Reports       → report.*               → (consume semua facts)
Administration → staff.deactivated      → WhatsApp Hub (reassign), AI Manager
Settings      → settings.config_updated → WhatsApp Hub (AI autoreply flag), Marketing, AI Manager
```

### Circular check (A→B dan B→A dalam ownership)
```
❌ TAKDE circular ownership:
- Marketing owns campaign intent; WhatsApp Hub owns delivery — Marketing TIDAK own transport
- WhatsApp Hub owns messages; AI Manager owns decisions — Hub TIDAK configure AI
- Reports owns KPI definitions; Finance owns revenue facts — Reports TIDAK compute revenue
- Settings owns config; semua domain consume — tiada domain own Settings back
```

---

## 4. CROSS-DOMAIN DEPENDENCY MAP (verified)

```
┌─────────────┐     campaign_approved      ┌──────────────────┐
│  MARKETING  │ ──────────────────────────▶ │  WHATSAPP HUB   │
│ (intent)    │ ◀── wa.campaign_sent/deliv  │ (delivery)      │
└──────┬──────┘                             └────────┬─────────┘
       │                                            │ wa.message_received
       ▼                                            ▼
┌─────────────┐     ai.reply_decided        ┌──────────────────┐
│  AI MANAGER │ ◀────────────────────────── │  WHATSAPP HUB   │
│ (governance)│ ── ai.decision → execute ─▶ │  (experience)   │
└──────┬──────┘                             └──────────────────┘
       │
       ├──▶ Marketing AI (draft-only) ──▶ Marketing
       ├──▶ Clinical AI (draft-only) ──▶ Clinical
       ├──▶ Insights AI (read-only) ──▶ Reports
       └──▶ Finance AI (reminder) ──▶ Finance
```

**Prinsip teras (dari Consolidation 7/7):**
1. AI EXPERIENCE dalam domain; AI GOVERNANCE dalam AI Manager
2. Marketing owns intent; WhatsApp Hub owns delivery
3. Reports = READ layer; KPI definitions canonical
4. Settings = config; secrets NEVER in frontend

---

## 5. DATA SCOPE / RBAC CONSISTENCY

| Domain | HQ | Manager | Receptionist | Doctor |
|---|---|---|---|---|
| Dashboard | all | branch | branch | branch |
| Patients | all | branch | branch | branch |
| Appointments | all | branch | branch | branch |
| Clinical | all | branch | branch | branch (own) |
| Finance | all | branch | view | view |
| Reports | all | branch | ❌ | ❌ |
| Marketing | all | branch | limited | ❌ |
| Operations | all | branch | view+tasks | view |
| WhatsApp Hub | all | branch | reply | ❌ |
| AI Manager | ✅ | view | ❌ | ❌ |
| Administration | ✅ | ❌ | ❌ | ❌ |
| Settings | ✅ | branch override | ❌ | ❌ |

Semua selaras dengan permissionMatrix (`app/api/auth.ts` + prototype).

---

## 6. STATE MODEL CONSISTENCY

| Domain state | Pattern | Verified |
|---|---|---|
| ADM, SETTINGS, OPS, WAH, AIM, MKT, BUKKU, VIRTUAL_BUKKU, D3State | const object + audit array + seq | ✅ |
| waChats[] array-index | Backward compat (documented canonical: conversationId) | ✅ |
| RPT_KPIS | Canonical registry (source domain per KPI) | ✅ |
| Branch scope | `getScopedChats`, `mktSc`, `opsScope`, `finSc` — semua state-layer | ✅ |
| Audit | setAudit, admAudit, opsAudit, wahAudit, aiAudit, mktAudit, finAudit | ✅ |

---

## 7. NAMING / TERMINOLOGY CONSISTENCY

| Term | Sebelum | Sekarang | Status |
|---|---|---|---|
| WhatsApp transport | Communication Hub | WhatsApp Hub | ✅ 0 leftover |
| Customer outreach | Marketing = siapa/kenapa/bila/mesej | ✅ |
| AI governance | AI Manager = control plane | ✅ |
| Treatment follow-up | "Scrubbing" (salah) | Marketing Recall & Follow-up | ✅ clarify |
| Stock/Maint/Sterilisation | Ops (dulu) | BUANG (client decision) | ✅ |

---

## 8. GATE CHECKLIST P8

- [x] 13 domain ownership matrix
- [x] Event contracts produced/consumed padan
- [x] Tiada circular ownership
- [x] RBAC konsisten semua domain
- [x] Branch scope konsisten
- [x] Naming/terminology konsisten
- [x] State model pattern konsisten
- [x] Semua domain punya ARCHITECTURE.md + LOCKED.md (kecuali X-Ray HOLD)
- [x] No new domain ditambah (canonical 13 kekal)

**GATE P8: PASS**

---

## 9. AMENDMENTS SELEPAS P8 (dependency-driven sahaja)

| # | Amendment | Domain | Sebab |
|---|---|---|---|
| 1 | WAHA Connection Flow (banner/QR/retention) | WhatsApp Hub | Dependency: Settings config → Hub channels |
| 2 | WAHA Integration card | Settings | Secrets boundary + 14-branch config |

Tiada locked domain di-reopen — kedua-dua amendment adalah extension dalam domain sedia ada.

---

## 10. READY UNTUK P9

Semua yang diperlukan untuk Final QA:
- 13 domain (11 locked + 1 hold + AI Manager P6 locked)
- Consolidation 7/7 complete
- WAHA connection flow complete
- 723/723 tests PASS
- docs/ lengkap

**NEXT: P9 — Enterprise Blueprint Final QA & Lock**
