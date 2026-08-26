# PHASE 6 — DOMAIN 1 PLAN (Patient Management / Patient 360)

**Domain dipilih:** Patient Management / Patient 360 — kerana ia domain yang paling kuat kaitannya dengan Dashboard, appointments, operational workflow, branch context & role-based work (disahkan oleh data V9 sedia ada: `patients`, `appts`, `waChats`, `schedData`, `openP360`).

**Keputusan reka bentuk:** Bina di atas V9 sedia ada — BUKAN rewrite. V9 dah ada Patients page (search + filter pills + table + P360 slide-over). Phase 6 menaik tarafnya kepada domain workspace penuh yang koheren.

## Apa yang V9 dah ada (dikekalkan)
- `patients[]` (10 rekod, MRN, phone, age, gender, last, st, branchId, bal)
- `appts[]` (day, t, p, tx, st, b, dr)
- `waChats[]` (b, name, phone, tag, unread, msgs)
- Patients page: search (`filterPatients`), status pills, table, P360 slide-over (`openP360`)
- Scope: `getScopedPatients()` (Phase 3.1)

## Gap yang Phase 6 isi (daripada audit)
1. **Tiada DomainState koheren** — patients/appts/followups/timeline/comms berasingan; tiada hubungan. → Bina `DomainState` yang mengaitkan semua.
2. **Filter pills tak berfungsi** — `pillFilter` hanya toggle CSS, tak filter data. → Jadikan filter sebenar.
3. **P360 hardcoded** — "Recent Visits" & "Active Treatment Plan" sama untuk semua pesakit. → Jana daripada DomainState per pesakit.
4. **Tiada timeline** — tiada kronologi per pesakit. → Timeline dari DomainState.
5. **Tiada workflow dalam domain** — Book Visit hanya toast; tiada follow-up start/complete. → Guna semantik Phase 5.1 (open/ack/in_progress/completed).
6. **Tiada dashboard reflection** — complete follow-up dalam domain tak kemas kini dashboard. → DomainState difikirkan semula oleh P4 intelligence.
7. **Tiada domain landing** — Patients page terus table. → Tambah landing ringkas (workload, priority, quick links).
8. **Status pills tak tapis** — All/Active/VIP/Recall Due. → Wire ke DomainState.

## DomainState (single coherent mock layer)
```js
DomainState = {
  patients: { [mrn]: { ...base, followUp: {status:'due'|'in_progress'|'completed'|null}, notes:[], } },
  timeline: { [mrn]: [ {d, type, text} ] },   // chronological, coherent
  comms:    { [mrn]: [ {dir, text, time} ] }, // linked to waChats where possible
}
```
Sumber asas kekal `patients[]` V9; DomainState menambah hubungan + workflow overlay. `getScopedPatients()` kekal gate scope.

## Workspace structure
```
Patients (Domain 1)
├── Landing strip: workload metrics + priority + quick links
├── Patient List: search + status filter + sort + scope
├── Patient Detail / 360 (slide-over):
│     Profile → Appointments → Follow-ups → Comms → Notes → Timeline → Actions
└── Workflow: start/complete follow-up (Phase 5.1 semantics)
```

## Dashboard integration
- P4 follow-up signal baca bilangan `followUp.status==='due'` daripada DomainState → complete dalam domain mengurangkan signal.
- Phase 5 action "Review follow-ups" → Patients page dengan filter `recall` aktif.

## Security
- `openP360` sudah block out-of-scope (Phase 3 §50) — kekalkan.
- Manager/receptionist/doctor foreign branch/doctor → BLOCKED.
- Tiada financial truth untuk receptionist/doctor (bal disembunyi ikut `canSeeFinancials()`).

## Backend readiness (dokumentasi sahaja — TIDAK dibina)
Entities: Patient, Appointment, FollowUp, TimelineEvent, Communication, Note.
Reads: list(scope, filter, search), get360(mrn), timeline(mrn).
Mutations: startFollowUp, completeFollowUp, addNote, bookAppointment.
Boundaries: role + branch + doctor scope; audit pada setiap mutation.
