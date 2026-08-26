import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { AuditService } from '../../../shared/audit/audit.service';
import { RefreshTokenService } from '../../../core/auth/refresh-token.service';
import { StaffRegistrationService } from '../../../core/auth/staff-registration.service';
import {
  ConflictError, ForbiddenError, NotFoundError, ValidationError,
} from '../../../shared/errors/errors';
import { AdministrationRepository, ADMIN_PAGE_MAX } from '../infrastructure/administration.repository';
import {
  canTransitionStaffStatus, staffCommandTarget, StaffCommand, StaffStatus,
} from '../domain/administration-lifecycle';

const uuid = z.string().uuid();
const page = z.object({
  limit: z.coerce.number().int().min(1).max(ADMIN_PAGE_MAX).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const roleEnum = z.enum(['hq', 'branch_manager', 'branch_admin', 'doctor']);

const inviteInput = z.object({
  name: z.string().trim().min(2).max(256),
  username: z.string().trim().min(3).max(128).regex(/^[a-z0-9_.-]+$/, 'lowercase letters, digits, _ . - only'),
  role: roleEnum,
  branchId: uuid.nullish(),
  email: z.string().trim().email().max(256).nullish(),
  phone: z.string().trim().max(64).nullish(),
  specialization: z.string().trim().max(256).nullish(),
  doctorRef: z.string().trim().max(64).nullish(),
});
const lifecycleInput = z.object({
  reason: z.string().trim().min(2).max(512).optional().default('lifecycle transition'),
}).passthrough();
const assignInput = z.object({
  role: roleEnum,
  branchId: uuid.nullish(),
  reason: z.string().trim().min(2).max(512),
});

/** Single org (approved G1) — single-tenant, org_id reserved. */
const CANONICAL_ORG_ID = '00000000-0000-0000-0000-000000000001';

/**
 * AdministrationService — production governance control plane (Sprint 7 T1).
 * Governs identity, roles, branch assignment and staff lifecycle. It uses the
 * EXISTING S1 identity tables (staff / role_assignments / branches) — it does
 * NOT rebuild identity and introduces NO parallel authorization system.
 *
 * RBAC (canonical matrix): admin = HQ ALL, every other role = NONE. The
 * PermissionGuard enforces this at the route; the service additionally assumes
 * HQ-only for mutations (defense-in-depth). RLS is the DB-layer backstop.
 *
 * Security invariants enforced here:
 *  - Last-HQ protection: the system can never end with zero active HQ admins.
 *  - Self-protection: an actor cannot suspend/deactivate/demote themselves.
 *  - Non-HQ staff must have a branch; HQ staff must have branch = NULL.
 *  - Role assignments are versioned: old → SUPERSEDED, new → ACTIVE (same tx).
 *  - No hard delete: DEACTIVATED is the terminal governance state.
 */
@Injectable()
export class AdministrationService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly repo: AdministrationRepository,
    private readonly audit: AuditService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly registration: StaffRegistrationService,
  ) {}

  private parse<T>(schema: z.ZodType<T>, raw: unknown): T {
    const result = schema.safeParse(raw);
    if (!result.success) throw new ValidationError(Object.fromEntries(result.error.issues.map((x) => [x.path.join('.'), [x.message]])));
    return result.data;
  }
  private auditEvent(p: Principal, action: string, entity: string, id: string, branchId: string | null, before?: Record<string, unknown>, after?: Record<string, unknown>) {
    return { actorId: p.staffId, actorRole: p.role, action, entity, entityId: id, orgId: p.orgId, branchId, source: 'api' as const, before, after };
  }
  /** Administration mutations are HQ-only (matrix: all other roles = NONE). */
  private requireHq(p: Principal) {
    if (p.role !== 'hq') throw new ForbiddenError('Administration is restricted to HQ');
  }
  private pageOf(raw: unknown) {
    const pg = this.parse(page, raw ?? {});
    return { limit: pg.limit ?? 50, offset: pg.offset ?? 0 };
  }

  /* ==========================================================================
     ORGANIZATION + BRANCHES (read surfaces)
     ==========================================================================*/
  async getOrganization(p: Principal) {
    return this.dbCtx.runAs(p, (tx) => this.repo.getOrganization(tx, CANONICAL_ORG_ID));
  }

  async listBranches(p: Principal, orgId?: string) {
    return this.dbCtx.runAs(p, (tx) => this.repo.listBranches(tx, orgId ?? p.orgId));
  }

  /* ==========================================================================
     STAFF — directory + lifecycle
     ==========================================================================*/
  async listStaff(p: Principal, rawQuery: Record<string, unknown>) {
    this.requireHq(p);
    const pg = this.pageOf({ limit: rawQuery.limit, offset: rawQuery.offset });
    const filters = {
      branchId: typeof rawQuery.branchId === 'string' ? rawQuery.branchId : undefined,
      role: typeof rawQuery.role === 'string' ? rawQuery.role : undefined,
      status: typeof rawQuery.status === 'string' ? rawQuery.status : undefined,
    };
    return this.dbCtx.runAs(p, (tx) => this.repo.listStaff(tx, p.orgId, filters, pg.limit, pg.offset));
  }

  /* ---------- S10 T1: HQ invitation link generation ---------- */

  /** Generate a single-use invitation link for an invited staff member.
   *  HQ copies the link and sends it to the staff out-of-band (no email infra).
   *
   *  S10 GLM R3: the link host comes ONLY from server configuration
   *  (APP_PUBLIC_BASE_URL) — never from request headers or body. */
  async generateInviteLink(p: Principal, staffId: string) {
    this.requireHq(p);
    const baseUrl = this.resolvePublicBaseUrl();
    const member = await this.dbCtx.runAs(p, (tx) => this.repo.findStaff(tx, p.orgId, staffId));
    if (!member) throw new NotFoundError('staff', staffId);
    if (member.status !== 'Invited') throw new ConflictError(`Staff is not in Invited status (current: ${member.status})`);

    const { token, expiresAt } = await this.registration.generateInviteToken(p, staffId);
    const inviteLink = `${baseUrl.replace(/\/$/, '')}/register?token=${encodeURIComponent(token)}`;
    await this.audit.record(
      this.auditEvent(p, 'staff_invite_link_generated', 'staff', staffId, member.branchId,
        undefined, { expiresAt: expiresAt.toISOString() }),
    );
    return { inviteLink, expiresAt };
  }

  /** S10 GLM R3: trusted origin allowlist. The invite link base is taken from
   *  APP_PUBLIC_BASE_URL (server-side env) only; anything else is rejected
   *  fail-closed. Defaults to the dev frontend for local runs. */
  private resolvePublicBaseUrl(): string {
    const raw = process.env.APP_PUBLIC_BASE_URL ?? 'http://localhost:5173';
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error('APP_PUBLIC_BASE_URL must be a valid absolute URL (e.g. https://app.medini.example)');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('APP_PUBLIC_BASE_URL must use http(s)');
    }
    return parsed.origin;
  }

  async getStaff(p: Principal, id: string) {
    return this.dbCtx.runAs(p, async (tx) => {
      const row = await this.repo.findStaff(tx, p.orgId, id);
      if (!row) throw new NotFoundError('staff', id);
      return row;
    });
  }

  /** Invite a new staff member → status INVITED (approved G2). No destructive
   * create: username is the immutable natural key (unique per org). */
  async inviteStaff(p: Principal, raw: unknown) {
    this.requireHq(p);
    const input = this.parse(inviteInput, raw);
    this.assertBranchRule(input.role, input.branchId ?? null);
    return this.dbCtx.runAs(p, async (tx) => {
      const existing = await this.repo.findStaffByUsername(tx, p.orgId, input.username.toLowerCase());
      if (existing) throw new ConflictError(`Username '${input.username}' is already taken`);
      const row = await this.repo.createStaff(tx, {
        orgId: p.orgId,
        branchId: input.role === 'hq' ? null : (input.branchId ?? null),
        name: input.name,
        username: input.username.toLowerCase(),
        email: input.email ?? null,
        phone: input.phone ?? null,
        role: input.role,
        status: 'Invited',
        specialization: input.specialization ?? null,
        doctorRef: input.doctorRef ?? null,
        createdBy: p.staffId,
        updatedBy: p.staffId,
      });
      /* Initial role assignment (ACTIVE) — establishes the versioned history. */
      await this.repo.createAssignment(tx, {
        orgId: p.orgId, staffId: row.id, role: input.role,
        branchId: row.branchId, assignedBy: p.staffId,
        createdBy: p.staffId, updatedBy: p.staffId,
      });
      await this.audit.record(
        this.auditEvent(p, 'staff_invited', 'staff', row.id, row.branchId, undefined,
          { username: row.username, role: row.role, branchId: row.branchId }), tx);
      return row;
    });
  }

  /** Lifecycle command: activate / suspend / deactivate / reactivate / approve / reject.
   * Enforces the state machine, self-protection, and last-HQ protection.
   * S10 T1: deactivation also revokes all refresh tokens for the staff member. */
  async transitionStaff(p: Principal, id: string, command: StaffCommand, raw: unknown = {}) {
    this.requireHq(p);
    const input = this.parse(lifecycleInput, raw ?? {});
    const target = staffCommandTarget(command);
    if (p.staffId === id && (command === 'suspend' || command === 'deactivate')) {
      throw new ForbiddenError('You cannot suspend or deactivate your own account');
    }
    return this.dbCtx.runAs(p, async (tx) => {
      const before = await this.repo.lockStaff(tx, p.orgId, id);
      if (!before) throw new NotFoundError('staff', id);
      if (!canTransitionStaffStatus(before.status as StaffStatus, target)) {
        throw new ConflictError(`Illegal lifecycle transition ${before.status} → ${target}`);
      }
      if (before.status === target) return before;

      /* Last-HQ protection: removing/suspending/deactivating an HQ admin must
       * leave at least one OTHER active HQ administrator. N7-2: serialize ALL
       * HQ-availability mutations via a per-org advisory xact lock FIRST so a
       * concurrent suspend/deactivate/demote blocks, then re-evaluates against
       * the committed state (eliminates the TOCTOU race). */
      if (before.role === 'hq' && (target === 'Suspended' || target === 'Deactivated')) {
        await this.repo.acquireHqGovernanceLock(tx, p.orgId);
        const remaining = await this.repo.countActiveHq(tx, p.orgId, before.id);
        if (remaining < 1) {
          throw new ConflictError('Last-HQ protection: cannot leave the system with no active HQ administrator');
        }
      }

      const updated = await this.repo.updateStaff(tx, p.orgId, id, { status: target });
      if (!updated) throw new NotFoundError('staff', id);
      await this.audit.record(
        this.auditEvent(p, `staff_${command}d`, 'staff', id, before.branchId,
          { status: before.status }, { status: target, reason: input.reason }), tx);
      return updated;
    });
  }

  /** S10 T1: HQ approves a Pending staff application → Active. */
  async approveStaff(p: Principal, id: string, raw: unknown = {}) {
    return this.transitionStaff(p, id, 'approve', raw);
  }

  /** S10 T1: HQ rejects a Pending staff application → Rejected. */
  async rejectStaff(p: Principal, id: string, raw: unknown = {}) {
    return this.transitionStaff(p, id, 'reject', raw);
  }

  /** S10 T1: Deactivate + revoke all refresh tokens (session invalidation). */
  async deactivateStaff(p: Principal, id: string, raw: unknown = {}) {
    const result = await this.transitionStaff(p, id, 'deactivate', raw);
    /* Revoke all refresh tokens so the deactivated staff cannot refresh. */
    await this.refreshTokens.revokeAllForStaff(id, p.orgId);
    return result;
  }

  /** Assign a new role/branch — versioned (old SUPERSEDED + new ACTIVE in the
   * same locked transaction). Preserves historical governance state. */
  async assignRole(p: Principal, id: string, raw: unknown) {
    this.requireHq(p);
    const input = this.parse(assignInput, raw);
    this.assertBranchRule(input.role, input.branchId ?? null);
    if (p.staffId === id) throw new ForbiddenError('You cannot change your own role');
    return this.dbCtx.runAs(p, async (tx) => {
      const before = await this.repo.lockStaff(tx, p.orgId, id);
      if (!before) throw new NotFoundError('staff', id);
      const newBranchId = input.role === 'hq' ? null : (input.branchId ?? null);

      /* Last-HQ protection on DEMOTION (hq → non-hq). N7-2: same per-org
       * advisory xact lock serialization before the count. */
      if (before.role === 'hq' && input.role !== 'hq') {
        await this.repo.acquireHqGovernanceLock(tx, p.orgId);
        const remaining = await this.repo.countActiveHq(tx, p.orgId, before.id);
        if (remaining < 1) {
          throw new ConflictError('Last-HQ protection: cannot demote the last active HQ administrator');
        }
      }

      /* Versioned assignment: supersede current ACTIVE, insert new ACTIVE. */
      const prev = await this.repo.activeAssignment(tx, p.orgId, id);
      await this.repo.supersedeActiveAssignment(tx, p.orgId, id);
      const assignment = await this.repo.createAssignment(tx, {
        orgId: p.orgId, staffId: id, role: input.role,
        branchId: newBranchId, assignedBy: p.staffId,
        createdBy: p.staffId, updatedBy: p.staffId,
      });
      const updated = await this.repo.updateStaff(tx, p.orgId, id, {
        role: input.role, branchId: newBranchId,
      });
      if (!updated) throw new NotFoundError('staff', id);
      await this.audit.record(
        this.auditEvent(p, 'staff_role_assigned', 'staff', id, newBranchId,
          { role: before.role, branchId: before.branchId },
          { role: input.role, branchId: newBranchId, reason: input.reason, previousAssignmentId: prev?.id ?? null }), tx);
      return { staff: updated, assignment };
    });
  }

  /** Role assignment history (versioned audit surface). */
  async getRoleHistory(p: Principal, id: string) {
    return this.dbCtx.runAs(p, async (tx) => {
      const member = await this.repo.findStaff(tx, p.orgId, id);
      if (!member) throw new NotFoundError('staff', id);
      return this.repo.listAssignmentHistory(tx, p.orgId, id);
    });
  }

  /* ---------- helpers ---------- */
  private assertBranchRule(role: string, branchId: string | null) {
    if (role === 'hq' && branchId != null) {
      throw new ValidationError({ branchId: ['HQ staff must not be assigned a branch'] });
    }
    if (role !== 'hq' && branchId == null) {
      throw new ValidationError({ branchId: ['Non-HQ staff must be assigned a branch'] });
    }
  }
}
