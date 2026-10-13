import { describe, it, expect } from 'vitest';

import {
  scheduleDays,
  reviewSchedule,
  elapsedDays,
  campaignProgress,
  placeExtraRecipients,
  type CampaignSchedule,
} from '@modules/whatsapp/domain/campaign-schedule';

/**
 * FASA 5F — campaign scheduling.
 *
 * The scenario that matters is the one the clinic actually described: a Merdeka
 * promotion, 1400 patients, 14 days, ending on a date that cannot move. Almost
 * every test below is about protecting that end date — either by refusing a plan
 * that cannot meet it, or by saying so before it silently slips.
 */

const base: CampaignSchedule = {
  startDate: '2026-09-01',
  endDate: '2026-09-14',
  dailyTarget: null,
  branchDailyCap: 100,
  totalCount: 1400,
  sentCount: 0,
};

describe('FASA 5F — counting the days', () => {
  it('counts inclusive days: 1 Sept to 14 Sept is 14, not 13', () => {
    /* Off-by-one here changes the daily rate for every campaign. A promotion
     * "1st to the 14th" is fourteen days to everyone except a date library. */
    expect(scheduleDays('2026-09-01', '2026-09-14')).toBe(14);
  });

  it('handles a single-day campaign', () => {
    expect(scheduleDays('2026-09-01', '2026-09-01')).toBe(1);
  });

  it('spans month ends', () => {
    expect(scheduleDays('2026-09-28', '2026-10-02')).toBe(5);
  });

  it('accepts Date objects as well as strings', () => {
    expect(scheduleDays(new Date('2026-09-01'), new Date('2026-09-03'))).toBe(3);
  });
});

describe('FASA 5F — is the plan possible', () => {
  it('accepts the clinic scenario: 1400 over 14 days at 100/day', () => {
    const v = reviewSchedule(base);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.days).toBe(14);
    expect(v.perDay).toBe(100);
  });

  it('REFUSES 1400 over 7 days and says what is needed', () => {
    /* 200/day from a number capped at 100. Sending 100 and finishing late would
     * miss the promotion date — the one thing that cannot be moved. */
    const v = reviewSchedule({ ...base, endDate: '2026-09-07' });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe('exceeds_branch_cap');
    expect(v.message).toContain('200/hari');
    expect(v.message).toContain('14 hari');
  });

  it('refuses an end before the start rather than producing a negative rate', () => {
    const v = reviewSchedule({ ...base, endDate: '2026-08-01' });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe('end_before_start');
  });

  it('treats missing dates as a draft, not an error to shout about', () => {
    const v = reviewSchedule({ ...base, endDate: null });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe('missing_dates');
  });

  it('refuses a campaign with nobody in it', () => {
    const v = reviewSchedule({ ...base, totalCount: 0 });
    expect(v.ok).toBe(false);
  });

  it('lets a deliberate lower target under the ceiling stand', () => {
    /* An operator may choose to go slower than the cap allows — for a gentle
     * recall, say. The cap is a ceiling, not a quota. */
    const v = reviewSchedule({ ...base, dailyTarget: 50 });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.perDay).toBe(50);
  });

  it('allows a smaller list to finish early', () => {
    const v = reviewSchedule({ ...base, totalCount: 140 });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.perDay).toBe(10);
  });
});

describe('FASA 5F — is it on track', () => {
  it('reports day and counts at the midpoint', () => {
    /* Day 7 of 14, 700 sent: exactly on plan. */
    const p = campaignProgress({ ...base, sentCount: 700 }, new Date('2026-09-07T12:00:00Z'));
    expect(p).not.toBeNull();
    expect(p!.elapsed).toBe(7);
    expect(p!.expected).toBe(700);
    expect(p!.onTrack).toBe(true);
    expect(p!.text).toContain('Hari 7/14');
    expect(p!.text).toContain('700/1400');
  });

  it('flags a campaign that is behind', () => {
    /* Day 13, only 300 sent. The same 300 was fine on day 3 — which is why the
     * dates are not optional for this calculation. */
    const p = campaignProgress({ ...base, sentCount: 300 }, new Date('2026-09-13T12:00:00Z'));
    expect(p!.onTrack).toBe(false);
    expect(p!.delta).toBeLessThan(0);
    expect(p!.text).toContain('lewat');
  });

  it('does not cry wolf over a small shortfall mid-day', () => {
    /* Day 7, 620 sent (80 behind, less than one day's 100). A warning that fires
     * every afternoon stops being read. */
    const p = campaignProgress({ ...base, sentCount: 620 }, new Date('2026-09-07T12:00:00Z'));
    expect(p!.onTrack).toBe(true);
  });

  it('marks a finished campaign as done', () => {
    const p = campaignProgress({ ...base, sentCount: 1400 }, new Date('2026-09-14T12:00:00Z'));
    expect(p!.done).toBe(true);
    expect(p!.onTrack).toBe(true);
    expect(p!.text).toContain('selesai');
  });

  it('reports day 0 before the campaign starts', () => {
    const p = campaignProgress(base, new Date('2026-08-25T12:00:00Z'));
    expect(p!.elapsed).toBe(0);
    expect(p!.expected).toBe(0);
  });

  it('does not run past the end date', () => {
    /* A campaign viewed a week after it ended must not report "Hari 21/14". */
    const p = campaignProgress(base, new Date('2026-09-21T12:00:00Z'));
    expect(p!.elapsed).toBe(14);
    expect(p!.remaining).toBe(0);
  });

  it('has nothing to say about an impossible plan', () => {
    expect(campaignProgress({ ...base, endDate: null })).toBeNull();
  });

  it('counts elapsed days from the start date, zero before it', () => {
    expect(elapsedDays('2026-09-01', new Date('2026-09-01T23:00:00Z'))).toBe(1);
    expect(elapsedDays('2026-09-01', new Date('2026-08-31T23:00:00Z'))).toBe(0);
  });
});

describe('FASA 5F — adding recipients mid-campaign', () => {
  it('fits extra recipients into the dates when the ceiling allows', () => {
    /* 1400 over 14 days at a ceiling of 100/day = 1400 capacity. Planning a
     * smaller list leaves real room: 14 x 100 - 1000 = 400. */
    const r = placeExtraRecipients({ ...base, totalCount: 1000 }, 200);
    expect(r).not.toBeNull();
    expect(r!.withinPlan).toBe(200);
    expect(r!.overflow).toBe(0);
  });

  it('measures room against the branch ceiling, not the pace of the plan', () => {
    /* The trap: perDay is DERIVED from the list size (ceil(1000/14) = 72), so
     * 14 x 72 = 1008 and the room would look like 8. That would refuse almost
     * every addition. Capacity is what the number can carry, not what the plan
     * currently paces at. */
    const r = placeExtraRecipients({ ...base, totalCount: 1000 }, 200);
    expect(r!.withinPlan).toBe(200);
  });

  it('pushes the overflow past the end date instead of breaking the daily cap', () => {
    /* The plan is already at capacity (1400 of 1400). Refusing is unhelpful;
     * exceeding the ceiling risks the number. So the tail is placed after the
     * end date, where it is visible. */
    const r = placeExtraRecipients(base, 200);
    expect(r).not.toBeNull();
    expect(r!.withinPlan).toBe(0);
    expect(r!.overflow).toBe(200);
    expect(r!.note).toContain('2 hari selepas tarikh tamat');
  });

  it('says nothing when the plan itself is impossible', () => {
    expect(placeExtraRecipients({ ...base, endDate: null }, 10)).toBeNull();
  });
});
