# M2 WhatsApp Hub — Architecture & Implementation (Fasa 1 + Fasa 2)

**Status: FASA 1 🔒 LOCKED · FASA 2 🔒 LOCKED** (14 Ogos 2026)
**Tests: TOTAL 903 | PASS 903 | FAIL 0** · HTML md5 `93eb58ef3d5f54690cee03ec99c0016c`

> M1 Inter-Domain Architecture = LOCKED. M2 consumes M1 contracts (MEDINI_ARCHITECTURE, canonical IDs, role scope) tanpa redesign. Tiada duplicate patient/appointment store, tiada second permission system, tiada second event bus.

---

## Fasa 1 — Anti-Ban Safety Engine + Device Health Score (wah01-11)

### Safety Engine (`waSafetyCheck`)
Satu sahaja safety engine untuk SEMUA sends (campaign + AI reply). Gates berurutan:

| Order | Gate | Rule | Blocked Reason |
|---|---|---|---|
| 1 | Channel Availability | status ≠ WORKING | `CHANNEL_UNAVAILABLE` |
| 2 | Health Score | score < 70 | `LOW_HEALTH` |
| 3 | Daily Cap | sent hari ni ≥ cap (default 50) | `DAILY_CAP_REACHED` |
| 4 | Sending Window | luar 9:00–18:00 | `OUTSIDE_SENDING_WINDOW` |
| 5 | Interval / Cooldown | < 60–180s rawak sejak send lepas | `RATE_LIMIT` |
| 6 | Auto-Pause | setiap 25 mesej → pause 15 min | `AUTO_PAUSED` |

Preset: **Safe** (konservatif) / **Careful**. Config dari Settings (P2 hierarchy).

### Device Health Score (`waDeviceHealth`)
0–100 per fon/channel. 🟢 85+ Healthy · 🟡 70–84 Ready · 🟠 40–69 Warming · 🔴 <40 Critical.
Nombor baru → score rendah → "warm dulu" (2–4 minggu). Score ≥ 70 = ready send.
`WAH.sentLog` = audit setiap send; `WAH.blocked` = setiap block dengan reason + channelId + branchId + timestamp.

### Role Scope Channels
HQ = semua channels · BM = branch sendiri · Doctor = tiada channel management.

---

## Fasa 2A — Drip Campaign + Spin Text (wah27-35)

### Spin Text (`waSpinResolve`)
Syntax `{Hi|Hey|Salam} {name}` — variasi rawak setiap resolve.
- Validate syntax (spin tanpa tutup → error, bukan send tergantung)
- Preserve placeholders `{name}` `{date}` `{time}` `{branch}`
- **Never send unresolved**: `waCampSend()` validate sebelum queue; fail → toast error, tiada send
- Preview menunjukkan mesej resolved sebenar

### Drip Campaign (`WAH_DRIP_TYPES` + `waDripAudience` + `waDripCampaign`)
4 jenis, audience derive dari canonical (tiada duplicate store):

| Type | Offset | Source |
|---|---|---|
| `birthday` | yearly (dob) | `patients` |
| `appointment_reminder` | −3 hari | `cxAppointments()` |
| `post_visit` | +7 hari (completed) | `cxAppointments()` |
| `recall_due` | due date | recall logic sedia ada |

### Campaign Flow
Create → Audience (branch scope) → Template (spin) → Preview (resolved) → Schedule → **Safety Check (waSafetyCheck)** → Send Queue → Delivery Result → Audit (`WAH.sentLog`).

Campaign TOLAK send kalau gate block — audit `send_blocked` dengan reason + campaignId. Tak pernah tunjuk "Sent" bila blocked.

---

## Fasa 2B — Human-Like AI Response Engine (wah12-26)

### Conversation Queue (`WAH_CONV_QUEUE` + `waQueueState`)
Setiap incoming message → queue state machine:
`RECEIVED → BUFFERING → READY → PROCESSING → RESPONDED / WAITING / HANDOFF / CLOSED`

References per conversation: conversationId, patientId, branchId, assignedUserId, doctorId, messageId, receivedAt.

### FIFO Priority (D2)
Multiple conversations → process ikut arrival order (`receivedAt` + queue sequence). Default priority = FIFO; human handoff/escalation boleh override (by existing architecture).

### 15–20s Response Buffer + Batching (D3-D5)
- Incoming → **BUFFERING** (bukan reply serta-merta)
- Buffer window configurable 15000–20000ms (default)
- Mesej baru semasa buffering → **timer reset/extend** (batch kumpul, bukan jawab satu-satu)
- Contoh: "Hi" → 5s → "Nak tanya harga" → 7s → "Untuk braces" = **SATU batch 3 mesej** → SATU response koheren
- Buffer habis (quiet) → batch → context → AI response

### Conversation Lock (D6-D7)
Satu processing cycle per conversation pada satu masa. `conv.lock` — duplicate call return `{ processed: false, reason: 'locked' }`. Prevent double reply / race. **One batch → one AI response.**

### AI Context (D10) + Safety (D9)
`waBuildAIContext()` = batched messages + conversation history + patient/appointment/treatment context (canonical, role-scoped). Response → `waSafetyCheck` (sama engine Fasa 1) → blocked → queue tunggu + `send_blocked` audit. AI **TIDAK** boleh bypass gates.

### Human Handoff (D12)
`waHumanHandoff(convId)` → state `HANDOFF` → AI auto-reply STOP. `waReturnToAI()` untuk resume. Context: assignedUserId, lastMessageAt, unreadCount.

### Role Scope Conversations (D11)
`waVisibleConversations()`: HQ = global · BM/Receptionist = branch sendiri · Doctor = patient-context-only (tiada global inbox, tiada unrelated patients).

---

## Separation: Campaign vs AI Reply (D15)

| | Campaign | AI Reply |
|---|---|---|
| Trigger | Marketing intent | Incoming message |
| Flow | audience → template → schedule | queue → buffer → batch |
| Template | Spin text + preview | Context build + generate |
| Safety | waSafetyCheck (sama) | waSafetyCheck (sama) |

Dua workflow berasingan, SATU safety engine.

---

## Cross-Domain Integration (D16)
Canonical refs sahaja: patientId (MRN), branchId, appointmentId (APT-*), doctorId (dr-*), conversationId, assignedUserId. Patient ↔ WhatsApp ↔ Appointment ↔ Treatment ↔ Marketing ↔ Branch ↔ AI ↔ Handoff. Tiada duplicate master data.

## Backend-Ready Design (D20)
Frontend prototype sahaja. Architecture support future: persistent buffer state, distributed lock (conv.lock), idempotency (messageId dedupe), retry (state WAITING), delivery status (sentLog).

## Terminology (D21)
Guna "Safety Engine", "Human-like pacing", "Controlled sending", "Rate protection", "Risk reduction". BUKAN "ban-proof" / "guaranteed anti-ban".

---

## Test Inventory

| Block | Tests | Coverage |
|---|---|---|
| wah01-11 | Fasa 1 | Health score, gates, blocked audit, channel role scope |
| wah12-26 | Fasa 2B | Queue states, FIFO, buffer reset, batching, lock, one-batch-one-response, AI safety bypass, handoff, role scope |
| wah27-35 | Fasa 2A | Spin resolve/preview/unresolved-block, 4 drip audiences, campaign safety block, wizard exists |

**TOTAL 903 | PASS 903 | FAIL 0** — M1 regression (868) kekal hijau, M2 Fasa 1 (11) kekal hijau.
