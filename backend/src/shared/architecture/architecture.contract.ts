/**
 * ============================================================================
 * MEDINI_ARCHITECTURE â€” BACKEND CONTRACT LAYER (v1.1)
 * ============================================================================
 * Ported VERBATIM from the locked frontend source of truth
 * (`CURRENT-MEDINI-REVIEW.html` â†’ window.MEDINI_ARCHITECTURE).
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

/* ---------- 1. DOMAIN_REGISTRY â€” exactly 13 canonical domains ---------- */
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

/* ---------- 2. DATA_OWNERSHIP â€” one authoritative owner per record type ---------- */
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

/* ---------- 3. CROSS_DOMAIN_EVENTS â€” contract (backend = outbox/bus) ---------- */
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

/* ---------- 4. PAYMENT STATUS MODEL â€” CRM = status layer only ---------- */
export const PAYMENT_STATUS = { PENDING: 'PENDING', PAID: 'PAID', OVERDUE: 'OVERDUE' } as const;
export const PAYMENT_STATUS_VALUES = ['PENDING', 'PAID', 'OVERDUE'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS_VALUES)[number];

/* ---------- 5. ROLE_DOMAIN_MATRIX â€” 4 roles Ã— 13 domains ---------- */
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
    /* OWNER DIRECTION (8 Okt 2026): HQ ialah peranan serba-boleh — ia berfungsi
     * sebagai doktor/resepsionis/pengurus cawangan bila perlu. Sel ini pernah
     * view-only ("HQ writes the WORDS"), dipinke spec lama; keputusan pemilik
     * memansuhkannya. Skop kekal 'all'; servis klinikal tetap meminta
     * branchId/doctorId eksplisit pada write (tiada tulis buta). */
    clinical:     R(true, true,  true,  false, false, false, 'all'),
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
    /* `edit` for the branch manager, scoped to their own branch.
     *
     * The panel is in the branch manager's sidebar and they are the ones sitting
     * in the clinic when the AI says something wrong — they need the switch. It
     * was view-only, which put the control out of reach of the only person able
     * to act on it: only hq could mute a branch, so a manager watching a bad
     * reply could not stop it.
     *
     * The change is bounded three ways: scope stays 'branch' (a manager cannot
     * touch another clinic), `approve` stays false (setting a branch's own
     * operating parameters is not an approval step), and the blast schedule keeps
     * its own separate permission path. */
    ai:           R(true, false, true,  false, false, false, 'branch'),
    admin:         NONE,
    settings:     R(true, false, true,  false, false, false, 'branch'),
  },
  branch_admin: {
    /* Branch Admin / Receptionist */
    dashboard:    R(true, false, false, false, false, false, 'branch'),
    patients:     R(true, true,  true,  false, false, false, 'branch'),
    appointments: R(true, true,  true,  false, false, false, 'branch'),
    /* RECEPTIONIST CAN READ THE CLINICAL RECORD, AND CANNOT WRITE IT.
     *
     * A patient walks up to the counter and asks "when was I last here, what did the
     * dentist do, do I still owe a visit?". Answering that IS the counter's job, and every
     * fact needed is already in the clinical record:
     *
     *   encounter_created · note_signed · plan_created · plan_status_changed ·
     *   consent_recorded · prescription_created · adverse_event_reported
     *
     * Before this, the receptionist saw a Patient360 with the Journey and Appointments tabs
     * WORKING and four tabs returning 403 mid-screen. The data was reachable; the door was
     * locked. That is worse than a missing feature, because it reads as a broken system
     * rather than a permission.
     *
     * WHY `view` ONLY — the split that matters is READ vs WRITE, not clinical vs non-clinical:
     *
     *   - Reading is how the counter helps the patient.
     *   - Writing is a CLINICAL OPINION. A diagnosis, a prescription and a signed note carry
     *     a dentist's judgement, and an allergy entry that is wrong is dangerous in both
     *     directions (missing it harms the patient; inventing it blocks treatment). One
     *     person must own that judgement, and that person is a doctor.
     *
     * So `create` and `edit` stay false. The doctor is not merely preferred here — the
     * matrix makes the counter unable to write even if a screen offered it.
     *
     * SCOPE IS 'branch'. A receptionist sees their own clinic's patients only, exactly as
     * they already do for `patients` and `appointments`. This is not "the counter can read
     * medical records"; it is "staff of a clinic can read that clinic's record", which is how
     * a dental practice already works with paper files in the same room.
     *
     * NOT CHANGED HERE, and deliberately: whether the counter may RECORD an allergy, and
     * whether the counter may PRINT an MC. Both need the owner's decision — an MC carries a
     * doctor's name, and an allergy is a clinical judgement. Neither is granted by the line
     * below; `create: false` refuses both until asked for. */
    clinical:     R(true, false, false, false, false, false, 'branch'),
    documents:    NONE,
    finance:      R(false, false, false, false, false, false, 'branch'), /* patient payment status via accessor */
    reports:      NONE,
    marketing:    NONE,
    operations:   NONE,
    whatsapp:     R(true, true,  true,  false, false, false, 'branch'),
    ai:           NONE,
    admin:         NONE,
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
     * Reports access. REPORTS-ANALYTICS-LOCKED.md Â§10 (Phase-7, newer domain
     * authority) â€” Receptionist/Doctor blocked. Supersedes the earlier
     * view/'own' cell, mirroring the S6 D1 whatsapp amendment precedent. */
    reports:      NONE,
    marketing:    NONE,
    operations:   NONE,
    /* SPRINT 6 GOVERNANCE D1 (Bos + ChatGPT, final): doctor has NO
     * WhatsApp domain access. Minimal explicit amendment of the canonical
     * matrix — previously R(true,true,true,false,false,false,'branch') per the
     * old WhatsApp architecture doc; overridden to NONE. RLS (0013) mirrors
     * this: doctor is absent from all wa_* policies.
     * (8 Okt 2026) Sel pernah tertinggal 'branch' sejak fail ini wujud —
     * ujian kontrak permission-matrix.spec menangkapnya; dikembalikan ke NONE
     * seperti keputusan D1. */
    whatsapp:     NONE,
    ai:           NONE,
    admin:         NONE,
    settings:     R(true, false, false, false, false, false, 'own'),
  },
  nurse: {
    /* Nurse accounts are operational, branch-scoped staff. They can see the
     * daily clinic context needed for nurse scheduling and patient support,
     * but cannot write clinical opinions, finance, campaigns or governance. */
    dashboard:    R(true, false, false, false, false, false, 'branch'),
    patients:     R(true, false, false, false, false, false, 'branch'),
    appointments: R(true, false, false, false, false, false, 'branch'),
    clinical:     R(true, false, false, false, false, false, 'branch'),
    documents:    NONE,
    finance:      NONE,
    reports:      NONE,
    marketing:    NONE,
    operations:   R(true, false, false, false, false, false, 'branch'),
    whatsapp:     NONE,
    ai:           NONE,
    admin:        NONE,
    settings:     R(true, false, false, false, false, false, 'branch'),
  },
  /* S10 GLM 5.3 Remediation â€” Developer / System Admin. Technical-only
   * identity: NO business-domain cells at all. Absent from the matrix â†’ can()
   * is fail-closed for every domain/action. The only permitted surface is the
   * /system-admin/* technical API (gated by a dedicated role check, not can()).
   * RLS migration 0027 adds a third deny layer at the database. */
  developer: {},
} as const;

/* Alias: 'receptionist' (demo user role key) â†’ branch_admin matrix */
ROLE_DOMAIN_MATRIX.receptionist = ROLE_DOMAIN_MATRIX.branch_admin!;

/* 'nurse' ditambah 10 Okt: modul Jadual Jururawat + akaun staf perawat. */
export const CANONICAL_ROLE_KEYS = ['hq', 'branch_manager', 'branch_admin', 'doctor', 'nurse'] as const;

/* ---------- 6. PERMISSION_MATRIX â€” can(role, domain, action, context) ---------- */
export interface PermissionContext {
  readonly actorBranchId?: string | null;
  readonly branchId?: string | null;
  readonly doctorId?: string | null;
  readonly actorDoctorId?: string | null;
}

/**
 * Service-level authorization. Frontend checks are NOT security â€” this is the
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

  /* scope enforcement at service level â€” NOT UI hiding. FAIL-CLOSED (GLM hardening):
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

