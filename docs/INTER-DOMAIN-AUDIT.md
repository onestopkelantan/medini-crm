# M1 — Inter-Domain Integration Audit (v1.1)
**File audited:** `CURRENT-MEDINI-REVIEW.html` (root ↔ `app/reviews/` byte-identical, md5 `b9e6ef60…`)
**Date:** 14 Ogos 2026 · **Mode:** read-only audit (tiada perubahan tingkah laku app)
**Baseline:** 738 tests PASS (existing harness `app/smoke-review.mjs`)

> **Payment model (locked):** Medini CRM = **Payment Status / Confirmation Layer**, BUKAN payment gateway.
> Payment sebenar berlaku di luar (FPX/Card/etc). CRM hanya rekod `PENDING / PAID / OVERDUE`.

---

## AUDIT DIMENSIONS (9)

### D1 — Duplicated Data
| # | Lokasi | Severity | Finding | Impact | Fix |
|---|---|---|---|---|---|
| D1.1 | `patients` array (2454) + `ADM.staff` (4624) | P2 | Dua entity list berasingan (patients vs staff) — ini **betul** (patient ≠ staff), tiada duplicate. | — | Verified |
| D1.2 | `patients.bal` (2454) vs `FIN.invoices[].outstanding` (8383) | **P1** | Patient `bal` (outstanding) disimpan di `patients` array DAN dikira dari `FIN.invoices`. Dua sumber truth untuk baki. | Data boleh bercanggah — `bal` static, `outstanding` dari invoices. | **Fasa 2:** derive patient financial context dari FIN.invoices sahaja (single source). `patients.bal` jadi read-only cache atau buang. |
| D1.3 | `RELATIONSHIPS` (2512) — family/referral data | P2 | Family/referral disimpan dalam object berasingan, keyed by MRN. Tiada duplicate — betul. | — | Verified |
| D1.4 | `DOCTOR_MASTER` (1845) vs `ADM.staff` (doctor entries) | P1 | Doctor wujud dalam `DOCTOR_MASTER` (id, name, branchId) DAN dalam `ADM.staff` (name, role=doctor, branch). Nama sama (Dr. Mei Ling) tapi ID berbeza. | Doctor identity tak konsisten — clinical guna DOCTOR_MASTER, admin guna ADM.staff. | **Fasa 2:** link ADM.staff ↔ DOCTOR_MASTER melalui canonical `doctorId`. |
| D1.5 | `WAH.channels` (4078) — session per branch | P2 | WhatsApp channels keyed by branch, satu per branch. Betul (1 fon = 1 session). | — | Verified |

### D2 — Duplicated Calculations
| # | Lokasi | Severity | Finding | Impact | Fix |
|---|---|---|---|---|---|
| D2.1 | `getAnalytics()` (1759) + `getRoleAnalytics()` (5049) + `getBranchMetrics()` (1979) | P2 | `getRoleAnalytics` delegate ke `getAnalytics` — **tiada duplicate calculation**, hanya wrapper. Betul. | — | Verified |
| D2.2 | `getBranchRevenue()` (1989) + `getBranchAppointments()` (1990) + `getBranchPatients()` (1991) | P2 | Wrapper functions delegate ke `getAnalytics` — tiada duplicate logic. | — | Verified |
| D2.3 | `finSum()` (8476) + `finSc()` (8474) + `finCanSeeBranch()` (8475) | P2 | Finance scope helpers — centralised dalam FIN module. Tiada duplicate. | — | Verified |
| D2.4 | `branchDailyRecords()` (1637) — deterministic per-branch data | P2 | Single source untuk branch analytics. Semua consumer guna ini. | — | Verified |
| D2.5 | `RPT_KPIS` (3747) — KPI definitions | P2 | Reports define KPI, derive dari domain. Tiada duplicate calculation — betul. | — | Verified |

### D3 — Role Leakage
| # | Lokasi | Severity | Finding | Impact | Fix |
|---|---|---|---|---|---|
| D3.1 | `openP360()` (3551) → `canSeeFinancials()` (5101) | **P0** | Patient 360 tunjuk `Outstanding` (bal) kepada **HQ dan Branch Manager sahaja** (`canSeeFinancials`). **Doctor dan Receptionist tak nampak** — betul untuk sekarang. Tapi tiada **explicit payment status** untuk Doctor/Receptionist. | Doctor tak boleh nampak payment status own patients (required by M1). Receptionist tak boleh update payment status. | **Fasa 1b:** buat `getVisiblePaymentStatusForCurrentUser()` accessor. Doctor → own patients. Receptionist → own branch + update permission. |
| D3.2 | `wipeOutOfScopeWidgets()` (5103) | P2 | UI widgets kosong bila role takde access — ini **UI hiding**, bukan permission enforcement. | Takde service-level enforcement — function masih boleh dipanggil. | **Fasa 1b:** PERMISSION_MATRIX + accessor pattern (bukan UI hiding). |
| D3.3 | `ROLE_NAVIGATION` (4985) — page access | P2 | Page access restricted per role — betul. Tapi `canAccessPage()` hanya check list, takde action-level granularity. | Page-level sahaja — tak boleh control action dalam page. | **Fasa 1b:** ROLE_DOMAIN_MATRIX dengan View/Create/Edit/Submit/Approve/Delete per domain. |
| D3.4 | `scopeByBranchDoctor()` (5079) — doctor scope | P2 | Doctor restricted to own branch + own doctor — **betul, enforced**. | — | Verified |
| D3.5 | `P5_ROLE_ACTIONS` (5828) + `p5Can()` (5835) | P2 | Role actions untuk P5 (WhatsApp Hub) — centralised. Betul. | — | Verified |

### D4 — Cross-Domain Disconnects
| # | Lokasi | Severity | Finding | Impact | Fix |
|---|---|---|---|---|---|
| D4.1 | `patients` → `appts` (appointments) | P2 | `openP360` cari next appointment dengan `a.p && p.name.toLowerCase().includes(a.p.toLowerCase())` — **fuzzy name matching**, bukan canonical `patientId` link. | Appointment takde direct `patientId` — link lemah. | **Fasa 2:** tambah `patientId` (MRN) ke appointment records. |
| D4.2 | `patients` → `FIN.invoices` | P2 | `FIN.invoices` ada `patient: p.name, mrn: p.mrn` — **MRN link wujud** (betul). Tapi `patients.bal` tak derive dari invoices. | Patient financial context tak synchronised. | **Fasa 2:** derive patient balance dari FIN.invoices (single source). |
| D4.3 | `patients` → `D3State` (clinical) | P2 | Clinical records keyed by MRN (`D3State.teeth[mrn]`) — **link wujud** (betul). | — | Verified |
| D4.4 | `WAH.channels` → `patients` | P2 | WhatsApp channels keyed by branch, tiada direct patient link. Conversation resolution perlu `conversationId → patientId`. | WhatsApp conversation tak resolve ke patient automatically. | **Fasa 1b:** CROSS_DOMAIN_EVENTS + WhatsApp readiness contract. |
| D4.5 | `branchId` consistency | P2 | `patients.branchId`, `WAH.channels.branch`, `FIN.invoices.branch`, `ADM.staff.branch` — semua guna branch ID string. Konsisten. | — | Verified |

### D5 — Inconsistent IDs
| # | Lokasi | Severity | Finding | Impact | Fix |
|---|---|---|---|---|---|
| D5.1 | Patient ID = `mrn` (MDN-XXXX) | P2 | Canonical patient ID = MRN. Digunakan konsisten merentas patients, appointments (fuzzy), clinical, finance. | — | Verified |
| D5.2 | Doctor ID | **P1** | `DOCTOR_MASTER.id` = `dr-aina`, `dr-rizal` etc. `ADM.staff.id` = `ST-002`, `ST-003`. `FIN.invoices.doctorId` = `dr-aina` (dari DOCTOR_MASTER). | Doctor identity tak unified — clinical/finance guna `dr-*`, admin guna `ST-*`. | **Fasa 2:** canonical `doctorId` merentas semua domain. ADM.staff link ke DOCTOR_MASTER. |
| D5.3 | Branch ID | P2 | `gelang-patah`, `sentosa`, etc. — konsisten merentas semua domain. | — | Verified |
| D5.4 | Appointment ID | P2 | Tiada explicit appointment ID — appointments keyed by index/array position. | Tiada canonical appointment reference. | **Fasa 2:** tambah `appointmentId` ke appointment records. |
| D5.5 | Invoice ID | P2 | `INV-2026-XXXX` — konsisten dalam FIN module. | — | Verified |

### D6 — Hardcoded Financial Values
| # | Lokasi | Severity | Finding | Impact | Fix |
|---|---|---|---|---|---|
| D6.1 | `finBuild()` (8367) — demo financial data | P2 | `mulberry32` deterministic PRNG untuk generate invoices/payments/expenses — **deterministic demo data**, betul untuk prototype. | — | Verified (demo data, not accidental hardcoding) |
| D6.2 | `patients.bal` (2454) | P1 | Hardcoded balance values (0, 450, 1200, 320, 85) dalam patient records. | Static — tak derive dari invoices. | **Fasa 2:** derive dari FIN.invoices. |
| D6.3 | `FIN_CFG.expenseCategories`, `FIN_CFG.approvalThreshold` | P2 | Config values dalam FIN_CFG — betul (configuration, bukan magic numbers). | — | Verified |
| D6.4 | `RPT_KPIS` — KPI targets | P2 | KPI definitions dengan unit — betul (definitions, bukan hardcoded values). | — | Verified |

### D7 — Hardcoded Role Logic
| # | Lokasi | Severity | Finding | Impact | Fix |
|---|---|---|---|---|---|
| D7.1 | `canSeeFinancials()` (5101) — `role === 'hq' \|\| role === 'branch_manager'` | P2 | Role check dalam function — **legitimate presentation logic** untuk widget visibility. | — | Verified (presentation, not permission) |
| D7.2 | `getDashboardContext()` (5034) — role-based analytics query | P2 | Role determines analytics scope — **legitimate business logic**. | — | Verified |
| D7.3 | `P5_ROLE_ACTIONS` (5828) — role actions | P2 | Centralised role actions — betul. | — | Verified |
| D7.4 | `ROLE_WIDGETS` (4994) — widget composition | P2 | Role determines widget set — **presentation logic**. | — | Verified |
| D7.5 | **Missing:** Central PERMISSION_MATRIX | **P1** | Tiada central `can(role, domain, action)` function. Role logic scattered across `canSeeFinancials`, `p5Can`, `ROLE_NAVIGATION`, `canAccessPage`. | Permission logic tak unified — susah maintain, susah test. | **Fasa 1b:** PERMISSION_MATRIX + `can()` function. |

### D8 — Ownership Violations
| # | Lokasi | Severity | Finding | Impact | Fix |
|---|---|---|---|---|---|
| D8.1 | Reports read-only | P2 | `RPT_KPIS` define KPI, derive dari `getRoleAnalytics` — **Reports tak mutate source data**. Betul. | — | Verified |
| D8.2 | Dashboard read-only | P2 | Dashboard consume `getAnalytics` — tak mutate source. Betul. | — | Verified |
| D8.3 | Finance ownership | P2 | `FIN.invoices`, `FIN.payments`, `FIN.expenses` — Finance own data. Betul. | — | Verified |
| D8.4 | WhatsApp ownership | P2 | `WAH.channels`, `WAH.audit` — WhatsApp own data. Betul. | — | Verified |
| D8.5 | **Missing:** Explicit ownership registry | P1 | Tiada `DATA_OWNERSHIP` map yang declare siapa own apa. Ownership implicit dalam code structure. | Ownership tak documented — susah enforce. | **Fasa 1b:** DATA_OWNERSHIP contract. |

### D9 — Reports Duplicate Source
| # | Lokasi | Severity | Finding | Impact | Fix |
|---|---|---|---|---|---|
| D9.1 | `RPT_KPIS` (3747) | P2 | Reports define KPI, derive dari domain — **tiada duplicate source data**. Betul. | — | Verified |
| D9.2 | `getRoleAnalytics()` → Reports | P2 | Reports guna same analytics engine — tiada recalculation. Betul. | — | Verified |
| D9.3 | `finBuildTrend()` (8445) | P2 | Finance build trend data — Reports consume, tak duplicate. Betul. | — | Verified |

---

## PAYMENT AUDIT — VERIFICATION

| Claim | Verified | Evidence |
|---|---|---|
| `PAYMENT_RECEIVED` event tak wujud | ✅ | 0 matches dalam HTML |
| `paymentStatus` accessor tak wujud | ✅ | 0 matches |
| PAID/PENDING minimal placeholder | ✅ | `PAID` 17 matches — mostly dalam FIN.invoice status (`'Paid'`, `'Partially Paid'`, `'Issued'`, `'Overdue'`, `'Draft'`) dan WAH channel status. Tiada unified payment status model. |
| Receipt generation tak wujud | ✅ | 0 matches untuk `receipt` |
| Bukku P4 Real API | ✅ | 271 matches — `BUKKU.creds`, `bukkuApiUrl()`, `api.bukku.my`, `bukkuCreds` dalam localStorage. **Protected — tak sentuh.** |
| Payment status dalam Finance | ✅ | `FIN.invoices[].status` = Paid/Partially Paid/Issued/Overdue/Draft. `FIN.payments[].status` = Completed. Tiada `PENDING/PAID/OVERDUE` unified model. |

### Payment Architecture Gap
- **Sekarang:** Finance guna invoice status (`Paid`, `Partially Paid`, `Issued`, `Overdue`, `Draft`) — ini **accounting invoice lifecycle**, bukan simple payment status.
- **Required (M1):** `PENDING / PAID / OVERDUE` — simple payment status yang Receptionist boleh update selepas external payment.
- **Gap:** Tiada unified payment status model. Tiada accessor untuk role-based payment visibility.

---

## SUMMARY

| Severity | Count | Items |
|---|---|---|
| **P0** (Security/Role Leak) | 1 | D3.1 — Doctor/Receptionist takde payment status access (required by M1) |
| **P1** (Data/Integration) | 5 | D1.2 (patients.bal duplicate), D1.4 (doctor identity), D5.2 (doctor ID), D6.2 (patients.bal hardcoded), D7.5 (no PERMISSION_MATRIX), D8.5 (no DATA_OWNERSHIP) |
| **P2** (Refactor/Cosmetic) | 25+ | Mostly verified — existing architecture sudah baik |

### Verified Strengths (tiada issue)
- ✅ Role-based navigation (`ROLE_NAVIGATION`)
- ✅ Branch scope enforcement (`scopeByBranch`, `scopeByBranchDoctor`)
- ✅ Patient 360 scope guard (`openP360` check)
- ✅ Finance scope helpers (`finSc`, `finCanSeeBranch`)
- ✅ Reports read-only, derive dari domain
- ✅ Deterministic demo data (`mulberry32` PRNG)
- ✅ Bukku P4 Real API (protected)
- ✅ WhatsApp branch scope (`WAH.channels` per branch)

### Key Gaps (perlu Fasa 1b contract layer)
1. **Tiada unified payment status model** — `PENDING/PAID/OVERDUE` belum wujud
2. **Tiada role-based payment accessor** — Doctor/Receptionist tak boleh nampak/update payment status
3. **Tiada central PERMISSION_MATRIX** — role logic scattered
4. **Tiada DATA_OWNERSHIP registry** — ownership implicit
5. **Tiada CROSS_DOMAIN_EVENTS** — event contract belum define
6. **Doctor identity tak unified** — `DOCTOR_MASTER` vs `ADM.staff`

---

## NEXT: FASA 1B — CONTRACT LAYER

Berdasarkan audit ni, Fasa 1b akan establish:
- `window.MEDINI_ARCHITECTURE` dengan 5 komponen (DOMAIN_REGISTRY, ROLE_DOMAIN_MATRIX, DATA_OWNERSHIP, CROSS_DOMAIN_EVENTS, PERMISSION_MATRIX)
- Payment status model (`PENDING/PAID/OVERDUE`) + accessor pattern
- `can(role, domain, action, context)` function
- Contract tests (`ct01...`)

**Bukku P4 Real API — PROTECTED. Tak sentuh.**
