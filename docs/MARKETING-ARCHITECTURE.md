# MARKETING MANAGEMENT — ENTERPRISE BUSINESS ARCHITECTURE v1.0

**Domain:** Marketing Management (Domain 4) · **Status:** Architecture v1.0 — basis for the Single HTML Full UX Prototype
**Baseline:** Builds on Patient (D1), Appointment (D2), Clinical (D3), Finance (v1.1) — all LOCKED

---

## 1. Domain Purpose

Marketing answers one simple question:

> **"Siapa yang patut kita contact, kenapa kita contact mereka, dan apa tindakan seterusnya?"**

Patient engagement, recall, reactivation, simple lead capture, WhatsApp campaigns, follow-up and marketing communication. **KISS** — not an enterprise sales CRM.

## 2. Scope

In scope:

* Audience (All Patients, Leads, Due Recall, Overdue Recall, Inactive, Custom Segment)
* Campaigns (Create, Scheduled, Running, Completed, Templates)
* Recall & Follow-up (Recall Dashboard, Due, Overdue, Inactive, Follow-ups, Recall Rules)
* Marketing Configuration (recall rules, inactive threshold, lead sources, follow-up defaults, preferences)

Out of scope (belongs elsewhere — do not duplicate):

* Referral Management, Sales Performance, Marketing Intelligence, Opportunity Management, complex pipeline, ROI engine, marketing analytics platform, WhatsApp inbox, duplicate patient DB, duplicate appointment system, revenue/profit/finance calculations.

## 3. Domain Ownership

| Domain | Owns |
|---|---|
| Patient Management | Who is the patient? |
| **Marketing** | **Who should we contact and why?** |
| Communication Hub | How do we communicate and manage conversations? (WhatsApp transport) |
| Appointment Management | When is the patient coming? |
| Clinical | What treatment does the patient receive? |
| Finance | What money is charged/collected/owed? |

## 4. Architecture

```text
📣 MARKETING
├── 👥 AUDIENCE       → lists (all/leads/due/overdue/inactive/custom)
├── 📣 CAMPAIGNS      → wizard → templates → schedule → Communication Hub
└── 🔄 RECALL & FOLLOW-UP → dashboard, due, overdue, inactive, follow-ups, rules
        ↓
💬 COMMUNICATION HUB (owns WhatsApp queue/safety/device/delivery)
        ↓
📅 APPOINTMENT (owns booking)
```

## 5. Modules & Submodules

### 👥 Audience
All Patients · Leads · Due Recall · Overdue Recall · Inactive Patients · Custom Segment

### 📣 Campaigns
All · Create (6-step wizard) · Scheduled · Running · Completed · Templates

### 🔄 Recall & Follow-up
Recall Dashboard · Due Recall · Overdue Recall · Inactive · Follow-ups · Recall Rules

## 6. Entities

* **AudienceList** — kind, patients, validation (selected/duplicates/invalid/opted-out/final)
* **Lead** — name, phone, source, interested treatment, branch, status, assigned, follow-up, patientMrn (link, no duplicate)
* **Campaign** — name, audience, channel, branch, status, schedule, sent/delivered/read/replied/appointments, template, by
* **Template** — name, body (merge fields), active, used (archived, never deleted)
* **FollowUp** — who, channel, date, assigned, branch, status
* **RecallRule** — treatment, interval (months), active, branch override
* **MarketingConfig** — inactiveMonths, leadSources, followUpDefaults, prefs, history

## 7. Lead Statuses (simple)

`NEW · CONTACTED · INTERESTED · APPOINTMENT · CONVERTED · LOST`

## 8. Recall

**Locked formula:** `Recall Date = Relevant Treatment/Visit Date + Configured Recall Interval`

User edits the **interval** (e.g. Scaling 6→4 months); the system recalculates the audience. Recall states: `UPCOMING · DUE · OVERDUE · COMPLETED · NOT ELIGIBLE`. Default rules: Scaling 6m, General Check-up 6m, Periodontal 3m, Braces Review 2m, Other 6m. Branch override supported with deterministic precedence: `Global Default → Branch Override → Effective Rule`.

## 9. Inactive Threshold

Patient with no relevant visit for a **configurable period** (default 12 months). Changing the threshold recalculates the inactive audience.

## 10. Campaigns

**Wizard (6 steps):** Audience → Message (template) → Personalization → Schedule → Review & Safety → Send/Schedule.

Statuses: `DRAFT · SCHEDULED · RUNNING · PAUSED · COMPLETED · CANCELLED`. Results: Sent/Delivered/Read/Replied/Appointments (basic only — no ROI engine).

## 11. Templates

Required templates: Recall Scaling/Check-up/Braces, Reactivation, Promotion, Follow-up. Create/Edit/Duplicate/Activate/Deactivate. **Archive, never delete** used templates. Merge fields: `{patient_name} {branch_name} {recall_date} {appointment_link} {treatment_name} {recall_interval}`.

## 12. Audience Validation (LOCKED)

```text
Selected → Duplicate Check → Valid Phone Check → Marketing Eligibility → Opt-Out Check → Branch/Audience Rules → Final Audience
```

Opted-out contacts are automatically excluded; a normal campaign flow cannot bypass opt-out.

## 13. WhatsApp / Communication Hub Boundary

Marketing owns **campaign intent**; Communication Hub owns **message transport** (queue, safety/rate limits, cooldown, device health, delivery, opt-out enforcement). Marketing sends a **Send Request** into the Hub — it never sends directly to WhatsApp. WhatsApp safety (queue, rate limits, cooldown, auto-pause, opt-out protection) is a Hub feature, not Marketing. **No ban bypass, no spam evasion, no guaranteed anti-ban claims.**

## 14. RBAC

HQ = all branches. Branch user = own branch only. Unauthorized branch blocked at **state/data layer** (not UI hiding).

## 15. Audit

Important mutations audited (actor/date/action/old→new): campaign create/edit/schedule/pause/resume/cancel, template create/edit/deactivate, recall rule change, inactive threshold change, lead/follow-up lifecycle.

## 16. Data Protection

Historical campaigns are never deleted (archive/deactivate/cancel). Changing recall rules/inactive threshold never rewrites historical records — only future/effective calculations update.

## 17. Configuration

Marketing configuration contains only relevant parameters: Recall Rules, Inactive Threshold, Lead Sources, Follow-up Defaults, Preferences. **Users edit data & parameters; system owns formulas & logic.**

## 18. Cross-Domain Relationships

```text
Patient → Clinical (treatment) → Recall (Marketing) → Campaign → Communication Hub → WhatsApp → Patient Reply → Appointment → Clinical → Finance
```

Marketing reads Patient identity, derives recall from Clinical visit/treatment, triggers Appointment booking (Appointment owns it), sends via Communication Hub, and optionally reads Finance (never duplicates finance calculations).

## 19. Future Exclusions

Referral engine, sales forecasting, lead scoring AI, opportunity management, complex pipeline, marketing ROI/BI, advanced segmentation language, journey/automation builders — possible future phases, NOT v1.0.

## 20. Final Architecture

```text
MARKETING MANAGEMENT v1.0 — KISS ARCHITECTURE — COMPLETE
```
