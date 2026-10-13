# ADMINISTRATION DOMAIN — ARCHITECTURE LOCK v1.0

**Status:** LOCKED · **Phase:** Blueprint Lock Program — Phase 1 (Group A: System Foundation)
**Date:** 13 August 2026 · **Author:** Neo (Senior Architect)
**Baseline:** Dashboard Phase 1–7, Patient 360, Appointment v2, Domain 3, Marketing, Finance v1.2 (semua locked)

---

## 1. Business Purpose

Administration menjawab soalan paling asas dalam MediniOne:

> **SIAPA boleh akses APA, DI MANA, dan di bawah ROLE yang mana?**

Domain ini ialah governance core — setiap domain lain (Patients, Appointments, Clinical, Finance, Marketing, WhatsApp Hub, AI Manager, Reports, Operations) bergantung pada keputusan access yang Administration definisikan. Kalau Administration goyang, semua domain lain bergantung pada assumption yang tak stabil.

## 2. Domain Scope

**DALAM scope:**
- Struktur organisasi: Medini Dental Group → branches → affiliated clinics
- Staff/user records dan lifecycle mereka
- Roles dan permission matrix
- Role assignment kepada staff
- Branch scope dan data scope
- RBAC governance (siapa boleh ubah akses siapa)
- Audit akses dan perubahan governance

**LUAR scope:**
- Authentication mechanics (password hashing, session token) — itu infrastructure, direkodkan sebagai dependency
- Branch operational data (chairs, schedule) — Operations domain
- Staff payroll — Finance domain (payout/commission sahaja)
- Integration credentials — Settings domain (secrets boundary)

## 3. Domain Boundary

| Benda | Pemilik | Bukan Administration sebab |
|---|---|---|
| User account + role assignment | **Administration** | — |
| Permission matrix (module × action × role) | **Administration** | — |
| Password hash + session | Infrastructure (auth.ts) | Mechanics, bukan governance |
| Chair/room milik branch | Operations | Operational asset |
| Doctor commission | Finance | Financial computation |
| Staff leave/payroll | Future HR (bukan scope sekarang) | Bukan domain rasmi menu |
| API key/secrets | Settings (secret config) | Configuration, bukan governance |

## 4. Responsibilities

1. Menyimpan struktur organisasi canonical (14 branches = 10 main + 4 affiliated)
2. Menyimpan staff records dengan role dan branch assignment
3. Mendefinisikan permission matrix tunggal (single permission truth)
4. Menguruskan user lifecycle (create → active → suspend → deactivate → reactivate)
5. Menjadi rujukan RBAC untuk semua domain lain
6. Merekod semua perubahan governance dalam audit log
7. Memastikan financial truth isolation (hanya HQ + Branch Manager)

## 5. Subdomains / Modules

| Module | Fungsi |
|---|---|
| Organization Structure | Group HQ, branches, affiliated clinics |
| Staff Directory | Senarai staff, carian, filter branch/role |
| Role Management | Definisi role, permission matrix view |
| Access Assignment | Assign role + branch kepada staff |
| Access Matrix | Visual matrix module × role (read untuk semua HQ) |
| Governance Audit | Log perubahan user/role/branch |

## 6. Entities

| Entity | Medan utama | Nota |
|---|---|---|
| `Organization` | id, name, registrationNo, hqAddress | Satu sahaja (Medini Dental Group) |
| `Branch` | id, code, name, city, phone, address, type (main/affiliated), isActive | 14 canonical |
| `Staff` (User) | id, branchId, role, name, username, email, phone, passwordHash, specialization, title, isActive, lastLoginAt | Sudah wujud dalam schema.ts |
| `Role` | code (hq/branch_manager/branch_admin/doctor), label, description | Static enum — 4 roles sahaja |
| `Permission` | module, action, role | Derived dari permissionMatrix — single truth |
| `RoleAssignment` | userId, role, branchId, effectiveFrom, effectiveTo, assignedBy, reason | Versioned — historical protection |
| `AccessAudit` | siapa ubah apa, bila, kenapa | Immutable |

**Sudah wujud dalam app/db/schema.ts:** `branches`, `users`, `roles` enum, `auditLogs`.
**Baru (blueprint):** `RoleAssignment` versioned, `Organization` record, `Permission` sebagai view dari matrix.

## 7. Entity Relationships

```
Organization (1) ──< (n) Branch
Branch (1) ──< (n) Staff
Staff (1) ──< (n) RoleAssignment
Role (1) ──< (n) RoleAssignment
Role (1) ──< (n) Permission  (via permissionMatrix)
Staff (1) ──< (n) AccessAudit  (actor & subject)
```

**Rule:** HQ staff `branchId = null` (akses semua branch). Non-HQ `branchId` WAJIB ada.

## 8. State Machines / Lifecycles

### User lifecycle
```
INVITED → ACTIVE → SUSPENDED → ACTIVE
                ↘ DEACTIVATED ↗ (reactivate oleh HQ sahaja)
```
- INVITED: account dibuat, belum login
- ACTIVE: boleh login
- SUSPENDED: sementara block (audit wajib ada reason)
- DEACTIVATED: kekal off; record kekal (historical), tidak delete

### Branch lifecycle
```
PLANNED → ACTIVE → DORMANT → CLOSED
```
- Affiliate boleh dinaik taraf jadi main hanya oleh HQ (canonical count berubah — mesti audit + review semua laporan)

### RoleAssignment lifecycle
```
ACTIVE → SUPERSEDED (bila role/branch baru diassign)
       → REVOKED
```
Tiada edit — setiap perubahan = record baru (versioned).

## 9. Business Rules

1. **Canonical branch count = 14** (10 main + 4 affiliated). Tak boleh ubah tanpa HQ action + audit.
2. **4 roles sahaja**: `hq`, `branch_manager`, `branch_admin`, `doctor`. Tiada custom role dalam v1.
3. **HQ sahaja** boleh: create/edit/suspend/deactivate user, assign role, ubah branch type, ubah permission matrix.
4. **Branch Manager** boleh view staff own branch, TAK boleh ubah role atau tambah user.
5. **branch_admin (Receptionist)** dan **doctor** langsung tak nampak Administration page.
6. Staff tak boleh ubah role sendiri. HQ tak boleh deactivate diri sendiri (last-HQ protection — sekurang-kurangnya 1 HQ aktif mesti kekal).
7. Financial truth isolation: hanya `hq` + `branch_manager` boleh terima financial aggregates (dah enforced server-side dalam auth.ts — `stripFinancialFields`).
8. Username immutable selepas create. Email/phone boleh edit dengan audit.
9. Delete user = TIDAK wujud. Hanya deactivate. Semua historical data mesti traceable ke user.
10. Affiliate clinic TIDAK dikira dalam "All Branches (14)" — separated dalam dashboard & reports.

## 10. RBAC / Permission Model

Single permission truth — `app/api/auth.ts` `permissionMatrix` (13 modules × 8 actions × 4 roles). Administration **own** matrix ini.

| Module | HQ | Branch Manager | Branch Admin | Doctor |
|---|---|---|---|---|
| administration | ALL | — | — | — |
| settings | ALL | view/edit | view | view |
| finance | ALL | view/create/edit/approve/export/print | — | — |
| reports | view/export/print | view/export/print | — | — |
| marketing | ALL | view | — | — |
| patients | ALL | semua kecuali delete | view/create/edit/print | view |
| appointments | ALL | ALL | view/create/edit/print/assign | view |
| clinical | ALL kecuali create/edit (doctor) | view | — | view/create/edit/print |
| documents | ALL | view/create/edit/export/print | view/create | view/create/print |
| operations | ALL | view/create/edit/approve/print/assign | view | — |
| whatsapp | ALL | view/create/edit/assign | view/create/edit | — |
| ai | ALL | view | view | view |
| dashboard | ALL | view/export/print | view | view |

Matrix ini adalah SOURCE OF TRUTH. UI sembunyikan = cosmetics; server enforce = security.

## 11. Branch / Data Scope

| Role | Scope |
|---|---|
| HQ | Semua 14 branches + affiliates; `scopeBranch()` return requested/null |
| Branch Manager | Own branch sahaja — server force `user.branchId` |
| Branch Admin | Own branch sahaja |
| Doctor | Own branch + own doctor scope (`doctorId = self` enforced) |

Cross-branch forge = BLOCKED di state layer + server (dah verified: attack tests 17/17 PASS).

## 12. Cross-Domain Dependencies

| Administration perlukan | Administration berikan kepada |
|---|---|
| Infrastructure auth (session, hashing) | Semua domain: RBAC decisions, branch scope, staff identity |
| — | Finance: approver identity, commission recipient |
| — | Clinical: doctor identity & specialization |
| — | WhatsApp Hub: assignment kepada staff |
| — | AI Manager: siapa approve AI actions |
| — | Reports: role scope untuk aggregation |
| — | Operations: task assignee |

## 13. Events Produced

- `staff.created`, `staff.updated`, `staff.suspended`, `staff.deactivated`, `staff.reactivated`
- `role.assigned`, `role.revoked`, `role.changed`
- `branch.created`, `branch.activated`, `branch.dormant`, `branch.closed`, `branch.type_changed`
- `permission.matrix_updated` (rare, HQ only)
- `access.login`, `access.login_failed`, `access.denied`

## 14. Events Consumed

- `auth.session_created` (infrastructure) → update lastLoginAt
- Finance/Clinical hanya CONSUME staff identity — tak emit apa yang Administration perlu consume

## 15. Actions / Commands

| Command | Actor | Gate |
|---|---|---|
| Create staff | HQ | Username unique, role valid, branch wajib kalau non-HQ |
| Edit staff profile | HQ (any) / self (own profile: phone/email sahaja) | Audit |
| Suspend / deactivate / reactivate | HQ | Reason wajib; last-HQ protection |
| Assign role + branch | HQ | New RoleAssignment record; old → SUPERSEDED |
| Reset password | HQ | Audit; user forced change on next login |
| Create branch | HQ | Code unique; canonical count review kalau type=main |
| Change branch status/type | HQ | Audit + dashboard impact warning |
| View access matrix | HQ | Read-only |
| View governance audit | HQ | Filter by staff/module/date |

## 16. Audit Requirements

IMMUTABLE audit untuk: create/edit/suspend/deactivate/reactivate user, role assignment changes, branch changes, permission matrix changes, login failures, access denied events.
Setiap entry: actor, action, entity, entityId, before→after, reason, timestamp, branchId.
Audit TIDAK boleh diedit atau dipadam oleh sesiapa, termasuk HQ.

## 17. Notification Requirements

- Staff baru → notification ke HQ (audit feed)
- Suspended/deactivated → notification ke HQ feed; (future: email/WhatsApp — domain WhatsApp Hub consume `staff.deactivated`)
- Login failed berturut (≥3) → security alert dalam dashboard HQ
- Branch type change → warning ke HQ: dashboard & reports aggregation berubah

## 18. Search Requirements

Staff search: nama, username, email, phone, role, branch, status.
Branch search: code, name, city, type, status.
Audit search: actor, entity, action, date range.
Semua search HQ-only dalam page ini.

## 19. AI Interaction Boundaries

| AI boleh | AI TIDAK boleh |
|---|---|
| READ staff list, branch structure, permission matrix | Create/edit/suspend user |
| RECOMMEND (cth: "Staff X tiada login 90 hari — suspend?") | Assign/ubah role |
| DRAFT reason untuk suspension | Approve apa-apa perubahan governance |
| — | EXECUTE sebarang administration command |

Administration = **HUMAN-ONLY EXECUTE**. AI hanya READ + RECOMMEND.

## 20. Reporting / Analytics Implications

Administration produce canonical facts:
- `staff_count` by branch/role/status
- `branch_count` = 14 canonical (main only)
- `active_users`, `dormant_users`
- Governance activity counts (untuk compliance report)

Reports domain WAJIB consume dari sini — tak boleh kira staff/branch sendiri.

## 21. UX / Workspace Architecture

Page: **Administration** (System section dalam nav).
3 tabs (prototype sudah ada):
1. **Branches** — main branches table + affiliated clinics table (separated, dengan status)
2. **Staff & Roles** — staff table (name, role, branch, email, status) + actions
3. **Access Matrix** — module × role visual matrix (Owner/Manager/Dentist/Receptionist)

Penambahan blueprint: staff detail drawer (profile + role history + audit), suspend/deactivate dialog dengan reason wajib, add-staff form, governance audit tab.

## 22. Prototype Implementation Requirements

SUDAH ADA dalam `CURRENT-MEDINI-REVIEW.html` (`#page-admin`):
- 3-tab structure ✅
- Branches table (14 main, separated affiliates) ✅
- Staff table ✅
- Access Matrix table ✅

PERLU DITAMBAH/UPGRADE (prototype phase ini):
- Add Staff form (HQ only) — functional
- Staff detail drawer dengan RoleAssignment history
- Suspend/Deactivate dengan reason wajib — functional
- Last-HQ protection (tak boleh deactivate HQ terakhir)
- Branch status toggle dengan audit — functional
- Governance audit trail view
- Semua buttons functional (ikut standard kau — butang mesti jalan)

## 23. Smoke Test Requirements

A-01..A-25 minimum:
- Admin page renders, 3 tabs switch
- Branch table = 14 main, affiliates separated
- Staff table renders roles betul
- Add staff: create muncul dalam table (validation: duplicate username rejected, non-HQ wajib branch)
- Edit staff + audit
- Suspend dengan reason → status bertukar + audit
- Deactivate → login blocked (state layer)
- Last-HQ protection blocked
- Role assign → history record baru, lama SUPERSEDED
- Non-HQ langsung tak boleh buka page (state layer)
- Manager tak boleh create user (blocked)
- Access matrix renders 13 modules
- Audit trail records semua governance actions
- Case-insensitive assertions (ikut gotcha established)
- Existing 534 tests kekal PASS

## 24. Production Backend Implications

Blueprint ini map bersih kepada:
- Schema: `organizations`, `branches` (+type column), `users`, `role_assignments` (versioned), `audit_logs` (existing)
- tRPC router: `administration.ts` — procedures gated `roleProc(["hq"])`
- Permission: guna `permissionMatrix` existing — Administration own file ini
- Worker: tiada worker needed untuk domain ini (pure request/response)
- Migration path: seed 4 demo users + 14 branches + matrix → production seed sama

Tiada redesign needed — schema.ts existing dah 80% aligned.

## 25. Risks / Open Decisions

| Risk / Decision | Status |
|---|---|
| Custom roles (contoh: "Senior Doctor") | DEFER — v1 static 4 roles; v2 boleh custom |
| Affiliate → main promotion flow | DECIDED — HQ action + audit + reports warning |
| Staff self-service profile edit | DECIDED — phone/email sahaja, dengan audit |
| Multi-branch assignment (1 staff 2 branch) | DEFER — v1 satu staff satu branch |
| Emergency access (break-glass) | DEFER — production phase |
| Session management UI (force logout) | OPEN — masuk Phase 2 (Settings security) atau kekal sini — decide masa Phase 8 consolidation |

---

## DOMAIN CONTRACT — ADMINISTRATION

**OWNS:** Organization, Branch, Staff/User, Role, Permission matrix, RoleAssignment, governance audit.
**SOURCE OF TRUTH:** `permissionMatrix` (auth.ts), `users`, `branches` tables.
**CONSUMES:** `auth.session_created`.
**PRODUCES:** staff/role/branch/access events kepada semua domain.
**COMMANDS:** create/edit/suspend/deactivate/reactivate staff, assign role, manage branch, reset password.
**AUDIT:** Semua governance changes immutable.
**AI:** READ + RECOMMEND sahaja. EXECUTE = human HQ only.

## LOCK GATE CHECKLIST

- [x] 25 gates documented
- [x] Domain contract clear (ownership tidak overlap dengan domain lain)
- [x] RBAC single truth identified
- [x] Branch canonical 14 preserved
- [x] Prototype existing audited
- [x] Production path no-redesign
- [x] Tiada top-level domain baru diperkenalkan

**LOCK GATE: PASS (architecture)** — prototype upgrade + smoke tests dalam sesi ini sebelum declare final LOCKED.
