import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { AuditService } from '../../../shared/audit/audit.service';
import { ValidationError, ForbiddenError, NotFoundError } from '../../../shared/errors/errors';
import { staff } from '../../../infrastructure/database/schema';

const profileSchema = z.object({
  name: z.string().trim().min(1).max(256).optional(),
  email: z.string().trim().email().max(256).nullish(),
  phone: z.string().trim().max(64).nullish(),
});

export interface SafeProfile {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  branchId: string | null;
}

/**
 * UserProfileService — authenticated self-service profile edit.
 *
 * A user may update ONLY their own profile, and only safe fields
 * (name / email / phone). Identity and security fields — username, role,
 * status, passwordHash, mfaSecret, inviteToken — are never editable here;
 * role/status changes go through the administration module.
 *
 * (Staff RLS permits any human to write staff rows, so the self-only boundary
 * is enforced at this app layer: targetId must equal principal.staffId.)
 */
@Injectable()
export class UserProfileService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly audit: AuditService,
  ) {}

  async updateProfile(principal: Principal, targetId: string, raw: unknown): Promise<SafeProfile> {
    if (targetId !== principal.staffId) {
      throw new ForbiddenError('You can only update your own profile');
    }
    const parsed = profileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])),
      );
    }
    const input = parsed.data;
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set['name'] = input.name;
    if (input.email !== undefined) set['email'] = input.email;
    if (input.phone !== undefined) set['phone'] = input.phone;
    if (Object.keys(set).length === 0) {
      throw new ValidationError({ _: ['No editable profile fields supplied'] });
    }

    return this.dbCtx.runAs(principal, async (tx) => {
      const rows = await tx
        .update(staff)
        .set({ ...set, updatedAt: new Date(), updatedBy: principal.staffId })
        .where(and(eq(staff.id, principal.staffId), eq(staff.orgId, principal.orgId)))
        .returning();
      const row = rows[0];
      if (!row) throw new NotFoundError('staff', targetId);

      await this.audit.record(
        {
          actorId: principal.staffId, actorRole: principal.role,
          action: 'staff_profile_updated', entity: 'staff', entityId: principal.staffId,
          orgId: principal.orgId, branchId: principal.branchId, source: 'api',
          after: set,
        },
        tx,
      );
      return {
        id: row.id, name: row.name, email: row.email ?? null,
        phone: row.phone ?? null, role: row.role, branchId: row.branchId ?? null,
      };
    });
  }
}
