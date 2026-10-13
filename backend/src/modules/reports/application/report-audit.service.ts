import { Injectable } from '@nestjs/common';
import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { getCorrelationId } from '../../../shared/correlation/correlation';
import { ReportsRepository } from '../infrastructure/reports.repository';

/** S9 — report usage audit (domain-owned ReportAudit, Q5). Every report view
 * is recorded append-only with actor, view, effective filter and correlation.
 * The record rides the SAME transaction as the read (S2 audit pattern). */
@Injectable()
export class ReportAuditService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly repo: ReportsRepository,
  ) {}

  async recordView(
    tx: Parameters<ReportsRepository['appendAudit']>[0],
    principal: Principal,
    view: string,
    filter: Record<string, unknown> | null,
  ): Promise<void> {
    await this.repo.appendAudit(tx, {
      orgId: principal.orgId,
      actorId: principal.staffId,
      actorRole: principal.role,
      action: 'view_opened',
      view,
      filter,
      correlationId: getCorrelationId(),
    });
  }
}
