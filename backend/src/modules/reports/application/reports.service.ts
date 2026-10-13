import { Injectable } from '@nestjs/common';
import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { ForbiddenError } from '../../../shared/errors/errors';
import { FinanceReadPort } from '../../../shared/ports/finance.read-port';
import { AppointmentsReadPort } from '../../../shared/ports/appointments.read-port';
import { ClinicalReadPort } from '../../../shared/ports/clinical.read-port';
import { RecallReadPort } from '../../../shared/ports/recall.read-port';
import { ReportsRepository } from '../infrastructure/reports.repository';
import { ReportAuditService } from './report-audit.service';
import { resolvePeriod, previousPeriodRange, isReportPeriod, type ReportPeriod, type PeriodRange } from '../domain/period-resolver';
import { resolveReportScope } from '../domain/reports-scope';
import { KpiDefinition } from '../../../infrastructure/database/schema';
import {
  noShowRate, recallRate, revenuePerAppointment, chairUtilisation,
} from '../domain/kpi-formulas';

/**
 * ReportsService — READ/INTELLIGENCE LAYER orchestration (S9).
 *
 * Rules (REPORTS-ANALYTICS-LOCKED.md):
 * - Facts come from domain-owner READ PORTS only — never raw repositories.
 * - Scope is FULLY server-derived from the principal (AD-6). No client
 *   branchId parameter exists.
 * - Every view appends report_audit in the SAME transaction as the read.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly finance: FinanceReadPort,
    private readonly appointments: AppointmentsReadPort,
    private readonly clinical: ClinicalReadPort,
    private readonly recall: RecallReadPort,
    private readonly repo: ReportsRepository,
    private readonly audit: ReportAuditService,
  ) {}

  private periodOf(raw?: string): ReportPeriod {
    if (raw === undefined) return '30D';
    if (!isReportPeriod(raw)) throw new ForbiddenError(`invalid period '${raw}' (allowed: 7D/30D/90D/12M)`);
    return raw;
  }

  /**
   * Window for a report read: the period pill, or an explicit range override.
   *
   * The override is INTERNAL (Phase B comparison): AnalystService fetches the
   * previous window via previousPeriodRange() to answer "bandingkan dengan
   * bulan lepas". The HTTP surface still accepts only pills — a client can
   * never ask for an arbitrary range; this keeps the audit trail honest
   * (the audit row records the pill, not the override).
   */
  private windowOf(rawPeriod: string | undefined, range?: PeriodRange) {
    const period = this.periodOf(rawPeriod);
    const r = range ?? resolvePeriod(period);
    return { period, from: r.from, to: r.to };
  }

  /** The previous window for a pill — the comparison source (Phase B). */
  previousWindow(period: ReportPeriod, now: Date = new Date()): PeriodRange {
    return previousPeriodRange(period, now);
  }

  private scopeOf(principal: Principal) {
    const scope = resolveReportScope({ role: principal.role, branchId: principal.branchId });
    if (scope.type === 'denied') throw new ForbiddenError(`reports access denied: ${scope.reason}`);
    return scope;
  }

  /** 1. KPI strip — 4 cards from canonical sources. */
  async kpis(principal: Principal, rawPeriod?: string, range?: PeriodRange) {
    const { period, from, to } = this.windowOf(rawPeriod, range);
    const scope = this.scopeOf(principal);
    const branchId = scope.type === 'branch' ? scope.branchId : null;

    return this.dbCtx.runAs(principal, async (tx) => {
      const [revenue, attribution, daily, recallStats] = await Promise.all([
        this.finance.revenueTotal(tx as never, principal.orgId, { branchId, from, to }),
        /* Does this revenue link to patients at all? Decides whether a
         * per-appointment metric is meaningful, or must refuse to answer. */
        this.finance.revenueAttribution(tx as never, principal.orgId, { branchId, from, to }),
        this.appointments.dailySeries(tx as never, principal.orgId, branchId, from, to),
        this.recall.recallStats(tx as never, principal.orgId, branchId, from, to),
      ]);
      const completed = daily.filter((d) => d.status === 'completed').reduce((a, d) => a + d.n, 0);
      const noShow = daily.filter((d) => d.status === 'no-show').reduce((a, d) => a + d.n, 0);

      /* Attribute only when the revenue actually carries a patient link; a POS-only
       * import cannot be divided by clinical visits (see revenuePerAppointment). */
      const attributable = Number(attribution.attributable) > 0;
      const revPerAppt = revenuePerAppointment(revenue, completed, attributable);
      const recallKpi = recallRate(recallStats.completed, recallStats.open, recallStats.cancelled);
      const noShowKpi = noShowRate(noShow, completed);
      const chair = chairUtilisation();

      const cards = [
        { kpiKey: 'revenue', value: revenue, unit: 'MYR', sourceDomain: 'finance', available: true },
        { kpiKey: 'revenue_per_appointment', value: revPerAppt.value, unit: 'MYR', sourceDomain: 'finance', available: revPerAppt.available, note: revPerAppt.note },
        { kpiKey: 'recall_rate', value: recallKpi.value, unit: 'percent', sourceDomain: 'marketing', available: recallKpi.available, note: recallKpi.note },
        { kpiKey: 'no_show_rate', value: noShowKpi.value, unit: 'percent', sourceDomain: 'appointments', available: noShowKpi.available, note: noShowKpi.note },
        { kpiKey: 'chair_utilisation', value: chair.value, unit: 'percent', sourceDomain: 'operations', available: chair.available, note: chair.note },
      ];
      await this.audit.recordView(tx, principal, 'kpis', { period });
      return { period, from, to, scope: this.scopeDto(scope), cards };
    });
  }

  /** 2. Revenue by branch (top-N, scope-aware). */
  async revenueByBranch(principal: Principal, rawPeriod?: string, rawLimit?: string, range?: PeriodRange) {
    const { period, from, to } = this.windowOf(rawPeriod, range);
    const scope = this.scopeOf(principal);
    const branchId = scope.type === 'branch' ? scope.branchId : null;
    const limit = Math.min(Math.max(Number(rawLimit ?? 6) || 6, 1), 50);

    return this.dbCtx.runAs(principal, async (tx) => {
      const rows = await this.finance.revenueByBranch(tx as never, principal.orgId, { branchId, from, to });
      rows.sort((a, b) => Number(b.revenue) - Number(a.revenue));
      const top = rows.slice(0, limit);
      const names = await this.repo.branchNames(tx as never, principal.orgId, top.map((r) => r.branchId));
      const total = rows.reduce((a, r) => a + Number(r.revenue), 0).toFixed(4);
      await this.audit.recordView(tx, principal, 'revenue_by_branch', { period, limit });
      return {
        period, from, to, scope: this.scopeDto(scope), total,
        rows: top.map((r) => ({ branchId: r.branchId, branchName: names.get(r.branchId) ?? null, revenue: r.revenue })),
      };
    });
  }

  /** 3. Treatment mix (clinical-owned source, Q3). */
  async treatmentMix(principal: Principal, rawPeriod?: string, range?: PeriodRange) {
    const { period, from, to } = this.windowOf(rawPeriod, range);
    const scope = this.scopeOf(principal);
    const branchId = scope.type === 'branch' ? scope.branchId : null;

    return this.dbCtx.runAs(principal, async (tx) => {
      const rows = await this.clinical.treatmentMix(tx as never, principal.orgId, branchId, from, to);
      const total = rows.reduce((a, r) => a + r.count, 0);
      await this.audit.recordView(tx, principal, 'treatment_mix', { period });
      return {
        period, from, to, scope: this.scopeDto(scope),
        rows: rows.map((r) => ({
          category: r.category, count: r.count,
          share: total === 0 ? null : Number(((r.count / total) * 100).toFixed(1)),
        })),
      };
    });
  }

  /** 4. Appointment trends (daily booked/completed/no-show series). */
  async appointmentTrends(principal: Principal, rawPeriod?: string, range?: PeriodRange) {
    const { period, from, to } = this.windowOf(rawPeriod, range);
    const scope = this.scopeOf(principal);
    const branchId = scope.type === 'branch' ? scope.branchId : null;

    return this.dbCtx.runAs(principal, async (tx) => {
      const daily = await this.appointments.dailySeries(tx as never, principal.orgId, branchId, from, to);
      const byDate = new Map<string, { date: string; booked: number; completed: number; noShow: number }>();
      for (const d of daily) {
        const row = byDate.get(d.date) ?? { date: d.date, booked: 0, completed: 0, noShow: 0 };
        if (d.status === 'completed') row.completed += d.n;
        else if (d.status === 'no-show') row.noShow += d.n;
        else row.booked += d.n; /* pipeline statuses count as booked pipeline */
        byDate.set(d.date, row);
      }
      const series = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
      await this.audit.recordView(tx, principal, 'appointment_trends', { period });
      return { period, from, to, scope: this.scopeDto(scope), series };
    });
  }

  /** 5. Doctor production (in-scope doctors only). */
  async doctorProduction(principal: Principal, rawPeriod?: string, range?: PeriodRange) {
    const { period, from, to } = this.windowOf(rawPeriod, range);
    const scope = this.scopeOf(principal);
    const branchId = scope.type === 'branch' ? scope.branchId : null;

    return this.dbCtx.runAs(principal, async (tx) => {
      const rows = await this.appointments.doctorProduction(tx as never, principal.orgId, branchId, from, to);
      const names = await this.repo.doctorNames(tx as never, principal.orgId, rows.map((r) => r.doctorId));
      await this.audit.recordView(tx, principal, 'doctor_production', { period });
      return {
        period, from, to, scope: this.scopeDto(scope),
        rows: rows.map((r) => ({
          doctorId: r.doctorId, name: names.get(r.doctorId) ?? null, appointmentsCompleted: r.completed,
        })),
      };
    });
  }

  /** 6. Canonical KPI registry — HQ only (LOCK doc §10). */
  async kpiRegistry(principal: Principal) {
    this.scopeOf(principal);
    if (principal.role !== 'hq') throw new ForbiddenError('KPI registry is HQ-only');
    return this.dbCtx.runAs(principal, async (tx) => {
      const defs = await this.repo.listKpiDefinitions(tx as never, principal.orgId);
      await this.audit.recordView(tx, principal, 'kpi_registry', null);
      return {
        definitions: defs.map((d: KpiDefinition) => ({
          kpiKey: d.kpiKey, name: d.name, formula: d.formula,
          sourceDomain: d.sourceDomain, unit: d.unit, version: d.version, status: d.status,
        })),
      };
    });
  }

  /* ==========================================================================
     FASA 1 REPORTS — five reports over existing data.

     Each one follows the same three rules as the rest of this service:
       1. Scope is server-derived (scopeOf) — a client never sends branchId.
       2. Facts come from this module's read repository, inside runAs().
       3. Every view appends report_audit in the SAME transaction as the read,
          so "who opened which report" is answerable.
     ========================================================================== */

  private rangeOf(rawPeriod?: string, range?: PeriodRange) {
    return this.windowOf(rawPeriod, range);
  }

  /** 7. New patients registered in a period. */
  async newPatients(principal: Principal, rawPeriod?: string, range?: PeriodRange) {
    const scope = this.scopeOf(principal);
    const { period, from, to } = this.rangeOf(rawPeriod, range);
    const branchId = scope.type === 'branch' ? scope.branchId : null;
    return this.dbCtx.runAs(principal, async (tx) => {
      const data = await this.repo.newPatients(tx as never, principal.orgId, branchId, from, to);
      await this.audit.recordView(tx, principal, 'new_patients', { period });
      return { period, from, to, scope: this.scopeDto(scope), ...data };
    });
  }

  /** 8. Active allergies — a safety list, active only, severe first. */
  async allergies(principal: Principal) {
    const scope = this.scopeOf(principal);
    const branchId = scope.type === 'branch' ? scope.branchId : null;
    return this.dbCtx.runAs(principal, async (tx) => {
      const rows = await this.repo.activeAllergies(tx as never, principal.orgId, branchId);
      await this.audit.recordView(tx, principal, 'allergies', null);
      return { scope: this.scopeDto(scope), rows, total: rows.length };
    });
  }

  /** 9. WhatsApp template usage by category. */
  async whatsappTemplates(principal: Principal) {
    const scope = this.scopeOf(principal);
    const branchId = scope.type === 'branch' ? scope.branchId : null;
    return this.dbCtx.runAs(principal, async (tx) => {
      const data = await this.repo.whatsappTemplates(tx as never, principal.orgId, branchId);
      await this.audit.recordView(tx, principal, 'whatsapp_templates', null);
      return { scope: this.scopeDto(scope), ...data };
    });
  }

  /** 10. Record-access audit — who did what, counted. */
  async accessAudit(principal: Principal, rawPeriod?: string) {
    const scope = this.scopeOf(principal);
    const { period, from, to } = this.rangeOf(rawPeriod);
    const branchId = scope.type === 'branch' ? scope.branchId : null;
    return this.dbCtx.runAs(principal, async (tx) => {
      const rows = await this.repo.accessAudit(tx as never, principal.orgId, branchId, from, to);
      await this.audit.recordView(tx, principal, 'access_audit', { period });
      return { period, from, to, scope: this.scopeDto(scope), rows, total: rows.length };
    });
  }

  /** 11. Forms issued (MC / PDPA / consent), including cancelled. */
  async formsIssued(principal: Principal, rawPeriod?: string, range?: PeriodRange) {
    const scope = this.scopeOf(principal);
    const { period, from, to } = this.rangeOf(rawPeriod, range);
    const branchId = scope.type === 'branch' ? scope.branchId : null;
    return this.dbCtx.runAs(principal, async (tx) => {
      const data = await this.repo.formsIssued(tx as never, principal.orgId, branchId, from, to);
      await this.audit.recordView(tx, principal, 'forms_issued', { period });
      return { period, from, to, scope: this.scopeDto(scope), ...data };
    });
  }

  private scopeDto(scope: { type: string; branchId?: string }) {
    return scope.type === 'org'
      ? { type: 'org' as const }
      : { type: 'branch' as const, branchId: scope.branchId! };
  }
}
