import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  organizations, staff, roleAssignments, branches,
  Organization, Staff, RoleAssignment, Branch,
} from '../../../infrastructure/database/schema';
import { DbClient } from '../../patients/infrastructure/patients.repository';
import { toDomainError } from '../../../shared/errors/pg-error';

export const ADMIN_PAGE_MAX = 100;

/* Tier 2 (T2-B / FAMILY-4): the staff READ surface NEVER selects
 * password_hash, mfa_secret, or invite_token. Authentication internals read
 * those columns through their own dedicated auth queries (PrincipalResolver /
 * PasswordService / StaffRegistrationService), NOT through this admin repo.
 * Selecting them here would carry credentials into DTO/API responses. */
const STAFF_READ_COLS = {
  id: staff.id,
  orgId: staff.orgId,
  branchId: staff.branchId,
  name: staff.name,
  username: staff.username,
  email: staff.email,
  phone: staff.phone,
  role: staff.role,
  status: staff.status,
  specialization: staff.specialization,
  doctorRef: staff.doctorRef,
  mfaEnabled: staff.mfaEnabled,
  createdAt: staff.createdAt,
  updatedAt: staff.updatedAt,
  createdBy: staff.createdBy,
  updatedBy: staff.updatedBy,
  deletedAt: staff.deletedAt,
} as const;
/** Public staff record (credentials stripped by construction). */
export type StaffRead = {
  [K in keyof typeof STAFF_READ_COLS]: (typeof STAFF_READ_COLS)[K] extends { _: { data: infer D } } ? D : never;
};

/**
 * AdministrationRepository — data access for the governance plane (S7 T1).
 * Reads/writes the EXISTING S1 identity tables (staff, role_assignments,
 * branches) plus the new organizations record. No duplicate identity store.
 * All methods take the caller's transaction (inside DbContextService.runAs →
 * RLS context applies). Append-only history is preserved (no in-place edit of
 * role_assignments beyond status SUPERSEDE in the same transaction).
 */
@Injectable()
export class AdministrationRepository {
  /* ---------- organizations ---------- */
  async getOrganization(tx: DbClient, id: string): Promise<Organization | null> {
    const rows = await tx.select().from(organizations).where(eq(organizations.id, id)).limit(1);
    return rows[0] ?? null;
  }

  /* ---------- branches (read surface for Administration) ---------- */
  async listBranches(tx: DbClient, orgId: string): Promise<Branch[]> {
    return tx.select().from(branches)
      .where(and(eq(branches.orgId, orgId), isNull(branches.deletedAt)))
      .orderBy(asc(branches.code));
  }

  /* ---------- staff ---------- */
  async createStaff(tx: DbClient, values: typeof staff.$inferInsert): Promise<Staff> {
    try {
      return (await tx.insert(staff).values(values).returning())[0]!;
    } catch (e) { throw toDomainError(e); }
  }

  async findStaff(tx: DbClient, orgId: string, id: string): Promise<StaffRead | null> {
    const rows = await tx.select(STAFF_READ_COLS).from(staff)
      .where(and(eq(staff.orgId, orgId), eq(staff.id, id), isNull(staff.deletedAt)))
      .limit(1);
    return (rows[0] as StaffRead | undefined) ?? null;
  }

  async findStaffByUsername(tx: DbClient, orgId: string, username: string): Promise<StaffRead | null> {
    const rows = await tx.select(STAFF_READ_COLS).from(staff)
      .where(and(eq(staff.orgId, orgId), eq(staff.username, username), isNull(staff.deletedAt)))
      .limit(1);
    return (rows[0] as StaffRead | undefined) ?? null;
  }

  /** Transaction-scoped row lock for lifecycle/concurrency-critical mutations. */
  async lockStaff(tx: DbClient, orgId: string, id: string): Promise<StaffRead | null> {
    const rows = await tx.select({ lock: sql`1` }).from(staff)
      .where(and(eq(staff.orgId, orgId), eq(staff.id, id), isNull(staff.deletedAt)))
      .for('update');
    if (rows.length === 0) return null;
    return this.findStaff(tx, orgId, id);
  }

  async listStaff(
    tx: DbClient, orgId: string,
    filters: { branchId?: string | null; role?: string; status?: string },
    limit: number, offset: number,
  ): Promise<StaffRead[]> {
    const conds = [eq(staff.orgId, orgId), isNull(staff.deletedAt)];
    if (filters.branchId) conds.push(eq(staff.branchId, filters.branchId));
    if (filters.role) conds.push(eq(staff.role, filters.role as never));
    if (filters.status) conds.push(eq(staff.status, filters.status as never));
    const rows = await tx.select(STAFF_READ_COLS).from(staff).where(and(...conds))
      .orderBy(asc(staff.username)).limit(limit).offset(offset);
    return rows as StaffRead[];
  }

  async updateStaff(tx: DbClient, orgId: string, id: string, set: Record<string, unknown>): Promise<Staff | null> {
    const rows = await tx.update(staff)
      .set({ ...set, updatedAt: new Date() } as never)
      .where(and(eq(staff.orgId, orgId), eq(staff.id, id), isNull(staff.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  /**
   * N7-2 remediation — deterministic per-organization advisory lock that
   * serializes ALL HQ-availability mutations (suspend/deactivate/demote of an
   * HQ admin). pg_advisory_xact_lock is:
   *  - transaction-scoped (auto-released at COMMIT/ROLLBACK — no leak),
   *  - database-level (works across multiple service instances, unlike an
   *    application mutex),
   *  - deterministic per org (hashtext(org_id) — same org always same key).
   * Any concurrent last-HQ mutation blocks here until the first transaction
   * commits, then re-evaluates countActiveHq() against the NEW committed
   * state — eliminating the TOCTOU race (GLM barrier-race finding).
   */
  async acquireHqGovernanceLock(tx: DbClient, orgId: string): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('medini-hq-governance:' || ${orgId}))`);
  }

  /** Count HQ staff whose status is EXACTLY 'Active' (N7-1 remediation: a
   * Suspended HQ is NOT an active HQ — otherwise two sequential suspensions
   * could leave the org with zero ACTIVE HQ administrators). Used by last-HQ
   * protection INSIDE the same locked transaction. */
  async countActiveHq(tx: DbClient, orgId: string, excludeStaffId?: string): Promise<number> {
    const conds = [
      eq(staff.orgId, orgId), eq(staff.role, 'hq' as never),
      isNull(staff.deletedAt), eq(staff.status, 'Active' as never),
    ];
    if (excludeStaffId) conds.push(sql`${staff.id} <> ${excludeStaffId}`);
    const rows = await tx.select({ n: sql<number>`count(*)::int` }).from(staff).where(and(...conds));
    return rows[0]?.n ?? 0;
  }

  /* ---------- role assignments (versioned, append-oriented) ---------- */
  async activeAssignment(tx: DbClient, orgId: string, staffId: string): Promise<RoleAssignment | null> {
    const rows = await tx.select().from(roleAssignments)
      .where(and(
        eq(roleAssignments.orgId, orgId), eq(roleAssignments.staffId, staffId),
        eq(roleAssignments.status, 'ACTIVE'),
      ))
      .limit(1);
    return rows[0] ?? null;
  }

  async listAssignmentHistory(tx: DbClient, orgId: string, staffId: string): Promise<RoleAssignment[]> {
    return tx.select().from(roleAssignments)
      .where(and(eq(roleAssignments.orgId, orgId), eq(roleAssignments.staffId, staffId)))
      .orderBy(desc(roleAssignments.effectiveFrom), desc(roleAssignments.createdAt))
      .limit(ADMIN_PAGE_MAX);
  }

  /** Supersede the current ACTIVE assignment (same locked transaction). */
  async supersedeActiveAssignment(tx: DbClient, orgId: string, staffId: string): Promise<void> {
    await tx.update(roleAssignments)
      .set({ status: 'SUPERSEDED', updatedAt: new Date() } as never)
      .where(and(
        eq(roleAssignments.orgId, orgId), eq(roleAssignments.staffId, staffId),
        eq(roleAssignments.status, 'ACTIVE'),
      ));
  }

  async createAssignment(tx: DbClient, values: typeof roleAssignments.$inferInsert): Promise<RoleAssignment> {
    try {
      return (await tx.insert(roleAssignments).values(values).returning())[0]!;
    } catch (e) { throw toDomainError(e); }
  }
}
