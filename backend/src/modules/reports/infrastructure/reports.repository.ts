import { Injectable } from '@nestjs/common';
import { eq, and, inArray, isNull, sql } from 'drizzle-orm';
import {
  kpiDefinitions, reportAudit, branches, staff,
  patients, patientAllergies, waTemplates, auditLog, issuedForms,
} from '../../../infrastructure/database/schema';
import { DbClient } from '../../patients/infrastructure/patients.repository';

/**
 * S9 — Reports persistence: canonical KPI registry reads, report_audit
 * appends, name lookups, AND the Fasa-1 report queries (new patients, allergies,
 * WhatsApp template usage, access audit, forms issued).
 *
 * READ-ONLY except the audit append (the domain's single sanctioned write). All
 * queries run on the caller's runAs() transaction so RLS applies.
 *
 * WHY THESE FIVE LIVE HERE AND NOT IN A DOMAIN MODULE
 * A report is a READ of another domain's data shaped for a decision — it owns no
 * entity. Putting these in (say) the patients module would make patients
 * responsible for a screen it does not own, and the next report would then be
 * added there too, until the ownership boundary meant nothing. Reports reads
 * through the same DbClient the domain repositories use, so the table shapes
 * cannot drift apart silently.
 */
@Injectable()
export class ReportsRepository {
  /** Latest published KPI definitions for the org (canonical registry). */
  async listKpiDefinitions(tx: DbClient, orgId: string) {
    return tx.select().from(kpiDefinitions)
      .where(and(eq(kpiDefinitions.orgId, orgId), eq(kpiDefinitions.status, 'published')))
      .orderBy(kpiDefinitions.kpiKey);
  }

  /** Append an immutable usage event (append-only by RLS: no UPDATE/DELETE). */
  async appendAudit(tx: DbClient, row: {
    orgId: string; actorId: string; actorRole: string; action: string;
    view: string; filter: Record<string, unknown> | null; correlationId: string;
  }) {
    await tx.insert(reportAudit).values({
      orgId: row.orgId,
      actorId: row.actorId,
      actorRole: row.actorRole,
      action: row.action,
      view: row.view,
      filter: row.filter,
      correlationId: row.correlationId,
    });
  }

  /** Branch display names for report rows (in-scope only — RLS enforces). */
  async branchNames(tx: DbClient, orgId: string, branchIds: string[]) {
    if (branchIds.length === 0) return new Map<string, string>();
    const rows = await tx.select({ id: branches.id, name: branches.shortName })
      .from(branches)
      .where(and(eq(branches.orgId, orgId), inArray(branches.id, branchIds)));
    return new Map(rows.map((r: { id: string; name: string }) => [r.id, r.name]));
  }

  /** Doctor display names for the production table (in-scope only). */
  async doctorNames(tx: DbClient, orgId: string, doctorIds: string[]) {
    if (doctorIds.length === 0) return new Map<string, string>();
    const rows = await tx.select({ id: staff.id, name: staff.name })
      .from(staff)
      .where(and(eq(staff.orgId, orgId), inArray(staff.id, doctorIds)));
    return new Map(rows.map((r: { id: string; name: string }) => [r.id, r.name]));
  }

  /* ==========================================================================
     FASA 1 REPORTS — five reads over data that already exists.
     Every one applies the same scope rule: a branch user sees only their branch,
     HQ sees the org. Scope is decided by the CALLER (resolveReportScope) and
     passed in as `branchId | null`; `null` means "no branch filter" and is only
     ever produced for HQ.
     ========================================================================== */

  /**
   * New patients registered in a period.
   *
   * Registered-on date, not last-visit: a report called "new patients" that
   * counted visits would double-count a patient seen three times and call them
   * three registrations.
   */
  async newPatients(tx: DbClient, orgId: string, branchId: string | null, from: string, to: string) {
    const cond = [
      eq(patients.orgId, orgId),
      isNull(patients.deletedAt),
      sql`DATE(${patients.createdAt}) >= ${from}`,
      sql`DATE(${patients.createdAt}) <= ${to}`,
    ];
    if (branchId) cond.push(eq(patients.branchId, branchId));
    const rows = await tx.select({
      patientId: patients.id, mrn: patients.mrn, name: patients.name,
      branchId: patients.branchId, patientType: patients.patientType,
      source: patients.patientSource, registeredAt: patients.createdAt,
    }).from(patients).where(and(...cond)).orderBy(sql`${patients.createdAt} DESC`);

    /* Counted by day so the screen can show a trend, not just a total. */
    const byDay = new Map<string, number>();
    for (const r of rows as Array<{ registeredAt: Date | string }>) {
      const d = new Date(r.registeredAt).toISOString().slice(0, 10);
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    const byDayRows: Array<{ date: string; count: number }> = [];
    byDay.forEach((count, date) => byDayRows.push({ date, count }));
    byDayRows.sort((a, b) => a.date.localeCompare(b.date));
    return { rows, total: rows.length, byDay: byDayRows };
  }

  /**
   * Allergies currently on record (retired ones excluded).
   *
   * This is a SAFETY report, so it shows ACTIVE allergies only and carries the
   * severity — a retired allergy is history, and mixing the two would make the
   * list longer and less useful to a clinician scanning it before treatment.
   */
  async activeAllergies(tx: DbClient, orgId: string, branchId: string | null) {
    const cond = [
      eq(patientAllergies.orgId, orgId),
      isNull(patientAllergies.deletedAt),
      isNull(patientAllergies.retiredAt),
    ];
    if (branchId) cond.push(eq(patientAllergies.branchId, branchId));
    const rows = await tx.select({
      allergyId: patientAllergies.id, patientId: patientAllergies.patientId,
      allergen: patientAllergies.allergen, category: patientAllergies.category,
      severity: patientAllergies.severity, reaction: patientAllergies.reaction,
      notedAt: patientAllergies.notedAt,
    }).from(patientAllergies).where(and(...cond))
      .orderBy(sql`FIELD(${patientAllergies.severity}, 'severe', 'moderate', 'mild'), ${patientAllergies.allergen}`);

    /* Patient names are fetched separately: two queries stay readable and the
     * report is small (an allergy list, not a fact table). */
    const allergyRows = rows as Array<{ patientId: string }>;
    const ids: string[] = [...new Set(allergyRows.map((r) => r.patientId))];
    const names = new Map<string, string>();
    if (ids.length) {
      const p = (await tx.select({ id: patients.id, name: patients.name, mrn: patients.mrn })
        .from(patients).where(inArray(patients.id, ids))) as Array<{ id: string; name: string; mrn: string }>;
      for (const x of p) names.set(x.id, `${x.name} (${x.mrn})`);
    }
    return (rows as Array<Record<string, unknown> & { patientId: string }>).map((r) => ({ ...r, patientName: names.get(r.patientId) ?? null }));
  }

  /** WhatsApp template usage — how many templates exist per category, active vs not. */
  async whatsappTemplates(tx: DbClient, orgId: string, branchId: string | null) {
    const cond = [eq(waTemplates.orgId, orgId), isNull(waTemplates.deletedAt)];
    if (branchId) cond.push(eq(waTemplates.branchId, branchId));
    const rows = await tx.select({
      templateId: waTemplates.id, name: waTemplates.name, category: waTemplates.category,
      active: waTemplates.active, branchId: waTemplates.branchId, createdAt: waTemplates.createdAt,
    }).from(waTemplates).where(and(...cond)).orderBy(waTemplates.category, waTemplates.name);

    const tplRows = rows as Array<{ category: string | null; active: boolean }>;
    const byCategory = new Map<string, { category: string; total: number; active: number }>();
    for (const r of tplRows) {
      const k = r.category ?? '(none)';
      const e = byCategory.get(k) ?? { category: k, total: 0, active: 0 };
      e.total += 1;
      if (r.active) e.active += 1;
      byCategory.set(k, e);
    }
    const cats: Array<{ category: string; total: number; active: number }> = [];
    byCategory.forEach((v) => cats.push(v));
    cats.sort((a, b) => b.total - a.total);
    return { rows, total: rows.length, active: tplRows.filter((r) => r.active).length, byCategory: cats };
  }

  /**
   * Record-access audit — WHO looked at WHAT.
   *
   * Governance value: this answers "who opened this patient's record", which is
   * the question a patient or an auditor actually asks. It reports a COUNT per
   * actor and action, not every row: 2,000 rows is a log, and a log is not a
   * report — the shape has to be chosen for the decision.
   */
  async accessAudit(tx: DbClient, orgId: string, branchId: string | null, from: string, to: string, limit = 50) {
    const cond = [
      eq(auditLog.orgId, orgId),
      sql`DATE(${auditLog.createdAt}) >= ${from}`,
      sql`DATE(${auditLog.createdAt}) <= ${to}`,
    ];
    if (branchId) cond.push(eq(auditLog.branchId, branchId));
    const rows = await tx.select({
      actorId: auditLog.actorId, actorRole: auditLog.actorRole,
      action: auditLog.action, entity: auditLog.entity, n: sql<number>`COUNT(*)`,
      lastAt: sql<string>`MAX(${auditLog.createdAt})`,
    }).from(auditLog).where(and(...cond))
      .groupBy(auditLog.actorId, auditLog.actorRole, auditLog.action, auditLog.entity)
      .orderBy(sql`COUNT(*) DESC`).limit(limit);

    /* Actor names — an id alone is not an answer to "who". */
    const auditRows = rows as Array<{ actorId: string | null }>;
    const ids: string[] = [...new Set(auditRows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (ids.length) {
      const st = (await tx.select({ id: staff.id, name: staff.name, role: staff.role })
        .from(staff).where(inArray(staff.id, ids))) as Array<{ id: string; name: string }>;
      for (const x of st) names.set(x.id, x.name);
    }
    return (rows as Array<Record<string, unknown> & { actorId: string | null }>).map((r) => ({
      ...r, actorName: r.actorId ? names.get(r.actorId) ?? null : null,
    }));
  }

  /**
   * Forms issued (MC / PDPA / consent), by kind and status.
   *
   * Cancelled forms are REPORTED, not hidden: the serial numbers are consumed
   * whether or not the document was used, so a report that dropped them would
   * disagree with the serial counter and make the audit trail look broken.
   */
  async formsIssued(tx: DbClient, orgId: string, branchId: string | null, from: string, to: string) {
    const cond = [
      eq(issuedForms.orgId, orgId),
      sql`DATE(${issuedForms.issuedAt}) >= ${from}`,
      sql`DATE(${issuedForms.issuedAt}) <= ${to}`,
    ];
    if (branchId) cond.push(eq(issuedForms.branchId, branchId));
    const rows = await tx.select({
      formId: issuedForms.id, serialNo: issuedForms.serialNo, kind: issuedForms.kind,
      subject: issuedForms.subject, status: issuedForms.status,
      patientId: issuedForms.patientId, issuedAt: issuedForms.issuedAt,
      cancelReason: issuedForms.cancelReason,
    }).from(issuedForms).where(and(...cond)).orderBy(sql`${issuedForms.serialNo} DESC`);

    const formRows = rows as Array<{ kind: string; status: string }>;
    const byKind = new Map<string, { kind: string; issued: number; cancelled: number }>();
    for (const r of formRows) {
      const e = byKind.get(r.kind) ?? { kind: r.kind, issued: 0, cancelled: 0 };
      if (r.status === 'cancelled') e.cancelled += 1; else e.issued += 1;
      byKind.set(r.kind, e);
    }
    const kinds: Array<{ kind: string; issued: number; cancelled: number }> = [];
    byKind.forEach((v) => kinds.push(v));
    kinds.sort((a, b) => a.kind.localeCompare(b.kind));
    return { rows, total: rows.length, byKind: kinds };
  }
}
