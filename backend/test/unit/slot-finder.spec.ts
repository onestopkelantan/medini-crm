import { describe, it, expect } from 'vitest';

import {
  findFreeSlots,
  parseTime,
  formatTime,
  formatMalayTime,
  DEFAULT_BREAK,
  type DoctorShift,
  type BusyBlock,
} from '@modules/ai-manager/domain/slot-finder';

/**
 * FASA 6A — finding slots the patient can actually take.
 *
 * The failure this guards against is not "no options". It is AN OPTION THAT DOES
 * NOT EXIST: the AI offers 4pm, the patient accepts, and arrives to a full chair.
 * So most of these tests are about what must NOT come back.
 */

const shift = (over: Partial<DoctorShift> = {}): DoctorShift => ({
  doctorId: 'doc-siti',
  doctorName: 'Dr. Siti',
  date: '2026-10-05',
  startMin: 10 * 60,
  endMin: 17 * 60,
  ...over,
});

const busy = (over: Partial<BusyBlock> = {}): BusyBlock => ({
  doctorId: 'doc-siti',
  date: '2026-10-05',
  startMin: 15 * 60,
  durationMin: 30,
  ...over,
});

describe('FASA 6A — time formats', () => {
  it('reads the forms the clinic actually produces', () => {
    expect(parseTime('10:30')).toBe(630);
    expect(parseTime('10:30:00')).toBe(630);
    expect(parseTime('09:00')).toBe(540);
    expect(parseTime('00:00')).toBe(0);
  });

  it('refuses nonsense rather than guessing', () => {
    expect(parseTime('')).toBeNull();
    expect(parseTime(null)).toBeNull();
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('10:99')).toBeNull();
    expect(parseTime('petang')).toBeNull();
  });

  it('prints a machine time', () => {
    expect(formatTime(930)).toBe('15:30');
    expect(formatTime(600)).toBe('10:00');
  });

  it('prints the way a receptionist would say it', () => {
    /* The patient reads this on a phone. "3:30 petang" is checkable at a glance;
     * "15:30" is not, for many of them. */
    expect(formatMalayTime(930)).toBe('3:30 petang');
    expect(formatMalayTime(600)).toBe('10:00 pagi');
    expect(formatMalayTime(13 * 60)).toBe('1:00 tengah hari');
    expect(formatMalayTime(9 * 60 + 30)).toBe('9:30 pagi');
    expect(formatMalayTime(20 * 60)).toBe('8:00 malam');
  });

  it('keeps noon as 12, not 0', () => {
    /* 12:00 is noon, not midnight. A modulo slip here tells a patient "0:00". */
    expect(formatMalayTime(12 * 60)).toBe('12:00 tengah hari');
  });
});

describe('FASA 6A — what must NOT be offered', () => {
  it('never offers a slot inside an appointment the doctor already has', () => {
    const slots = findFreeSlots({
      shifts: [shift()],
      busy: [busy({ startMin: 15 * 60 })],
      preferredDate: '2026-10-05',
      preferredMin: 15 * 60,
      limit: 5,
    });
    expect(slots.some((s) => s.startMin === 15 * 60)).toBe(false);
  });

  it('treats a long appointment as blocking every slot it covers', () => {
    /* A 90-minute procedure at 3pm occupies 3:00, 3:30 AND 4:00. Checking only
     * the start time would offer 3:30, which is inside the procedure. */
    const slots = findFreeSlots({
      shifts: [shift()],
      busy: [busy({ startMin: 15 * 60, durationMin: 90 })],
      limit: 10,
    });
    const offered = slots.map((s) => s.startMin);
    expect(offered).not.toContain(15 * 60);
    expect(offered).not.toContain(15 * 60 + 30);
    expect(offered).not.toContain(16 * 60);
    /* 4:30 is clear of a 3:00–4:30 procedure. */
    expect(offered).toContain(16 * 60 + 30);
  });

  it('does not offer past the end of the doctor shift', () => {
    /* Shift ends 17:00. A 30-minute slot starting 16:45 would run to 17:15. */
    const slots = findFreeSlots({
      shifts: [shift({ startMin: 16 * 60, endMin: 17 * 60 })],
      busy: [],
      limit: 10,
    });
    expect(slots.map((s) => s.startMin)).toEqual([16 * 60, 16 * 60 + 30]);
  });

  it('excludes the lunch break even though the shift spans it', () => {
    const slots = findFreeSlots({
      shifts: [shift({ startMin: 12 * 60, endMin: 15 * 60 })],
      busy: [],
      limit: 10,
    });
    const offered = slots.map((s) => s.startMin);
    expect(offered).toContain(12 * 60 + 30);
    expect(offered).not.toContain(13 * 60);
    expect(offered).not.toContain(13 * 60 + 30);
    expect(offered).toContain(14 * 60);
  });

  it('says nothing when the doctor has no shift at all', () => {
    expect(findFreeSlots({ shifts: [], busy: [], limit: 5 })).toEqual([]);
  });

  it('says nothing when the whole shift is booked', () => {
    const blocks: BusyBlock[] = [];
    for (let t = 10 * 60; t < 17 * 60; t += 30) {
      blocks.push(busy({ startMin: t }));
    }
    expect(findFreeSlots({ shifts: [shift()], busy: blocks, limit: 5 })).toEqual([]);
  });

  it('ignores another doctor\'s appointments', () => {
    /* A full Dr. Ahmad must not block Dr. Siti's morning. */
    const slots = findFreeSlots({
      shifts: [shift()],
      busy: [busy({ doctorId: 'doc-ahmad', startMin: 10 * 60 })],
      limit: 1,
    });
    expect(slots[0]!.startMin).toBe(10 * 60);
  });

  it('ignores appointments on a different date', () => {
    const slots = findFreeSlots({
      shifts: [shift()],
      busy: [busy({ date: '2026-10-06', startMin: 10 * 60 })],
      limit: 1,
    });
    expect(slots[0]!.startMin).toBe(10 * 60);
  });
});

describe('FASA 6A — which options to offer', () => {
  it('offers the closest times to what was asked, on the day asked', () => {
    /* Asked for Monday 3pm. 3pm is taken. Closest are 2:30 and 3:30. */
    const slots = findFreeSlots({
      shifts: [shift()],
      busy: [busy({ startMin: 15 * 60 })],
      preferredDate: '2026-10-05',
      preferredMin: 15 * 60,
      limit: 2,
    });
    expect(slots.map((s) => s.startMin)).toEqual([14 * 60 + 30, 15 * 60 + 30]);
  });

  it('prefers the earlier side of a tie', () => {
    /* 2:30 and 3:30 are both 30 minutes away. Waiting LONGER than asked is the
     * worse surprise, so 2:30 comes first. */
    const slots = findFreeSlots({
      shifts: [shift()],
      busy: [busy({ startMin: 15 * 60 })],
      preferredDate: '2026-10-05',
      preferredMin: 15 * 60,
      limit: 2,
    });
    expect(slots[0]!.startMin).toBeLessThan(slots[1]!.startMin);
  });

  it('offers the requested day before a nearer time on another day', () => {
    /* The patient asked for Monday. Any Monday opening beats Tuesday, even an
     * earlier Tuesday hour. A day matters more than an hour.
     *
     * Monday's shift is narrowed to a single 16:00 slot so the second option has
     * to come from Tuesday — which is the point being tested. */
    const slots = findFreeSlots({
      shifts: [
        shift({ date: '2026-10-05', startMin: 16 * 60, endMin: 16 * 60 + 30 }),
        shift({ date: '2026-10-06', startMin: 10 * 60, endMin: 17 * 60 }),
      ],
      busy: [],
      preferredDate: '2026-10-05',
      preferredMin: 15 * 60,
      limit: 2,
    });
    expect(slots[0]!.date).toBe('2026-10-05');
    expect(slots[1]!.date).toBe('2026-10-06');
  });

  it('returns exactly two options by default', () => {
    /* One is not a choice; five is a decision the patient did not ask to make. */
    const slots = findFreeSlots({ shifts: [shift()], busy: [] });
    expect(slots).toHaveLength(2);
  });

  it('gives ONE option per time when two doctors are free then', () => {
    /* Two names at 4pm is one choice for a patient who does not care who they
     * see — the list should read as times, not as a roster. The two doctors here
     * each have a single 16:00 slot, so exactly one option survives. */
    const slots = findFreeSlots({
      shifts: [
        shift({ doctorId: 'a', doctorName: 'Dr. Ahmad', startMin: 16 * 60, endMin: 16 * 60 + 30 }),
        shift({ doctorId: 'b', doctorName: 'Dr. Bella', startMin: 16 * 60, endMin: 16 * 60 + 30 }),
      ],
      busy: [],
      limit: 5,
    });
    expect(slots).toHaveLength(1);
    expect(slots[0]!.startMin).toBe(16 * 60);
  });
});

describe('FASA 6A — the patient asked for a particular doctor', () => {
  it('offers only that doctor when one was requested', () => {
    /* The patient just said "Dr. Siti". Offering Dr. Ahmad ignores what they said
     * and is worse than offering nothing. */
    const slots = findFreeSlots({
      shifts: [
        shift({ doctorId: 'doc-siti', doctorName: 'Dr. Siti', startMin: 10 * 60, endMin: 11 * 60 }),
        shift({ doctorId: 'doc-ahmad', doctorName: 'Dr. Ahmad', startMin: 10 * 60, endMin: 17 * 60 }),
      ],
      busy: [],
      preferredDoctorId: 'doc-siti',
      limit: 5,
    });
    expect(slots.every((s) => s.doctorId === 'doc-siti')).toBe(true);
    expect(slots).toHaveLength(2);
  });

  it('marks whether the option is with the doctor they wanted', () => {
    /* The AI uses this to say "dengan Dr. Siti" or to be honest that it is someone
     * else — the two are different promises. */
    const withPreferred = findFreeSlots({
      shifts: [shift()],
      busy: [],
      preferredDoctorId: 'doc-siti',
      limit: 1,
    });
    expect(withPreferred[0]!.sameDoctor).toBe(true);

    const without = findFreeSlots({ shifts: [shift()], busy: [], limit: 1 });
    expect(without[0]!.sameDoctor).toBe(false);
  });

  it('offers nothing rather than another doctor when the wanted one is fully booked', () => {
    /* Silence is correct here. The caller then offers another DAY, which is the
     * clinic's stated fallback — not a different doctor the patient refused. */
    const slots = findFreeSlots({
      shifts: [shift({ doctorId: 'doc-siti', startMin: 10 * 60, endMin: 10 * 60 + 30 })],
      busy: [busy({ startMin: 10 * 60 })],
      preferredDoctorId: 'doc-siti',
      limit: 5,
    });
    expect(slots).toEqual([]);
  });
});

describe('FASA 6A — the clinic\'s rules hold together', () => {
  it('uses the stated lunch break by default', () => {
    expect(DEFAULT_BREAK.startMin).toBe(13 * 60);
    expect(DEFAULT_BREAK.endMin).toBe(14 * 60);
  });

  it('can be told to ignore breaks for a clinic that does not close for lunch', () => {
    const slots = findFreeSlots({
      shifts: [shift({ startMin: 13 * 60, endMin: 14 * 60 })],
      busy: [],
      breakWindow: null,
      limit: 5,
    });
    expect(slots).toHaveLength(2);
  });

  it('honours a custom appointment length', () => {
    /* A 60-minute appointment in a 10:00–12:00 shift fits at 10:00, 10:30 and
     * 11:00. Steps are 30 minutes, but the appointment is 60, so the starts are
     * offset by the appointment length — 10:30 to 11:30 is a real, valid booking
     * and excluding it would hide a slot the doctor actually has. */
    const slots = findFreeSlots({
      shifts: [shift({ startMin: 10 * 60, endMin: 12 * 60 })],
      busy: [],
      durationMin: 60,
      limit: 5,
    });
    expect(slots.map((s) => s.startMin)).toEqual([10 * 60, 10 * 60 + 30, 11 * 60]);
  });

  it('will not start an appointment that would end after the shift', () => {
    /* Shift ends 12:00. A 60-minute appointment cannot start at 11:30. */
    const slots = findFreeSlots({
      shifts: [shift({ startMin: 10 * 60, endMin: 12 * 60 })],
      busy: [],
      durationMin: 60,
      limit: 5,
    });
    expect(slots.map((s) => s.startMin)).not.toContain(11 * 60 + 30);
  });
});
