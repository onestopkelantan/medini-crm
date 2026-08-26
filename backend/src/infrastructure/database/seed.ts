/**
 * SEED — canonical reference data (Sprint 1 Database Foundation).
 * 14 canonical branches (10 Medini Dental Clinics + 4 affiliated) + 4 role demo users.
 * Idempotent: uses ON CONFLICT DO NOTHING on natural keys.
 * NO production secrets — demo passwords are placeholders to be hashed in the auth task.
 */
import { createDatabase } from './database';
import { sql } from 'drizzle-orm';
import { branches, staff, roleAssignments, panelCompanies, treatmentCatalog, consentTemplates } from './schema';
import * as argon2 from 'argon2';

const ORG_ID = '00000000-0000-0000-0000-000000000001'; /* single org: medini-dental-group */
const ORG_KEY = ORG_ID.replace(/-/g, '').slice(-8).toLowerCase(); /* '00000001' — allocator seq suffix */

/**
 * DEV-ONLY demo credential (Part 2/23). This seeds an Argon2id HASH, never
 * plaintext, and only when NODE_ENV !== 'production'. Production refuses to
 * seed a default password — real credentials are provisioned out-of-band.
 * Overridable locally via SEED_DEMO_PASSWORD.
 */
const DEV_DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'medini123';

/* 14 canonical branches — mirrors MEDINI_MAIN_BRANCHES (locked frontend). */
const CANONICAL_BRANCHES = [
  { code: 'gelang-patah', shortName: 'Gelang Patah', fullName: 'Medini Dental Clinic Gelang Patah', location: 'Gelang Patah, Johor' },
  { code: 'setia-tropika', shortName: 'Setia Tropika', fullName: 'Medini Dental Clinic Setia Tropika', location: 'Setia Tropika, Johor' },
  { code: 'taman-molek', shortName: 'Taman Molek', fullName: 'Medini Dental Clinic Taman Molek', location: 'Taman Molek, Johor' },
  { code: 'metropoint-kajang', shortName: 'Metropoint Kajang', fullName: 'Medini Dental Clinic Metropoint Kajang', location: 'Kajang, Selangor' },
  { code: 'uda-business-centre', shortName: 'UDA Business Centre', fullName: 'Medini Dental Clinic UDA Business Centre', location: 'Bandar Baru UDA, Johor' },
  { code: 'taman-daya', shortName: 'Taman Daya', fullName: 'Medini Dental Clinic Taman Daya', location: 'Taman Daya, Johor' },
  { code: 'pasir-gudang', shortName: 'Pasir Gudang', fullName: 'Medini Dental Clinic Pasir Gudang', location: 'Pasir Gudang, Johor' },
  { code: 'bukit-indah', shortName: 'Bukit Indah', fullName: 'Medini Dental Clinic Bukit Indah', location: 'Bukit Indah, Johor' },
  { code: 'taman-mutiara-mas', shortName: 'Taman Mutiara Mas', fullName: 'Medini Dental Clinic Taman Mutiara Mas', location: 'Mutiara Mas, Johor' },
  { code: 'sentosa', shortName: 'Sentosa', fullName: 'Klinik Pergigian Medini Sentosa', location: 'Johor Bahru, Johor' },
  { code: 'meor-ahmad', shortName: 'Meor Ahmad', fullName: 'Klinik Pergigian Medini Meor Ahmad', location: 'Johor Bahru, Johor' },
  { code: 'pearl', shortName: 'Pearl', fullName: 'Klinik Pergigian Medini Pearl', location: 'Johor Bahru, Johor' },
  { code: 'norfaizah', shortName: 'Norfaizah', fullName: 'Klinik Pergigian Medini Norfaizah', location: 'Johor Bahru, Johor' },
  { code: 'klinik-pergigian-uda', shortName: 'Klinik Pergigian UDA', fullName: 'Klinik Pergigian UDA', location: 'Bandar Baru UDA, Johor' },
];

/* 4 demo role users (mirrors DEMO_USERS). passwordHash set in auth task (Argon2id). */
const DEMO_USERS = [
  { username: 'hq', name: 'Aisha Rahman', role: 'hq' as const, branchCode: null, doctorRef: null },
  { username: 'manager', name: 'Siti Hajar', role: 'branch_manager' as const, branchCode: 'sentosa', doctorRef: null },
  { username: 'reception', name: 'Jessica Lim', role: 'branch_admin' as const, branchCode: 'uda-business-centre', doctorRef: null },
  { username: 'doctor', name: 'Dr. Aina Rahman', role: 'doctor' as const, branchCode: 'gelang-patah', doctorRef: 'dr-aina' },
];

export async function seed(connectionString: string): Promise<{
  branches: number; staff: number; panels: number; treatments: number; consentTemplates: number;
}> {
  const db = createDatabase(connectionString);

  /* FORCE RLS: scoped reads below require an app context. Seeding is an
   * administrative (hq) operation — set the hq context so the owner session
   * (also subject to RLS after FORCE) can read back the rows it inserted. */
  await db.execute(sql`SELECT set_config('app.role', 'hq', false)`);
  const branchIds = new Map<string, string>();
  for (const b of CANONICAL_BRANCHES) {
    await db.insert(branches).values({
      orgId: ORG_ID, code: b.code, shortName: b.shortName, fullName: b.fullName,
      location: b.location, type: 'main', status: 'active',
    }).onConflictDoNothing({ target: [branches.orgId, branches.code] });
  }
  const allBranches = await db.select().from(branches);
  for (const br of allBranches) branchIds.set(br.code, br.id);

  /* Demo credential hashing — DEV/TEST only. In production we never seed a
   * default password (real accounts are provisioned with real secrets). */
  const isProd = process.env.NODE_ENV === 'production';
  const demoHash = isProd ? null : await argon2.hash(DEV_DEMO_PASSWORD, { type: argon2.argon2id });

  for (const u of DEMO_USERS) {
    const branchId = u.branchCode ? branchIds.get(u.branchCode) ?? null : null;
    await db.insert(staff).values({
      orgId: ORG_ID,
      branchId,
      name: u.name, username: u.username, role: u.role, status: 'Active',
      doctorRef: u.doctorRef, passwordHash: demoHash,
    }).onConflictDoNothing({ target: [staff.orgId, staff.username] });

    /* Idempotent dev-credential refresh: when a dev hash exists, ensure the
     * demo user's passwordHash is set (upserting NULL → hash for pre-Task-2
     * rows). Never touched in production (demoHash is null there). */
    if (demoHash) {
      await db.update(staff)
        .set({ passwordHash: demoHash, doctorRef: u.doctorRef })
        .where(sql`${staff.orgId} = ${ORG_ID} AND ${staff.username} = ${u.username}`);
    }

    /* Authoritative ACTIVE role assignment (Principal source of truth). */
    const member = (await db.select().from(staff)
      .where(sql`${staff.orgId} = ${ORG_ID} AND ${staff.username} = ${u.username}`).limit(1))[0];
    if (member) {
      await db.insert(roleAssignments).values({
        orgId: ORG_ID, staffId: member.id, role: u.role, branchId, status: 'ACTIVE',
      }).onConflictDoNothing();
    }
  }

  const staffCount = await db.select().from(staff);

  /* ------------------------------------------------------------------
   * Sprint 2A T4 — canonical Panel master data (3 seeded panels).
   * Idempotent via ON CONFLICT (org_id, lower(name)) partial unique index
   * from migration 0006: rerun does NOT duplicate and does NOT overwrite
   * user-edited fields (DO NOTHING). Codes allocated through the org
   * sequence — NEVER renumbered for existing rows (deterministic on a
   * clean DB: PNL-0001/0002/0003 in seed order).
   * ----------------------------------------------------------------*/
  const SEED_PANELS = ['AIA PANEL', 'MEDNEFITS', 'PMCARE'] as const;
  for (const name of SEED_PANELS) {
    const codeRows = await db.execute(
      sql`SELECT nextval(${sql.raw(`'medini_pnl_${ORG_KEY}'`)})::int AS n`,
    );
    const n = (codeRows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;
    const code = `PNL-${String(n).padStart(4, '0')}`;
    await db.insert(panelCompanies).values({
      orgId: ORG_ID, code, name, status: 'Active', source: 'seed',
    }).onConflictDoNothing();
  }
  const panelRows = await db.execute(
    sql`SELECT count(*)::int AS n FROM panel_companies WHERE org_id = ${ORG_ID} AND deleted_at IS NULL`,
  );
  const panelCount = (panelRows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;

  /* ------------------------------------------------------------------
   * Sprint 3 — canonical clinical reference data.
   * Treatment catalog: reference ONLY (code/name/category/duration).
   * NO price — ADR-004 (Finance consumes treatment_id later). Codes come
   * from the org sequence (medini_trt_*) — deterministic on a clean DB,
   * never renumbered for existing rows (ON CONFLICT DO NOTHING).
   * ----------------------------------------------------------------*/
  const SEED_TREATMENTS: ReadonlyArray<{ name: string; category: string; durationMin: number }> = [
    { name: 'Consultation & Examination', category: 'General', durationMin: 30 },
    { name: 'Scaling & Polishing', category: 'Preventive', durationMin: 45 },
    { name: 'Fluoride Treatment', category: 'Preventive', durationMin: 20 },
    { name: 'Composite Filling', category: 'Restorative', durationMin: 45 },
    { name: 'Amalgam Filling', category: 'Restorative', durationMin: 45 },
    { name: 'Simple Extraction', category: 'Oral Surgery', durationMin: 30 },
    { name: 'Surgical Extraction', category: 'Oral Surgery', durationMin: 60 },
    { name: 'Root Canal Treatment (Single Visit)', category: 'Endodontic', durationMin: 90 },
    { name: 'Crown (Porcelain Fused to Metal)', category: 'Prosthodontic', durationMin: 60 },
    { name: 'Dental Bridge', category: 'Prosthodontic', durationMin: 60 },
    { name: 'Teeth Whitening (In-Office)', category: 'Cosmetic', durationMin: 60 },
    { name: 'Periapical X-Ray', category: 'Imaging', durationMin: 15 },
  ];
  for (const t of SEED_TREATMENTS) {
    const codeRows = await db.execute(
      sql`SELECT nextval(${sql.raw(`'medini_trt_${ORG_KEY}'`)})::int AS n`,
    );
    const n = (codeRows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;
    const code = `TRT-${String(n).padStart(4, '0')}`;
    await db.insert(treatmentCatalog).values({
      orgId: ORG_ID, code, name: t.name, category: t.category, durationMin: t.durationMin,
    }).onConflictDoNothing();
  }
  const treatmentRows = await db.execute(
    sql`SELECT count(*)::int AS n FROM treatment_catalog WHERE org_id = ${ORG_ID} AND deleted_at IS NULL`,
  );
  const treatmentCount = (treatmentRows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;

  /* Consent templates (v1) — org-wide, versioned reference content. */
  const SEED_CONSENTS: ReadonlyArray<{ title: string; body: string }> = [
    {
      title: 'General Dental Treatment Consent',
      body: 'I consent to the dental examination and treatment discussed with me, including local anaesthesia where required. The nature, purpose, benefits, and material risks of the proposed treatment have been explained to me, and I have had the opportunity to ask questions.',
    },
    {
      title: 'Tooth Extraction Consent',
      body: 'I consent to the extraction of the tooth/teeth identified by my dentist. I understand the risks including bleeding, infection, dry socket, and possible damage to adjacent teeth or structures, and that alternative options have been explained.',
    },
    {
      title: 'Root Canal Treatment Consent',
      body: 'I consent to root canal (endodontic) treatment. I understand the procedure may require multiple visits, that success cannot be guaranteed, and that complications such as instrument fracture, perforation, or persistent infection may require further treatment or extraction.',
    },
  ];
  for (const c of SEED_CONSENTS) {
    await db.insert(consentTemplates).values({
      orgId: ORG_ID, title: c.title, body: c.body, version: 1, isActive: true,
    }).onConflictDoNothing();
  }
  const consentRows = await db.execute(
    sql`SELECT count(*)::int AS n FROM consent_templates WHERE org_id = ${ORG_ID}`,
  );
  const consentCount = (consentRows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;

  return {
    branches: allBranches.length, staff: staffCount.length, panels: panelCount,
    treatments: treatmentCount, consentTemplates: consentCount,
  };
}

/* CLI: node dist/infrastructure/database/seed.js */
if (require.main === module) {
  const url = process.env.DATABASE_URL ?? 'postgres://medini:medini_dev_password@localhost:5433/medini_dev';
  seed(url)
    .then((r) => { console.log(`Seed complete: ${r.branches} branches, ${r.staff} staff, ${r.panels} panels, ${r.treatments} treatments, ${r.consentTemplates} consent templates`); process.exit(0); })
    .catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
}
