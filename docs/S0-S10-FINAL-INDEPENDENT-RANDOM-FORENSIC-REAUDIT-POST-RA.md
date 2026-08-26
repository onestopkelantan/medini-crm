# FINAL INDEPENDENT RE-AUDIT — RESULT

**Checkpoint:** `06ad2c60be6649ce4073c3b53e34ac303cd453e9` (verified dari Git)
**Tarikh:** 2026-08-23 · **Auditor:** GLM 5.3 (Independent Forensic Security Auditor)
**Kaedah:** Clean forensic replay + random sampling + adversarial probes + full regression. Runtime evidence > claims. READ-ONLY.

## Overall Verdict: CONDITIONAL — READY FOR GOVERNANCE REVIEW AFTER PRA-1 FIX

**Critical: 0 · High: 0 · Medium: 1 · Low: 3 · Info: 2 · Blocking: 0**

**Test Suite: 595/595 (91/91 files)**

| Dimensi | Verdict |
|---------|---------|
| Security | **PASS** |
| Functional | **PASS** |
| Infrastructure | **PASS** |
| Operations | **CONDITIONAL** (prasyarat go-live) |
| Governance | **PASS** (dengan PRA-1 wajib difix sebelum push) |

---

## 1. Executive Summary

Audit bebas penuh pada HEAD `06ad2c6` (post-remediation RA-1/RA-2/RA-3). Semua 26+3 commits verified dari Git. Replay forensik bersih **zero schema drift** pada peringkat definisi (md5). RA-1 **PASS** (CI kini journal-driven + drift-proof, dibuktikan adversarial). RA-3 **PASS dengan 1 gap kecil** (PRA-2). **RA-2 FAIL**: gate typecheck CI frontend adalah **NO-OP** — `npx tsc --noEmit` di root `app/` tidak memeriksa sebarang fail (root tsconfig `files: []` + references sahaja), sentiasa EXIT 0, manakala typecheck sebenar masih **38 errors**. Lint/build gate berfungsi. Ini false-pass CI — bukan defect runtime, tapi melanggar tujuan RA-2 sepenuhnya.

**Kesimpulan utama: produk runtime selamat & coherent (0 CRITICAL/HIGH, F-02/F-05/F11-1 semua re-verified dengan bukti runtime baharu), regression 595/595, semua 8 attack chains baharu TAHAN. Satu-satunya blocker kepada "READY FOR GITHUB" ialah PRA-1 (MEDIUM, CI false-pass) — fix ~1 jam. Selepas PRA-1 + RA-2 residual type errors diperbaiki dan di-re-audit secara targeted, repos ini READY untuk ChatGPT Governance Review.**

---

## 2. Governance Verification (Phase A) — ✅

- HEAD = `06ad2c6` pada `main`; baseline `5eb40fd` ancestor; 30 commits baseline→HEAD
- 3 commits baharu selepas audit lepas (`fa4ce61` RA-3, `d0131fb` RA-1+RA-2, `06ad2c6` docs) — **linear, tiada rewrite** (reflog bersih)
- **Laporan audit lepas di-commit VERBATIM** (verdict 🟢 intact) — tiada pemalsuan
- Diff scope = tepat: 16 controllers + ci.yml + 2 spec + 2 docs sahaja
- Tiada `.env`/secrets tracked; untracked kosong; **journal 31 entries == 31 fail, idx contiguous 0..30**

## 3. Clean Replay (Phase B) — ✅ ZERO SCHEMA DRIFT

DB forensik **segar** `medini_fa` (tiada reuse). 31/31 migrasi, ON_ERROR_STOP=1.

Fingerprint md5 definition-level vs `medini_dev` — **IDENTIK**: policy / index / column / enum / RLS-state / grant / **function-def (pg_get_functiondef)**.

Beza dijelaskan & dibuktikan benign: (a) constraint names = OID system-generated (`2200_<oid>_N_not_null`) — normalized md5 **identik**; (b) sequences 61 vs 14 = 47 org-seq runtime (`_<8-hex>` suffix, dicipta org-allocator yang **function-def md5 identik**) + last_value runtime; (c) `migrations=70` (alias tables) match. Angka: 70 tables / 302 policies / 269 idx / 823 constraints / 56 enums / 6 fns / 989 cols / 689 grants / 70 RLS-enabled / 66 FORCE RLS.

## 4. RA-1 Verification (Phase C) — ✅ **PASS**

- ci.yml migrate step kini **journal-driven**: `jq` derive journal tags → 1:1 cross-check on-disk files → count mismatch / item mismatch `exit 1`
- Hardcoded 0028 list **dihapus** sepenuhnya
- **Fingerprint step** (tables=70/policies=302/rls_enabled=70) diverifikasi terhadap replay saya sendiri — semua match; drift masa depan gagal loud
- **Adversarial sandbox** (copy temp; repo tidak disentuh): tambah `0099_rogue.sql` → **TERTANGKAP**; padam 0031 → **TERTANGKAP**
- Spec `ra1-schema-drift.spec.ts` (5 tests): journal contiguity, journal==files, range 0031, tiada hardcoded total, fixture reuse guard (`DROP DATABASE` + policy-count assertion)

## 5. RA-2 Verification (Phase D) — ❌ **FAIL**

**🔴 PRA-1 (MEDIUM) — CI frontend typecheck gate = NO-OP (false pass)**
- CI: `npx tsc --noEmit` (cwd `app/`) → root `tsconfig.json` = `files: []` + `references` → **tsc memeriksa 0 fail, sentiasa EXIT 0**
- Bukti terkawal: `tsc --noEmit` = EXIT 0/0 errors; `tsc -b` = EXIT 2/**38 errors**; `tsc -p tsconfig.app.json --noEmit` = 3 errors (`AppLayout.tsx` TS2339 email/AuthUser; `api.ts` TS1294 ×2 erasableSyntaxOnly; baki 35 `db/seed.ts` TS18046/TS2571 unknown)
- Kesannya: CI frontend **hijau hari ini walaupun type broken** — RA-2 claim "mandatory typecheck" tidak disampaikan
- Yang berfungsi: frontend job wujud, lint EXIT 0, build EXIT 0, triggers `app/**`, tiada `continue-on-error`/`|| true` sebenar (hanya dalam komen)
- **Fix (cadangan):** tukar command kepada `npx tsc -b` (atau `tsc -p tsconfig.app.json --noEmit`) DAN perbaiki 38 errors. Blocking? **Ya untuk "READY FOR GITHUB"** (tujuan gate), bukan untuk runtime.

## 6. RA-3 Verification (Phase E) — ⚠️ PASS (1 gap kecil)

Live (backend dist, HTTP sebenar):
- malformed `not-a-valid-uuid` → **400 BAD_REQUEST** ✅
- SQLi payload UUID (`'; SELECT pg_sleep(5)--`, `...' OR '1'='1`) → **400** ✅ (pipe menolak sebelum DB)
- valid nonexistent → **404 NOT_FOUND** ✅; valid random → **404** ✅
- ParseUUIDPipe pada **83/87** `@Param` (16 controllers + auth/register)
- **PRA-2 (LOW):** `plans.controller.ts` `@Param('itemId')` (route `items/:itemId/status`) tiada pipe. Live: 403 fail-closed untuk SEMUA role semasa (route perlukan konteks scope yang tiada pada route itu — `can()` DENY), jadi tiada 500 boleh dicapai melalui jalur semasa; latent sahaja. Settings `'key'` ×3 = string param, by design.
- **Tiada regresi auth**: IDOR/RLS semantics tidak berubah (re-verified Phase I)

## 7. Backend Connectivity (Phase F) — ✅ 20/20

Route sample setiap domain (Auth me, Admin org/staff, Patients, Appointments, Encounters, Treatment plans, Finance expenses/commissions, Marketing, Operations, WhatsApp conversations, Settings definitions/secrets, AI agents/guardrails, Reports treatment-mix, Dashboard context, Payors panels/insurances): **semua 200/403/404 coherent — tiada dead route, tiada 500**. (Nota: prefix versi `/api/v1/` diperlukan; kesilapan prefix awal auditor, bukan defect.)

## 8. Random Sampling Methodology

Seed deterministik 20260823–20260827: controllers (25 populasi, 10 sampel RA lepas + verification penuh `@Param` 87), services (32/10), repositories (17/10), tables (5 random), policies (5 random), GUC contexts (worker/developer/hq/doctor/bm), attack chains 8 gabungan.

## 9–11. Authentication / RBAC / RLS / IDOR (Phases H+I) — ✅

- Login 4 role 200; wrong-pw 401 (message seragam); JWT attacks 5/5 → 401 (tampered/alg-none/empty/null/Basic)
- JWT claims minimal (sub/username/orgId/iat/exp/aud/iss — **role tiada dalam token**; PrincipalResolver re-derive dari DB setiap request, fail-closed)
- Refresh: rotate 200 → reuse-old 401 → new 200 → logout 200 → post-logout 401
- Registration: garbage/SQLi/empty token → 400
- **F-02 retest (fresh replay DB, medini_app, doctor context):** INSERT staff hq → **RLS violation `f02_staff_doctor_insert_hq_deny`**; UPDATE→hq → **0 rows + policy**; DELETE hq → **permission denied**; SELECT = by-design
- **GUC spoof adversarial:** set role=hq+orgA → orgA staff 5 rows, **orgB = 0** ✅; worker context → staff 2 (s8 worker read allowed by design) tapi **encounters 0**; developer → **staff 0, secret_refs 0**

## 12–14. IDOR / Database Security / SECURITY DEFINER (Phases I+J) — ✅

- IDOR: fake UUID → 404 (doctor+manager); branchId forged → 403
- 6 fungsi public: 5 GUC readers (SECURITY INVOKER, PUBLIC execute — by design read-only `current_setting`) + `register_staff_with_token` (DEFINER, owner=medini, `search_path=pg_catalog,public` pinned, EXECUTE medini+medini_app sahaja)
- **F-05 probes (semua ✅ DITOLAK):** cross-org tokenA+orgB → `Invalid or expired invitation`; cross-org tokenB+orgA → sama; legitimate → OK (Pending, token consumed); reuse → ditolak; expired → `Invitation has expired`; non-Invited (Active) → `already used or invalid`; garbage → ditolak
- **Privilege escalation:** `CREATE TABLE` → permission denied; `SET ROLE medini` → permission denied; `SET search_path=evil,public` + call → fungsi immune (pinned), ditolak atas token sahaja; fungsi tak sentuh `role` (set status='Pending' + NULL token sahaja)

## 15–17. API Validation / Rate Limit / Trust Proxy (Phases K+L) — ✅

- Mass assignment (extra fields) → **422**; SQLi dalam field → **422**; null/array body → **422**; string body → 400
- **PRA-3 (LOW):** oversized 1MB → **500 bukan 413** — body-parser limit **BERFUNGSI** (log: `PayloadTooLargeError: request entity too large`, payload tidak diproses) tetapi bukan HttpException Nest → catch-all 500. Mapping sahaja salah.
- Login rate-limit: 5 attempts → **429**; registration throttled → 429
- **XFF spoof 7 IP berbeza → 429 kekal** (trust-proxy betul; per-IP limit tak boleh dipusing melalui header)

## 18. WAHA (Phase M) — ✅

Adapter: API-key header, timeout/abort, session config. Anti-ban: **daily cap + cooldown + warming** (whatsapp-lifecycle.ts + transport worker). Prod compose: WAHA commented dengan keperluan strong key didokumenkan, `DASHBOARD_ENABLED=false`, `SWAGGER_ENABLED=false`. Dev container `waha-medini` Up 4h (sesi dev). Tiada mesej pelanggan sebenar dihantar (read-only).

## 19. Backup/PITR/RPO (Phase N) — ✅ (scripts)

5 skrip: backup.sh (pg_dump→gzip→**sha256**→retention 30d, `set -euo pipefail`, fail-closed), wal-archive.sh, **pitr-rehearsal.sh**, restore-rehearsal.sh, wal-retain.sh. MONITORING.md mendokumenkan RPO+PITR. Prasyarat operasional: schedule aktif + rehearsal berkala di staging (carry-forward).

## 20. Monitoring/Alertmanager (Phase O) — ✅ F11-1 RE-VERIFIED

Boot test container baharu dengan config HEAD: **`status: ready`**, config original loaded penuh, **0 restarts**. Incident runbook (B-2) kekal dalam MONITORING.md.

## 21. Infrastructure (Phase P) — ✅

Ports 80/443 sahaja; tiada docker.sock/privileged; backend `Dockerfile.prod` USER medini non-root; Caddy: HSTS preload + X-Frame + nosniff + Referrer-Policy + `-Server`; `/metrics` public → 404 (Caddy); 4 healthchecks; 15 restart policies. PG/Redis/WAHA tiada exposure awam.

## 22. Secrets/Dependencies (Phase Q) — ✅

Scan pola (JWT/API-key/private-key, exclude placeholders/tests/backend sahaja — **frontend diskan penuh kali ini**): **0 kandidat sebenar**. `staging.env` gitignored+untracked (verified semula). npm audit **prod 0/0/0/0 BE dan FE** (dev BE: 4 MODERATE, dev-only).

## 23. Full Regression (Phase R) — ✅ 595/595

- Run 1: 590/595 + worker-fork crash — **corak env-kill Windows dikenali** (2 kejadian lepas, rerun → green; bukan defect produk)
- Run 2: **595/595, 91/91 fail** ✅ (186s)
- Test count 585→595: **+10 = ra1-schema-drift (5) + ra3-uuid-400 (5)** — konsisten claim; tiada test dipadam
- Gates: BE lint/typecheck/build **EXIT 0 ×3**; FE lint/build **EXIT 0**; FE tsc sebenar **38 errors** (PRA-1 residual)

## 24. Combined Attack Chains (Phase S) — ✅ 8/8 TAHAN

1. forged JWT + IDOR → 401 ✅ · 2. tampered JWT + admin → 401 ✅ · 3. doctor + admin assign-role → 403 ✅ · 4. rate-limit + XFF rotate (register) → 429 ✅ · 5. SQLi + RLS → parameterized, pg_sleep 0.03s ✅ · 6. worker → human tables → 0 rows ✅ · 7. developer → privileged (staff/secret_refs) → 0 rows ✅ · 8. registration + privilege → role tidak tersentuh oleh fungsi ✅
- **S8 GUC half-spoof (role=hq tanpa org/staff → INSERT berjaya DALAM sesi psql sendiri)**: dibuktikan **bukan jalur attacker** — set_config hanya dipanggil `db-context.service.ts` (nilai dari Principal DB-resolved) + `seed.ts`; semua query API parameterized; GUC transaction-local (`is_local=true`); Principal re-derive dari DB setiap request. Klien API tidak mempunyai sebarang cara menulis GUC.

## 25. Findings Reconciliation

| ID | Sev | Klasifikasi | Komponen | Blocking? |
|----|-----|-------------|----------|-----------|
| PRA-1 | MEDIUM | **NEW** (RA-2 reopen) | CI frontend typecheck NO-OP | **Ya** (untuk GITHUB push; bukan runtime) |
| PRA-2 | LOW | NEW | `plans items/:itemId` tiada pipe | Tidak (latent; route fail-closed) |
| PRA-3 | LOW | NEW | oversized → 500 bukan 413 | Tidak (limit berfungsi) |
| RA-2 residual | LOW | CARRY-FORWARD | 38 type errors FE | Tidak (vite build tak typecheck) |
| F11-2 | INFO | CARRY-FORWARD (accepted) | ALTER ROLE post-migrasi (runbook) | Tidak |
| T2 NULL-bypass | INFO | ACCEPTED RISK (documented 0029) | staff/role_assignments SELECT | Tidak |

Temuan audit lepas yang **dipulihkan**: RA-1 (asal MEDIUM) → PASS; RA-3 (asal LOW) → fixed 83/87; RA-2 (asal MEDIUM) → **FAIL semula** (gate wujud tapi NO-OP).

## 26. Production Readiness (Phase T)

- **Security: PASS** — 0 CRITICAL/HIGH; F-02/F-05/F11-1 re-verified runtime; 8/8 chains TAHAN; replay zero-drift
- **Functional: PASS** — 595/595; 20/20 connectivity; gates BE penuh hijau
- **Infrastructure: PASS** — hardening penuh diverifikasi
- **Operations: CONDITIONAL** — prasyarat go-live kekal: TLS domain sebenar, RPO schedule aktif + PITR rehearsal staging, ALTER ROLE dalam runbook
- **Governance: PASS** — lineage bersih, laporan terdahulu intact, journal konsisten

**OVERALL: CONDITIONAL — READY FOR GOVERNANCE REVIEW** selepas PRA-1 difix (cadangan: `npx tsc -b` + fix 38 errors, ~2–4 jam kerja) dan targeted re-audit. **BUKAN READY FOR GITHUB PUSH** dalam keadaan semasa (CI false-pass = governance gate rosak). **BUKAN READY FOR PRODUCTION** (prasyarat operasional belum tunai — seperti semua audit terdahulu; lulus audit ≠ authorize push/deploy).

## 27. Governance Recommendation

1. Neo fix PRA-1 (+RA-2 residual 38 errors; PRA-2/PRA-3 optional, batch kecil)
2. Targeted GLM re-audit (CI command + rerun gates sahaja, ~30 minit)
3. ChatGPT Governance Review
4. Bos sign-off → GitHub push → release lock → staging → TLS live → monitoring/RPO live verification → UAT → production

## 28. Cleanup Evidence (Lampiran A)

- Forensic DB `medini_fa` **DROPPED** (selepas laporan)
- Backend ujian :3100 **killed**; `__audit_boot.log`, `__audit_vitest_r1.log`, `__audit_vitest_r2.log` **dipadam**
- Container alertmanager ujian `audit-am2` **dibuang**
- Dev DB `medini_dev` **utuh** (70 tables/302 policies; tiada mutasi oleh audit ini — semua probe DB dilakukan pada `medini_fa` sahaja)
- `medini_replay_current` (dicipta test fixture tempatan, bukan auditor) tidak disentuh
- **HEAD `06ad2c6` unchanged; working tree bersih kecuali laporan ini; tiada commit/push/deploy oleh auditor**

---

*Passing this audit does NOT authorize GitHub push or production deployment. — HARD STOP —*
