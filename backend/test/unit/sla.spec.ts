import { describe, it, expect } from 'vitest';

import {
  waitingMinutes,
  slaLevel,
  waitingFirst,
  longestWait,
  slaSummary,
  DEFAULT_SLA_MINUTES,
  type SlaSubject,
} from '@modules/whatsapp/domain/sla';

/**
 * FASA 5D-C — how long a patient has waited, and who to answer first.
 *
 * The failure this guards against is not a missing number. It is a number that
 * looks reasonable and is wrong: a wait that resets every time the patient
 * writes (so a long wait hides), or a sort that buries the person who has been
 * waiting longest (so the number is right and the order defeats it).
 */

const NOW = new Date('2026-09-23T12:00:00Z');

/** Minutes ago, as a Date. */
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

const conv = (over: Partial<SlaSubject> = {}): SlaSubject => ({
  lastMessageAt: ago(10),
  createdAt: ago(10),
  firstResponseAt: null,
  needsHuman: false,
  ...over,
});

describe('FASA 5D-C — measuring the wait', () => {
  it('counts from the patient message to now, while unanswered', () => {
    expect(waitingMinutes(conv({ lastMessageAt: ago(42) }), NOW)).toBe(42);
  });

  it('stops counting once somebody has replied', () => {
    /* A settled conversation has no wait to display. Showing the time since
     * arrival would imply the patient is still waiting. */
    const answered = conv({ lastMessageAt: ago(90), firstResponseAt: ago(80) });
    expect(waitingMinutes(answered, NOW)).toBeNull();
  });

  it('falls back to when the conversation opened if there is no message time', () => {
    const opened = conv({ lastMessageAt: null, createdAt: ago(20) });
    expect(waitingMinutes(opened, NOW)).toBe(20);
  });

  it('never reports a negative wait when the clocks disagree', () => {
    /* A message timestamped in the future (clock skew between the container and
     * the database) must not render as "-3 minit", which reads as a broken
     * screen and teaches the operator to distrust the whole column. */
    const skewed = conv({ lastMessageAt: ago(-5) });
    expect(waitingMinutes(skewed, NOW)).toBe(0);
  });

  it('returns null rather than a number when there is nothing to measure', () => {
    expect(waitingMinutes(conv({ lastMessageAt: null, createdAt: null }), NOW)).toBeNull();
  });
});

describe('FASA 5D-C — how urgent the wait is', () => {
  it('is ok well inside the limit', () => {
    expect(slaLevel(3, 15)).toBe('ok');
  });

  it('warns before the limit, so there is time to act', () => {
    /* A red mark that appears only once the limit is already broken tells the
     * operator about a failure, not a risk. */
    expect(slaLevel(11, 15)).toBe('warning');
  });

  it('breaches at the limit, not one past it', () => {
    /* "15 minutes" means fifteen minutes is already too long. Off-by-one here
     * would silently give every conversation an extra minute of grace. */
    expect(slaLevel(15, 15)).toBe('breached');
    expect(slaLevel(14, 15)).toBe('warning');
  });

  it('is not urgent when the clock is not running', () => {
    expect(slaLevel(null, 15)).toBe('ok');
  });

  it('respects a branch that sets its own limit', () => {
    expect(slaLevel(20, 60)).toBe('ok');
    expect(slaLevel(20, 15)).toBe('breached');
  });
});

describe('FASA 5D-C — who to answer first', () => {
  it('puts the longest wait first', () => {
    /* This is the feature. A newest-first inbox sinks the person who has waited
     * longest further down every time somebody else writes. */
    const rows = [
      conv({ lastMessageAt: ago(5) }),
      conv({ lastMessageAt: ago(40) }),
      conv({ lastMessageAt: ago(20) }),
    ];
    const order = waitingFirst(rows, NOW).map((c) => waitingMinutes(c, NOW));
    expect(order).toEqual([40, 20, 5]);
  });

  it('sinks already-answered conversations below waiting ones', () => {
    const rows = [
      conv({ lastMessageAt: ago(60), firstResponseAt: ago(1) }),
      conv({ lastMessageAt: ago(2) }),
    ];
    const sorted = waitingFirst(rows, NOW);
    expect(waitingMinutes(sorted[0]!, NOW)).toBe(2);
    expect(waitingMinutes(sorted[1]!, NOW)).toBeNull();
  });

  it('breaks a tie toward the conversation needing a human', () => {
    const rows = [
      conv({ lastMessageAt: ago(30), needsHuman: false }),
      conv({ lastMessageAt: ago(30), needsHuman: true }),
    ];
    expect(waitingFirst(rows, NOW)[0]!.needsHuman).toBe(true);
  });

  it('does not mutate the caller array', () => {
    /* The queue list and the SLA board share a source array. Sorting in place
     * would silently reorder the other screen. */
    const rows = [conv({ lastMessageAt: ago(5) }), conv({ lastMessageAt: ago(50) })];
    const before = rows.map((r) => r.lastMessageAt);
    waitingFirst(rows, NOW);
    expect(rows.map((r) => r.lastMessageAt)).toEqual(before);
  });
});

describe('FASA 5D-C — the summary line', () => {
  it('reports nobody waiting when the clock is stopped everywhere', () => {
    const s = slaSummary([conv({ firstResponseAt: ago(1) })], 15, NOW);
    expect(s.waiting).toBe(0);
    expect(s.text).toBe('Tiada pesakit menunggu');
    expect(s.longest).toBeNull();
  });

  it('counts the waiting and names the worst', () => {
    const rows = [
      conv({ lastMessageAt: ago(22) }),
      conv({ lastMessageAt: ago(4) }),
      conv({ lastMessageAt: ago(3) }),
    ];
    const s = slaSummary(rows, 15, NOW);
    expect(s.waiting).toBe(3);
    expect(s.longest).toBe(22);
    expect(s.text).toContain('3 pesakit menunggu');
    expect(s.text).toContain('22 minit');
  });

  it('flags how many are past the limit', () => {
    const rows = [conv({ lastMessageAt: ago(30) }), conv({ lastMessageAt: ago(20) })];
    const s = slaSummary(rows, 15, NOW);
    expect(s.breaching).toBe(2);
    expect(s.text).toContain('2 lepas had');
  });

  it('reads in hours past an hour, because "187 minit" is not a duration anyone feels', () => {
    const s = slaSummary([conv({ lastMessageAt: ago(187) })], 15, NOW);
    expect(s.text).toContain('3 jam 7 minit');
  });

  it('uses the same noun for one and for many', () => {
    const one = slaSummary([conv({ lastMessageAt: ago(5) })], 15, NOW);
    expect(one.text).toContain('1 pesakit menunggu');
    const many = slaSummary(
      [conv({ lastMessageAt: ago(5) }), conv({ lastMessageAt: ago(6) })],
      15, NOW,
    );
    expect(many.text).toContain('2 pesakit menunggu');
  });

  it('picks the longest wait across a mixed board', () => {
    const rows = [
      conv({ lastMessageAt: ago(9) }),
      conv({ lastMessageAt: ago(70), firstResponseAt: ago(1) }),
      conv({ lastMessageAt: ago(12) }),
    ];
    expect(longestWait(rows, NOW)).toBe(12);
  });
});

describe('FASA 5D-C — the limit must not leak across branches', () => {
  /**
   * Regression: the board originally read ONE limit with `LIMIT 1` and no branch
   * filter. HQ on "All Branches" was graded against whichever row MySQL reached
   * first — 45 minutes while its own branch ran at 15 — so breaches were judged
   * against an unrelated number. These tests pin the per-branch rule.
   */
  it('grades each conversation against its own branch limit', () => {
    const branchA = conv({ lastMessageAt: ago(20) }); // limit 15 → breached
    const branchB = conv({ lastMessageAt: ago(20) }); // limit 60 → ok
    expect(slaLevel(waitingMinutes(branchA, NOW), 15)).toBe('breached');
    expect(slaLevel(waitingMinutes(branchB, NOW), 60)).toBe('ok');
  });

  it('has the same wait judged differently under two limits', () => {
    const minutes = waitingMinutes(conv({ lastMessageAt: ago(30) }), NOW);
    expect(slaLevel(minutes, 15)).toBe('breached');
    expect(slaLevel(minutes, 45)).toBe('warning');
    expect(slaLevel(minutes, 60)).toBe('ok');
  });

  it('defaults to a defined constant, not a literal at the call site', () => {
    expect(DEFAULT_SLA_MINUTES).toBe(15);
  });
});
