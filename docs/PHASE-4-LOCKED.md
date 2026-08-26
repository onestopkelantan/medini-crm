# PHASE 4 — LOCKED (Dashboard Intelligence)

**Locked:** 9 August 2026 · **Baseline:** Phase 3.1 LOCKED (89/89 QA)

## Objective (achieved)
Dashboard berevolusi daripada "display KPI" kepada **decision-support workspace** — apa yang berlaku, apa berubah, apa perlukan perhatian, apa patut diprioritaskan, ikut role.

## Intelligence Capabilities Implemented

| Sub-fasa | Keupayaan | Lokasi |
|---|---|---|
| 4.1 KPI intelligence | Delta % vs tempoh sebelum (appts, revenue, patients, conversion, production) + label period | `IntelKpiStrip` / KPI strip |
| 4.2 Trend/comparative | cur vs prev window, HQ branch-vs-branch, doctor 7d vs prev 7d | engine |
| 4.3 Operational signals | no-show, in-progress load, WA unread, conversion drop, follow-ups | `signals[]` |
| 4.4 Alerts & exceptions | Severity critical/high/medium/info, auto-sorted | Signals panel |
| 4.5 Performance intelligence | completion, utilization, Branch Pulse (HQ), doctor production | `BranchPulsePanel` + drivers |
| 4.6 Cross-domain insights | WA leads × bookings (conversion drop), appts × follow-ups | engine |
| 4.7 Role priority layer | **Recommended Actions** — top-3 ikut severity, per role, dengan WHAT TO DO | Priority/Actions panel |
| 4.8 Decision support | Cadangan deterministic, badge "Rule-based" (bukan AI) | panel badge |
| **Executive Summary** | Satu ayat jujur period-aware di atas dashboard (border teal bila normal, amber bila ada isu) | banner |
| **Key Drivers** | Per-branch contribution & z-score anomaly vs baseline sendiri (HQ); branch-vs-baseline (BM); production trend (Doctor) | drivers block |

## Peningkatan ketara Phase 3 → Phase 4 (review HTML)

- **Phase 3:** dashboard = KPI + widgets + role workspace
- **Phase 4:** dashboard = **Executive Summary banner → KPI delta strip → Recommended Actions (+Key Drivers) → Operational Signals (what+why)** + semua widget Phase 3 kekal

Engine `p4Intelligence()` memulangkan `{ summary, signals, drivers, actions }` — setiap signal ada `what`, `why`, `action`. Period-aware: Daily/Weekly/Monthly/Yearly menukar label & pengiraan. HQ anomaly detection guna z-score lapan window lepas per branch.

## Architecture

```text
Existing Data → api/routers/intelligence.ts (signals)
              → scopeBranch + canViewFinancialTruth (Phase 3.1 helpers)
              → Role filter → Dashboard panels
```

- Satu prosedur canonical: `intelligence.signals` — tiada kalkulasi rawak dalam komponen
- Financial KPI (`revToday`, `revDeltaPct`) = **null** untuk receptionist/doctor (bukan dipadam — null eksplisit)
- Semua signal `deterministic: true` — tiada nombor rekaan

## Role Behavior

| Role | Financial KPI | Priority | Signals | Branch Pulse |
|---|---|---|---|---|
| HQ | ✅ penuh | ✅ enterprise | ✅ | ✅ top/bottom 3 |
| Manager | ✅ scoped branch | ✅ branch | ✅ branch-scoped | — |
| Receptionist | ❌ null | ✅ front-desk | ✅ operational | — |
| Doctor | ❌ null | ✅ clinical | ✅ own-doctor | — |

## Verification Evidence

```text
TypeScript              : 0 errors
Production build        : PASS
Vitest                  : 25/25 PASS (19 Phase 3.1 + 6 Phase 4 isolation)
Attack suite            : 17/17 PASS (Phase 3.1 guarantees preserved)
UI smoke (4 roles)      : 54/54 PASS
Review HTML validation  : 17/17 PASS (file:// open, 0 backend calls, role switching, responsive)
```

## Bug Rollup

**Fixed:**
- P1 — Nested ternary dalam template literal `schedulePanel` pecahkan syntax single-HTML → refactor ke helper `badgeCls()` (template sahaja, logik app tak disentuh)
- P2 — TS6133 unused imports/vars dalam intelligence.ts → dibuang

**Deferred (non-blocking):**
- P3 — Bundle 1.1MB (code-splitting, fasa akan datang)

**Blockers: TIADA.**

## Review Artifact

```text
app/reviews/CURRENT-MEDINI-REVIEW.html  (256 KB, self-contained, V9-BASED)
```

**THE ONE current review build** — nama lama (`PHASE-4-DASHBOARD-REVIEW.html`) diarkibkan ke `_archive/reviews/`. Copy akses-cepat wujud di root projek dengan nama sama.

**Pendekatan final (selepas 2 pembetulan founder):** Review build dibina **di atas V9 itu sendiri** — bukan HTML rekaan baru. Kandungan V9 (13 pages, 4 role workspace, Tooth3D WebGL, Chart.js, Phase 3.1 QA harness `runPhase31QA()` 83 ujian) dikekal 100%. Yang ditambah:

1. **Login gate** — halaman sign-in identity asal Medini (`#0a1f16` emerald, demo grid 4 role: hq/manager/reception/doctor) sebelum masuk app; logout melalui user menu → login semula sebagai role lain
2. **Phase 4 intelligence** (`renderP4Intelligence`) — KPI delta strip + "What Needs Your Attention" + "Operational Signals", diterbitkan secara deterministic dari dataset V9 sedia ada (patients/schedData/waChats/branchWindow), guna token design V9 (glass-card, pill, alertRow)
3. Dua hook satu baris (`setHQPeriod`, `applyBranchContext`) supaya intelligence ikut period/branch

Fix: `tagDashboardWidgets()` dijadikan tahan-anjak (skip `#p4-intel`) supaya tagging positional kekal stabil — tanpa ubah mana-mana widget V9.

## Verification Evidence (final, V9-based)

```text
Single HTML validation    : 30/30 PASS
  ├─ file:// open → login gate first, zero backend calls
  ├─ 4 role login journeys (HQ/BM/Receptionist/Doctor) + logout/login switching
  ├─ V9 content intact (Hero Revenue, KPI cards, Patients page, branch picker)
  ├─ V9 built-in QA harness runPhase31QA: 83/83 PASS
  ├─ P4 intelligence present for all roles; financial truth wiped for receptionist/doctor
  ├─ RBAC: receptionist direct finance route blocked; manager branch locked
  └─ Mobile 390px no overflow, zero JS errors
React app (source of truth): tsc 0 errors · build PASS · Vitest 25/25 · attack 17/17 · UI smoke 54/54
```

## Status

```text
LOCKED
```
