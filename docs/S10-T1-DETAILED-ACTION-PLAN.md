# S10 T1 — DETAILED ACTION PLAN (UPDATED — Governance Direction v2)

**Sprint:** 10 · **Task:** T1 — Production Frontend Integration **+ User Account Lifecycle**
**Date:** 19 August 2026 · **Author:** Neo (Kimi K3)
**Type:** READ-ONLY planning — **NO implementation performed**
**Supersedes:** `S10-T1-DETAILED-ACTION-PLAN.md` (v1) — this v2 absorbs the Governance User-Onboarding direction
**Baseline:** S8 `c0ac25c` · S9 `a59cff9`+lock `7cca0b3` (LOCKED, 475/475 green)

---

## 0. Headline: the governance direction is ~70% ALREADY BUILT in the locked backend

The single most important planning fact: **the S7 Administration module already implements the HQ-controlled staff lifecycle the governance direction describes.** This is not a greenfield build — it is mostly **wiring + a few well-defined additive gaps.**

| Governance requirement | Existing backend capability (evidence) | Status |
|---|---|---|
| HQ invites staff, assigns org/branch/role | `inviteStaff()` — HQ-only, creates staff `status:'Invited'` + initial ACTIVE role_assignment, asserts branch rule (`hq`⇒null branch), username immutable+unique per org, audited `staff_invited` | 🟢 **EXISTS** |
| No destructive delete; historical preserved | `administration-lifecycle.ts`: "No destructive delete. Records are preserved (governance)." Role assignments SUPERSEDE (never edit in place) | 🟢 **EXISTS** |
| Deactivate (resign) | `transitionStaff('deactivate')` → `Deactivated`; self-protection + **last-HQ advisory-lock protection** (TOCTOU-safe); audited | 🟢 **EXISTS** |
| Status lifecycle machine | `STAFF_TRANSITIONS`: Invited→Active; Active→Suspended/Deactivated; Suspended→Active/Deactivated; Deactivated→Active (reactivate) | 🟢 **EXISTS** |
| Deactivated cannot login | `AuthService.login` rejects `status !== 'Active'` (generic 401, no status leak) | 🟢 **EXISTS** |
| Backend is authority for role/branch | HQ-only `requireHq` + RLS org-isolation + role from DB (never token) | 🟢 **EXISTS** |
| Staff self-registration (set own username/password) | — | 🔴 **MISSING** |
| HQ approval of a *completed application* (PENDING) | `transitionStaff('activate')` exists, but there is **no `Pending` status** — invite creates `Invited`, and `Invited→Active` is the only path | 🟡 **PARTIAL** |
| Refresh token: storage + rotation + revocation | — | 🔴 **MISSING** (TokenService is access-only) |
| Server-side logout/revocation | — | 🔴 **MISSING** |
| Session invalidation on deactivation | deactivation blocks *future* login, but existing live access tokens stay valid until 900s expiry | 🟡 **PARTIAL** |

**Conclusion:** T1's user-lifecycle scope is **additive on a solid S7 foundation**, not a rebuild. The genuinely new backend surface is: (a) staff self-registration, (b) a `Pending` application state, (c) refresh-token persistence+rotation+revocation, (d) server-side logout, (e) deactivation-time token revocation.

---

# 1. T1 IMPLEMENTATION ARCHITECTURE (unchanged from v1, plus lifecycle)

Frontend: keep Vite+React SPA, routes, layouts, all shadcn UI. Replace ONLY the data/auth plumbing.

| Concern | Plan |
|---|---|
| Data/API layer | NEW `app/src/lib/api.ts` — typed REST client over `fetch` → `/api/v1`, react-query (already present) for cache/loading/error. **Delete `api/` (Hono/tRPC) + `data/` (SQLite) + `providers/trpc.tsx`.** |
| Auth | NEW `app/src/lib/auth.ts`: login → store access+refresh → attach Bearer → on 401 refresh → else logout. |
| Session/user state | existing `AuthProvider` holds Principal from `/auth/me`; role never client-trusted. |
| RBAC/RLS | backend sole authority; frontend mirrors locked `ROLE_DOMAIN_MATRIX` for cosmetic gating only. |
| **NEW: User lifecycle UI** | new admin screens (Invite, Applications/Approval, User Management) reusing existing Administration page + shadcn components. |

---

# 2. USER LIFECYCLE — mapped to existing backend

### Target flow (governance) → backend mapping

```text
HQ Invite (name/org/branch/role)          → inviteStaff()  [EXISTS]
  ↓ staff record status='Invited'
Staff opens registration, sets username/password  → NEW self-registration endpoint  [MISSING]
  ↓ status → 'Pending'                    → NEW status in lifecycle  [MISSING]
HQ reviews application → APPROVE          → transitionStaff('activate') Pending→Active  [PARTIAL — needs Pending state]
                       → REJECT           → NEW reject path → status 'Rejected'  [MISSING]
Active → login                            → AuthService.login (status==='Active')  [EXISTS]
Resign → HQ Deactivate                    → transitionStaff('deactivate')  [EXISTS]
  ↓ revoke live sessions                  → NEW refresh-token revocation  [MISSING]
Historical data + audit preserved         → already true (no delete; SUPERSEDE)  [EXISTS]
```

### Status enum mapping (governance §12 → existing)

Existing `staffStatusEnum = ['Active','Suspended','Deactivated','Invited']`. Governance wants `PENDING / ACTIVE / DEACTIVATED / REJECTED`.

| Governance | Existing | Action |
|---|---|---|
| `ACTIVE` | `Active` | ✅ reuse |
| `DEACTIVATED` | `Deactivated` | ✅ reuse |
| `PENDING` | — (closest is `Invited`) | 🔴 **ADD `Pending`** — but see D6 ambiguity below |
| `REJECTED` | — | 🔴 **ADD `Rejected`** |
| (existing) | `Invited`, `Suspended` | keep (invite/pre-approval, suspension) |

> **Rule honored:** reuse existing enum + state machine; only additive enum values + transitions. No duplicate status system. Enum additions are **irreversible** (`ALTER TYPE ADD VALUE`) — must be governance-approved (D6).

---

# 3. AUTHENTICATION PLAN (refresh/logout now IN SCOPE per governance §13)

```text
Login → AuthService.login (Argon2id, status==='Active')
  → issue ACCESS token (HS256, TTL 900s)   [EXISTS]
  → issue REFRESH token (longer TTL, persisted, rotation)   [MISSING — build]
API call → AuthGuard.verifyAccess → PrincipalResolver
Access expires → POST /auth/refresh → verify stored refresh → ROTATE (new pair, revoke old)   [MISSING]
Logout → POST /auth/logout → revoke refresh token server-side   [MISSING]
Deactivate → revoke ALL refresh tokens for that staff   [MISSING]
```

Governance decided **D2 = secure strategy (storage + rotation + revocation)** and **D3 = server-side revocation**. Therefore:

| Component | State | Action |
|---|---|---|
| Access token | 🟢 exists | reuse |
| Refresh signing/verify | 🔴 missing | add to TokenService (uses `jwt.refreshSecret`/`refreshTtl` — config already present) |
| Refresh persistence | 🔴 missing | **NEW table `refresh_tokens`** (staff_id, token_hash, expires, revoked, rotated_to, created) — **1 additive migration** |
| Rotation | 🔴 missing | on refresh: mark old `rotated`, issue new pair |
| Revocation (logout) | 🔴 missing | `POST /auth/logout` sets `revoked_at` |
| Revocation (deactivation) | 🔴 missing | `transitionStaff('deactivate')` also revokes that staff's refresh tokens |

---

# 4. API GAP VERIFICATION (updated — v1 gaps + lifecycle gaps)

| Endpoint | Existing? | Needed? | Alternative? | Add? | Reason |
|---|---|---|---|---|---|
| `POST /auth/refresh` | 🔴 no | ✅ yes (900s TTL) | ❌ | ✅ ADD (approved D1) | session continuity; needs refresh table |
| `POST /auth/logout` | 🔴 no | ✅ yes (gov §13 server revocation) | ❌ client-discard insufficient now | ✅ ADD (gov §14) | server-side revocation |
| `GET /appointments` | 🔴 no (only queue/:id) | ✅ yes | ❌ | ✅ ADD (approved D1) | Appointments list |
| `PATCH /patients/:id` | 🔴 no | ✅ yes | ❌ | ✅ ADD (approved D1) | patient edit |
| `POST /auth/register` (staff self-registration) | 🔴 no | ✅ yes (gov §7) | ❌ invite only creates Invited shell | ✅ ADD (lifecycle) | staff completes account → Pending |
| `POST /administration/staff/:id/approve` | 🟡 partial (`transitionStaff('activate')`) | ✅ yes | 🟡 reuse activate once `Pending` exists | 🟡 REUSE + extend | approval = Pending→Active |
| `POST /administration/staff/:id/reject` | 🔴 no | ✅ yes (gov §8) | ❌ | ✅ ADD (lifecycle) | rejection → Rejected |
| dashboard extras (`ai.insights`/`intelligence.signals`) | 🟡 partial | 🟡 | ✅ `dashboard/context` | 🟡 DROP (gov §16) | real data > mock intelligence |

**Net new backend surface:** 2 auth endpoints + 1 auth table + 2 lifecycle endpoints + 2 enum values + 2 list/update endpoints. All additive.

---

# 5. EXACT FILE IMPACT (planned — nothing modified yet)

### CREATE — backend (additive)
| Path | Purpose |
|---|---|
| `backend/drizzle/0025_s10_auth_lifecycle.sql` | NEW `refresh_tokens` table + RLS + grants; `ALTER TYPE staff_status ADD VALUE 'Pending','Rejected'` (D6) |
| `backend/src/core/auth/refresh-token.service.ts` | refresh sign/verify/rotate/revoke |
| `backend/src/core/auth/dto/refresh.dto.ts` | refresh request DTO |
| `backend/test/integration/s10-auth-lifecycle.spec.ts` | refresh/rotation/logout/revoke tests |
| `backend/test/integration/s10-staff-registration.spec.ts` | register/approve/reject tests |
| `backend/test/integration/s10-appointments-list.spec.ts` | list tests |
| `backend/test/integration/s10-patients-update.spec.ts` | update tests |

### MODIFY — backend (additive only)
| Path | Change |
|---|---|
| `backend/src/core/auth/auth.controller.ts` | +`POST refresh`, +`POST logout`, +`POST register` |
| `backend/src/core/auth/auth.service.ts` | +register (Pending), +refresh/login issue refresh token |
| `backend/src/modules/administration/presentation/administration.controller.ts` | +`POST staff/:id/reject` (+approve alias if desired) |
| `backend/src/modules/administration/application/administration.service.ts` | +reject method; +deactivation-time token revocation hook; extend activate to allow `Pending→Active` |
| `backend/src/modules/administration/domain/administration-lifecycle.ts` | +`Pending`,`Rejected` to type + transitions (`Invited→Pending`, `Pending→Active/Rejected`) |
| `backend/src/modules/appointments/presentation/appointments.controller.ts` + service | +`GET` list |
| `backend/src/modules/patients/presentation/patients.controller.ts` + service | +`PATCH :id` update |
| `backend/src/infrastructure/database/schema.ts` | +`refresh_tokens` pgTable (additive at end); enum type unions |
| `backend/drizzle/meta/_journal.json` + `.github/workflows/ci.yml` | register 0025 |
| `backend/src/main.ts` | CORS origin allowlist (config) |

### CREATE — frontend (new data/auth layer + lifecycle UI)
| Path | Purpose |
|---|---|
| `app/src/lib/api.ts` | typed REST `/api/v1` client + react-query hook factory |
| `app/src/lib/auth.ts` | token store, login/logout/refresh |
| `app/src/lib/hooks/{auth,patients,appointments,clinical,finance,reports,dashboard,admin}.ts` | per-module REST hooks |
| `app/src/pages/admin/{InviteUser,UserApplications,UserManagement}.tsx` (or extend Administration.tsx) | HQ invite / approve-reject / deactivate UI |
| `app/src/pages/Register.tsx` | staff self-registration (from invitation) |
| `app/.env.example` | `VITE_API_URL` |

### MODIFY — frontend
| Path | Change |
|---|---|
| `app/src/hooks/useAuth.tsx` | rewire to REST + JWT + refresh |
| `app/src/App.tsx` | +`/register` route (public); align `roleGuard` to locked matrix |
| `app/src/pages/{Login,Dashboard,Patients,Patient360,Appointments,Clinical,Finance,Reports,Administration}.tsx` | swap `trpc.*` → REST hooks (keep JSX) |
| `app/vite.config.ts` | dev proxy `/api`→backend |
| `app/package.json` | prune tRPC/hono/better-sqlite3 after migration |

### DELETE — frontend (prototype data layer out of prod flow)
`app/api/**` · `app/data/medini.db*` · `app/src/providers/trpc.tsx`

### MUST NOT TOUCH (locked)
`CURRENT-MEDINI-REVIEW.html` (MD5 `84f3993af955af666d263f364cb37eb6`) · `backend/drizzle/0000→0024` (+journal history) · S8 module internals (whatsapp/finance/marketing/clinical/operations services+repos) · `architecture.contract.ts` (ROLE_DOMAIN_MATRIX) · `infrastructure/{outbox,queue,observability}`.

---

# 6. BACKEND IMPACT (minimum + additive + evidence-based)

| Module | Controller | Service | Domain | Migration | Test | Why |
|---|---|---|---|---|---|---|
| auth (core) | +refresh/logout/register | +refresh-token.service, auth.service register | — | 0025 (refresh_tokens + 2 enum values) | s10-auth-lifecycle | refresh/logout/register |
| administration | +reject (+approve alias) | +reject, deactivation revocation | +Pending/Rejected transitions | (enum in 0025) | s10-staff-registration | approval flow |
| appointments | +GET list | +list | — | none | s10-appointments-list | list (C) |
| patients | +PATCH :id | +update | — | none | s10-patients-update | edit (D) |

**One additive migration (0025) only.** RBAC/RLS preserved; all 475 existing tests must stay green; new specs additive. No refactor.

---

# 7. DATA FLOW (registration example — proves no mock dependency)

```text
Register.tsx (UI)
  → useRegister() hook
  → api.post('/auth/register', { inviteToken/username, name, password })
  → POST /api/v1/auth/register   [@Public — no token yet]
  → AuthService.register: validate invite (staff status='Invited'), hash password (Argon2id), set status='Pending'
  → DbContextService.runAs(system) → RLS org-isolation
  → PostgreSQL staff row updated → status='Pending'
  → response { pending: true }
  → UI: "Application pending HQ approval"
  ↓ (HQ side)
Administration → UserApplications.tsx
  → api.post('/administration/staff/:id/approve')
  → AuthGuard → PrincipalResolver (role='hq') → requireHq
  → transitionStaff: Pending→Active (state machine) + audit
  → staff can now login
```

---

# 8. TEST STRATEGY

**Frontend:** typecheck → lint → build → hook/auth unit tests (mocked fetch) + Login/Register component smoke.
**Backend per new endpoint:** no-token 401 · wrong-role 403 · bad-body 400 · success · org/branch scope · state-machine legality (e.g. `Active→Pending` rejected) · **refresh rotation + revocation** · **deactivation blocks login + revokes tokens** · **full regression 475+ ×3, 0 skipped**.
**Integration:** boot backend vs dev PG16 → drive real flows: invite→register→pending→approve→login→(patients/appointments/finance/reports)→deactivate→login-fails. Actual API responses, not screenshots.

---

# 9. IMPLEMENTATION ORDER (dependency-driven)

```text
Step 1 — Migration 0025 (refresh_tokens + Pending/Rejected enum)   ← foundation
Step 2 — Backend auth: refresh-token.service + register + refresh + logout   ← auth depends on Step 1
Step 3 — Backend administration: Pending/Rejected transitions + approve/reject + deactivation revocation   ← depends on Step 1 enum
Step 4 — Backend gaps C (appointments list) + D (patients update)   ← independent
Step 5 — Frontend lib/api.ts + lib/auth.ts   ← needs Step 2 token shape
Step 6 — useAuth + App.tsx (+/register route, guard matrix)   ← needs Step 5
Step 7 — Login + Register pages   ← needs Step 6
Step 8 — User lifecycle admin UI (Invite/Applications/Management)   ← needs Step 3 + Step 5
Step 9 — Patients + Patient360   ← needs Step 4
Step 10 — Appointments   ← needs Step 4
Step 11 — Clinical   ← needs Step 5
Step 12 — Finance (ADR-004)   ← needs Step 5
Step 13 — Reports (6 endpoints)   ← needs Step 5
Step 14 — Dashboard (real data only)   ← needs Step 5
Step 15 — Delete tRPC/SQLite prototype layer   ← after all pages migrated
Step 16 — Full verification + T1 report
```

---

# 10. RISK REGISTER (updated)

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Refresh-token build on locked auth (rotation/revocation) | High | Certain (gov-mandated) | additive service+table; rotation/revoke tests; D2 decided |
| **Enum addition irreversible** (`ALTER TYPE ADD VALUE`) | High | Med | governance pre-approval (D6); additive only, never remove |
| Registration security (invite token leak → privilege escalation) | High | Med | single-use invite token, HQ-fixed role/branch, staff cannot self-assign; RLS |
| Deactivation session-revocation gap (live access tokens) | Med | High | short 900s access TTL bounds exposure; revoke refresh on deactivate |
| API contract/data-model mismatch (UUID vs int) | High | High | typed client + integration tests |
| Regression on S7 administration module | High | Low | additive endpoints + 475×3 gate |
| Prototype dependency leak | Med | Med | Step 15 deletion + grep clean |
| Finance ADR-004 semantic mismatch | Med | Med | status-layer mapping; no gateway |
| Scope creep (lifecycle bigger than v1 plan) | Med | Certain | this plan absorbs it; no T2/T3/T4 work |

---

# 11. T1 DEFINITION OF DONE — evidence (updated)

| Requirement | Evidence |
|---|---|
| Frontend connected | UI hook → REST → PG → response |
| REST integration | all pages off tRPC (grep clean) |
| Auth (login/refresh/logout) | full flow test incl. rotation + revocation |
| **User onboarding (invite→register→pending→approve)** | integration test; staff cannot self-assign role/branch |
| **User deactivation (resign)** | deactivate → login rejected → tokens revoked → historical/audit intact |
| Patients / Appointments / Clinical / Finance / Reports | per-module integration tests (C/D/ADR-004) |
| RBAC/RLS | 403/scope tests + 475×3 green |
| Real data | no SQLite/mock in prod flow |
| API gaps | D1 endpoints + lifecycle endpoints + tests |
| Tests | exact counts (FE+BE+integration) |
| CI | GitHub Actions green; migration 0025 replay-clean |
| Tree clean / no deploy | `git status`; MD5 unchanged |

---

# 13. FINAL RECOMMENDATION

### Recommended sequence
§9 (migration → backend auth+lifecycle+gaps → frontend data/auth → pages+lifecycle UI → delete prototype → verify).

### Estimated complexity
**High — and larger than v1.** Governance added a full user-account lifecycle (registration/approval/rejection/deactivation) plus a mandated secure refresh-token mechanism with persistence+rotation+revocation. The S7 foundation absorbs ~70% of the lifecycle, but the new backend surface (1 migration + 4–5 endpoints + refresh mechanism) plus 8 frontend modules makes this the largest S10 task.

### Major risks
Refresh-token security build (R1) · irreversible enum addition (R2) · registration privilege-escalation (R3) · scope creep (R9).

### Governance decisions still required
- **D6:** Approve **migration 0025** = new `refresh_tokens` table + **two additive `staff_status` enum values (`Pending`, `Rejected`)**. Enum additions are irreversible → needs explicit approval. (Alternative: reuse `Invited` as the pending state and skip `Pending` — but then "registration submitted, awaiting approval" is indistinguishable from "invited, not yet registered," so I recommend the two new values.)
- **D7:** Approve the **invite → registration hand-off mechanism** — a single-use, expiring invite token/link that lets the invited staff reach `POST /auth/register` without being able to alter HQ-assigned role/branch. (Recommend: single-use token column or signed invite reference; NOT a public signup.)
- **D8:** Confirm deactivation-time revocation scope — revoke refresh tokens immediately (access tokens expire within 900s naturally). Recommend YES.

### Ready to implement?
🟡 **NEEDS GOVERNANCE CLARIFICATION** — specifically **D6** (migration + enum values) and **D7** (invite hand-off mechanism), because both change the backend surface and D6 is irreversible. Once D6–D8 are confirmed, T1 is 🟢 READY.

---

**HARD STOP.** No implementation, no code/DB/config changes, no installs, no commit/push/deploy. Awaiting ChatGPT Governance Review → `PROCEED S10 T1 IMPLEMENTATION`.
