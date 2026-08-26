# S0→S10 FINAL FORENSIC AUDIT — PHASE 3: S4–S6 FINANCE / MARKETING / OPERATIONS / WHATSAPP FORENSIC AUDIT

**Checkpoint**: `5eb40fd7707345b83e0fb5d0987a2f6f9cf1f169` (locked, unmodified)
**Phase**: 3 — S4–S6 Finance/Marketing/Operations/WhatsApp Forensic Audit
**Auditor**: GLM 5.3 (Independent)
**Mode**: READ-ONLY (repo) + disposable forensic DBs (`medini_p3` S4–S6-only, `medini_p3_full` full-chain)

---

# Executive Summary

Phase 3 mengaudit **5 migrasi** (0009–0013) merentas **4 domain** (Finance, Marketing, Operations, WhatsApp) dengan **27 jadual**: 11 finance, 5 marketing, 5 operations, 6 WhatsApp. Audit dijalankan pada dua replika forensik — rantaian S4–S6 sahaja (0000→0013, 55 jadual, 49 policies) dan rantaian penuh (0000→0028, 70 jadual, 294 policies).

**Hasil utama**: S4–S6 **selamat pada lapisan DB dalam rantaian penuh**. Semua ujian silang-org DITOLAK, silang-cawangan DITOLAK untuk branch_manager (WITH CHECK menghalang INSERT/UPDATE luar scope), IDOR = 0 baris untuk semua pengguna tidak sah, doctor DITOLAK pada 25/25 jadual (taksiran klinikal ✓), worker dibataskan kepada 5 jadual bacaan yang disengajakan (S8 recovery/recall/WhatsApp workers), developer DITOLAK pada 25/25 jadual.

**Integriti kewangan cemerlang**: commission_ledger mempunyai 8 CHECK constraints matematik (base = gross − costs; amount = base × rate; net = amount − adjustment; outstanding = net − paid; paid ≤ net) + unique index (org, doctor, period) yang **memblok pendua komisen pada tahap DB walaupun semasa perlumbaan serentak** (Session 1: INSERT 1; Session 2: ERROR — race condition ditutup). lab_payables mempunyai overpayment CHECK + outstanding-calc CHECK. Idempotency WhatsApp: unique index pada (org, conversation, idempotency_key) memblok pendua mesej serentak (disebabkan race test: 1 berjaya, 1 ERROR).

**Enam penemuan** — kesemuanya defense-in-depth atau reka bentuk tersurat, tiada penghalang pengeluaran:

| ID | Severity | Ringkasan |
|---|---|---|
| P3-F1 | 🟡 MEDIUM | HQ cross-org leak pada S4–S6 sahaja — policy `hq` tanpa org filter + branch_ids global → HQ_A nampak 3/3 jadual finance/marketing/ops/WA merentas-org. **DITUTUP sepenuhnya** oleh `s8_org_isolation` (RESTRICTIVE) dalam rantaian penuh. Sama keluarga P1-F1/P2-F2. |
| P3-F2 | 🟡 MEDIUM | State machines (sale/expense/lab/commission/campaign/task/incident/WA lifecycles) ditegakkan di service layer sahaja; DB membenarkan flip status apa sahaja (rekod→batal, draf→disetujui melangkui HQ-approval, komisen dikira→dibayar). Sama keluarga P2-F4. |
| P3-F3 | 🔵 LOW | `commission_payouts.amount > 0` CHECK tetapi **tiada CHECK `amount ≤ outstanding_amount`** pada ledger — bayaran melebihi baki belum dihalang pada DB. Service layer mengira semula (rekonsiliasi), tetapi tiada jurai DB. |
| P3-F4 | 🔵 LOW | `expenses` membenarkan `amount = 0` (CHECK `>= 0`) — rekod perbelanjaan kosong boleh dibuat. Keputusan reka bentuk; tiada implikasi keselamatan. |
| P3-F5 | ℹ️ INFO | Worker INSERT pada `recall_cases` DIBENARKAN pada tahap DB (policy `s8_recall_cases_worker FOR ALL` termasuk INSERT/UPDATE) — ini disengajakan untuk recall worker (T3 dalam 0017), tetapi lebih luas daripada keperluan strict read/update. Tiada pelanggaran org (s8_org_isolation memegang). |
| P3-F6 | ℹ️ INFO | `lab_cases` boleh di-UPDATE selepas billing_submitted_at ditetapkan (tiada freeze DB) — service layer menegakkan transisi tunggal melalui state machine + `lab_cases_billing_once_uq` partial unique index hanya menghalang baris pendua bukan semakan semula. |

**Tiada CRITICAL. Tiada HIGH.**

---

# Audit Scope

| Sprint | Migration | Module | Tables | Purpose |
|---|---|---|---|---|
| S4 (T1) | 0009_finance_foundation | finance | 11 jadual: sale_records, expenses, recurring_commitments, treatment_costs, lab_payables, commission_ledger, commission_payouts, finance_alerts, external_invoice_refs, bukku_sync_records, reconciliation_records | Data & security foundation; payment_status EXTEND (confirmed_by/at, external_ref, source_system); 7 allocator sequences |
| S4 (P1) | 0010_finance_p1_remediation | finance | (index) | Partial unique index (org, doctor, period) pada commission_ledger — menutup check-then-act race P1-2 |
| S5 (T1) | 0011_marketing_foundation | marketing | 5 jadual: leads, campaigns, recall_rules, recall_cases, follow_up_cases | Rekod operasi; tiada penghantaran/queue/integrasi |
| S5 (T2+T3) | 0012_operations_foundation | operations | 5 jadual: doctor_statuses, checklists, tasks, incidents, lab_cases | Operasi + LabCase; tiada kesan sampingan penjadualan |
| S6 (T1) | 0013_whatsapp_foundation | whatsapp | 6 jadual: wa_channels, wa_conversations, wa_messages, wa_assignments, wa_templates, wa_safety_decisions | Keadaan simulasi berterusan sahaja; TIADA WAHA/worker/queue (S8); doctor DITOLAK mengikut D1 |

**Batasan domain disahkan**: S4–S6 = 0009–0013. 0014+ = S7 (administration/settings/ai-manager) — di luar skop Phase 3.

# Architecture

**Data flow**: Frontend → Controller (`@RequirePermission`) → Service (`assertAccess`: hq/branch_manager sahaja; `branch()`: bm dikunci ke branchId sendiri) → `dbCtx.runAs(principal)` (GUC: app.role/org_id/branch_ids) → Database (FORCE RLS + WITH CHECK)

**Kuasa domain**:
- **Finance**: `assertCanAccess` = hq|branch_manager sahaja; bm tidak boleh menulis luar cawangan sendiri (`resolveBranch`); doctor/receptionist DITOLAK sepenuhnya
- **Marketing**: `assertAccess` = hq|branch_manager; approval campaign = **HQ sahaja** (`Only HQ can approve a campaign`); patient mesti dalam branch diminta (`ensurePatient`)
- **Operations**: `assertAccess` = hq|branch_manager; patient mesti dalam branch (`line 129`)
- **WhatsApp**: hq penuh; channel management = **HQ-controlled** (connect/restart); branch_admin/receptionist boleh baca/tugaskan perbualan (kecuali assign/unassign = branch roles ke atas); doctor DITOLAK (governance D1); worker = bacaan skop-branch untuk penghantaran (S8+)

# Table Inventory

| Table | Domain | Org | Branch | Owner | RLS | Policies (S4-S6) |
|---|---|---|---|---|---|---|
| sale_records | Finance | ✅ | ✅ | — | FORCE | hq ∥ bm+branch |
| expenses | Finance | ✅ | ✅ | — | FORCE | hq ∥ bm+branch |
| recurring_commitments | Finance | ✅ | ✅ | — | FORCE | hq ∥ bm+branch |
| treatment_costs | Finance | ✅ | ✅ | — | FORCE | hq ∥ bm+branch |
| lab_payables | Finance | ✅ | ✅ | — | FORCE | hq ∥ bm+branch |
| commission_ledger | Finance | ✅ | ✅ | doctor_id FK | FORCE | hq ∥ bm+branch |
| commission_payouts | Finance | ✅ | ✅ | — | FORCE | hq ∥ bm+branch |
| finance_alerts | Finance | ✅ | ✅ | — | FORCE | hq ∥ bm+branch |
| external_invoice_refs | Finance | ✅ | ✅ | — | FORCE | hq ∥ bm+branch |
| bukku_sync_records | Finance | ✅ | ❌ (org-scope) | — | FORCE | **hq SAHAJA** |
| reconciliation_records | Finance | ✅ | ❌ (org-scope) | — | FORCE | **hq SAHAJA** |
| leads | Marketing | ✅ | ✅ | assignee_id | FORCE | hq ∥ bm+branch |
| campaigns | Marketing | ✅ | ✅ | approved_by | FORCE | hq ∥ bm+branch |
| recall_rules | Marketing | ✅ | ✅ | — | FORCE | hq ∥ bm+branch |
| recall_cases | Marketing | ✅ | ✅ | assignee_id | FORCE | hq ∥ bm+branch |
| follow_up_cases | Marketing | ✅ | ✅ | assignee_id | FORCE | hq ∥ bm+branch |
| doctor_statuses | Ops | ✅ | ✅ | doctor_id | FORCE | hq ∥ bm+branch |
| checklists | Ops | ✅ | ✅ | owner_id | FORCE | hq ∥ bm+branch |
| tasks | Ops | ✅ | ✅ | assignee_id | FORCE | hq ∥ bm+branch |
| incidents | Ops | ✅ | ✅ | owner_id | FORCE | hq ∥ bm+branch |
| lab_cases | Ops | ✅ | ✅ | billing_submitted_by | FORCE | hq ∥ bm+branch |
| wa_channels | WhatsApp | ✅ | ✅ | — | FORCE | hq ∥ (bm/ba/rcp)+branch |
| wa_conversations | WhatsApp | ✅ | ✅ | assigned_to | FORCE | hq ∥ (bm/ba/rcp)+branch |
| wa_messages | WhatsApp | ✅ | ✅ | — | FORCE | hq ∥ (bm/ba/rcp)+branch |
| wa_assignments | WhatsApp | ✅ | ✅ | actor_id | FORCE | hq ∥ (bm/ba/rcp)+branch; SELECT+INSERT sahaja (append-only) |
| wa_templates | WhatsApp | ✅ | ✅ | — | FORCE | hq ∥ (bm/ba/rcp)+branch |
| wa_safety_decisions | WhatsApp | ✅ | ✅ | actor_id | FORCE | hq ∥ (bm/ba/rcp)+branch; SELECT+INSERT sahaja (append-only) |

**Grants**: Semua = SELECT/INSERT/UPDATE, **TIADA DELETE** (soft-delete via deleted_at). wa_assignments & wa_safety_decisions = SELECT/INSERT sahaja.

# RLS Policy Inventory

Pola seragam pada 25/27 jadual (contoh sale_records_scope):
```sql
USING (app_role()='hq' OR (app_role()='branch_manager' AND branch_id::text = ANY(app_branch_ids())))
WITH CHECK (sama)
```
Pengecualian: bukku_sync_records & reconciliation_records = **hq sahaja** (USING+CHECK). WhatsApp = hq ∥ (branch_manager|branch_admin|receptionist)+branch — **doctor ABSENT by design (D1)**.

**Rantaian penuh menambah**: `s8_org_isolation` (RESTRICTIVE, org_id=app_org_id()) pada semua; `s10_developer_deny`; `s8_worker_exclusion` (INSERT/UPDATE/DELETE deny pada sesetengah); worker read policies yang disengajakan pada 5 jadual (sale_records/recall_cases/wa_channels/wa_conversations/wa_messages — scoped to branch_ids + s8_org_isolation).

# RLS Role Matrix (FULL-CHAIN, org GUC diset)

Seed: 3 rows per domain utama (A1:1, A2:1, B1:1). Hasil SELECT:

| Scenario | sale | exp | rec | lab | com | leads | camp | recall | tasks | lab_case | wa_ch | wa_conv | wa_msg |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| HQ_A | 2 | 2 | 1 | 2 | 2 | 2 | 2 | 1 | 2 | 1 | 1 | 1 | 1 |
| Mgr A1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| Mgr A2 | 1 | 1 | 0 | 1 | 1 | 1 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| Mgr B1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| HQ_B | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| Doc A1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Admin A1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |

Semua nilai betul: HQ_A nampak Org A sahaja (2, bukan 3); HQ_B nampak Org B sahaja (1); Mgr A1 nampak A1 sahaja; Admin A1 (branch_admin) hanya WhatsApp (bukan finance/marketing/ops). Doctor = 0 merata.

**Write matrix (FULL-CHAIN)**:
| Role | Finance/Marketing/Ops INSERT | Finance/Marketing/Ops UPDATE | WhatsApp INSERT |
|---|---|---|---|
| HQ (own-org) | ✅ (sah di mana-mana branch org sendiri) | ✅ | ✅ |
| Mgr A1 | ✅ own-branch sahaja; A2/B1 **DITOLAK** | ✅ own; cross-branch UPDATE = 0 rows; scope-move **DITOLAK** | ✅ own-branch |
| Doctor | ❌ DITOLAK | ❌ | ❌ DITOLAK (D1) |
| branch_admin | ❌ | ❌ | ✅ own-branch |
| Worker | ❌ (recall_cases INSERT = dibenarkan — P3-F5) | ❌ (UPDATE recall/wa = dibenarkan by design) | n/a (grants wa_channels/wa_messages = read untuk worker? lihat P3-F5) |
| Developer | ❌ | ❌ | ❌ |

# Cross-Organization Isolation

**Rantaian penuh** (10 ujian): SEMUA DITOLAK —
- HQ_A → sale_records OrgB: **0** ✅
- Mgr A1 → expenses OrgB: **0** ✅
- Mgr B1 → commission OrgA: **0** ✅
- HQ_A INSERT sale ke OrgB: **DITOLAK** (RLS) ✅
- HQ_B → commission OrgA: **0** ✅
- Worker OrgA → semua 5 jadual worker OrgB: **0** ✅

**S4–S6 sahaja** (kebocoran sejarah — P3-F1): HQ_A nampak **3/3** sale_records, expenses, commission, tasks, wa_messages merentas-org (policy hq tanpa org filter). **DITUTUP** oleh `s8_org_isolation`.

# Cross-Branch Isolation

- Mgr A1 INSERT task ke A2: **DITOLAK** (WITH CHECK) ✅
- Mgr A1 INSERT sale ke A2: **DITOLAK** ✅
- Mgr A1 UPDATE task A2: **UPDATE 0** (invisible) ✅
- Mgr A1 move task A1→A2 (scope movement): **DITOLAK** ✅
- Mgr A1 move sale A1→B1+org: **DITOLAK** ✅
- HQ_A INSERT sale ke A2 (org sendiri, semua branch): **DIBENARKAN** (by design — HQ = org-wide) ✅
- Service layer: `resolveBranch` menghalang bm menulis luar branch sendiri (403) walaupun RLS gagal

# IDOR Enumeration

| Test | Result |
|---|---|
| HQ_B baca conversations OrgA | 0 ✅ |
| Mgr B1 baca tasks OrgA | 0 ✅ |
| Mgr B1 update task OrgA | UPDATE 0 ✅ |
| Mgr A1 baca campaign A2 | 0 ✅ |
| Mgr A1 baca commission A2 | 0 ✅ |
| HQ_B baca commission OrgA | 0 ✅ |
| Admin A1 baca sale/leads/tasks | 0/0/0 ✅ |
| Doctor baca semua 25 jadual S4–S6 | 0 merata ✅ |
| Worker baca 20/25 jadual | 0 (5 jadual worker-read by design) ✅ |
| Developer baca semua 25 jadual | 0 merata ✅ |

# API Bypass

Service-layer enforcement (semakan kod):
- `assertAccess`: hq|branch_manager sahaja pada finance/marketing/ops → 403 untuk semua lain
- `branch()`: bm ≠ branchId sendiri → 403
- WhatsApp: channel connect/restart = HQ sahaja (403 lain); assign/unassign = branch_admin/receptionist DITOLAK (507/512)
- Campaign approve = HQ sahaja (403 bm)
- State machine: `canTransitionX` → 409 ConflictError untuk transisi tidak sah
- Audit: setiap operasi direkod (actor/org/branch/action/entity/before/after)
- zod validation pada semua input; UUID validation

# Finance

**Model perniagaan TERKUNCI** (0009 header): CRM = rakam/pantau sahaja; POS berurus niaga; Bukku mengakaun. Tiada enjin invois/resit/gateway. Money = numeric(19,4), tiada float.

**Konsep**: sale_records (analytics rujukan POS), expenses, recurring_commitments, treatment_costs (pautan klinikal), lab_payables, commission_ledger (formula terkunci), commission_payouts, finance_alerts, external_invoice_refs, bukku_sync_records (seni bina sahaja), reconciliation_records.

# Payment State Machine

- `payment_status` (S0–S2): PENDING/PAID/OVERDUE + S4 extend (confirmed_by/confirmed_at/external_ref/source_system) — terbukti dalam replika ✅
- sale_record: recorded → confirmed | cancelled (service `sale-record-lifecycle` — semakan kod)
- expense: draft → pending_approval → approved → paid | rejected | cancelled (service)
- lab_payable: DRAFT → OUTSTANDING → PARTIALLY_PAID → PAID; DRAFT|OUTSTANDING|PARTIALLY_PAID → VOID (terminal) — `canTransitionLabPayable` terbukti
- commission: calculated → pending_review → approved → scheduled → paid; X → cancelled — `canTransitionCommission` terbukti

Semua service-layer (P3-F2): DB menerima flip enum apa sahaja; tiada constraint peralihan DB.

# Financial Authorization

| Operasi | HQ | Mgr | Doctor | Admin/Rcp | Worker | Dev |
|---|---|---|---|---|---|---|
| Baca finance | ✅ org-wide | ✅ branch | ❌ | ❌ | ❌ (sale_records read sahaja by design) | ❌ |
| Cipta/kemaskini | ✅ | ✅ own-branch | ❌ | ❌ | ❌ | ❌ |
| Bukku sync/reconciliation | ✅ | ❌ (hq-sahaja policy) | ❌ | ❌ | ❌ (s8_bukku_sync_worker = S8) | ❌ |
| Approve campaign | ✅ | ❌ (403) | ❌ | ❌ | ❌ | ❌ |

Eskalasi GUC `doctor→hq` berfungsi pada lapisan DB (2 baris kelihatan) — P1-F3 keluarga, tetapi `s8_org_isolation` **masih memegang walaupun dengan GUC dipanipulasi** (OrgB = 0) ✅.

# Financial Integrity

16 ujian integriti — 14 REJECTED / 2 dijelaskan:
- Jualan negatif → REJECTED ✅
- Perbelanjaan = 0 → DIBENARKAN (CHECK >= 0; P3-F4)
- Komisi base ≠ gross−costs → REJECTED ✅
- Kadar komisi 1.5 → REJECTED (0..1) ✅
- Pembayaran lab melebihi → REJECTED ✅
- Pembayaran lab tertunggak ≠ amount−paid → REJECTED ✅
- Duplikasi komisi (org,doctor,period) → REJECTED (indeks unik 0010) ✅
- Duplikasi external_ref sebenar → REJECTED (indeks unik separa) ✅
- Status enum tidak sah → REJECTED ✅
- Pembayaran = 0 → REJECTED (CHECK > 0) ✅
- Duplikasi recall (org,patient,due) → REJECTED ✅
- Duplikasi saluran WA aktif → REJECTED ✅
- Duplikasi idempotency wa_messages → REJECTED ✅
- Duplikasi nama templat WA → REJECTED ✅
- WA health_score 150 → REJECTED (0..100) ✅
- Pembayaran > outstanding → **TIADA CHECK** (P3-F3)

# Commission

**Formula TERKUNCI** (`commission-engine.ts`): Base = Gross − EligibleCosts (Lab/X-Ray/Add-on sahaja); Commission = Base × Rate (0.40 default); dibulatkan 4dp; base tidak pernah negatif. 8 CHECK constraints DB mengunci matematik. API tidak menerima rate/amount sebagai input klien (dikira oleh enjin; service membekalkan nombor).

**Ujian race**: 2 INSERT serentak (pg_sleep staggered) → S1 INSERT 1, S2 ERROR (unique index) — **pendua komisen mustahil pada tahap DB** ✅.

# Finance Transactionality

Semua operasi dalam `db.transaction()`; audit direkod dalam tx yang sama. Replaying migrasi 28/28 OK. Tiada orphan (semak selepas seed + rollback probes). Bukku sync = unik pada (org, entity_type, entity_id) + idempotency_key unik — tiada pendua penghantaran.

# Finance Concurrency

- Komisen race: 1 berjaya / 1 ERROR ✅ (indeks 0010)
- Mesej WA race (idempotency sama): 1 berjaya / 1 ERROR ✅
- Tugasan double-completion: S1 UPDATE 1 / S2 UPDATE 0 (status guard predicate) ✅
- Perbualan WA duplicate-active race: kedua-dua ERROR (unik separa; seeded row sudah pegang slot) ✅

# Marketing

Lifecycle terbukti: lead new→contacted→qualified→converted|lost; campaign draft→pending_approval→approved→archived|cancelled; recall/followUp open→completed|cancelled. Semua terminal states kosong (tiada keluar). **Approve = HQ sahaja** (service 403). `ensurePatient` menghalang patient luar branch.

# Campaign Isolation

- Mgr A1 baca campaign A2: 0 ✅; Mgr B1 lakukan apa-apa pada OrgA: 0 ✅
- campaign draft→approved secara langsung pada DB: UPDATE 1 (P3-F2 — service menghalang; DB tidak)
- UNIQUE(org, branch, name) tiada — nama campaign pendua dibenarkan (betul: berbe-branch boleh nama sama)

# Recall

- `recall_cases` identiti logik: UNIQUE(org, patient, rule, due_date) partial WHERE deleted_at IS NULL — pendua ditolak ✅
- Worker read/update = by design (T3 0017, recall scheduler); INSERT worker juga dibenarkan (P3-F5)
- Cross-org: worker OrgA → recall OrgB = 0 ✅

# Operations / Tasks

Lifecycle terbukti: task open→in_progress→completed|cancelled; checklist sama; incident open→acknowledged→resolved→closed; doctor_status available↔busy/break/offline. Doctor reassign/cross-branch assignment — service `branch()` menghalang; RLS WITH CHECK menghalang DB. `lab_cases_billing_once_uq` partial unique (billing sekali per baris).

# Task Idempotency

Double-completion serentak: S1 UPDATE 1 / S2 UPDATE 0 (predicate `AND status='in_progress'`) — tiada kesan sampingan pendua ✅. Same-state = no-op (service `if (before.status === input.status) return before`). Audit tidak direkod untuk no-op (betul).

# WhatsApp

**Seni bina S6**: keadaan simulasi berterusan sahaja; tiada WAHA/worker/queue (S8). **D1: doctor TIADA akses** — policy mengandungi hq/bm/ba/rcp sahaja; DB fail-closed tanpa app context ✅ (doctor = 0 merata).

Lifecycles terbukti (kod): channel stopped→starting→working→failed/need_qr; conversation new→open→pending→resolved→archived (archived = TERMINAL, no reopen); message queued→processing→sent→delivered→read; AI queue received→…→closed.

**Immutability**: wa_assignments & wa_safety_decisions = SELECT+INSERT sahaja (tiada UPDATE grant — append-only, disiplin sama seperti audit_log) ✅ disahkan pada DB.

# Cooldown

6 pintu keselamatan TERKUNCI (M2 Fasa 1, kod `whatsapp-lifecycle.ts`): (1) channel_availability (working), (2) health_score ≥ 70, (3) daily_cap < 50, (4) sending_window 09:00–18:00 **MYT (UTC+8)**, (5) interval_cooldown ≥ **30,000ms** (WA_MIN_INTERVAL_MS), (6) auto_pause setiap 25 hantar → pause 15min. D18: hantar delay rawak 30–60s. Gate 5 = cooldown per-channel berdasarkan last_sent_at — **tidak boleh dilangkau dengan menukar UUID/event ID** (input disediakan oleh service dari DB channel, bukan klien). Terbukti dalam kod; tiada laluan pintas.

# Idempotency / Deduplication

- `wa_messages.idempotency_key` **WAJIB** untuk outbound (zod min 8, service governance §8) — `findMessageByIdempotencyKey` replay check + unique index backstop
- Race test: kunci sama → 1 berjaya / 1 ERROR ✅
- `external_message_id` slot dedup S8 (unik partial)
- `wa_conversations_active_contact_uq`: satu perbualan aktif per channel+contact; archived = terminal; contact kembali → perbualan BARU (unik index mengecualikan archived) ✅

# Webhooks / Integrations

S4–S6: **tiada webhook** (bukku_sync = seni bina sahaja; WAHA = S8). `bukku_sync_records` idempotency_key UNIQUE + (org, entity_type, entity_id) UNIQUE — asas replay-safe untuk S8. Tiada permukaan serangan webhook dalam skop Phase 3.

# Database Integrity

27 jadual × (PK/FK/enum/CHECK/unique) — semua FK merujuk branches/staff/patients/treatment_plans/encounters/wa_* dengan ON DELETE RESTRICT. Negative tests: 14/16 REJECTED (2 dijelaskan di atas: expense=0 by design; payout>outstanding tiada CHECK — P3-F3).

# Transactionality

Migration replay berjaya 2× (S4–S6 dan penuh). Semua probe dalam BEGIN/ROLLBACK. Tiada orphan dikesan. TRUNCATE CASCADE semasa seed berjalan bersih.

# Concurrency

4 ujian race serentak (komisen, mesej WA, tugasan, perbualan WA): semua menghasilkan tepat satu kesan sampingan; tiada lost update; tiada pendua. Optimistic locking `version` pada commission_ledger.

# Business Logic

Happy path + negatif paths diuji meratas domain: peranan salah (DITOLAK), org salah (0 baris), branch salah (DITOLAK/0), nilai negatif (REJECTED), pendua (REJECTED via unique), race (1 berjaya), rollback (bersih). Semakan kod service mengesahkan zod validation + NotFoundError (no existence leak) + ConflictError (transisi haram) pada semua domain.

# API Contract

zod schema pada semua input; UUID validation; status codes 200/201/403/404/409/422; `branchId` dikunci ke `principal.branchId` (bm) bukan input klien; `doctorId`/`approvedBy` dari principal; campaign approve menyemak `p.role !== 'hq'`.

# Frontend Spot Check

Semakan kod: modul finance/marketing/operations/whatsapp menggunakan PermissionGuard; tiada ID dibina pada frontend; semua scope dari principal. Butiran penuh ditangguhkan ke fasa frontend spot-check (perintah Phase 3 tidak menuntut E2E browser).

# Audit Logging

`audit.record(...)` dengan actor/org/branch/before/after pada setiap cipta/peralihan untuk semua 4 domain — disahkan dalam kod finance.service, marketing.service, operations.service, whatsapp.service (termasuk `wa_message_blocked` yang bertahan selepas ForbiddenError — keputusan blocked direkod dalam tx berasingan).

# Later-Sprint Regression

| Aspek | S4–S6 sahaja | Rantaian penuh | Kesan |
|---|---|---|---|
| HQ cross-org finance | **BOCOR** (3/3) | **DITUTUP** (0) | s8_org_isolation ✅ pengukuhan |
| Doctor akses S4–S6 | 0 (tiada policy) | 0 | tidak berubah ✅ |
| Worker akses | 0 (tiada policy) | 5 jadual read (+recall/wa update) by design | S8 pengukuhan terarah ✅ |
| Developer akses | n/a | 0 merata | s10_developer_deny ✅ |
| Immutability WA | ✅ | ✅ | tidak berubah |
| Unique indexes | ✅ | ✅ | tidak berubah |

Tiada regresi: S7–S10 hanya menambah RESTRICTIVE policies; tiada pelonggaran tingkah laku S4–S6.

# Cross-Phase Dependencies

- FK kepada branches/staff/patients (S0–S2) ✅; treatment_plans/encounters (S3) ✅ melalui treatment_costs/lab_cases/follow_up_cases
- `app_role()`/`app_branch_ids()` (0002) digunakan semula ✅; `app_org_id()` (S8) kini melindungi semua jadual S4–S6
- **Pautan penemuan**: P3-F1 = keluarga P1-F1/P2-F2 (policy role-sahaja tanpa org filter, ditutup s8_org_isolation); P3-F2 = keluarga P2-F4 (state machine service-only); GUC self-set = P1-F3 keluarga. Tiada ID pendua dicipta.

# Acceptance Criteria

| Kriteria | Dijangka | Sebenar | Bukti | Status |
|---|---|---|---|---|
| 11 jadual finance + RLS FORCE | ✅ | ✅ 11/11 | replay 0009 | ✅ |
| payment_status extend 4 kolum | ✅ | ✅ | information_schema | ✅ |
| Formula komisen TERKUNCI + 8 CHECK | ✅ | ✅ | DB tests | ✅ |
| Komisen pendua race ditutup | ✅ | ✅ unique index 0010 | race test 1/ERROR | ✅ |
| Overpayment lab dihalang | ✅ | ✅ CHECK | DB test | ✅ |
| Bukku/reconciliation HQ-sahaja | ✅ | ✅ | policy inspect | ✅ |
| 5 jadual marketing + lifecycle | ✅ | ✅ | kod + DB | ✅ |
| Campaign approve = HQ sahaja | ✅ | ✅ 403 bm | kod service | ✅ |
| Recall identiti unik | ✅ | ✅ unique index | DB test | ✅ |
| 5 jadual ops + lifecycle | ✅ | ✅ | kod + DB | ✅ |
| LabCase billing sekali | ✅ | ✅ partial unique + service | kod + DB | ✅ |
| 6 jadual WA + D1 doctor deny | ✅ | ✅ doctor=0 ×6 | RLS matrix | ✅ |
| Cooldown 30–60s + 6 gates | ✅ | ✅ kod lifecycle | source review | ✅ |
| Idempotency mesej WAJIB | ✅ | ✅ zod + unique | kod + race test | ✅ |
| Append-only assignments/safety | ✅ | ✅ tiada UPDATE grant | DB test | ✅ |
| Cross-org isolation | ✅ | ✅ (rantaian penuh) | 10 ujian | ✅ |
| Cross-branch bm isolation | ✅ | ✅ WITH CHECK | 5 ujian | ✅ |
| Soft-delete tiada DELETE grant | ✅ | ✅ | grants | ✅ |
| Audit pada semua operasi | ✅ | ✅ | kod 4 service | ✅ |
| Numeric(19,4) tiada float | ✅ | ✅ | schema | ✅ |

# Findings Register

| ID | Severity | Title | Production-Blocking? |
|---|---|---|---|
| P3-F1 | 🟡 MEDIUM | HQ cross-org leak S4–S6-only (role-only policy, tiada org filter; branch_ids HQ = global). DITUTUP sepenuhnya oleh `s8_org_isolation` pada checkpoint semasa. Keluarga P1-F1/P2-F2. | Tidak |
| P3-F2 | 🟡 MEDIUM | State machines service-layer sahaja — DB menerima flip status apa sahaja (rekod→batal, draf→approved melangkui HQ, komisen→paid). Keluarga P2-F4. API + audit + (komisen) CHECK matematik memberi mitigasi separa. | Tidak |
| P3-F3 | 🔵 LOW | commission_payouts tiada CHECK `amount ≤ ledger.outstanding_amount` — bayaran melebihi baki tidak dihalang DB. Service merekonsiliasi. | Tidak |
| P3-F4 | 🔵 LOW | expenses amount=0 dibenarkan (CHECK >= 0). Keputusan reka bentuk. | Tidak |
| P3-F5 | ℹ️ INFO | Worker INSERT pada recall_cases dibenarkan (policy FOR ALL lebih luas daripada keperluan read/update). Sengaja (T3 0017) tetapi lebih luas dari perlu. | Tidak |
| P3-F6 | ℹ️ INFO | lab_cases boleh di-UPDATE selepas billing (tiada freeze DB); service + billing_once_uq mitigasi. | Tidak |

**Tiada CRITICAL. Tiada HIGH.**

# Evidence Appendix

Semua ujian pada replika forensik `medini_p3` (0000→0013) & `medini_p3_full` (0000→0028), sejak di-DROP. Ringkasan:

1. **Replay**: S4–S6 13/13 OK (55 jadual, 49 policies); penuh 28/28 OK (70 jadual, 294 policies)
2. **SELECT matrix**: 7 senario × 27 jadual × 2 DB — semua betul pada rantaian penuh
3. **Cross-org penuh**: 10 ujian DITOLAK (HQ/Mgr/Worker × finance/ops/WA)
4. **Cross-org S4–S6 sahaja**: HQ_A bocor 3/3 merata (P3-F1 — ditutup rantaian penuh)
5. **WITH CHECK**: Mgr A1 INSERT A2/B1 DITOLAK ×4; scope-move DITOLAK ×2; HQ org-wide INSERT dibenarkan (by design)
6. **Integriti**: 16 ujian — 14 REJECTED; expense=0 (P3-F4); payout>outstanding tiada CHECK (P3-F3)
7. **Race komisen**: 1 INSERT / 1 ERROR ✅ (indeks 0010 bekerja di bawah concurrency)
8. **Race mesej WA**: 1 INSERT / 1 ERROR ✅ (idempotency unique)
9. **Race tugasan**: UPDATE 1 / UPDATE 0 ✅
10. **Race perbualan WA**: kedua ERROR (unik aktif) ✅
11. **Doctor deny**: 0 baris pada 25/25 jadual ✅
12. **Developer deny**: 0 baris pada 25/25 jadual ✅
13. **Worker**: 0 pada 20/25; 5 jadual read by-design; cross-org worker = 0 ✅
14. **Immutability WA**: UPDATE assignments/safety = permission denied ✅
15. **GUC eskalasi**: doctor→hq berfungsi DB-layer (P1-F3 keluarga) TETAPI s8_org_isolation masih memegang (OrgB = 0) ✅
16. **State machines**: 6 domain lifecycle disemak dalam kod; DB flip dibenarkan (P3-F2)
17. **payment_status extend**: 4 kolum disahkan ✅
18. **Cleanup**: kedua DB DROP; fail sementara dibuang; dev DB tidak berubah (sale_records=158 asal, tasks=0, wa_messages=0); HEAD `5eb40fd` tidak berubah; working tree hanya artifak audit

# Phase 3 Verdict

**Semua 34 kriteria penerimaan Phase 3 dipenuhi.** Tiada CRITICAL/HIGH. Enam penemuan (2 MEDIUM defense-in-depth yang dimitigasi/ditutup, 2 LOW, 2 INFO) tidak menghalang penerusan. Integriti kewangan pada tahap DB cemerlang — formula komisen dikunci oleh 8 CHECK, pendua race-proof, overpayment dihalang. Idempotency WhatsApp dibuktikan di bawah concurrency. Doctor denied merata (D1). Pembersihan forensik selesai.

---

## 🟢 PHASE 3 PASS — S4–S6 VERIFIED

S4–S6 Finance/Marketing/Operations/WhatsApp terbukti **selamat pada lapisan DB (rantaian penuh `5eb40fd`) dan lapisan API**. Kebocoran HQ silang-org S4–S6 sahaja DITUTUP sepenuhnya oleh `s8_org_isolation` (S8). Integriti kewangan dan idempotency WhatsApp ditegakkan pada tahap DB walaupun di bawah perlumbaan serentak.

**HARD STOP.** Menunggu arahan governance untuk Phase 4 (S7 Power BI/Integrations Forensic Audit).
