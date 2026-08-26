# PHASE 6 — LOCKED (Domain 1: Patient Management / Patient 360)

**Locked:** 9 August 2026 · **Baseline:** Phase 5.1 LOCKED (61/61 review validation)

## 1. Selected Domain
**Patient Management / Patient 360** — domain paling kuat kaitannya dengan Dashboard, appointments, operational workflow, branch context & role-based work. Disahkan oleh data V9 sedia ada (`patients[]`, `appts[]`, `waChats[]`, `getScopedPatients()`).

## 2. Domain Architecture
```text
Patients (Domain 1)
├── Landing strip: workload metrics in-scope (count, active, follow-ups due, appts today)
├── Patient List: search + status filter (REAL, bukan kosmetik) + scope-gated
├── Patient 360 (slide-over): Profile → Upcoming Appt → Timeline → Notes → Follow-up workflow
└── Workflow: start/complete follow-up (Phase 5.1 hard gate)
```

### Komponen (nama sebenar)
- `DomainState` — coherent mock layer (followUp/notes/timeline per MRN)
- `p6Ensure / p6FollowUpStatus / p6Timeline / p6Notes / p6DueFollowUps`
- `p6StartFollowUp / p6CompleteFollowUp / p6AddNote` — Phase 5.1 semantics (hard gate)
- `patientPill / applyPatientFilters / filterPatients` — search + status filter sebenar
- `openP360` — upgraded: timeline, notes, workflow, role-aware financial
- P4 intelligence — follow-up signal baca `p6DueFollowUps()` (dashboard reflection)
- P5 action "Review follow-ups" → patients page + auto recall filter

## 3. Role Coverage
| Role | Capaian |
|---|---|
| HQ | Cross-branch patients, full 360 termasuk financial |
| Branch Manager | Own branch sahaja (foreign branch NOT in scope — diuji D9) |
| Receptionist | Own branch, TIADA financial truth dalam 360 (diuji D11) |
| Doctor | Own branch scope (diuji D10) |

## 4. Scope
Branch scope diwarisi daripada V9 `getScopedPatients()` — tiada engine baharu. Doctor = own branch. Record-level gate kekal (`openP360` block out-of-scope).

## 5. Dashboard Integration (DISAHKAN end-to-end)
```text
Dashboard (follow-up signal = 1)
→ klik "Review follow-ups" (P5 action)
→ Patients page + Recall Due filter auto-aktif
→ open Patient 360 (Timeline visible)
→ Start Follow-up → In Progress
→ Complete Follow-up → Completed (hard gate: mesti in_progress dulu)
→ Timeline bertambah ("Follow-up completed by Jessica")
→ balik Dashboard → signal turun 1 → 0  ✅ reflected:true
```

## 6. Workflow States
`due → in_progress → completed` — hard gate Phase 5.1 (complete tanpa start DITOLAK, diuji D8).

## 7. Security / Negative Tests
- Manager foreign branch patient NOT in scope (D9 PASS)
- Doctor own branch only (D10 PASS)
- Receptionist no financial truth dalam 360 (D11 PASS)
- Complete tanpa start REJECTED (D8 PASS)
- Attack suite: 17/17 PASS (tiada regresi)

## 8. Tests (nombor sebenar)
```text
TypeScript            : 0 errors
Vitest                : 25/25 PASS
Build                 : PASS
UI Smoke              : 54/54 PASS
Branch context smoke  : 6/6 PASS
Attack (Phase 3.1)    : 17/17 PASS
Single HTML validation: 73/73 PASS (61 existing + 12 Phase 6 D1–D12)
V9 built-in QA        : 83/83 PASS
JS errors             : 0
Responsive 390px      : PASS
```

## 9. Single HTML
`app/reviews/CURRENT-MEDINI-REVIEW.html` (286 KB) — bermula dengan Login, 4 role, Domain 1 lengkap. Root copy `Medini terbaru/CURRENT-MEDINI-REVIEW.html` identik (disahkan `cmp`).

## 10. Backend Readiness (dokumentasi sahaja — TIDAK dibina)
- **Entities:** Patient, Appointment, FollowUp, TimelineEvent, Communication, Note
- **Reads:** list(scope,filter,search), get360(mrn), timeline(mrn)
- **Mutations:** startFollowUp, completeFollowUp, addNote, bookAppointment
- **Boundaries:** role + branch + doctor scope; audit pada setiap mutation
- **PRODUCTION BACKEND = NOT IMPLEMENTED**

## 11. Files Changed
| Fail | Nota |
|---|---|
| `app/reviews/CURRENT-MEDINI-REVIEW.html` | DomainState layer + P360 upgrade + filter pills sebenar + landing strip + P4/P5 wiring |
| `app/smoke-review.mjs` | +12 Phase 6 tests (D1–D12) |
| `app/smoke-ui.mjs`, `app/smoke-branch.mjs` | port 3001→3000 |
| `docs/PHASE-6-PLAN.md` | 🆕 plan |
| `docs/PHASE-6-LOCKED.md` | 🆕 dokumen ini |
| `docs/CURRENT-STATE.md` | ✏️ Phase 6 = LOCKED |
| `CURRENT-MEDINI-REVIEW.html` (root) | copy identik |

## 12. Deferred Items
Production backend/database/API/auth, real WhatsApp/mutations, P3 bundle & npm audit.

## 13. Remaining Blockers
TIADA.

```text
PHASE 6 — LOCKED ✅
Production Backend — NOT STARTED ⏸️
```
