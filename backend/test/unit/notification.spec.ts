import { describe, it, expect } from 'vitest';

import {
  NOTIFICATION_RULES,
  shouldCoalesce,
  severityFor,
  notificationRank,
  describeNotification,
} from '@modules/whatsapp/domain/notification';

/**
 * FASA 5D-B — notification behaviour.
 *
 * The failure this guards against is not "no alert" — it is "twenty alerts". A
 * clinic produces events in bursts, and an operator who learns to dismiss alerts
 * dismisses the one that mattered. So most of these tests are about what gets
 * MERGED and what is deliberately kept separate.
 */

describe('FASA 5D-B — what coalesces and what does not', () => {
  it('merges repeated "patient waiting" events inside the window', () => {
    /* Five patients asking for a human in a minute is one situation. Five rows
     * is noise the operator will clear without reading. */
    const rule = NOTIFICATION_RULES.human_needed;
    expect(shouldCoalesce(rule, 60_000, true)).toBe(true);
  });

  it('starts a NEW notification once the window has passed', () => {
    /* A receptionist clears the queue, goes to lunch, comes back. The second
     * wave must be visible as a new alert, not swallowed into a stale count. */
    const rule = NOTIFICATION_RULES.human_needed;
    expect(shouldCoalesce(rule, 11 * 60_000, true)).toBe(false);
  });

  it('NEVER merges opt-outs, however fast they arrive', () => {
    /* Each STOP is a different patient and a separate compliance record.
     * "3 pesakit berhenti melanggan" hides which three — the part the clinic
     * may need to act on. */
    const rule = NOTIFICATION_RULES.opt_out;
    expect(rule.coalesce).toBe(false);
    expect(shouldCoalesce(rule, 1_000, true)).toBe(false);
  });

  it('does not merge two different records even within the window', () => {
    /* A channel error for branch A must not absorb one for branch B: they are
     * different clinics with different numbers, fixed separately. */
    const rule = NOTIFICATION_RULES.channel_error;
    expect(shouldCoalesce(rule, 60_000, false)).toBe(false);
  });

  it('gives every kind a rule, so no kind can arrive unhandled', () => {
    for (const kind of ['human_needed', 'opt_out', 'channel_error', 'blast_blocked'] as const) {
      expect(NOTIFICATION_RULES[kind]).toBeTruthy();
      expect(NOTIFICATION_RULES[kind].windowMinutes).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('FASA 5D-B — severity', () => {
  it('escalates a waiting-patient notification as the count grows', () => {
    /* Three patients waiting is genuinely more urgent than one — the clinic is
     * falling behind, not merely busy. */
    const rule = NOTIFICATION_RULES.human_needed;
    expect(severityFor(rule, 1)).toBe('warning');
    expect(severityFor(rule, 3)).toBe('critical');
    expect(severityFor(rule, 9)).toBe('critical');
  });

  it('does NOT escalate a repeated failure — the same problem twice is not worse', () => {
    const rule = NOTIFICATION_RULES.channel_error;
    expect(severityFor(rule, 1)).toBe('critical');
    expect(severityFor(rule, 5)).toBe('critical');
  });

  it('keeps an opt-out at info: it is a record, not an emergency', () => {
    /* A clinic must know, but nobody is waiting and nothing is broken. Making it
     * critical would put it above a patient who IS waiting. */
    expect(severityFor(NOTIFICATION_RULES.opt_out, 1)).toBe('info');
  });

  it('marks a dead channel critical from the first event', () => {
    /* A channel that cannot send stops EVERY outbound message, including
     * replies to patients mid-conversation. One is already serious. */
    expect(NOTIFICATION_RULES.channel_error.baseSeverity).toBe('critical');
  });
});

describe('FASA 5D-B — ordering', () => {
  it('puts unread above read', () => {
    const unread = notificationRank({ readAt: null, severity: 'info', lastAt: '2026-01-01T00:00:00Z' });
    const read = notificationRank({ readAt: '2026-01-02T00:00:00Z', severity: 'critical', lastAt: '2026-01-02T00:00:00Z' });
    expect(unread).toBeLessThan(read);
  });

  it('puts critical above warning above info, among unread', () => {
    const crit = notificationRank({ readAt: null, severity: 'critical', lastAt: '2026-01-01T00:00:00Z' });
    const warn = notificationRank({ readAt: null, severity: 'warning', lastAt: '2026-01-01T00:00:00Z' });
    const info = notificationRank({ readAt: null, severity: 'info', lastAt: '2026-01-01T00:00:00Z' });
    expect(crit).toBeLessThan(warn);
    expect(warn).toBeLessThan(info);
  });

  it('puts newer above older within the same severity', () => {
    const newer = notificationRank({ readAt: null, severity: 'warning', lastAt: '2026-06-01T12:00:00Z' });
    const older = notificationRank({ readAt: null, severity: 'warning', lastAt: '2026-06-01T09:00:00Z' });
    expect(newer).toBeLessThan(older);
  });
});

describe('FASA 5D-B — wording the operator reads', () => {
  it('counts waiting patients in the title', () => {
    expect(describeNotification({ kind: 'human_needed', count: 1 }).title).toMatch(/1 pesakit/);
    expect(describeNotification({ kind: 'human_needed', count: 5 }).title).toMatch(/5 pesakit/);
  });

  it('includes the longest wait, because that is what decides priority', () => {
    const d = describeNotification({ kind: 'human_needed', count: 3, waitedMinutes: 42 });
    expect(d.body).toContain('42 minit');
  });

  it('omits the wait when there is none to report', () => {
    const d = describeNotification({ kind: 'human_needed', count: 1, waitedMinutes: 0 });
    expect(d.body).not.toMatch(/Paling lama/);
  });

  it('names the branch so a multi-clinic operator knows where to look', () => {
    const d = describeNotification({ kind: 'channel_error', count: 1, branchName: 'Sentosa' });
    expect(d.title).toContain('Sentosa');
  });

  it('says what to DO, not just what happened', () => {
    const d = describeNotification({ kind: 'human_needed', count: 2 });
    expect(d.body).toMatch(/WhatsApp Hub|jawab/i);
  });

  it('never leaks an internal code name into the operator text', () => {
    /* An operator reading "HUMAN_NEEDED" learns nothing about what to do. */
    for (const kind of ['human_needed', 'opt_out', 'channel_error', 'blast_blocked'] as const) {
      const d = describeNotification({ kind, count: 2, branchName: 'Sentosa' });
      expect(d.title).not.toContain(kind);
      expect(d.body).not.toContain(kind);
      expect(d.title).not.toMatch(/[A-Z]{3,}_[A-Z]/);
    }
  });

  it('explains an opt-out in terms of what will happen, not a status code', () => {
    const d = describeNotification({ kind: 'opt_out', count: 1 });
    expect(d.body).toMatch(/STOP/);
    expect(d.body).toMatch(/tidak akan menerima/);
  });
});
