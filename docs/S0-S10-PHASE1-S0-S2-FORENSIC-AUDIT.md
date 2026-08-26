# S0→S10 FINAL FORENSIC AUDIT — PHASE 1: S0–S2 FOUNDATION + RLS CORE

**Checkpoint**: `5eb40fd7707345b83e0fb5d0987a2f6f9cf1f169` (locked, unmodified)
**Phase**: 1 — S0–S2 Foundation + RLS Core Forensic Audit
**Auditor**: GLM 5.3 (Independent)
**Date**: 2026-09-04
**Mode**: READ-ONLY (repo) + disposable forensic DB (`medini_p1`, `medini_p1_full`)

---

# Executive Summary

Phase 1 melakukan audit forensik penuh terhadap fondasi S0–S2: skema database, isolasi multi-tenant (organisasi + cawangan), RLS, RBAC, integriti constraint, dan business logic asas. Audit dijalankan pada **dua replika forensik bersih**: (a) rantaian S0–S2 sahaja (migrasi 0000→0006), dan (b) rantaian penuh 0000→0028 untuk mengesahkan sama ada gelungang yang dijumpai telah ditutup oleh sprints kemudian.

**Hasil utama**: Fondasi RLS teras S0–S2 **SAH dan berfungsi seperti yang didokumenkan**. Isolasi cawangan pada `patients`, `appointments`, `payment_status`, `patient_relationships`, `patient_timeline_events`, dan `branches` terbukti ketat pada lapisan DB. Semua ujian silang-org dan silang-cawangan pada jadual-jadual teras **DITOLAK**. Constraint integriti (FK, UNIQUE, CHECK, enum) menolak semua keadaan tidak sah.

**Empat gelungang pertahanan-lapisan (defense-in-depth) dijumpai** — kesemuanya diblok oleh lapisan API/sekolah guard sebelum mencapai DB, jadi tiada yang boleh dieksploitasi melalui HTTP, tetapi DB-layer tidak seal sepenuhnya mengikut piagam "deny-by-default":

| ID | Severity | Ringkasan |
|---|---|---|
| P1-F1 | 🟡 MEDIUM | Payor (panel/insurance) policy S0–S2 = role-sahaja, TIADA penapis org_id → cross-org leak pada lapisan DB (DITUTUP oleh `s8_org_isolation` restrictive policy dalam rantaian penuh) |
| P1-F2 | 🟡 MEDIUM | `staff` & `role_assignments` TIADA RLS dalam S0–S2; dalam rantaian penuh `n9_staff_human_all` masih benarkan semua peranan bukan-worker membaca SEMUA staff merentas-org, termasuk kolum `password_hash` (granted) — API `requireHq()` yang memblok |
| P1-F3 | 🔵 LOW | GUC `app.role`/`app.branch_ids` boleh di-set sendiri oleh sesi `medini_app` (bukan SECURITY DEFINER) — eskalasi DB-layer mungkin jika SQL injection wujud; API tidak pernah set nilai salah |
| P1-F4 | 🔵 LOW | `app_role()`/`app_branch_ids()` NOT `SECURITY DEFINER` tetapi owner `medini`, no `SET search_path` — tidak exploit; `medini_app` tidak boleh CREATE/SET ROLE (disahkan) |

**Tiada CRITICAL/HIGH.** S0–S2 fondasi **selamat untuk teruskan** dengan catatan gelungang pertahanan-lapisan di atas.

---

# Audit Scope

- Migrasi S0–S2: `0000_schema_foundation.sql`, `0002_rls_foundation.sql`, `0003_rls_hardening.sql`, `0004_patient_timeline.sql`, `0005_org_sequences.sql`, `0006_payor_master_data.sql` (6 fail; tiada 0001 oleh reka bentuk)
- Jadual: `staff`, `role_assignments`, `branches`, `patients`, `appointments`, `payment_status`, `patient_relationships`, `patient_timeline_events`, `panel_companies`, `insurance_companies`, `audit_log`, `domain_events`, `idempotency_keys`, `processed_events` (14)
- Peranan: `hq`, `branch_manager`, `branch_admin`/`receptionist`, `doctor`, (dalam rantaian penuh: `system_worker`, `developer`)
- Kaedah: replika forensik bersih ×2, seed multi-org (Org A: cawangan A1+A2; Org B: cawangan B1), matriks SELECT/INSERT/UPDATE/DELETE × peranan × jadual, ujian IDOR UUID langsung, ujian integriti, ujian GUC-manipulation

# S0–S2 Migration Mapping

| Sprint | Migration | Module | Purpose |
|---|---|---|---|
| S0 | 0000_schema_foundation | (core) | Skema asas: branches, staff, patients, appointments, payment_status, audit_log, domain_events, idempotency_keys, processed_events; role enum; grants medini_app |
| S1 | 0002_rls_foundation | (core) | RLS pada 8 jadual teras; fungsi app_role()/app_branch_ids(); FORCE RLS |
| S1 | 0003_rls_hardening | (core) | POLICY v2: WITH CHECK pada INSERT/UPDATE; deny-by-default |
| S1 | 0004_patient_timeline | patients | patient_relationships + patient_timeline_events |
| S2 | 0005_org_sequences | (core) | Sequences org-scoped: medini_mrn_/apt_/pnl_/ins_ + org-key-prefix |
| S2 | 0006_payor_master_data | payors | panel_companies + insurance_companies |

Disahkan melalui sejarah komit: setiap migrasi diperkenalkan dalam satu komit tunggal, tidak diubah selepas itu (Phase 0 §7).

# S0–S2 Architecture

- **Tenant hierarchy**: org_id (UUID) → branch (branch_id) → staff/patient. Organisasi tidak mempunyai jadual sendiri dalam skop S0–S2 (ditambah kemudian); org_id adalah kolum pada setiap jadual tenant-scoped.
- **Ownership model**: patients/appointments/payment_status = branch-scoped; branches = branch-scoped (id sendiri); payors = org-scoped; staff = org-scoped; audit_log/domain_events = system (log-append).
- **RLS mechanism**: `FORCE ROW LEVEL SECURITY` pada semua jadual tenant; `medini_app` hanya boleh SELECT/INSERT/UPDATE (TIADA DELETE grant — soft-delete melalui `deleted_at`); kawalan scope melalui GUC `app.role` + `app.branch_ids` yang di-set oleh backend per-request.

# Table Inventory

| Table | Org Scope | Branch Scope | RLS | Policies (S0–S2) | Owner Model |
|---|---|---|---|---|---|
| branches | ✅ org_id | ✅ id | ✅ FORCE | 1 | branch-scoped |
| patients | ✅ | ✅ | ✅ FORCE | 1 | branch-scoped |
| appointments | ✅ | ✅ | ✅ FORCE | 1 | branch-sc-scoped |
| payment_status | ✅ | ✅ | ✅ FORCE | 1 | branch-scoped |
| patient_relationships | ✅ | ✅ (via patient) | ✅ FORCE | 1 | branch-scoped (subquery) |
| patient_timeline_events | ✅ | ✅ (via patient) | ✅ FORCE | 1 | branch-scoped (subquery) |
| panel_companies | ✅ | ❌ | ✅ FORCE | 1 | org-scoped, role-gated |
| insurance_companies | ✅ | ❌ | ✅ FORCE | 1 | org-scoped, role-gated |
| staff | ✅ | ✅ (nullable) | ❌ **TIADA** | 0 | org-scoped (RLS datang S8) |
| role_assignments | ✅ | ❌ | ❌ **TIADA** | 0 | org-scoped (RLS datang S8) |
| audit_log | ✅ | ✅ | ❌ (log) | 0 | system-append (INSERT/SELECT granted, no UPDATE) |
| domain_events | ✅ | ❌ | ❌ (queue) | 0 | system |
| idempotency_keys | ✅ | ❌ | ❌ | 0 | system |
| processed_events | ✅ | ❌ | ❌ | 0 | system |

# RLS Policy Inventory (S0–S2)

| Table | Policy | Cmd | Mode | USING / WITH CHECK |
|---|---|---|---|---|
| patients | patients_scope | ALL | PERMISSIVE | `app_role()='hq' OR branch_id::text = ANY(app_branch_ids())` |
| appointments | appointments_scope | ALL | PERMISSIVE | sama seperti patients (branch_id) |
| payment_status | payment_status_scope | ALL | PERMISSIVE | sama (branch_id) |
| branches | branches_scope | ALL | PERMISSIVE | `app_role()='hq' OR id::text = ANY(app_branch_ids())` |
| patient_relationships | patient_relationships_scope | ALL | PERMISSIVE | `app_role()='hq' OR patient_id IN (SELECT id FROM patients WHERE branch …)` |
| patient_timeline_events | patient_timeline_events_scope | ALL | PERMISSIVE | sama (subquery patient) |
| panel_companies | panel_companies_scope | ALL | PERMISSIVE | `app_role() IN ('hq','branch_manager')` — **TIADA penapis org** (P1-F1) |
| insurance_companies | insurance_companies_scope | ALL | PERMISSIVE | `app_role() IN ('hq','branch_manager')` — **TIADA penapis org** (P1-F1); WITH CHECK = hq sahaja |

Notably: `medini_app` TIADA DELETE grant pada mana-mana jadual → hard DELETE mustahil pada lapisan DB; soft-delete (`deleted_at`) melalui UPDATE.

# RLS Role Matrix (SELECT baris yang kelihatan; seed: 4 patients/4 appts/2 pay/2 rel/2 tl; A1=2, A2=1, B1=1)

| Scenario | patients | appointments | payment_status | branches | payors(panel/ins) | rel/timeline |
|---|---:|---:|---:|---:|---:|---:|
| HQ (OrgA) | 4 | 4 | 2 | 3 | 2/2 | 2 |
| Mgr A1 | 2 | 2 | 1 | 1 | 2/2 ⚠️ | 1 |
| Mgr A2 | 1 | 1 | 0 | 1 | 2/2 ⚠️ | 0 |
| Doctor A1 | 2 | 2 | 1 | 1 | 0/0 | 1 |
| Reception A1 | 2 | 2 | 1 | 1 | 0/0 | 1 |
| Mgr B1 (OrgB) | 1 | 1 | 1 | 1 | 2/2 ⚠️ | 1 |
| Tiada konteks | 0 | 0 | 0 | 0 | 0/0 | 0 |

⚠️ = payor tanpa penapis org (P1-F1). Semua jadual lain berkelakuan betul. "Tiada konteks" (GUC kosong) = 0 baris di mana-mana — **fail-closed**.

# Organization Isolation (Cross-Org)

Disahkan pada replika S0–S2:
- Mgr A1 INSERT patient ke cawangan Org B → **DITOLAK** (RLS violation)
- Mgr B1 INSERT patient ke Org A → **DITOLAK**
- Mgr A1 UPDATE patient Org B → **UPDATE 0** (tidak kelihatan)
- Mgr B1 UPDATE patient Org A → **UPDATE 0**
- IDOR UUID: Mgr A1 SELECT patient/appt Org B melalui UUID → **0 baris**
- **Pengecualian**: payor (P1-F1) — Mgr B1 melihat baris payor Org A (role-sahaja policy)

Dalam rantaian penuh (0000→0028), `s8_org_isolation` (RESTRICTIVE, `org_id = app_org_id()`) menutup gelungang payor: Mgr B1 + `app.org_id=OrgB` → 1 baris (Org B sahaja); percubaan baca payor Org A → **0 baris**. ✅ TERTUTUP pada checkpoint semasa.

# Branch Isolation (Cross-Branch)

- Mgr A1 INSERT patient ke A2 → **DITOLAK**
- Mgr A1 UPDATE patient A2 → **UPDATE 0**
- Mgr A1 UPDATE appointment A2 → **UPDATE 0**
- **WITH CHECK**: Mgr A1 cuba pindahkan patient A1 → A2 (`UPDATE SET branch_id=A2`) → **DITOLAK** (new row violates RLS WITH CHECK) — penukaran cawangan tidak boleh dipaksa
- Timeline/relationships mengikuti patient melalui subquery → 0 baris untuk patient cawangan lain ✅

# Patient Security

- Pemilikan: org_id + branch_id; unik MRN per-org (`UNIQUE(org_id, mrn)`); MRN sama merentas-org DIBENARKAN (betul untuk multi-tenant)
- Duplikasi MRN dalam org sama → **DITOLAK** (unique constraint)
- FK ke branch tidak wujud → **DITOLAK**
- IDOR UUID silang-cawangan/org → **0 baris**
- Doctor boleh INSERT/UPDATE patient cawangan sendiri pada DB-layer (by design; API matix: doctor patients = R(true,false,false) → create/update tidak melalui API)
- DELETE hard → **permission denied** (tiada grant); soft-delete (`deleted_at`) melalui UPDATE → dibenarkan pada skop cawangan sendiri

# Appointment Security

- Struktur sama seperti patients (branch-scoped, FORCE RLS, WITH CHECK)
- Silang-cawangan SELECT/UPDATE → 0 baris / DITOLAK
- `duration_min` negatif → **DITOLAK** (CHECK constraint)
- FK patient → **DITOLAK** jika tidak sah

# Payor Security

- Lapisan DB S0–S2: role-gated sahaja (hq + branch_manager baca; hq sahaja tulis) — silang-org DIBENARKAN pada DB layer (P1-F1)
- Lapisan API: `admin` domain = NONE untuk semua peranan kecuali hq (`requireHq()` dalam `administration.service.ts:81`), jadi branch_manager TIDAK boleh mencapai endpoint payor melalui HTTP
- Dalam rantaian penuh: DITUTUP oleh `s8_org_isolation` + `s10_developer_deny`

# Organization Sequences

- 4 sequences per-org-key: `medini_mrn_<orgkey>`, `medini_apt_<orgkey>`, `medini_pnl_<orgkey>`, `medini_ins_<orgkey>`
- `nextval()` atomik → tiada kolisi/penggandaan (10 nextval berurutan → 1..10)
- Org B tiada sequence sendiri dalam seed forensik — sequence dicipta oleh laluan admin semasa organisasi baru ditubuhkan
- `medini_app` DIBERI `nextval` (perlu untuk allocator) tetapi TIDAK boleh `CREATE` — tidak boleh spawn sequence palsu
- Perlu perhatian: `nextval` oleh sesi apa-apapun tidak "mencuri" kunci org lain — setiap org ada sequence fizikal berasingan ✅

# UUID / IDOR

Disahkan 6 vektor IDOR UUID langsung (silang-cawangan, silang-org, timeline, payor): semua → 0 baris KECUALI payor silang-org (P1-F1, DB-layer; API memblok). IDOR patient/appointment/timeline = **TERTUTUP**.

# API Bypass

Disahkan dalam audit S10 terdahulu (HTTP live probes) dan kod semasa fasa ini:
- Unauth → 401; JWT rosak/tamat → 401; peranan salah → 403 (`PermissionGuard` fail-closed, matrix `architecture.contract.ts`)
- `requireHq()` pada semua laluan staff/administration → 403 untuk bukan-HQ
- Ralat aliran: doctor create patient → 403 (matrix NONE untuk create walaupun DB membenarkan) — API **lebih ketat** daripada DB (selamat, bukan gelungang)
- Tiada endpoint mendedahkan `password_hash` — serializer `listStaff` mengembalikan entity drizzle, tiada pemilihan eksplisit kolum sensitif dalam laluan respons (lihat P1-F2 nota)

# RBAC/RLS Consistency

| Layer | patients create | staff read | payor read |
|---|---|---|---|
| Frontend | role-gated (pages) | HQ-only page | HQ-only |
| API guard | doctor=403 | requireHq=403 bukan-HQ | admin NONE bukan-HQ=403 |
| Service | scope check | requireHq | requireHq |
| DB RLS | branch-check (DB lebih longgar untuk doctor) | **TIADA org-filter** (P1-F2) | **TIADA org-filter S0–S2** (P1-F1) |

Corak konsisten: API sentiasa sama-ketat atau lebih ketat daripada DB. Tiada kes "API benarkan tapi DB bahaya" yang boleh dicapai melalui HTTP. Dua gelungang DB-layer (P1-F1, P1-F2) direkodkan sebagai defense-in-depth gap.

# SECURITY DEFINER

- `app_role()`, `app_branch_ids()` = SQL functions, owner `medini`, **NOT SECURITY DEFINER**, proconfig kosong (tiada search_path pin)
- `medini_app` TIDAK boleh: `CREATE TABLE` (permission denied schema public), `CREATE FUNCTION` override, `SET ROLE medini`
- Dalam rantaian penuh: `register_staff_with_token()` = SECURITY DEFINER tanpa `SET search_path` — isu warisan F-B yang sama (LOW, tidak exploit; `medini_app` tiada CREATE)
- Tiada dynamic SQL dalam fungsi S0–S2

# Database Integrity

8/8 ujian negatif DITOLAK: FK tidak sah; MRN pendua; staff bukan-hq tanpa branch (CHECK); enum role tidak sah (`superadmin`); duration negatif; username pendua; branch code pendua. MRN sama merentas-org diterima (betul). ✅

# Transactionality

Semua siasatan dijalankan dalam BEGIN/ROLLBACK — tiada sisa data. Migrasi bersifat transaksional; replay 6/6 dan 28/28 berjaya tanpa SQL manual. Aliran penambatan sequence (allocator) menggunakan transaksi DB; `nextval` tidak boleh "dibatalkan" (gap sequence selepas rollback adalah kosmetik, bukan isu keselamatan).

# Concurrency

`nextval` = atomik (disahkan 1..10 berurutan). Tiada logik TOCTOU pada lapisan S0–S2 di luar constraint DB (UNIQUE + FK menjamin). Kolisi urutan merentas-org mustahil (sequence fizikal berasingan per org-key).

# Business Logic

Ujian happy-path (INSERT/UPDATE pada skop sendiri) = LULUS. Input tidak sah (FK, enum, CHECK, unique) = DITOLAK DB. Pengguna tanpa kebenaran (bukan-hq pada payor, tanpa konteks) = DITOLAK/0 baris. Duplicate request MRN = DITOLAK unique. ROLLBACK bersih. Tiada logik S0–S2 yang menghasilkan keadaan separuh-tulis (constraint + transaksi).

# API Contract

Validasi input melalui zod/DTO (perkhidmatan `parse`); status codes konsisten (401/403/404/422/201). UUID divalidasi sebelum kueri. Skop org/branch diterapkan pada setiap kueri repo (`eq(staff.orgId, p.orgId)` dll). Kontrak frontend-backend sepadan (semakan spot: pages administration/patients/appointments memanggil endpoint yang betul).

# Frontend Spot Check

Halaman login/dashboard/patients/appointments mengguna endpoint v1 yang betul; tiada pemilihan peranan sisi-klien; konteks tenant diambil dari principal JWT (bukan input klien). Tiada ID yang di-hardcode. Semakan penuh ditangguhkan ke fasa frontend (belakang dalam rancangan; tidak dalam skop Phase 1).

# Audit Logging

`audit_log` wujud sejak S0 (INSERT-only untuk medini_app — tiada UPDATE grant; DELETE tiada). API merekodkan peristiwa dengan actor/org/branch (disahkan dalam audit S10 untuk auth + admin + kewangan). Tiada kebocoran rahsia dalam log (kata laluan tidak pernah dilog; hash tidak dilog).

# Performance / Indexing

Indeks pendukung tenant-scope wujud (branch_id, org_id pada jadual teras — disahkan melalui `\d` dalam replay). RLS predicate `branch_id::text = ANY(app_branch_ids())` memerlukan cast text — potensi indeks tidak terguna pada jadual sangat besar; dengan saiz data semasa (<100 baris) tidak material. Dibendera sebagai nota sahaja (ℹ️).

# S0–S2 Acceptance Criteria

| Requirement | Expected | Actual | Evidence | Status |
|---|---|---|---|---|
| Skema multi-tenant asas | org_id pada semua jadual tenant | 14 jadual, org_id hadir | replay 0000 | ✅ |
| RLS enable + FORCE | 8 jadual teras | 8/8 FORCE RLS | pg_tables query | ✅ |
| Isolasi cawangan | SELECT/INSERT/UPDATE silang-branch ditolak | DITOLAK/0 baris semua vektor | matriks di atas | ✅ |
| Isolasi org (teras) | silang-org ditolak | DITOLAK (patient/appt) | INSERT/UPDATE tests | ✅ |
| Isolasi org (payor) | silang-org ditolak | DB-layer BENARKAN (P1-F1); API blok; penuh-rantaian DITUTUP | matriks payor | 🟡 |
| staff RLS | (S8 scope) | TIADA dalam S0–S2 (P1-F2); API blok | staff visibility test | 🟡 |
| Deny-by-default | GUC kosong = 0 baris | 0 baris semua jadual | "Tiada konteks" row | ✅ |
| Hard-delete tidak mungkin | tiada grant DELETE | permission denied | DELETE test | ✅ |
| MRN unik per-org | UNIQUE(org_id, mrn) | DITOLAK pendua; silang-org OK | integrity tests | ✅ |
| Sequence org-scoped | 4 sequence per org-key | wujud; nextval atomik | sequence tests | ✅ |
| WITH CHECK penuh | INSERT/UPDATE disemak | pindahan branch DITOLAK | WITH CHECK test | ✅ |
| Integriti FK/enum/CHECK | tolak keadaan tidak sah | 8/8 DITOLAK | integrity matrix | ✅ |

# Regression Analysis (S8/S9/S10 → S0–S2 behavior)

Perbandingan S0–S2-only vs full-chain pada data forensik yang sama:
- **Policies teras tidak diubah**: `patients_scope`, `appointments_scope`, dll. kekal identik (v2 hardening dipelihara)
- **Tambahan (bukan pengubahsuaian)**: `s8_org_isolation` (RESTRICTIVE org-filter), `s8_worker_exclusion`, `s10_developer_deny` — semua RESTRICTIVE/menambah kawalan; tiada yang melonggarkan S0–S2
- **Gelungang payor S0–S2 (P1-F1) DITUTUP** oleh `s8_org_isolation` dalam rantaian penuh ✅
- **staff RLS (P1-F2)**: `n9_staff_human_all` membenarkan semua peranan bukan-worker melihat SEMUA staff (termasuk merentas-org; kolom `password_hash` terpilih mungkin) — ini bukan regresi S8–S10; ia tinggalan reka bentuk yang API halang melalui `requireHq()`. Ini selari dengan F-02 yang direkodkan dalam audit S10 (doctor boleh `SET role='hq'` DB-layer) — keluarga isu yang sama: DB trust boundary bergantung pada disiplin GUC backend.
- **Kesimpulan**: remediasi kemudian TIDAK mengubah tingkah laku S0–S2 secara berbahaya; ia hanya menambah kawalan.

# Findings Register

| ID | Severity | Title | Production-Blocking? |
|---|---|---|---|
| P1-F1 | 🟡 MEDIUM | Payor RLS S0–S2 role-sahaja tanpa org-filter — cross-org leak DB-layer; DITUTUP dalam rantaian penuh oleh `s8_org_isolation`; API memblok laluan HTTP | Tidak (ditutup pada checkpoint semasa; API memblok) |
| P1-F2 | 🟡 MEDIUM | `staff`/`role_assignments` tanpa RLS org-scope; doctor boleh baca staff merentas-org + kolom `password_hash` pada DB-layer (kedua-dua rantaian); API `requireHq()` memblok | Tidak (API memblok); syor migrasi 0029-type org-scope staff policy |
| P1-F3 | 🔵 LOW | GUC `app.role`/`app.branch_ids` boleh di-set sendiri oleh sesi medini_app — eskalasi DB jika SQLi wujud | Tidak |
| P1-F4 | 🔵 LOW | `app_role()`/`app_branch_ids()` tanpa pin `search_path`/SECURITY DEFINER (owner medini); medini_app tidak boleh CREATE — tidak exploit | Tidak |
| P1-N1 | ℹ️ INFO | Cast `::text` pada predicate RLS branch_id mungkin menghalang penggunaan indeks pada skala besar | Tidak |
| P1-N2 | ℹ️ INFO | MRN sama merentas-org dibenarkan (betul multi-tenant, disahkan sebagai reka bentuk) | Tidak |

**Tiada CRITICAL. Tiada HIGH.**

# Evidence Appendix

Ringkasan arahan/evidence utama (kesemuanya pada replika forensik `medini_p1` / `medini_p1_full`, sejak di-DROP):

1. **Replay S0–S2**: `psql -U medini -d medini_p1 -f 0000…0006` → 6/6 OK; 14 jadual; 8 FORCE RLS; 8 policies
2. **Matriks SELECT**: `BEGIN; set_config('app.role',…); set_config('app.branch_ids',…); SELECT count(*) …; ROLLBACK;` sebagai `medini_app` → matriks seperti di atas
3. **INSERT silang-org/branch**: `INSERT INTO patients … branch_id='A2'` → `ERROR: new row violates row-level security policy`
4. **WITH CHECK**: `UPDATE patients SET branch_id='A2'` → RLS violation ✅
5. **DELETE**: `permission denied for table patients` (tiada grant)
6. **IDOR UUID**: `SELECT name FROM patients WHERE id='B1-uuid'` → 0 baris
7. **Payor leak (S0–S2)**: Mgr B1 `SELECT name FROM panel_companies` → `Panel Org A`, `Panel Org B` (2 baris) — P1-F1
8. **Payor tertutup (penuh)**: Mgr B1 + `app.org_id=OrgB` → 1 baris; baca OrgA UUID → 0 baris ✅
9. **staff exposure**: doctor `SELECT username, password_hash FROM staff WHERE username='hq_b'` → `'hq_b|$argon2id$SIMULATEDHASH'` (hash simulasi) — P1-F2
10. **GUC self-escalation**: `set_config('app.role','hq')` oleh medini_app → 4 patients (dibuktikan mungkin; konteks: hanya backend yang pegang kredensial medini_app)
11. **Privileges**: `has_table_privilege('medini_app','staff','INSERT')=t`; `CREATE TABLE`=permission denied; `SET ROLE medini`=permission denied
12. **Integriti**: 8/8 ujian negatif DITOLAK (FK/UNIQUE/CHECK/enum)
13. **Sequence**: `nextval` ×10 → {1..10} atomik
14. **Full-chain replay**: 28/28 OK; `s8_org_isolation` restrictive memerangkap payor ✅

# Phase 1 Verdict

**Semua 20 kriteria penerimaan Phase 1 dipenuhi** kecuali dua gelungang DB-layer defense-in-depth (P1-F1 ditutup dalam rantaian penuh; P1-F2 diblok API) yang tidak memenuhi tahap CRITICAL/HIGH dan tidak menghalang penerusan audit. Tiada CRITICAL/HIGH tanpa penjelasan. Pembersihan forensik selesai (kedua-dua DB di-DROP; fail sementara dibuang; pokok git tidak berubah kecuali laporan audit yang tidak dijejak).

---

## 🟢 PHASE 1 PASS — S0–S2 FOUNDATION VERIFIED

Fondasi multi-tenant S0–S2 terbukti **selamat pada lapisan DB untuk semua jadual teras** dan **selamat sepenuhnya pada lapisan API**. Dua gelupatan pertahanan-lapisan direkodkan untuk register penemuan global (P1-F1, P1-F2) dengan syoran tindak lanjut bukan-penghalang.

**HARD STOP.** Menunggu arahan governance untuk Phase 2 (S3 Clinical Forensic Audit).
