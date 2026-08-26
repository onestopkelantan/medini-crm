# WHATSAPP HUB DOMAIN — ARCHITECTURE LOCK v1.0

**Status:** LOCKED · **Phase:** Blueprint Lock Program — Phase 5 (Group C: Communication & Intelligence)
**Date:** 13 August 2026 · **Author:** Neo (Senior Architect)
**Depends on:** P1 Administration, P2 Settings, P4 Operations (LOCKED)
**External system:** WAHA (WhatsApp HTTP API) — OpenAPI 136 endpoints studied & mapped

---

## 1. Business Purpose

WhatsApp Hub ialah **COMMUNICATION SYSTEM OF RECORD** untuk MediniOne.

Ia menjawab: **"Apa yang patient cakap, siapa yang balas (AI atau manusia), bila, dan apa tindakan seterusnya?"**

Domain ini memegang keseluruhan lifecycle komunikasi WhatsApp — dari mesej masuk, auto-reply AI, escalation ke manusia, assignment, SLA tracking, sampai audit. Marketing own campaign intent; AI Manager own decision logic; WhatsApp Hub own the actual conversation.

## 2. Domain Scope

**DALAM scope:**
- WhatsApp channel/number per branch (WAHA session)
- Conversation (thread per contact)
- Message (individual bubble: inbound/outbound/AI/human)
- Assignment (siapa handle conversation)
- SLA tracking (response time)
- Template (quick replies, WAHA template messages)
- Campaign handoff (Marketing → Hub untuk send)
- Escalation (AI → human)
- Conversation state (open/pending/resolved/archived)
- Audit semua komunikasi

**LUAR scope:**
- Campaign design/content — Marketing (locked)
- AI decision/prompt logic — AI Manager (Phase 6)
- Patient clinical data — Patients/Clinical (locked)
- Payment processing — Finance (locked)
- WAHA server deployment — production infrastructure (post Phase 9)

## 3. Domain Boundary (CRITICAL — ownership principle)

| Benda | Pemilik | BUKAN WhatsApp Hub sebab |
|---|---|---|
| Conversation thread, messages | **WhatsApp Hub** | — |
| Assignment, SLA, escalation | **WhatsApp Hub** | — |
| Template quick replies | **WhatsApp Hub** | — |
| Campaign intent, audience, content | Marketing | Hub hanya terima "send request" |
| AI reply decision/prompt | AI Manager | Hub execute apa AI decide |
| Patient record | Patients | Hub consume context sahaja |
| Appointment booking action | Appointments | Hub boleh trigger, tapi slot milik Appointments |

**Rule:** AI Manager must NOT own WhatsApp messages. Marketing must NOT own conversation history. WhatsApp Hub owns the actual communication lifecycle.

## 4. Responsibilities

1. Terima mesej masuk (webhook WAHA) dan create/update conversation
2. Hantar mesej keluar (human reply, AI reply, template, campaign)
3. Track conversation state dan SLA (first response time, resolution time)
4. Assign conversation ke staff (manual atau auto round-robin)
5. Escalation: AI tak boleh handle → flag human, notify assignee
6. Template management untuk quick replies
7. Campaign handoff: terima batch send request dari Marketing, queue, track delivery
8. Audit setiap mesej dan action
9. Link conversation ke Patient 360 (contact matching by phone)

## 5. Subdomains / Modules

| Module | Fungsi |
|---|---|
| Channel Manager | WAHA session per branch: connect, QR pairing, status monitor |
| Conversation Inbox | List, filter (unread/assigned/unassigned), search |
| Chat Workspace | Message thread, reply composer, AI suggestion, patient context panel |
| Assignment | Manual assign + auto-assign rules |
| Template Library | CRUD quick replies + WAHA templates |
| Campaign Queue | Batch send dari Marketing dengan delivery tracking |
| SLA Dashboard | Response time, resolution time, pending aging |
| Audit Trail | Semua mesej + action log |

## 6. Entities

| Entity | Medan utama |
|---|---|
| `WaChannel` | id, branchId, sessionName (WAHA), phone, status (WORKING/STOPPED/FAILED), qrCode, lastSeen |
| `WaConversation` | id, channelId, contactPhone (chatId), patientId (link), status (open/pending/resolved/archived), assignedTo, lastMessageAt, unreadCount, slaFirstResponseAt, slaResolvedAt, tag |
| `WaMessage` | id, conversationId, direction (in/out), senderType (patient/ai/human/system), body, mediaType, status (sent/delivered/read/failed), timestamp, wahaMessageId |
| `WaAssignment` | id, conversationId, staffId, assignedBy, assignedAt, unassignedAt |
| `WaTemplate` | id, branchId, name, body, category, usageCount |
| `WaCampaignSend` | id, campaignId (Marketing), conversationId, status, sentAt, deliveredAt, readAt, error |
| `WaAudit` | actor, action, detail, conversationId, timestamp |

**Existing dalam app/db/schema.ts:** `waConversations`, `waMessages` — 70% aligned, perlu extend (assignment, SLA, template, campaign send).

## 7. Entity Relationships

```
Branch (1) ──< (n) WaChannel
WaChannel (1) ──< (n) WaConversation
WaConversation (1) ──< (n) WaMessage
WaConversation (1) ──< (n) WaAssignment
WaConversation (n) ──> (0..1) Patient  (by phone match)
Campaign (Marketing) (1) ──< (n) WaCampaignSend ──> (1) WaConversation
Staff (Administration) (1) ──< (n) WaAssignment
```

## 8. State Machines / Lifecycles

### Channel
```
STOPPED → STARTING → WORKING → FAILED → (restart) STARTING
                    ↘ NEED_QR → (scan) WORKING
```

### Conversation
```
NEW (mesej masuk, unassigned) → OPEN (assigned/active) → PENDING (wait patient) → RESOLVED → ARCHIVED
NEW → AI_HANDLED (auto-reply success, no human needed) → RESOLVED
OPEN → ESCALATED (AI fail / patient request human) → OPEN (human take over)
```

### Message
```
QUEUED → SENT → DELIVERED → READ
QUEUED → FAILED (retry → SENT / DEAD)
```

### Campaign Send
```
QUEUED → SENDING → SENT → DELIVERED → READ
              ↘ FAILED → RETRY (max 3) → DEAD
```

## 9. Business Rules

1. Satu branch = satu WAHA session = satu nombor WhatsApp rasmi.
2. Contact auto-link ke Patient by phone; kalau takde match → conversation jenis "Unknown" (boleh convert ke patient).
3. AI auto-reply hanya bila Settings toggle `ai_autoreply` ON **dan** conversation belum ada human assignee.
4. Bila human reply dalam conversation, AI auto-reply PAUSE untuk conversation itu (human-in-control).
5. Escalation trigger: AI confidence rendah, patient minta "human/cik/staff", atau mesej berkaitan clinical/finance sensitif.
6. SLA: first response < 5 minit (working hour); aging > 30 minit unassigned → alert branch manager.
7. Campaign send: hormat rate limit (bukan blast); track per-message delivery.
8. Mesej TIDAK boleh delete (kecuali WAHA delete untuk semua orang, dalam masa dibenarkan) — audit kekal.
9. Template mesti lulus sebelum guna untuk campaign (Meta policy compliance note).
10. Semua outbound mesej kepada patient mesti ada opt-out marker untuk campaign (Marketing rule, locked).

## 10. RBAC / Permission Model

Ikut permissionMatrix (locked) — module `whatsapp`:

| Action | HQ | Manager | Receptionist | Doctor |
|---|---|---|---|---|
| View conversations | ✅ all | ✅ own branch | ✅ own branch | ❌ |
| Reply message | ✅ | ✅ | ✅ | ❌ |
| Assign/unassign | ✅ | ✅ own branch | ❌ | ❌ |
| Manage templates | ✅ | ✅ own branch | ❌ | ❌ |
| Campaign send (execute) | ✅ | ❌ | ❌ | ❌ |
| Channel connect/restart | ✅ | ❌ | ❌ | ❌ |
| Export | ✅ | ❌ | ❌ | ❌ |

## 11. Branch / Data Scope

- HQ: semua channel, semua conversation
- Manager: own branch conversations + assignment
- Receptionist: own branch — view + reply
- Doctor: TIADA akses WhatsApp Hub (clinical via own workspace)
- Unknown contact: visible dalam branch channel sahaja

## 12. Cross-Domain Dependencies

| WhatsApp Hub perlukan | WhatsApp Hub berikan |
|---|---|
| Administration: staff untuk assignment, RBAC | Patient 360: conversation context tab |
| Patients: contact matching by phone | Marketing: campaign delivery status |
| Marketing: campaign send request | AI Manager: conversation untuk decision |
| AI Manager: reply decision/draft | Operations: alert bila SLA breach |
| Settings: notification toggles, AI autoreply flag | Reports: message volume, SLA metrics |
| WAHA: session + message transport | Appointments: booking intent (link trigger) |

## 13. Events Produced

- `wa.message_received`, `wa.message_sent`, `wa.message_delivered`, `wa.message_read`, `wa.message_failed`
- `wa.conversation_opened/assigned/resolved/archived`
- `wa.escalated` (AI → human)
- `wa.sla_breach`
- `wa.campaign_sent/delivered/read/failed`
- `wa.channel_connected/disconnected/need_qr`

## 14. Events Consumed

- `marketing.campaign_approved` → queue campaign sends
- `ai.reply_decided` → send AI message
- `appointment.booked` → confirmation template auto-send
- `staff.deactivated` → reassign their open conversations
- `settings.config_updated` (ai_autoreply off) → pause AI reply

## 15. Actions / Commands

| Command | Actor | Gate |
|---|---|---|
| Connect channel (QR) | HQ | WAHA session create + QR display |
| Reply message | HQ/Manager/Receptionist | Branch scope |
| Assign conversation | HQ/Manager | Staff active check |
| Resolve conversation | Assigned staff / Manager | Audit |
| Create/edit template | HQ/Manager | Branch scope |
| Execute campaign send | HQ only | Marketing approved + rate limit |
| Escalate to human | AI (auto) / staff (manual) | Notify assignee |
| Mark read | Any viewer | — |

## 16. Audit Requirements

Setiap: mesej masuk/keluar (body hash + metadata), assignment change, resolve, escalation, campaign send, channel event, template change.
Audit immutable. Body mesej disimpan untuk compliance; production = retention policy (Settings).

## 17. Notification Requirements

- Mesej masuk (unassigned) → branch notification (ikut Settings toggle)
- SLA breach → manager alert
- Escalation → assignee immediate notify
- Channel disconnected → HQ alert

## 18. Search Requirements

- Conversation search: name, phone, tag
- Message search: text dalam thread
- Filter: unread, assigned-to-me, unassigned, resolved, by branch (HQ)

## 19. AI Interaction Boundaries

| AI boleh | AI TIDAK boleh |
|---|---|
| READ conversation (via AI Manager boundary) | Send tanpa decision record |
| DRAFT reply (AI Manager produce, Hub execute) | Assign conversation |
| EXECUTE auto-reply bila flag ON + no human assignee | Resolve/archive |
| Tag conversation (suggested) | Delete mesej |
| RECOMMEND template | Execute campaign send |

## 20. Reporting / Analytics Implications

Produce canonical facts:
- `message_volume` (in/out per branch/day)
- `first_response_time`, `resolution_time`
- `ai_handled_pct`, `escalation_rate`
- `campaign_delivery_rate`, `read_rate`
- `unassigned_aging`

Reports consume — tak kira sendiri. Marketing consume campaign metrics dari sini (bukan simpan sendiri).

## 21. UX / Workspace Architecture

Page: **WhatsApp Hub** (AI & Communication section). Layout 3-pane (dah ada dalam prototype):
1. **Left: Conversation list** — unread badge, assigned filter, search, status
2. **Center: Chat pane** — thread dengan sender badge (patient/AI/human), composer dengan AI-suggest button, template picker
3. **Right: Context panel** — patient link, next visit, balance, actions (View 360, Book Appointment)

Tambahan blueprint:
- **Channel status bar** (atas): branch session status + QR bila need pairing
- **Assignment control** dalam chat header
- **SLA indicator** (response time chip)
- **Template picker** dalam composer
- **Campaign Queue tab** (HQ): batch sends + delivery tracking
- **Templates tab**: CRUD

## 22. Prototype Implementation Requirements

Upgrade dari mock ke functional state engine:
- `WAH` state: channels, conversations, assignments, templates, campaignQueue, audit
- Reply functional → masuk thread sebagai human message + audit
- AI suggest button → draft muncul dalam composer (editable sebelum send)
- Assign/unassign functional
- Resolve/reopen conversation
- Template picker insert ke composer
- Escalation button + auto-escalate simulation (keyword "human"/"staff")
- SLA chip computed dari timestamps
- Campaign queue simulation (Marketing handoff mock)
- Channel status: simulated WAHA states (WORKING/NEED_QR) — real connect = production
- Branch scope enforced (dah ada `waVisibleIdx`, extend ke state engine)
- Patient link: phone match ke Patient 360

## 23. Smoke Test Requirements

W-01..W-25:
- Page renders 3-pane + channel status
- Conversation list scoped by branch
- Reply human → thread update + audit + unread clear
- AI suggest → draft editable → send jadi AI message
- Assign conversation → badge + audit
- Unassign → balik unassigned pool
- Resolve → status change + audit; reopen works
- Escalation trigger keyword "human" → flag + notify
- Template picker insert ke composer
- SLA chip kira betul
- Campaign queue render + simulated send + delivery status
- Channel NEED_QR → QR placeholder shown
- Patient context panel link ke 360
- Doctor tak boleh akses (RBAC)
- Receptionist boleh reply tak boleh assign
- Existing 609 tests kekal PASS
- Zero JS errors

## 24. Production Backend Implications

- Schema extend: `wa_channels`, `wa_conversations` (+assignment, SLA fields), `wa_messages` (+senderType, status), `wa_templates`, `wa_campaign_sends`, `wa_audit`
- WAHA integration: server-side client — session per branch (`branches.whatsapp_session` dah ada dalam schema!)
- Webhook endpoint: `/api/webhooks/waha` — verify HMAC, normalize events → conversation/message upsert
- Worker: SLA scanner, campaign queue processor (rate-limited), retry failed
- Real connect: Settings → Integrations akan pegang WAHA base URL + API key (masked)

## 25. Risks / Open Decisions

| Item | Status |
|---|---|
| WAHA engine choice (WEBJS/NOWEB/GOWS) | OPEN — decide masa production (GOWS recommended untuk stability) |
| Meta template approval untuk campaign | DOCUMENTED — compliance note; approval process external |
| Message retention period | OPEN — Settings config, decide Phase 8 |
| Voice message support | DEFER — v2 |
| WhatsApp Business API (official) migration path | DEFER — kalau WAHA tak stabil |
| Multi-number per branch | DEFER — v1 satu number satu branch |

---

## DOMAIN CONTRACT — WHATSAPP HUB

**OWNS:** WaChannel, WaConversation, WaMessage, WaAssignment, WaTemplate, WaCampaignSend, WaAudit.
**SOURCE OF TRUTH:** conversation + message registry (communication system of record).
**CONSUMES:** `marketing.campaign_approved`, `ai.reply_decided`, `appointment.booked`, `staff.deactivated`, `settings.config_updated`.
**PRODUCES:** `wa.message_*`, `wa.conversation_*`, `wa.escalated`, `wa.sla_breach`, `wa.campaign_*`, `wa.channel_*`.
**COMMANDS:** connect channel, reply, assign, resolve, template CRUD, campaign execute (HQ), escalate.
**AUDIT:** semua mesej + actions immutable.
**AI:** DRAFT + EXECUTE auto-reply (gated). AI Manager own decision; Hub own delivery.

## LOCK GATE CHECKLIST

- [x] 25 gates documented
- [x] Ownership principle enforced (Hub owns communication; Marketing owns intent; AI owns decision)
- [x] WAHA endpoint mapping sebenar (OpenAPI studied)
- [x] RBAC ikut matrix locked
- [x] Branch schema field `whatsapp_session` reused
- [x] Production path no-redesign

**LOCK GATE: PASS (architecture)** — prototype + smoke tests dalam sesi ini sebelum final LOCKED.
