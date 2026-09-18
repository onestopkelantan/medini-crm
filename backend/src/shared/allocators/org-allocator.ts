import { sql } from 'drizzle-orm';
import { DbClient } from '../../modules/patients/infrastructure/patients.repository';

/**
 * OrgAllocator — MySQL edition.
 *
 * PostgreSQL named sequences are replaced by the `org_counters` table. The
 * ON DUPLICATE KEY UPDATE + LAST_INSERT_ID(expr) pattern is atomic per
 * (org_id, prefix) and works safely across multiple application instances.
 * A (nested) transaction guarantees the increment and LAST_INSERT_ID read use
 * the same mysql2 connection.
 */
export class OrgAllocator {
  constructor(private readonly tx: DbClient) {}

  private async nextNumber(prefix: string, orgId: string): Promise<number> {
    return this.tx.transaction(async (inner: DbClient) => {
      await inner.execute(sql`
        INSERT INTO org_counters
          (org_id, prefix, counter_value, created_at, updated_at)
        VALUES
          (${orgId}, ${prefix}, LAST_INSERT_ID(1), NOW(6), NOW(6))
        ON DUPLICATE KEY UPDATE
          counter_value = LAST_INSERT_ID(counter_value + 1),
          updated_at = NOW(6)
      `);

      const result = await inner.execute(sql`SELECT LAST_INSERT_ID() AS n`);
      const value = Number((result as any).rows?.[0]?.n ?? 0);
      if (!Number.isFinite(value) || value < 1) {
        throw new Error(`Failed to allocate ${prefix} counter for organization ${orgId}`);
      }
      return value;
    });
  }

  private async code(prefix: string, label: string, orgId: string): Promise<string> {
    const n = await this.nextNumber(prefix, orgId);
    return `${label}-${String(n).padStart(4, '0')}`;
  }

  async nextMrn(orgId: string): Promise<string> { return this.code('mrn', 'MDN', orgId); }
  async nextAptCode(orgId: string): Promise<string> { return this.code('apt', 'APT', orgId); }
  async nextPanelCode(orgId: string): Promise<string> { return this.code('pnl', 'PNL', orgId); }
  async nextInsuranceCode(orgId: string): Promise<string> { return this.code('ins', 'INS', orgId); }
  async nextEncounterCode(orgId: string): Promise<string> { return this.code('enc', 'ENC', orgId); }
  async nextPlanCode(orgId: string): Promise<string> { return this.code('tpl', 'TPL', orgId); }
  async nextTreatmentCode(orgId: string): Promise<string> { return this.code('trt', 'TRT', orgId); }
  async nextSaleCode(orgId: string): Promise<string> { return this.code('sal', 'SAL', orgId); }
  async nextExpenseCode(orgId: string): Promise<string> { return this.code('exp', 'EXP', orgId); }
  async nextRecurringCode(orgId: string): Promise<string> { return this.code('rec', 'RC', orgId); }
  async nextCostCode(orgId: string): Promise<string> { return this.code('cst', 'CST', orgId); }
  async nextLabCode(orgId: string): Promise<string> { return this.code('lab', 'LAB', orgId); }
  async nextCommissionCode(orgId: string): Promise<string> { return this.code('com', 'COM', orgId); }
  async nextExternalRefCode(orgId: string): Promise<string> { return this.code('ext', 'EXT', orgId); }
}
