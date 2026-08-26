# PHASE 5.1 — LOCKED (Action & Workflow Integrity Hardening)

**Locked:** 9 August 2026 · **Baseline:** Phase 5 LOCKED (43/43 review validation)

## Objective (achieved)
Kuatkan semantik workflow supaya **membuka halaman ≠ menyelesaikan kerja**. Fasa ini memisahkan dengan jelas:

```text
SIGNAL → RECOMMENDED ACTION → DESTINATION → WORK CONTEXT → USER ACTION → WORKFLOW STATE → COMPLETION FEEDBACK
```

## Changes Made

| Komponen | Perubahan |
|---|---|
| `DemoState` | Tambah `actionStarted` + `actionCompleted` (di samping `acknowledged`, `tasksDone`, `followUps`) |
| `p5Status(alertId)` | 🆕 Resolver status semantik: `open → acknowledged → in_progress → completed` |
| `P5_STATUS_LABEL` | 🆕 Label jujur: `✓ Acknowledged` / `● In progress` / `✓ Completed` |
| `p5Execute()` | Set `actionStarted` (BUKAN `acknowledged`); toast `"→ <label> — opened"`; tiada auto-"Done" selepas navigate |
| `p5Complete()` | **HARD GATE** — completion MESTI `actionStarted===true`. `acknowledged` sahaja DITOLAK (tiada shortcut ack→completed). Idempotent: complete semula → "Already completed" |
| `p5Ack()` | Guard backward transition — completed/in_progress tidak boleh jatuh ke acknowledged |
| `p5FollowUp()` | Toast "Follow-up **initiated**" (bukan completed) |
| UI (prioHtml/sigHtml) | Status chip bezakan `In progress` (amber) / `Completed` (teal) / `Acknowledged` (slate); butang `Complete` hanya muncul bila `in_progress` |
| Footer label | "Phase 4 Review Build" → **"Phase 5.1 Review Build"** (buang label lapuk) |

## State Machine (dikunci)

```text
Precedence: completed > in_progress > acknowledged > open

Transitions sah:
  open → acknowledged
  open → in_progress
  acknowledged → in_progress
  in_progress → completed

Haram (ditolak, tiada mutasi):
  open → completed
  acknowledged → completed      ← HARD GATE baharu
  completed → in_progress
  completed → acknowledged
```

## Workflow Model (semantik)

```text
Alert:           Active → Acknowledged
Navigation:      Available → Opened (in_progress)   ← BUKAN completed
Operational:     Pending → Started → Completed (eksplisit)
Follow-up:       Due → Initiated                      ← BUKAN completed
```

**Prinsip dikunci:** `OPEN ≠ ACK ≠ START ≠ COMPLETE`. Tiada kejayaan palsu.

## Action Integrity
Setiap signal kini menjawab: pemicu → siapa boleh → ke mana → apa berlaku serta-merta → state apa berubah → macam mana nak siapkan → apa dashboard tunjuk selepas. Butang `Complete` hanya wujud selepas action dimulakan.

## RBAC / Scope Validation
```text
Receptionist finance action   : BLOCKED (tiada navigate, tiada state mutation)
Doctor finance action         : BLOCKED
Manager cross-branch          : BLOCKED (lapisan V9)
p5Can gate                    : receptionist view_finance=false, view_whatsapp=true
HQ finance/branch             : dibenarkan
```

## Security / Regression Tests
```text
Attack suite (server)      : 17/17 PASS
Vitest (app)               : 25/25 PASS
UI smoke (4 roles)         : 54/54 PASS
Single HTML validation     : 61/61 PASS
  ├─ Phase 3/4 checks      : kekal PASS
  ├─ Phase 5 actions       : kekal PASS
  ├─ Phase 5.1 semantik    : kekal PASS
  └─ 11 mandatory state-machine regression:
      T1  Open → NOT Completed
      T2  Acknowledge → NOT Completed
      T3  Ack→Complete REJECTED (requires Started)     ← hard gate baharu
      T4  Start → In Progress
      T5  Start→Complete → Completed
      T6  Unauthorized exec+complete → no mutation
      T7  Unauthorized exec → no mutation + no nav
      T8  In Progress survives navigation
      T9  Completed survives navigation
      T10 UI label matches actual state
      T11 Completed→Ack blocked (backward transition)
V9 built-in QA             : 83/83 PASS
```

## TypeScript / Build
```text
npx tsc -b     : 0 errors
npm run build  : PASS
```

## Responsive / JS Error QA
```text
390px mobile: tiada horizontal overflow
JS errors   : 0 merentas keseluruhan journey 4 role
```

## Files Changed
| Fail | Nota |
|---|---|
| `app/reviews/CURRENT-MEDINI-REVIEW.html` | DemoState semantik + p5Status + p5Complete + p5Execute/ack/followUp hardened + UI status chips |
| `app/smoke-review.mjs` | +7 Phase 5.1 semantik checks |
| `docs/PHASE-5.1-LOCKED.md` | 🆕 dokumen ini |
| `docs/CURRENT-STATE.md` | ✏️ Phase 5.1 = LOCKED |

## Deferred Items (bukan skop fasa ini)
- Production backend / database / API / auth sebenar
- Real WhatsApp integration, real mutations, real audit log, real notifications
- P3: bundle size, npm audit dev-deps

## Remaining Blockers
TIADA.

## Final Verdict
Phase 5.1 HARDENED — workflow kini jujur secara semantik (tiada auto-complete pada navigasi), RBAC/scope kekal ketat, semua ujian hijau.

```text
PHASE 5   — LOCKED ✅
PHASE 5.1 — LOCKED ✅
PHASE 6   — NOT STARTED ⏸️
```
