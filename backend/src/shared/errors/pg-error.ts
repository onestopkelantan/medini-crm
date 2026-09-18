import { ConflictError } from './errors';

/**
 * Database constraint error mapper.
 *
 * The filename is intentionally kept as `pg-error.ts` for import compatibility
 * during the migration. It now recognises both PostgreSQL and MySQL duplicate
 * key metadata so the rest of the domain layer keeps receiving ConflictError.
 */
export interface DatabaseErrorLike {
  code?: string;
  errno?: number;
  sqlState?: string;
  constraint?: string;
  message?: string;
  sqlMessage?: string;
}

const UNIQUE_CONSTRAINT_MESSAGES: Record<string, string> = {
  patients_org_mrn_uq: 'MRN already exists',
  patients_org_ic_uq: 'IC already registered',
  appt_org_code_uq: 'Appointment code already exists',
  panel_companies_org_code_uq: 'Panel code already exists',
  panel_companies_org_name_uq: 'Panel name already exists',
  insurance_companies_org_code_uq: 'Insurance code already exists',
  insurance_companies_org_name_uq: 'Insurance name already exists',
  encounters_org_code_uq: 'Encounter code already exists',
  treatment_plans_org_code_uq: 'Treatment plan code already exists',
  treatment_catalog_org_code_uq: 'Treatment code already exists',
  treatment_catalog_org_name_uq: 'Treatment name already exists',
  tooth_records_enc_tooth_uq: 'Tooth record already exists for this encounter',
  treatment_sessions_plan_no_uq: 'Session number already exists for this plan',
  consent_templates_title_version_uq: 'Consent template version already exists',
  sale_records_org_code_uq: 'Sale record code already exists',
  sale_records_org_external_ref_uq: 'External sale reference already exists',
  expenses_org_code_uq: 'Expense code already exists',
  recurring_commitments_org_code_uq: 'Recurring commitment code already exists',
  treatment_costs_org_code_uq: 'Treatment cost code already exists',
  lab_payables_org_code_uq: 'Lab payable code already exists',
  commission_ledger_org_code_uq: 'Commission code already exists',
  external_invoice_refs_org_code_uq: 'External invoice reference code already exists',
  external_invoice_refs_org_external_uq: 'External invoice number already exists for this source',
  bukku_sync_records_org_entity_uq: 'Sync record already exists for this entity',
  bukku_sync_records_idempotency_uq: 'Duplicate sync request (idempotency key)',
  commission_ledger_org_doctor_period_uq: 'Commission already calculated for this doctor and period',
  wa_channels_branch_active_uq: 'Branch already has an active WhatsApp channel',
  wa_conversations_active_contact_uq: 'An active conversation already exists for this contact on this channel',
  wa_messages_conv_idem_uq: 'Duplicate message (idempotency key)',
  wa_templates_org_branch_name_uq: 'Template name already exists for this branch',
};

function extractMysqlKey(message: string): string | undefined {
  // Typical mysql2 text: Duplicate entry 'x' for key 'table.constraint_name'
  const match = message.match(/for key ['`](?:[^.'`]+\.)?([^'`]+)['`]/i);
  return match?.[1];
}

export function toDomainError(e: unknown): unknown {
  const root = (e as any)?.cause ?? e;
  const err = root as DatabaseErrorLike;

  const isPgUnique = err.code === '23505';
  const isMysqlUnique = err.code === 'ER_DUP_ENTRY' || err.errno === 1062 || err.sqlState === '23000';
  if (!isPgUnique && !isMysqlUnique) return e;

  const rawMessage = err.sqlMessage ?? err.message ?? '';
  const key = err.constraint ?? extractMysqlKey(rawMessage);
  const message = key ? UNIQUE_CONSTRAINT_MESSAGES[key] : undefined;
  return new ConflictError(message ?? 'Duplicate record');
}
