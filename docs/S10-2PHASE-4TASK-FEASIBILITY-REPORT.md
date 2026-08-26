# S10 — 2-PHASE / 4-TASK FEASIBILITY REPORT

**Sprint:** 10 — Production Readiness & Go-Live
**Governance structure:** 2 Phases (BUILD → VALIDATE & GO-LIVE), 4 Tasks (T1–T4)
**Date:** 19 August 2026 · **Author:** Neo (Kimi K3)
**Type:** READ-ONLY feasibility assessment — **NO implementation performed**
**Baseline:** S8 `c0ac25c` · S9 `a59cff9` + lock `7cca0b3` (both LOCKED, 475/475 green)
**Source of truth:** live repository inspection, `docs/S10-DISCOVERY-ARCHITECTURE-REPORT.md`

---

## Executive Verdict

The 2-phase/4-task structure is **feasible and correctly scoped** — it correctly front-loads the single dominant risk (T1: there is no production frontend connected to the locked backend) and correctly sequences validation before go-live.

**Feasibility headline:** T1 is **large but tractable** because the backend REST API surface is **broad and nearly complete** for the required scope — but it has **specific, enumerable contract gaps** (auth refresh/logout, invoices/payments, patient update, appointment list) that must be closed before or during T1. T2/T3/T4 are **mostly greenfield build** (infra, backup, monitoring) rather than modification of locked code, so S8/S9 immutability is preserved by construction.

---

# A. T1 — PRODUCTION FRONTEND INTEGRATION

## A.1 Which frontend should become the production frontend?

**Recommendation: build a NEW thin production SPA, reusing the `app/` prototype's UI component library and page layouts, but with a brand-new data layer targeting `/api/v1`.**

| Option | Verdict | Reason |
|---|---|---|
| **Reuse `app/` as-is** | ❌ Reject | Its backend is tRPC+Hono+SQLite with its own auth/RBAC/seed. The tRPC client is bound to the prototype's `AppRouter` type. Ripping out the data layer means rewriting every page's data calls anyway — no savings. |
| **Adapt `CURRENT-MEDINI-REVIEW.html`** | ❌ Reject | Single-file 1MB prototype; calls Bukku direct from browser (key in localStorage); no module system; not maintainable as a production client. It remains the LOCKED UI-behavior reference, not the codebase. |
| **New thin SPA + reuse `app/` UI kit** | ✅ **Recommended** | `app/src/components/ui/` (40+ shadcn components) + page layouts + `lib/format.ts` are protocol-agnostic and reusable. Only the data/auth layer is new. Keeps S8/S9 backend untouched. |

## A.2 What can be reused

- ✅ **UI component library** (`app/src/components/ui/*`, `shared.tsx`, layout) — pure presentational, no data coupling.
- ✅ **Page structure / routing map** (`App.tsx` routes) — mirrors the locked IA.
- ✅ **Formatting helpers** (`lib/format.ts` — `rm`, `rmShort`), chart configs.
- ✅ **The locked HTML** as the *behavioral spec* (966 assertions) to validate the new frontend against — NOT as code.

## A.3 What must change

- 🔁 **Entire data layer:** replace tRPC client (`providers/trpc.tsx`) with a REST `/api/v1` client (react-query is already present and reusable).
- 🔁 **Auth:** replace scrypt/HMAC/localStorage-session with the backend's **JWT access + refresh** flow.
- 🔁 **ID types:** prototype uses SQLite integer IDs; backend uses **UUIDs** (`orgId/branchId/staffId`). Every reference changes.
- 🔁 **RBAC surfacing:** mirror the locked `ROLE_DOMAIN_MATRIX` (incl. doctor `reports: NONE`) for UI gating only — backend stays authoritative.

## A.4 What must be discarded

- ❌ `app/api/**` (the whole Hono/tRPC/SQLite prototype backend), `app/data/medini.db`, `app/api/ensureDb.ts` self-healing seed.
- ❌ Browser-direct Bukku calls + `localStorage('bukkuCreds')` in the locked HTML.
- ❌ `localStorage medini_token` HMAC session scheme.

## A.5 Backend API already available (REST `/api/v1`)

Auth (`login`, `me`, `can-finance`) · Dashboard (`context`) · Patients (create/list/detail/timeline/relationships) · Appointments (book/queue/detail/status/reschedule) · Clinical (treatments, prescriptions, adverse-events, referrals) · Finance (sales, revenue, expenses, recurring, alerts, radar, treatment-costs, top-treatments, lab-payables, commissions + external-invoices/sync/reconciliation) · Marketing (leads, campaigns, recall, follow-ups) · Operations (doctor-status, checklists, tasks, lab-cases, incidents) · WhatsApp (channels, conversations, messages, handoff, AI queue, templates, safety) · AI-Manager (agents, guardrails, approval-rules, policy, audit) · Administration (org, branches, staff lifecycle, roles) · Settings (definitions, values, secrets) · **Reports (all 6 S9 endpoints)**.

**Coverage for T1 minimum scope (Login/Dashboard/Patients/Appointments/Clinical/Finance/Reports/Profile): ~85% present.**

## A.6 Backend API MISSING / contract gaps (must close before/during T1)

| Gap | Needed by | Severity | Notes |
|---|---|---|---|
| `POST /auth/refresh` | session continuity | 🔴 High | `.env.example` defines `JWT_REFRESH_TTL` but **no refresh endpoint exists** in `auth.controller.ts` (only login/me/can-finance) |
| `POST /auth/logout` | logout | 🟡 Med | No logout endpoint; token invalidation strategy undefined |
| `GET /appointments` (list w/ filters) | Appointments page | 🔴 High | Only `queue`/`:id` exist; no general list endpoint |
| `PATCH /patients/:id` (update) | Patient edit | 🔴 High | Only create/list/detail/timeline/relationships |
| Invoice / payment endpoints | Finance page | 🟡 Med | Backend is deliberately status-layer only (`no invoice issuing`); frontend Finance page expects `invoices/recordPayment` — **contract mismatch to reconcile against the "no payment gateway" ADR-004** |
| `GET /meta/*` (branches/treatments/doctors lookup) | dropdowns | 🟡 Med | prototype `meta` router has these; backend spreads them across admin/clinical |
| `PATCH /auth/me` / change-password | Profile | 🟢 Low | No profile-update endpoint |

> **Governance note:** A.6 items are *additive backend endpoints* (new routes on existing locked modules), NOT modifications to S8/S9 logic. Each needs governance sign-off as "missing contract blocking production" per the S10 principle.

## A.7 Auth compatibility

🔴 **Incompatible today.** Prototype = scrypt+HMAC cookie+localStorage. Backend = Argon2id+JWT bearer. New frontend must implement: login → store access+refresh → attach `Authorization: Bearer` → on 401 refresh → on refresh-fail redirect to login → logout. **Backend refresh/logout endpoints are prerequisites (A.6).**

## A.8 RBAC/RLS compatibility

✅ **Backend is ready and authoritative** (matrix + guards + RLS, 475 tests). ⚠️ **Frontend must be brought into parity** — the prototype's `permissionMatrix` diverges (e.g. shows Reports to roles the backend blocks). UI gating is cosmetic; enforcement stays server-side. No backend change needed.

## A.9 Module-by-module integration status (T1 scope)

| Module | Backend API | Frontend page | Integration status |
|---|---|---|---|
| Login | 🟢 login/me (refresh/logout missing) | 🟢 Login.tsx (111 ln) | 🔴 NOT CONNECTED |
| Dashboard | 🟢 `context` | 🟢 Dashboard.tsx (840 ln) | 🔴 NOT CONNECTED |
| Patients | 🟢 (update missing) | 🟢 Patients/Patient360 | 🔴 NOT CONNECTED |
| Appointments | 🟡 (list missing) | 🟢 Appointments.tsx (337 ln) | 🔴 NOT CONNECTED |
| Clinical | 🟢 | 🟢 Clinical.tsx (255 ln) | 🔴 NOT CONNECTED |
| Finance | 🟡 (invoice/payment mismatch) | 🟢 Finance.tsx (449 ln) | 🔴 NOT CONNECTED |
| Reports | 🟢 all 6 | 🟢 Reports.tsx (205 ln) | 🔴 NOT CONNECTED |
| Profile | 🔴 missing | 🟡 minimal | 🔴 NOT CONNECTED |

## A.10 Major dependencies (T1)

1. Backend A.6 endpoints (refresh/logout/list/update) — **blocks frontend auth + pages**.
2. Final frontend-stack decision (A.1) — **blocks everything**.
3. CORS: backend `enableCors({origin:false})` currently denies all cross-origin — must allow the frontend origin (config change, not locked-code change).
4. Locked HTML as behavioral reference for parity tests.

## A.11 Major risks (T1)

- **R-T1-1 (High):** contract drift between new frontend and locked matrix — mitigated by deriving UI gating from `ROLE_DOMAIN_MATRIX` + parity tests.
- **R-T1-2 (High):** A.6 backend additions, if done carelessly, could touch locked modules — must be additive-only with governance approval per endpoint.
- **R-T1-3 (Medium):** 966-assertion parity — the locked HTML may encode behaviors the REST backend doesn't reproduce exactly; requires a parity test suite.

---

# B. T2 — PRODUCTION FOUNDATION

## B.1 Infrastructure that EXISTS
- Docker + Node 20 on Fariq VPS ✅ · dev `docker-compose.yml` (backend+PG16+Redis) ✅ · dev Dockerfiles ✅ · CI (GitHub Actions: lint/typecheck/build/migrate/seed/test) ✅ · nginx on VPS (serving legacy app).

## B.2 Infrastructure MISSING
🔴 Production compose/overlay · production hardened Dockerfile (multi-stage, non-root) · TLS/HTTPS termination · domain + DNS · firewall rules · secrets management · log shipping · health-gated deploy script · rollback mechanism · **legacy coexistence/cutover plan** (existing `medini-backend :5000` + `sites-enabled/medini`).

## B.3 Production secret situation
🔴 **Two live risks on disk today:** `app/.env` (Alibaba privatelink DB cred) + Bukku key (R1, exposed in chat 13 Aug; also browser-side in locked HTML). Backend envs are properly externalized ✅. **Action: rotate both before any prod push; move to a secrets store.**

## B.4 Database readiness
✅ Migrations 0000→0024 replay-clean; RLS hardened; owner/runtime role separation. 🔴 **Production migration NEVER run** — needs rehearsal against prod-shaped PG16 + documented rollback (forward-only migrations + PITR restore).

## B.5 Redis / workers
✅ BullMQ + 4 workers + RecoveryScheduler (S8 locked). 🔴 Not yet deployed to prod; needs prod Redis + worker process management.

## B.6 Reverse proxy / HTTPS / domain
🔴 Not built. nginx exists on VPS but configured for legacy. Needs new server block + Let's Encrypt + DNS.

## B.7 Backup status
🔴 **NONE.** No pg_dump scripts, cron, off-site copy, encryption, or PITR config in repo.

## B.8 Restore status
🔴 **NEVER performed.** Rule 6 unmet — no backup exists to restore.

## B.9 RPO / RTO
⚫ **Undefined.** Governance must set targets (recommendation: RPO ≤ 24h via nightly off-box + PITR for finer; RTO ≤ 4h single-VPS manual restore).

## B.10 Required work (T2)
1. Prod Dockerfile + compose (backend, PG16, Redis, WAHA, nginx). 2. TLS/DNS/firewall. 3. Secrets store + rotation. 4. **Backup automation (nightly off-box + PITR) + rehearsed, timed restore with integrity check.** 5. Deploy + rollback scripts. 6. Legacy coexistence plan.

## B.11 Dependencies
- On T1: none blocking (infra can be built in parallel).
- To T3/T4: **backup+restore must be proven before T4 go-live** (hard gate).

## B.12 Risks (T2)
- **R-T2-1 (High):** shared-VPS collision with legacy app (ports/nginx/resources) — needs the coexistence decision.
- **R-T2-2 (High):** restore rehearsal on the same box risks the only copy of prod data — rehearse against a scratch restore target first.
- **R-T2-3 (Medium):** single-VPS SPOF (accepted ADR-008) — mitigated only after backups exist.

---

# C. T3 — SECURITY + FULL E2E

Status per journey: **READY / PARTIAL / MISSING / UNKNOWN** (evidence-based).

| Journey | Backend | Frontend | E2E | Status |
|---|---|---|---|---|
| Login/logout/refresh | 🟢 login/me; 🔴 refresh/logout | 🔴 | 🔴 | **MISSING** (blocked on A.6) |
| RBAC/RLS (org/branch/role scope) | 🟢 475 tests | 🔴 | 🔴 | **PARTIAL** (backend proven; no full-stack) |
| Direct API access / IDOR / bypass | 🟢 guards+RLS | n/a | 🔴 | **PARTIAL** (backend only) |
| Patient: login→list→create→view | 🟢 (update missing) | 🔴 | 🔴 | **PARTIAL** |
| Appointment: book→assign→status | 🟢 | 🔴 | 🔴 | **PARTIAL** |
| Clinical: record→treatment→plan | 🟢 | 🔴 | 🔴 | **PARTIAL** |
| Finance: treatment→invoice→payment→revenue | 🟡 status-layer only | 🔴 | 🔴 | **PARTIAL** (ADR-004 contract reconcile) |
| Reports: all 6 S9 endpoints | 🟢 | 🔴 | 🔴 | **PARTIAL** (backend locked/green) |
| Multi-branch HQ/Manager/Doctor/Receptionist | 🟢 RLS probes | 🔴 | 🔴 | **PARTIAL** |
| Integrations (Bukku/WAHA) | 🟡 mocked adapters only | 🔴 | 🔴 | **PARTIAL** (real transport unverified) |
| Observability: health/logs/workers/metrics | 🟢 built | n/a | 🔴 | **PARTIAL** (no deployed stack) |
| `/metrics` public❌ / internal✅ | 🟡 @Public | n/a | 🔴 | **MISSING** (R-01 restriction) |
| Power BI (if launch scope) | 🟢 foundation | n/a | 🔴 | **PARTIAL** (validated, not live) |
| Payment/SaaS billing (if launch scope) | 🔴 does not exist | 🔴 | 🔴 | **UNKNOWN** (scope decision pending) |

**No journey is READY end-to-end today** because none has a connected frontend. All become testable once T1 lands.

---

# D. T4 — STAGING + GO-LIVE

| Area | Readiness | Gap |
|---|---|---|
| Staging readiness | 🔴 | No staging environment exists; needs T2 infra |
| Deployment readiness | 🔴 | No prod pipeline/health-gate/smoke tests |
| Migration readiness | 🟡 | Procedure documented; **never rehearsed on prod-shaped DB** |
| Rollback readiness | 🔴 | No app-image rollback or DB PITR-restore runbook |
| Monitoring readiness | 🟡 | Metrics built; **no Prometheus/Grafana/alert routing deployed** |
| Final audit requirements | 📋 | GLM 5.3 forensic audit → remediation → ChatGPT GO/NO-GO → Bos sign-off; all Phase-2 gates (backup/restore/migration/security/E2E/monitoring/rollback) must be ✅ |

---

# E. RECOMMENDED EXECUTION ORDER

```text
T0 (governance pre-work, tiny):  rotate Bukku key + app/.env cred ·
     decide frontend stack (A.1) · decide SaaS-billing scope · decide legacy coexistence
        ↓
T1 (Production Frontend)  ──parallel──▶  T2 (Production Foundation)
   • close A.6 backend gaps first           • infra + backup/restore rehearsal
   • then build/wire SPA                    • (independent of T1)
        ↓                                     ↓
        └──────────────┬──────────────────────┘
                       ▼
              T3 (Security + Full E2E)   ← needs T1 frontend + T2 monitoring/backup
                       ↓
              T4 (Staging + Go-Live)     ← needs T3 green + restore rehearsed
```

**Critical path:** T0 decisions → (A.6 backend gaps) → T1 frontend → T3 E2E → T4. T2 runs parallel to T1 but its **backup/restore rehearsal is a hard T4 gate** — start it early.

---

# F. OPEN GOVERNANCE DECISIONS (only what truly needs Governance)

1. **Frontend stack** — approve "new thin SPA reusing `app/` UI kit" (A.1).
2. **A.6 backend endpoint additions** — approve additive `refresh`/`logout`/`appointments-list`/`patients-update` (+ reconcile Finance invoice/payment against ADR-004) as "missing contracts blocking production."
3. **SaaS billing launch scope** — in or out? (Does not exist; do not invent.)
4. **Legacy `medini-backend :5000` coexistence vs cutover** on the Fariq VPS.
5. **Domain/DNS/TLS ownership** — hostname + who controls DNS.
6. **Power BI launch scope** — include live validation/publish in S10 or defer post-go-live?
7. **RPO/RTO targets** — approve proposed values (B.9).
8. **Alert routing** — who/what receives production alerts.

---

**Feasibility conclusion:** the 2-phase/4-task plan is **sound and achievable**. The dominant work is T1 (first-ever production frontend) plus T2 greenfield infra/backup — neither requires modifying locked S8/S9 code beyond the enumerable additive endpoint gaps in A.6.

**HARD STOP.** No implementation, no code/DB/infra changes, no commit/push/deploy. Awaiting ChatGPT Governance Review → FINAL APPROVED TASK BREAKDOWN + IMPLEMENTATION PROMPT.
