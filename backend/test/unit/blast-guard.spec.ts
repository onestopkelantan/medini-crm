import { describe, it, expect } from 'vitest';

import {
  mustAbortSend,
  effectiveWindow,
  isDue,
  shouldCancelQueued,
} from '@modules/whatsapp/domain/blast-guard';

/**
 * FASA 5C-D — the guard that runs at SEND time.
 *
 * The blast path queues messages without evaluating the safety engine (that
 * engine's window gate is 09:00–18:00, which would refuse an 08:00 or 21:00
 * blast). That is deliberate, but it moves the entire safety burden onto the
 * worker. Every rule the queue skipped must be re-checked here.
 *
 * The window option in particular means a message cannot be trusted to still be
 * sendable because it was sendable when it was queued. A 14-day blast tells a
 * patient in week 1 what the schedule decided in week 0.
 */

describe('FASA 5C-D — send-time guard: opt-out is re-checked', () => {
  it('aborts when the patient opted out after the blast was queued', () => {
    /* The exact race this exists for: patient replies STOP between queueing and
     * sending. Their number is in the queue; the queue decision is stale. */
    const verdict = mustAbortSend({
      optedOut: true,
      campaignStopped: false,
      cancelled: false,
    });

    expect(verdict.abort).toBe(true);
    expect(verdict.reason).toBe('OPTED_OUT');
  });

  it('sends when the patient has not opted out', () => {
    const verdict = mustAbortSend({
      optedOut: false,
      campaignStopped: false,
      cancelled: false,
    });

    expect(verdict.abort).toBe(false);
    expect(verdict.reason).toBeNull();
  });

  it('aborts a message belonging to a campaign the operator stopped', () => {
    /* Stopping a campaign must take effect for anything not yet sent — that is
     * what an operator means by "stop". */
    const verdict = mustAbortSend({
      optedOut: false,
      campaignStopped: true,
      cancelled: false,
    });

    expect(verdict.abort).toBe(true);
    expect(verdict.reason).toBe('CAMPAIGN_STOPPED');
  });

  it('does not resend a message already cancelled', () => {
    const verdict = mustAbortSend({
      optedOut: false,
      campaignStopped: false,
      cancelled: true,
    });

    expect(verdict.abort).toBe(true);
    expect(verdict.reason).toBe('ALREADY_CANCELLED');
  });

  it('treats opt-out as the strongest reason when several apply', () => {
    /* The recorded reason is compliance evidence shown to the clinic. Opt-out is
     * the one that matters legally, so it must be the reason that is kept. */
    const verdict = mustAbortSend({
      optedOut: true,
      campaignStopped: true,
      cancelled: true,
    });

    expect(verdict.reason).toBe('OPTED_OUT');
  });

  it('fails CLOSED when the opt-out lookup itself failed', () => {
    /* An unreachable opt-out table must not be read as "nobody opted out".
     * Sending to someone who said STOP is the harm; delaying a marketing
     * message is not. So an unknown answer aborts. */
    const verdict = mustAbortSend({
      optedOut: null,
      campaignStopped: false,
      cancelled: false,
    });

    expect(verdict.abort).toBe(true);
    expect(verdict.reason).toBe('OPT_OUT_UNKNOWN');
  });
});

describe('FASA 5C-D — send-time guard: the window comes from the database', () => {
  it('allows a blast at 08:00, which the old 09:00 gate would have refused', () => {
    /* The database says the blast window is 08:00–22:00. The hardcoded engine
     * constant says 09:00–18:00. The database wins, or the client's own blast
     * window does not work. */
    const win = effectiveWindow(8, 22);
    expect(win.windowStartHour).toBe(8);
    expect(win.windowEndHour).toBe(22);
  });

  it('allows a blast at 21:00, which the old 18:00 gate would have refused', () => {
    const win = effectiveWindow(8, 22);
    const t = new Date(Date.UTC(2026, 8, 23, 21 - 8, 0, 0)); /* 21:00 MYT */
    expect(isDue(t, new Date(Date.UTC(2026, 8, 23, 21 - 8, 0, 0)))).toBe(true);
    expect(t.getUTCHours() + 8).toBe(21);
    expect(win.windowEndHour).toBeGreaterThan(21);
  });

  it('falls back to the safe default when the branch has no saved window', () => {
    /* A branch that never opened the Anti-Ban panel has no row. Defaulting to
     * "send anytime" would be the dangerous choice. */
    const win = effectiveWindow(undefined, undefined);
    expect(win.windowStartHour).toBe(8);
    expect(win.windowEndHour).toBe(22);
  });

  it('repairs an inverted window rather than producing an empty day', () => {
    /* end <= start would make the window zero-length, and a zero-length window
     * either blocks forever or divides by zero in the planner. */
    const win = effectiveWindow(22, 8);
    expect(win.windowEndHour).toBeGreaterThan(win.windowStartHour);
  });
});

describe('FASA 5C-D — send-time guard: due time', () => {
  it('is not due before its scheduled instant', () => {
    const sendAt = new Date(Date.UTC(2026, 8, 23, 5, 0, 0));
    const now = new Date(Date.UTC(2026, 8, 23, 4, 59, 0));
    expect(isDue(sendAt, now)).toBe(false);
  });

  it('is due at or after its scheduled instant', () => {
    const sendAt = new Date(Date.UTC(2026, 8, 23, 5, 0, 0));
    expect(isDue(sendAt, new Date(Date.UTC(2026, 8, 23, 5, 0, 0)))).toBe(true);
    expect(isDue(sendAt, new Date(Date.UTC(2026, 8, 23, 5, 0, 1)))).toBe(true);
  });

  it('treats a missing schedule as immediately due', () => {
    /* A plain staff reply has no send_at and must not wait for one. */
    expect(isDue(null, new Date(Date.UTC(2026, 8, 23, 5)))).toBe(true);
  });
});

describe('FASA 5C-D — reconciliation of already-queued blast messages', () => {
  it('cancels a queued blast message whose patient has since opted out', () => {
    expect(
      shouldCancelQueued({ optedOut: true, campaignStopped: false, isBlast: true }),
    ).toBe(true);
  });

  it('cancels every queued message of a stopped campaign', () => {
    expect(
      shouldCancelQueued({ optedOut: false, campaignStopped: true, isBlast: true }),
    ).toBe(true);
  });

  it('leaves a normal staff reply alone', () => {
    /* A human wrote it and pressed send. Changing that is not this sweep's job. */
    expect(
      shouldCancelQueued({ optedOut: false, campaignStopped: false, isBlast: false }),
    ).toBe(false);
  });

  it('cancels an opted-out reply too — STOP applies to every channel, not just blasts', () => {
    /* If someone says STOP, a staff member replying manually must also not
     * reach them. Opt-out is org-wide and permanent by decision. */
    expect(
      shouldCancelQueued({ optedOut: true, campaignStopped: false, isBlast: false }),
    ).toBe(true);
  });
});
