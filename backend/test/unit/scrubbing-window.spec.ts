import { describe, it, expect, vi } from 'vitest';

import { ScrubbingService } from '@modules/marketing/application/scrubbing.service';
import type { DbContextService } from '@core/auth/db-context.service';
import type { Principal } from '@core/auth/principal';

/** Minimal transaction surface the stubs drive. */
type TxStub = { execute: (query: unknown) => Promise<{ rows: unknown[] }> };

/** Callable `sql` stub carrying its raw() helper and capture log. */
type SqlStub = {
  (strings: TemplateStringsArray, ...values: unknown[]): { __sql: string };
  raw: (s: string) => { __sql: string };
  __log: string[];
};

/**
 * FASA 5C-B — the recall window and treatment filter.
 *
 * WHY THIS MATTERS
 *
 * This is the query that decides who gets messaged. Two failure modes are
 * unacceptable for a clinic:
 *
 *   1. Sending to someone who came in last week (spam → reports → restriction).
 *   2. Sending to someone who was never a patient (they have no treatment
 *      history, so a "you're overdue" message is simply wrong).
 *
 * The previous form of this query treated a NULL last visit as "infinitely
 * overdue", which put never-visited patients into every recall list.
 *
 * HOW IT IS TESTED
 *
 * `scrubbing.service.ts` builds one big SQL statement, so the assertions capture
 * the interpolated SQL and check that the RIGHT clauses are present — a filter
 * that silently disappears from the generated SQL is exactly the bug class here.
 */

/**
 * Capture every `sql` template the service builds.
 *
 * The log lives on the mocked module rather than an outer variable: the
 * `vi.mock` factory is hoisted above this file's declarations and runs while
 * `src/infrastructure/database/schema.ts` is being imported, i.e. before any
 * `let`/`const` here has been initialised. Storing it here means the factory
 * needs nothing from module scope.
 *
 * `sql.raw()` is stubbed separately because the service uses it to build the
 * phone-normalisation fragment.
 */
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  const log: string[] = [];
  const sqlFn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce(
      (acc, part, i) => acc + part + (i < values.length ? `__V(${String(values[i])})__` : ''),
      '',
    );
    log.push(text);
    return { __sql: text };
  }) as SqlStub;
  sqlFn.raw = (s: string) => ({ __sql: s });
  sqlFn.__log = log;
  return { ...actual, sql: sqlFn };
});

/* Bound after the mock is in place, so the import resolves to the stub. */
async function sqlLog(): Promise<string[]> {
  const mod = await import('drizzle-orm');
  return ((mod as unknown as { sql: { __log: string[] } }).sql.__log) ?? [];
}

function resetLog(log: string[]) {
  log.length = 0;
}

const ORG = '00000000-0000-0000-0000-000000000001';
const BRANCH = 'af0a0841-0786-40b2-9b4e-30ed9270a659';

function harness(log: string[], rows: unknown[] = [], treatments: unknown[] = []) {
  const dbCtx = {
    runAs: vi.fn(async (_p: unknown, fn: (tx: TxStub) => Promise<unknown>) =>
      fn({
        execute: vi.fn(async () => {
          const last = log[log.length - 1] ?? '';
          /* The catalogue query names treatment_catalog without the CTE. */
          const isCatalogue = /FROM treatment_catalog/.test(last) && !/patient_activity/.test(last);
          return { rows: isCatalogue ? treatments : rows };
        }),
      }),
    ),
  };

  return { svc: new ScrubbingService(dbCtx as unknown as DbContextService), dbCtx };
}

const HQ = { staffId: 's1', orgId: ORG, role: 'hq', branchId: null } as unknown as Principal;
const MANAGER = { staffId: 's2', orgId: ORG, role: 'branch_manager', branchId: BRANCH } as unknown as Principal;



describe('FASA 5C-B — recall window (range) and treatment filter', () => {
  it('a window ALWAYS requires a recorded visit', async () => {
    const log = await sqlLog(); resetLog(log);
    const { svc } = harness(log);
    await svc.listCandidates(HQ, { branchId: BRANCH, minMonths: 6 });

    const q = log.join('\n');

    /* THE POINT: never-visited patients must not be treated as overdue.
     *
     * The original bug was an `OR last_visit_at IS NULL` escape hatch, which
     * matched every row because the column was NULL for everyone. Asserting only
     * that the sentinel-comparison EXISTS would still pass with that `OR` in
     * place, so this asserts the shape of the predicate itself: one comparison
     * against the sentinel, with no second branch that widens it. */
    const guard = q.match(/pa\.last_visit_at\s*>\s*TIMESTAMP\('1000-01-01 00:00:00'\)/g) ?? [];
    expect(guard.length).toBeGreaterThanOrEqual(1);
    /* No "OR <something> = sentinel" and no "IS NULL" widening the window. */
    expect(q).not.toMatch(/OR\s+pa\.last_visit_at\s*=/);
    expect(q).not.toMatch(/pa\.last_visit_at\s+IS\s+NULL/);
  });

  it('a range is TWO-SIDED — 6 to 9 months excludes someone seen 2 months ago', async () => {
    const log = await sqlLog(); resetLog(log);
    const { svc } = harness(log);
    await svc.listCandidates(HQ, { branchId: BRANCH, minMonths: 6, maxMonths: 9 });

    const q = log[log.length - 1] ?? '';
    expect(q).toContain('INTERVAL __V(6)__ MONTH');
    expect(q).toContain('INTERVAL __V(9)__ MONTH');
    /* Both bounds present: a lower (at least) and an upper (no more than). */
    expect((q.match(/INTERVAL __V\(\d+\)__ MONTH/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('"12 months or longer" leaves the upper bound unbounded', async () => {
    const log = await sqlLog(); resetLog(log);
    const { svc } = harness(log);
    await svc.listCandidates(HQ, { branchId: BRANCH, minMonths: 12, maxMonths: 120 });

    const q = log[log.length - 1] ?? '';
    /* The unbounded sentinel short-circuits the upper comparison. */
    expect(q).toContain('__V(120)__ >= __V(120)__');
  });

  it('the LEGACY `months` parameter still works as a lower bound', async () => {
    const log = await sqlLog(); resetLog(log);
    const { svc } = harness(log);
    await svc.listCandidates(HQ, { branchId: BRANCH, months: 6 });

    /* Existing callers (WhatsAppBlast.tsx) send `months`; it must not break. */
    expect(log[log.length - 1] ?? '').toContain('INTERVAL __V(6)__ MONTH');
  });

  it('an inverted range is refused, not silently accepted', async () => {
    const log = await sqlLog(); resetLog(log);
    const { svc } = harness(log);
    /* ValidationError reports a generic message, so assert on the field errors
     * — that is what the operator actually sees in the UI. */
    await expect(
      svc.listCandidates(HQ, { branchId: BRANCH, minMonths: 9, maxMonths: 6 }),
    ).rejects.toMatchObject({
      fieldErrors: { maxMonths: expect.arrayContaining([expect.stringContaining('Julat')]) },
    });
  });

  it('filters by treatment CATEGORY through the catalogue join', async () => {
    const log = await sqlLog(); resetLog(log);
    const { svc } = harness(log);
    await svc.listCandidates(HQ, { branchId: BRANCH, treatmentCategory: 'Preventive' });

    const q = log[log.length - 1] ?? '';
    /* Joined via treatment_plan_items → treatment_catalog, not string matching. */
    expect(q).toContain('treatment_plan_items');
    expect(q).toContain('treatment_catalog');
    expect(q).toContain('__V(Preventive)__');
    expect(q).toContain('pa.last_treatment_category');
  });

  it('filters by exact treatment CODE', async () => {
    const log = await sqlLog(); resetLog(log);
    const { svc } = harness(log);
    await svc.listCandidates(HQ, { branchId: BRANCH, treatmentCode: 'TRT-0001' });

    const q = log[log.length - 1] ?? '';
    expect(q).toContain('__V(TRT-0001)__');
    expect(q).toContain('pa.last_treatment_code');
  });

  it('no treatment filter means no treatment constraint (all treatments)', async () => {
    const log = await sqlLog(); resetLog(log);
    const { svc } = harness(log);
    await svc.listCandidates(HQ, { branchId: BRANCH, minMonths: 3 });

    const q = log[log.length - 1] ?? '';
    /* The guard is present but passes NULL on both sides, which is a no-op. */
    expect(q).toContain('__V(null)__ IS NULL');
  });

  it('excludes patients with an upcoming appointment', async () => {
    const log = await sqlLog(); resetLog(log);
    const { svc } = harness(log);
    await svc.listCandidates(HQ, { branchId: BRANCH, minMonths: 3 });

    /* Someone already booked does not need a "come back" message. */
    expect(log[log.length - 1] ?? '').toContain('future_appt');
  });

  it('excludes anyone contacted recently (default 30 days)', async () => {
    const log = await sqlLog(); resetLog(log);
    const { svc } = harness(log);
    await svc.listCandidates(HQ, { branchId: BRANCH, minMonths: 3 });

    const q = log[log.length - 1] ?? '';
    expect(q).toContain('recent_out');
    expect(q).toContain('__V(30)__ DAY');
    /* Phone matching is normalised on the patient side, or it would never match
     * the normalised numbers stored on conversations. The fragment is built with
     * sql.raw(), which this mock stubs, so assert the call shape. */
    expect(q).toContain('recent_conv.contact_phone');
  });

  it('honours a custom exclusion window', async () => {
    const log = await sqlLog(); resetLog(log);
    const { svc } = harness(log);
    await svc.listCandidates(HQ, { branchId: BRANCH, minMonths: 3, excludeContactedDays: 90 });
    expect(log[log.length - 1] ?? '').toContain('__V(90)__ DAY');
  });

  it('a branch manager cannot scrub another branch', async () => {
    const log = await sqlLog(); resetLog(log);
    const { svc } = harness(log);
    await expect(
      svc.listCandidates(MANAGER, { branchId: '39fef961-bd9d-4ee9-9a6b-eb38ecf819e2' }),
    ).rejects.toThrow(/another branch/i);
  });

  it('a manager is pinned to their own branch when none is supplied', async () => {
    const log = await sqlLog(); resetLog(log);
    const { svc } = harness(log);
    await svc.listCandidates(MANAGER, {});
    expect(log[log.length - 1] ?? '').toContain(BRANCH);
  });

  it('hq without a branch is refused rather than defaulting to everything', async () => {
    const log = await sqlLog(); resetLog(log);
    const { svc } = harness(log);
    await expect(svc.listCandidates(HQ, {})).rejects.toMatchObject({
      fieldErrors: { branchId: expect.arrayContaining([expect.stringContaining('Branch mesti dipilih')]) },
    });
  });

  it('a receptionist cannot scrub at all', async () => {
    const log = await sqlLog(); resetLog(log);
    const { svc } = harness(log);
    await expect(
      svc.listCandidates({ ...HQ, role: 'receptionist' } as unknown as Principal, { branchId: BRANCH }),
    ).rejects.toThrow(/restricted/i);
  });

  /* ------------------------------------------------------------- mapping */

  it('maps catalogue fields into the candidate, tolerating nulls', async () => {
    const log = await sqlLog(); resetLog(log);
    const { svc } = harness(log, [
      {
        patientId: 'p1', mrn: 'MRN-1', name: 'Siti', contactPhone: '60123456789',
        lastVisitDate: '2026-01-15', daysSinceLastVisit: 220, monthsSinceLastVisit: 7,
        lastTreatment: 'Scaling & Polishing',
        lastTreatmentCode: 'TRT-0001', lastTreatmentCategory: 'Preventive',
        suggestedReason: 'Follow-up selepas Scaling & Polishing',
      },
      {
        patientId: 'p2', mrn: 'MRN-2', name: 'Ahmad', contactPhone: '60198765432',
        lastVisitDate: '2025-03-01', daysSinceLastVisit: 500, monthsSinceLastVisit: 16,
        lastTreatment: null, lastTreatmentCode: null, lastTreatmentCategory: null,
        suggestedReason: null,
      },
    ]);

    const out = await svc.listCandidates(HQ, { branchId: BRANCH, minMonths: 6 });

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      patientId: 'p1',
      lastTreatmentCode: 'TRT-0001',
      lastTreatmentCategory: 'Preventive',
      monthsSinceLastVisit: 7,
    });
    /* Nulls must become null, not the string "null" or "undefined". */
    expect(out[1]!.lastTreatmentCode).toBeNull();
    expect(out[1]!.lastTreatmentCategory).toBeNull();
    /* A missing treatment label falls back rather than rendering empty. */
    expect(out[1]!.lastTreatment).toBe('Pemeriksaan');
  });

  it('the catalogue endpoint returns code/name/category for the filter', async () => {
    const log = await sqlLog(); resetLog(log);
    const { svc } = harness(log, [], [
      { code: 'TRT-0001', name: 'Scaling & Polishing', category: 'Preventive' },
      { code: 'TRT-0002', name: 'Composite Filling', category: 'Restorative' },
    ]);

    const out = await svc.listTreatments(HQ);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      code: 'TRT-0001', name: 'Scaling & Polishing', category: 'Preventive',
    });
    /* Read from the table, so the filter cannot drift from the catalogue. */
    expect(log[log.length - 1] ?? '').toContain('treatment_catalog');
    expect(log[log.length - 1] ?? '').toContain('is_active');
  });
});
