# AI MANAGER DOMAIN — LOCKED

**Locked:** 13 August 2026 · **Blueprint Lock Program Phase 6 (Group C: Communication & Intelligence)**
**Authority:** docs/AI-MANAGER-ARCHITECTURE.md
**Master direction:** AI Manager = AI WORKFORCE CONTROL PLANE (governance). AI experience lives in domains.

---

## PHASE: 6 — AI Manager Domain Lock
## STATUS: ✅ LOCKED

## OBJECTIVES:
- Lock AI Manager sebagai AI Workforce Control Center (bukan feature cards)
- Lock AI EXPERIENCE vs AI GOVERNANCE separation
- Lock agent registry dengan domain ownership (no dual ownership)
- Lock capability matrix (READ/DRAFT/EXECUTE per domain)
- Lock knowledge, automations, guardrails, approvals, performance, audit
- Lock governance hooks: WhatsApp Hub AI Suggest + Marketing campaign send gated

## COMPLETED:
- [x] Architecture document (25 gates) — AI-MANAGER-ARCHITECTURE.md
- [x] Domain contract
- [x] AIM state engine (Part 5 consolidation): agents, capabilityMatrix, knowledge, automations, guardrails, approvals, log
- [x] 6 control-plane sections: Agents / Capabilities / Knowledge / Automations / Guardrails & Approvals / Performance & Audit
- [x] Agent registry (8 agents) with domain ownership
- [x] Agent detail drawer (capabilities + performance + guardrails)
- [x] Draft-only agents: Marketing AI, Clinical AI, Inventory AI, Insights AI
- [x] Guardrails: no medical advice (HARD_BLOCK), no PHI in prompts (HARD_BLOCK)
- [x] Approvals: AP-3 campaign send (HIGH, human), AP-4 clinical sign-off (doctor)
- [x] Governance hooks: waAiSuggest gated (agent + approval), mktSendCampaign gated (AP-3)
- [x] RBAC: doctor/receptionist blocked
- [x] Audit: toggle agent/automation → log; all decision status types (approved/escalated/auto/draft/pending_approval)

## ARCHITECTURE DECISIONS:
- AI experience kekal dalam domain; governance dalam AI Manager (tiada duplicate)
- Setiap agent SATU domain owner — tiada dual ownership
- Draft-only agents: manusia execute
- HARD_BLOCK guardrails di state layer — mustahil langgar
- Risk-based approval: LOW auto · MEDIUM auto reviewable · HIGH human wajib
- Campaign send + clinical sign-off = HIGH risk

## DOMAIN CONTRACT:
- OWNS: AiAgent, AiCapability, AiKnowledge, AiAutomation, AiGuardrail, AiApprovalRule, AiAuditLog
- CONSUMES: wa.message_received, marketing.campaign_created, appointment.booked, invoice.overdue, cron.daily
- PRODUCES: ai.agent_enabled/paused, ai.decision_made, ai.action_*, ai.escalated, ai.guardrail_violation_attempt
- COMMANDS: enable/pause agent, edit capability/knowledge/automation/guardrail/approval, view audit
- AUDIT: semua AI decisions + actions immutable

## TESTS:
- AI-01..AI-25: **25/25 PASS**
- Full suite: **685/685 PASS** (676 + 9 baharu: AI-16..AI-24)
- Zero JS errors

## RISKS:
- Model choice per agent — OPEN (production, Settings AI config)
- Agent RAG/vector store — DEFER production
- Human-in-loop approval UX — prototype toast/drawer; production approval queue
- Token budget guardrails — DEFER production

## LOCK GATE: ✅ PASS

## NEXT PHASE:
Phase 7 — Reports & Analytics Domain Lock (Group D: Analytics)
