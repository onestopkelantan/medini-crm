# OPERATIONS DOMAIN — LOCKED

**Locked:** 13 August 2026 · **Blueprint Lock Program Phase 4 (Group B: Operational Data Foundation)**
**Authority:** docs/OPERATIONS-ARCHITECTURE.md
**Client amendments:** Chair board → Doctor Live Status; Maintenance & Sterilisation REMOVED; Stock & Inventory DEFERRED.

---

## PHASE: 4 — Operations Domain Lock
## STATUS: ✅ LOCKED

## OBJECTIVES:
- Real-time Doctor Live Status board (bukan chair board)
- Daily checklist persist dengan completion audit
- Task management dengan assignee + due
- Incident lifecycle dengan resolution note wajib
- Lab coordination tracking (physical case, bukan duit)
- Operational alerts ke Dashboard
- Branch-scoped enforcement

## COMPLETED:
- [x] Architecture document (25 gates) — OPERATIONS-ARCHITECTURE.md
- [x] Domain contract
- [x] OPS state engine: doctors/checklist/tasks/incidents/labCases/alerts/audit
- [x] Doctor Live Status board — 5 status (In Treatment/Available/In Consultation/On Break/Off Duty), activity/chair/started/estDone, MANUAL OVERRIDE badge
- [x] Override dengan reason wajib + audit; receptionist break-only; doctor blocked
- [x] Daily checklist persist + doneBy + reopen + audit
- [x] Task create (validation) + complete/reopen + audit
- [x] Incident report (type/severity/area/desc) + resolve dengan note wajib
- [x] Lab case lifecycle Sent → In Progress → Received → Fitted + overdue flag
- [x] Operational alerts: doctor_overrun, incident_open, lab_overdue
- [x] Branch scope (HQ all, others own branch)
- [x] Stock/Maintenance/Sterilisation TIDAK wujud dalam domain (verified dalam tests)

## ARCHITECTURE DECISIONS:
- Doctor status auto-derived dari Appointments; manual override audited
- Operations tidak pegang duit lab (Finance), stok (deferred), maintenance/sterilisation (removed)
- Alerts computed on-render (prototype); production = worker scanner
- Real-time: prototype re-render; production polling 30s dulu

## DOMAIN CONTRACT:
- OWNS: DoctorStatus, OpsChecklist, OpsTask, Incident, LabCase, OpsAlert, OpsAudit
- CONSUMES: appointment.*, staff.*, config.*
- PRODUCES: doctor.status_changed, ops.*, incident.*, lab.*, alerts
- COMMANDS: override status, complete checklist, manage task, report/resolve incident, advance lab
- AUDIT: semua transitions immutable
- AI: READ + RECOMMEND + DRAFT sahaja

## TESTS:
- O-01..O-25: **25/25 PASS**
- Full suite: **609/609 PASS** (584 + 25)
- Zero JS errors

## RISKS:
- Real-time push — production (polling dulu)
- Lab external integration — production phase
- Task recurring templates — v2

## LOCK GATE: ✅ PASS

## NEXT PHASE:
Phase 5 — WhatsApp Hub Domain Lock (Group C: Communication & Intelligence)
