# GLM 5.3 — FINAL S0→S10 FORENSIC AUDIT: PLANNING, SCOPE & EFFORT ASSESSMENT

**Checkpoint**: `5eb40fd` (GLM 🟢 APPROVE for ChatGPT Governance Review)
**Mod**: PLANNING ONLY — tiada pelaksanaan audit, tiada pengubahsuaian
**Tarikh**: 2026-08-20

---

## 1. Executive Summary

Laporan ini menilai skop, fasa, masa, dan kriteria penerimaan untuk **Final S0→S10 Forensic Audit** — audit bebas terakhir sebelum ChatGPT Governance Review, Bos Final Sign-off, dan Production Go-Live.

**Penemuan utama**: GLM 5.3 hanya pernah mengaudit **S8, S9, dan S10** secara forensik. **S0–S7 tidak pernah diaudit bebas pada kedalaman yang sama** — ia hanya "locked" melalui P9 Final QA (uji 966/966 ke atas artifak HTML frontend) dan self-audit Neo. Oleh itu, Final S0→S10 audit **BUKAN ulangan audit S10** — ia mesti meliputi seluruh sistem dari migrasi 0000 hingga 0028, dari 14 modul backend hingga 17 halaman frontend, dari 294 RLS policies hingga setiap perniagaan logik.

**Cadangan**: **9 fasa** (0–8), dengan 3 boleh dijalankan secara selari, anggaran **18–28 jam** (recommended 22 jam).

---

## 2. Current State

| Item | Nilai |
|---|---|
| HEAD | `5eb40fd` — GLM 🟢 APPROVE |
| Branch | `main`, ahead 3 (unpushed) |
| Working tree | Bersih |
| Migrations | 28 (0000→0028, skip 0001) |
| Tables | 70 (semua RLS-enabled) |
| Policies | 294 |
| Backend source | 184 fail, ~17,880 baris |
| Frontend source | 84 fail, ~8,706 baris |
| Tests | 85 fail integration + 29 unit + 4 contract/architecture + 2 E2E = **565 tests** |
| Locked baselines | S8: `c0ac25c` · S9: `a59cff9` + lock `7cca0b3` |

---

## 3. What Has Already Been Proven (existing evidence)

### 🟢 Boleh dijadikan bukti sedia ada (dengan spot-check)

| Bukti | Sumber | Kedalaman |
|---|---|---|
| S8/S9 immutability (MD5 0020–0024 byte-identik vs `7cca0b3`) | GLM S10 re-audit ×2 | Tinggi — boleh dijadikan bukti dengan spot-check 1× |
| Clean replay 0000→0028 (CLEAN, 294 policies, 70 tables) | GLM S10 re-audit ×2 | Tinggi — boleh dijadikan bukti |
| Drift sifar (definisi md5 identik dev=replay) | GLM S10 re-audit | Tinggi |
| D-01 developer staff deny (INSERT/UPDATE/DELETE/SELECT DENIED) | GLM S10 re-audit ×2 | Tinggi — boleh dijadikan bukti dengan spot-check |
| Registration DB-layer (valid→Pending+Argon2id+token NULL; reuse/invalid/expired REJECTED) | GLM S10 re-audit ×2 | Tinggi |
| Refresh token matrix (own-only, cross-user=0, INSERT DENIED, developer=0) | GLM S10 re-audit ×2 | Tinggi |
| Rate limiting live (login 5/min→429, register 3/min, refresh 10/min) | GLM S10 re-audit ×2 | Tinggi |
| Trust proxy live (A–D, XFF spoof gagal bypass) | GLM S10 re-audit + F-03 spec | Tinggi |
| Suite 565/565 (×2 runs, 1 tinypool flake) | GLM S10 re-audit | Tinggi |
| Frontend lint (14 baseline), tsc (0 errors), build PASS | GLM S10 re-audit | Tinggi |
| Browser E2E 12/12 (individual) | GLM S10 re-audit | Sederhana — perlu ulang full-file |
| Backup/restore rehearsal (70 tables, 294 policies identik) | GLM S10 re-audit | Tinggi |
| Secrets scan (tiada committed secrets) | GLM S10 re-audit | Sederhana |
| Audit logging (0 rows leak password/argon2) | GLM S10 re-audit | Tinggi |
| Caddy/Docker/infra configuration | GLM S10 re-audit | Sederhana |

### 🟡 Perlu spot re-verification

| Item | Sebab |
|---|---|
| RBAC matrix (system-admin, cross-branch) | Diverifikasi pada `2940d76`; diff `5eb40fd` tak sentuh — spot-check cukup |
| IDOR/API bypass | Sama — spot-check 2–3 endpoint kritikal |
| SECURITY DEFINER (F-05) | Re-test CREATE privilege assumption |

### 🔴 Mesti diverifikasi semula secara independent (NEVER audited by GLM)

| Item | Sebab |
|---|---|
| **S0–S2 business logic** (schema foundation, RLS foundation, patient timeline, sequences, payors) | Tidak pernah diaudit forensik oleh GLM; hanya P9 QA frontend |
| **S3 clinical** (encounters, treatment plans, FDI, clinical status) | Sama |
| **S4 finance** (billing, commission, payment status layer, lab cases) | Sama |
| **S5 marketing+operations** (leads, campaigns, recall, tasks, incidents) | Sama |
| **S6 WhatsApp hub** (sessions, messaging, WAHA transport) | Sama |
| **S7 administration** (user lifecycle, settings, AI governance) | Sama |
| **S8 integration** (worker security, outbox, recovery scheduler) — walaupun GLM audit S8 RLS, business logic worker tidak diaudit penuh | Sama |
| **S9 reports** (KPI definitions, report audit, RecallReadPort) — walaupun GLM audit S9 RLS, business logic reports tidak diaudit penuh | Sama |
| **Cross-domain contract** (architecture.contract.ts vs actual behavior) | Tidak pernah diuji oleh GLM |
| **Performance/reliability** | Tidak pernah diuji |
| **Production deployment sequence** (actual deploy, DNS, HTTPS provisioning, smoke test) | Tidak pernah diuji |
| **Power BI integration** readiness | Hanya verified TE validation, bukan integration penuh |
| **Bukku sync** integration | Code readiness sahaja, bukan live |

---

## 4. What Must Be Re-verified

### Classification matrix

| Domain | Evidence source | Action |
|---|---|---|
| Repository/governance (S8/S9 lock, immutability) | GLM S10 ×2 | 🟢 Spot-check 1× |
| Migration replay + drift | GLM S10 ×2 | 🟢 Spot-check 1× |
| S10 security (D-01, registration, refresh, rate-limit, trust-proxy) | GLM S10 ×2 | 🟢 Spot-check 1× |
| S0–S7 RLS policies (per-table, per-role) | **NONE** | 🔴 Full independent probe |
| S0–S7 business logic (happy/negative paths) | Neo self-audit + tests | 🔴 Independent re-run |
| Cross-domain contract integrity | Architecture tests | 🟡 Spot re-verify |
| RBAC matrix (all 5 roles × all modules) | GLM S10 (S10 scope only) | 🔴 Full matrix for S0–S7 |
| IDOR/API bypass (all endpoints) | GLM S10 (limited) | 🔴 Full enumeration |
| Performance/reliability | NONE | 🔴 New domain |
| Production deployment readiness | Runbook docs | 🔴 Verify sequence |
| Power BI/Bukku/WAHA integration | Code exists | 🟡 Verify readiness |
| Frontend integration | GLM S10 (E2E 12/12) | 🟡 Spot + full-file E2E |
| Infrastructure (Docker/Caddy/secrets) | GLM S10 | 🟢 Spot-check |
| Backup/restore | GLM S10 rehearsal | 🟢 Spot-check |

---

## 5. Proposed Audit Domains (21 domains)

| # | Domain | Keterangan |
|---|---|---|
| A | Governance / repository integrity | Lock records, commit ancestry, immutability |
| B | Architecture | Contract compliance, module boundaries |
| C | Database / migrations | Replay, drift, schema, sequences, FK |
| D | RLS / multi-tenancy | Per-table per-role probe matrix (70 tables × 6 roles) |
| E | RBAC / authorization | Full role × endpoint matrix |
| F | Authentication / user lifecycle | Login, logout, refresh, pending, approval, deactivation |
| G | API security / IDOR | All sensitive endpoints, cross-org/branch/UUID |
| H | Frontend / backend integration | API contract, auth flow, routing, state |
| I | Browser E2E | All journeys, negative paths |
| J | Business logic | Patient, clinical, finance, marketing, operations, WhatsApp, admin |
| K | Audit logging | All security events, actor, no leakage |
| L | Observability / metrics | /metrics, health, alerts |
| M | Docker / infrastructure | Compose, network, ports, healthchecks |
| N | Caddy / HTTPS / network | TLS, headers, XFF, /metrics exposure |
| O | Secrets / configuration | Scan, .gitignore, env handling |
| P | Backup / restore | Schedule, rehearsal, retention |
| Q | RPO / RTO | Architecture vs declared targets |
| R | Power BI / integrations | Bukku, WAHA, webhooks, tenant isolation |
| S | Performance / reliability | Response times, concurrency, error handling |
| T | Regression S0→S10 | Full suite, S8/S9 immutability, no skip |
| U | Production deployment readiness | Deploy sequence, rollback, DNS, smoke test |

---

## 6. Proposed Audit Phases (9 phases)

### Phase 0 — Repository & Governance Baseline
- **Objektif**: Confirm `5eb40fd` as auditable checkpoint; verify S0→S10 lock chain
- **Scope**: Git history, lock records (S8 `c0ac25c`, S9 `7cca0b3`), journal kontiguiti, all sprint documentation
- **Tasks**: `git log --oneline --all`, verify each lock record exists, read all sprint docs (S0→S10), map sprint→migration→test
- **Evidence**: Lock chain intact, 28 migrations kontiguiti, documentation complete
- **Live tests**: None (static)
- **Dependencies**: None — first phase
- **Time**: min 30min · realistic 1h · worst 2h

### Phase 1 — S0–S3 Forensic (Foundation + Clinical)
- **Objektif**: Verify schema foundation, RLS foundation, patient timeline, clinical core
- **Scope**: Migrations 0000–0008, modules `patients`, `clinical`, `payors`, `dashboard`, RLS policies on foundation tables
- **Tasks**: Replay 0000→0008 fresh, probe RLS per-table (patients, encounters, treatment_plans, clinical_notes, payors), business logic (patient CRUD, appointment booking, clinical status transitions, FDI), IDOR on patient/encounter endpoints, audit logging for patient/clinical events
- **Evidence**: Replay clean, RLS matrix, business logic happy+negative paths, IDOR denied
- **Live tests**: DB RLS probes + HTTP API tests (patient create/read/update/delete, appointment book, clinical encounter)
- **Dependencies**: Phase 0
- **Time**: min 2h · realistic 3h · worst 5h

### Phase 2 — S4–S6 Forensic (Finance + Marketing + Operations + WhatsApp)
- **Objektif**: Verify finance billing, marketing campaigns, operations tasks, WhatsApp hub
- **Scope**: Migrations 0009–0013, modules `finance`, `marketing`, `operations`, `whatsapp`
- **Tasks**: RLS probes (invoices, payments, campaigns, tasks, incidents, whatsapp sessions), business logic (payment status layer PENDING/PAID/OVERDUE, commission, campaign lifecycle, recall, task idempotency, incident lifecycle, WhatsApp send cooldown 30–60s), IDOR on finance/marketing endpoints, cross-branch finance isolation, audit logging
- **Evidence**: RLS matrix, business logic, payment model v1.1 compliance, WhatsApp cooldown governance (N8-6)
- **Live tests**: DB RLS + HTTP API (invoice create, payment status, campaign create, task idempotency, WhatsApp session)
- **Dependencies**: Phase 0
- **Time**: min 2h · realistic 3h · worst 5h

### Phase 3 — S7 Forensic (Administration + Settings + AI Manager)
- **Objektif**: Verify user lifecycle management, settings, AI governance
- **Scope**: Migrations 0014–0016, modules `administration`, `settings`, `ai-manager`
- **Tasks**: RLS probes (staff management, role assignments, settings, AI prompts), business logic (last-HQ guard, role versioning, settings CRUD, AI prompt governance), IDOR on admin endpoints, audit logging for role changes
- **Evidence**: RLS matrix, last-HQ guard, role versioning, settings isolation
- **Live tests**: DB RLS + HTTP API (staff list, role assign, settings read/write)
- **Dependencies**: Phase 0
- **Time**: min 1.5h · realistic 2.5h · worst 4h

### Phase 4 — S8–S9 Forensic (Integration + Reports — re-verify locked baselines)
- **Objektif**: Re-verify locked S8/S9 at forensic depth (RLS + business logic, bukan RLS sahaja)
- **Scope**: Migrations 0017–0024, modules `system-admin`, `reports`, worker security, outbox, recovery scheduler, KPI definitions, report audit
- **Tasks**: MD5 immutability (already proven — spot-check), RLS probes (worker exclusion policies, kpi_definitions, report_audit), business logic (worker org isolation, outbox processing, recovery scheduler, KPI calculation, RecallReadPort), worker cross-org DENY (S8 spec), /metrics + Prometheus + alert rules
- **Evidence**: S8/S9 immutable, worker isolation, KPI correctness, metrics verified
- **Live tests**: DB RLS (worker probes) + HTTP API (system-admin, reports, /metrics)
- **Dependencies**: Phase 0
- **Time**: min 2h · realistic 3h · worst 4h

### Phase 5 — S10 Forensic (Auth + Security + Production Readiness — re-verify GLM)
- **Objektif**: Re-verify GLM 🟢 approval at spot-check depth
- **Scope**: Migrations 0025–0028, auth module, rate limiting, trust proxy, D-01, registration, refresh tokens
- **Tasks**: Spot-check D-01 deny matrix (3 vectors), spot-check registration (valid+reuse), spot-check refresh (own+cross), spot-check rate limit (1 route), spot-check trust proxy (1 case), verify F-01 fixture self-contained, verify F-03 config
- **Evidence**: GLM claims re-confirmed at spot depth
- **Live tests**: DB RLS (3 D-01 vectors) + HTTP (login, register, refresh, 429)
- **Dependencies**: Phase 0
- **Time**: min 1h · realistic 1.5h · worst 2h

### Phase 6 — Cross-Sprint Security & Integration (Horizontal)
- **Objektif**: Full RBAC matrix, full IDOR enumeration, cross-domain contract, multi-tenant isolation across ALL domains
- **Scope**: All modules, all roles (hq, branch_manager, branch_admin, doctor, developer, system_worker), architecture.contract.ts
- **Tasks**: Build full RBAC matrix (6 roles × ~50 endpoints), IDOR test every sensitive endpoint (own/other-branch/other-org/manipulated-UUID), cross-domain contract verification (DOMAIN_REGISTRY=13, ROLE_DOMAIN_MATRIX, DATA_OWNERSHIP, CROSS_DOMAIN_EVENTS), SQL injection spots, CORS verification, JWT manipulation, session lifecycle
- **Evidence**: Full RBAC matrix PASS, IDOR all denied, contract compliance
- **Live tests**: HTTP API (role matrix × endpoints, IDOR attempts)
- **Dependencies**: Phases 1–5 (need all modules verified first)
- **Time**: min 2h · realistic 3h · worst 5h

### Phase 7 — Infrastructure & Production Deployment Readiness
- **Objektif**: Verify Docker, Caddy, HTTPS, secrets, backup, restore, metrics, deployment sequence, rollback
- **Scope**: Dockerfile, compose (dev+prod), Caddyfile, backup scripts, deployment runbook, staging.env
- **Tasks**: Docker config review (ports, network, healthchecks, restart, non-root), Caddy review (TLS, headers, XFF, /metrics), secrets deep scan (repo + config), backup/restore rehearsal (pg_dump→restore→verify), deployment sequence review (runbook steps), rollback procedure, RPO/RTO assessment, Power BI/Bukku/WAHA readiness assessment, performance spot-check (response time on key endpoints)
- **Evidence**: Infra config PASS, secrets clean, backup/restore verified, deployment sequence documented
- **Live tests**: Docker inspect, Caddy headers, backup/restore rehearsal, HTTP response time
- **Dependencies**: Phase 0 (can start after Phase 0, parallel with 1–5)
- **Time**: min 1.5h · realistic 2.5h · worst 4h

### Phase 8 — Full Regression, E2E & Findings Reconciliation
- **Objektif**: Full suite reproduction, browser E2E, S8/S9 regression, findings consolidation, final verdict
- **Scope**: Full test suite (565), E2E (journey-a + journeys-b-h), S8/S9 spec regression
- **Tasks**: Run full suite ×2, run E2E (individual + full-file), verify S8/S9 immutability final, consolidate all findings from Phases 1–7, classify severity, write final report
- **Evidence**: Suite 565/565, E2E 12/12, S8/S9 immutable, findings register complete
- **Live tests**: Full suite + E2E
- **Dependencies**: ALL previous phases (must consolidate findings)
- **Time**: min 2h · realistic 3h · worst 4h

---

## 7. Parallelization Plan

### Can run in parallel (after Phase 0):

```
Phase 0 (baseline)
    │
    ├── Phase 1 (S0–S3)          ┐
    ├── Phase 2 (S4–S6)          │  3 parallel streams
    └── Phase 3 (S7)             ┘
         │
         Phase 4 (S8–S9)  ←── starts after 1–3 (needs all modules verified for cross-ref)
         │
         Phase 5 (S10 spot-check)  ←── can overlap with Phase 4
         │
         Phase 7 (Infra)  ←── can start after Phase 0, parallel with 1–5
         │
         Phase 6 (Cross-sprint)  ←── MUST be after 1–5 (needs all domains)
         │
         Phase 8 (Regression + reconciliation)  ←── MUST be last
```

### Must be sequential:
- Phase 0 → all others (need baseline)
- Phases 1+2+3 → Phase 6 (cross-sprint needs all domains)
- All phases → Phase 8 (consolidation)

### Max parallelism: 3 streams (Phases 1+2+3 or 4+5+7)

---

## 8. Risk Areas

| Risk | Impact | Mitigation |
|---|---|---|
| S0–S7 RLS policies never independently probed | Tinggi — unknown gaps in multi-tenant isolation | Full probe matrix 70 tables × 6 roles |
| Business logic S0–S7 never forensically audited | Tinggi — unknown transaction/idempotency defects | Happy + negative paths per module |
| Cross-domain contract never verified vs actual behavior | Sederhana — contract drift possible | architecture.contract.ts vs runtime |
| Performance never tested | Sederhana — unknown response times | Spot-check key endpoints |
| Production deployment sequence untested | Tinggi — first deploy may fail | Dry-run deploy sequence |
| Power BI/Bukku/WAHA integration only code-ready | Rendah — not launch-critical if deferred | Verify code readiness + document gap |
| Frontend E2E full-file trips rate limit | Rendah — test-infra, not product | storageState or sequential E2E |
| F-02 doctor→HQ DB-layer gap (legacy S8) | Sederhana — defense-in-depth gap, API halang | Acknowledge as S11 backlog |
| tinypool worker flake on Windows | Rendah — infra, not product | Rerun; classify as flake |

---

## 9. Estimated Total Duration

| Plan | Duration | Assumptions |
|---|---:|---|
| **Fastest realistic** | **14 hours** | 3 parallel streams, no findings, no reruns, spot-check S10 |
| **Recommended** | **22 hours** | 3 parallel streams, moderate findings, 1–2 reruns, full S0–S7 probes |
| **Conservative** | **30 hours** | Sequential fallback, significant findings, multiple reruns, deploy rehearsal |

### Breakdown (recommended):

| Phase | Time | Parallel? |
|---|---|---|
| 0 — Baseline | 1h | No |
| 1 — S0–S3 | 3h | Stream A |
| 2 — S4–S6 | 3h | Stream B |
| 3 — S7 | 2.5h | Stream C |
| 4 — S8–S9 | 3h | After 1–3 |
| 5 — S10 spot | 1.5h | Overlap with 4 |
| 6 — Cross-sprint | 3h | After 1–5 |
| 7 — Infra | 2.5h | Parallel with 1–5 |
| 8 — Regression + reconciliation | 3h | Last |
| **Total (wall-clock)** | **~22h** | With parallelism |

*Note: jika 3 subagent selari digunakan (delegate_task), masa wall-clock boleh turun ke ~14h. Jika sequential, ~28h.*

---

## 10. Final Acceptance Criteria

### 🟢 S0→S10 FINAL FORENSIC AUDIT PASS

Semua berikut mesti dipenuhi:

1. **Tiada CRITICAL** — tiada privilege escalation, data breach, authentication bypass, RLS bypass
2. **Tiada HIGH** — tiada privilege issue, data integrity issue, security control bypass
3. **Semua kawalan keselamatan wajib diverifikasi** — RLS (70 tables × 6 roles), RBAC (full matrix), IDOR (all endpoints), authentication lifecycle, rate limiting, trust proxy
4. **Tiada drift migration tidak dapat dijelaskan** — dev = replay pada peringkat definisi
5. **Tiada kegagalan test yang tidak dapat dijelaskan** — suite 565/565 atau kegagalan diklasifikasi sebagai infra flake
6. **Tiada test production-critical yang di-skip** — semua skip mesti ada justifikasi
7. **S8/S9 immutability** — 0020–0024 byte-identik vs `7cca0b3`
8. **S10 remediation integrity** — D-01 closed, F-01/F-03 closed, drift sifar
9. **Frontend/backend integration** — API contract, auth flow, routing verified
10. **Browser E2E** — all journeys PASS (happy + negative)
11. **Infrastructure** — Docker/Caddy/HTTPS/secrets/backup/restore verified
12. **Backup/restore** — real rehearsal PASS (schema + data identik)
13. **Observability** — /metrics, health, audit logging verified
14. **Integrations** — Power BI/Bukku/WAHA readiness assessed (code readiness vs deployment readiness dibezakan)
15. **Production deployment readiness** — deploy sequence documented, rollback procedure exists, smoke test defined
16. **S0–S7 business logic** — happy + negative paths per module PASS
17. **Cross-domain contract** — architecture.contract.ts vs actual behavior compliant
18. **Performance** — response times acceptable on key endpoints
19. **Audit cleanup** — all forensic DBs dropped, no probe residue, working tree clean

### 🟡 CONDITIONAL
- MEDIUM issue memerlukan keputusan governance
- Evidence tidak lengkap untuk domain minor

### 🔴 REJECT
- Sebarang CRITICAL/HIGH
- RLS bypass yang boleh dieksploitasi
- Authentication bypass
- Data isolation failure

---

## 11. Required Audit Artifacts

| Artifact | Description |
|---|---|
| `docs/S0-S10-FINAL-FORENSIC-AUDIT.md` | Final report (32 sections) |
| Forensic replay DB (disposable) | `medini_s010_audit` — dropped after audit |
| RLS probe matrix (70 tables × 6 roles) | Evidence table in report |
| RBAC endpoint matrix (6 roles × ~50 endpoints) | Evidence table in report |
| IDOR test results | Per-endpoint denial evidence |
| Business logic test results | Per-module happy+negative paths |
| Suite run logs (×2) | 565/565 reproduction |
| E2E run logs | journey-a + journeys-b-h |
| Backup/restore rehearsal log | pg_dump → restore → verify |
| Findings register | All findings with severity + location + evidence |
| Final verdict | 🟢 / 🟡 / 🔴 |

---

## 12. Recommended Execution Order

1. **Phase 0** — establish baseline (1h)
2. **Phases 1+2+3 in parallel** — S0–S3, S4–S6, S7 (3 streams, ~3h wall-clock)
3. **Phase 7 in parallel** — Infrastructure (overlaps with 1–5)
4. **Phase 4** — S8–S9 (after 1–3, ~3h)
5. **Phase 5** — S10 spot-check (overlaps with 4, ~1.5h)
6. **Phase 6** — Cross-sprint security (after 1–5, ~3h)
7. **Phase 8** — Full regression + reconciliation (last, ~3h)

**Total wall-clock with parallelism: ~14–16h**
**Total sequential: ~22h**

---

## 13. Governance Gate Sequence

```
GLM 5.3 S10 Audit Approval (✅ DONE — 5eb40fd)
    │
    ↓
ChatGPT S10 Governance Review (NEXT — not yet started)
    │
    ↓
Final S0→S10 Forensic Audit (THIS PLAN — not yet started)
    │
    ↓
Bos Final Sign-off
    │
    ↓
Official GitHub Push / Lock
    │
    ↓
Production Deployment
    │
    ↓
Post-Deployment Verification
```

**Perbezaan setiap gate:**

| Gate | Who | What | Output |
|---|---|---|---|
| GLM S10 Audit | GLM 5.3 | S10 checkpoint security + remediation verification | 🟢 APPROVE for ChatGPT Review |
| ChatGPT Governance Review | ChatGPT | Architecture + governance + contract review | Pass/Conditional/Reject |
| Final S0→S10 Forensic Audit | GLM 5.3 (this plan) | Full system S0→S10 — all domains, all migrations, all business logic | 🟢/🟡/🔴 for Bos sign-off |
| Bos Final Sign-off | Bos | Business approval | Go/No-Go |
| Production Deployment | Neo/Ops | Deploy sequence | Live system |
| Post-Deployment Verification | GLM/Ops | Smoke test + monitoring | Production confirmed |

**Gate tidak boleh dilangkau. Setiap gate mesti lulus sebelum seterusnya.**

---

## 14. Final Recommendation

### Cadangan struktur: **9 fasa (0–8)**

**Bukan 4, 5, 6, 7, atau 8 fasa — tepat 9 fasa.**

**Sebab:**

1. **S0–S7 tidak pernah diaudit forensik oleh GLM** — ini bukan ulangan S10. System ada 28 migrations, 70 tables, 294 policies, 14 modul, 17 halaman frontend. Skopnya terlalu besar untuk kurang dari 9 fasa.

2. **Pemisahan sprint-to-fasa mengikut dependency sebenar** — S0–S3 (foundation+clinical), S4–S6 (finance+marketing+ops+WhatsApp), S7 (admin+settings+AI), S8–S9 (locked re-verify), S10 (spot-check). Setiap kumpulan mempunyai migration + module + business logic yang berasingan.

3. **Cross-sprint security mesti fasa berasingan (Phase 6)** — RBAC matrix penuh, IDOR enumeration, cross-domain contract — ini melipat semua domain dan mesti selepas semua fasa domain selesai.

4. **Infrastructure mesti fasa berasingan (Phase 7)** — Docker/Caddy/secrets/backup/deploy — domain berbeza, boleh parallel dengan fasa domain.

5. **Regression + reconciliation mesti fasa terakhir (Phase 8)** — full suite, E2E, S8/S9 immutability, findings consolidation — mesti selepas semua fasa lain.

6. **3 fasa boleh parallel** — Phase 1+2+3 (S0–S3, S4–S6, S7) — menjimatkan masa wall-clock daripada ~28h ke ~16h.

7. **Fasa S10 (Phase 5) ringan** — spot-check sahaja kerana GLM sudah audit penuh dua kali. Ini menghormati evidence hierarchy tanpa mengkompromi independence.

8. **Total realistic: 22 jam** (atau 14–16h dengan 3 parallel subagent streams) — munasabah untuk sistem 26,500+ baris kod, 565 tests, 70 tables.

---

### Jawapan kepada soalan utama:

> **Jika kita lancarkan Final S0→S10 Forensic Audit yang benar-benar komprehensif, apa yang mesti diaudit, berapa fasa, apa boleh parallel, berapa lama, dan apa evidence diperlukan untuk declare seluruh sistem S0→S10 ready untuk final sign-off dan deployment?**

**Jawapan**:
- **Apa mesti diaudit**: 21 domain (A–U), 28 migrasi, 70 tables × 6 roles RLS matrix, ~50 endpoints × 6 roles RBAC matrix, 14 modul business logic (happy+negative), full IDOR enumeration, cross-domain contract, infrastructure, backup/restore, deployment readiness
- **Berapa fasa**: 9 (Phase 0–8)
- **Apa boleh parallel**: Phase 1+2+3 (3 streams), Phase 7 (infra), Phase 5 (S10 spot) — max 3 concurrent
- **Berapa lama**: Recommended 22h (fastest 14h with parallelism, conservative 30h)
- **Evidence diperlukan**: Forensic replay DB, RLS probe matrix, RBAC endpoint matrix, IDOR results, business logic results, suite 565/565 ×2, E2E 12/12, backup rehearsal, findings register, final verdict

---

*PLANNING COMPLETE. No audit executed. `5eb40fd` preserved exactly as-is. HARD STOP.*
