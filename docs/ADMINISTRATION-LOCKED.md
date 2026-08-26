# ADMINISTRATION DOMAIN — LOCKED

**Locked:** 13 August 2026 · **Blueprint Lock Program Phase 1 (Group A: System Foundation)**
**Authority:** docs/ADMINISTRATION-ARCHITECTURE.md

---

## PHASE: 1 — Administration Domain Lock
## STATUS: ✅ LOCKED

## OBJECTIVES:
- Define who can access what, where, under which role
- Lock organization structure (Group → 14 branches → affiliates)
- Lock user lifecycle (create → active → suspend → deactivate → reactivate)
- Lock single permission truth (13 modules × 8 actions × 4 roles)
- Lock versioned role assignment (no edit, new record supersedes)
- Lock governance audit (immutable)
- Lock last-HQ protection, self-action protection, username immutability
- No delete — deactivate only, records preserved

## COMPLETED:
- [x] Architecture document (25 gates) — ADMINISTRATION-ARCHITECTURE.md
- [x] Domain contract (OWNS/CONSUMES/PRODUCES/COMMANDS/AUDIT)
- [x] Prototype upgrade — ADM state engine, all buttons functional
- [x] Add Staff (validation: unique username, branch required for non-HQ)
- [x] Staff detail drawer with role history
- [x] Suspend with mandatory reason
- [x] Deactivate with mandatory reason, record preserved
- [x] Reactivate
- [x] Assign Role with versioned history (old SUPERSEDED)
- [x] Last-HQ protection (cannot suspend/deactivate/demote last active HQ)
- [x] Self-deactivate and self-role-change blocked
- [x] Governance Audit tab (4th tab)
- [x] Access Matrix 13 modules
- [x] Canonical 14 branches + separated affiliates preserved

## ARCHITECTURE DECISIONS:
- 4 static roles (hq, branch_manager, branch_admin, doctor); custom roles deferred to v2
- Single permission truth = permissionMatrix in auth.ts; Administration owns it
- 1 staff = 1 branch in v1; multi-branch deferred
- RoleAssignment versioned; no in-place edit
- AI boundary: READ + RECOMMEND only; EXECUTE = human HQ only
- Session management UI decision deferred to Phase 8 consolidation

## DOMAIN CONTRACT:
- OWNS: Organization, Branch, Staff/User, Role, Permission matrix, RoleAssignment, governance audit
- SOURCE OF TRUTH: permissionMatrix, users, branches
- CONSUMES: auth.session_created
- PRODUCES: staff/role/branch/access events to all domains
- COMMANDS: create/edit/suspend/deactivate/reactivate staff, assign role, manage branch, reset password
- AUDIT: all governance changes immutable

## ENTITIES:
Organization, Branch, Staff (User), Role, Permission, RoleAssignment, AccessAudit

## LIFECYCLES:
- User: INVITED → ACTIVE → SUSPENDED → ACTIVE / DEACTIVATED
- Branch: PLANNED → ACTIVE → DORMANT → CLOSED
- RoleAssignment: ACTIVE → SUPERSEDED / REVOKED

## RBAC:
- Administration: HQ only (view/create/edit/delete/approve/export/assign)
- Manager: no admin access
- branch_admin / doctor: no admin access
- Financial truth isolation preserved (hq + branch_manager only)

## CROSS-DOMAIN DEPENDENCIES:
- Consumes: infrastructure auth
- Produces to: Finance (approver, payee), Clinical (doctor identity), WhatsApp Hub (assignee), AI Manager (approver), Reports (role scope), Operations (task assignee)

## EVENTS:
staff.created/updated/suspended/deactivated/reactivated, role.assigned/revoked/changed, branch.*, access.login/denied

## AUDIT:
admAudit — immutable, max 50 in-memory prototype, includes actor/action/detail/timestamp

## PROTOTYPE:
- CURRENT-MEDINI-REVIEW.html `#page-admin` upgraded
- root = app/reviews byte-identical (MD5 verified)

## TESTS:
- A-01..A-25: **25/25 PASS**
- Full suite: **559/559 PASS** (534 existing + 25 new)
- Zero JS errors

## RISKS:
- Custom roles needed later (v2) — documented
- Multi-branch staff assignment — deferred
- Emergency break-glass access — deferred to production phase

## OPEN DECISIONS:
- Session management UI placement (Settings vs Administration) — Phase 8

## LOCK GATE: ✅ PASS

## NEXT PHASE:
Phase 2 — Settings Domain Lock (Group A continuation)
