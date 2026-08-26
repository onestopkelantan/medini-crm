# SPRINT 4 — LOCK RECORD & NEXT SPRINT READINESS

Status: 🔒 **LOCKED** — 2026-08-16 (CI green run `31946929229`, HEAD `b7dd544`)

---

## PART 1 — SPRINT 4 LOCK RECORD

### Kitaran governance penuh
Neo implementation (S4-T1..T5)
→ GLM 5.3 independent forensic audit (🟡 APPROVE WITH REMEDIATION)
→ P1 remediation (3 defect fixed + migration 0010)
→ GLM 5.3 re-audit (🟢 APPROVE for governance)
→ ChatGPT governance review (🟢 APPROVED)
→ Bos approval (🟢)
→ Finalization: cleanup → N-1 repair → verify → commit → push → CI

### Finalization log (16 Aug 2026)
| # | Fasa | Keputusan |
|---|---|---|
| 1 | Audit probe cleanup (`audit-s4b-probe.js`, `audit-s4c-probe.js`) | ✅ dibuang, verified gone |
| 2 | Dev DB clean | ✅ 14 branches, 0 ZBR1/ZBR2, 0 probe residue |
| 3 | N-1 repair | ✅ `clinical_notes_amends_note_id_fkey` restored (ADD CONSTRAINT, migration 0007 untouched) |
| 4 | Schema verify dev==clean replay | ✅ 39 tables / 76 FK / 32 unique idx / 30 checks / 171 indexes / 28 enums / 33 RLS / 39 grants — 0 drift |
| 5 | Full suite | ✅ 326/326 PASS ×3 consecutive, 0 skipped |
| 6 | Typecheck / Lint / Build | ✅ EXIT 0 semua |
| 7 | Frontend MD5 | ✅ `84f3993af955af666d263f364cb37eb6` unchanged |
| 8 | Secrets scan | ✅ tiada hardcoded secrets |
| 9 | Locked migrations 0000–0008 | ✅ byte-identical (git diff empty) |
| 10 | Commit S4 | ✅ `e03d9c5` (30 files: 25 new + 5 modified) |
| 11 | Push | ✅ `main` no-force |
| 12 | CI run 1 (`e03d9c5`) | ❌ FAIL — ci.yml migrate loop tak include 0009/0010 |
| 13 | CI fix | ✅ `d09555a` — tambah 0009+0010 ke migrate loop |
| 14 | CI run 2 (`d09555a`) | ❌ FAIL — 1 test: assert drizzle journal wujud, padahal CI manual-apply (by design tiada tracking table) |
| 15 | Test fix | ✅ `a869496` — assertion environment-agnostic (journal ≥9 ATAU index 0010 wujud) |
| 16 | CI run 3 (`a869496`) | ❌ FAIL — race: P1 spec guna org `...9999d1` = TEST_ORG insurances.spec; parallel purge padam audit rows test lain |
| 17 | Race fix | ✅ `b7dd544` — P1 spec guna org unik `...abc001` (convention unique-org-per-suite); verified 326/326 sequential + parallel mode |
| 18 | CI run 4 (`b7dd544`) | ✅ **SUCCESS** — run `31946929229`, semua 15 steps hijau (Lint/Typecheck/Build/Migrate/Seed/Tests) |

### Lock conditions checklist
| # | Syarat | Status |
|---|---|---|
| 1 | Cleanup complete | ✅ |
| 2 | N-1 repaired | ✅ |
| 3 | Tests ×3 green | ✅ 326/326 |
| 4 | Typecheck | ✅ |
| 5 | Lint | ✅ |
| 6 | Build | ✅  |
| 7 | Diff reviewed | ✅ |
| 8 | GitHub push | ✅ `e03d9c5`→`d09555a`→`a869496`→`b7dd544` |
| 9 | Remote==local | ✅ |
| 10 | CI green | ✅ run `31946929229` (`b7dd544`) — all steps PASS |
| 11 | No secrets | ✅ |
| 12 | No unrelated changes | ✅ |
| 13 | Frontend MD5 unchanged | ✅ |
| 14 | Locked migrations unchanged | ✅ |

---

## PART 2 — NEXT SPRINT READINESS (DISCOVERY ONLY — no code)

> ⚠️ Ikut Section 28/29 master prompt: INI DISCOVERY SAHAJA. Tiada implementasi,
> tiada migration, tiada commit Sprint 5. Menunggu arahan Bos/governance.

### 1. Current locked baseline
- Git HEAD `8ac42d6` (Sprint 3) → Sprint 4: `e03d9c5` (feat) + `d09555a` (ci) + `a869496` (test) di `main`
- Migrations: 0000–0010 applied, 10/10 tracked (dev), clean replay verified
- Schema: 39 tables, 28 enums, 33 RLS tables, money numeric(19,4)
- Test suite: 326 tests / 47 files, 0 skipped, CI = authoritative
- Frontend: `CURRENT-MEDINI-REVIEW.html` MD5-locked, untouched

### 2. Apa Sprint 4 delivered
- **Data foundation (0009):** sale_records, expenses, recurring_commitments, treatment_costs, lab_payables, commission_ledger, commission_payouts, finance_alerts, external_invoice_refs, bukku_sync_records, reconciliation_records + payment_status extension + RLS hq/bm + allocators sal/exp/rec/cst/lab/com/ext
- **Domain:** expense/lab/recurring lifecycles, commission engine (LOCKED 40%), aging, radar rules
- **Services/API:** 38 finance endpoints (sales, revenue, expenses, recurring, treatment costs, lab payables, commissions, alerts, radar)
- **P1 controls:** payout atomicity, duplicate commission (unique org+doctor+period), lab payment concurrency — semua real-concurrency tested
- **Bukku boundary:** AccountingPort + honest UnconfiguredAccountingAdapter

### 3. Outstanding P2/P3 debt (documented, tidak dil fix)
- P2-4 payment_status op · P2-5 DB org predicate · P2-6 radar lengkap · P2-7 aging endpoint · P2-8 recurring double-advance · P2-9 frontend alignment · P2-10 doctor role validation · P3 perf/docs/sale-source/dueDate
- Frontend wiring = governance item berasingan (M-5)
- Real Bukku adapter = Sprint 8

### 4. Dependencies untuk next sprint
- Governance decision: frontend wiring (MD5 lock vs M-5) — blocker terbesar
- CI: extend migrate loop setiap sprint baru tambah migration
- Vitest: workers=1 locally (L-6), CI fine
- Secrets/creds: kekal masked `***`; CI DB password hardcoded sedia ada (dev-only)

### 5. Blueprint references
- `Medini-CRM-Backend/04-SPRINTS/SPRINT-4-DISCOVERY.md` — re-baseline report
- Debt register: M-1..M-6, L-1..L-4, L-6, L-7
- CI pattern: ci.yml manual psql apply (surfaces real errors)
- RLS pattern: 0007 ENABLE+FORCE+WITH CHECK
- Allocator pattern: 0005/0006 sequences per org

### 6. Frontend references
- `CURRENT-MEDINI-REVIEW.html` (MD5 `84f3993af955af666d263f364cb37eb6`) — radar strip L8783, finRebuildAlerts, finBuildLab
- Sprint 4 API frontend-ready (38 endpoints) — wiring perlu governance approval

### 7. Architecture considerations next sprint
- CRM = operational + recording + intelligence + monitoring + alerts (LOCKED)
- BUKAN POS/accounting/invoice issuer/receipt engine/payment gateway/Bukku replacement
- Commission formula LOCKED (Base × 0.40, doctor-only, payout 15/30)
- Aging authoritative: Current/1–30/31–60/61–90/90+
- Money numeric(19,4); allocators milik CRM sahaja

### 8. Potential scope Sprint 5 (cadangan, perlu approval)
- Frontend wiring ke 38 finance endpoints (jika governance unlock MD5)
- P2 batch remediation (P2-4..P2-10)
- Dashboard finance read models (top treatments, radar UI data)
- Atau: Sprint berasingan untuk reports/exports

### 9. Risks
- CI gap pattern: setiap migration baru mesti ditambah ke ci.yml loop (telah berlaku 2x — Sprint 3 & 4)
- Frontend MD5 lock melengahkan nilai delivery ke user hujung
- npm di VPS Fariq kerap crash — deploy perlu build di mesin lain (memory note)
- Shared dev DB: unique org/suite per test run (telah dipatuhi)

### 10. Questions requiring Bos/ChatGPT governance
1. Frontend wiring: unlock MD5 lock untuk wiring Sprint 4 endpoints? (M-5)
2. Sprint 5 scope: frontend wiring vs P2 remediation vs reports — yang mana dulu?
3. P2-8 recurring double-advance — fix sekarang atau dalam sprint batch P2?
4. Bukku sandbox credentials untuk Sprint 8 — bila mula collect?
5. Deploy pipeline VPS — adakah Sprint 5 perlu containerized deploy flow (npm crash issue)?
