# S10 — GLM 5.3 INDEPENDENT FORENSIC AUDIT

**Tarikh:** 2026-08-19
**Auditor:** GLM 5.3 — Independent Forensic Auditor
**Baseline dikunci:** S8 `c0ac25c` · S9 impl `a59cff9` + lock `7cca0b3`
**Checkpoint diaudit:** T1 `3437dac` → T2 `d63b741` → T3 `054a49a` → T4 `696ebae` (report `b74a03f`)
**Kaedah:** READ-ONLY. Source/migration/config/infra inspection + live PostgreSQL probes (`medini_app` bukan superuser; probe rows sentiasa dalam `BEGIN…ROLLBACK` atau dibersihkan) + fresh replay DB `medini_s10_audit` (dibuang selepas audit) + suite bebas ×2. Sifar perubahan repo oleh auditor.

---

## 1. EXECUTIVE SUMMARY

**VERDICT: 🔴 REJECT — MAJOR REMEDIATION REQUIRED SEBELUM GOVERNANCE REVIEW**

T4 claims 20/20 production-ready. Realiti bebas saya: **satu aliran bisnes kritikal (staff registration) TIDAK BERFUNGSI pada mana-mana DB yang dibina daripada migrasi sahaja**, dan satu kumpulan RLS policies pada `refresh_tokens` terlalu longgar (semua role boleh membaca dan UPDATE). Ini bukan isu dokumentasi — ia adalah reprodusible production break + privilege gap yang saya buktikan secara live pada dua DB berbeza (dev + replay murni 0000→0025).

**Dapatan utama:**
- 🟠 **S10-01 (HIGH): `/auth/register` ROSAK pada fresh deployment** — `StaffRegistrationService.register()` berjalan dalam `runAsWorker`, tetapi policies RLS `staff` (migrasi 0023) menyekat worker SELECT+UPDATE secara mutlak. Pada replay murni: lookup=0 rows, update=0 rows. Migrasi 0025 TIDAK menambah policies yang diperlukan. Dev DB "berfungsi sebahagian" hanya kerana **2 policies ditambah secara MANUAL ke dev selepas migrasi** (`s10_staff_registration_read/update`) — dan ini sendiri merupakan drift dev≠migrasi (224 vs 223 policies).
- 🟠 **S10-02 (HIGH): `refresh_tokens` RLS over-permissive** — policies `s10_refresh_select/update/insert` membenarkan **semua role ter-auth** (doctor/receptionist/branch_manager) membaca SEMUA row token org (275 rows dilihat oleh doctor dalam probe) dan UPDATE (revoke) token sesiapa. Eksploitasi: staff berprivilege rendah boleh DoS logout seluruh organisasi. Dikekalkan org-isolation (cross-org = 0) jadi ini bukan tenant-escape, tetapi jelas melanggar least-privilege pattern S8/S9.
- 🟡 **S10-03 (MEDIUM): Dev DB drift tidak didokumenkan** — 2 policies manual tiada dalam mana-mana migrasi/source/script; sekiranya prod dibina hari ini, aliran invite→register akan gagal secara senyap (register → "Invalid or expired invitation").
- Bukti lain yang **MENYOKONG** T4: 510/510 ×2 bebas (reproduced), TSC/LINT/BUILD hijau, replay 0000→0025 bersih, immutability S8/S9 kecuali wiring DI minimal, frontend tiada tRPC/SQLite/mock, Docker prod files berkualiti (multi-stage, non-root, healthchecks), Caddy `/metrics` internal-only + 404 public, backup/restore rehearsal scripted, env.validation menolak secret lemah production.

**Cadangan ringkas:** dua remediation teknikal (satu migrasi 0026 yang memindahkan policies registration worker + mengetatkan policies refresh_tokens) + re-audit bebas aliran penuh invite→register→approve→login→deactivate SEBELUM dibawa ke governance. Sistem TIDAK production-ready hari ini.

---

## 2. SCOPE

Frontend↔Backend integration, auth lifecycle (login/refresh/logout/register), user invitation & deactivation, RBAC, RLS, pre-auth worker context, migration 0025, API T1 endpoints, infrastructure (Docker/compose/Caddy/nginx), secrets, backup/restore, RPO/RTO, /metrics, Power BI, WhatsApp scope, legacy :5000, test forensics (510/510), frontend lint.

## 3. EVIDENCE REVIEWED

Source (`src/core/auth/*`, administration, reports, observability), migrasi 0000–0025 + journal + CI loop, `docker-compose.prod.yml` + Caddyfile + Dockerfile.prod ×2 + nginx.prod.conf + backup/restore scripts, frontend (`app/src/lib/api.ts`, `auth.ts`, `Register.tsx`, `Login.tsx`, pages, playwright config + e2e specs), git timeline lengkap (12 commit), docs S10 (discovery/plan/T1–T4), live PostgreSQL probes pada `medini_dev` dan replay `medini_s10_audit`, suite bebas ×2, frontend lint bebas.

---

## 4. FRONTEND AUDIT

- **Tiada tRPC/SQLite/mock production dependency** ✅ — `app/package.json` bersih; `api.ts` ialah REST client sebenar (`VITE_API_URL`, Bearer header, error mapping dengan correlationId).
- Auth flow sebenar: login → tokens localStorage → refresh handler → logout revoke. Register page memanggil `POST /auth/register` sebenar dengan token dari query param.
- E2E Journey A–H (Playwright): struktur betul, 12 tests; Journey G hanya uji dialog invite terbuka (tidak melengkapkan register → tidak menangkap S10-01).
- **Lint:** 25 errors semasa (claim T4: 21). 9 daripadanya dalam **fail yang diubah/ditulis oleh S10 T1** (Reports 3, Patients 3, Administration 3 termasuk `any` baharu; Register.tsx 1). Claim "semua pre-existing dalam shadcn ui/*" **TIDAK tepat** — 🟡 S10-06 (LOW-MEDIUM): laporan T1 underestimate; bukan blocker keselamatan.
- Frontend build hijau; bundle tiada secret (grep APP_SECRET/dev password dalam dist = kosong).

## 5. BACKEND AUDIT

510/510 ×2 **bebas** (75 files) — reproduced; tinypool worker-exit theory T3 konsisten dengan pemerhatian saya (0 assertion failure). TSC/LINT/BUILD hijau. Immutability S8/S9: modules runtime hanya wiring DI (+`DbContextService`/`AuditService` inject ke whatsapp module provider; InfraGauges factory) — behavior tidak berubah; migrasi 0000–0024 byte-identik; S9 reports module tidak disentuh; CI loop +0025 sahaja.

## 6. AUTHENTICATION

- **Password:** Argon2id via PasswordService (S0) ✅; login timing-safe, status-check `!== 'Active'` ditolak dengan mesej generik (no enumeration) ✅.
- **Access JWT:** HS256, iss/aud diikat, TTL 900s, claims minimum (sub/username/orgId sahaja — role TIDAK di dalam token, di-re-derive setiap request melalui PrincipalResolver → tampered claim tak boleh elevate) ✅ reka bentuk bagus.
- **Refresh:** opaque 32-byte random, **SHA-256 hash sahaja disimpan** (tiada plaintext) ✅; rotation `rotated_to`+`revoked_at` ✅; reuse → ditolak (`rotatedTo` check + `isNull(revokedAt)` + `isNull(rotatedTo)` lookup) ✅ (test + kod konsisten); revocation logout/deactivation ✅ (deactivateStaff → revokeAllForStaff via runAsWorker). TTL 7 hari.
- **Kelemahan (S10-02):** RLS table-level terlalu longgar (lihat §9).
- **900s residual window:** diterima untuk threat model ini (token singkat + revocation pada refresh; bekas standard). Bukan blocker.
- **Tiada rate limiting pada /auth/login|refresh|register** — 🟡 S10-05 (LOW-MEDIUM): brute-force tidak dihadkan pada level aplikasi; CORS tidak dinyatakan ketat dalam audit ini; wajib sebelum production sebenar (S10/S11).

## 7. USER LIFECYCLE (invitation → register → approve → deactivate)

- Model governan betul: HQ invite → `Invited` → token single-use 32-byte (entropi memadai), 72h expiry → register (worker ctx) → `Pending` → HQ approve → `Active` → login; reject → `Rejected` (terminal). Role/branch/org **tidak boleh diubah oleh staff** (register tidak sentuh kolum tersebut) ✅; username unique org-scoped ✅; token dibuang selepas guna ✅.
- **TETAPI: aliran register TIDAK BERFUNGSI pada DB migrasi-sahaja (S10-01).** Bukti live:
  - Replay murni 0000→0025 + staff Invited dengan token: `worker lookup tokR = 0 rows`; `UPDATE … = 0 rows` (ROLLBACK probe).
  - EXPLAIN menunjukkan filter RLS: `app.role <> 'system_worker' AND ((role='system_worker' AND invite_token IS NOT NULL) OR (role<>'system_worker'))` → conjunct pertama (RESTRICTIVE n9_staff_worker_exclusion_update dari 0023) **sentiasa false untuk worker** → permissive s10 registration policies (yang hanya wujud di dev secara manual) TIDAK dapat menyelamatkannya. Pola defect ini **sama seperti defect S8 0022** (RESTRICTIVE FOR ALL vs permissive).
  - Dev DB: lookup BERJAYA (1 row) kerana policy manual `s10_staff_registration_read`, TETAPI update masih 0 rows (RESTRICTIVE exclusion menang) — jadi walaupun dev, register() akan gagal pada langkah UPDATE. Ini bermakna **tiada satu pun environment di mana `/auth/register` berfungsi hujung-ke-hujung**, dan tiada test integration yang menguji happy-path register (semua test register ialah rejection-path: token invalid, password pendek, username tak sah).
  - Browser E2E Journey G tidak melengkapkan register (hanya buka dialog invite).
  - Drift dev (224 policies) vs replay (223) — 2 policies manual + `-1` policy `n9_staff_worker_exclusion` versi dev hanya ada INSERT/UPDATE/DELETE split (dijumpai diff: replay ada `staff::n9_staff_worker_exclusion` (FOR INSERT RESTRICTIVE versi lama?), dev ada split). Terperinci: replay mempunyai `n9_staff_worker_exclusion` (cmd=INSERT) DAN `n9_staff_worker_exclusion_update`; dev hanya versi split. (Jurnal menunjukkan 0023 mengandungi keduanya; drift terakhir dari evolusi manual dev.)
- Deactivate: refresh revoke-all ✅ + self-protection (tak boleh deactivate diri sendiri) ✅ + data sejarah kekal (soft-delete/status) ✅ + last-HQ: tidak ditemui mekanisma khusus "last HQ cannot be deactivated" — 🟡 S10-07 (LOW):HQ terakhir boleh deactivate dirinya melalui admin lain? Sebenarnya self-block ada; jika hanya 1 HQ tinggal, dia tak boleh deactivate diri → perlindungan cukup secara tidak langsung. Nota sahaja.
- **invite-link baseUrl body param:** HQ boleh pass mana-mana baseUrl (default localhost:5173) — link yang dijana boleh menunjuk ke domain arbitrari (phishing vector oleh insider HQ). 🟡 S10-08 (LOW): cadangkan whitelist domain dalam remediation.

## 8. RBAC

- `ROLE_DOMAIN_MATRIX` + `RequirePermission` di endpoint + `resolveReportScope` (S9) semuanya di-enforce server-side; principal di-re-derive dari DB setiap request (bukan dari token) → role manipulation melalui token tidak mungkin.
- Live/integration tests: doctor ditolak admin endpoints; receptionist ditolak reports; manager branch isolation (RLS + query scope) — konsisten dengan matriks. IDOR: manager tak nampak branch lain (RLS org+branch) ✅.
- Approve/reject/invite-link endpoints: `@RequirePermission('admin','edit')` + `requireHq` dalam service — betul (double enforcement) ✅.

## 9. RLS FORENSIC

Live probe matrix (medini_app):

| Probe | Keputusan | Penilaian |
|---|---|---|
| refresh_tokens cross-org (org lain) | 0 rows | ✅ org-isolation berfungsi |
| refresh_tokens hq SELECT | 275 | ✅ (hq memang perlu) |
| **refresh_tokens doctor SELECT** | **275** | ❌ terlalu luas (S10-02) |
| **refresh_tokens receptionist SELECT** | **275** | ❌ sama |
| **refresh_tokens doctor UPDATE (revoke)** | **BERJAYA** (0-row probe mengesahkan izin) | ❌ DoS logout org-wide |
| refresh_tokens no-context SELECT | 0 / INSERT ditolak | ✅ pre-auth fail-closed |
| refresh_tokens DELETE | permission denied (grant) | ✅ append-only |
| staff worker INSERT (n9) | ditolak RLS | ✅ N9-1 kekal tertutup |
| staff worker SELECT/UPDATE (register path) | 0 / 0 | ❌ **mematahkan register (S10-01)** |
| kpi_definitions/report_audit (S9 spot) | 11/11 seperti S9 | ✅ tidak berubah |

**Punca S10-01 (kod + migrasi):** migrasi 0025 TIDAK mengandungi sebarang policy untuk membenarkan worker menyentuh `staff.invite_token` path; kod register() mengandaikan worker boleh SELECT+UPDATE staff — andaian itu hanya benar di dev dengan policies manual. **Ini adalah migrasi yang tidak lengkap** — replay prod akan menghasilkan sistem di mana HQ boleh invite tetapi staff tidak akan dapat register.

**Punca S10-02:** policies `s10_refresh_select/update/insert` gunakan `COALESCE(app_role(),'') <> ''` (semua role ter-auth) — mungkin niatnya "auth service sahaja", tetapi RLS tidak dapat membezakan service-context daripada principal biasa kerana service berjalan ATAS principal. Pattern betul: qualification oleh role khusus (mis. `app_role() IN ('hq')` untuk UPDATE revoke; atau jalankan revokeAll melalui worker dengan policy khusus `system_worker`).

## 10. PRE-AUTH WORKER CONTEXT

`runAsWorker`: `set_config('app.role','system_worker',true)` transaction-local + org_id dari server (konstanta ORG_ID canonical single-tenant) — **user-controlled input TIDAK sampai ke GUC** (register/refresh hanya menghantar token hash) ✅ tiada tenant-escape melalui input. Risiko sebenar ialah keputusan policy yang salah (S10-01/02), bukan kebocoran context. `app.branch_ids=''` sahaja — fail-closed.

## 11. API SECURITY (T1 endpoints)

- `/auth/refresh` @Public — betul (opaque token; rotation+reuse-rejection terbukti).
- `/auth/logout` authenticated + revoke + audit ✅ (audit failure ditelan dengan warn — 🟡 minor: kekal).
- `/auth/register` @Public dengan token single-use — betul secara design; **rosak secara runtime (S10-01)**.
- `/appointments` GET, `/patients/:id` PATCH — permission + scope server-side; service-level tests ada.
- `/admin/staff/:id/approve|reject|invite-link` — `admin:edit` + requireHq ✅; audit direkod ✅; transaksi dalam runAs ✅.
- Rate limiting: **tiada** pada semua endpoint auth (S10-05).
- invite-link baseUrl: S10-08 (phishing insider).

## 12. DATABASE

Replay 0000→0025 **BERSIH** (tiada error); 70 tables / 70 RLS / 989 kolum / 269 indexes; enum staff_status 6 nilai (Active,Suspended,Deactivated,Invited,Pending,Rejected) konsisten dev=replay ✅. Journal idx kontigu 0–23 (24 entri) ✅. CI loop mengandungi 0025 ✅. **Drift satu-satunya: policies (224 dev vs 223 replay)** — 2 policies manual + evolusi 0023 → S10-03. Tiada operasi destruktif dalam 0025 (ADD VALUE enum tak boleh rollback — digovernance D6, didokumenkan) ✅. `refresh_tokens` FK staff ON DELETE CASCADE; hash unik; index adequat ✅.

## 13. MIGRATION 0025 KUALITI

Struktur table bagus; **tetapi migrasi ini TIDAK lengkap secara fungsional** (lihat S10-01 — kegagalan menambah policies yang kod perlukan). Ini pelajaran berulang: kod berjaya di dev kerana perubahan DB dilakukan manual.

## 14. INFRASTRUCTURE

- Compose prod: caddy (80/443 public sahaja) → frontend/backend internal; postgres/redis **tiada port public** + network `internal: true` ✅; healthchecks ✅; restart policies ✅.
- Caddy: HSTS + security headers + `/metrics` public→404 + `/health` proxied + `/api/*` → backend ✅. **Caveat:** perlindungan /metrics bergantung pada Caddy sahaja — jika backend terdedah secara langsung (port 3000 terbuka di VPS), /metrics boleh dicapai; S10-04 (MEDIUM, pre-production requirement): pastikan firewall VPS menutup 3000, atau bind 127.0.0.1.
- Backup sidecar: cron harian 02:00, gzip, retention 30 hari, `backupdata` volume berasingan ✅ (bukan dalam disposable container) ✅; restore-rehearsal.sh ada guard anti-prod ✅.
- **WSL2 limitation T4 diakui jujur** (staging container→host PG gagal) — diterima sebagai environment; tetapi bermakna **full-stack staging pada VPS sebenar BELUM pernah berlaku** — sebahagian kesediaan "T4" adalah evidence proses, bukan deployment sebenar (lihat §27 Remaining Risks).
- Secrets: `backend/.env` (env_file compose) di luar git ✅; `app/.env` lama mengandungi APP_ID/APP_SECRET/DATABASE_URL legacy prototipe — **dalam cakera tetapi TIDAK pernah masuk git history** (verified `git log --all -- app/.env` kosong) dan tidak dipakai oleh build prod (VITE_API_URL sahaja yang di-bake). 🔵 INFO: padam fail tersebut untuk kebersihan.

## 15. DOCKER

Kedua Dockerfile.prod: multi-stage, non-root (backend: user medini; frontend nginx), deps terpisah (argon2 build tools hanya di stage build), healthcheck (`/health/ready` / nginx root), tiada secret di-bake, ports minimal. Reproducibility: bergantung npm registry + alpine tags (pin major sahaja) — 🔵 INFO: pin digest untuk determinisme penuh (S11). Build PASS claim T4 selari dengan struktur yang saya semak (tiada build dijalankan oleh auditor — struktur diverifikasi statik).

## 16. SECRETS

- Git history: tiada `.env` pernah di-commit ✅.
- Bundle dist: tiada APP_SECRET/DB password ✅.
- `backend/dist/seed.js` mengandungi fallback `medini123` demo password — hanya default dev; production tidak menjalankan seed (dan env.validation menolak weak JWT) ✅; 🔵 INFO: pastikan seed tidak dibawa ke prod image path (ia berada dalam dist tetapi tidak dipanggil oleh main).
- CI secrets: placeholder jelas ditandakan `ci_only_insecure…` ✅.

## 17. BACKUP/RESTORE

Skrip + rehearsal path lengkap; T4 claim restore 6.2s/70 tables (evidence dalam laporan; **artifak fizikal backup tidak disimpan dalam repo** — jangkaan; tidak boleh saya reproduce tanpa menjalankan pg_dump terhadap data dev — diminta untuk pre-production: simpan satu artefak restore di lokasi luar-VPS). Retention 30 hari. `--clean --if-exists` menjadikan restore idempotent ✅.

## 18. RPO/RTO

Proposed 24h/4h — **BELUM diluluskan governance** (T2 sendiri menyatakan "pending"). Restore rehearsed dalam saat → RTO 4h realistik untuk single-VPS. RPO 24h = backup harian sahaja (tiada WAL archiving/PITR) — 🔵 INFO: untuk data klinikal, pertimbangkan PITR (S11). Bukan blocker; governance decision.

## 19. MONITORING

Prometheus text + 6 alert rules didokumenkan (OBSERVABILITY.md); **tiada Prometheus server/alertmanager di-deploy** dalam compose — 🔵 INFO (S10/S11 infra pilihan; runbook mengatakan internal scrape path sedia).

## 20. /metrics

Backend: `@Public` + prefix-excluded; Caddy: public→404, internal network scrape ✅. **S10-04**: perlindungan tidak lengkap tanpa firewall VPS (port 3000 tidak wajib tertutup oleh compose sendiri — backend TIDADA ports di compose, hanya exposed internal; risiko hanya jika operator `-p 3000:3000`). Downgrade kepada MEDIUM→LOW dengan syarat runbook menutup port. Disemak: compose backend tiada `ports:` → hanya boleh dicapai melalui network docker ✅. Maka S10-04 = 🔵 LOW (dokumen operasi sahaja).

## 21. INTEGRATIONS (WhatsApp/WAHA/Bukku)

WAHA dikomen keluar dalam compose prod (launch-scope decision) ✅ jujur; Bukku gated adapter S8 kekal; tiada integrasi spekulatif baharu. WhatsApp: bukan launch-scope ⇒ NOT READY by choice, didokumenkan — OUT OF SCOPE untuk go-live ini.

## 22. POWER BI

Unchanged daripada S9 (diff kosong); foundation-only, tiada live DB/credentials/publish — status: **PARTIAL (foundation) — deferred S10 activation**, selari audit S9 saya. Tidak menjejaskan backend.

## 23. LEGACY SYSTEM

`Medini-CRM-Backend` legacy :5000 — **zero diff** sejak S9 (hanya SPRINT-9-LOCK.md docs ditambah) ✅. Tiada port collision (prod stack guna 80/443/3000 internal; legacy 5000 tak disentuh). Cutover risk: didokumenkan dalam runbook (fallback retained) ✅.

## 24. TEST VERIFICATION

| Item | Independent result |
|---|---|
| Backend suite | **510/510 ×2 (75/75 files)** ✅ reproduced |
| TSC / LINT(backend) / BUILD | ✅✅✅ |
| Replay 0000→0025 | ✅ bersih (tapi lihat S10-01: "bersih" ≠ "lengkap") |
| Browser E2E 12/12 | Struktur betul; happy-path register TIDAK diliputi (gap yang menyembunyikan S10-01) |
| S8/S9 baseline | 475→510 (+35 tests T1–T3) — baseline S9 intact ✅ |

## 25. SECURITY FINDINGS

| ID | Severity | Finding | Exploitability | Blocking? |
|---|---|---|---|---|
| S10-01 | 🟠 HIGH | `/auth/register` rosak pada DB migrasi-sahaja; policies registration tiada dalam migrasi; dev berjalan atas 2 policies manual | HQ invite → staff register gagal 100% pada deployment baharu | **YA — blocker** |
| S10-02 | 🟠 HIGH | `refresh_tokens` SELECT/UPDATE dibenarkan kepada SEMUA role ter-auth (doctor/receptionist nampak semua 275 row + boleh revoke) | Staff berprivilege rendah boleh logout-DoS seluruh org; token_hash terdedah (hash sahaja — tidak boleh dipakai langsung) | **YA — blocker** |
| S10-03 | 🟡 MEDIUM | Dev-DB drift (2 policies manual, 224≠223) tidak didokumenkan dalam mana-mana laporan T1–T4 | Rendah (dev-only) tapi punca S10-01 | Ya (fix bersama S10-01) |
| S10-05 | 🟡 MEDIUM | Tiada rate limiting pada endpoint auth (login/refresh/register brute-force) | Online, mudah | Tidak blocker LOCK; **wajib sebelum production** |
| S10-06 | 🔵 LOW | Laporan T1 claim "21 lint errors, semua pre-existing shadcn" — realiti 25, 9 dalam fail yang S10 ubah | — | Tidak |
| S10-08 | 🔵 LOW | invite-link baseUrl bebas (phishing vector insider) | Insider HQ sahaja | Tidak |
| S10-04 | 🔵 LOW | /metrics dilindungi oleh Caddy; operator mesti jangan expose 3000 | Salah konfigurasi operator | Tidak (runbook) |
| S10-09 | 🔵 LOW | Audit write failure ditelan (log-only) pada logout | Sangat rendah | Tidak |
| INFO | 🔵 | app/.env legacy prototipe di cakera (bukan git); npm tags tak pin digest; tiada PITR; monitoring stack tiada; happy-path register tiada dalam test suite | — | Tidak |

## 26. REMEDIATION STATUS

| Item | Status |
|---|---|
| Migration rehearsal | ✅ tapi perlu 0026 selepas fix |
| Docker build | ✅ (claim T4, struktur disemak statik) |
| Browser E2E | ⚠️ perlu tambah happy-path register (Journey G full) |
| Security smoke | ⚠️ perlu tambah probe RLS refresh_tokens matrix |
| Backup/Restore | ✅ proses; simpan artefak luar-VPS pre-go-live |

## 27. REMAINING RISKS

1. Full-stack staging di VPS sebenar belum pernah berlaku (WSL2 limitation) — pertama deployment sebenar akan menemui isu environtan (DNS/TLS/firewall) yang tidak boleh diuji di sini.
2. Register flow gagal (S10-01) — akan ditemui pada hari pertama operasi HQ.
3. RLS refresh_tokens longgar (S10-02) — insider threat.
4. Rate limiting tiada.
5. RPO 24h tanpa PITR untuk data klinikal.
6. Happy-path coverage gap: 510 test hijau tetapi aliran bisnes utama baharu tidak diuji hujung-ke-hujung — **false confidence** (pola yang sama seperti S8 audit pertama saya).

## 28. FINAL VERDICT

# 🔴 REJECT — MAJOR REMEDIATION REQUIRED

Bukan kerana kerja T2–T4 berkualiti rendah (infra, Docker, backup, immutability semuanya solid), tetapi kerana:

1. **Satu aliran bisnes kritikal (registration) tidak berfungsi pada sistem yang dibina dari migrasi sahaja** — dibuktikan live dua DB; dan tidak berfungsi penuh walaupun di dev.
2. **RLS `refresh_tokens` melanggar least-privilege** teruk berbanding standard S8/S9 yang telah dikunci (semua role boleh baca+revoke semua token).
3. **Test suite memberi false confidence** — 510/510 hijau sementara aliran utama baharu rosak; happy-path register tiada dalam mana-mana test.
4. **Dev DB mengandungi state yang tidak boleh direproduksi dari repo** — punca kelas bug ini (pola berulang sejak S8 0019).

**Remediation minimum sebelum re-audit:** migrasi `0026` yang (a) menambah policies worker-registration yang betul untuk `staff` (SELECT+UPDATE terhad kepada row `invite_token IS NOT NULL` oleh `system_worker`, dengan menghapus/menyelaraskan RESTRICTIVE exclusion conflict — sila rujuk pola 0022 S8 yang betul), (b) mengetatkan policies `refresh_tokens` (SELECT/UPDATE terhad hq + system_worker sahaja), (c) menyelaraskan dev supaya policy set = migrasi set (drift sifar); (d) test integration happy-path register penuh (invite→register→Pending→approve→Active→login) + probe matrix refresh_tokens per-role; kemudian re-audit bebas GLM sebelum ChatGPT governance review.

**Repo tidak diubah oleh auditor. Semua probe dalam transaksi rollback atau dibersihkan. Menunggu arahan governance.**

S10 GLM 5.3 INDEPENDENT FORENSIC AUDIT COMPLETE
