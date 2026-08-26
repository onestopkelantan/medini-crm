# PART 1 — CURRENT STATE AUDIT
## Domain Consolidation + KISS Refactor

**Date:** 13 August 2026
**Auditor:** Neo
**Scope:** Marketing, WhatsApp Hub, AI Manager + cross-domain dependencies

---

## 1. CURRENT-STATE ARCHITECTURE MAP

### Marketing (`page-marketing`)
```
Structure: mktNav modules
├── dashboard (KPIs, attention)
├── audience (All/Leads/Due/Overdue/Inactive/Custom)
├── campaigns (All/Scheduled/Running/Completed/Templates)
├── recall (dashboard/rules/follow-ups)
└── config (recall rules, thresholds)

State: MKT = { leads, campaigns, templates, followUps, audit, sent }
Navigation: mktNav('dashboard|audience|campaigns|recall|config')
```

### WhatsApp Hub (`page-whatsapp`)
```
Structure:
├── Channel status bar (WAH.channels)
├── Conversation list (waChats[])
├── Chat pane (waRenderChat)
│   ├── Header: name, tag, assign/resolve buttons
│   ├── Messages: waChats[i].msgs[][]
│   └── Composer: waInput + AI Suggest + Template + Escalate
└── Patient context (waContext)

State: 
- waChats[] (array of conversations)
- WAH = { channels, assignments, templates, campaignQueue, audit, resolved }
- waActive (index into waChats)

Key functions: waSelect(i), waSend(), waAssign(i), waResolve(i), waAiSuggest(), waApplyTemplate(id), waEscalate(), waTemplatesView(), waCampaignQueueView(), waRenderChannelBar()
```

### AI Manager (`page-ai`)
```
Structure:
├── Agent cards grid (8 agents with toggle + action count)
└── Recent activity log

State: hardcoded array in initAI()
Agents: AI Receptionist, Recall Manager, Booking Optimizer, Finance Follow-up, Marketing Writer, Clinical Scribe, Inventory Watchdog, Insights Analyst
```

---

## 2. CURRENT UI/DOMAIN MIXING LIST

### WhatsApp Hub — MIXED (🔴 RED)
| Feature | Current Location | Should Be | Issue |
|---|---|---|---|
| Campaign Queue | WhatsApp Hub drawer | **Marketing** | HQ sees campaign delivery tracking in comms page |
| Template Library | WhatsApp Hub drawer | **Marketing** (campaign templates) + **WhatsApp Hub** (quick replies) | Mixed ownership |
| AI Suggest | WhatsApp Hub composer | ✅ WhatsApp Hub (correct) | Operational AI |
| Channel config | WhatsApp Hub bar | ✅ WhatsApp Hub (correct) | But exposes session name |
| Assign/Escalate | WhatsApp Hub header | ✅ WhatsApp Hub (correct) | Operational |
| Campaign send execution | WhatsApp Hub queue | **Marketing** intent → WhatsApp Hub delivery | Currently mixed |

### Marketing — MIXED (🟡 AMBER)
| Feature | Current Location | Should Be | Issue |
|---|---|---|---|
| Campaign create/edit | Marketing | ✅ Marketing | Correct |
| Template management | Marketing campaigns tab | ✅ Marketing | Correct |
| Campaign delivery tracking | Marketing sent[] | ⚠️ Should read from WhatsApp Hub | Duplication risk |
| AI message generation | Marketing (not visible) | Marketing + AI Manager governance | Hidden dependency |
| Lead capture | Marketing leads[] | ✅ Marketing | Correct |

### AI Manager — MIXED (🔴 RED)
| Feature | Current Location | Should Be | Issue |
|---|---|---|---|
| Agent cards with toggle | AI Manager | ⚠️ Toggle should be governed by AI Manager | Currently dummy toggle |
| Recent activity log | AI Manager | ✅ AI Manager | Correct |
| Agent capabilities | Not visible | **AI Manager** | Missing |
| Knowledge base | Not visible | **AI Manager** | Missing |
| Guardrails/Approvals | Not visible | **AI Manager** | Missing |
| Performance metrics | Not visible | **AI Manager** | Missing |

---

## 3. RED / AMBER / GREEN FINDINGS

### 🔴 RED (Critical — must fix)

1. **WhatsApp Hub has Campaign Queue** — Campaign delivery tracking belongs to Marketing; WhatsApp Hub should only execute sends, not own campaign management.

2. **AI Manager is not a control plane** — Currently just agent cards + activity log. Missing: capabilities, knowledge, guardrails, approvals, performance, audit detail.

3. **State model uses array indexes** — `waChats[index]`, `WAH.assignments[index]`, `WAH.resolved[index]`. Not stable for production. Need stable IDs.

4. **Template ownership unclear** — WhatsApp Hub has Template Library, Marketing has Templates tab. Same feature in two places.

5. **No clear AI governance** — AI toggle in AI Manager is dummy; no connection between AI Manager rules and WhatsApp Hub AI Suggest behavior.

### 🟡 AMBER (Should fix)

1. **WhatsApp Hub channel bar exposes session name** — `medini-gp`, `medini-st` are infrastructure details. Normal users should see "Connected" / "Need QR" only.

2. **Marketing sent[] duplicates WhatsApp Hub campaignQueue** — Both track campaign delivery. Single source should be WhatsApp Hub (delivery system of record).

3. **No clear handoff protocol** — Marketing creates campaign → WhatsApp Hub executes. But no formal "send request" contract.

4. **AI Suggest has no guardrail visibility** — Receptionist doesn't know if AI is allowed to send auto-reply for this patient type.

### 🟢 GREEN (Working well)

1. **WhatsApp Hub Inbox structure** — 3-pane layout (list, chat, context) is correct.

2. **Assignment/Resolve/Reopen** — Operational workflow is correct.

3. **Branch scope** — `waVisibleIdx()` + `getScopedChats()` works correctly.

4. **Audit trails** — All domains have audit logging.

5. **RBAC enforcement** — Role checks in place.

---

## 4. STATE MODEL PROBLEMS

| Current | Problem | Should Be |
|---|---|---|
| `waChats[0]`, `waChats[1]` | Array index — breaks if order changes | `conversationId` stable string |
| `WAH.assignments[0]` | Index-based assignment | `conversationId → staffId` |
| `WAH.resolved[0]` | Index-based resolution | `conversationId → status` |
| `waActive = 0` | Index-based selection | `activeConversationId` |

---

## 5. CROSS-DOMAIN DEPENDENCY ISSUES

| From | To | Current | Should Be |
|---|---|---|---|
| Marketing | WhatsApp Hub | Campaign queue in WhatsApp Hub | Marketing creates campaign → sends request to WhatsApp Hub → WhatsApp Hub executes and reports back |
| WhatsApp Hub | AI Manager | AI Suggest calls AI directly | WhatsApp Hub → AI Manager (get decision) → AI Manager returns approved response |
| AI Manager | WhatsApp Hub | None visible | AI Manager should govern: can AI auto-reply? what knowledge? what guardrails? |
| Marketing | AI Manager | None visible | Marketing AI (message generation) should be governed by AI Manager |

---

## 6. WHAT WILL NOT BE CHANGED

- ✅ Locked domains: Dashboard, Patients, Appointments, Clinical, Finance, Administration, Settings, Operations
- ✅ WhatsApp Hub Inbox core workflow (conversation list, chat pane, patient context)
- ✅ Branch scope and RBAC enforcement
- ✅ Audit trail pattern
- ✅ Existing test coverage (634 tests)

---

## 7. RISKS

| Risk | Impact | Mitigation |
|---|---|---|
| Breaking WhatsApp scope logic | High | Preserve `waVisibleIdx()`, `waApplyScope()` behavior |
| Breaking Marketing campaign flow | High | Keep `mktCreateCampaign()`, `mktSendCampaign()` working |
| AI Manager rebuild breaks existing | Medium | Build new structure alongside, migrate gradually |
| State model change breaks tests | High | Keep array indexes working, add stable IDs alongside |

---

## 8. REGRESSION TEST PLAN

After changes, verify:
- [ ] WhatsApp: 634 tests still PASS
- [ ] WhatsApp: branch scope works (receptionist sees own branch only)
- [ ] WhatsApp: assignment/resolve/reopen works
- [ ] WhatsApp: unread badge updates
- [ ] Marketing: campaign create/send works
- [ ] Marketing: audience/lead management works
- [ ] AI Manager: agents display correctly
- [ ] Cross-domain: Marketing campaign → WhatsApp delivery
- [ ] Cross-domain: AI Suggest works with governance

---

## 9. RECOMMENDED NEXT STEP

**PART 2 — TARGET ARCHITECTURE**

Define clean ownership:
- Marketing = outreach intent (who, why, when, what message)
- WhatsApp Hub = communication execution (inbox, reply, assign, escalate)
- AI Manager = AI governance (agents, capabilities, guardrails, approvals, audit)

With clear handoff contracts between domains.

---

**Audit complete. Ready for Part 2 (Target Architecture) on your approval.**
