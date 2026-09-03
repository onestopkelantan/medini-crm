import { Injectable, Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DATABASE } from '../../infrastructure/database/database.module';
import { Database } from '../../infrastructure/database/database';
import { staff, roleAssignments } from '../../infrastructure/database/schema';
import { Principal } from './principal';

@Injectable()
export class PrincipalResolver {
  constructor(@Inject(DATABASE) private readonly db: Database | null) {}

  async resolve(staffId: string, orgId: string): Promise<Principal | null> {
    if (!this.db) return null;

    const staffRows = await this.db
      .select()
      .from(staff)
      .where(and(eq(staff.id, staffId), eq(staff.orgId, orgId)))
      .limit(1);

    const member = staffRows[0];

    if (!member) return null;
    if (member.status !== 'Active') return null;
    if (member.deletedAt) return null;

    const raRows = await this.db
      .select()
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.staffId, member.id),
          eq(roleAssignments.status, 'ACTIVE'),
        ),
      )
      .limit(1);

    const ra = raRows[0];

    const role = (ra?.role ?? member.role) as string;
    const branchId = (ra?.branchId ?? member.branchId) as string | null;

    return {
      staffId: member.id,
      name: member.name,
      username: member.username,
      role,
      orgId: member.orgId,
      branchId,
      doctorId: role === 'doctor' ? member.id : null,
    };
  }
}