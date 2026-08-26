# PART 2 — TARGET ARCHITECTURE
## Domain Consolidation + KISS Refactor

**Date:** 13 August 2026
**Based on:** PART 1 — Current State Audit
**Status:** TARGET — awaiting approval before implementation

---

## 1. MENTAL MODEL (Simple)

```
┌─────────────────────────────────────────────────────────────────┐
│                         MEDINI CRM                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   MARKETING          =  "Plan and execute outreach"            │
│                         Who to contact, why, when, what message │
│                                                                 │
│   WHATSAPP HUB       =  "Manage conversations"                  │
│                         Inbox, reply, assign, escalate          │
│                                                                 │
│   AI MANAGER         =  "Manage the AI workforce"               │
│                         Agents, rules, approvals, audit         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. DOMAIN OWNERSHIP (Clear Boundaries)

### MARKETING — Outreach Planning

**Owns:**
- Audience (who to contact)
- Campaigns (what message)
- Recall (periodic follow-up)
- Follow-up (one-off follow-up)
- Marketing configuration

**Does NOT own:**
- WhatsApp delivery (that's WhatsApp Hub)
- AI decision logic (that's AI Manager)
- Patient master data (that's Patients)

**Flow:**
```
Marketing creates campaign
    ↓
Marketing says: "Send to this audience, this message, this time"
    ↓
Handoff to WhatsApp Hub: "Please deliver these messages"
    ↓
WhatsApp Hub executes + reports back: "Delivered 45, Read 28, Failed 2"
    ↓
Marketing sees results
```

---

### WHATSAPP HUB — Communication Execution

**Owns:**
- Inbox (conversation list)
- Conversation (message thread)
- Channels (WAHA session status)
- Assignment (who handles this)
- Escalation (AI → human)
- Resolution (open/resolved)
- Quick replies (templates for conversation)

**Does NOT own:**
- Campaign intent (that's Marketing)
- AI decision (that's AI Manager)
- Patient clinical data (that's Patients/Clinical)

**Flow:**
```
Patient sends WhatsApp message
    ↓
WhatsApp Hub receives (via WAHA webhook)
    ↓
Create/update conversation
    ↓
AI Manager decides: "Can AI handle this?"
    ↓
If yes: WhatsApp Hub sends AI reply
If no: WhatsApp Hub assigns to human
    ↓
Human replies in WhatsApp Hub
    ↓
Resolve conversation
```

---

### AI MANAGER — AI Governance

**Owns:**
- Agent registry (what AI workers exist)
- Capabilities (what each agent can do)
- Knowledge base (what each agent knows)
- Guardrails (what each agent cannot do)
- Approval rules (what needs human approval)
- Performance tracking (how well agents perform)
- Audit trail (what agents did)

**Does NOT own:**
- WhatsApp messages (that's WhatsApp Hub)
- Campaign content (that's Marketing)
- Patient records (that's Patients)

**Flow:**
```
WhatsApp Hub receives message
    ↓
WhatsApp Hub asks AI Manager: "Can AI Receptionist handle this?"
    ↓
AI Manager checks:
  - Agent enabled? (capability)
  - Has knowledge? (knowledge base)
  - Allowed to auto-reply? (guardrail)
  - Needs human approval? (approval rule)
    ↓
AI Manager returns decision
    ↓
WhatsApp Hub executes (send reply or escalate to human)
    ↓
AI Manager logs the decision (audit)
```

---

## 3. PAGE STRUCTURE (Target)

### MARKETING Page

```
Marketing
├── Dashboard (KPIs: active campaigns, reach, conversion)
├── Audience (All / Leads / Due Recall / Overdue / Inactive / Custom)
├── Campaigns
│   ├── All Campaigns
│   ├── Create Campaign (wizard)
│   ├── Scheduled
│   ├── Running
│   ├── Completed
│   └── Templates (message templates)
├── Recall & Follow-up
│   ├── Recall Dashboard (due/overdue patients)
│   ├── Recall Rules (6-month checkup, braces adjustment, etc.)
│   └── Follow-ups (one-off follow-up tasks)
└── Configuration
    ├── Recall intervals
    ├── Thresholds
    └── Opt-out rules

REMOVED from Marketing:
- Campaign delivery queue → moved to WhatsApp Hub (execution)
- AI message generation → AI Manager governs, Marketing uses
```

---

### WHATSAPP HUB Page

```
WhatsApp Hub
├── Inbox (PRIMARY WORKSPACE)
│   ├── Conversation List
│   │   ├── Filter: All / Unread / Assigned to me / Unassigned
│   │   └── Search: name, phone
│   ├── Conversation
│   │   ├── Header: patient name, status, assignee
│   │   ├── Messages: thread with sender badge (patient/AI/human)
│   │   └── Composer: reply + AI Suggest + Template + Escalate
│   └── Patient Context
│       ├── Patient info (linked by phone)
│       ├── Next appointment
│       └── Actions: View 360, Book Appointment
├── Channels (simple view)
│   ├── Branch
│   ├── Phone number
│   ├── Status: Connected / Need QR
│   └── Last seen
└── Settings (minimal)
    ├── Quick reply templates
    └── Notification preferences

REMOVED from WhatsApp Hub:
- Campaign Queue → moved to Marketing (intent) + WhatsApp Hub (execution only)
- Template Library (campaign templates) → moved to Marketing
- AI governance → moved to AI Manager
- Channel session names → hidden (infrastructure detail)

KEPT in WhatsApp Hub:
- AI Suggest (operational AI)
- Quick reply templates (conversation templates, not campaign)
- Assignment/Escalation/Resolution
```

---

### AI MANAGER Page

```
AI Manager
├── Agents
│   ├── Agent list (cards)
│   ├── Agent detail (capabilities, knowledge, performance)
│   └── Enable/disable agent
├── Capabilities
│   ├── What each agent can do
│   ├── Read / Draft / Execute permissions
│   └── Domain access (WhatsApp, Marketing, Finance, etc.)
├── Knowledge
│   ├── Knowledge base per agent
│   ├── Clinic info, policies, pricing
│   └── FAQ, scripts
├── Automations / Triggers
│   ├── When agent activates
│   ├── Event triggers (new message, appointment booked, etc.)
│   └── Schedule triggers (daily digest, weekly report)
├── Guardrails & Approvals
│   ├── What agent cannot do
│   ├── What needs human approval
│   └── Risk levels
├── Performance & Audit
│   ├── Actions per agent
│   ├── Success rate
│   ├── Escalation rate
│   └── Activity log
└── Configuration
    ├── AI model settings
    └── Global AI toggles

NEW in AI Manager:
- Agent capability matrix (Read/Draft/Execute per domain)
- Knowledge base editor
- Guardrail rules
- Approval workflow
- Performance metrics
- Detailed audit log
```

---

## 4. CROSS-DOMAIN FLOWS (Target)

### Flow 1: Marketing Campaign → WhatsApp Delivery

```
┌─────────────┐
│  MARKETING  │
│             │
│ Create      │
│ Campaign    │
│ (audience,  │
│  message,   │
│  schedule)  │
└──────┬──────┘
       │
       │ "Send Request"
       ▼
┌─────────────────┐
│  WHATSAPP HUB   │
│                 │
│ Receives        │
│ campaign send   │
│ request         │
│                 │
│ Queues messages │
│ Sends via WAHA  │
│ Tracks delivery │
└──────┬──────────┘
       │
       │ "Delivery Report"
       ▼
┌─────────────┐
│  MARKETING  │
│             │
│ Sees:       │
│ Sent 45     │
│ Delivered 43│
│ Read 28     │
│ Failed 2    │
└─────────────┘
```

**Contract:** Marketing owns intent; WhatsApp Hub owns delivery. Marketing does NOT see WAHA session details. WhatsApp Hub does NOT see campaign content editing.

---

### Flow 2: WhatsApp Message → AI Decision

```
┌─────────────────┐
│  WHATSAPP HUB   │
│                 │
│ Patient sends   │
│ message         │
└──────┬──────────┘
       │
       │ "Can AI handle?"
       ▼
┌─────────────────┐
│  AI MANAGER     │
│                 │
│ Checks:         │
│ - Agent enabled?│
│ - Has knowledge?│
│ - Guardrail OK? │
│ - Auto-approve? │
└──────┬──────────┘
       │
       │ Decision
       ▼
┌─────────────────┐
│  WHATSAPP HUB   │
│                 │
│ If approved:    │
│ Send AI reply   │
│                 │
│ If not:         │
│ Escalate to     │
│ human           │
└─────────────────┘
```

**Contract:** WhatsApp Hub owns message; AI Manager owns decision. WhatsApp Hub does NOT decide AI behavior. AI Manager does NOT send messages.

---

### Flow 3: Marketing AI → AI Manager Governance

```
┌─────────────┐
│  MARKETING  │
│             │
│ Wants to    │
│ generate    │
│ campaign    │
│ message     │
└──────┬──────┘
       │
       │ "Generate message?"
       ▼
┌─────────────────┐
│  AI MANAGER     │
│                 │
│ Marketing AI:   │
│ - Enabled?      │
│ - Has knowledge?│
│ - Guardrail OK? │
└──────┬──────────┘
       │
       │ Decision + Draft
       ▼
┌─────────────┐
│  MARKETING  │
│             │
│ Receives    │
│ AI draft    │
│ (editable)  │
└─────────────┘
```

**Contract:** Marketing uses AI; AI Manager governs AI. Marketing does NOT configure AI rules. AI Manager does NOT create campaigns.

---

## 5. STATE MODEL (Target)

### Current (Problem)
```javascript
waChats[0]           // array index — unstable
WAH.assignments[0]   // index-based — breaks if order changes
WAH.resolved[0]      // index-based — fragile
waActive = 0         // index-based selection
```

### Target (Stable IDs)
```javascript
Conversation {
  conversationId: "conv-uuid-123",      // stable
  channelId: "ch-gelang-patah",         // stable
  branchId: "gelang-patah",             // stable
  patientId: "pat-001",                 // stable (nullable)
  contactPhone: "+60128823410",         // stable
  status: "open",                       // open/pending/resolved/archived
  assignedTo: "staff-005",              // stable (nullable)
  unreadCount: 2,
  lastMessage: "Hi, boleh tak tukar...",
  lastMessageAt: "2026-08-13T09:42:00",
  messages: Message[]
}

Message {
  messageId: "msg-uuid-456",
  conversationId: "conv-uuid-123",
  direction: "inbound",
  senderType: "patient",
  body: "Hi, boleh tak tukar appointment saya ke petang?",
  timestamp: "2026-08-13T09:40:00",
  status: "delivered"
}

Assignment {
  assignmentId: "asg-uuid-789",
  conversationId: "conv-uuid-123",
  staffId: "staff-005",
  assignedBy: "staff-001",
  assignedAt: "2026-08-13T10:00:00"
}
```

**Migration strategy:** Keep array indexes working (backward compatible), add stable IDs alongside. Gradual migration, not rewrite.

---

## 6. WHAT WILL NOT CHANGE

- ✅ WhatsApp Hub 3-pane layout (list, chat, context)
- ✅ Branch scope logic (`waVisibleIdx`, `getScopedChats`)
- ✅ Assignment/Resolve/Reopen workflow
- ✅ AI Suggest button in composer
- ✅ Patient context panel
- ✅ Marketing campaign wizard
- ✅ Marketing audience/recall/follow-up modules
- ✅ RBAC enforcement
- ✅ Audit trail pattern
- ✅ All existing tests (634)

---

## 7. PHASED IMPLEMENTATION PLAN

### Part 3: WhatsApp Hub Consolidation
**Goal:** Remove mixed responsibilities from WhatsApp Hub

**Changes:**
1. Remove Campaign Queue drawer → move to Marketing
2. Remove Template Library drawer → move campaign templates to Marketing
3. Keep quick reply templates (conversation templates) in WhatsApp Hub Settings
4. Simplify channel bar (hide session names)
5. Add stable conversationId alongside array index

**Tests:** W-01..W-25 must still PASS

---

### Part 4: Marketing Consolidation
**Goal:** Verify Marketing owns outreach intent

**Changes:**
1. Add Campaign Delivery view (reads from WhatsApp Hub)
2. Add AI message generation (calls AI Manager)
3. Verify campaign → WhatsApp handoff contract
4. Keep existing modules (audience, campaigns, recall, follow-up, config)

**Tests:** MKT-01..MKT-45 must still PASS

---

### Part 5: AI Manager Rebuild
**Goal:** Build AI Manager as control plane

**Changes:**
1. Add Agents section (detail view per agent)
2. Add Capabilities section (what each agent can do)
3. Add Knowledge section (knowledge base per agent)
4. Add Automations section (triggers)
5. Add Guardrails & Approvals section
6. Add Performance & Audit section
7. Keep agent cards (summary view)

**Tests:** New AI Manager tests + existing must PASS

---

### Part 6: Cross-Domain Integration
**Goal:** Verify handoff contracts work

**Changes:**
1. Marketing campaign → WhatsApp Hub send request
2. WhatsApp Hub → AI Manager decision request
3. Marketing AI → AI Manager governance
4. Document contracts

**Tests:** Cross-domain flow tests

---

### Part 7: Regression / QA
**Goal:** All existing tests PASS

**Changes:**
1. Run full suite (634 tests)
2. Fix any breaks
3. Verify branch scope, RBAC, audit

**Tests:** 634/634 PASS

---

## 8. DEPENDENCIES BETWEEN PHASES

```
Part 3 (WhatsApp Hub)
   ↓
Part 4 (Marketing) — depends on WhatsApp Hub contract
   ↓
Part 5 (AI Manager) — depends on WhatsApp Hub + Marketing contracts
   ↓
Part 6 (Integration) — depends on all above
   ↓
Part 7 (QA) — depends on all above
```

**Note:** Part 3 can start immediately. Part 4 and 5 can run parallel after Part 3.

---

## 9. RISKS

| Risk | Impact | Mitigation |
|---|---|---|
| Breaking WhatsApp scope | High | Keep `waVisibleIdx()`, `waApplyScope()` unchanged |
| Breaking Marketing flow | High | Keep `mktCreateCampaign()`, `mktSendCampaign()` working |
| AI Manager rebuild too big | Medium | Build alongside existing, migrate gradually |
| State model change breaks tests | High | Add stable IDs, keep array indexes working |
| Campaign queue removal breaks HQ | Medium | Move to Marketing, keep delivery view |

---

## 10. SUCCESS CRITERIA

After all parts complete:

- ✅ Marketing feels like "outreach planning workspace"
- ✅ WhatsApp Hub feels like "communication workspace"
- ✅ AI Manager feels like "AI control center"
- ✅ No duplicate features across domains
- ✅ Clear ownership (no mixed responsibilities)
- ✅ All 634 tests PASS
- ✅ Branch scope works
- ✅ RBAC works
- ✅ Audit trail works

---

## 11. APPROVAL CHECKPOINT

Before proceeding to Part 3 (WhatsApp Hub Consolidation), confirm:

- [ ] Target architecture is clear
- [ ] Ownership boundaries are correct
- [ ] No locked domains will be broken
- [ ] State model migration strategy is acceptable
- [ ] Phased plan is acceptable

**If approved, proceed to Part 3.**

---

**Document:** TARGET ARCHITECTURE v1.0
**Status:** Awaiting approval
**Next:** Part 3 — WhatsApp Hub Consolidation
