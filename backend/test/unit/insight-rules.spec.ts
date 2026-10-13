import { describe, it, expect } from 'vitest';

import {
  buildInsights,
  noShowBranchInsights,
  revenueDropInsight,
  uninvoicedEncounterInsights,
  staleSyncInsight,
  NO_SHOW_THRESHOLD_PCT,
} from '../../src/modules/ai-manager/domain/insight-rules';

/**
 * Phase C — deterministic insight rules (dental-erp AIInsight pattern,
 * generateRadar discipline). Every test feeds REAL-shaped rows and asserts
 * the card that should (or should NOT) fire. The rules are pure; the service
 * layer only feeds them fetched numbers.
 */
describe('noShowBranchInsights — real no-show rate, threshold + minimum volume', () => {
  it('fires for a branch above threshold with enough volume', () => {
    const rows = [
      { branchId: 'b1', branchName: 'Bukit Indah', booked: 10, completed: 5, noShow: 4 },
    ];
    const cards = noShowBranchInsights(rows);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.ruleKey).toBe('no_show_branch_high:b1');
    expect(cards[0]!.severity).toBe('warning');
    expect(cards[0]!.detail).toContain('4 daripada 19');
    expect(cards[0]!.detail).toContain('21.1%');
  });

  it('escalates to critical at double the threshold', () => {
    const rows = [
      { branchId: 'b1', branchName: 'Gelang Patah', booked: 3, completed: 2, noShow: 5 },
    ];
    const cards = noShowBranchInsights(rows);
    expect(cards[0]!.severity).toBe('critical'); /* 50% >= 2x20% */
  });

  it('does NOT fire below the minimum appointment volume — one no-show on a quiet day is not a pattern', () => {
    const rows = [
      { branchId: 'b1', branchName: 'Quiet', booked: 1, completed: 1, noShow: 1 },
    ];
    expect(noShowBranchInsights(rows)).toHaveLength(0);
  });

  it('does NOT fire when the rate is under the threshold', () => {
    const rows = [
      { branchId: 'b1', branchName: 'Healthy', booked: 20, completed: 20, noShow: 1 },
    ];
    expect(noShowBranchInsights(rows)).toHaveLength(0);
  });

  it('threshold is the exported constant (20%) — changing it is a decision, not a typo fix', () => {
    expect(NO_SHOW_THRESHOLD_PCT).toBe(20);
  });
});

describe('revenueDropInsight — period-over-period decline, honest without baseline', () => {
  it('fires on a real drop above threshold', () => {
    const cards = revenueDropInsight(2000, 3000, '30 hari lepas');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.category).toBe('revenue');
    expect(cards[0]!.detail).toContain('33.3%');
    expect(cards[0]!.detail).toContain('RM2000.00');
    expect(cards[0]!.detail).toContain('RM3000.00');
  });

  it('critical at double the threshold drop', () => {
    const cards = revenueDropInsight(1000, 3000, '30 hari lepas'); /* -66.7% */
    expect(cards[0]!.severity).toBe('critical');
  });

  it('no card on a small dip', () => {
    expect(revenueDropInsight(2900, 3000, '30 hari lepas')).toHaveLength(0);
  });

  it('no card when the previous window is empty — that is "no baseline", not a -100% drop', () => {
    expect(revenueDropInsight(2000, 0, '30 hari lepas')).toHaveLength(0);
  });

  it('no card when current is zero with a baseline — a separate problem, not this rule', () => {
    expect(revenueDropInsight(0, 3000, '30 hari lepas')).toHaveLength(0);
  });
});

describe('uninvoicedEncounterInsights — completed encounters without charges', () => {
  const rows = [
    { encounterId: 'e1', patientName: 'Ahmad', branchName: 'Bukit Indah', completedAt: '2026-10-01' },
    { encounterId: 'e2', patientName: 'Siti', branchName: 'Setia Tropika', completedAt: '2026-10-02' },
  ];

  it('one card per encounter, newest-first capped, with an overflow summary', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      encounterId: `e${i}`, patientName: `P${i}`, branchName: 'B', completedAt: '2026-10-01',
    }));
    const cards = uninvoicedEncounterInsights(many);
    expect(cards).toHaveLength(6); /* 5 individual + 1 overflow */
    expect(cards.at(-1)!.detail).toContain('3 encounter selesai lain');
  });

  it('info severity — a nudge, not an alarm', () => {
    for (const c of uninvoicedEncounterInsights(rows)) expect(c.severity).toBe('info');
  });

  it('empty input, no cards', () => {
    expect(uninvoicedEncounterInsights([])).toHaveLength(0);
  });
});

describe('staleSyncInsight — Bukku freshness', () => {
  it('never synced → warning card', () => {
    const cards = staleSyncInsight(null, new Date(2026, 9, 6));
    expect(cards).toHaveLength(1);
    expect(cards[0]!.ruleKey).toBe('bukku_never_synced');
  });

  it('fresh sync → silence', () => {
    const now = new Date(2026, 9, 6);
    expect(staleSyncInsight(new Date(2026, 9, 5).toISOString(), now)).toHaveLength(0);
  });

  it('stale beyond 48h → warning; beyond 96h → critical', () => {
    const now = new Date(2026, 9, 6);
    const stale48 = staleSyncInsight(new Date(2026, 9, 4, 0, 0).toISOString(), now);
    expect(stale48[0]!.severity).toBe('warning');
    const stale100 = staleSyncInsight(new Date(2026, 9, 1, 0, 0).toISOString(), now);
    expect(stale100[0]!.severity).toBe('critical');
  });
});

describe('buildInsights — composition keeps rule order stable (revenue first)', () => {
  it('aggregates all firing rules in display order', () => {
    const cards = buildInsights({
      branchNoShow: [{ branchId: 'b1', branchName: 'B', booked: 10, completed: 5, noShow: 4 }],
      currentRevenue: 1000, previousRevenue: 3000, periodLabel: '30 hari lepas',
      uninvoiced: [{ encounterId: 'e1', patientName: 'Ahmad', branchName: 'B', completedAt: '2026-10-01' }],
      bukkuLastSyncedAt: null,
      now: new Date(2026, 9, 6),
    });
    /* revenueDrop first (top of display), then no-show, uninvoiced, stale sync. */
    expect(cards[0]!.ruleKey).toBe('revenue_drop_vs_prev');
    expect(cards.map((c) => c.ruleKey)).toContain('no_show_branch_high:b1');
    expect(cards.map((c) => c.ruleKey)).toContain('encounter_uninvoiced:e1');
    expect(cards.map((c) => c.ruleKey)).toContain('bukku_never_synced');
  });

  it('a healthy clinic gets ZERO cards — silence is the honest answer', () => {
    const cards = buildInsights({
      branchNoShow: [{ branchId: 'b1', branchName: 'B', booked: 20, completed: 20, noShow: 1 }],
      currentRevenue: 3000, previousRevenue: 2900, periodLabel: '30 hari lepas',
      uninvoiced: [],
      bukkuLastSyncedAt: new Date(2026, 9, 5).toISOString(),
      now: new Date(2026, 9, 6),
    });
    expect(cards).toHaveLength(0);
  });
});
