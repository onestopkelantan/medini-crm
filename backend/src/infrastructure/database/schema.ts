/**
 * ============================================================================
 * CANONICAL DATABASE SCHEMA — Medini CRM (Sprint 1: Database Foundation)
 * ============================================================================
 * Derived from the locked Production Backend Blueprint v1.0 (§B2) and the
 * MEDINI_ARCHITECTURE contract. Single-tenant (org_id reserved), 14 canonical
 * branches, role-based + branch-scoped. Drizzle ORM / PostgreSQL 16.
 *
 * Conventions:
 *  - uuid PKs (gen_random_uuid()), human codes as unique natural keys (mrn, code)
 *  - audit fields on every table: created_at/created_by/updated_at/updated_by
 *  - soft delete via deleted_at (mutable business records only)
 *  - org_id + branch_id for tenant/branch isolation
 *  - Drizzle check() for DB-enforced invariants
 * ============================================================================
 */
import {
  pgTable, uuid, text, varchar, integer, boolean, date, time,
  timestamp, jsonb, pgEnum, uniqueIndex, index, check, numeric,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/* ---------- Enums (match locked contract) ---------- */
export const roleEnum = pgEnum('role', ['hq', 'branch_manager', 'branch_admin', 'doctor', 'developer']);
export const branchTypeEnum = pgEnum('branch_type', ['main', 'affiliate']);
export const branchStatusEnum = pgEnum('branch_status', ['active', 'inactive']);
export const staffStatusEnum = pgEnum('staff_status', ['Active', 'Suspended', 'Deactivated', 'Invited', 'Pending', 'Rejected']);
export const roleAssignmentStatusEnum = pgEnum('role_assignment_status', ['ACTIVE', 'SUPERSEDED']);
export const patientStatusEnum = pgEnum('patient_status', ['Active', 'VIP', 'Recall Due', 'Inactive']);
export const paymentStatusEnum = pgEnum('payment_status_type', ['PENDING', 'PAID', 'OVERDUE']);
export const appointmentStatusEnum = pgEnum('appointment_status', [
  'booked', 'confirmed', 'checked-in', 'waiting', 'called', 'in-progress', 'completed', 'cancelled', 'no-show',
]);
export const auditSourceEnum = pgEnum('audit_source', ['api', 'worker', 'integration', 'system']);
export const idempotencyStatusEnum = pgEnum('idempotency_status', ['in_progress', 'completed', 'failed']);
/* Sprint 2A T1 — shared by panel_companies + insurance_companies (org-wide payor master data). */
export const payorStatusEnum = pgEnum('payor_status', ['Active', 'Inactive']);
/* Sprint 3 (S3-A) — clinical domain enums (migrations 0007/0008). */
export const encounterStatusEnum = pgEnum('encounter_status', ['open', 'completed', 'cancelled']);
export const planStatusEnum = pgEnum('plan_status', ['draft', 'proposed', 'accepted', 'active', 'completed', 'cancelled']);
export const planItemStatusEnum = pgEnum('plan_item_status', ['pending', 'done']);
export const toothConditionEnum = pgEnum('tooth_condition', ['healthy', 'decayed', 'filled', 'missing', 'crowned', 'root_canal', 'implant']);
export const consentMethodEnum = pgEnum('consent_method', ['verbal', 'written', 'electronic']);
export const imagingKindEnum = pgEnum('imaging_kind', ['xray', 'cbct', 'opg', 'photo', 'before_after', 'consent', 'document']);
export const adverseSeverityEnum = pgEnum('adverse_severity', ['mild', 'moderate', 'severe']);
export const referralStatusEnum = pgEnum('referral_status', ['pending', 'sent', 'acknowledged', 'completed']);
/* Sprint 8 — documents domain. */
export const documentStatusEnum = pgEnum('document_status', ['active', 'archived', 'deleted']);

/* ---------- shared audit column helpers ---------- */
const auditCols = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
};

/* ============================================================================
   1. BRANCHES — 14 canonical (10 Medini Dental Clinics + 4 affiliated)
   ==========================================================================*/
export const branches = pgTable('branches', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  code: varchar('code', { length: 64 }).notNull(),            /* stable string id e.g. 'gelang-patah' */
  shortName: varchar('short_name', { length: 128 }).notNull(),
  fullName: varchar('full_name', { length: 256 }).notNull(),
  location: varchar('location', { length: 256 }),
  type: branchTypeEnum('type').notNull().default('main'),
  status: branchStatusEnum('status').notNull().default('active'),
  whatsappSession: varchar('whatsapp_session', { length: 128 }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('branches_org_code_uq').on(t.orgId, t.code),
  index('branches_org_idx').on(t.orgId),
]);

/* ============================================================================
   2. STAFF — demo users + employees. username immutable.
   ==========================================================================*/
export const staff = pgTable('staff', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 256 }).notNull(),
  username: varchar('username', { length: 128 }).notNull(),     /* immutable after create */
  email: varchar('email', { length: 256 }),
  phone: varchar('phone', { length: 64 }),
  role: roleEnum('role').notNull(),
  status: staffStatusEnum('status').notNull().default('Active'),
  specialization: varchar('specialization', { length: 256 }),
  passwordHash: text('password_hash'),                          /* Argon2id — set in auth task */
  doctorRef: varchar('doctor_ref', { length: 64 }),             /* maps to doctor identity for doctor role */
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  mfaSecret: text('mfa_secret'),
  inviteToken: text('invite_token'),                          /* single-use invitation token (S10 T1) */
  inviteExpiresAt: timestamp('invite_expires_at', { withTimezone: true }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('staff_org_username_uq').on(t.orgId, t.username),
  index('staff_branch_idx').on(t.branchId),
  index('staff_role_idx').on(t.role),
  /* NOTE: column refs must be literal — any JS ${} inside sql`` becomes a $1 bind param */
  check('staff_non_hq_requires_branch', sql.raw(`"role" = 'hq' OR branch_id IS NOT NULL`)),
]);

/* ============================================================================
   3. ROLE_ASSIGNMENTS — versioned (never edit in place; SUPERSEDE + new ACTIVE)
   ==========================================================================*/
export const roleAssignments = pgTable('role_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  staffId: uuid('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull(),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
  status: roleAssignmentStatusEnum('status').notNull().default('ACTIVE'),
  assignedBy: uuid('assigned_by'),
  ...auditCols,
}, (t) => [
  index('role_assign_staff_idx').on(t.staffId, t.status),
  /* only one ACTIVE assignment per staff — enforced via partial unique index in SQL migration */
]);

/* ============================================================================
   4. PATIENTS — master identity. MRN + IC unique.
   ==========================================================================*/
export const patients = pgTable('patients', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  mrn: varchar('mrn', { length: 32 }).notNull(),                /* MDN-#### */
  name: varchar('name', { length: 256 }).notNull(),
  ic: varchar('ic', { length: 64 }),                            /* IC/Passport — unique when present */
  dob: date('dob'),
  gender: varchar('gender', { length: 8 }),
  nationality: varchar('nationality', { length: 128 }),
  phone: varchar('phone', { length: 64 }),
  whatsapp: varchar('whatsapp', { length: 64 }),
  email: varchar('email', { length: 256 }),
  patientType: varchar('patient_type', { length: 32 }).default('adult'),
  contactType: varchar('contact_type', { length: 32 }).default('own'),
  guardianId: uuid('guardian_id'),
  registrationReason: varchar('registration_reason', { length: 128 }),
  preferredContact: varchar('preferred_contact', { length: 32 }),
  lastVisitAt: timestamp('last_visit_at', { withTimezone: true }),
  status: patientStatusEnum('status').notNull().default('Active'),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('patients_org_mrn_uq').on(t.orgId, t.mrn),
  uniqueIndex('patients_org_ic_uq').on(t.orgId, t.ic),
  index('patients_branch_idx').on(t.branchId),
  index('patients_name_idx').on(t.name),
]);

/* ============================================================================
   5. PATIENT_RELATIONSHIPS — family/guardian links
   ==========================================================================*/
export const patientRelationships = pgTable('patient_relationships', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  relatedPatientId: uuid('related_patient_id').references(() => patients.id, { onDelete: 'set null' }),
  relatedName: varchar('related_name', { length: 256 }),        /* when not a registered patient */
  type: varchar('type', { length: 32 }).notNull(),              /* spouse|father|mother|child|sibling|guardian|dependent */
  ...auditCols,
}, (t) => [
  index('patient_rel_patient_idx').on(t.patientId),
  index('patient_rel_related_idx').on(t.relatedPatientId),
]);

/* ============================================================================
   6A. PATIENT_TIMELINE_EVENTS — append-only feed (Sprint 2 T1).
   NOT a source of truth for patient state — a derived activity feed only.
   No updated_at / deleted_at (same append-only discipline as audit_log).
   ==========================================================================*/
export const patientTimelineEvents = pgTable('patient_timeline_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 64 }).notNull(),             /* e.g. registration|relationship_added|appointment_* */
  summary: varchar('summary', { length: 512 }).notNull(),      /* human one-liner */
  payload: jsonb('payload'),                                   /* structured context (no secrets/PII dumps) */
  actorId: uuid('actor_id'),
  actorRole: varchar('actor_role', { length: 32 }),
  source: varchar('source', { length: 32 }).notNull().default('api'),
  correlationId: varchar('correlation_id', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('patient_timeline_patient_idx').on(t.patientId, t.createdAt),
  index('patient_timeline_type_idx').on(t.type),
]);
/* NOTE: patient_timeline_events has NO updated_at / deleted_at — append-only. */

/* ============================================================================
   6B. DOCUMENTS — file records (Sprint 8). Branch-scoped, optional patient link,
   soft-delete via deleted_at. Object bytes live in S3; storage_key is the key.
   ==========================================================================*/
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  patientId: uuid('patient_id').references(() => patients.id, { onDelete: 'set null' }), /* optional link */
  title: varchar('title', { length: 256 }).notNull(),
  category: varchar('category', { length: 64 }),                 /* consent|xray|invoice|id|other */
  fileName: varchar('file_name', { length: 512 }).notNull(),     /* original upload name */
  mimeType: varchar('mime_type', { length: 128 }).notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageKey: text('storage_key').notNull(),                     /* S3 object key */
  status: documentStatusEnum('status').notNull().default('active'),
  uploadedBy: uuid('uploaded_by'),                               /* staff.id of uploader */
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  index('documents_org_branch_idx').on(t.orgId, t.branchId),
  index('documents_patient_idx').on(t.patientId),
  index('documents_status_idx').on(t.status),
]);

/* ============================================================================
   6. APPOINTMENTS — appointmentMaster. Status flow enforced.
   ==========================================================================*/
export const appointments = pgTable('appointments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  code: varchar('code', { length: 32 }).notNull(),              /* APT-#### */
  patientId: uuid('patient_id').references(() => patients.id, { onDelete: 'restrict' }),
  patientName: varchar('patient_name', { length: 256 }).notNull(),
  doctorId: uuid('doctor_id').references(() => staff.id, { onDelete: 'restrict' }),
  treatmentRef: varchar('treatment_ref', { length: 256 }),
  scheduledDate: date('scheduled_date').notNull(),
  scheduledTime: time('scheduled_time').notNull(),
  durationMin: integer('duration_min').notNull().default(30),
  status: appointmentStatusEnum('status').notNull().default('booked'),
  notes: text('notes'),
  version: integer('version').notNull().default(1),             /* optimistic locking */
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('appt_org_code_uq').on(t.orgId, t.code),
  index('appt_branch_date_idx').on(t.branchId, t.scheduledDate),
  index('appt_doctor_date_idx').on(t.doctorId, t.scheduledDate),
  index('appt_patient_idx').on(t.patientId),
  check('appt_duration_positive', sql`duration_min > 0`),
]);

/* ============================================================================
   7. PAYMENT_STATUS — CRM = STATUS LAYER ONLY (v1.1). External payment.
   PENDING / PAID / OVERDUE. NOT a payment gateway.
   ==========================================================================*/
export const paymentStatus = pgTable('payment_status', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  status: paymentStatusEnum('status').notNull().default('PENDING'),
  paidDate: date('paid_date'),
  updatedByRole: varchar('updated_by_role', { length: 32 }),
  paymentReference: varchar('payment_reference', { length: 128 }), /* external ref (FPX/Card) */
  /* Sprint 4 (S4-T1) — extend for Finance: confirm tracking + external source */
  confirmedBy: uuid('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  externalRef: varchar('external_ref', { length: 128 }),
  sourceSystem: varchar('source_system', { length: 32 }).default('external'),
  ...auditCols,
}, (t) => [
  uniqueIndex('payment_status_patient_uq').on(t.patientId),
  index('payment_status_branch_idx').on(t.branchId),
  index('payment_status_status_idx').on(t.status),
]);

/* ============================================================================
   8. AUDIT_LOG — append-only, immutable governance/audit trail.
   ==========================================================================*/
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id'),
  actorId: uuid('actor_id'),
  actorRole: varchar('actor_role', { length: 32 }).notNull(),
  action: varchar('action', { length: 128 }).notNull(),
  entity: varchar('entity', { length: 128 }).notNull(),
  entityId: varchar('entity_id', { length: 128 }),
  before: jsonb('before'),
  after: jsonb('after'),
  source: auditSourceEnum('source').notNull().default('api'),
  correlationId: varchar('correlation_id', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('audit_entity_idx').on(t.entity, t.entityId),
  index('audit_actor_idx').on(t.actorId),
  index('audit_branch_idx').on(t.branchId),
  index('audit_created_idx').on(t.createdAt),
  index('audit_before_gin').using('gin', t.before),
  index('audit_after_gin').using('gin', t.after),
]);
/* NOTE: audit_log has NO updated_at / deleted_at — append-only by design. */

/* ============================================================================
   12. PANEL_COMPANIES — org-wide payor master data (Sprint 2A T1).
   NO branch_id by design: payer references are reusable across branches.
   NO invoice/payment/revenue/outstanding/bukku columns (ADR-004).
   RLS (0006): read = hq/branch_manager; write = hq only.
   ==========================================================================*/
export const panelCompanies = pgTable('panel_companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  code: varchar('code', { length: 32 }).notNull(),              /* PNL-#### (allocator: 2A-T2) */
  name: varchar('name', { length: 256 }).notNull(),
  pic: varchar('pic', { length: 256 }),
  phone: varchar('phone', { length: 64 }),
  address: text('address'),
  status: payorStatusEnum('status').notNull().default('Active'),
  source: varchar('source', { length: 16 }).notNull().default('custom'), /* custom|builtin|seed */
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('panel_companies_org_code_uq').on(t.orgId, t.code),
  index('panel_companies_org_status_idx').on(t.orgId, t.status),
  /* case-insensitive name uniqueness per org = partial functional index
     (org_id, lower(name)) WHERE deleted_at IS NULL — SQL in 0006 migration
     (same convention as nullable patients_org_ic_uq: live rows only). */
]);

/* ============================================================================
   13. INSURANCE_COMPANIES — org-wide insurance master data (initially empty).
   Same conventions as panel_companies.
   ==========================================================================*/
export const insuranceCompanies = pgTable('insurance_companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  code: varchar('code', { length: 32 }).notNull(),              /* INS-#### (allocator: 2A-T2) */
  name: varchar('name', { length: 256 }).notNull(),
  pic: varchar('pic', { length: 256 }),
  phone: varchar('phone', { length: 64 }),
  address: text('address'),
  status: payorStatusEnum('status').notNull().default('Active'),
  source: varchar('source', { length: 16 }).notNull().default('custom'),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('insurance_companies_org_code_uq').on(t.orgId, t.code),
  index('insurance_companies_org_status_idx').on(t.orgId, t.status),
]);

/* ============================================================================
   9. DOMAIN_EVENTS — transactional outbox.
   ==========================================================================*/
export const domainEvents = pgTable('domain_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id'),
  eventType: varchar('event_type', { length: 128 }).notNull(),
  payload: jsonb('payload').notNull(),
  correlationId: varchar('correlation_id', { length: 128 }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
}, (t) => [
  index('domain_events_type_idx').on(t.eventType),
  index('domain_events_unpublished_idx').on(t.publishedAt),
]);

/* ============================================================================
   10. PROCESSED_EVENTS — consumer idempotency (effectively-once).
   ==========================================================================*/
export const processedEvents = pgTable('processed_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id'),
  branchId: uuid('branch_id'),
  consumer: varchar('consumer', { length: 128 }).notNull(),
  eventId: uuid('event_id').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('processed_events_consumer_event_uq').on(t.consumer, t.eventId),
]);

/* ============================================================================
   11. IDEMPOTENCY_KEYS — duplicate-submission prevention (persistent).
   ==========================================================================*/
export const idempotencyKeys = pgTable('idempotency_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: varchar('key', { length: 256 }).notNull(),
  scope: varchar('scope', { length: 256 }).notNull(),           /* route+actor — prevents cross-user replay */
  status: idempotencyStatusEnum('status').notNull().default('in_progress'),
  response: jsonb('response'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex('idempotency_scope_key_uq').on(t.scope, t.key),
  index('idempotency_expires_idx').on(t.expiresAt),
]);

/* ============================================================================
   14. TREATMENT_CATALOG — org-wide clinical reference data (Sprint 3 S3-A).
   NO price/cost/invoice columns (ADR-004): Clinical owns treatment IDENTITY;
   Finance will reference treatment_id later. RLS (0007): read all roles,
   write HQ only.
   ==========================================================================*/
export const treatmentCatalog = pgTable('treatment_catalog', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  code: varchar('code', { length: 32 }).notNull(),               /* TRT-#### */
  name: varchar('name', { length: 256 }).notNull(),
  category: varchar('category', { length: 64 }).notNull(),
  durationMin: integer('duration_min').notNull().default(30),
  isActive: boolean('is_active').notNull().default(true),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('treatment_catalog_org_code_uq').on(t.orgId, t.code),
  index('treatment_catalog_org_cat_idx').on(t.orgId, t.category),
  check('treatment_catalog_duration_positive', sql`duration_min > 0`),
]);

/* ============================================================================
   15. ENCOUNTERS — canonical clinical case (Sprint 3). ENC-####.
   ==========================================================================*/
export const encounters = pgTable('encounters', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'restrict' }),
  doctorId: uuid('doctor_id').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  encounterCode: varchar('encounter_code', { length: 32 }).notNull(),
  status: encounterStatusEnum('status').notNull().default('open'),
  chiefComplaint: varchar('chief_complaint', { length: 512 }),
  allergyAcknowledgedAt: timestamp('allergy_acknowledged_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('encounters_org_code_uq').on(t.orgId, t.encounterCode),
  index('encounters_patient_idx').on(t.patientId),
  index('encounters_branch_idx').on(t.branchId),
  index('encounters_doctor_idx').on(t.doctorId),
  index('encounters_appt_idx').on(t.appointmentId),
  check('encounters_completed_requires_ts', sql`status <> 'completed' OR completed_at IS NOT NULL`),
]);

/* ============================================================================
   16. CLINICAL_NOTES — SOAP, immutable after sign (ADR-009). Append-only
   versions: amendment = new row with amendsNoteId. No updated_at/deleted_at.
   ==========================================================================*/
export const clinicalNotes = pgTable('clinical_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounterId: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'restrict' }),
  doctorId: uuid('doctor_id').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  soapSubjective: text('soap_subjective'),
  soapObjective: text('soap_objective'),
  soapAssessment: text('soap_assessment'),
  soapPlan: text('soap_plan'),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  signedBy: uuid('signed_by'),
  amendsNoteId: uuid('amends_note_id'),
  supersededByNoteId: uuid('superseded_by_note_id'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (t) => [
  index('clinical_notes_encounter_idx').on(t.encounterId),
  index('clinical_notes_patient_idx').on(t.patientId),
  index('clinical_notes_doctor_idx').on(t.doctorId),
  check('clinical_notes_signed_complete', sql`signed_at IS NULL OR signed_by IS NOT NULL`),
]);

/* ============================================================================
   17. TOOTH_RECORDS — FDI chart snapshot per encounter (permanent dentition).
   ==========================================================================*/
export const toothRecords = pgTable('tooth_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounterId: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'restrict' }),
  doctorId: uuid('doctor_id').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  fdiNo: integer('fdi_no').notNull(),
  condition: toothConditionEnum('condition').notNull(),
  surfaces: jsonb('surfaces'),
  notes: varchar('notes', { length: 512 }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('tooth_records_enc_tooth_uq').on(t.encounterId, t.fdiNo),
  index('tooth_records_patient_idx').on(t.patientId, t.fdiNo),
]);

/* ============================================================================
   18. TREATMENT_PLANS — lifecycle draft→proposed→accepted→active→completed|
   cancelled (Blueprint §5/§28). TPL-####. consent_required gates acceptance.
   ==========================================================================*/
export const treatmentPlans = pgTable('treatment_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounterId: uuid('encounter_id').references(() => encounters.id, { onDelete: 'restrict' }),
  doctorId: uuid('doctor_id').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  planCode: varchar('plan_code', { length: 32 }).notNull(),
  title: varchar('title', { length: 256 }).notNull(),
  status: planStatusEnum('status').notNull().default('draft'),
  consentRequired: boolean('consent_required').notNull().default(false),
  proposedAt: timestamp('proposed_at', { withTimezone: true }),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: varchar('cancel_reason', { length: 512 }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('treatment_plans_org_code_uq').on(t.orgId, t.planCode),
  index('treatment_plans_patient_idx').on(t.patientId),
  index('treatment_plans_branch_idx').on(t.branchId),
  index('treatment_plans_doctor_idx').on(t.doctorId),
  index('treatment_plans_encounter_idx').on(t.encounterId),
]);

/* ============================================================================
   19. TREATMENT_PLAN_ITEMS — catalog-referenced lines. NO price (ADR-004).
   ==========================================================================*/
export const treatmentPlanItems = pgTable('treatment_plan_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  planId: uuid('plan_id').notNull().references(() => treatmentPlans.id, { onDelete: 'cascade' }),
  treatmentId: uuid('treatment_id').references(() => treatmentCatalog.id, { onDelete: 'restrict' }),
  description: varchar('description', { length: 256 }).notNull(),
  toothFdi: integer('tooth_fdi'),
  quantity: integer('quantity').notNull().default(1),
  status: planItemStatusEnum('status').notNull().default('pending'),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  index('treatment_plan_items_plan_idx').on(t.planId),
  index('treatment_plan_items_treatment_idx').on(t.treatmentId),
  check('treatment_plan_items_qty_positive', sql`quantity > 0`),
]);

/* ============================================================================
   20. TREATMENT_SESSIONS — append-only performed sessions of a plan.
   ==========================================================================*/
export const treatmentSessions = pgTable('treatment_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  planId: uuid('plan_id').notNull().references(() => treatmentPlans.id, { onDelete: 'restrict' }),
  encounterId: uuid('encounter_id').references(() => encounters.id, { onDelete: 'restrict' }),
  doctorId: uuid('doctor_id').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  sessionNo: integer('session_no').notNull(),
  performedAt: timestamp('performed_at', { withTimezone: true }).notNull().defaultNow(),
  summary: varchar('summary', { length: 1024 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (t) => [
  uniqueIndex('treatment_sessions_plan_no_uq').on(t.planId, t.sessionNo),
  index('treatment_sessions_plan_idx').on(t.planId),
]);

/* ============================================================================
   21. CONSENT_TEMPLATES — org-wide, versioned (new version = new row).
   ==========================================================================*/
export const consentTemplates = pgTable('consent_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  title: varchar('title', { length: 256 }).notNull(),
  body: text('body').notNull(),
  version: integer('version').notNull().default(1),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (t) => [
  uniqueIndex('consent_templates_title_version_uq').on(t.orgId, sql`lower(${t.title})`, t.version),
]);

/* ============================================================================
   22. CONSENT_RECORDS — immutable proof of consent (ADR-009). SELECT/INSERT.
   ==========================================================================*/
export const consentRecords = pgTable('consent_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  templateId: uuid('template_id').notNull().references(() => consentTemplates.id, { onDelete: 'restrict' }),
  templateVersion: integer('template_version').notNull(),
  encounterId: uuid('encounter_id').references(() => encounters.id, { onDelete: 'restrict' }),
  planId: uuid('plan_id').references(() => treatmentPlans.id, { onDelete: 'restrict' }),
  method: consentMethodEnum('method').notNull(),
  consentedBy: varchar('consented_by', { length: 256 }).notNull(),
  witnessedBy: uuid('witnessed_by').references(() => staff.id, { onDelete: 'restrict' }),
  recordedBy: uuid('recorded_by').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  consentedAt: timestamp('consented_at', { withTimezone: true }).notNull().defaultNow(),
  notes: varchar('notes', { length: 1024 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (t) => [
  index('consent_records_patient_idx').on(t.patientId),
  index('consent_records_plan_idx').on(t.planId),
]);

/* ============================================================================
   23. IMAGING_RECORDS — metadata ONLY (file bytes = future Documents domain).
   ==========================================================================*/
export const imagingRecords = pgTable('imaging_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounterId: uuid('encounter_id').references(() => encounters.id, { onDelete: 'restrict' }),
  uploadedBy: uuid('uploaded_by').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  kind: imagingKindEnum('kind').notNull(),
  title: varchar('title', { length: 256 }).notNull(),
  fileRef: varchar('file_ref', { length: 512 }),
  takenAt: timestamp('taken_at', { withTimezone: true }),
  notes: varchar('notes', { length: 512 }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  index('imaging_records_patient_idx').on(t.patientId),
  index('imaging_records_branch_idx').on(t.branchId),
  index('imaging_records_encounter_idx').on(t.encounterId),
]);

/* ============================================================================
   24. PRESCRIPTIONS — medication orders (encounter doctor).
   ==========================================================================*/
export const prescriptions = pgTable('prescriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounterId: uuid('encounter_id').references(() => encounters.id, { onDelete: 'restrict' }),
  doctorId: uuid('doctor_id').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  medication: varchar('medication', { length: 256 }).notNull(),
  dosage: varchar('dosage', { length: 128 }),
  frequency: varchar('frequency', { length: 128 }),
  durationDays: integer('duration_days'),
  notes: varchar('notes', { length: 512 }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  index('prescriptions_patient_idx').on(t.patientId),
  index('prescriptions_branch_idx').on(t.branchId),
  index('prescriptions_doctor_idx').on(t.doctorId),
  check('prescriptions_duration_positive', sql`duration_days IS NULL OR duration_days > 0`),
]);

/* ============================================================================
   25. ADVERSE_EVENTS — immutable safety record (SELECT/INSERT only).
   ==========================================================================*/
export const adverseEvents = pgTable('adverse_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounterId: uuid('encounter_id').references(() => encounters.id, { onDelete: 'restrict' }),
  reportedBy: uuid('reported_by').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  severity: adverseSeverityEnum('severity').notNull(),
  description: text('description').notNull(),
  actionTaken: text('action_taken'),
  reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (t) => [
  index('adverse_events_patient_idx').on(t.patientId),
]);

/* ============================================================================
   26. REFERRALS — outgoing specialist referrals.
   ==========================================================================*/
export const referrals = pgTable('referrals', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounterId: uuid('encounter_id').references(() => encounters.id, { onDelete: 'restrict' }),
  doctorId: uuid('doctor_id').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  toSpecialty: varchar('to_specialty', { length: 128 }).notNull(),
  toProvider: varchar('to_provider', { length: 256 }),
  reason: text('reason').notNull(),
  status: referralStatusEnum('status').notNull().default('pending'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  index('referrals_patient_idx').on(t.patientId),
  index('referrals_branch_idx').on(t.branchId),
  index('referrals_doctor_idx').on(t.doctorId),
]);

/* ============================================================================
   27. CLINICAL_TIMELINE_EVENTS — append-only derived feed (patient 360).
   ==========================================================================*/
export const clinicalTimelineEvents = pgTable('clinical_timeline_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 64 }).notNull(),
  summary: varchar('summary', { length: 512 }).notNull(),
  payload: jsonb('payload'),
  actorId: uuid('actor_id'),
  actorRole: varchar('actor_role', { length: 32 }),
  correlationId: varchar('correlation_id', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('clinical_timeline_patient_idx').on(t.patientId, t.createdAt),
  index('clinical_timeline_type_idx').on(t.type),
]);

/* ============================================================================
   SPRINT 4 (S4-T1) — FINANCE FOUNDATION
   Operational financial records. NOT POS, NOT accounting, NOT invoice issuer.
   POS transacts. CRM records/monitors/calculates/alerts. Bukku accounts.
   Money: numeric(19,4). NO float. Allocators: sal/exp/rec/cst/lab/com/ext.
   ==========================================================================*/

/* ---------- Finance enums ---------- */
export const saleRecordStatusEnum = pgEnum('sale_record_status', ['recorded', 'confirmed', 'cancelled']);
export const expenseStatusEnum = pgEnum('expense_status', ['draft', 'pending_approval', 'approved', 'paid', 'rejected', 'cancelled']);
export const recurringStatusEnum = pgEnum('recurring_status', ['active', 'paused', 'cancelled']);
export const labPayableStatusEnum = pgEnum('lab_payable_status', ['DRAFT', 'OUTSTANDING', 'PARTIALLY_PAID', 'PAID', 'VOID']);
export const commissionStatusEnum = pgEnum('commission_status', ['calculated', 'pending_review', 'approved', 'scheduled', 'paid', 'cancelled']);
export const financeAlertSeverityEnum = pgEnum('finance_alert_severity', ['critical', 'high', 'medium', 'low', 'info']);
export const financeAlertStatusEnum = pgEnum('finance_alert_status', ['open', 'acknowledged', 'resolved', 'dismissed']);
/* Sprint 10 — finance config (managed lists + alert-rule definitions). */
export const financeManagedStatusEnum = pgEnum('finance_managed_status', ['active', 'archived']);
export const financeAlertComparatorEnum = pgEnum('finance_alert_comparator', ['lt', 'lte', 'gt', 'gte', 'eq']);
export const syncStatusEnum = pgEnum('sync_status', ['pending', 'queued', 'syncing', 'synced', 'error', 'conflict']);
export const reconciliationStatusEnum = pgEnum('reconciliation_status', ['pending', 'matched', 'conflict', 'resolved']);
/* Sprint 5 T1 — Marketing is operational intent and case management only. */
export const leadStatusEnum = pgEnum('lead_status', ['new', 'contacted', 'qualified', 'converted', 'lost']);
export const campaignStatusEnum = pgEnum('campaign_status', ['draft', 'pending_approval', 'approved', 'cancelled', 'archived']);
/* Sprint 9 — marketing content (templates + saved segments). */
export const marketingChannelEnum = pgEnum('marketing_channel', ['whatsapp', 'sms', 'email']);
export const marketingTemplateStatusEnum = pgEnum('marketing_template_status', ['draft', 'active', 'archived']);
export const recallStatusEnum = pgEnum('recall_status', ['open', 'completed', 'cancelled']);
export const followUpStatusEnum = pgEnum('follow_up_status', ['open', 'completed', 'cancelled']);
/* Sprint 5 T2 — Operations: operational workflow records only. */
export const doctorStatusStateEnum = pgEnum('doctor_status_state', ['available', 'busy', 'break', 'offline']);
export const checklistStateEnum = pgEnum('checklist_state', ['open', 'in_progress', 'completed', 'cancelled']);
export const taskStateEnum = pgEnum('task_state', ['open', 'in_progress', 'completed', 'cancelled']);
export const incidentStateEnum = pgEnum('incident_state', ['open', 'acknowledged', 'resolved', 'closed']);
export const incidentSeverityEnum = pgEnum('incident_severity', ['critical', 'high', 'medium', 'low']);
export const taskPriorityEnum = pgEnum('task_priority', ['urgent', 'high', 'normal', 'low']);
/* Sprint 5 T3 — Operations-owned lab coordination case (Finance owns payable). */
export const labCaseStateEnum = pgEnum('lab_case_state', ['open', 'in_progress', 'ready_for_billing', 'billing_submitted', 'completed', 'cancelled']);

/* 28. SALE_RECORDS — revenue analytics (POS reference, CRM=record). */
export const saleRecords = pgTable('sale_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  patientId: uuid('patient_id').references(() => patients.id, { onDelete: 'restrict' }),
  saleCode: varchar('sale_code', { length: 32 }).notNull(),
  externalRef: varchar('external_ref', { length: 128 }),
  sourceSystem: varchar('source_system', { length: 32 }).notNull().default('pos'),
  amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
  saleDate: date('sale_date').notNull(),
  status: saleRecordStatusEnum('status').notNull().default('recorded'),
  notes: varchar('notes', { length: 512 }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('sale_records_org_code_uq').on(t.orgId, t.saleCode),
  index('sale_records_branch_idx').on(t.branchId),
  index('sale_records_patient_idx').on(t.patientId),
  index('sale_records_date_idx').on(t.saleDate),
  index('sale_records_status_idx').on(t.status),
]);

/* 29. EXPENSES — operational expense records (CRM-owned). */
export const expenses = pgTable('expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  expenseCode: varchar('expense_code', { length: 32 }).notNull(),
  category: varchar('category', { length: 64 }).notNull(),
  subcategory: varchar('subcategory', { length: 128 }),
  payee: varchar('payee', { length: 256 }).notNull(),
  amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
  expenseDate: date('expense_date').notNull(),
  dueDate: date('due_date'),
  status: expenseStatusEnum('status').notNull().default('draft'),
  recurringId: uuid('recurring_id'),
  externalRef: varchar('external_ref', { length: 128 }),
  notes: varchar('notes', { length: 512 }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('expenses_org_code_uq').on(t.orgId, t.expenseCode),
  index('expenses_branch_idx').on(t.branchId),
  index('expenses_category_idx').on(t.category),
  index('expenses_status_idx').on(t.status),
  index('expenses_due_date_idx').on(t.dueDate),
  index('expenses_recurring_idx').on(t.recurringId),
]);

/* 30. RECURRING_COMMITMENTS — recurring items (CRM-owned). */
export const recurringCommitments = pgTable('recurring_commitments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  recurringCode: varchar('recurring_code', { length: 32 }).notNull(),
  name: varchar('name', { length: 256 }).notNull(),
  category: varchar('category', { length: 64 }).notNull(),
  amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
  frequency: varchar('frequency', { length: 32 }).notNull(),
  nextDueDate: date('next_due_date').notNull(),
  status: recurringStatusEnum('status').notNull().default('active'),
  autoCreate: boolean('auto_create').notNull().default(false),
  externalRef: varchar('external_ref', { length: 128 }),
  notes: varchar('notes', { length: 512 }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('recurring_commitments_org_code_uq').on(t.orgId, t.recurringCode),
  index('recurring_commitments_branch_idx').on(t.branchId),
  index('recurring_commitments_category_idx').on(t.category),
  index('recurring_commitments_next_due_idx').on(t.nextDueDate),
  index('recurring_commitments_status_idx').on(t.status),
]);

/* 31. TREATMENT_COSTS — treatment cost (Finance owns, link Clinical). */
export const treatmentCosts = pgTable('treatment_costs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  planId: uuid('plan_id').notNull().references(() => treatmentPlans.id, { onDelete: 'restrict' }),
  encounterId: uuid('encounter_id').references(() => encounters.id, { onDelete: 'restrict' }),
  costCode: varchar('cost_code', { length: 32 }).notNull(),
  treatmentId: uuid('treatment_id').references(() => treatmentCatalog.id, { onDelete: 'restrict' }),
  description: varchar('description', { length: 256 }).notNull(),
  quantity: integer('quantity').notNull().default(1),
  unitCost: numeric('unit_cost', { precision: 19, scale: 4 }).notNull(),
  totalCost: numeric('total_cost', { precision: 19, scale: 4 }).notNull(),
  costDate: date('cost_date').notNull(),
  externalRef: varchar('external_ref', { length: 128 }),
  notes: varchar('notes', { length: 512 }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('treatment_costs_org_code_uq').on(t.orgId, t.costCode),
  index('treatment_costs_branch_idx').on(t.branchId),
  index('treatment_costs_patient_idx').on(t.patientId),
  index('treatment_costs_plan_idx').on(t.planId),
  index('treatment_costs_encounter_idx').on(t.encounterId),
  index('treatment_costs_treatment_idx').on(t.treatmentId),
  index('treatment_costs_date_idx').on(t.costDate),
]);

/* 32. LAB_PAYABLES — lab cost lifecycle (operational tracking). */
export const labPayables = pgTable('lab_payables', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  treatmentCostId: uuid('treatment_cost_id').references(() => treatmentCosts.id, { onDelete: 'restrict' }),
  labCode: varchar('lab_code', { length: 32 }).notNull(),
  labName: varchar('lab_name', { length: 256 }).notNull(),
  caseRef: varchar('case_ref', { length: 128 }),
  externalInvoiceRef: varchar('external_invoice_ref', { length: 128 }),
  amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
  paidAmount: numeric('paid_amount', { precision: 19, scale: 4 }).notNull().default('0'),
  outstandingAmount: numeric('outstanding_amount', { precision: 19, scale: 4 }).notNull(),
  dueDate: date('due_date').notNull(),
  status: labPayableStatusEnum('status').notNull().default('DRAFT'),
  externalRef: varchar('external_ref', { length: 128 }),
  notes: varchar('notes', { length: 512 }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('lab_payables_org_code_uq').on(t.orgId, t.labCode),
  index('lab_payables_branch_idx').on(t.branchId),
  index('lab_payables_treatment_cost_idx').on(t.treatmentCostId),
  index('lab_payables_status_idx').on(t.status),
  index('lab_payables_due_date_idx').on(t.dueDate),
]);

/* 33. COMMISSION_LEDGER — doctor commission calculation (CRM source of truth). */
export const commissionLedger = pgTable('commission_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  doctorId: uuid('doctor_id').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  commissionCode: varchar('commission_code', { length: 32 }).notNull(),
  period: varchar('period', { length: 32 }).notNull(),
  grossRevenue: numeric('gross_revenue', { precision: 19, scale: 4 }).notNull(),
  eligibleDirectCosts: numeric('eligible_direct_costs', { precision: 19, scale: 4 }).notNull().default('0'),
  commissionBase: numeric('commission_base', { precision: 19, scale: 4 }).notNull(),
  rate: numeric('rate', { precision: 5, scale: 4 }).notNull(),
  commissionAmount: numeric('commission_amount', { precision: 19, scale: 4 }).notNull(),
  adjustment: numeric('adjustment', { precision: 19, scale: 4 }).notNull().default('0'),
  netPayable: numeric('net_payable', { precision: 19, scale: 4 }).notNull(),
  paidAmount: numeric('paid_amount', { precision: 19, scale: 4 }).notNull().default('0'),
  outstandingAmount: numeric('outstanding_amount', { precision: 19, scale: 4 }).notNull(),
  status: commissionStatusEnum('status').notNull().default('calculated'),
  externalRef: varchar('external_ref', { length: 128 }),
  notes: varchar('notes', { length: 512 }),
  version: integer('version').notNull().default(1),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('commission_ledger_org_code_uq').on(t.orgId, t.commissionCode),
  index('commission_ledger_branch_idx').on(t.branchId),
  index('commission_ledger_doctor_idx').on(t.doctorId),
  index('commission_ledger_period_idx').on(t.period),
  index('commission_ledger_status_idx').on(t.status),
]);

/* 34. COMMISSION_PAYOUTS — payout status tracking. */
export const commissionPayouts = pgTable('commission_payouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  commissionLedgerId: uuid('commission_ledger_id').notNull().references(() => commissionLedger.id, { onDelete: 'restrict' }),
  payoutDate: date('payout_date').notNull(),
  amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
  method: varchar('method', { length: 32 }),
  externalRef: varchar('external_ref', { length: 128 }),
  notes: varchar('notes', { length: 512 }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  index('commission_payouts_branch_idx').on(t.branchId),
  index('commission_payouts_ledger_idx').on(t.commissionLedgerId),
  index('commission_payouts_date_idx').on(t.payoutDate),
]);

/* 35. FINANCE_ALERTS — radar alerts (derived, management alert layer). */
export const financeAlerts = pgTable('finance_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  alertType: varchar('alert_type', { length: 64 }).notNull(),
  severity: financeAlertSeverityEnum('severity').notNull(),
  status: financeAlertStatusEnum('status').notNull().default('open'),
  entityType: varchar('entity_type', { length: 64 }),
  entityId: uuid('entity_id'),
  title: varchar('title', { length: 256 }).notNull(),
  message: text('message').notNull(),
  amount: numeric('amount', { precision: 19, scale: 4 }),
  dueDate: date('due_date'),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  acknowledgedBy: uuid('acknowledged_by'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by'),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  index('finance_alerts_branch_idx').on(t.branchId),
  index('finance_alerts_type_idx').on(t.alertType),
  index('finance_alerts_severity_idx').on(t.severity),
  index('finance_alerts_status_idx').on(t.status),
  index('finance_alerts_entity_idx').on(t.entityType, t.entityId),
]);

/* ============================================================================
   SPRINT 10 — FINANCE CONFIG: managed expense categories, payment methods, and
   alert-rule definitions. Branch-scoped; view = HQ + branch_manager, write = HQ.
   ==========================================================================*/
export const expenseCategories = pgTable('expense_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 128 }).notNull(),
  code: varchar('code', { length: 64 }),
  description: varchar('description', { length: 256 }),
  status: financeManagedStatusEnum('status').notNull().default('active'),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('expense_categories_branch_status_idx').on(t.branchId, t.status)]);

export const paymentMethods = pgTable('payment_methods', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 128 }).notNull(),
  kind: varchar('kind', { length: 32 }),                   /* cash|card|bank_transfer|ewallet|other */
  details: varchar('details', { length: 256 }),
  status: financeManagedStatusEnum('status').notNull().default('active'),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('payment_methods_branch_status_idx').on(t.branchId, t.status)]);

export const financeAlertRules = pgTable('finance_alert_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 256 }).notNull(),
  metric: varchar('metric', { length: 64 }).notNull(),      /* expense_due|revenue_below|payable_overdue */
  comparator: financeAlertComparatorEnum('comparator').notNull(),
  threshold: numeric('threshold', { precision: 19, scale: 4 }).notNull(),
  severity: financeAlertSeverityEnum('severity').notNull(),
  windowDays: integer('window_days'),
  active: boolean('active').notNull().default(true),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('finance_alert_rules_branch_active_idx').on(t.branchId, t.active)]);

/* 36. EXTERNAL_INVOICE_REFS — POS/Bukku invoice reference (NOT invoice engine). */
export const externalInvoiceRefs = pgTable('external_invoice_refs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  patientId: uuid('patient_id').references(() => patients.id, { onDelete: 'restrict' }),
  treatmentCostId: uuid('treatment_cost_id').references(() => treatmentCosts.id, { onDelete: 'restrict' }),
  refCode: varchar('ref_code', { length: 32 }).notNull(),
  externalInvoiceNumber: varchar('external_invoice_number', { length: 128 }).notNull(),
  sourceSystem: varchar('source_system', { length: 32 }).notNull(),
  amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
  invoiceDate: date('invoice_date').notNull(),
  status: varchar('status', { length: 32 }),
  externalRef: varchar('external_ref', { length: 128 }),
  syncMetadata: jsonb('sync_metadata'),
  notes: varchar('notes', { length: 512 }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('external_invoice_refs_org_code_uq').on(t.orgId, t.refCode),
  uniqueIndex('external_invoice_refs_org_external_uq').on(t.orgId, t.sourceSystem, t.externalInvoiceNumber),
  index('external_invoice_refs_branch_idx').on(t.branchId),
  index('external_invoice_refs_patient_idx').on(t.patientId),
  index('external_invoice_refs_treatment_cost_idx').on(t.treatmentCostId),
  index('external_invoice_refs_external_number_idx').on(t.externalInvoiceNumber),
]);

/* 37. BUKKU_SYNC_RECORDS — sync queue + metadata (architecture ONLY). */
export const bukkuSyncRecords = pgTable('bukku_sync_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  entityType: varchar('entity_type', { length: 64 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  branchId: uuid('branch_id'),
  syncStatus: syncStatusEnum('sync_status').notNull().default('pending'),
  bukkuId: varchar('bukku_id', { length: 128 }),
  idempotencyKey: varchar('idempotency_key', { length: 256 }).notNull(),
  version: integer('version').notNull().default(1),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  syncError: text('sync_error'),
  retryCount: integer('retry_count').notNull().default(0),
  syncMetadata: jsonb('sync_metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
}, (t) => [
  uniqueIndex('bukku_sync_records_org_entity_uq').on(t.orgId, t.entityType, t.entityId),
  uniqueIndex('bukku_sync_records_idempotency_uq').on(t.idempotencyKey),
  index('bukku_sync_records_status_idx').on(t.syncStatus),
  index('bukku_sync_records_entity_idx').on(t.entityType, t.entityId),
]);

/* 38. RECONCILIATION_RECORDS — conflict detection + audit. */
export const reconciliationRecords = pgTable('reconciliation_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  entityType: varchar('entity_type', { length: 64 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  bukkuSyncRecordId: uuid('bukku_sync_record_id').references(() => bukkuSyncRecords.id, { onDelete: 'restrict' }),
  reconciliationStatus: reconciliationStatusEnum('reconciliation_status').notNull().default('pending'),
  crmValue: jsonb('crm_value'),
  bukkuValue: jsonb('bukku_value'),
  conflictFields: text('conflict_fields').array(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by'),
  resolutionNotes: text('resolution_notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
}, (t) => [
  index('reconciliation_records_entity_idx').on(t.entityType, t.entityId),
  index('reconciliation_records_status_idx').on(t.reconciliationStatus),
  index('reconciliation_records_sync_idx').on(t.bukkuSyncRecordId),
]);

/* ============================================================================
   SPRINT 5 T2 — OPERATIONS FOUNDATION
   ==========================================================================*/
export const doctorStatuses = pgTable('doctor_statuses', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  doctorId: uuid('doctor_id').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  status: doctorStatusStateEnum('status').notNull(),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull().defaultNow(),
  note: varchar('note', { length: 256 }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('doctor_statuses_branch_idx').on(t.branchId), index('doctor_statuses_doctor_effective_idx').on(t.doctorId, t.effectiveAt)]);

export const checklists = pgTable('checklists', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  checklistDate: date('checklist_date').notNull(),
  shift: varchar('shift', { length: 32 }),
  title: varchar('title', { length: 256 }).notNull(),
  items: jsonb('items').notNull(),
  ownerId: uuid('owner_id').references(() => staff.id, { onDelete: 'restrict' }),
  status: checklistStateEnum('status').notNull().default('open'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('checklists_branch_date_idx').on(t.branchId, t.checklistDate), index('checklists_branch_status_idx').on(t.branchId, t.status)]);

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  title: varchar('title', { length: 256 }).notNull(),
  description: varchar('description', { length: 1024 }),
  priority: taskPriorityEnum('priority').notNull().default('normal'),
  assigneeId: uuid('assignee_id').references(() => staff.id, { onDelete: 'restrict' }),
  dueDate: date('due_date'),
  status: taskStateEnum('status').notNull().default('open'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('tasks_branch_status_idx').on(t.branchId, t.status), index('tasks_assignee_idx').on(t.assigneeId), index('tasks_due_date_idx').on(t.dueDate)]);

export const incidents = pgTable('incidents', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  title: varchar('title', { length: 256 }).notNull(),
  description: varchar('description', { length: 2048 }),
  severity: incidentSeverityEnum('severity').notNull(),
  ownerId: uuid('owner_id').references(() => staff.id, { onDelete: 'restrict' }),
  status: incidentStateEnum('status').notNull().default('open'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('incidents_branch_status_idx').on(t.branchId, t.status), index('incidents_branch_severity_idx').on(t.branchId, t.severity)]);

/* ============================================================================
   SPRINT 5 T3 — LABCASE (Operations-owned; Finance owns lab_payables)
   ==========================================================================*/
export const labCases = pgTable('lab_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounterId: uuid('encounter_id').references(() => encounters.id, { onDelete: 'restrict' }),
  labVendor: varchar('lab_vendor', { length: 256 }).notNull(),
  workDescription: varchar('work_description', { length: 512 }).notNull(),
  dueDate: date('due_date'),
  status: labCaseStateEnum('status').notNull().default('open'),
  billingSubmittedAt: timestamp('billing_submitted_at', { withTimezone: true }),
  billingSubmittedBy: uuid('billing_submitted_by').references(() => staff.id, { onDelete: 'restrict' }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('lab_cases_branch_status_idx').on(t.branchId, t.status), index('lab_cases_patient_idx').on(t.patientId)]);

/* ---------- Type exports ---------- */
/* ============================================================================
   SPRINT 5 T1 — MARKETING FOUNDATION
   ==========================================================================*/
export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 256 }).notNull(),
  phone: varchar('phone', { length: 64 }),
  source: varchar('source', { length: 64 }).notNull(),
  interestedTreatment: varchar('interested_treatment', { length: 256 }),
  status: leadStatusEnum('status').notNull().default('new'),
  assigneeId: uuid('assignee_id').references(() => staff.id, { onDelete: 'restrict' }),
  patientId: uuid('patient_id').references(() => patients.id, { onDelete: 'restrict' }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('leads_branch_status_idx').on(t.branchId, t.status), index('leads_org_source_idx').on(t.orgId, t.source)]);

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 256 }).notNull(),
  intent: varchar('intent', { length: 512 }).notNull(),
  audienceDefinition: jsonb('audience_definition').notNull(),
  templateReference: varchar('template_reference', { length: 256 }),
  status: campaignStatusEnum('status').notNull().default('draft'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: uuid('approved_by').references(() => staff.id, { onDelete: 'restrict' }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('campaigns_branch_status_idx').on(t.branchId, t.status)]);

export const recallRules = pgTable('recall_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 256 }).notNull(),
  treatmentCode: varchar('treatment_code', { length: 64 }),
  intervalMonths: integer('interval_months').notNull(),
  active: boolean('active').notNull().default(true),
  effectiveFrom: date('effective_from').notNull(),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('recall_rules_branch_active_idx').on(t.branchId, t.active), check('recall_rules_interval_positive', sql.raw('interval_months > 0'))]);

export const recallCases = pgTable('recall_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  recallRuleId: uuid('recall_rule_id').references(() => recallRules.id, { onDelete: 'restrict' }),
  dueDate: date('due_date').notNull(),
  status: recallStatusEnum('status').notNull().default('open'),
  assigneeId: uuid('assignee_id').references(() => staff.id, { onDelete: 'restrict' }),
  outcome: varchar('outcome', { length: 512 }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('recall_cases_branch_status_due_idx').on(t.branchId, t.status, t.dueDate), index('recall_cases_patient_idx').on(t.patientId)]);

export const followUpCases = pgTable('follow_up_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'restrict' }),
  encounterId: uuid('encounter_id').references(() => encounters.id, { onDelete: 'restrict' }),
  assigneeId: uuid('assignee_id').references(() => staff.id, { onDelete: 'restrict' }),
  dueDate: date('due_date').notNull(),
  status: followUpStatusEnum('status').notNull().default('open'),
  outcome: varchar('outcome', { length: 512 }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('follow_up_cases_branch_status_due_idx').on(t.branchId, t.status, t.dueDate), index('follow_up_cases_patient_idx').on(t.patientId)]);

/* ============================================================================
   SPRINT 9 — MARKETING CONTENT: reusable message templates + saved audience
   segments. Branch-scoped; HQ + branch_manager only (mirrors marketing RLS).
   ==========================================================================*/
export const marketingTemplates = pgTable('marketing_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 256 }).notNull(),
  channel: marketingChannelEnum('channel').notNull(),
  category: varchar('category', { length: 64 }),
  subject: varchar('subject', { length: 256 }),            /* email only */
  body: text('body').notNull(),
  variables: jsonb('variables'),                           /* string[] of placeholder names */
  status: marketingTemplateStatusEnum('status').notNull().default('draft'),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('marketing_templates_branch_channel_status_idx').on(t.branchId, t.channel, t.status)]);

export const marketingSegments = pgTable('marketing_segments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 256 }).notNull(),
  filters: jsonb('filters').notNull(),                     /* audience filter definition */
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('marketing_segments_branch_idx').on(t.branchId)]);

/* ============================================================================
   SPRINT 6 (S6-T1) — WHATSAPP HUB production foundation.
   Persistent SIMULATED state only: NO WAHA transport, NO worker/queue/outbox
   processing (S8). Domain owner: whatsapp (DATA_OWNERSHIP.whatsappRecords).
   Governance D1: doctor = NO whatsapp access (RBAC matrix + RLS).
   ==========================================================================*/
export const waChannelStatusEnum = pgEnum('wa_channel_status', ['stopped', 'starting', 'working', 'failed', 'need_qr']);
export const waConversationStatusEnum = pgEnum('wa_conversation_status', ['new', 'open', 'pending', 'escalated', 'resolved', 'archived']);
export const waMessageDirectionEnum = pgEnum('wa_message_direction', ['in', 'out']);
export const waSenderTypeEnum = pgEnum('wa_sender_type', ['patient', 'human', 'ai', 'system']);
export const waMessageStatusEnum = pgEnum('wa_message_status', ['queued', 'processing', 'sent', 'delivered', 'read', 'failed']);
export const waAssignmentActionEnum = pgEnum('wa_assignment_action', ['assign', 'unassign', 'handoff', 'return_to_ai']);
export const waAiQueueStateEnum = pgEnum('wa_ai_queue_state', ['received', 'buffering', 'ready', 'processing', 'responded', 'waiting', 'handoff', 'closed']);
export const waSafetyDecisionEnum = pgEnum('wa_safety_decision', ['allowed', 'blocked']);

/* 6.1 WA_CHANNELS — one ACTIVE channel per branch (simulated WAHA session). */
export const waChannels = pgTable('wa_channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  phone: varchar('phone', { length: 64 }).notNull(),
  sessionName: varchar('session_name', { length: 128 }),
  status: waChannelStatusEnum('status').notNull().default('stopped'),
  healthScore: integer('health_score').notNull().default(0),
  sentTodayCount: integer('sent_today_count').notNull().default(0),
  sentTodayDate: date('sent_today_date'),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  autoPausedAt: timestamp('auto_paused_at', { withTimezone: true }),
  autoPauseResumedAt: timestamp('auto_pause_resumed_at', { withTimezone: true }),
  qrCode: text('qr_code'),
  qrExpiresAt: timestamp('qr_expires_at', { withTimezone: true }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('wa_channels_branch_status_idx').on(t.branchId, t.status), check('wa_channels_health_range', sql`health_score BETWEEN 0 AND 100`)]);

/* 6.2 WA_CONVERSATIONS — one ACTIVE (non-archived) thread per channel+contact. */
export const waConversations = pgTable('wa_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  channelId: uuid('channel_id').notNull().references(() => waChannels.id, { onDelete: 'restrict' }),
  contactPhone: varchar('contact_phone', { length: 64 }).notNull(),
  patientId: uuid('patient_id').references(() => patients.id, { onDelete: 'restrict' }),
  status: waConversationStatusEnum('status').notNull().default('new'),
  assignedTo: uuid('assigned_to').references(() => staff.id, { onDelete: 'restrict' }),
  aiQueueState: waAiQueueStateEnum('ai_queue_state'),
  unreadCount: integer('unread_count').notNull().default(0),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  index('wa_conversations_branch_status_idx').on(t.branchId, t.status),
  index('wa_conversations_assigned_idx').on(t.branchId, t.assignedTo),
  index('wa_conversations_patient_idx').on(t.patientId),
  check('wa_conversations_unread_nonneg', sql`unread_count >= 0`),
]);

/* 6.3 WA_MESSAGES — authoritative communication records. body is SENSITIVE. */
export const waMessages = pgTable('wa_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  channelId: uuid('channel_id').notNull().references(() => waChannels.id, { onDelete: 'restrict' }),
  conversationId: uuid('conversation_id').notNull().references(() => waConversations.id, { onDelete: 'restrict' }),
  direction: waMessageDirectionEnum('direction').notNull(),
  senderType: waSenderTypeEnum('sender_type').notNull(),
  body: text('body').notNull(),
  mediaType: varchar('media_type', { length: 64 }),
  status: waMessageStatusEnum('status').notNull().default('queued'),
  idempotencyKey: varchar('idempotency_key', { length: 256 }),
  externalMessageId: varchar('external_message_id', { length: 256 }),
  lastError: text('last_error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  index('wa_messages_conv_created_idx').on(t.conversationId, t.createdAt),
  index('wa_messages_branch_status_idx').on(t.branchId, t.status),
]);

/* 6.4 WA_ASSIGNMENTS — append-only history (NO updated_at/deleted_at). */
export const waAssignments = pgTable('wa_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  conversationId: uuid('conversation_id').notNull().references(() => waConversations.id, { onDelete: 'restrict' }),
  action: waAssignmentActionEnum('action').notNull(),
  assignedTo: uuid('assigned_to').references(() => staff.id, { onDelete: 'restrict' }),
  actorId: uuid('actor_id').references(() => staff.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('wa_assignments_conv_idx').on(t.conversationId, t.createdAt),
  index('wa_assignments_branch_idx').on(t.branchId, t.createdAt),
]);

/* 6.5 WA_TEMPLATES — quick-reply content records only (no automated sending). */
export const waTemplates = pgTable('wa_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 256 }).notNull(),
  body: text('body').notNull(),
  category: varchar('category', { length: 64 }),
  active: boolean('active').notNull().default(true),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('wa_templates_branch_active_idx').on(t.branchId, t.active)]);

/* 6.6 WA_SAFETY_DECISIONS — auditable record of every safety-gate evaluation. */
export const waSafetyDecisions = pgTable('wa_safety_decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  channelId: uuid('channel_id').notNull().references(() => waChannels.id, { onDelete: 'restrict' }),
  conversationId: uuid('conversation_id').references(() => waConversations.id, { onDelete: 'restrict' }),
  messageId: uuid('message_id'),
  actorId: uuid('actor_id'),
  decision: waSafetyDecisionEnum('decision').notNull(),
  blockedReason: varchar('blocked_reason', { length: 64 }),
  gates: jsonb('gates').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('wa_safety_decisions_branch_idx').on(t.branchId, t.createdAt),
  index('wa_safety_decisions_channel_idx').on(t.channelId, t.createdAt),
  index('wa_safety_decisions_conv_idx').on(t.conversationId),
]);

export type WaChannel = typeof waChannels.$inferSelect;
export type WaConversation = typeof waConversations.$inferSelect;
export type WaMessage = typeof waMessages.$inferSelect;

/* ============================================================================
   SPRINT 7 (S7-T1) — ADMINISTRATION governance foundation.
   Domain owner: admin (DATA_OWNERSHIP.adminRecords). Identity reuses the
   existing staff/role_assignments tables (S1) — Administration governs them;
   it does NOT rebuild or duplicate identity.
   ==========================================================================*/

/* 7.1 ORGANIZATIONS — canonical single-tenant record (approved G1). */
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 256 }).notNull(),
  registrationNo: varchar('registration_no', { length: 64 }),
  hqAddress: text('hq_address'),
  status: varchar('status', { length: 16 }).notNull().default('active'),
  ...auditCols,
});

export type Organization = typeof organizations.$inferSelect;

/* ============================================================================
   SPRINT 7 (S7-T2) — SETTINGS governance foundation.
   Domain owner: settings (DATA_OWNERSHIP.settingsRecords). Configuration
   registry + hierarchical scopes + versioned values + SecretRef metadata.
   SecretRef holds NO secret value (approved G9) — reference/metadata only.
   ==========================================================================*/
export const settingsScopeLevelEnum = pgEnum('settings_scope_level', ['system', 'organization', 'branch', 'role', 'feature']);
export const settingsValueTypeEnum = pgEnum('settings_value_type', ['string', 'number', 'boolean', 'json']);
export const secretStatusEnum = pgEnum('secret_status', ['ABSENT', 'REGISTERED', 'ROTATED', 'REVOKED']);

/* 7.2 SETTINGS_DEFINITIONS — canonical config registry. */
export const settingsDefinitions = pgTable('settings_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  key: varchar('key', { length: 128 }).notNull(),
  valueType: settingsValueTypeEnum('value_type').notNull(),
  description: text('description'),
  category: varchar('category', { length: 64 }),
  defaultValue: jsonb('default_value'),
  allowedScopes: settingsScopeLevelEnum('allowed_scopes').array().notNull().default(sql`'{system,organization,branch}'::settings_scope_level[]`),
  branchOverridable: boolean('branch_overridable').notNull().default(true),
  locked: boolean('locked').notNull().default(false),
  ...auditCols,
}, (t) => [
  uniqueIndex('settings_definitions_org_key_uq').on(t.orgId, t.key),
  index('settings_definitions_category_idx').on(t.orgId, t.category),
]);

/* 7.3 SETTINGS_VALUES — current value for (key, scope, scope_ref). */
export const settingsValues = pgTable('settings_values', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  key: varchar('key', { length: 128 }).notNull(),
  scope: settingsScopeLevelEnum('scope').notNull(),
  scopeRef: varchar('scope_ref', { length: 128 }),
  value: jsonb('value').notNull(),
  version: integer('version').notNull().default(1),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('settings_values_key_idx').on(t.orgId, t.key),
  index('settings_values_scope_idx').on(t.orgId, t.scope, t.scopeRef),
]);

/* 7.4 SETTINGS_VERSIONS — immutable history (append-only, NO updated_at). */
export const settingsVersions = pgTable('settings_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  key: varchar('key', { length: 128 }).notNull(),
  scope: settingsScopeLevelEnum('scope').notNull(),
  scopeRef: varchar('scope_ref', { length: 128 }),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),
  version: integer('version').notNull(),
  changedBy: uuid('changed_by'),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('settings_versions_key_idx').on(t.orgId, t.key, t.createdAt),
  index('settings_versions_scope_idx').on(t.orgId, t.scope, t.scopeRef),
]);

/* 7.5 SECRET_REFS — secret metadata ONLY (approved G9). No secret value. */
export const secretRefs = pgTable('secret_refs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  key: varchar('key', { length: 128 }).notNull(),
  vaultPath: varchar('vault_path', { length: 256 }).notNull(),
  lastFour: varchar('last_four', { length: 8 }),
  status: secretStatusEnum('status').notNull().default('ABSENT'),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  ...auditCols,
}, (t) => [
  uniqueIndex('secret_refs_org_key_uq').on(t.orgId, t.key),
]);

export type SettingsDefinition = typeof settingsDefinitions.$inferSelect;
export type SettingsValue = typeof settingsValues.$inferSelect;
export type SettingsVersion = typeof settingsVersions.$inferSelect;
export type SecretRef = typeof secretRefs.$inferSelect;

/* ============================================================================
   SPRINT 7 (S7-T3) — AI MANAGER governance foundation.
   Domain owner: ai (DATA_OWNERSHIP.aiRecords). GOVERNANCE PLANE ONLY —
   no LLM calls, no model runtime, no worker/scheduler (approved scope).
   ==========================================================================*/
export const aiAgentStatusEnum = pgEnum('ai_agent_status', ['registered', 'enabled', 'paused', 'archived']);
export const aiCapabilityClassEnum = pgEnum('ai_capability_class', ['READ', 'DRAFT', 'EXECUTE']);
export const aiGuardrailLevelEnum = pgEnum('ai_guardrail_level', ['HARD_BLOCK', 'APPROVAL_REQUIRED']);
export const aiRiskLevelEnum = pgEnum('ai_risk_level', ['LOW', 'MEDIUM', 'HIGH']);
export const aiDecisionEnum = pgEnum('ai_decision', ['AUTO', 'DRAFT', 'APPROVAL_REQUIRED', 'BLOCKED']);
export const aiKnowledgeTypeEnum = pgEnum('ai_knowledge_type', ['static', 'dynamic']);

/* 7.6 AI_AGENTS — registry; exactly ONE owner domain per agent. */
export const aiAgents = pgTable('ai_agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  key: varchar('key', { length: 64 }).notNull(),
  name: varchar('name', { length: 128 }).notNull(),
  icon: varchar('icon', { length: 32 }),
  ownerDomain: varchar('owner_domain', { length: 32 }).notNull(),
  status: aiAgentStatusEnum('status').notNull().default('registered'),
  description: text('description'),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('ai_agents_domain_idx').on(t.orgId, t.ownerDomain, t.status)]);

/* 7.7 AI_CAPABILITIES — explicit READ/DRAFT/EXECUTE grants per agent+domain. */
export const aiCapabilities = pgTable('ai_capabilities', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  agentId: uuid('agent_id').notNull().references(() => aiAgents.id, { onDelete: 'restrict' }),
  domain: varchar('domain', { length: 32 }).notNull(),
  capability: aiCapabilityClassEnum('capability').notNull(),
  draftOnly: boolean('draft_only').notNull().default(false),
  ...auditCols,
}, (t) => [
  uniqueIndex('ai_capabilities_agent_domain_cap_uq').on(t.orgId, t.agentId, t.domain, t.capability),
  index('ai_capabilities_agent_idx').on(t.agentId),
]);

/* 7.8 AI_KNOWLEDGE — governance metadata (source_ref owned by domain, not content). */
export const aiKnowledge = pgTable('ai_knowledge', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  agentId: uuid('agent_id').notNull().references(() => aiAgents.id, { onDelete: 'restrict' }),
  item: varchar('item', { length: 256 }).notNull(),
  type: aiKnowledgeTypeEnum('type').notNull().default('static'),
  sourceDomain: varchar('source_domain', { length: 32 }),
  sourceRef: varchar('source_ref', { length: 256 }),
  ...auditCols,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('ai_knowledge_agent_idx').on(t.agentId)]);

/* 7.9 AI_AUTOMATIONS — trigger/action metadata ONLY (no execution in S7). */
export const aiAutomations = pgTable('ai_automations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  agentId: uuid('agent_id').notNull().references(() => aiAgents.id, { onDelete: 'restrict' }),
  triggerKey: varchar('trigger_key', { length: 128 }).notNull(),
  actionKey: varchar('action_key', { length: 128 }).notNull(),
  enabled: boolean('enabled').notNull().default(false),
  ...auditCols,
}, (t) => [uniqueIndex('ai_automations_agent_trigger_uq').on(t.orgId, t.agentId, t.triggerKey, t.actionKey)]);

/* 7.10 AI_GUARDRAILS — hard rules; agentId NULL = GLOBAL. HARD_BLOCK absolute. */
export const aiGuardrails = pgTable('ai_guardrails', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  agentId: uuid('agent_id').references(() => aiAgents.id, { onDelete: 'restrict' }),
  ruleKey: varchar('rule_key', { length: 64 }).notNull(),
  rule: text('rule').notNull(),
  level: aiGuardrailLevelEnum('level').notNull(),
  ...auditCols,
}, (t) => [index('ai_guardrails_agent_idx').on(t.orgId, t.agentId)]);

/* 7.11 AI_APPROVAL_RULES — risk-based approval (HIGH = human wajib). */
export const aiApprovalRules = pgTable('ai_approval_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  agentId: uuid('agent_id').references(() => aiAgents.id, { onDelete: 'restrict' }),
  actionKey: varchar('action_key', { length: 128 }).notNull(),
  risk: aiRiskLevelEnum('risk').notNull(),
  auto: boolean('auto').notNull().default(true),
  note: text('note'),
  ...auditCols,
}, (t) => [uniqueIndex('ai_approval_rules_agent_action_uq').on(t.orgId, t.agentId, t.actionKey)]);

/* 7.12 AI_AUDIT_LOG — append-only governance decisions/actions. */
export const aiAuditLog = pgTable('ai_audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  agentId: uuid('agent_id'),
  actorId: uuid('actor_id'),
  action: varchar('action', { length: 128 }).notNull(),
  detail: jsonb('detail'),
  status: varchar('status', { length: 32 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('ai_audit_log_agent_idx').on(t.orgId, t.agentId, t.createdAt),
  index('ai_audit_log_status_idx').on(t.orgId, t.status, t.createdAt),
]);

export type AiAgent = typeof aiAgents.$inferSelect;
export type AiCapability = typeof aiCapabilities.$inferSelect;
export type AiKnowledge = typeof aiKnowledge.$inferSelect;
export type AiAutomation = typeof aiAutomations.$inferSelect;
export type AiGuardrail = typeof aiGuardrails.$inferSelect;
export type AiApprovalRule = typeof aiApprovalRules.$inferSelect;
export type AiAuditLog = typeof aiAuditLog.$inferSelect;
export type WaAssignment = typeof waAssignments.$inferSelect;
export type WaTemplate = typeof waTemplates.$inferSelect;
export type WaSafetyDecision = typeof waSafetyDecisions.$inferSelect;

export type Branch = typeof branches.$inferSelect;
export type Staff = typeof staff.$inferSelect;
export type RoleAssignment = typeof roleAssignments.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type PatientRelationship = typeof patientRelationships.$inferSelect;
export type PatientTimelineEvent = typeof patientTimelineEvents.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type PaymentStatus = typeof paymentStatus.$inferSelect;
export type AuditLog = typeof auditLog.$inferSelect;
export type DomainEvent = typeof domainEvents.$inferSelect;
export type ProcessedEvent = typeof processedEvents.$inferSelect;
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type PanelCompany = typeof panelCompanies.$inferSelect;
export type InsuranceCompany = typeof insuranceCompanies.$inferSelect;
/* Sprint 3 — clinical domain types */
export type TreatmentCatalogEntry = typeof treatmentCatalog.$inferSelect;
export type Encounter = typeof encounters.$inferSelect;
export type ClinicalNote = typeof clinicalNotes.$inferSelect;
export type ToothRecord = typeof toothRecords.$inferSelect;
export type TreatmentPlan = typeof treatmentPlans.$inferSelect;
export type TreatmentPlanItem = typeof treatmentPlanItems.$inferSelect;
export type TreatmentSession = typeof treatmentSessions.$inferSelect;
export type ConsentTemplate = typeof consentTemplates.$inferSelect;
export type ConsentRecord = typeof consentRecords.$inferSelect;
export type ImagingRecord = typeof imagingRecords.$inferSelect;
export type Prescription = typeof prescriptions.$inferSelect;
export type AdverseEvent = typeof adverseEvents.$inferSelect;
export type Referral = typeof referrals.$inferSelect;
export type ClinicalTimelineEvent = typeof clinicalTimelineEvents.$inferSelect;
/* Sprint 4 (S4-T1) — finance foundation types */
export type SaleRecord = typeof saleRecords.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type RecurringCommitment = typeof recurringCommitments.$inferSelect;
export type TreatmentCost = typeof treatmentCosts.$inferSelect;
export type LabPayable = typeof labPayables.$inferSelect;
export type CommissionLedger = typeof commissionLedger.$inferSelect;
export type CommissionPayout = typeof commissionPayouts.$inferSelect;
export type FinanceAlert = typeof financeAlerts.$inferSelect;
export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type FinanceAlertRule = typeof financeAlertRules.$inferSelect;
export type ExternalInvoiceRef = typeof externalInvoiceRefs.$inferSelect;
export type BukkuSyncRecord = typeof bukkuSyncRecords.$inferSelect;
export type ReconciliationRecord = typeof reconciliationRecords.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type RecallRule = typeof recallRules.$inferSelect;
export type RecallCase = typeof recallCases.$inferSelect;
export type FollowUpCase = typeof followUpCases.$inferSelect;
export type MarketingTemplate = typeof marketingTemplates.$inferSelect;
export type MarketingSegment = typeof marketingSegments.$inferSelect;
export type DoctorStatus = typeof doctorStatuses.$inferSelect;
export type Checklist = typeof checklists.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type LabCase = typeof labCases.$inferSelect;

/* ============================================================================
   S9 — REPORTS/ANALYTICS FOUNDATION (0024)
   Reports = READ/INTELLIGENCE LAYER. These two tables are the ONLY persisted
   artifacts of the reports domain: the canonical KPI registry (definitions,
   not facts) and the immutable report-usage audit trail.
   ==========================================================================*/

/* S9-1. KPI_DEFINITIONS — canonical KPI registry (RPT_KPIS). Reports OWNS
 * KpiDefinition; facts remain owned by domain tables. Versioned, never deleted. */
export const kpiDefinitions = pgTable('kpi_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  kpiKey: varchar('kpi_key', { length: 64 }).notNull(),
  name: varchar('name', { length: 128 }).notNull(),
  formula: text('formula').notNull(),
  sourceDomain: varchar('source_domain', { length: 32 }).notNull(),
  unit: varchar('unit', { length: 16 }).notNull(),
  scopeRules: jsonb('scope_rules').notNull(),
  version: integer('version').notNull().default(1),
  status: varchar('status', { length: 16 }).notNull().default('published'),
  ...auditCols,
}, (t) => [
  uniqueIndex('kpi_definitions_org_key_version_uq').on(t.orgId, t.kpiKey, t.version),
  index('kpi_definitions_org_idx').on(t.orgId),
]);

/* S9-2. REPORT_AUDIT — immutable usage trail (Reports OWNS ReportAudit).
 * Append-only: RLS grants SELECT (hq) + INSERT (hq/branch_manager); no
 * UPDATE/DELETE permissive policies exist. */
export const reportAudit = pgTable('report_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  actorRole: varchar('actor_role', { length: 32 }).notNull(),
  action: varchar('action', { length: 48 }).notNull(),
  view: varchar('view', { length: 64 }).notNull(),
  filter: jsonb('filter'),
  correlationId: varchar('correlation_id', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('report_audit_org_created_idx').on(t.orgId, t.createdAt),
  index('report_audit_org_actor_idx').on(t.orgId, t.actorId),
]);

export type KpiDefinition = typeof kpiDefinitions.$inferSelect;
export type ReportAuditRow = typeof reportAudit.$inferSelect;

/* S10-1. REFRESH_TOKENS — secure refresh-token persistence (S10 T1, D2).
 * Rotation via rotated_to, revocation via revoked_at, expiry via expires_at.
 * token_hash = SHA-256 of the refresh token (never plaintext). No DELETE. */
export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  staffId: uuid('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  rotatedTo: uuid('rotated_to'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdIp: varchar('created_ip', { length: 45 }),
  userAgent: text('user_agent'),
}, (t) => [
  uniqueIndex('refresh_tokens_token_hash_uq').on(t.tokenHash),
  index('refresh_tokens_staff_idx').on(t.staffId),
  index('refresh_tokens_org_idx').on(t.orgId),
  index('refresh_tokens_expires_idx').on(t.expiresAt),
]);

export type RefreshToken = typeof refreshTokens.$inferSelect;


/* ============================================================================
   BOOKING_REQUESTS - raw WhatsApp booking intake (pre-verification inbox).
   Written by system_worker (WhatsApp webhook), read/managed by hq+branch admin.
   NOT patient data yet - free-text fields from AI extraction, admin verifies
   then converts to a real appointment via the appointments module.
   ==========================================================================*/
export const bookingRequestStatusEnum = pgEnum('booking_request_status', ['pending', 'confirmed', 'rejected']);

export const bookingRequests = pgTable('booking_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  branchId: uuid('branch_id'),
  contactPhone: varchar('contact_phone', { length: 64 }).notNull(),
  patientName: varchar('patient_name', { length: 256 }),
  preferredDate: varchar('preferred_date', { length: 64 }),
  preferredTime: varchar('preferred_time', { length: 64 }),
  treatment: varchar('treatment', { length: 256 }),
  branchName: varchar('branch_name', { length: 256 }),
  rawMessage: text('raw_message'),
  status: bookingRequestStatusEnum('status').notNull().default('pending'),
  linkedAppointmentId: uuid('linked_appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
  ...auditCols,
});

export type BookingRequest = typeof bookingRequests.$inferSelect;
