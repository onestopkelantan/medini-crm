# PHASE 5 — LOCKED (Action & Workflow Dashboard)

**Locked:** 9 August 2026 · **Baseline:** Phase 4 LOCKED (35/35 review validation)

## Objective (achieved)
Ubah dashboard daripada "ini masalahnya" kepada **"ini masalahnya → ini tindakan → ini langkah seterusnya"**.

```text
Phase 4 = INTELLIGENCE  (apa berlaku, kenapa, apa perlu perhatian)
Phase 5 = ACTION + WORKFLOW  (apa yang user boleh BUAT tentangnya)
```

## Action Architecture (nama sebenar dalam implementasi)

| Komponen | Fungsi |
|---|---|
| `DemoState` | Lapisan state demo koheren (`acknowledged`, `tasksDone`, `followUps`) — overlay pada dataset V9, bukan hardcode bertaburan |
| `P5_ROLE_ACTIONS` | Matriks role → domain tindakan yang dibenarkan (gate setara server) |
| `p5Can(action)` | Gate RBAC — semak role semasa dibenarkan domain tindakan |
| `P5_ACTIONS` | ActionRegistry — petakan jenis signal → action + label + destination + filter |
| `p5ResolveAction(signal)` | ActionResolver — pulangkan action hanya jika role dibenarkan (RBAC) |
| `p5Execute(...)` | DestinationResolver + executor — navigate + filter + acknowledge + toast |
| `p5Ack / p5MarkTask / p5FollowUp` | Workflow micro-actions dengan kemas kini state |
| `p5QuickActions / p5Quick` | Quick actions per role (gaya btn V9) |

## Aliran kerja yang berfungsi (disahkan)

```text
Phase 4 signal (contoh: "12 mesej WhatsApp belum dibaca")
   ↓ klik row / butang action
p5Execute → showPage('whatsapp') + waApplyScope()
   ↓
Destination terbuka (WhatsApp, scoped)
   ↓
DemoState.acknowledged[alertId]=true → toast "✓ Open WhatsApp leads"
   ↓
renderP4Intelligence() → row bertukar "✓ Acknowledged"
```

## Role Action Matrix

| Action domain | HQ | Manager | Receptionist | Doctor |
|---|---|---|---|---|
| view_branch / view_finance / view_reports / view_performance | ✅ | ❌ | ❌ | ❌ |
| view_appointments / view_whatsapp / view_patients | ✅ | ✅ | ✅ | ✅(schedule/patients) |
| view_tasks / assign_task / review_branch | ✅ | ✅ | ❌ | ❌ |
| frontdesk_task / follow_up | ❌ | ❌ | ✅ | ✅(follow_up) |
| clinical_task | ❌ | ❌ | ❌ | ✅ |
| ack_alert | ✅ | ✅ | ✅ | ✅ |

## Security (tiada regresi)
- Receptionist `view_finance` action → **BLOCKED** (`p5Can` false, tiada navigasi)
- Doctor `view_finance` → **BLOCKED**
- Manager `setGlobalBranch('pearl')` (cross-branch) → **BLOCKED** oleh lapisan V9
- `p5Can` gate disahkan: receptionist `view_finance`=false, `view_whatsapp`=true
- Phase 3.1 guarantees kekal: 17/17 attack, 25/25 Vitest

## Verification Evidence

```text
Single HTML validation : 43/43 PASS
  ├─ Phase 4 checks (35) kekal PASS
  └─ Phase 5 checks (8 baru):
      9. HQ quick actions render
     10. Receptionist finance action BLOCKED
     11. Doctor finance action BLOCKED
     12. Manager cross-branch BLOCKED
     13. Action → WhatsApp destination
     14. Acknowledge updates DemoState
     15. Quick action navigates
     16. p5Can RBAC gate
React app              : tsc 0 err · build PASS · Vitest 25/25 · attack 17/17
Scripts syntax         : 6/6 OK · 269 KB self-contained
```

## Role Validation
```text
HQ:           PASS
Branch Manager: PASS
Receptionist: PASS
Doctor:       PASS
```

## Branch
```text
14 (canonical, tiada perubahan)
```

## Bugs
**Fixed:**
- P1 — Role key mismatch: V9 guna `'receptionist'` tetapi `P5_ROLE_ACTIONS`/`p5QuickActions` guna `'branch_admin'` → receptionist tiada actions. Dibetulkan pada kedua-dua peta.

**Deferred (non-blocking):** P3 bundle size, npm audit dev-deps

**Remaining blockers:** TIADA

## Single HTML
```text
app/reviews/CURRENT-MEDINI-REVIEW.html  (269 KB)
+ root copy: Medini terbaru/CURRENT-MEDINI-REVIEW.html
file:// open · login 4 role · logout/login · P4 intelligence · P5 actions ·
destination nav · workflow state · responsive 390px · 0 JS errors · no backend
```

## Files Changed
| Fail | Nota |
|---|---|
| `app/reviews/CURRENT-MEDINI-REVIEW.html` | +Phase 5 engine (DemoState, P5_ROLE_ACTIONS, P5_ACTIONS, resolver, execute, micro-actions, quick actions) + actionable signals/actions UI |
| `app/smoke-review.mjs` | +8 Phase 5 validation checks |
| `docs/PHASE-5-LOCKED.md` | 🆕 dokumen ini |
| `docs/CURRENT-STATE.md` | ✏️ Phase 5 = LOCKED, QA counts |

## Status
```text
LOCKED
```
