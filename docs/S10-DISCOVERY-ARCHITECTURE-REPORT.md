# S10 — DISCOVERY & ARCHITECTURE REPORT

**Sprint:** 10 — Full-Stack Integration, Production Readiness & Go-Live
**Phase:** 1 — Discovery & Architecture (READ-ONLY)
**Date:** 19 August 2026
**Author:** Neo (Kimi K3) — Lead Full-Stack Production Engineer
**Baseline:** S8 LOCKED `c0ac25c` · S9 LOCKED `a59cff9` + lock-record `7cca0b3`
**Repository:** `C:\Users\User\Desktop\Medini terbaru` (git root = workspace folder)

---

## 1. Executive Summary

**The single most important Phase 1 question — "Are frontend and backend actually connected?" — has a definitive, evidence-based answer:**

> # 🔴 NO. The production frontend and the production backend are NOT connected. They are two entirely separate applications.

This is not a matter of a missing proxy or a wrong URL. They are **architecturally incompatible**:

| Dimension | "Frontend" (`app/`) | "Backend" (`backend/`) |
|---|---|---|
| Stack | React 18 + Vite + Hono + tRPC + better-sqlite3 | NestJS 11 + Drizzle + PostgreSQL 16 + BullMQ/Redis |
| API protocol | tRPC RPC over `/api/trpc` (superjson) | REST over `/api/v1/*` (OpenAPI) |
| Database | SQLite file (`app/data/medini.db`) | PostgreSQL 16 (RLS-enforced, 69 tables, migrations 0000→0024) |
| Auth | scrypt + HMAC session cookie (self-rolled) | Argon2id + JWT/refresh (governance-approved) |
| RBAC | `permissionMatrix` in `app/api/auth.ts` (ad-hoc) | `ROLE_DOMAIN_MATRIX` in `architecture.contract.ts` (locked, contract-tested) |
| RLS | None (SQLite has no RLS) | Row-Level Security on 63 tables (11/11 probes green) |
| Workers/queues | None | Outbox + 4 workers (whatsapp/bukku/recall/recovery) |
| Observability | None | Prometheus `/metrics`, 6 alert rules |
| Tests | 1 file (`phase31.test.ts`) | 475/475 across unit/integration/contract/architecture |

**The `app/` directory is the ORIGINAL PROTOTYPE — the same artifact family as `CURRENT-MEDINI-REVIEW.html` (the MD5-locked 966-assertion UI).** It was never intended to be the production frontend. It is a self-contained demo with its own mock SQLite backend, hardcoded seed data, and direct browser-to-Bukku calls. It must NOT be deployed to production.

**The real production backend (`backend/`) exists, is S8+S9 locked, 475/475 green — but has NO production frontend wired to it.** The locked UI (`CURRENT-MEDINI-REVIEW.html`) is a single-file prototype that talks directly to Bukku from the browser (CORS-exposed, key-in-localStorage) and to a hardcoded `waha-server:3000`. It has zero calls to the NestJS REST API.

**Therefore the headline S10 gap is not "integration polish" — it is "build/wire the production frontend against the locked backend for the first time."** This is the largest single work-item in S10 and the primary go-live risk.

A second critical finding: **`app/.env` contains a live-looking cloud database credential** (Alibaba Cloud MySQL/TiDB privatelink endpoint with a real-looking password) sitting in the working tree. It is gitignored (not committed) but is a live secret on disk. This is a **BEFORE-PRODUCTION credential-rotation/removal item** (compounds Blueprint R1 — Bukku key already exposed in chat 13 Aug).

Everything else in this report follows from these two facts.

---

## 2. S10 Objective

Per the S10 master prompt:

> Prove that Medini CRM frontend + backend + database + integrations + infrastructure + security + monitoring + backup/restore + deployment + payment/billing can operate as one complete, safe production system for a real, paying customer.

Phase 1 narrows this to: *measure the exact distance between the S9-LOCKED system and that goal, with evidence, and produce a task breakdown.*

---

## 3. S8/S9 Locked Baseline

| | S8 | S9 |
|---|---|---|
| Commit | `c0ac25c762c686bb594498b3ec9754c03ea16161` | `a59cff99a381d91d6c9106b4d9e997de4589f056` |
| Lock record | `05-LOCK-RECORDS/SPRINT-8-LOCK.md` | `05-LOCK-RECORDS/SPRINT-9-LOCK.md` (`7cca0b3`) |
| Tests | 461/461 | 475/475 (×3 consecutive, 0 skipped) |
| Migrations | 0000→0023 replay-clean | 0000→0024 replay-clean (69 tables, 4 KPI seeds) |
| RLS probes | green | 11/11 |
| CI | GREEN | GREEN (15/15 steps) |
| Production deploy | NOT DONE | NOT DONE |
| Production migration | NOT RUN | NOT RUN |

**S9 deferred items carried into S10 (official):** `/metrics` network restriction · Power BI live DB validation/publish/RLS · Frontend integration · Infrastructure/deployment · Backup/restore rehearsal · Monitoring deployment · (optional) live-QueueEvents probe + booted-app `/metrics` scrape.

---

## 4. Current System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  DEVELOPMENT MACHINE (Windows)                                          │
│                                                                         │
│  ┌───────────────────────┐      ┌────────────────────────────────────┐  │
│  │ app/  (PROTOTYPE)     │      │ backend/  (PRODUCTION BACKEND)     │  │
│  │ React+Vite+Hono+tRPC  │      │ NestJS 11 modular monolith         │  │
│  │ SQLite  medini.db     │      │ 13 modules + reports + observ.     │  │
│  │ :3000 (vite dev)      │      │ :3000 (dev)                        │  │
│  └───────────────────────┘      │   ├─ PostgreSQL 16 (docker :5433)  │  │
│         ▲ NOT CONNECTED ▲       │   ├─ Redis 7 (BullMQ)              │  │
│         ║ no shared API ║       │   └─ Outbox + 4 workers            │  │
│  ┌───────────────────────┐      └────────────────────────────────────┘  │
│  │ CURRENT-MEDINI-       │              ▲                                │
│  │ REVIEW.html (locked)  │   NOT CONNECTED (no fetch to /api/v1)         │
│  │ single-file prototype │                                               │
│  │ → api.bukku.my DIRECT │                                               │
│  │ → waha-server:3000    │                                               │
│  └───────────────────────┘                                               │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  PRODUCTION (NOT YET DEPLOYED) — Fariq VPS 76.13.181.127                │
│  - Existing: legacy medini-backend :5000 (UNRELATED to this repo)       │
│  - nginx sites-enabled/medini  (DO NOT TOUCH)                           │
│  - Docker + Node 20 present                                             │
│  - NOTHING from S0–S9 deployed here yet                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key architectural truth:** there is exactly ONE production-grade backend and ZERO production-grade frontends connected to it.

---

## 5. Frontend Architecture

There are **three** frontend-ish artifacts. None is a production frontend wired to the backend.

### 5.1 `app/` — the full-stack prototype (React SPA)
- React 18, Vite 7, Tailwind 3 + shadcn/ui (40+ components), react-router, react-query.
- Routing (`src/App.tsx`): `/login /dashboard /patients /patients/:id /appointments /clinical /documents /finance /reports /marketing /operations /whatsapp /ai /administration /settings`.
- Data layer: **tRPC client → Hono server (`api/`) → better-sqlite3 (`data/medini.db`).** Token in `localStorage` (`medini_token`), branch in `medini_branch`.
- Auth (`api/auth.ts`): scrypt + HMAC-signed session, `permissionMatrix` role checks, `ensureDatabase()` self-healing bootstrap that migrates+seeds on login.
- **This is a complete, self-contained application with its OWN mock backend. It does not import or call anything from `backend/`.** It even has its own Dockerfile.

### 5.2 `CURRENT-MEDINI-REVIEW.html` — the MD5-locked UI prototype
- Single-file, 1 MB, Chart.js + Tailwind CDN. MD5 `84f3993af955af666d263f364cb37eb6` (verified unchanged today, both copies).
- The 966 locked UI assertions describe THIS artifact's behavior.
- **Network calls:** `fetch(bukkuApiUrl(...))` → `https://api.bukku.my` DIRECTLY from the browser with `Authorization: Bearer <apiKey>` read from `localStorage('bukkuCreds')`; WAHA pointed at `https://waha-server:3000` (placeholder hostname).
- **No calls to the NestJS backend whatsoever.**

### 5.3 `app/dist/public/` — built static bundle of (5.1)
- Pre-built `index-9b6seARH.js` etc. Same prototype, compiled.

**Conclusion:** the "frontend" the business has been reviewing/locking is a prototype. The production frontend for the locked backend **does not exist yet** in connected form.

---

## 6. Backend Architecture

`backend/` — production NestJS modular monolith (the real system of record):

- **13 domain modules:** patients, appointments, clinical, finance, marketing, operations, whatsapp, ai-manager, administration, settings, payors, dashboard, reports (+ shared).
- **Cross-cutting infrastructure:** `infrastructure/{database,health,observability,outbox,queue}`.
- **API:** REST `/api/v1/*`, URI-versioned, global `ValidationPipe` (whitelist+transform), Swagger at `/api/docs`, bearer auth pre-registered.
- **Security:** Argon2id + JWT/refresh; `ROLE_DOMAIN_MATRIX` (contract-tested); PermissionGuard (route) + service-level checks + **RLS on 63 tables** (org-isolation RESTRICTIVE + role permissives + worker least-privilege).
- **Async:** transactional outbox + BullMQ + 4 workers (whatsapp-send, bukku-sync, recall, recovery) with `system_worker` RLS identity; `RecoveryScheduler` (repeatable tick + setInterval fallback).
- **Observability:** `GET /metrics` (Prometheus, `@Public`), HTTP histogram/counter, worker counters via QueueEvents (zero S8 diff), outbox backlog gauge, `OBSERVABILITY.md` 6 alert rules.
- **Reports:** 6 GET endpoints `/api/v1/reports/*` + `kpi_definitions` registry + append-only `report_audit` (migration 0024).
- **Tests:** 475/475 (unit + integration + contract + architecture), RLS probes, replay-verify.

**This is production-quality and locked. It is also currently unreachable by any real user.**

---

## 7. Frontend ↔ Backend Integration Matrix

Legend: 🟢 connected · 🟡 partial · 🔴 not connected · ⚫ unknown

| Capability | Frontend (app/) route | Prototype backend (tRPC) | PRODUCTION backend (`/api/v1`) | Connected to PROD? | E2E vs PROD? | Gap |
|---|---|---|---|---|---|---|
| Login | `/login` | `auth.login` (scrypt) | `POST /auth/login` (Argon2id+JWT) | 🔴 | 🔴 | Different protocol, different crypto, different session model |
| Session/me | `_layout` | `auth.me` | `GET /auth/me` | 🔴 | 🔴 | No token interop |
| Logout | `_layout` | `auth.logout` | `POST /auth/logout` | 🔴 | 🔴 | — |
| Dashboard KPIs | `/dashboard` | `dashboard.*` (5 tRPC calls) | `GET /dashboard/*` | 🔴 | 🔴 | UI bound to tRPC shape |
| Patients list/search | `/patients` | `patients.*` (5) | `GET /patients` | 🔴 | 🔴 | Different DTO/pagination |
| Patient 360 | `/patients/:id` | `patients.*` (1) | `GET /patients/:id` | 🔴 | 🔴 | — |
| Patient create/update | `/patients` | tRPC mutation | `POST/PATCH /patients` | 🔴 | 🔴 | — |
| Appointments | `/appointments` | `appointments.*` (12) | `GET/POST/PATCH /appointments` | 🔴 | 🔴 | — |
| Clinical | `/clinical` | `clinical.*` (11) | `GET/POST /clinical/*` | 🔴 | 🔴 | — |
| Finance | `/finance` | `finance.*` (14) | `GET/POST /finance/*` | 🔴 | 🔴 | Bukku handled browser-side in prototype |
| Reports KPI strip | `/reports` | `reports.overview` (tRPC) | `GET /reports/kpis` | 🔴 | 🔴 | **Prototype computes its own; never calls S9 endpoints** |
| Revenue by branch | `/reports` | (inside `overview`) | `GET /reports/revenue-by-branch` | 🔴 | 🔴 | — |
| Treatment mix | `/reports` | (inside `overview`) | `GET /reports/treatment-mix` | 🔴 | 🔴 | — |
| Appointment trends | `/reports` | (inside `overview`) | `GET /reports/appointment-trends` | 🔴 | 🔴 | — |
| Doctor production | `/reports` | (inside `overview`) | `GET /reports/doctor-production` | 🔴 | 🔴 | — |
| KPI registry | — | — | `GET /reports/kpi-registry` | 🔴 | 🔴 | Not surfaced in prototype UI |
| Marketing | `/marketing` | `intelligence/ops` (3) | `GET /marketing/*` | 🔴 | 🔴 | — |
| Operations | `/operations` | `ops.*` (6) | `GET /operations/*` | 🔴 | 🔴 | — |
| WhatsApp hub | `/whatsapp` | `whatsapp.*` (7) | `GET/POST /whatsapp/*` | 🔴 | 🔴 | Prototype points at `waha-server:3000` direct |
| AI Manager | `/ai` | `ai.*` (9) | `GET/POST /ai-manager/*` | 🔴 | 🔴 | — |
| Administration | `/administration` | `*` (10) | `GET/POST /administration/*` | 🔴 | 🔴 | — |
| Settings | `/settings` | `meta.*` (3) | `GET/POST /settings/*` | 🔴 | 🔴 | — |

**Integration status: 0 of ~22 production-critical capabilities are connected to the production backend. Overall classification: 🔴 NOT CONNECTED.**

---

## 8. API Contract Compatibility

Because the two systems use **different protocols (tRPC vs REST) and different serializers (superjson vs JSON)**, there is no field-level compatibility to audit — the contracts are incompatible at the transport layer before any field comparison is possible.

Specific incompatibilities to resolve when building the real frontend:

- **IDs:** prototype uses SQLite integer IDs (`branchId: number`); production uses UUIDs (`orgId`, `branchId`, `staffId` are `uuid`). Every frontend reference must change type.
- **Auth header:** prototype sends `Authorization: *** <hmac-session>`; production expects JWT bearer with refresh flow.
- **Pagination:** production = `?page=&limit=` (zod coerced, max PAGE_MAX, offset); prototype = tRPC input objects.
- **Dates/tz:** production = ISO-8601 with explicit period pills (7D/30D/90D/12M); prototype passes `{branchId, days}`.
- **Errors:** production = RFC-shaped NestJS error + correlation ID; prototype = tRPC error envelope.
- **RBAC surface:** production doctor is `reports: NONE` (S9 Q1 amendment) — the prototype `/reports` page has no such gating.

---

## 9. Mock / Demo Data Audit

| Finding | Location | Severity |
|---|---|---|
| Entire `app/` backend is a mock (SQLite, seed data, self-healing `ensureDatabase`) | `app/api/**`, `app/data/medini.db` | 🔴 Critical (it IS the demo) |
| Live-looking cloud DB credential in working tree | `app/.env` (Alibaba privatelink MySQL) | 🔴 Critical (secret hygiene) |
| Bukku API key entered by user, stored in `localStorage`, sent `Authorization: Bearer` from browser | `CURRENT-MEDINI-REVIEW.html` (`bukkuCreds`) | 🔴 Critical (CORS + key exposure) |
| WAHA hardcoded to non-routable placeholder host | `CURRENT-MEDINI-REVIEW.html` (`waha-server:3000`) | 🟡 High |
| Demo seed users (`hq/manager/reception/doctor`, password `medini123`) | `backend/src/infrastructure/database/seed.ts` | 🟡 (DEV-only by design; must NOT seed in prod) |
| Reports "Export" button shows a toast but does nothing | `app/src/pages/Reports.tsx` | 🟢 cosmetic |

---

## 10. Authentication Architecture

**Production backend (`backend/`):** Argon2id password hashing, JWT access (TTL 900s) + refresh (TTL 604800s), `JWT_SECRET`/`JWT_REFRESH_SECRET` env-driven, `medini_app` runtime role (never table owner), production refuses dev default credentials. ✅ Sound.

**Prototype (`app/`):** scrypt + HMAC session cookie, token mirrored to `localStorage` for cross-site iframe previews, `ensureDatabase()` auto-seeds on login. ❌ Not production-grade (no refresh rotation, cookie flags unstated, self-healing seed is a dev convenience that must never ship).

**Gap:** the production auth is built and tested but has no real UI consuming it. The production UI auth flow (login page → JWT store → refresh → 401 redirect → logout) must be implemented against `/api/v1/auth/*`.

---

## 11. RBAC / RLS Full-Stack Matrix

Production backend is authoritative and locked:

| Role | Backend access (matrix + guards) | DB/RLS scope | Frontend (prototype) parity |
|---|---|---|---|
| HQ | Cross-branch where permitted | org-wide via `app.branch_ids` | ❌ prototype role model differs |
| Manager | Own branch only | `branch_id IN app_branch_ids()` | ❌ |
| Receptionist | Receptionist capabilities only | branch-scoped | ❌ |
| Doctor | Own/record-scoped; **reports: NONE (S9 Q1)** | doctor-scoped | ❌ (prototype shows reports) |

- Backend enforcement is **proven** (475 tests incl. RLS probes, cross-branch leak fail-closed, doctor 403).
- **Frontend RBAC is currently cosmetic-only and out of sync with the locked matrix.** The rule "frontend hiding a button is NOT security" holds — but the frontend doesn't even mirror the matrix yet.
- Horizontal privilege escalation / IDOR / direct-API-bypass: covered at backend by guards + RLS; **not yet exercisable end-to-end because no real frontend calls the API.**

---

## 12. Database Production Readiness

- Schema: PostgreSQL 16, 69 tables, migrations `0000→0024` sequential + locked, replay-clean on scratch (`scripts/replay-verify.sh`).
- RLS: ENABLE+FORCE on org-owned tables; org-isolation RESTRICTIVE (`app_org_id()` fail-closed); worker least-privilege policies; `branches`/`organizations` correctly excluded from org predicate.
- Connections: owner role (`medini`, migrations only) vs runtime role (`medini_app`, RLS-subject). Production refuses dev default creds.
- Indexes/constraints/FK: governance-audited through S8/S9.
- **Production migration procedure: documented pattern exists (manual-psql, idempotent files, CI replay loop). Production migration has NEVER been run.** Rehearsal against a production-shaped PG16 is a required S10 gate.
- Connection pooling / zero-downtime: not yet configured for prod (single-instance compose per ADR-008).

---

## 13. Backup / Restore Readiness

**Current state: 🔴 NOTHING EXISTS.**
- No `pg_dump` scripts, no cron, no off-box copy, no PITR configuration, no restore runbook found in the repo (`scripts/` has replay/RLS helpers only).
- Blueprint R9 mandates: nightly off-box backup + PITR + documented restore.
- **Rule 6 (backup must be restored) is unmet — there is no backup to restore.** This is a mandatory S10 build item: backup automation + a *rehearsed, timed* restore with integrity verification (RTO/RPO to be defined).

---

## 14. Infrastructure Architecture

**Current production infrastructure: ⚫ essentially undefined / not yet built for this system.**

- Fariq VPS `76.13.181.127`: has Docker + Node 20; runs a **legacy `medini-backend :5000`** (unrelated to this repo) behind `nginx sites-enabled/medini` (DO NOT TOUCH).
- Repo infra: `backend/docker-compose.yml` is explicitly **dev-only** ("Not production"); `backend/Dockerfile` is **dev-only** ("Production hardening is a later sprint"); `app/Dockerfile` builds the **prototype**.
- **Missing for production:** production compose (backend+PG16+Redis+WAHA+nginx), TLS/HTTPS termination, domain + DNS, firewall rules, secrets management, log shipping, health-check wiring, deployment scripts, rollback mechanism, and a decision on **legacy coexistence vs cutover** (port/resource/collision plan).

---

## 15. Observability Architecture

**Built (backend):** `/health/live`, `/health/ready`, `/metrics` (Prometheus), HTTP + worker + outbox metrics, structured pino logs with correlation IDs, 6 documented alert rules (A1–A6).
**Not done (S10):** Prometheus server, Grafana/Alertmanager, alert routing (who gets paged?), uptime monitoring, log aggregation, on-call/incident procedure.
**Failure semantics documented in code** (PG down → `/health/ready` fail; Redis down → degrade + recovery sweep; WAHA down → circuit + lock; worker stall → requeue/DLQ) but **no deployed alert stack to surface them.**

---

## 16. `/metrics` Production Security (R-01)

- Current: `@Public`, version-neutral, excluded from autolog. Exposes route names, queue names, service label, error rates — **no** PII/secrets/business values.
- Governance: **REMEDIATION REQUIRED BEFORE PRODUCTION.**
- **Decision needed (S10-T4):** restrict at nginx (allowlist monitoring network / deny public) — preferred; OR bind to a private interface; OR bearer-token protect the scrape. Recommended: **reverse-proxy ACL** (cleanest, zero app change, keeps `@Public` internally). Must be implemented + verified (public 403 / internal 200), not just documented.

---

## 17. Power BI Readiness

- Foundation locked: PBIP + TMDL star schema (4 dims, 4 facts), 9 DAX measures 1:1 with RPT_KPIS, `te validate` 0 errors, canonical-truth annotation.
- **Not done (S10):** Power BI Desktop install → point `PgServer/PgDatabase` params at **production** PG → refresh + row-count validation vs `SELECT count(*)` → publish to Service → on-prem data gateway (self-hosted PG) → RLS via `USERPRINCIPALNAME()` → staff→branch mapping → scheduled nightly refresh (off-peak).
- Dependency: needs a stable production DB connection + Bos's PBI licensing/workspace. Credentials never in repo (parameterized ✅).

---

## 18. Payment / Billing Readiness

**Two distinct "billing" concerns — do not conflate:**

1. **Clinic billing (in-scope product):** invoices, payment-status confirm, treatment costs, Bukku accounting sync. ✅ Built in backend (finance module) — but the *frontend* for it is the unconnected prototype, and Bukku is currently called **directly from the browser** (see §9). Real path must be: frontend → backend → Bukku adapter (S8, real but transport-unverified).
2. **SaaS subscription billing (Medini-the-product charging customers):** ❌ **DOES NOT EXIST.** No subscription/plan/entitlement/trial/webhook/renewal/cancellation model anywhere in backend or docs. Per the master prompt Rule — **do not invent a provider or pricing.** This is an **open governance question**: is SaaS billing part of launch scope? If yes, it is net-new Phase 2 scope (provider selection, entitlement model, webhook security, org entitlement enforcement). If no, launch gating is manual/out-of-band.

---

## 19. Tenant / Organization Isolation

- Single-tenant with `org_id` reserved (ADR-005), `MEDINI_ORG_ID` env for the recovery scheduler.
- Isolation enforced at three layers: API guards (server-derived scope), service checks, and RLS (org-isolation RESTRICTIVE on 59 org-owned tables).
- Workers use `system_worker` identity with explicit `runAsWorker({orgId, branchIds, correlationId})` — no human impersonation, no owner bypass, scoped to a specific event (crash recovery re-enqueues one org+branch).
- **Proven at backend. Untestable full-stack until a real frontend exists.**

---

## 20. Security Hardening (Discovery)

| Area | State | Gap |
|---|---|---|
| Secrets | Backend env-externalized ✅; **prototype Bukku key in localStorage 🔴; `app/.env` live-looking cred 🔴** | Rotate/remove; never browser-side |
| Transport | CORS `origin:false` (deny by default) ✅ | TLS/HSTS at nginx — not built |
| Headers/rate-limit | Not configured (helmet/throttler absent) | Add at proxy or app |
| AuthZ | Guards + RLS ✅ | Full-stack E2E pending |
| SQLi | Drizzle parameterized ✅ | — |
| Webhook verify | Bukku polling-primary (ADR-007) ✅ | WAHA webhook verification task |
| Dependencies | lockfile + pinned prom-client; `npm audit` in CI | Run osv/audit in S10 |
| Sensitive logging | pino redaction; metrics cardinality test-enforced ✅ | — |
| `/metrics` | public | R-01 restrict (§16) |

---

## 21. Deployment Architecture

**Target sequence (per master prompt) — none of the tooling exists yet:**

```
Build → Test → Migration → Deploy → Health check → Smoke test → Rollback
```

**Missing artifacts (all S10 build items):** production Dockerfile (multi-stage, non-root, hardened), production compose/overlay, env/secrets injection, migration runner step, health-gated deploy, smoke-test script, **rollback strategy for both app (image tag) and DB (forward-only migrations + PITR/PITR-restore)**, CI/CD deploy stage, post-deploy verification checklist.

---

## 22. Production Risks (ranked)

1. 🔴 **No production frontend exists** — largest scope/risk; new code against locked contracts.
2. 🔴 **Bukku key exposure (R1) + browser-direct Bukku** — rotate before any prod push; remove browser-direct path.
3. 🔴 **`app/.env` live-looking cloud credential on disk** — rotate/remove now.
4. 🔴 **Backup/restore nonexistent (R9)** — must be built AND rehearsed before go-live.
5. 🟡 **Legacy coexistence on shared VPS** — port/resource/nginx collision; rollback blast radius.
6. 🟡 **First-time-live Bukku + WAHA transports** — S8 workers tested with mocked adapters only.
7. 🟡 **`/metrics` public until R-01 lands.**
8. 🟢 Single-VPS SPOF (accepted, ADR-008) — mitigated by backup/PITR once built.

---

## 23. Gaps (consolidated)

G1. Production frontend (build + wire to `/api/v1`) — **the** gap.
G2. Production infra (compose, nginx, TLS, DNS, firewall, secrets).
G3. Backup/restore automation + rehearsed restore.
G4. Monitoring/alerting stack + on-call.
G5. `/metrics` restriction (R-01).
G6. Bukku/WAHA real-transport verification + Bukku key rotation.
G7. Production migration rehearsal + rollback.
G8. Power BI live validation + publish + gateway + RLS.
G9. Security hardening (headers, rate-limit, osv audit, remove browser-direct Bukku).
G10. Frontend RBAC parity with locked matrix.
G11. (Open) SaaS billing/entitlement — scope decision required.
G12. Secret hygiene (`app/.env`, localStorage Bukku).

---

## 24. Dependencies

- Bos: Bukku key rotation (Bukku-side), Power BI Desktop/Service license + workspace, domain/DNS decision, legacy coexistence decision, SaaS-billing scope decision.
- Infra: Fariq VPS access (read-only in P1), DNS control, TLS cert (Let's Encrypt).
- External: Bukku API (real), WAHA server, Prometheus/Grafana hosting.
- GLM 5.3 (audit), ChatGPT Governance (phase gates).

---

## 25. Proposed S10 Task Breakdown

> Smallest reasonable structure; each ends with a governance report + STOP. Numbers/contents are proposals pending governance.

| Task | Scope | Primary risk retired |
|---|---|---|
| **S10-T0 — Secret & Scope Hygiene** (pre-work, small) | Rotate/remove `app/.env` cred; Bukku key rotation; remove browser-direct Bukku decision; confirm SaaS-billing scope; legacy coexistence decision | Risks 2,3,11 |
| **S10-T1 — Production Frontend** | Build/wire real frontend to `/api/v1` (auth flow, RBAC parity, all 6 S9 reports, core workflows); retire prototype from prod path; contract-parity tests | G1, G10 |
| **S10-T2 — Production Infrastructure** | Hardened Dockerfile, prod compose (backend+PG16+Redis+WAHA+nginx), TLS/DNS/firewall, secrets, health checks, deploy+rollback scripts | G2 |
| **S10-T3 — Database, Backup & Restore** | Production migration rehearsal; backup automation (nightly off-box + PITR); **timed restore rehearsal** with integrity check (RTO/RPO) | G3, G7 |
| **S10-T4 — Observability & Security Hardening** | Prometheus+Grafana+Alertmanager; wire A1–A6; on-call; `/metrics` restriction (R-01); headers/rate-limit; osv audit | G4, G5, G9 |
| **S10-T5 — Integrations & BI Verification** | Bukku real-transport E2E (post-rotation); WAHA real transport; Power BI live validation/publish/gateway/RLS | G6, G8 |
| **S10-T6 — Staging, E2E & Go-Live** | Staging deploy; full-stack E2E; security suite; smoke tests; production deploy; go-live verification doc | all |

**Sequencing note:** T0 is tiny and de-risks everything; T1 is the long pole and can overlap T2; T3/T4/T5 parallelize after T2; T6 is the gate.

---

## 26. Definition of Done (per task)

- Implementation complete against approved scope; **S8/S9 immutability preserved** (zero diff on locked modules/migrations/tests).
- Targeted tests green + **full regression 475+/475+ ×3, 0 skipped.**
- Fresh migration replay clean; RLS probes green.
- Frontend MD5 unchanged (until/unless governance re-baselines the UI).
- No secrets in repo; lint/typecheck/build green; CI green.
- Task completion report (evidence table + git state) → STOP for governance.

---

## 27. Go-Live Gate

All must be ✅ before production deploy:
GLM audit PASS · ChatGPT Governance PASS · Bos sign-off · staging PASS · backup PASS · **restore PASS (rehearsed)** · migration rehearsal PASS · security PASS · frontend↔backend E2E PASS · monitoring PASS · rollback PASS · `/metrics` restricted · Bukku key rotated · (payment verification PASS *if* in launch scope).

---

## 28. Open Governance Questions

1. **SaaS billing in launch scope?** If yes → net-new Phase 2 scope (provider, entitlement, webhooks). If no → manual gating.
2. **Frontend strategy:** build a fresh thin SPA against `/api/v1`, OR port `app/` prototype to REST (rip out tRPC/SQLite), OR adapt the locked HTML? (Recommendation: fresh thin SPA reusing `app/` UI components but new data layer — the prototype's tRPC/SQLite backend is unsalvageable for prod.)
3. **Legacy `medini-backend :5000`:** coexist (ports/resources) or cutover? Maintenance window allowed?
4. **Domain/DNS/TLS:** what hostname? Who controls DNS?
5. **T0 secret rotation:** confirm Bos rotates Bukku key + the `app/.env` cloud cred before T1 starts.
6. **Monitoring/on-call:** who receives alerts (email/Telegram/PagerDuty)?

---

## 29. Final Recommendation

**Proceed to S10, but with eyes open: the distance to production is dominated by ONE fact — the production backend is finished and locked, yet no production frontend is connected to it, and the "frontend" everyone has been reviewing is an unconnected prototype with browser-direct Bukku and a live-looking credential on disk.**

Recommended immediate moves (all Phase-2, pending governance):
1. **T0 first** — cheap, fast, retires the two live-secret risks and settles scope questions.
2. **T1 (production frontend)** is the critical path — start it early, in parallel with T2 infra.
3. **Do not let T3 backup/restore slip** — Rule 6 makes a rehearsed restore a hard go-live gate.
4. Keep S8/S9 frozen; treat the locked backend as the immutable system of record the new frontend must conform to.

---

**S10 PHASE 1 COMPLETE — READY FOR CHATGPT GOVERNANCE REVIEW**

*Read-only honored: no code/config/DB/infra changes, no installs, no commits, no pushes, no deploys. The only file created is this report (`docs/S10-DISCOVERY-ARCHITECTURE-REPORT.md`).*
