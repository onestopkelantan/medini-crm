# S0–S10 FINAL INDEPENDENT RANDOM FORENSIC RE-AUDIT
## Medini CRM — HEAD `6c6a08d3ed161bbe11e40d02a612f378903a1093`

**Tarikh:** 2026-08-23 · **Auditor:** GLM 5.3 (Independent Forensic Security Auditor)
**Kaedah:** Random sampling + adversarial probes + forensic DB replay. Runtime evidence > source assumptions. Semua claim remediasi diverifikasi bebas; UNVERIFIED ≠ PASS.
**Seed random:** 20260823–20260826

---

## 1. GOVERNANCE — ✅ LULUS

| Semakan | Keputusan |
|---------|-----------|
| HEAD | `6c6a08d3ed161bbe11e40d02a612f378903a1093` pada `main` (verified dari Git, bukan prompt) |
| Baseline ancestry | `5eb40fd7707345b83e0fb5d0987a2f6f9cf1f169` = ancestor (27 commits selepasnya) |
| Working tree | Bersih (hanya laporan audit untracked — by design) |
| Kehadiran commits | **26/26 verified**: Tier 1 (7), Tier 2 (7), Tier 3 (5), Tier 4 (3), F11-1 (cf71539), Final hardening (340bf2f, 8751857, d97c762, 6c6a08d) |
| Force-push/rewrite | **TIADA** — reflog hanya 1 amend benign (41cc415→cf71539, F11-1 fix) |
| Migrasi lama diubah | **TIADA** — 9 sampel rawak + 0031: intro-commit ≡ last-commit |
| Migrasi | **31 fail** (0000→0031) + journal konsisten |

## 2. CLEAN REPLAY — ✅ ZERO DRIFT

31/31 migrasi diaplikasikan pada DB forensic segar (`medini_ra`), ON_ERROR_STOP=1.

**Diff penuh replay vs dev: 0 beza** — 70 tables / 302 policies / 269 indexes / 823 constraints / 56 enums / 6 functions / 989 columns / 199 grants / 70 RLS-enabled, **termasuk policy-by-policy (qual/check/roles/cmd) dan index-definition-by-index**.

## 3. TEMUAN REMEDIASI — VERIFIKASI BEBAS

### F-02 (migrasi 0031) — ✅ SAH (DB-layer proof)
6 restrictive policies `f02_*` wujud dan berfungsi. Sebagai `medini_app` + context doctor:
- INSERT staff role=hq → **RLS violation** ✅
- UPDATE→hq → **RLS violation** ✅
- DELETE hq → **permission denied** (tiada grant DELETE) ✅
- SELECT → dibenarkan (by design) ✅

### F-05 SECURITY DEFINER — ✅ SAH (10 probe)
`register_staff_with_token`: owner=medini, `search_path=pg_catalog,public` pinned, EXECUTE medini+medini_app sahaja (PUBLIC revoked). Runtime:
- Cross-org (org B token + org A id) → **FAIL** ✅ · legitimate same-org → **OK** ✅
- Token reuse → **FAIL** ✅ · expired → **FAIL** ✅ · status Active+token → **FAIL** ✅
- CREATE TABLE sebagai medini_app → **permission denied** ✅ · SET ROLE medini → **permission denied** ✅
- Tiada role manipulation (fungsi set status='Pending' sahaja)

### F11-1 Alertmanager — ✅ REMEDIATED & RUNTIME-VERIFIED
Config kini statik penuh (blackhole localhost, tiada env expansion). Boot test container: **running, 0 restarts, config loaded, API v2 ready**.

## 4. LIVE ADVERSARIAL — ✅ SEMUA TAHAN

Backend di-boot pada :3100 (dev env, dist build). Keputusan:

| Probe | Keputusan |
|-------|-----------|
| Login 4 role (hq/manager/reception/doctor) | 200 × 4 ✅ · wrong-pw 401 · unknown-user 401 (message seragam — tiada enumeration) |
| JWT: tampered / alg-none / empty / null / Basic / no-header | **401 × 6** ✅ |
| JWT claims | sub/username/orgId/iat/exp/aud/iss sahaja — **role TIADA dalam token** (re-derive dari DB) ✅ |
| RBAC: doctor→admin staff / POST staff / system-admin / organization / branches | **403 × 5** ✅ · hq→system-admin **403** (technical-only betul) · hq→staff 200 (5 staff org-scoped) |
| IDOR: fake patient UUID (doctor+manager) | **404** ✅ · branchId forged → **403** ✅ |
| SQLi: 6 payload search + 2 payload UUID-path | Semua parameterized ($1/$2) — pg_sleep **0.03s tidak execute** ✅ |
| Rate-limit | 429 tercetus; **XFF rotation 7 IP tidak bypass** ✅ |
| Refresh lifecycle | rotate 200 → reuse lama **401** → baru 200 → logout 200 → post-logout **401** ✅ |
| Registration token sampah / SQLi | **400 × 2** ✅ |
| 10 attack chains | **SEMUA TAHAN** ✅ |

Nota klasifikasi: `/metrics` @Public = **documented design** (S9-T3 Q6; prod: Caddy respond 404 + scrape dalaman — verified dalam Caddyfile). UUID-invalid→500 = error mapping, **bukan injection** (query parameterized).

## 5. RLS FORENSICS — ✅

Random sampling + adversarial context probes:
- system_worker context: staff/encounters/patients/secret_refs = **0 rows** ✅
- developer context: staff/encounters/secret_refs/organizations = **0 rows** ✅
- hq org A → staff org B = **0** ✅; bm cross-branch/cross-org = **0** ✅
- GUC transaction-local (set_config is_local=true; tidak persist selepas ROLLBACK) ✅
- Sample 5 policy random: definisi konsisten (worker-exclusion restrictive, org-isolation, delete deny)
- Sample 5 table random: RLS enabled semua; `report_audit`/`wa_conversations`/`ai_guardrails`/`sale_records` FORCE ROW SECURITY ✅

**T2 NULL-bypass (staff/role_assignments `app_org_id() IS NULL OR ...`)**: medini_app tanpa konteks org boleh SELECT semua org di DB layer. **Documented design decision** dalam komen migrasi 0029 sendiri ("org = tenant boundary, bukan auth boundary; login pre-GUC mesti berfungsi"). Login sentiasa filter org kanonik; tiada jalur API tanpa konteks ditemui. **INFO — by design.**

## 6. STATIC CONNECTIVITY — ✅

- 36 fail guna `runAs`/`runAsWorker`; 16 fail direct-db — **semua** disemak: repos terima `tx` parameter (dipanggil dalam runAs), workers runAsWorker, audit/idempotency/outbox tx-scoped, gauges runtime pool
- `DATABASE` token = runtime role `medini_app` (bukan owner) ✅
- Random sample: 10/10 services dengan DB guna runAs ✅ · 10/10 repos tx-param pattern ✅ · 10/10 controllers guarded ✅

## 7. TEST SUITE + BUILD GATES

| Gate | Keputusan |
|------|-----------|
| Vitest Run 1 | **585/585 (89/89)** ✅ 103s |
| Vitest Run 2 | 575/585 + 2 errors ❌ → **dijelaskan**: auditor jalankan `vite build`+`tsc` frontend serentak → CPU contention → timeout |
| Vitest Run 3 | **585/585** ✅ 110s |
| Vitest Run 4 (keadaan sama Run 2, tanpa build serentak) | **585/585** ✅ 93s |
| Backend lint / typecheck / build | **EXIT 0 × 3** ✅ |
| Frontend `vite build` | **EXIT 0** (1890 modul) ✅ |
| Frontend eslint | **EXIT 0** ✅ |

**Suite verdict: 585/585 × 3 run; 1 anomali dijelaskan (auditor-caused contention), bukan defect.** Trust-proxy flake dikenali dari audit terdahulu kekal tidak muncul pada 4 run ini.

## 8. SECRETS + DEPENDENCIES

- **Secrets scan: 0 real secret.** `staging.env` = gitignored + untracked + tiada Git history (nilai staging dev-grade). CI = dev-grade sahaja. Compose = env-var references (`${POSTGRES_PASSWORD}`). `.env.example` = `***` placeholder.
- **npm audit backend prod: 0/0/0/0** ✅ · dev: 4 MODERATE (dev-only)
- **npm audit frontend prod: 0/0/0/0** ✅

## 9. INFRASTRUCTURE + INTEGRATIONS

- Prod compose: port **80/443 sahaja**; tiada privileged; tiada docker.sock; 15 restart policies; 4 healthchecks; backend `Dockerfile.prod` **USER medini (non-root, multi-stage ×4)**; `app/Dockerfile` root (nota LOW sedia ada)
- Caddyfile: HSTS preload + X-Frame-Options + nosniff + Referrer-Policy + `-Server`; **`/metrics` → 404 public** ✅
- Backup: `backup.sh` (pg_dump→gzip→sha256 fingerprint→retention 30d, `set -euo pipefail`, fail-closed) + `wal-archive.sh` ✅
- WAHA: adapter (API-key header, session, timeout, error handling) ✅; prod compose commented dengan keperluan strong key didokumenkan
- Bukku: adapter fail-closed (throw) + secrets via env; worker `runAsWorker` RLS-scoped ✅
- Power BI: tiada dalam kod (seperti audit terdahulu — foundation reports sahaja)

## 10. TEMUAN BAHARU RE-AUDIT

| ID | Severity | Temuan | Cadangan |
|----|----------|--------|----------|
| RA-1 | **MEDIUM** | **CI schema drift**: `ci.yml` migrate step hanya apply 0000–0028 — **0029 (T2 org isolation), 0030, 0031 (F-02 deny) TIDAK dijalankan dalam CI**. CI hijau ≠ schema semasa divalidasi. | Tambah 0029–0031 ke loop CI (atau glob `drizzle/*.sql` automatik) |
| RA-2 | **MEDIUM** | **Frontend tiada CI gate + typecheck rosok**: `tsc -b` = 38 errors (`db/seed.ts` unknown, `AppLayout.tsx` email/`AuthUser`, `api.ts` erasableSyntaxOnly); root CI = backend sahaja (`paths: backend/**`). `vite build` lulus kerana tiada type-check. | Fix type errors + tambah workflow frontend (build/lint/tsc/test) |
| RA-3 | LOW | UUID-invalid pada path → **500** (error mapping; query parameterized — bukan injection) | Map invalid-uuid → 400 |
| — | INFO | T2 NULL-bypass staff/role_assignments = documented design (0029) | — |
| — | INFO | `/metrics` @Public = documented design (prod Caddy 404) | — |

## 11. INSIDEN AUDITOR (direkod jujur)

Semasa probe F-02 pertama, auditor tersilap jalankan SQL sebagai **owner `medini`** (bypass RLS) dan COMMIT — mutasi dev DB (padam row hq, ubah doctor→hq, insert f02probe). **Dev DB dipulihkan penuh** (11 staff asal, hq restored dengan password hash betul, f02probe dibuang). Kesilapan kaedah auditor; bukan defect produk. Semua probe seterusnya sebagai `medini_app`.

## 12. VERDICT AKHIR

# 🟢 READY — APPROVE

**0 CRITICAL / 0 HIGH / 2 MEDIUM baru (RA-1 CI drift, RA-2 frontend gates) / 1 LOW (RA-3) / 2 INFO**

- Kesinambungan verdict 🟢 audit `4cec363`: **dikekalkan** — semua claim remediation baharu (F-02, F-05, F11-1, final hardening) **disahkan bebas dengan bukti runtime**
- RA-1/RA-2 adalah **gaps pipeline CI**, bukan defect runtime produk — test suite penuh 585/585 ×3 + replay zero-drift membuktikan schema/products betul; risiko = regression masa depan tidak tertangkap CI
- Prasyarat operasional go-live (kekal): TLS domain sebenar (PR-C1), RPO schedule backup aktif, langkah `ALTER ROLE medini_app` dalam runbook (F11-2)
- Prasyarat baharu (daripada RA-1/RA-2): patch CI migrate list + frontend CI gate **sebelum git push pertama selepas go-live** (risiko rendah — bukan blocker deployment)

**Estimasi kerja DevOps ke go-live: ~7–9 hari** (termasuk RA-1/RA-2 ~2–3 jam).

---

## LAMPIRAN A — Bukti Cleanup

- Forensic DB `medini_ra` di-DROP (selepas laporan ini ditulis)
- Backend ujian :3100 di-kill; `__audit_boot.log`, `__audit_vitest_run3.log`, `__audit_vitest_run4.log` dipadam
- `app/dist`, `backend/dist` = build artifacts (gitignored, dibina semula oleh build gates — tidak dihapus kerana dist adalah output standard build; working tree kekal bersih dari POV Git)
- Dev DB `medini_dev`: 70 tables / 302 policies utuh, 0 residue probe
- HEAD `6c6a08d` unchanged; tiada commit/push/deploy oleh auditor
