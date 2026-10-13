import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

/**
 * FASA 5C-A — the audience window must actually filter.
 *
 * WHAT WENT WRONG
 *
 * The recall window was built as:
 *
 *     OR(lastVisitAt IS NULL, lastVisitAt <= cutoff)
 *
 * Because `patients.last_visit_at` was never written by anything, it was NULL
 * for every patient — so `IS NULL` was always true and the window matched
 * EVERYONE. Live-verified before the fix: a 1-day filter, a 3650-day filter and
 * no filter at all each returned the same count (1).
 *
 * For a WhatsApp blast that is the worst possible bug: it messages the entire
 * patient list, including people seen last week — the fastest route to being
 * reported and blocked.
 *
 * HOW THIS IS TESTED
 *
 * `vi.mock` replaces the drizzle expression helpers with recorders, then the
 * service's REAL private `audienceConditions` method is called. The assertions
 * are therefore about the shipped code, not a copy of it — a duplicated mirror
 * would pass even if the service still had the bug.
 */

type Cond = { op: string; col: string; value?: unknown };

/** Recorder state, reset per test. */
const recorded: Cond[] = [];

/** Column identity is compared by the property name drizzle exposes. */
function colName(col: unknown): string {
  return String((col as { name?: string })?.name ?? col);
}

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  const rec = (op: string) => (col: unknown, value?: unknown) => {
    recorded.push({ op, col: colName(col), value });
    return { __cond: op, col: colName(col) };
  };
  return {
    ...actual,
    eq: rec('eq'),
    lte: rec('lte'),
    gte: rec('gte'),
    inArray: rec('inArray'),
    isNull: rec('isNull'),
    isNotNull: rec('isNotNull'),
    and: (...c: unknown[]) => ({ __and: c }),
    or: (...c: unknown[]) => ({ __or: c }),
  };
});

/* Imported AFTER the mock so the service picks up the recorders. Loaded in
 * beforeAll because the project's tsconfig does not permit top-level await. */
let MarketingContentService: { prototype: object };
beforeAll(async () => {
  ({ MarketingContentService } = await import(
    '@modules/marketing/application/marketing-content.service'
  ));
});

/** Call the real private condition builder. */
function build(f: Record<string, unknown>, branchId: string | null = 'branch-1'): Cond[] {
  recorded.length = 0;
  const svc = Object.create(MarketingContentService.prototype) as unknown as {
    audienceConditions: (orgId: string, branchId: string | null, filter: unknown) => unknown;
  };
  svc.audienceConditions('org-1', branchId, f);
  return [...recorded];
}

const has = (conds: Cond[], op: string, col: string) =>
  conds.some((c) => c.op === op && c.col === col);

describe('FASA 5C-A — audience window correctness (real service method)', () => {
  beforeEach(() => {
    recorded.length = 0;
  });

  it('a recall window EXCLUDES patients with no visit on record', () => {
    const conds = build({ minMonthsSinceVisit: 3 });

    /* THE POINT: a never-visited patient is not "infinitely overdue". */
    expect(has(conds, 'isNotNull', 'last_visit_at')).toBe(true);

    /* And the null escape hatch that caused the bug is GONE. */
    expect(has(conds, 'isNull', 'last_visit_at')).toBe(false);
    expect(has(conds, 'or', '')).toBe(false);
  });

  it('"6 to 9 months" is TWO-SIDED — a patient seen 2 months ago is excluded', () => {
    const conds = build({ minMonthsSinceVisit: 6, maxMonthsSinceVisit: 9 });

    const upper = conds.find((c) => c.op === 'lte' && c.col === 'last_visit_at');
    const lower = conds.find((c) => c.op === 'gte' && c.col === 'last_visit_at');

    /* at least 6 months (180 days) since the visit... */
    expect(upper?.value).toBeInstanceOf(Date);
    /* ...but no more than 9 months (270 days) ago. */
    expect(lower?.value).toBeInstanceOf(Date);

    /* A one-sided filter would let the 2-months-ago patient through. */
    expect(lower).toBeDefined();

    const now = Date.now();
    const between = (d: Date, days: number) =>
      Math.abs((now - d.getTime()) / 86_400_000 - days) < 1;
    expect(between(upper!.value as Date, 180)).toBe(true);
    expect(between(lower!.value as Date, 270)).toBe(true);
  });

  it('"12 months or longer" needs only the lower bound', () => {
    const conds = build({ minMonthsSinceVisit: 12 });
    const bound = conds.find((c) => c.op === 'lte' && c.col === 'last_visit_at');
    expect(bound).toBeDefined();
    expect(Math.abs((Date.now() - (bound!.value as Date).getTime()) / 86_400_000 - 360)).toBeLessThan(1);
    /* No upper bound — anything more overdue than 12 months qualifies. */
    expect(conds.some((c) => c.op === 'gte' && c.col === 'last_visit_at')).toBe(false);
  });

  it('the legacy inactiveSinceDays path is also visit-gated', () => {
    const conds = build({ inactiveSinceDays: 90 });
    expect(has(conds, 'isNotNull', 'last_visit_at')).toBe(true);
    expect(has(conds, 'isNull', 'last_visit_at')).toBe(false);
  });

  it('NO window means everyone (an unfiltered preview stays valid)', () => {
    const conds = build({});
    expect(conds.some((c) => c.col === 'last_visit_at')).toBe(false);
  });

  it('a window combines with the other filters without dropping any', () => {
    const conds = build({
      minMonthsSinceVisit: 6,
      maxMonthsSinceVisit: 9,
      statuses: ['Active'],
      hasWhatsapp: true,
    });
    expect(has(conds, 'inArray', 'status')).toBe(true);
    expect(has(conds, 'isNotNull', 'whatsapp')).toBe(true);
    expect(has(conds, 'isNotNull', 'last_visit_at')).toBe(true);
    expect(conds.filter((c) => c.col === 'last_visit_at')).toHaveLength(3); // notNull + 2 bounds
  });

  /* ---------------------------------------------------------------- */
  /* The exact regression: distinct windows must produce distinct SQL  */
  /* ---------------------------------------------------------------- */

  it('REGRESSION GUARD: a 1-day window must differ from a 10-year window', () => {
    const oneDay = build({ inactiveSinceDays: 1 }).find((c) => c.op === 'lte' && c.col === 'last_visit_at');
    const tenYears = build({ inactiveSinceDays: 3650 }).find((c) => c.op === 'lte' && c.col === 'last_visit_at');

    expect(oneDay).toBeDefined();
    expect(tenYears).toBeDefined();
    /* Before the fix these were identical sets, so the count never changed. */
    expect((oneDay!.value as Date).getTime()).not.toBe((tenYears!.value as Date).getTime());
    /* The 10-year cutoff is far further back than the 1-day cutoff. */
    expect((tenYears!.value as Date).getTime()).toBeLessThan((oneDay!.value as Date).getTime());
  });

  it('statuses and branch scoping still work', () => {
    const conds = build({ statuses: ['Active', 'VIP'] }, 'branch-9');
    expect(has(conds, 'inArray', 'status')).toBe(true);
    expect(conds.some((c) => c.col === 'branch_id')).toBe(true);
  });
});
