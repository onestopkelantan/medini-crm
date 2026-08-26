# PHASE 4 — GAP ANALYSIS (Audit sebelum implement)

**Tarikh:** 9 Ogos 2026 · **Auditor:** Hermes · **Prinsip:** Jangan declare lengkap sebab function wujud — ukur apa yang user nampak.

---

## A. Apa yang DAH wujud (dan berfungsi)

### React app (`app/` — source of truth)
- `api/routers/intelligence.ts` — prosedur `intelligence.signals` berfungsi: role-scoped, deterministic, financial=null untuk receptionist/doctor. 6 Vitest isolation tests lulus.
- `Dashboard.tsx` — `IntelKpiStrip`, `PriorityPanel`, `SignalsPanel`, `BranchPulsePanel` di-wire ke 3 workspace.
- Phase 3.1: 17/17 attack, 25/25 Vitest, 54/54 UI smoke.

### Review HTML (`CURRENT-MEDINI-REVIEW.html` — V9-based)
- Login gate → 4 role journeys, V9 content 100% intact, V9 QA harness 83/83.
- `renderP4Intelligence()` render KPI strip + Priority + Signals.

## B. Apa yang SEBENARNYA kurang (gap sebenar)

| # | Gap | Kritikal? | Bukti |
|---|---|---|---|
| G1 | **"Why/driver" tidak wujud.** Signals kata "temujanji turun 16%" tapi tak pernah jawab *di mana/kenapa* — walhal V9 ada per-branch daily records untuk kira driver sebenar | 🔴 P1 | `p4Signals()` tiada drill ke branch records |
| G2 | **Tiada recommended actions.** Panel "What Needs Your Attention" senaraikan isu, tapi tiada tindakan konkret peranan-spesifik ("buka waitlist", "call 3 no-show semalam") | 🔴 P1 | Hanya title+why, tiada action |
| G3 | **Tiada executive summary header.** Phase 4 mesti ada lapisan "apa berlaku hari ini" sebelum KPI — sekarang terus KPI cards seperti Phase 3 | 🟠 P2 | Dashboard masih mula dengan KPI grid (Phase 3 layout) |
| G4 | **Period-awareness separuh.** Signal guna `hqDashboardState.period` untuk KPI strip label, tapi signals sendiri tidak berubah makna ikut period (contoh: "no-show hari ini" muncul walau period=Yearly) | 🟠 P2 | `p4Signals()` baca `schedData` (hari ini sahaja) tanpa period context |
| G5 | **HQ tiada branch-anomaly detection.** V9 ada 14 branch × 365 hari — cukup untuk kira "branch X 2σ di bawah baseline sendiri". Sekarang hanya "paling rendah minggu ini" (bukan anomaly) | 🟠 P2 | `p4Signals` HQ branch signal guna min sahaja |
| G6 | **Doctor intelligence cetek.** Ada "rawatan selesai" tapi tiada production trend vs baseline sendiri, walhal `doctorDailyRecords` ada 365 hari | 🟠 P2 | `getDoctorAnalytics` ada tapi p4 tak guna trend |
| G7 | **Cross-domain insight kosong.** Spec minta gabungan (appointments × WA, tasks × appointments). Sekarang signals berasingan, tiada "WA leads tinggi tapi booking rendah → conversion issue" | 🟠 P2 | Tiada signal gabungan |

## C. Keputusan reka bentuk (akan dilaksana)

1. **Naik taraf `p4Signals()` → `p4Intelligence()`** yang pulangkan `{ summary, signals, drivers, actions }` — bukan sekadar senarai.
2. **Driver analysis sebenar:** untuk HQ bila metrik turun, kira sumbangan setiap branch kepada perubahan (branchWindow cur vs prev per branch) → "Primary driver: Sentosa (−42%)". Untuk BM, banding branch vs baseline 30 hari sendiri.
3. **Recommended actions deterministic:** setiap signal severity≥medium dapat action konkret ikut role (HQ: "Semak jadual Sentosa esok", BM: "Call semula 5 no-show", Receptionist: "Follow up 7 mesej belum dibaca", Doctor: "Lengkapkan 3 nota sebelum 6 petang").
4. **Period-aware signals:** bila period=yearly, "hari ini" signals diganti dengan trend tahunan (growth drift dari data).
5. **Anomaly detection:** branch z-score vs baseline sendiri (mean±σ dari 12 window bulan lepas).
6. **Cross-domain:** signal gabungan WA leads↔bookings (conversion drop) & appointments↔follow-ups.
7. Semua dalam design language V9 (glass-card, pill, alertRow). **Tiada redesign.**

## D. Apa yang TIDAK akan disentuh
- React app RBAC/backend (LOCKED 3.1)
- V9 design tokens, 13 pages, Tooth3D, charts
- `runPhase31QA()` (83 tests)
- 14 branches canonical
