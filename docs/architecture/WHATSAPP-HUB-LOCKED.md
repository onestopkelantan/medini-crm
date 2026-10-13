# WHATSAPP HUB DOMAIN — LOCKED

**Locked:** 13 August 2026 · **Blueprint Lock Program Phase 5 (Group C: Communication & Intelligence)**
**Authority:** docs/WHATSAPP-HUB-ARCHITECTURE.md
**External system:** WAHA (WhatsApp HTTP API) — 136 endpoints studied & mapped

---

## PHASE: 5 — WhatsApp Hub Domain Lock
## STATUS: ✅ LOCKED

## OBJECTIVES:
- Lock WhatsApp Hub as COMMUNICATION SYSTEM OF RECORD
- Lock channel lifecycle (WAHA session per branch)
- Lock conversation lifecycle (open/pending/resolved/archived)
- Lock message lifecycle (queued → sent → delivered → read)
- Lock assignment, escalation, SLA, template, campaign handoff
- Lock ownership: Hub owns communication; Marketing owns intent; AI owns decision

## COMPLETED:
- [x] Architecture document (25 gates) — WHATSAPP-HUB-ARCHITECTURE.md
- [x] Domain contract
- [x] WAH state engine: channels, assignments, templates, campaignQueue, audit, resolved
- [x] Channel status bar (WORKING/NEED_QR)
- [x] Conversation list scoped by branch
- [x] Human reply functional + audit
- [x] AI suggest inserts editable draft
- [x] Template picker with merge fields
- [x] Assign/unassign conversation + audit
- [x] Resolve/reopen conversation + audit
- [x] Escalation + audit
- [x] Template Library drawer
- [x] Campaign Queue drawer (HQ only)
- [x] Patient context panel + View 360 link
- [x] Branch scope enforced
- [x] RBAC: doctor blocked from assign/campaign

## ARCHITECTURE DECISIONS:
- WAHA session per branch; real connect = production (post Phase 9)
- AI auto-reply only when Settings toggle ON + no human assignee
- Human reply pauses AI for that conversation
- Escalation triggers: keyword, low confidence, sensitive topic
- Messages immutable (no delete); audit kekal
- Campaign send: HQ only, rate-limited, delivery tracked

## DOMAIN CONTRACT:
- OWNS: WaChannel, WaConversation, WaMessage, WaAssignment, WaTemplate, WaCampaignSend, WaAudit
- CONSUMES: marketing.campaign_approved, ai.reply_decided, appointment.booked, staff.deactivated, settings.config_updated
- PRODUCES: wa.message_*, wa.conversation_*, wa.escalated, wa.sla_breach, wa.campaign_*, wa.channel_*
- COMMANDS: connect channel, reply, assign, resolve, template CRUD, campaign execute (HQ), escalate
- AUDIT: semua mesej + actions immutable
- AI: DRAFT + EXECUTE auto-reply (gated); AI Manager own decision; Hub own delivery

## TESTS:
- W-01..W-25: **25/25 PASS** (focused + full suite)
- Full suite: **634/634 PASS** (609 + 25)
- Zero JS errors

## RISKS:
- WAHA engine choice (WEBJS/NOWEB/GOWS) — OPEN, decide production
- Meta template approval — external compliance
- Message retention period — OPEN, Settings config
- Voice message — DEFER v2
- WhatsApp Business API migration — DEFER kalau WAHA tak stabil

## LOCK GATE: ✅ PASS

## NEXT PHASE:
Phase 6 — AI Manager Domain Lock (Group C: Communication & Intelligence)
