import { sql } from 'drizzle-orm';
import { DbClient } from '../../modules/patients/infrastructure/patients.repository';

/**
 * OrgAllocator — org-safe, concurrency-safe human-code generation (Sprint 2
 * remediation #1, #2, #8). Uses a PostgreSQL named sequence per org; nextval
 * is atomic and NOT subject to RLS, so the same org always produces a
 * globally-unique MRN/APT code regardless of which branch inserts the row.
 *
 * SECURITY: the runtime role (medini_app) has NO CREATE on schema public —
 * sequences are pre-created by the admin/migration path (0005_org_sequences
 * creates the canonical org's; other orgs via the same pattern). The
 * allocator NEVER attempts DDL inside the request transaction (a failed
 * CREATE would abort the whole transaction — pg error 25P02).
 */
export class OrgAllocator {
  constructor(private readonly tx: DbClient) {}

  private seqName(prefix: 'mrn' | 'apt' | 'pnl' | 'ins' | 'enc' | 'tpl' | 'trt' | 'sal' | 'exp' | 'rec' | 'cst' | 'lab' | 'com' | 'ext', orgId: string): string {
    const key = orgId.replace(/-/g, '').slice(-8).toLowerCase();
    return `medini_${prefix}_${key}`;
  }

  /** Next MRN for the org, e.g. MDN-0001. Atomic across branches/connections. */
  async nextMrn(orgId: string): Promise<string> {
    const rows = await this.tx.execute(
      sql`SELECT nextval(${sql.raw(`'${this.seqName('mrn', orgId)}'`)})::int AS n`,
    );
    const n = (rows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;
    return `MDN-${String(n).padStart(4, '0')}`;
  }

  /** Next appointment code for the org, e.g. APT-0001. */
  async nextAptCode(orgId: string): Promise<string> {
    const rows = await this.tx.execute(
      sql`SELECT nextval(${sql.raw(`'${this.seqName('apt', orgId)}'`)})::int AS n`,
    );
    const n = (rows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;
    return `APT-${String(n).padStart(4, '0')}`;
  }

  /* Sprint 2A T2 — payor codes share the identical org-safe, concurrency-safe
   * sequence mechanism (sequences pre-created by migration 0006, admin path).
   * MRN/APT behaviour above is unchanged. */

  /** Next panel code for the org, e.g. PNL-0001. */
  async nextPanelCode(orgId: string): Promise<string> {
    const rows = await this.tx.execute(
      sql`SELECT nextval(${sql.raw(`'${this.seqName('pnl', orgId)}'`)})::int AS n`,
    );
    const n = (rows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;
    return `PNL-${String(n).padStart(4, '0')}`;
  }

  /** Next insurance code for the org, e.g. INS-0001. */
  async nextInsuranceCode(orgId: string): Promise<string> {
    const rows = await this.tx.execute(
      sql`SELECT nextval(${sql.raw(`'${this.seqName('ins', orgId)}'`)})::int AS n`,
    );
    const n = (rows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;
    return `INS-${String(n).padStart(4, '0')}`;
  }

  /* Sprint 3 (S3-A) — clinical codes share the identical org-safe,
   * concurrency-safe sequence mechanism (sequences pre-created by migration
   * 0007, admin path). MRN/APT/PNL/INS behaviour above is unchanged. */

  /** Next encounter code for the org, e.g. ENC-0001. */
  async nextEncounterCode(orgId: string): Promise<string> {
    const rows = await this.tx.execute(
      sql`SELECT nextval(${sql.raw(`'${this.seqName('enc', orgId)}'`)})::int AS n`,
    );
    const n = (rows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;
    return `ENC-${String(n).padStart(4, '0')}`;
  }

  /** Next treatment plan code for the org, e.g. TPL-0001. */
  async nextPlanCode(orgId: string): Promise<string> {
    const rows = await this.tx.execute(
      sql`SELECT nextval(${sql.raw(`'${this.seqName('tpl', orgId)}'`)})::int AS n`,
    );
    const n = (rows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;
    return `TPL-${String(n).padStart(4, '0')}`;
  }

  /** Next treatment catalog code for the org, e.g. TRT-0001. */
  async nextTreatmentCode(orgId: string): Promise<string> {
    const rows = await this.tx.execute(
      sql`SELECT nextval(${sql.raw(`'${this.seqName('trt', orgId)}'`)})::int AS n`,
    );
    const n = (rows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;
    return `TRT-${String(n).padStart(4, '0')}`;
  }

  /* Sprint 4 (S4-T1) — finance codes share the identical org-safe,
   * concurrency-safe sequence mechanism (sequences pre-created by migration
   * 0009, admin path). MRN/APT/PNL/INS/ENC/TPL/TRT behaviour unchanged.
   * NOT inv/pay — POS/Bukku own invoice/payment numbering. */

  /** Next sale record code for the org, e.g. SAL-0001. */
  async nextSaleCode(orgId: string): Promise<string> {
    const rows = await this.tx.execute(
      sql`SELECT nextval(${sql.raw(`'${this.seqName('sal', orgId)}'`)})::int AS n`,
    );
    const n = (rows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;
    return `SAL-${String(n).padStart(4, '0')}`;
  }

  /** Next expense code for the org, e.g. EXP-0001. */
  async nextExpenseCode(orgId: string): Promise<string> {
    const rows = await this.tx.execute(
      sql`SELECT nextval(${sql.raw(`'${this.seqName('exp', orgId)}'`)})::int AS n`,
    );
    const n = (rows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;
    return `EXP-${String(n).padStart(4, '0')}`;
  }

  /** Next recurring commitment code for the org, e.g. RC-0001. */
  async nextRecurringCode(orgId: string): Promise<string> {
    const rows = await this.tx.execute(
      sql`SELECT nextval(${sql.raw(`'${this.seqName('rec', orgId)}'`)})::int AS n`,
    );
    const n = (rows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;
    return `RC-${String(n).padStart(4, '0')}`;
  }

  /** Next treatment cost code for the org, e.g. CST-0001. */
  async nextCostCode(orgId: string): Promise<string> {
    const rows = await this.tx.execute(
      sql`SELECT nextval(${sql.raw(`'${this.seqName('cst', orgId)}'`)})::int AS n`,
    );
    const n = (rows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;
    return `CST-${String(n).padStart(4, '0')}`;
  }

  /** Next lab payable code for the org, e.g. LAB-0001. */
  async nextLabCode(orgId: string): Promise<string> {
    const rows = await this.tx.execute(
      sql`SELECT nextval(${sql.raw(`'${this.seqName('lab', orgId)}'`)})::int AS n`,
    );
    const n = (rows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;
    return `LAB-${String(n).padStart(4, '0')}`;
  }

  /** Next commission ledger code for the org, e.g. COM-0001. */
  async nextCommissionCode(orgId: string): Promise<string> {
    const rows = await this.tx.execute(
      sql`SELECT nextval(${sql.raw(`'${this.seqName('com', orgId)}'`)})::int AS n`,
    );
    const n = (rows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;
    return `COM-${String(n).padStart(4, '0')}`;
  }

  /** Next external invoice ref code for the org, e.g. EXT-0001. */
  async nextExternalRefCode(orgId: string): Promise<string> {
    const rows = await this.tx.execute(
      sql`SELECT nextval(${sql.raw(`'${this.seqName('ext', orgId)}'`)})::int AS n`,
    );
    const n = (rows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;
    return `EXT-${String(n).padStart(4, '0')}`;
  }
}
