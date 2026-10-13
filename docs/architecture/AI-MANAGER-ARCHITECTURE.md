# AI MANAGER DOMAIN — ARCHITECTURE LOCK v1.0

**Status:** LOCKED · **Phase:** Blueprint Lock Program — Phase 6 (Group C: Communication & Intelligence)
**Date:** 13 August 2026 · **Author:** Neo (Senior Architect)
**Depends on:** P1 Administration, P2 Settings, P4 Operations, P5 WhatsApp Hub (LOCKED), Consolidation Part 5-6
**Master direction:** AI Manager = AI WORKFORCE CONTROL PLANE (governance). AI experience lives in domains.

---

## 1. Business Purpose

AI Manager ialah **AI CONTROL PLANE / AI WORKFORCE CONTROL CENTER** untuk MediniOne.

Ia menjawab: **"Which AI agents exist? What can each do? What data can they access? When can they act? What is automatic vs needs human approval? What do they know? How are they performing? What did they do?"**

Bukan operational workspace — operational AI (AI Suggest dalam WhatsApp Hub, AI generate dalam Marketing) kekal dalam domain masing-masing. AI Manager GOVERN mereka.

## 2. Domain Scope

**DALAM scope:**
- Agent registry (what AI workers exist)
- Capability matrix (READ / DRAFT / EXECUTE per domain)
- Knowledge base (what each agent knows)
- Automations & triggers (event-driven / scheduled)
- Guardrails (hard rules — HARD_BLOCK / APPROVAL_REQUIRED)
- Approval rules (risk-based: AUTO vs human approval)
- Performance tracking (actions, success rate, escalations)
- AI audit trail (what agents did)

**LUAR scope:**
- WhatsApp message transport — WhatsApp Hub
- Campaign content/intent — Marketing
- Patient master data — Patients
- Treatment/clinical notes content — Clinical
- Money/invoices — Finance
- Real AI model calls — production backend (post Phase 9)

## 3. Domain Boundary (AI EXPERIENCE vs AI GOVERNANCE — CRITICAL)

| Benda | Lokasi | Sebab |
|---|---|---|
| AI Suggest button (reply draft) | **WhatsApp Hub** | Operational — receptionist guna tanpa buka AI Manager |
| AI message generation (campaign) | **Marketing** | Operational — marketing staff guna |
| AI auto-reply execution | **WhatsApp Hub** | Delivery milik Hub |
| Agent enable/pause | **AI Manager** | Governance |
| Capability permission | **AI Manager** | Governance |
| Knowledge base | **AI Manager** | Governance |
| Guardrails | **AI Manager** | Governance |
| Approval rules | **AI Manager** | Governance |
| Performance + audit | **AI Manager** | Governance |

**Rule:** AI Manager must NOT own WhatsApp messages / campaign content / patient data. Domains must NOT configure AI permissions themselves.

## 4. Responsibilities

1. Register semua AI workers (agents) dengan domain ownership
2. Enforce capability matrix — agent hanya boleh READ/DRAFT/EXECUTE dalam domain yang diberi
3. Manage knowledge base — apa agent boleh tahu
4. Define automations — bila agent activate (event/cron)
5. Define guardrails — apa agent TIDAK boleh buat (HARD_BLOCK)
6. Define approval rules — apa perlu manusia (risk-based)
7. Track performance — actions, success rate, escalation rate
8. Audit semua AI decisions & human overrides

## 5. Subdomains / Modules

| Module | Fungsi |
|---|---|
| Agents | Registry + enable/pause + detail (capabilities, performance, guardrails) |
| Capabilities | Per-agent READ/DRAFT/EXECUTE matrix per domain |
| Knowledge | Knowledge base per agent (static curated / dynamic from config) |
| Automations | Triggers: event-driven (webhook) + scheduled (cron) |
| Guardrails & Approvals | Hard rules + risk-based approval (AUTO / 👤 APPROVAL) |
| Performance & Audit | Actions, success rate, escalations, activity log |

## 6. Entities

| Entity | Medan utama |
|---|---|
| `AiAgent` | id, name, icon, domain (owner), enabled, actions, successRate, escalations, desc |
| `AiCapability` | agentId, domain, read[], draft[], execute[] |
| `AiKnowledge` | id, agentId, item, type (static/dynamic), updatedAt |
| `AiAutomation` | id, agentId, trigger, action, enabled |
| `AiGuardrail` | id, agentId ('All' for global), rule, level (HARD_BLOCK/APPROVAL_REQUIRED) |
| `AiApprovalRule` | id, agentId, action, risk (LOW/MEDIUM/HIGH), auto (bool), note |
| `AiAuditLog` | timestamp, agentId/actor, detail, status (auto/approved/escalated/draft/human) |

## 7. Entity Relationships

```
AiAgent (1) ──< (1) AiCapability
AiAgent (1) ──< (n) AiKnowledge
AiAgent (1) ──< (n) AiAutomation
AiAgent (1) ──< (n) AiGuardrail (atau 'All' global)
AiAgent (1) ──< (n) AiApprovalRule
AiAgent (1) ──< (n) AiAuditLog
Domain (WhatsApp Hub/Marketing/...) (1) ──< (n) AiAgent  [ownership]
```

## 8. State Machines / Lifecycles

### Agent
```
REGISTERED → ENABLED → (pause) PAUSED → (resume) ENABLED
           → (retire) ARCHIVED
```

### AI Action (per decision)
```
TRIGGER → GUARDRAIL CHECK → CAPABILITY CHECK → APPROVAL CHECK
       → (auto + low risk) EXECUTE → AUDIT
       → (approval required) DRAFT → HUMAN REVIEW → APPROVE/REJECT → EXECUTE/ABORT → AUDIT
       → (guardrail fail) BLOCKED → AUDIT + notify human
```

### Automation
```
DISABLED → ENABLED → (trigger fires) → execute automation flow → AUDIT
```

## 9. Business Rules

1. Setiap agent mesti ada SATU domain owner — tiada dual ownership.
2. Agent TIDAK boleh EXECUTE dalam domain yang bukan owner.
3. Marketing AI, Clinical AI, Inventory AI, Insights AI = **draft-only** — manusia execute.
4. Guardrail HARD_BLOCK = mustahil untuk agent langgar (block at state layer).
5. Approval rule: LOW risk → auto; MEDIUM → auto (reviewable); HIGH → human approval wajib.
6. Campaign send (AP-3) dan clinical sign-off (AP-4) = HIGH risk — manusia mesti approve.
7. AI TIDAK boleh bagi medical advice / diagnosis — HARD_BLOCK (GR-1).
8. AI TIDAK boleh hantar PHI ke external model prompts — HARD_BLOCK (GR-5).
9. Semua AI decision & action mesti masuk audit log — tiada silent action.
10. AI experience (Suggest button etc.) consume governance: kalau agent paused → blocked.

## 10. RBAC / Permission Model

Ikut permissionMatrix (locked) — module `ai`:

| Action | HQ | Manager | Receptionist | Doctor |
|---|---|---|---|---|
| View AI Manager | ✅ | ✅ | ❌ | ❌ |
| Enable/pause agent | ✅ | ❌ | ❌ | ❌ |
| Edit capabilities | ✅ | ❌ | ❌ | ❌ |
| Edit knowledge | ✅ | ❌ | ❌ | ❌ |
| Toggle automations | ✅ | ❌ | ❌ | ❌ |
| Edit guardrails/approvals | ✅ | ❌ | ❌ | ❌ |
| View audit | ✅ | ✅ own branch | ❌ | ❌ |

## 11. Branch / Data Scope

- Agent registry = GLOBAL (HQ) — AI workers serve all branches
- Performance metrics = global + per-branch (production)
- Audit = global; Manager boleh view own branch activity (production)
- Prototype: HQ-only control; Manager view-only

## 12. Cross-Domain Dependencies

| AI Manager perlukan | AI Manager berikan |
|---|---|
| Administration: staff/RBAC untuk human approval routing | WhatsApp Hub: governance decision (agent enabled? guardrail? approve?) |
| Settings: AI configuration toggles, knowledge sources | Marketing: governance (draft-only, campaign approval) |
| WhatsApp Hub: AI Suggest action context | Clinical: draft-only governance for scribe |
| Marketing: campaign AI generation context | Finance: reminder approval governance |
| Operations: Inventory AI context | Reports: Insights AI read-only governance |

## 13. Events Produced

- `ai.agent_enabled/paused`
- `ai.decision_made` (auto-approve/block/require-human)
- `ai.action_executed` / `ai.action_drafted` / `ai.action_blocked`
- `ai.escalated` (AI → human)
- `ai.guardrail_violation_attempt`

## 14. Events Consumed

- `wa.message_received` (automation trigger for AI Receptionist)
- `marketing.campaign_created` (trigger Marketing AI draft)
- `appointment.booked` (Booking AI opportunity)
- `invoice.overdue` (Finance AI reminder trigger)
- `cron.daily` (Recall AI, Insights AI schedules)

## 15. Actions / Commands

| Command | Actor | Gate |
|---|---|---|
| Enable/pause agent | HQ | RBAC ai module |
| Edit capability matrix | HQ | RBAC |
| Edit knowledge base | HQ | RBAC |
| Toggle automation | HQ | RBAC |
| Edit guardrails/approvals | HQ | RBAC |
| View performance/audit | HQ/Manager | RBAC |

## 16. Audit Requirements

Setiap: agent toggle, capability change, knowledge change, automation toggle, guardrail/approval change, AI decision (auto/blocked/drafted), human approval/rejection. Immutable. Production: retention via Settings.

## 17. Notification Requirements

- AI action blocked by guardrail → notify domain owner
- AI escalated → notify human assignee
- Agent failed (success rate drop) → HQ alert

## 18. Search Requirements

- Search agent by name/domain
- Filter audit by agent/status/date
- Filter automations by trigger type

## 19. AI Interaction Boundaries

| AI boleh | AI TIDAK boleh |
|---|---|
| READ data dalam domain yang diberi | Execute dalam domain bukan owner |
| DRAFT replies/messages/notes (editable) | Give medical advice |
| EXECUTE auto-reply (gated: enabled + approval) | Send PHI to external models |
| RECOMMEND templates/actions | Sign clinical notes |
| ESCALATE to human | Execute HIGH-risk actions tanpa approval |

## 20. Reporting / Analytics Implications

Produce canonical facts:
- `ai_agents_total`, `ai_agents_enabled`
- `ai_actions_week`, `ai_success_rate_avg`
- `ai_escalation_rate`, `ai_auto_handled_pct`
- `ai_blocked_actions`
Reports consume — tak kira sendiri. Insights AI read-only consume dari sini.

## 21. UX / Workspace Architecture

Page: **AI Manager** (AI & Communication section). Control plane layout:
1. Header: subtitle "AI workforce control center · governance & audit" + status pill
2. Section nav: 🤖 Agents · 🎯 Capabilities · 📚 Knowledge · ⚙️ Automations · 🛡️ Guardrails & Approvals · 📊 Performance & Audit
3. Agents view: KPI strip (total/active/actions) + agent cards (icon, toggle, domain, actions, success) + View Detail drawer
4. Agent detail drawer: status, domain, capabilities (read/draft/execute), performance grid, guardrails
5. Capabilities view: table matrix
6. Knowledge view: list static/dynamic
7. Automations view: trigger list + toggles
8. Guardrails view: two-column (guardrails + approvals)
9. Audit view: KPI strip + activity log

## 22. Prototype Implementation Requirements

Siap dalam Consolidation Part 5 (control plane functional):
- AIM state: agents, capabilityMatrix, knowledge, automations, guardrails, approvals, log
- aiNav section routing, aiViewAgents/Capabilities/Knowledge/Automations/Guardrails/Audit
- aiToggleAgent/aiToggleAutomation + aiAudit
- aiAgentDetail drawer (capabilities + performance + guardrails)
- Governance hooks: waAiSuggest gated (X-02/X-03), mktSendCampaign gated (AP-3)
- Semua butang functional

## 23. Smoke Test Requirements

AI-01..AI-25 (15 sedia ada dari Part 5 + 10 baharu):
- Page renders, 6 sections, nav renders
- Agent registry (8, domain ownership), Marketing AI draft-only, Clinical AI draft-only
- Semua view renders (capabilities, knowledge, automations, guardrails, audit)
- Guardrails: no-medical-advice HARD_BLOCK, PHI rule
- Approval: AP-3 HIGH non-auto, AP-4 doctor sign-off
- Agent toggle → audit log
- **BAHARU (P6):** enable/disable agent → status + audit, agent detail drawer contents, automation toggle, knowledge structure, guardrail levels, approval risk levels, branch RBAC (doctor/receptionist blocked), audit status types, zero JS errors

## 24. Production Backend Implications

- Schema: ai_agents, ai_capabilities, ai_knowledge, ai_automations, ai_guardrails, ai_approval_rules, ai_audit_log
- AI provider integration: server-side model calls (NOT browser)
- Policy engine: guardrail/approval evaluation service (shared by WhatsApp Hub, Marketing, etc.)
- Audit: immutable log + retention
- RBAC: server-side enforcement
- Real agents: model config per agent (prompt, model, temperature) — Settings → AI configuration

## 25. Risks / Open Decisions

| Item | Status |
|---|---|
| Model choice per agent | OPEN — production (Settings AI config) |
| Agent RAG/knowledge vector store | DEFER — production |
| Multi-agent orchestration | DEFER — v2 |
| Human-in-loop UX for approvals | OPEN — prototype: toast + drawer; production: approval queue |
| Cost guardrails (token budget) | DEFER — production |

---

## DOMAIN CONTRACT — AI MANAGER

**OWNS:** AiAgent, AiCapability, AiKnowledge, AiAutomation, AiGuardrail, AiApprovalRule, AiAuditLog.
**SOURCE OF TRUTH:** AI workforce governance + audit.
**CONSUMES:** `wa.message_received`, `marketing.campaign_created`, `appointment.booked`, `invoice.overdue`, `cron.daily`.
**PRODUCES:** `ai.agent_enabled/paused`, `ai.decision_made`, `ai.action_*`, `ai.escalated`, `ai.guardrail_violation_attempt`.
**COMMANDS:** enable/pause agent, edit capability/knowledge/automation/guardrail/approval, view audit.
**AUDIT:** semua AI decisions + actions immutable.
**AI:** AI Manager IS the governance layer. Agents execute in their domains under these rules.

## LOCK GATE CHECKLIST

- [x] 25 gates documented
- [x] AI EXPERIENCE vs AI GOVERNANCE separation enforced
- [x] Agent domain ownership (no dual ownership)
- [x] Draft-only agents (Marketing/Clinical/Inventory/Insights)
- [x] HARD_BLOCK guardrails (medical advice, PHI)
- [x] Risk-based approvals (HIGH = human)
- [x] Governance hooks in WhatsApp Hub + Marketing (verified X-02/X-03)
- [x] RBAC ikut matrix
- [x] Production path no-redesign

**LOCK GATE: PASS (architecture)** — prototype + smoke tests verified sebelum final LOCKED.
