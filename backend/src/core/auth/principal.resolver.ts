import { Injectable, Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DATABASE } from '../../infrastructure/database/database.module';
import { Database } from '../../infrastructure/database/database';
import { staff, roleAssignments } from '../../infrastructure/database/schema';
import { Principal } from './principal';

/**
 * PrincipalResolver — builds the trusted Principal from DATABASE state, NOT
 * from the JWT or the client. The token only carries `sub` (staff id); the
 * effective role/branch/doctor are re-derived from the authoritative
 * role_assignments (+ staff) tables on every request.
 *
 * This guarantees:
 *  - a forged/stale role claim in the JWT cannot elevate privileges
 *  - a client cannot submit its own role/branch/doctor and be trusted
 *  - a deactivated/suspended staff member stops resolving (fails closed)
 */
@Injectable()
export class PrincipalResolver {
  constructor(@Inject(DATABASE) private readonly db: Database | null) {}

  /**
   * Resolve the Principal for an authenticated staff id.
   * Returns null when the staff member is missing, inactive, or has no ACTIVE
   * role assignment — callers treat null as 401 (fail-closed).
   */
  async resolve(staffId: string, orgId: string): Promise<Principal | null> {
    if (!this.db) return null;

    const staffRows = await this.db
      .select()
      .from(staff)
      .where(and(eq(staff.id, staffId), eq(staff.orgId, orgId)))
      .limit(1);
    const member = staffRows[0];
    if (!member) return null;

    /* Account status enforcement (Part 15): only Active staff may authenticate. */
    if (member.status !== 'Active') return null;
    if (member.deletedAt) return null;

    /* Effective role from the authoritative ACTIVE role assignment. */
    const raRows = await this.db
      .select()
      .from(roleAssignments)
      .where(and(eq(roleAssignments.staffId, member.id), eq(roleAssignments.status, 'ACTIVE')))
      .limit(1);
    const ra = raRows[0];

    /* Sprint 2 remediation #4: doctorId must be the STAFF UUID (staff.id) —
     * appointments.doctor_id references staff(id). doctorRef is only a
     * display reference ("dr-aina"), NOT the FK — comparing it against the
     * UUID column made doctor own-scope permanently 403. */
    const role = (ra?.role ?? member.role) as string;
    const branchId = (ra?.branchId ?? member.branchId) as string | null;

    return {
      staffId: member.id,
      username: member.username,
      role,
      orgId: member.orgId,
      branchId,
      doctorId: role === 'doctor' ? member.id : null,
    };
  }
}
