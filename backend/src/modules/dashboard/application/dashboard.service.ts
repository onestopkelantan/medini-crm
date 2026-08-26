import { Injectable } from '@nestjs/common';
import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { ForbiddenError } from '../../../shared/errors/errors';
import { PatientsReadPort } from '../../../shared/ports/patients.read-port';
import { AppointmentsReadPort } from '../../../shared/ports/appointments.read-port';



export interface DashboardContext {
  date: string;
  branchId: string;
  patients: { total: number };
  appointments: {
    total: number;
    byStatus: Array<{ status: string; n: number }>;
    queueActive: number;
    completed: number;
  };
}

/**
 * DashboardService — READ-ONLY aggregation. It derives every number from the
 * owner modules' read ports inside runAs() (RLS-scoped). It never writes to
 * patients/appointments or any business table, never calls repositories, and
 * records NO audit (view-only). RBAC/scope come from the principal + RLS.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly patients: PatientsReadPort,
    private readonly appointments: AppointmentsReadPort,
  ) {}

  async context(principal: Principal, date: string): Promise<DashboardContext> {
    /* HQ (branchId null) = org-wide rollup; branch users = own branch. */
    const branchId = principal.role === 'hq' ? null : principal.branchId;
    if (!branchId && principal.role !== 'hq') {
      throw new ForbiddenError('No branch context — access denied');
    }

    return this.dbCtx.runAs(principal, async (tx) => {
      const [patientTotal, apptTotal, byStatus] = await Promise.all([
        this.patients.countPatients(tx as never, principal.orgId, branchId),
        this.appointments.countByDate(tx as never, principal.orgId, branchId, date),
        this.appointments.statusBreakdown(tx as never, principal.orgId, branchId, date),
      ]);
      const queueActive = byStatus
        .filter((s) => ['checked-in', 'waiting', 'called', 'in-progress'].includes(s.status))
        .reduce((acc, s) => acc + s.n, 0);
      const completed = byStatus.find((s) => s.status === 'completed')?.n ?? 0;
      return {
        date,
        branchId: branchId ?? principal.orgId,
        patients: { total: patientTotal },
        appointments: { total: apptTotal, byStatus, queueActive, completed },
      };
    });
  }
}
