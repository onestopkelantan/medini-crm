import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { DbContextService } from '../../../core/auth/db-context.service';
import { PasswordService } from '../../../core/auth/password.service';
import { Principal } from '../../../core/auth/principal';
import { ConflictError, ForbiddenError, ValidationError } from '../../../shared/errors/errors';

const inputSchema = z.object({
  name: z.string().trim().min(2).max(256),
  username: z.string().trim().min(3).max(128).regex(/^[a-z0-9_.-]+$/),
  password: z.string().min(8).max(128),
  role: z.enum(['doctor', 'branch_admin']).default('doctor'),
  email: z.string().trim().email().max(256).nullish(),
  phone: z.string().trim().max(64).nullish(),
  specialization: z.string().trim().max(256).nullish(),
  doctorRef: z.string().trim().max(64).nullish(),
});

@Injectable()
export class DoctorRegistrationService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly passwords: PasswordService,
  ) {}

  async list(principal: Principal) {
    if (principal.role !== 'branch_manager' || !principal.branchId) {
      throw new ForbiddenError('Only branch manager can view branch staff');
    }
    return this.dbCtx.runAs(principal, async (tx) => {
      const result = await tx.execute(sql`
        SELECT id, name, username, email, phone, role, status, branch_id AS "branchId"
        FROM staff
        WHERE org_id = ${principal.orgId}
          AND branch_id = ${principal.branchId}
          AND deleted_at IS NULL
        ORDER BY name
      `);
      return (result as any).rows ?? [];
    });
  }

  async register(principal: Principal, raw: unknown) {
    if (principal.role !== 'branch_manager') {
      throw new ForbiddenError('Only branch manager can register a doctor');
    }
    if (!principal.branchId) {
      throw new ForbiddenError('No branch context — access denied');
    }

    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])),
      );
    }

    const input = parsed.data;
    const branchId = principal.branchId;
    const passwordHash = await this.passwords.hash(input.password);

    return this.dbCtx.runAs(principal, async (tx) => {
      const existing = await tx.execute(sql`SELECT id FROM staff WHERE org_id = ${principal.orgId} AND username = ${input.username.toLowerCase()} AND deleted_at IS NULL LIMIT 1`);
      if ((existing as any).rows?.length) throw new ConflictError(`Username '${input.username}' is already taken`);

      const staff = await tx.execute(sql`
        INSERT INTO staff (org_id, branch_id, name, username, email, phone, role, status, specialization, doctor_ref, password_hash, created_by, updated_by)
        VALUES (${principal.orgId}, ${branchId}, ${input.name}, ${input.username.toLowerCase()}, ${input.email ?? null}, ${input.phone ?? null}, ${input.role}, 'Active', ${input.specialization ?? null}, ${input.doctorRef ?? null}, ${passwordHash}, ${principal.staffId}, ${principal.staffId})
        RETURNING id, name, username, email, phone, role, status, branch_id AS "branchId"
      `);
      const row = (staff as any).rows?.[0];
      if (!row) throw new ConflictError('Doctor registration failed');

      await tx.execute(sql`
        INSERT INTO role_assignments (org_id, staff_id, role, branch_id, status, assigned_by, created_by, updated_by)
        VALUES (${principal.orgId}, ${row.id}, ${input.role}, ${branchId}, 'ACTIVE', ${principal.staffId}, ${principal.staffId}, ${principal.staffId})
      `);
      return row;
    });
  }
}
