# OPERATIONS DOMAIN — ARCHITECTURE LOCK v1.0

**Status:** LOCKED · **Phase:** Blueprint Lock Program — Phase 4 (Group B: Operational Data Foundation)
**Date:** 13 August 2026 · **Author:** Neo (Senior Architect)
**Depends on:** Phase 1 Administration (LOCKED), Phase 2 Settings (LOCKED)
**Client amendments applied:** Chair board → Doctor Live Status; Maintenance & Sterilisation REMOVED; Stock & Inventory DEFERRED.

---

## 1. Business Purpose

Operations menjawab: **"Apa yang sedang berlaku di lantai klinik SEKARANG, dan apa yang perlu tindakan?"**

Domain ini ialah live operational layer — doktor sedang buat apa, task harian siapa belum siap, insiden apa yang terbuka, dan kes lab mana yang lewat. Ia menjadikan operasi harian klinik visible, auditable, dan actionable — bukan sekadar senarai statik.

## 2. Domain Scope

**DALAM scope:**
- Doctor Live Status board (real-time: siapa buat apa, di mana, sejak bila)
- Daily Checklist (persist, audited, auto-reset)
- Task Management (assign, due, complete/reopen)
- Incident Log (lifecycle dengan resolution wajib)
- Lab Coordination (case tracking fizikal: hantar → fitted)
- Operational Alerts (feed ke Dashboard attention)

**LUAR scope (explicit — client decision):**
- ❌ Maintenance / asset service schedule
- ❌ Sterilisation cycle log
- ❌ Stock & Inventory (deferred — fasa kemudian)
- ❌ Financial lab payables — Finance domain (locked); Operations hanya track status fizikal case
- ❌ Appointment booking — Appointments domain (locked); Operations consume status sahaja

## 3. Domain Boundary

| Benda | Pemilik | Nota |
|---|---|---|
| Doctor live status | **Operations** | Derived dari Appointments + manual override |
| Daily checklist state | **Operations** | — |
| Operational tasks | **Operations** | Assignee dari Administration |
| Incidents | **Operations** | — |
| Lab case physical tracking | **Operations** | Duit lab = Finance (locked) |
| Chair booking/schedule | Appointments | Locked — jangan sentuh |
| Staff records | Administration | Locked |
| Operational config defaults | Settings | Locked |

## 4. Responsibilities

1. Menunjukkan status live setiap doktor per branch (auto dari appointment in-progress + override manual)
2. Menyimpan checklist harian yang persist dan diaudit
3. Mengurus task operasi dengan assignee dan due
4. Merekod insiden dengan lifecycle penuh dan resolution wajib
5. Menjejak kes lab fizikal dan flag overdue
6. Menghasilkan operational alerts untuk Dashboard
7. Audit semua tindakan operasi

## 5. Subdomains / Modules

| Module | Fungsi |
|---|---|
| Doctor Live Board | Status real-time doktor: In Treatment / Available / In Consultation / On Break / Off Duty |
| Daily Checklist | Task harian persist dengan completion audit |
| Task Management | Create/assign/complete/reopen task |
| Incident Log | Report → investigate → resolve dengan note wajib |
| Lab Coordination | Track case: Sent → In Progress → Received → Fitted |
| Operational Alerts | Overrun doktor, incident open, lab overdue → Dashboard feed |

## 6. Entities

| Entity | Medan utama | Nota |
|---|---|---|
| `DoctorStatus` | doctorId, branchId, status, currentActivity, chair, startedAt, estDoneAt, overrideBy, overrideReason | Live state, derived + override |
| `OpsChecklist` | id, branchId, label, done, doneBy, doneAt, date | Reset harian |
| `OpsTask` | id, branchId, title, assigneeId, dueTime, linkType, linkId, status, createdBy | status: open/done/reopened |
| `Incident` | id, branchId, type, severity, area, description, status, resolutionNote, reportedBy, resolvedBy | status: Open/Investigating/Resolved |
| `LabCase` | id, branchId, patientId, caseId, labName, item, sentAt, promisedAt, status, receivedAt, fittedAt | status: Sent/InProgress/Received/Fitted |
| `OpsAlert` | id, branchId, kind, severity, message, refId, status | kind: doctor_overrun/incident_open/lab_overdue |
| `OpsAudit` | actor, action, detail, branchId, when | Immutable |

## 7. Entity Relationships

```
Branch (1) ──< (n) DoctorStatus ──> (1) Staff (Administration)
Branch (1) ──< (n) OpsChecklist / OpsTask / Incident / LabCase / OpsAlert
OpsTask ──> (1) Staff (assignee)
LabCase ──> (1) Patient, (0..1) TreatmentCase (Clinical), (0..1) LabPayable (Finance)
DoctorStatus (auto) <── Appointments (in-progress)
```

## 8. State Machines / Lifecycles

### DoctorStatus
```
AVAILABLE → IN_TREATMENT (auto dari appointment check-in/in-progress)
AVAILABLE → IN_CONSULTATION → AVAILABLE
ANY → ON_BREAK → AVAILABLE
ANY → OFF_DUTY (end of day)
IN_TREATMENT → AVAILABLE (auto bila appointment completed)
* Manual override mana-mana arah — reason WAJIB, audited
```

### Incident
```
OPEN → INVESTIGATING → RESOLVED (resolutionNote wajib)
RESOLVED → (tak boleh reopen; kes baru = incident baru)
```

### LabCase
```
SENT → IN_PROGRESS → RECEIVED → FITTED
* Bila now > promisedAt dan status belum RECEIVED → OVERDUE flag + alert
```

### OpsTask
```
OPEN → DONE → REOPENED → DONE
```

### Daily Checklist
```
PENDING → DONE (doneBy/doneAt recorded)
* Auto-reset setiap hari (simulated dalam prototype)
```

## 9. Business Rules

1. Doctor status AUTO dari appointment in-progress; override manual perlu reason + audit.
2. Overrun: `In Treatment` melebihi estDoneAt → alert `doctor_overrun` ke branch manager + HQ feed.
3. Lab case melebihi promisedAt tanpa RECEIVED → `lab_overdue` alert + Finance flag (link LabPayable bila wujud).
4. Incident RESOLVED mesti ada resolutionNote — tidak boleh kosong.
5. Checklist complete mesti ada doneBy + doneAt — tiada anonymous completion.
6. Semua scope per branch: HQ nampak semua, branch roles own branch sahaja.
7. Tiada delete untuk incident/lab case — close/archive sahaja (historical protection).
8. Operations TIDAK pegang duit lab, stok, maintenance, atau sterilisation.
9. Operational alerts muncul dalam Dashboard "What Needs Your Attention" (consume pattern).
10. AI boleh RECOMMEND (cth: "Lab case lewat — follow up?") tetapi tak boleh RESOLVE incident atau FIT case — manusia sahaja.

## 10. RBAC / Permission Model

Ikut permissionMatrix (Administration, locked) — module `operations`:

| Action | HQ | Manager | Receptionist | Doctor |
|---|---|---|---|---|
| View board/checklist/incidents/lab | ✅ | ✅ own branch | ✅ own branch | ✅ own status + own tasks |
| Create/edit task | ✅ | ✅ own branch | ❌ | ❌ |
| Complete checklist | ✅ | ✅ | ✅ | ✅ (own tasks) |
| Report incident | ✅ | ✅ | ✅ | ✅ |
| Resolve incident | ✅ | ✅ own branch | ❌ | ❌ |
| Override doctor status | ✅ | ✅ own branch | ✅ (set break sahaja) | ❌ |
| Update lab case status | ✅ | ✅ own branch | ❌ | ❌ |

## 11. Branch / Data Scope

- HQ: semua branch, semua module Operations
- Branch Manager: own branch — full operational control
- Receptionist: own branch — view + checklist + report incident + set break
- Doctor: own branch — view own status, complete own tasks
- Cross-branch akses blocked di state layer (sama enforcement macam domain locked)

## 12. Cross-Domain Dependencies

| Operations perlukan | Operations berikan kepada |
|---|---|
| Appointments: status in-progress/completed (doctor auto status) | Dashboard: operational alerts feed |
| Administration: staff/doctor list, RBAC, branch scope | Finance: lab.case_overdue flag |
| Clinical: treatment case reference untuk lab link | Settings: consume operational defaults |
| Finance: lab payable existence untuk link | Reports: operational metrics (task completion, incident counts, lab SLA) |

## 13. Events Produced

- `doctor.status_changed` (auto/manual)
- `ops.checklist_completed`, `ops.task_created/completed/reopened`
- `incident.reported/investigating/resolved`
- `lab.sent/in_progress/received/fitted`, `lab.overdue`
- `ops.alert_raised`, `ops.alert_cleared`

## 14. Events Consumed

- `appointment.checked_in / in_progress` → doctor status IN_TREATMENT
- `appointment.completed` → doctor status AVAILABLE
- `staff.deactivated` (Administration) → reassign open tasks ke branch manager (flag)
- `settings.config_updated` → operational defaults change

## 15. Actions / Commands

| Command | Actor | Gate |
|---|---|---|
| Override doctor status | HQ/Manager; Receptionist (break only) | Reason wajib + audit |
| Complete checklist item | Semua role (scope) | doneBy/doneAt auto |
| Create task | HQ/Manager | Assignee + due wajib |
| Complete/reopen task | Assignee / HQ / Manager | Audit |
| Report incident | Semua role | Type + severity + description wajib |
| Investigate incident | HQ/Manager | Status change audited |
| Resolve incident | HQ/Manager | resolutionNote WAJIB |
| Advance lab case | HQ/Manager | Status transition valid |
| Mark lab fitted | HQ/Manager | Audit + close case |

## 16. Audit Requirements

Setiap: doctor override (reason), checklist completion, task lifecycle, incident lifecycle, lab transition.
Audit entry: actor, action, entity, detail, branchId, timestamp. Immutable — tiada edit/delete.

## 17. Notification Requirements

- `doctor_overrun` → branch manager + HQ dashboard
- `incident_open` (severity high) → branch manager + HQ
- `lab_overdue` → branch manager + Finance flag
- `task_due_soon` → assignee (prototype: visual indicator)

## 18. Search Requirements

- Doctor board: filter branch, status
- Incidents: filter status/severity/date
- Lab cases: search patient/lab/status
- Tasks: filter assignee/status

## 19. AI Interaction Boundaries

| AI boleh | AI TIDAK boleh |
|---|---|
| READ semua operational state | Override doctor status |
| RECOMMEND (follow-up lab overdue, escalate incident) | Resolve incident |
| DRAFT incident report dari context | Mark lab case fitted |
| DRAFT task suggestion | Complete checklist |

## 20. Reporting / Analytics Implications

Operations produce canonical facts:
- `doctor_utilization` (in-treatment time vs available)
- `task_completion_rate`, `incident_count_by_severity`, `incident_resolution_time`
- `lab_sla_pct` (fitted before promised), `lab_overdue_count`

Reports domain consume — tak kira sendiri.

## 21. UX / Workspace Architecture

Page: **Operations** (Business section). Layout:
1. **Doctor Live Status board** (centerpiece) — card per doktor: status pill, aktiviti semasa, chair, mula, est. siap, overrun indicator; klik → detail + override
2. **Daily Checklist** — persist, doneBy badge
3. **Task Management** — list + add form + complete/reopen
4. **Incident Log** — status lifecycle + resolve dialog
5. **Lab Coordination** — case pipeline board (4 columns status)
6. **Operational Alerts strip** — active alerts dengan link ke sumber

Branch selector ikut branch context (HQ boleh switch; others locked own branch).

## 22. Prototype Implementation Requirements

- `OPS` state: doctorStatuses, checklist, tasks, incidents, labCases, alerts, audit
- Doctor board live: auto-derive dari appointment state + manual override dialog (reason wajib)
- Checklist toggle → state + doneBy + audit
- Add task form → assign staff dari ADM.staff
- Incident report form + investigate/resolve flow
- Lab case advance buttons ikut lifecycle
- Alerts strip update live bila overrun/overdue/open
- Branch scope enforced
- Semua butang functional (standard established)

## 23. Smoke Test Requirements

O-01..O-25:
- Page renders semua 6 sections
- Doctor board renders dari OPS state
- Auto status dari appointment in-progress
- Manual override: reason wajib, audit, state bertukar
- Overrun alert muncul bila estDoneAt lepas
- Checklist complete → persist + doneBy + audit
- Task create (assignee+due validation), complete, reopen
- Incident report → open; resolve tanpa note = reject; dengan note = resolved + audit
- Lab case advance lifecycle; overdue flag
- Branch scope: manager own sahaja, cross-branch blocked
- Receptionist: boleh report incident, tak boleh resolve
- Doctor: view own, tak boleh override orang lain
- Alerts strip reflect live state
- Existing 584 tests kekal PASS
- Zero JS errors

## 24. Production Backend Implications

- Schema: `doctor_status` (live row per doctor), `ops_checklists`, `ops_tasks`, `incidents`, `lab_cases`, `ops_alerts`, `ops_audit`
- Live status: server derive dari appointments + override table; WebSocket/polling untuk real-time
- tRPC router: `operations.ts` dengan permProc('operations', ...)
- Worker (production): overrun/overdue scanner berkala → raise alerts
- Migration: OPS prototype state → seed

## 25. Risks / Open Decisions

| Item | Status |
|---|---|
| Real-time push (WebSocket) vs polling | DECIDED prototype: state re-render; production: polling 30s dulu, WS later |
| Auto-detect doctor status dari appointment | DECIDED — derive, override manual audited |
| Inventory/Stock | DEFERRED (client) |
| Maintenance/Sterilisation | REMOVED (client) |
| Lab integration dengan lab sebenar (external) | DEFER — production integration phase |
| Task recurring templates | DEFER — v2 |

---

## DOMAIN CONTRACT — OPERATIONS

**OWNS:** DoctorStatus, OpsChecklist, OpsTask, Incident, LabCase (physical tracking), OpsAlert, OpsAudit.
**SOURCE OF TRUTH:** OPS state registry; doctor status derived dari Appointments + override.
**CONSUMES:** `appointment.*` status events, `staff.*` (Administration), `config.*` (Settings).
**PRODUCES:** `doctor.status_changed`, `ops.*`, `incident.*`, `lab.*`, alerts ke Dashboard/Finance.
**COMMANDS:** override status, complete checklist, manage task, report/investigate/resolve incident, advance lab case.
**AUDIT:** semua lifecycle transitions immutable.
**AI:** READ + RECOMMEND + DRAFT sahaja. EXECUTE = manusia.

## LOCK GATE CHECKLIST

- [x] 25 gates documented
- [x] Client amendments applied (no chair board, no maintenance/sterilisation, no stock)
- [x] Domain contract clear — tiada overlap dengan Finance/Clinical/Appointments
- [x] RBAC ikut matrix locked
- [x] Production path no-redesign

**LOCK GATE: PASS (architecture)** — prototype + smoke tests dalam sesi ini sebelum final LOCKED.
