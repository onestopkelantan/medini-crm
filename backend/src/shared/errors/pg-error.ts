import { ConflictError } from './errors';

/**
 * Structured PostgreSQL error handling (Sprint 2 remediation #7).
 *
 * Drizzle wraps pg errors: `err.cause` carries the real error with
 * `code` (SQLSTATE) and `constraint` (constraint name). String-matching the
 * wrapped message is fragile — map structured metadata instead.
 */

export interface PgErrorLike {
  code?: string;
  constraint?: string;
  message?: string;
}

/** Known unique constraints → human/business message. */
const UNIQUE_CONSTRAINT_MESSAGES: Record<string, string> = {
  patients_org_mrn_uq: 'MRN already exists',
  patients_org_ic_uq: 'IC already registered',
  appt_org_code_uq: 'Appointment code already exists',
  /* Sprint 2A T2 — payor master data (migration 0006 constraints) */
  panel_companies_org_code_uq: 'Panel code already exists',
  panel_companies_org_name_uq: 'Panel name already exists',
  insurance_companies_org_code_uq: 'Insurance code already exists',
  insurance_companies_org_name_uq: 'Insurance name already exists',
  /* Sprint 3 (S3-A) — clinical domain (migrations 0007/0008 constraints) */
  encounters_org_code_uq: 'Encounter code already exists',
  treatment_plans_org_code_uq: 'Treatment plan code already exists',
  treatment_catalog_org_code_uq: 'Treatment code already exists',
  treatment_catalog_org_name_uq: 'Treatment name already exists',
  tooth_records_enc_tooth_uq: 'Tooth record already exists for this encounter',
  treatment_sessions_plan_no_uq: 'Session number already exists for this plan',
  consent_templates_title_version_uq: 'Consent template version already exists',
  /* Sprint 4 (S4-T1) — finance foundation (migration 0009 constraints) */
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
  /* Sprint 4 P1 remediation (migration 0010) — commission duplicate guard */
  commission_ledger_org_doctor_period_uq: 'Commission already calculated for this doctor and period',
  /* Sprint 6 (S6-T1) — whatsapp foundation (migration 0013 constraints) */
  wa_channels_branch_active_uq: 'Branch already has an active WhatsApp channel',
  wa_conversations_active_contact_uq: 'An active conversation already exists for this contact on this channel',
  wa_messages_conv_idem_uq: 'Duplicate message (idempotency key)',
  wa_templates_org_branch_name_uq: 'Template name already exists for this branch',
};

/**
 * Map a thrown value to a domain error when it is a recognizable PostgreSQL
 * violation; otherwise return the value unchanged.
 */
export function toDomainError(e: unknown): unknown {
  const cause = (e as { cause?: PgErrorLike }).cause;
  if (!cause || typeof cause.code !== 'string') return e;

  /* 23505 = unique_violation */
  if (cause.code === '23505') {
    const message = cause.constraint
      ? UNIQUE_CONSTRAINT_MESSAGES[cause.constraint]
      : undefined;
    return new ConflictError(message ?? 'Duplicate record');
  }
  return e;
}
