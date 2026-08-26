# S10 T1 — IMPLEMENTATION REPORT

**Sprint:** 10 · **Task:** T1 — Production Frontend Integration + User Account Lifecycle
**Date:** 19 August 2026 · **Author:** Neo (Kimi K3)
**Baseline:** S8 `c0ac25c` · S9 `a59cff9`+lock `7cca0b3` (both LOCKED)
**Status:** Implementation complete — pending Governance Review

---

## 1. Executive Summary

T1 connected the Medini CRM frontend to the locked S8/S9 production backend for the first time. The prototype tRPC/SQLite data layer was removed; a new REST `/api/v1` client + JWT auth layer now drives every core module against the NestJS backend + PostgreSQL. The HQ-controlled user lifecycle (invite → single-use registration link → pending → approve/reject → active → deactivate with token revocation) was built additively on the S7 Administration foundation. One additive migration (0025) adds refresh-token persistence + the `Pending`/`Rejected` lifecycle states + single-use invitation token columns.

**Verification:** backend 487/487 tests (0 skipped) · typecheck/lint/build green · migration replay 0000→0025 clean (70 tables) · frontend typecheck + build green · locked HTML MD5 unchanged · no secrets in repo.

---

## 2. Frontend Architecture (before → after)

| Concern | Before (prototype) | After (production) |
|---|---|---|
| Data layer | tRPC client → Hono → **SQLite** | `lib/api.ts` REST client → **`/api/v1`** → NestJS → PostgreSQL |
| Auth | scrypt + HMAC cookie + localStorage session | `lib/auth.ts` JWT access (900s) + **refresh (rotation + revocation)** |
| State | tRPC/react-query | react-query (`QueryClientProvider`) |
| IDs | SQLite integers | **UUID strings** (`useBranch` updated) |
| Prototype artifacts | `api/`, `data/medini.db`, `providers/trpc.tsx` | **DELETED** |
| Dev server | `@hono/vite-dev-server` (served tRPC) | Vite dev + **proxy `/api` → backend :3000** |

---

## 3. Backend Changes (all additive)

### New files
- `src/core/auth/refresh-token.service.ts` — refresh issue/rotate/revoke/revokeAll/verify (SHA-256 hash storage, single-use rotation).
- `src/core/auth/staff-registration.service.ts` — single-use invite token generation + staff self-registration (Invited→Pending; no org/branch/role mutation).
- `src/core/auth/dto/refresh.dto.ts`, `src/core/auth/dto/register.dto.ts`.
- `drizzle/0025_s10_auth_lifecycle.sql` — refresh_tokens table + `Pending`/`Rejected` enum + `staff.invite_token`/`invite_expires_at`.
- `test/unit/s10-staff-lifecycle.spec.ts`, `test/integration/s10-auth-lifecycle.spec.ts`.

### Modified (additive only)
- `auth.service.ts` — login issues refresh token; new `refresh()` (rotation) + `logout()` (revocation). Added `DbContextService` to constructor (RLS-safe refresh lookup).
- `auth.controller.ts` — `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/register`.
- `auth.module.ts` — registered new providers.
- `administration-lifecycle.ts` — added `Pending`/`Rejected` states + transitions (`Invited→Pending`, `Pending→Active/Rejected`); `approve`/`reject` commands.
- `administration.service.ts` — `generateInviteLink`, `approveStaff`, `rejectStaff`, `deactivateStaff` (revokes all refresh tokens).
- `administration.controller.ts` — `POST /admin/staff/:id/approve`, `/reject`, `/invite-link`.
- `administration.module.ts` — registered RefreshTokenService + StaffRegistrationService.
- `appointments.{controller,service,repository}.ts` — `GET /appointments` (paginated list).
- `patients.{controller,service,repository}.ts` — `PATCH /patients/:id` (partial update).
- `infrastructure/database/schema.ts` — `refreshTokens` table + 2 staff columns + 2 enum values.
- `drizzle/meta/_journal.json` + `.github/workflows/ci.yml` — registered 0025.

---

## 4. API Changes (approved governance gaps)

| Endpoint | Method | Reason | AuthZ | Tests |
|---|---|---|---|---|
| `/auth/refresh` | POST | access-token renewal (900s TTL) | Public (opaque token) | rotation + reuse-rejected |
| `/auth/logout` | POST | server-side revocation | Authenticated | revoke → refresh fails |
| `/auth/register` | POST | staff self-registration via invite | Public (single-use token) | invalid token rejected |
| `/appointments` | GET | Appointments list | `appointments:view` | (service-level) |
| `/patients/:id` | PATCH | patient update | `patients:edit` | (service-level) |
| `/admin/staff/:id/approve` | POST | HQ approve application | `admin:edit` (HQ) | lifecycle transitions |
| `/admin/staff/:id/reject` | POST | HQ reject application | `admin:edit` (HQ) | lifecycle transitions |
| `/admin/staff/:id/invite-link` | POST | generate single-use link | `admin:edit` (HQ) | invite-token generation |

---

## 5. Authentication

- **Login:** `POST /auth/login` → Argon2id verify (timing-safe) → Principal from DB → access JWT (HS256, iss/aud, 900s) + opaque refresh token (persisted hash).
- **Refresh:** `POST /auth/refresh` → verify stored hash (not revoked/rotated/expired) → **rotate** (old `rotated_to` new, revoked) → new access + refresh pair.
- **Logout:** `POST /auth/logout` → set `revoked_at` server-side. Subsequent refresh with that token fails.
- **Deactivation:** `deactivateStaff` → status `Deactivated` + **revoke all refresh tokens** for that staff. Login + refresh both rejected.
- **Reuse detection:** a rotated or revoked refresh token cannot be used again (401).

---

## 6. User Onboarding (HQ-controlled)

```text
HQ: Administration → Invite Staff (name/org/branch/role)
  → POST /admin/staff (inviteStaff → status='Invited')
  → POST /admin/staff/:id/invite-link → single-use link (72h expiry)
  → HQ copies link, sends out-of-band (no email infra)
Staff: /register?token=... → Full Name + Username + Password
  → POST /auth/register → status='Pending' (invite token cleared, single-use)
HQ: Administration → Applications → Approve (→Active) / Reject (→Rejected)
Active → login allowed. Rejected → cannot login.
```

Staff **cannot** change org/branch/role — the register endpoint only accepts `inviteToken/name/username/password` and never touches role/branch/org columns.

---

## 7. User Approval

- `Pending → Active` via `approveStaff` (HQ-only, state-machine enforced, audited).
- `Pending → Rejected` via `rejectStaff` (HQ-only, terminal state, audited).
- Illegal transitions (e.g. `Active → Pending`) rejected with 409 Conflict.

---

## 8. User Deactivation

- `Active → Deactivated` via `deactivateStaff` → `transitionStaff('deactivate')` + `refreshTokens.revokeAllForStaff`.
- Self-protection: cannot deactivate own account (403).
- Last-HQ protection: cannot deactivate the last active HQ admin (409, advisory-lock serialized).
- Historical data + audit trail preserved (no hard delete).

---

## 9. Module Integration Matrix

| Module | Frontend | Backend API | Real Data | Status |
|---|---|---|---|---|
| Login | `Login.tsx` | `POST /auth/login` | ✅ PostgreSQL | 🟢 CONNECTED |
| User Registration | `Register.tsx` | `POST /auth/register` | ✅ | 🟢 CONNECTED |
| User Management | `Administration.tsx` | `/admin/staff/*` | ✅ | 🟢 CONNECTED |
| Dashboard | `Dashboard.tsx` | `GET /dashboard/context` | ✅ | 🟢 CONNECTED |
| Patients | `Patients.tsx` + `Patient360.tsx` | `GET/POST/PATCH /patients*` | ✅ | 🟢 CONNECTED |
| Appointments | `Appointments.tsx` | `GET/POST/PATCH /appointments*` | ✅ | 🟢 CONNECTED |
| Clinical | `Clinical.tsx` | `GET /clinical/*` | ✅ | 🟢 CONNECTED |
| Finance | `Finance.tsx` | `GET /finance/*` (status-layer, ADR-004) | ✅ | 🟢 CONNECTED |
| Reports | `Reports.tsx` | all 6 `GET /reports/*` | ✅ | 🟢 CONNECTED |
| User/Profile | `useAuth` + `AppLayout` | `GET /auth/me` | ✅ | 🟢 CONNECTED |

Secondary modules (AI Manager, Documents, Marketing, Operations, Settings, WhatsApp Hub) are stubbed — they are not in the T1 core scope; their production wiring is a post-T1 task.

---

## 10. RBAC/RLS

- Backend remains the sole authorization authority (PermissionGuard + service checks + RLS).
- Frontend `roleGuard` in `App.tsx` mirrors the locked `ROLE_DOMAIN_MATRIX` (cosmetic only): `admin`=hq, `marketing`/`finance`/`reports`=hq+branch_manager, doctor/receptionist blocked from reports (S9 Q1).
- All backend queries run inside `DbContextService.runAs` (transaction-local GUCs → org-isolation RESTRICTIVE + role permissives).
- Refresh-token and registration flows use scoped worker contexts where no human Principal exists yet (pre-auth), preserving org-isolation.

---

## 11. Security

- No secrets in frontend source; no production DB password in source; no Bukku key in browser/localStorage; no direct browser→Bukku.
- Refresh tokens stored as SHA-256 hashes only; raw token returned once.
- Invitation tokens single-use (cleared on registration) + 72h expiry + no privilege escalation (role/branch/org HQ-fixed).
- Passwords Argon2id-hashed; never logged or returned.
- CORS: backend `origin:false` by default (restrictive); Vite dev proxy used locally.
- RBAC/RLS unchanged (additive only).

---

## 12. Migration 0025

- `drizzle/0025_s10_auth_lifecycle.sql` — additive only.
- New table `refresh_tokens` (id, org_id, staff_id FK, token_hash unique, expires_at, revoked_at, rotated_to, created_ip, user_agent) + RLS (org-isolation RESTRICTIVE + insert/select/update permissives; no DELETE).
- `staff_status` enum + `Pending`, `Rejected` (irreversible, governance-approved D6).
- `staff` + `invite_token` (text), `invite_expires_at` (timestamptz) (governance D7).
- Registered in `_journal.json` (idx 24) + CI loop.
- **Replay 0000→0025 clean: 70 tables, 6 staff_status values.**

---

## 13. Tests

| Suite | Result |
|---|---|
| Backend full suite | **487/487 passed, 0 failed, 0 skipped** (72 files) |
| — baseline (S8/S9) | 475 |
| — new: `s10-staff-lifecycle.spec.ts` (unit) | 6 |
| — new: `s10-auth-lifecycle.spec.ts` (integration) | 6 |
| Backend typecheck | ✅ GREEN |
| Backend lint | ✅ GREEN (max-warnings=0) |
| Backend build | ✅ GREEN |
| Frontend typecheck | ✅ GREEN |
| Frontend build | ✅ GREEN |
| Frontend lint | 21 pre-existing errors (baseline had 218 — frontend was never lint-gated; all remaining are in untouched `components/ui/*` shadcn files) |

### Integration evidence (live PG)
- login returns access + refresh tokens ✅
- refresh rotates the token (new pair, old rotated) ✅
- rotated refresh token reuse → 401 ✅
- logout revokes → subsequent refresh 401 ✅
- invalid invite token registration → 401 ✅
- deactivated user login rejected ✅

---

## 14. CI

`.github/workflows/ci.yml` updated to include `drizzle/0025_s10_auth_lifecycle.sql` in the migration replay loop. CI will run lint → typecheck → build → migrate (0000→0025) → seed → full tests on push.

---

## 15. Known Limitations

1. **Frontend→backend live E2E not browser-driven** — integration proven at the API/service level (backend integration tests + frontend typecheck/build). A booted-app browser E2E (Playwright) is T3 scope.
2. **Secondary modules stubbed** (AI Manager, Documents, Marketing, Operations, Settings, WhatsApp Hub) — not in T1 core scope.
3. **Patient360 appointments tab** is a placeholder — a dedicated per-patient appointments endpoint is a post-T1 refinement.
4. **Finance** is read-focused (revenue/sales/alerts) per ADR-004 status-layer; no payment gateway, no invoice issuance UI (matches governance).
5. **Frontend lint** has 21 pre-existing errors in untouched shadcn `components/ui/*` (baseline had 218; frontend was never lint-gated before T1).
6. **WhatsApp unread badge** in AppLayout deferred (needs whatsapp sessions endpoint wiring).

---

## 16. Exact Files Changed

### Backend — created
- `drizzle/0025_s10_auth_lifecycle.sql`
- `src/core/auth/refresh-token.service.ts`
- `src/core/auth/staff-registration.service.ts`
- `src/core/auth/dto/refresh.dto.ts`
- `src/core/auth/dto/register.dto.ts`
- `test/unit/s10-staff-lifecycle.spec.ts`
- `test/integration/s10-auth-lifecycle.spec.ts`

### Backend — modified
- `drizzle/meta/_journal.json`
- `.github/workflows/ci.yml`
- `src/infrastructure/database/schema.ts`
- `src/core/auth/auth.controller.ts`
- `src/core/auth/auth.module.ts`
- `src/core/auth/auth.service.ts`
- `src/modules/administration/administration.module.ts`
- `src/modules/administration/application/administration.service.ts`
- `src/modules/administration/domain/administration-lifecycle.ts`
- `src/modules/administration/presentation/administration.controller.ts`
- `src/modules/appointments/application/appointments.service.ts`
- `src/modules/appointments/infrastructure/appointments.repository.ts`
- `src/modules/appointments/presentation/appointments.controller.ts`
- `src/modules/patients/application/patients.service.ts`
- `src/modules/patients/infrastructure/patients.repository.ts`
- `src/modules/patients/presentation/patients.controller.ts`
- `test/integration/administration.spec.ts` (constructor args)
- `test/integration/auth.spec.ts` (constructor args)
- `test/integration/d1d2.spec.ts` (constructor args)

### Frontend — created
- `app/src/lib/api.ts`
- `app/src/lib/auth.ts`
- `app/src/pages/Register.tsx`

### Frontend — modified
- `app/.env.example`
- `app/package.json` + `package-lock.json`
- `app/vite.config.ts`
- `app/src/App.tsx`
- `app/src/main.tsx`
- `app/src/hooks/useAuth.tsx`
- `app/src/hooks/useBranch.tsx`
- `app/src/components/layout/AppLayout.tsx`
- `app/src/pages/{Login,Administration,Patients,Patient360,Appointments,Clinical,Finance,Reports,Dashboard}.tsx`
- `app/src/pages/{AIManager,Documents,Marketing,Operations,Settings,WhatsAppHub}.tsx` (stubbed)

### Frontend — deleted (prototype data layer)
- `app/api/**` (Hono/tRPC server, 21 files)
- `app/data/medini.db*` (SQLite)
- `app/src/providers/trpc.tsx`

---

## 17. Commit Hash

`3437dac3a57a8c36d9d692e4e378169dba3154b0` — `feat(crm): S10 T1 production frontend integration + user lifecycle`
- Local == origin/main: ✅ verified (`git rev-parse HEAD` == `git rev-parse origin/main`)
- GitHub CI: API returned 404 (private repo — token scope). Push confirmed landed via `git ls-remote`. **Check Actions tab manually** to confirm the migrate loop (now incl. 0025) + 487-test suite are green.

---

**S10 T1 implementation complete. Awaiting ChatGPT S10 T1 Governance Review. HARD STOP — no T2/T3/T4 work, no production deployment, no production migration.**
