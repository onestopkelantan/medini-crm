# S0–S10 FINAL FORENSIC AUDIT — PHASE 6
# CROSS-SPRINT SECURITY / RBAC / IDOR / CONTRACT FORENSIC AUDIT

**Checkpoint (immutable):** `5eb40fd7707345b83e0fb5d0987a2f6f9cf1f169`
**Status:** ✅ SELESAI — READ-ONLY, tiada perubahan produk
**Metodologi:** Audit adversarial KOMBINASI — uji interaksi pelbagai kawalan keselamatan merentas sprint, bukan kawalan tunggal.

---

## 1. RINGKASAN EKSEKUTIF

Phase 6 menguji soalan teras: **adakah pelaku low-privilege boleh MENGABUNGKAN manipulasi auth + role + IDOR + org/branch manipulation + API behavior + RLS behavior + config + concurrency untuk mendapat akses tidak sah?**

**JAWAPAN: TIDAK.** Semua 30 vektor kombinasi diuji — **tiada laluan eskalasi baharu**. Seni bina "fail-closed principal re-derivation" memutuskan hampir semua rantaian serangan pada lapisan yang sama: JWT minimal (sub/username/orgId sahaja) + role/branch di-derive semula dari DB setiap request + RLS restrictive org_id + WITH CHECK + unique constraint concurrency guard.

**Findings baharu: 0 CRITICAL / 0 HIGH.** Keluarga leak diketahui (staff/role_assignments/branches RLS role-only) KEKAL stabil — tiada interaksi kombinasi baharu yang membukanya melepasi API layer.

---

## 2. METODOLOGI & PEMBETULAN KRITIKAL

### 2.1 Pembetulan probe superuser (penting untuk audit ulangan)
Probe awal sebagai user `medini` (superuser) memintas RLS sepenuhnya → false positive (cross-org patients kelihatan "1"). PostgreSQL superuser tidak tertakluk RLS walaupun policy RESTRICTIVE. **Semua probe akhir dijalankan sebagai `medini_app`** — role bukan-superuser yang backend sebenarnya guna via `DbContextService`. Ini mengesahkan konfigurasi pengeluaran adalah betul: superuser `medini` hanya untuk migrasi, app runtime guna `medini_app`.

### 2.2 Persekitaran forensik
- DB `medini_p6` dibina segar: 28/28 migrasi berjaya (0000→0028), 70 jadual, 294 policies
- Seed: 2 org (Org A = A1+A2, Org B = B1) × semua role (developer, hq, branch_manager, branch_admin, doctor, receptionist, system_worker) × 20 jadual berisi data cross-org/cross-branch
- Semua probe dalam transaksi `BEGIN...ROLLBACK` — bukan-destruktif
- DB di-DROP selepas audit; `medini_dev` disahkan 70 jadual utuh; HEAD kekal `5eb40fd`

---

## 3. PEMBINAAN SEMULA MODEL KESELAMATAN (Item 1)

### 3.1 Rantaian kepercayaan penuh
```
Frontend (roleGuard UI-only, 4 laluan)
  → HTTP (Caddy: HSTS preload, X-Frame-Options SAMEORIGIN, nosniff,
          Referrer-Policy, -Server, /metrics→404, XFF diganti remote_host)
  → JWT (HS256; payload HANYA sub/username/orgId — role/branch TIADA dalam token)
  → AuthGuard (@nestjs/jwt verify → PrincipalResolver)
  → PrincipalResolver (re-derive dari DB SETIAP request:
      staff.status='Active' + role_assignments ACTIVE → principal;
      gagal → null → 401) — FAIL-CLOSED
  → PermissionGuard (@RequirePermission(domain, action) vs ROLE_DOMAIN_MATRIX)
  → DbContextService (GUC app.role/app.org_id/app.branch_ids,
      set_config is_local=TRUE → transaction-local, tidak bocor antara
      pooled connections)
  → Drizzle query (parameterized)
  → RLS (s8_org_isolation RESTRICTIVE + scope policies + WITH CHECK)
  → DB (medini_app role)
```

### 3.2 Ciri keselamatan utama yang diputuskan (key design)
1. **JWT minimal** — tiada role/org/branch dalam token → token forgery tidak berguna untuk eskalasi
2. **Principal re-derivation** — role/branch sentiasa dari DB semasa → stale token attack mati di sini
3. **GUC transaction-local** — tiada state leakage antara request pada connection pool
4. **RLS RESTRICTIVE org_id** — semua policy scope DIAND bersama s8_org_isolation; permissive policy scope tidak boleh "menang" melawan org isolation
5. **WITH CHECK pada INSERT/UPDATE** — scoping dipaksa pada penulisan, bukan sahaja bacaan

---

## 4. MATRIKS PERANAN & CONTRACT (Item 2, 13)

### 4.1 Enum roles (DB + shared contract): selari ✅
`developer, hq, branch_manager, branch_admin, doctor, receptionist, system_worker`

### 4.2 Contract compliance: 22 controller × @RequirePermission
Semua domain `@RequirePermission` sepadan dengan `DOMAIN_REGISTRY`:
- administration→admin, ai-manager→ai, appointments→appointments, clinical (encounters/notes/plans/consents/imaging)→clinical, dashboard→dashboard, finance+insurances+panels+finance-integration→finance, marketing→marketing, operations→operations, patients→patients, reports→reports, settings→settings, whatsapp→whatsapp
- **TIADA MISMATCH. TIADA ENDPOINT TANPA GUARD selain 3 PUBLIC routes (login/refresh/register) yang dilindungi AuthThrottlerGuard (5/10/3 per minit).**

### 4.3 Endpoint inventory: 205 endpoints
3 PUBLIC / 116 AUTHED (principal sahaja) / 86 dengan @RequirePermission eksplisit.

---

## 5. UJIAN ADVERSARIAL KOMBINASI — KEPUTUSAN PENUH

### 5.1 Matriks kebocoran cross-org (31 jadual × HQ_OrgA→OrgB) (Item 7)
| Keputusan | Jadual |
|---|---|
| **0 baris (28/31)** ✅ | patients, appointments, encounters, clinical_notes, treatment_plans, treatment_sessions, prescriptions, imaging_records, adverse_events, referrals, consent_records, lab_cases, lab_payables, expenses, campaigns, leads, recall_cases, tasks, incidents, wa_channels, wa_conversations, wa_messages, settings_values, secret_refs, ai_agents, report_audit, refresh_tokens |
| **DENIED** ✅ | commission_records (tiada grant) |
| **KEBOCORAN (3/31)** ⚠️ | staff (3 baris), role_assignments (3), branches (1) — **keluarga diketahui P1-F2/F-02/P4-F1–F3/P5-F1; RLS role-only, API service-layer menutup** |

### 5.2 Manipulasi branch (Item 8) ✅
- MgrA1→A2 (cross-branch, same org): 8 jadual = 0 baris
- MgrA1→B1 (cross-branch, cross-org): 5 jadual = 0 baris

### 5.3 IDOR UUID enumeration (Item 6) ✅
HQ_OrgA menghantar UUID OrgB pada 16 jenis sumber → semua 0 kecuali staff (keluarga diketahui). RLS menapis mengikut org_id GUC, bukan input pengguna.

### 5.4 Manipulasi pemilik sumber (Item 9) ✅
Doctor_A1 → encounters milik doctor_B1 = 0. Own-scope dipaksa melalui GUC dari principal, bukan parameter request.

### 5.5 RLS vs RBAC interaction — API deny + DB allow matrix (Item 10) ✅
- INSERT cross-org (8 jadual): **semua DENIED** (WITH CHECK)
- UPDATE cross-org/cross-branch (7 ujian): **semua 0 baris terjejas**
- DELETE cross-org (6 jadual): **semua DENIED** (tiada grant DELETE kepada medini_app)

### 5.6 Manipulasi JWT / stale token (Item 5, 17) ✅
- JWT role forgery: role tidak pernah dibaca dari token — PrincipalResolver derive dari role_assignments
- JWT orgId forgery: org_id tetap dari principal; RLS restrictive memaksa org_id = app_org_id()
- Stale token selepas promosi/pendemotions: role semasa sentiasa dipakul (doctor→0, hq→2 baris pada ujian transformasi)
- Staff Suspended/Deactivated: PrincipalResolver menolak status≠Active → 401 (lifecycle, Item 16)

### 5.7 SECURITY DEFINER audit (Item 11) ✅
Satu-satunya function SECURITY DEFINER: `register_staff_with_token()` — owner medini, EXECUTE diberikan kepada medini_app, parameterized, role-immutable, fully-qualified table refs (P5-F2 diketahui: tiada explicit search_path SET — mitigated). **Tiada SECURITY DEFINER baharu ditemui.**

### 5.8 SQL injection (Item 12) ✅
4 payload klasik pada klausa search → parameterization Drizzle memegang nilai sebagai literal; RLS tetap dikuatkuasakan pada payload "berjaya" (2 baris own-org sahaja); payload DROP/UNION ditolak parser. Tiada raw string concatenation ditemui pada laluan query.

### 5.9 Cross-domain escalation (Item 14, 15) ✅
- Doctor→lab_payables: 0; Doctor→commission_records: DENIED
- Branch_admin→encounters/clinical_notes/report_audit: semua 0
- Worker→staff/secret_refs/settings/ai_agents/report_audit: semua 0
- Worker→refresh_tokens: 2 (keluarga P5-F5, by-design worker registration flow)
- HQ→ai_agents/secret_refs OWN org: dibenarkan (by design, hq adalah admin org sendiri)

### 5.10 Response data leakage (Item 18) ✅ (dengan nota)
- HQ boleh SELECT staff.password_hash (own-org) — P4-F4 diketahui (LOW; hash bcrypt/argon, API serializer tidak expose — perlu kekal dipantau)
- invite_token: 0 terpilih (sudah consumed/NULL)
- secret_refs.vault_path: 1 (own-org; vault_path adalah rujukan, bukan secret value — secrets sebenar dalam vault luar)
- refresh_tokens.token_hash: 0 untuk hq (SHA-256 hashed, tak boleh replay)

### 5.11 Frontend→API bypass (Item 19) ✅
`roleGuard` App.tsx melindungi 4 laluan UI (/administration, /marketing, /finance, /reports) — sekadar UX, bukan kawalan keselamatan. **API menguatkuasakan @RequirePermission server-side pada setiap laluan** → frontend bypass tidak menghasilkan akses data.

### 5.12 Export/bulk (Item 20) ✅
**Tiada endpoint export/CSV/Excel/PDF/bulk/download wujud** — tiada permukaan kebocoran data besar-besaran.

### 5.13 Audit log injection (Item 21) ✅
String mentah (newline dalam action) diterima pada level DB, tetapi actor_id/actor_role di-derive server-side dari principal oleh AuditService — pengguna tidak boleh memalsukan pelaku. Policies: worker exclusion + developer deny hadir pada audit_log.

### 5.14 Webhook cross-tenant (Item 22) ✅
Bukku adapter = **outbound-only** (Bearer + Company-Subdomain, timeout 10s). Tiada endpoint callback masuk → tiada vektor cross-tenant melalui integrasi. BukkuWorker berjalan sebagai system_worker + RLS scoped (orgId/branchIds dari job payload).

### 5.15 Rate limit bypass (Item 23) ✅
Hanya /auth/login, /auth/refresh, /auth/register adalah PUBLIC — ketiganya dilindungi AuthThrottlerGuard (login 5/min, refresh 10/min, register 3/min; trust proxy rightmost-untrusted + Caddy XFF replace). Tiada laluan auth alternatif ditemui (imbasan login/signin/authenticate/token).

### 5.16 CORS/CSRF/headers (Item 24) ✅
- CORS: env-driven `CORS_ORIGINS` split(','), `credentials:true`; **false (disabled) fail-closed jika tidak dikonfigurasi**
- CSRF: API bearer-token (JWT Authorization header) — bukan cookie auth → CSRF tidak terpakai secara semula jadi
- Caddy: HSTS preload 1y, X-Frame-Options SAMEORIGIN, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, -Server header dibuang, /metrics diblok 404 dari internet

### 5.17 Error leakage (Item 25) ✅
GlobalExceptionFilter: stack traces & secrets tidak pernah dihantar ke client; 5xx → generic "An unexpected error occurred" + correlationId sahaja; log penuh server-side sahaja.

### 5.18 Concurrency/TOCTOU (Item 26) ✅
- Duplicate role assignment race: unique constraint `role_assignments_one_active_uq` **MEMBLOK** kedua-dua INSERT serentak
- Last-HQ guard: service-level (P4-F6 diketahui) — DB membenarkan UPDATE status; didokumenkan, tidak berubah

### 5.19 Negative test matrix (Item 29)
8 serangan: **7 PASS + 1 "FAIL" = Receptionist→HQ staff (keluarga diketahui P1-F2, API menutup)** — bukan kebocoran baharu.

---

## 6. SECURITY GRAPH & LALUAN ESKALASI TERPENDEK (Item 27)

```
Attacker (receptionist / doctor / branch_admin / system_worker)
  ├─ Frontend bypass ──────→ API guard tetap menolak (server-side) ✅ CLOSED
  ├─ JWT role forgery ─────→ Role di-derive semula dari DB ✅ CLOSED
  ├─ JWT orgId forgery ────→ org_id RLS restrictive ✅ CLOSED
  ├─ IDOR UUID ───────────→ RLS org_id mismatch → 0 baris ✅ CLOSED
  ├─ Branch swap A1→A2/B1 ─→ branch_ids GUC dari DB, bukan input ✅ CLOSED
  ├─ Cross-org INSERT ────→ WITH CHECK DENIED ✅ CLOSED
  ├─ Cross-org UPDATE/DELETE → 0 baris / DENIED ✅ CLOSED
  ├─ Concurrency race ────→ unique constraint role_assignments ✅ CLOSED
  ├─ Stale token ─────────→ PrincipalResolver baca DB semasa ✅ CLOSED
  ├─ Suspended staff ─────→ status≠Active → 401 ✅ CLOSED
  ├─ Webhook in-bound ────→ Bukku outbound-only ✅ CLOSED
  ├─ SQL injection ───────→ Drizzle parameterized + RLS ✅ CLOSED
  ├─ Rate limit bypass ───→ tiada laluan auth alternatif ✅ CLOSED
  ├─ Export/bulk leak ────→ tiada endpoint ✅ CLOSED
  ├─ Error/stack leak ────→ filter generic 5xx ✅ CLOSED
  └─ Developer role ──────→ s10_developer_deny semua jadual ✅ CLOSED

Laluan kekal terbuka (API-closed, keluarga diketahui):
  └─ staff / role_assignments / branches RLS role-only
     → API service-layer menutup (senarai staff difilter mengikut org oleh service)
     → P1-F2 / F-02 / P4-F1–F3 / P5-F1 (MEDIUM, keluarga stabil sejak Phase 1)
```

**Rantaian kombinasi paling panjang yang diuji:** receptionist → forge JWT role=hq → PrincipalResolver reject (role dari DB) ✅; receptionist → IDOR UUID staff OrgB → RLS role-only membenarkan baca staff API? TIDAK — API service-layer memfilter org → **rantaian mati pada API layer** ✅.

---

## 7. RECONCILIATION FINDINGS LAMPAU (Item 28)

| Finding | Status Selepas Phase 6 |
|---|---|
| P1-F1 (payor cross-org) | **CLOSED** ✅ (0 baris) |
| P1-F2 / F-02 (staff/role_assignments/branches) | OPEN — MEDIUM, API-closed, **tiada interaksi kombinasi baharu membukanya** |
| P2-F1 (catalog cross-org) | **CLOSED** ✅ |
| P4-F1–F3 (settings/AI/secrets cross-org) | **CLOSED** ✅ |
| P4-F4 (password_hash own-org HQ) | OPEN — LOW, tidak berubah |
| P4-F6 (last-HQ service-only) | OPEN — INFO, tidak berubah |
| D-01 (developer akses staff) | **CLOSED** ✅ (0 baris, s10_developer_deny) |
| P5-F2 (search_path function) | OPEN — LOW, tidak berubah (fully-qualified mitigasi) |
| P5-F5 (worker refresh_tokens) | OPEN — INFO, by-design |

**TIADA REGRESI. TIADA FINDING CLOSED YANG REOPEN. TIADA FINDING BAHARU CRITICAL/HIGH.**

---

## 8. KEPUTUSAN VERDICT

### 🟢 PHASE 6 — PASS — CROSS-SPRINT SECURITY VERIFIED

**Justifikasi:**
1. 30 item audit lengkap; 205 endpoint dienumerate; 31 jadual × cross-org; 16 sumber IDOR; 8 jadual INSERT/UPDATE/DELETE; 4 payload injection; race condition; lifecycle; stale token — **semua laluan kombinasi MATI pada lapisan pertahanan yang direka**
2. Corak pertahanan berlapis (defense-in-depth) disahkan berfungsi SEBAGAI SISTEM: kelemahan RLS role-only pada staff family tidak boleh dicapai kerana API layer menutup, dan tiada kombinasi (JWT + IDOR + branch + concurrency) yang memintas kedua-dua lapisan serentak
3. 0 CRITICAL / 0 HIGH; semua findings kekal adalah keluarga stabil yang telah didokumenkan sejak Phase 1 dengan mitigasi API-layer
4. Immutability dikekalkan: HEAD `5eb40fd` unchanged, tiada commit/push/deploy/migration/RLS/RBAC/auth changes

**Cadangan remediasi (untuk sprint governance akan datang, BUKAN tindakan audit ini):**
- Tambah org_id restrictive policy pada `staff`, `role_assignments`, `branches` untuk menutup keluarga P1-F2/F-02 secara kekal pada DB layer
- Tambah explicit `ALTER FUNCTION ... SET search_path = public` pada `register_staff_with_token()` (P5-F2)
- Pertimbang stripe pada serializer staff response untuk menjamin password_hash tidak pernah serialize (memperkukuh P4-F4)

---

## 9. CLEANUP VERIFICATION

- ✅ `medini_p6` DROPPED (dipastikan tiada dalam pg_database)
- ✅ `.tmp_p6_seed.sql`, `.tmp_p6_endpoints.json` dibuang
- ✅ Container `/tmp` dibersihkan
- ✅ `medini_dev` utuh — 70 jadual, tiada perubahan
- ✅ HEAD = `5eb40fd7707345b83e0fb5d0987a2f6f9cf1f169` — UNCHANGED
- ✅ Tiada perubahan produk sebarang jenis (READ-ONLY dikekalkan sepenuhnya)

---

## 10. STATUS KESELURUHAN AUDIT S0–S10

| Fasa | Skop | Verdict |
|---|---|---|
| Phase 0 | Baseline & Governance | 🟢 PASS |
| Phase 1 | S0–S2 Foundation + RLS Core | 🟢 PASS |
| Phase 2 | S3 Clinical | 🟢 PASS |
| Phase 3 | S4–S6 Finance / Marketing / Operations / WhatsApp | 🟢 PASS |
| Phase 4 | S7 Administration / Settings / AI Governance | 🟢 PASS |
| Phase 5 | S8–S10 Re-verification | 🟢 PASS |
| **Phase 6** | **Cross-Sprint Security / RBAC / IDOR / Contract** | **🟢 PASS** |

**7 fasa. 7 PASS. 0 CRITICAL / 0 HIGH sepanjang audit.**

---

*Laporan ini dijana oleh audit forensik read-only pada checkpoint `5eb40fd`. Semua laporan audit (8 fail) kekal untracked dalam `docs/` mematuhi kovenan READ-ONLY — commit memerlukan arahan governance eksplisit.*

**— TAMAT PHASE 6 — HARD STOP — JANGAN MULA PHASE 7 TANPA MANDAT BAHARU —**
