/**
 * ============================================================================
 * MEDINI_ARCHITECTURE — BACKEND CONTRACT LAYER (v1.1)
 * ============================================================================
 * Ported VERBATIM from the locked frontend source of truth
 * (`CURRENT-MEDINI-REVIEW.html` → window.MEDINI_ARCHITECTURE).
 *
 * CRITICAL: This is a faithful port. Do NOT reinterpret, simplify, invent
 * permissions, change ownership, or alter role semantics. Any change here must
 * be reflected in the locked frontend contract and vice-versa.
 *
 * Payment model (v1.1, non-negotiable): Medini CRM = Payment STATUS layer
 * (PENDING/PAID/OVERDUE). Payment happens EXTERNALLY (FPX/Card). This backend
 * is NOT a payment gateway / invoice engine / receipt engine.
 * ============================================================================
 */

/* ---------- 1. DOMAIN_REGISTRY — exactly 13 canonical domains ---------- */
export interface DomainRegistryEntry {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly readOnly: boolean;
}

export const DOMAIN_REGISTRY: readonly DomainRegistryEntry[] = [
  { id: 'dashboard',    name: 'Dashboard',              owner: 'dashboard',    readOnly: true  },
  { id: 'patients',     name: 'Patient Management',     owner: 'patients',     readOnly: false },
  { id: 'appointments', name: 'Appointment Management', owner: 'appointments', readOnly: false },
  { id: 'clinical',     name: 'Clinical',               owner: 'clinical',     readOnly: false },
  { id: 'documents',    name: 'Documents',              owner: 'documents',    readOnly: false },
  { id: 'finance',      name: 'Finance',                owner: 'finance',      readOnly: false },
  { id: 'reports',      name: 'Reports & Analytics',    owner: 'READ_ONLY',    readOnly: true  },
  { id: 'marketing',    name: 'Marketing',              owner: 'marketing',    readOnly: false },
  { id: 'operations',   name: 'Operations',             owner: 'operations',   readOnly: false },
  { id: 'whatsapp',     name: 'WhatsApp Hub',           owner: 'whatsapp',     readOnly: false },
  { id: 'ai',           name: 'AI',                     owner: 'ai',           readOnly: false },
  { id: 'admin',        name: 'Administration',         owner: 'admin',        readOnly: false },
  { id: 'settings',     name: 'Settings',               owner: 'settings',     readOnly: false },
] as const;

export const CANONICAL_DOMAIN_IDS = DOMAIN_REGISTRY.map((d) => d.id);

/* ---------- 2. DATA_OWNERSHIP — one authoritative owner per record type ---------- */
export const DATA_OWNERSHIP = {
  patientMaster:      'patients',
  appointmentMaster:  'appointments',
  clinicalRecords:    'clinical',
  documentRecords:    'documents',
  financialRecords:   'finance',
  marketingRecords:   'marketing',
  operationalRecords: 'operations',
  whatsappRecords:    'whatsapp',
  aiRecords:          'ai',
  adminRecords:       'admin',
  settingsRecords:    'settings',
  dashboardView:      'dashboard',
  reports:            'READ_ONLY',
} as const;
export type DataOwnershipKey = keyof typeof DATA_OWNERSHIP;

/* ---------- 3. CROSS_DOMAIN_EVENTS — contract (backend = outbox/bus) ---------- */
export interface CrossDomainEvent {
  readonly source: string;
  readonly targets: readonly string[];
}

export const CROSS_DOMAIN_EVENTS: Record<string, CrossDomainEvent> = {
  PATIENT_CREATED:           { source: 'patients',     targets: ['appointments', 'marketing', 'reports'] },
  APPOINTMENT_CREATED:       { source: 'appointments', targets: ['patients', 'clinical', 'reports'] },
  APPOINTMENT_COMPLETED:     { source: 'appointments', targets: ['clinical', 'finance', 'reports'] },
  TREATMENT_STARTED:         { source: 'clinical',     targets: ['appointments', 'finance'] },
  TREATMENT_COMPLETED:       { source: 'clinical',     targets: ['finance', 'reports'] },
  PAYMENT_STATUS_UPDATED:    { source: 'finance',      targets: ['patients', 'reports', 'dashboard'] },
  BILL_SUBMITTED:            { source: 'operations',   targets: ['finance'] },
  BILL_APPROVED:             { source: 'finance',      targets: ['operations', 'dashboard'] },
  BILL_REJECTED:             { source: 'finance',      targets: ['operations', 'dashboard'] },
  BILL_PAID:                 { source: 'finance',      targets: ['operations', 'reports'] },
  RECALL_DUE:                { source: 'marketing',    targets: ['patients', 'whatsapp', 'dashboard'] },
  WHATSAPP_MESSAGE_RECEIVED: { source: 'whatsapp',     targets: ['patients', 'ai'] },
  AI_ESCALATED:              { source: 'ai',           targets: ['whatsapp', 'operations'] },
} as const;

/* ---------- 4. PAYMENT STATUS MODEL — CRM = status layer only ---------- */
export const PAYMENT_STATUS = { PENDING: 'PENDING', PAID: 'PAID', OVERDUE: 'OVERDUE' } as const;
export const PAYMENT_STATUS_VALUES = ['PENDING', 'PAID', 'OVERDUE'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS_VALUES)[number];

/* ---------- 5. ROLE_DOMAIN_MATRIX — 4 roles × 13 domains ---------- */
export type RoleAction = 'view' | 'create' | 'edit' | 'submit' | 'approve' | 'delete';
export type RoleScope = 'all' | 'branch' | 'own' | null;

export interface RoleDomainCell {
  readonly view: boolean;
  readonly create: boolean;
  readonly edit: boolean;
  readonly submit: boolean;
  readonly approve: boolean;
  readonly del: boolean;
  readonly scope: RoleScope;
}

function R(
  v: boolean, c: boolean, e: boolean, s: boolean, a: boolean, d: boolean, scope: RoleScope,
): RoleDomainCell {
  return { view: v, create: c, edit: e, submit: s, approve: a, del: d, scope };
}
const NONE: RoleDomainCell = R(false, false, false, false, false, false, null);

export const ROLE_DOMAIN_MATRIX: Record<string, Record<string, RoleDomainCell>> = {
  hq: {
    dashboard:    R(true, false, false, false, false, false, 'all'),
    patients:     R(true, true,  true,  false, false, false, 'all'),
    appointments: R(true, true,  true,  false, false, false, 'all'),
    clinical:     R(true, false, false, false, false, false, 'all'),
    documents:    R(true, true,  true,  false, false, false, 'all'),
    finance:      R(true, true,  true,  true,  true,  false, 'all'),
    reports:      R(true, false, false, false, false, false, 'all'),
    marketing:    R(true, true,  true,  true,  true,  false, 'all'),
    operations:   R(true, true,  true,  true,  true,  false, 'all'),
    whatsapp:     R(true, true,  true,  false, false, false, 'all'),
    ai:           R(true, true,  true,  false, true,  false, 'all'),
    admin:        R(true, true,  true,  false, true,  false, 'all'),
    settings:     R(true, false, true,  false, true,  false, 'all'),
  },
  branch_manager: {
    dashboard:    R(true, false, false, false, false, false, 'branch'),
    patients:     R(true, true,  true,  false, false, false, 'branch'),
    appointments: R(true, true,  true,  false, false, false, 'branch'),
    clinical:     R(true, false, false, false, false, false, 'branch'),
    documents:    R(true, true,  true,  false, false, false, 'branch'),
    finance:      R(true, false, false, true,  false, false, 'branch'),
    reports:      R(true, false, false, false, false, false, 'branch'),
    marketing:    R(true, true,  true,  true,  false, false, 'branch'),
    operations:   R(true, true,  true,  true,  false, false, 'branch'),
    whatsapp:     R(true, true,  true,  false, false, false, 'branch'),
    ai:           R(true, false, false, false, false, false, 'branch'),
    admin:        NONE,
    settings:     R(true, false, true,  false, false, false, 'branch'),
  },
  branch_admin: {
    /* Branch Admin / Receptionist */
    dashboard:    R(true, false, false, false, false, false, 'branch'),
    patients:     R(true, true,  true,  false, false, false, 'branch'),
    appointments: R(true, true,  true,  false, false, false, 'branch'),
    clinical:     NONE,
    documents:    NONE,
    finance:      R(false, false, false, false, false, false, 'branch'), /* patient payment status via accessor */
    reports:      NONE,
    marketing:    NONE,
    operations:   NONE,
    whatsapp:     R(true, true,  true,  false, false, false, 'branch'),
    ai:           NONE,
    admin:        NONE,
    settings:     R(true, false, false, false, false, false, 'branch'),
  },
  doctor: {
    dashboard:    R(true, false, false, false, false, false, 'own'),
    patients:     R(true, false, false, false, false, false, 'own'),
    appointments: R(true, false, false, false, false, false, 'own'),
    clinical:     R(true, true,  true,  false, false, false, 'own'),
    documents:    R(true, true,  false, false, false, false, 'own'),
    finance:      R(false, false, false, false, false, false, 'own'), /* own patient payment status via accessor */
    /* SPRINT 9 GOVERNANCE DECISION Q1 (Bos, S9 Phase-2 approval): doctor has NO
     * Reports access. REPORTS-ANALYTICS-LOCKED.md §10 (Phase-7, newer domain
     * authority) — Receptionist/Doctor blocked. Supersedes the earlier
     * view/'own' cell, mirroring the S6 D1 whatsapp amendment precedent. */
    reports:      NONE,
    marketing:    NONE,
    operations:   NONE,
    /* SPRINT 6 GOVERNANCE DECISION D1 (Bos + ChatGPT, final): doctor has NO
     * WhatsApp domain access. Minimal explicit amendment of the canonical
     * matrix — previously R(true,true,true,false,false,false,'branch') per the
     * old WhatsApp architecture doc; overridden to NONE. RLS (0013) mirrors
     * this: doctor is absent from all wa_* policies. */
    whatsapp:     NONE,
    ai:           NONE,
    admin:        NONE,
    settings:     R(true, false, false, false, false, false, 'own'),
  },
  /* S10 GLM 5.3 Remediation — Developer / System Admin. Technical-only
   * identity: NO business-domain cells at all. Absent from the matrix → can()
   * is fail-closed for every domain/action. The only permitted surface is the
   * /system-admin/* technical API (gated by a dedicated role check, not can()).
   * RLS migration 0027 adds a third deny layer at the database. */
  developer: {},
} as const;

/* Alias: 'receptionist' (demo user role key) → branch_admin matrix */
ROLE_DOMAIN_MATRIX.receptionist = ROLE_DOMAIN_MATRIX.branch_admin!;

export const CANONICAL_ROLE_KEYS = ['hq', 'branch_manager', 'branch_admin', 'doctor'] as const;

/* ---------- 6. PERMISSION_MATRIX — can(role, domain, action, context) ---------- */
export interface PermissionContext {
  readonly actorBranchId?: string | null;
  readonly branchId?: string | null;
  readonly doctorId?: string | null;
  readonly actorDoctorId?: string | null;
}

/**
 * Service-level authorization. Frontend checks are NOT security — this is the
 * authoritative gate. Scope is enforced here, never by UI hiding.
 */
export function can(
  role: string,
  domain: string,
  action: RoleAction | string,
  context: PermissionContext = {},
): boolean {
  const m = ROLE_DOMAIN_MATRIX[role];
  if (!m) return false;
  const cell = m[domain];
  if (!cell) return false;
  /* action mapping */
  let act = (action || 'view') as string;
  if (act === 'delete') act = 'del';
  if (!(act in cell)) return false;
  if (!cell[act as keyof RoleDomainCell]) return false;

  /* scope enforcement at service level — NOT UI hiding. FAIL-CLOSED (GLM hardening):
     if the required authorization context is incomplete, DENY. */
  const scope = cell.scope;
  if (scope === 'all') return true;
  if (scope === 'branch') {
    /* branch scope: BOTH actor and target branch must be explicitly known. */
    const actorBranch = context.actorBranchId;
    const targetBranch = context.branchId;
    if (actorBranch == null) return false;         /* actor must have a branch */
    if (targetBranch == null) return false;        /* no implicit default to actor branch */
    return targetBranch === actorBranch;
  }
  if (scope === 'own') {
    /* own scope: branch AND doctor identity must both be present and match. */
    const aBranch = context.actorBranchId;
    const tBranch = context.branchId;
    if (aBranch == null || tBranch == null || tBranch !== aBranch) return false;
    if (context.doctorId == null || context.actorDoctorId == null) return false; /* no silent pass */
    return context.doctorId === context.actorDoctorId;
  }
  return false;
}

export const PERMISSION_MATRIX = { can } as const;

/* ---------- 7. Canonical branch registry reference ---------- */
/* The 14-branch canonical list (MEDINI_MAIN_BRANCHES) is seeded in the DB phase
   (Sprint 1). Sprint 0 records the count + IDs contract only. */
export const CANONICAL_BRANCH_COUNT = 14 as const;

/* ---------- Aggregate export (mirrors window.MEDINI_ARCHITECTURE) ---------- */
export const MEDINI_ARCHITECTURE = {
  DOMAIN_REGISTRY,
  ROLE_DOMAIN_MATRIX,
  DATA_OWNERSHIP,
  CROSS_DOMAIN_EVENTS,
  PERMISSION_MATRIX,
  PAYMENT_STATUS,
  PAYMENT_STATUS_VALUES,
} as const;
