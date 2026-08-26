import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pingDatabase, createFreshDatabase } from '@infrastructure/database/database';

/**
 * Sprint 3 (S3-A) — clinical schema foundation (live PG).
 * Verifies migrations 0007/0008 only: tables, enums, indexes, grants, RLS
 * policies, ADR-004 column guard, allocator sequences. Raw SQL — mirrors
 * payors.schema.spec.ts. Honest skip when the DB is genuinely unreachable.
 */
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev';
const RUNTIME_URL =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  'postgres://medini_app:***@localhost:5433/medini_dev';

const probe = pingDatabase(ADMIN_URL).then((ok) => {
  if (!ok) console.warn('[clinical-schema] PostgreSQL not reachable — SKIPPING (honest skip).');
  return ok;
});

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    const ok = await probe;
    if (!ok) { ctx.skip(); return; }
    await fn();
  });
}

interface RawRows { rows: Array<Record<string, unknown>> }

/** pg-ARRAY literal for raw SQL — drizzle inlines arrays as ($1,$2,...) tuples. */
function pgTextArray(values: readonly string[]): ReturnType<typeof sql.raw> {
  return sql.raw(`ARRAY[${values.map((v) => `'${v}'`).join(',')}]::text[]`);
}

const CORE_TABLES = [
  'treatment_catalog', 'encounters', 'clinical_notes', 'tooth_records',
  'treatment_plans', 'treatment_plan_items', 'treatment_sessions',
];
const EXT_TABLES = [
  'consent_templates', 'consent_records', 'imaging_records', 'prescriptions',
  'adverse_events', 'referrals', 'clinical_timeline_events',
];
const ALL_CLINICAL = [...CORE_TABLES, ...EXT_TABLES];

/** Run fn inside a transaction with the given app GUCs (mirrors runAs). */
function asRole<T>(
  db: ReturnType<typeof createFreshDatabase>['db'],
  ctx: { role: string; branchIds?: string[]; doctorId?: string },
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.role', ${ctx.role}, true)`);
    await tx.execute(sql`SELECT set_config('app.branch_ids', ${(ctx.branchIds ?? []).join(',')}, true)`);
    await tx.execute(sql`SELECT set_config('app.doctor_id', ${ctx.doctorId ?? ''}, true)`);
    return fn(tx);
  });
}

describe('Sprint 3 S3-A — clinical schema foundation (live PG)', () => {
  dbIt('all 14 clinical tables + 8 enums exist after migrations 0007/0008', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const tables = await admin.db.execute(
      sql`SELECT table_name FROM information_schema.tables
          WHERE table_schema='public' AND table_name = ANY(${pgTextArray(ALL_CLINICAL)}) ORDER BY table_name`,
    );
    expect((tables as unknown as RawRows).rows.map((r) => r.table_name)).toEqual([...ALL_CLINICAL].sort());

    const enums = await admin.db.execute(
      sql`SELECT t.typname, count(e.enumlabel)::int AS n FROM pg_type t
          JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typname IN ('encounter_status','plan_status','plan_item_status','tooth_condition',
                              'consent_method','imaging_kind','adverse_severity','referral_status')
          GROUP BY t.typname ORDER BY t.typname`,
    );
    const map = Object.fromEntries((enums as unknown as RawRows).rows.map((r) => [r.typname, r.n]));
    expect(map).toEqual({
      adverse_severity: 3, consent_method: 3, encounter_status: 3, imaging_kind: 7,
      plan_item_status: 2, plan_status: 6, referral_status: 4, tooth_condition: 7,
    });
    await admin.close();
  });

  dbIt('ADR-004 guard: NO invoice/payment/price/amount/revenue/outstanding/bukku columns on any clinical table', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const cols = await admin.db.execute(
      sql`SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name = ANY(${pgTextArray(ALL_CLINICAL)})
          AND column_name ~ '(invoice|payment|price|amount|revenue|outstanding|bukku|claim|cost|fee)'`,
    );
    expect((cols as unknown as RawRows).rows).toHaveLength(0);
    await admin.close();
  });

  dbIt('RLS is ENABLED + FORCED on all 14 clinical tables', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const r = await admin.db.execute(
      sql`SELECT relname FROM pg_class
          WHERE relname = ANY(${pgTextArray(ALL_CLINICAL)}) AND relrowsecurity AND relforcerowsecurity
          ORDER BY relname`,
    );
    expect((r as unknown as RawRows).rows.map((x) => x.relname)).toEqual([...ALL_CLINICAL].sort());
    await admin.close();
  });

  dbIt('grants: immutable tables are SELECT/INSERT only; mutable tables have no DELETE', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const g = await admin.db.execute(
      sql`SELECT table_name, privilege_type, '§' AS col FROM information_schema.role_table_grants
          WHERE grantee='medini_app' AND table_name = ANY(${pgTextArray(ALL_CLINICAL)})
          UNION ALL
          SELECT table_name, privilege_type, column_name FROM information_schema.role_column_grants
          WHERE grantee='medini_app' AND table_name = ANY(${pgTextArray(ALL_CLINICAL)})`,
    );
    const byTable = new Map<string, Set<string>>();          /* TABLE-level privileges only */
    const clinicalNotesUpdateCols = new Set<string>();          /* column-level grants */
    for (const row of (g as unknown as RawRows).rows) {
      const t = row.table_name as string;
      if (row.col === '§') {
        if (!byTable.has(t)) byTable.set(t, new Set());
        byTable.get(t)!.add(row.privilege_type as string);
      } else if (t === 'clinical_notes' && row.privilege_type === 'UPDATE') {
        clinicalNotesUpdateCols.add(row.col as string);
      }
    }
    /* ADR-009: the ONLY updatable columns are the three signing columns
     * (column-level grant — table-level UPDATE privilege is absent). */
    expect([...clinicalNotesUpdateCols].sort())
      .toEqual(['signed_at', 'signed_by', 'superseded_by_note_id']);
    expect(byTable.get('clinical_notes')?.has('UPDATE') ?? false).toBe(false);
    /* ADR-009 insert-only at privilege level (no table-level UPDATE/DELETE) */
    for (const t of ['clinical_notes', 'treatment_sessions', 'consent_records', 'adverse_events', 'clinical_timeline_events']) {
      const privs = byTable.get(t)!;
      expect(privs.has('SELECT')).toBe(true);
      expect(privs.has('INSERT')).toBe(true);
      expect(privs.has('UPDATE')).toBe(false);
      expect(privs.has('DELETE')).toBe(false);
    }
    /* mutable: SELECT/INSERT/UPDATE, never DELETE */
    for (const t of ['treatment_catalog', 'encounters', 'tooth_records', 'treatment_plans', 'treatment_plan_items', 'consent_templates', 'imaging_records', 'prescriptions', 'referrals']) {
      const privs = byTable.get(t)!;
      expect(privs.has('SELECT')).toBe(true);
      expect(privs.has('INSERT')).toBe(true);
      expect(privs.has('UPDATE')).toBe(true);
      expect(privs.has('DELETE')).toBe(false);
    }
    await admin.close();
  });

  dbIt('allocator sequences medini_enc/tpl/trt_00000001 exist for the canonical org', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const s = await admin.db.execute(
      sql`SELECT sequencename FROM pg_sequences
          WHERE sequencename IN ('medini_enc_00000001','medini_tpl_00000001','medini_trt_00000001')
          ORDER BY sequencename`,
    );
    expect((s as unknown as RawRows).rows.map((r) => r.sequencename))
      .toEqual(['medini_enc_00000001', 'medini_tpl_00000001', 'medini_trt_00000001']);
    await admin.close();
  });

  dbIt('fail-closed: no app context → clinical tables return 0 rows', async () => {
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    for (const t of ['encounters', 'treatment_plans', 'clinical_notes', 'prescriptions']) {
      const r = await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.raw(t)}`);
      expect((r as unknown as { rows: Array<{ n: number }> }).rows[0]!.n).toBe(0);
    }
    await close();
  });

  dbIt('branch_admin (reception) is denied by RLS on clinical tables (matrix NONE)', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const b = await admin.db.execute(sql`SELECT id::text AS id FROM branches ORDER BY code LIMIT 1`);
    const branchId = (b as unknown as RawRows).rows[0]!.id as string;
    await admin.close();

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    const visible = await asRole(db, { role: 'branch_admin', branchIds: [branchId] }, async (tx) => {
      const counts: number[] = [];
      for (const t of ['encounters', 'treatment_plans', 'clinical_notes', 'prescriptions', 'adverse_events']) {
        const r = await tx.execute(sql`SELECT count(*)::int AS n FROM ${sql.raw(t)}`);
        counts.push((r as unknown as { rows: Array<{ n: number }> }).rows[0]!.n);
      }
      return counts;
    });
    expect(visible).toEqual([0, 0, 0, 0, 0]);
    await close();
  });

  dbIt('doctor WITH CHECK: runtime role cannot insert an encounter for another doctor', async () => {
    const admin = createFreshDatabase(ADMIN_URL);
    const b = await admin.db.execute(sql`SELECT id::text AS id FROM branches ORDER BY code LIMIT 1`);
    const branchId = (b as unknown as RawRows).rows[0]!.id as string;
    const org = await admin.db.execute(sql`SELECT org_id::text AS o FROM branches WHERE id = ${branchId}`);
    const orgId = (org as unknown as RawRows).rows[0]!.o as string;
    const doc = await admin.db.execute(sql`SELECT id::text AS id FROM staff WHERE role='doctor' LIMIT 1`);
    const doctorId = (doc as unknown as RawRows).rows[0]!.id as string;
    await admin.close();

    const { db, close } = createFreshDatabase(RUNTIME_URL);
    await expect(
      asRole(db, { role: 'doctor', branchIds: [branchId], doctorId }, async (tx) => {
        await tx.execute(sql`
          INSERT INTO encounters (org_id, branch_id, patient_id, doctor_id, encounter_code)
          VALUES (${orgId}, ${branchId}, gen_random_uuid(), gen_random_uuid(), 'ENC-RLSTEST')`);
      }),
    ).rejects.toThrow(); /* RLS WITH CHECK violation (doctor_id ≠ app_doctor_id()) */
    await close();
  });

  dbIt('ADR-009 at DB level: DELETE denied + soap content UPDATE denied; sign columns updatable', async () => {
    const { db, close } = createFreshDatabase(RUNTIME_URL);
    /* hard delete — no grant at all */
    await expect(
      asRole(db, { role: 'hq' }, async (tx) => {
        await tx.execute(sql`DELETE FROM clinical_notes WHERE false`);
      }),
    ).rejects.toSatisfy((e: unknown) =>
      /permission denied/i.test(String((e as { cause?: { message?: string } })?.cause?.message ?? e)));
    /* content tampering — no UPDATE grant on soap_* columns */
    await expect(
      asRole(db, { role: 'hq' }, async (tx) => {
        await tx.execute(sql`UPDATE clinical_notes SET soap_plan = 'tampered' WHERE false`);
      }),
    ).rejects.toSatisfy((e: unknown) =>
      /permission denied/i.test(String((e as { cause?: { message?: string } })?.cause?.message ?? e)));
    /* sign columns ARE updatable (the sanctioned one-way signing path) —
     * statement parses + executes (0 rows matched is fine). */
    await asRole(db, { role: 'hq' }, async (tx) => {
      await tx.execute(sql`UPDATE clinical_notes SET signed_at = now() WHERE false`);
    });
    await close();
  });
});
