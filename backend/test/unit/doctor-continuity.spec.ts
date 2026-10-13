import { describe, it, expect } from 'vitest';

import {
  preferredDoctor,
  realVisits,
  preferenceLine,
  type Visit,
} from '@modules/ai-manager/domain/doctor-continuity';

/**
 * FASA 6B — which doctor a returning patient wants.
 *
 * The failure this guards against is quiet and corrosive: the clinic greets a
 * patient with a stranger's name. It looks like the clinic does not know them,
 * which undoes the point of having their history at all.
 */

const v = (doctorId: string, doctorName: string, date: string): Visit => ({
  doctorId,
  doctorName,
  date,
});

describe('FASA 6B — the usual doctor', () => {
  it('picks the doctor seen most often', () => {
    const pref = preferredDoctor([
      v('siti', 'Dr. Siti', '2026-06-01'),
      v('siti', 'Dr. Siti', '2026-07-01'),
      v('siti', 'Dr. Siti', '2026-08-01'),
      v('ahmad', 'Dr. Ahmad', '2026-09-01'),
    ]);
    expect(pref?.doctorId).toBe('siti');
    expect(pref?.visits).toBe(3);
  });

  it('does NOT let one recent substitute visit re-label a long-standing patient', () => {
    /* Five visits with Dr. Siti, then one emergency with whoever was free. The
     * naive "ORDER BY date DESC LIMIT 1" would offer Dr. Ahmad to a patient who
     * has seen Dr. Siti five times — the exact wrongness this rule exists to
     * prevent. */
    const pref = preferredDoctor([
      v('siti', 'Dr. Siti', '2026-01-01'),
      v('siti', 'Dr. Siti', '2026-02-01'),
      v('siti', 'Dr. Siti', '2026-03-01'),
      v('siti', 'Dr. Siti', '2026-04-01'),
      v('siti', 'Dr. Siti', '2026-05-01'),
      v('ahmad', 'Dr. Ahmad', '2026-09-01'),
    ]);
    expect(pref?.doctorId).toBe('siti');
    expect(pref?.alsoMostRecent).toBe(false);
  });

  it('follows a genuine switch when the recent doctor is close behind', () => {
    /* Two visits with Dr. Siti long ago, then two with Dr. Ahmad. Within one
     * visit of the leader, so this reads as a change of dentist rather than a
     * one-off — and the newest visit decides. */
    const pref = preferredDoctor([
      v('siti', 'Dr. Siti', '2026-01-01'),
      v('siti', 'Dr. Siti', '2026-02-01'),
      v('ahmad', 'Dr. Ahmad', '2026-03-01'),
      v('ahmad', 'Dr. Ahmad', '2026-04-01'),
    ]);
    expect(pref?.doctorId).toBe('ahmad');
  });

  it('takes the recent doctor when they are one visit behind', () => {
    const pref = preferredDoctor([
      v('siti', 'Dr. Siti', '2026-01-01'),
      v('siti', 'Dr. Siti', '2026-02-01'),
      v('ahmad', 'Dr. Ahmad', '2026-09-01'),
    ]);
    expect(pref?.doctorId).toBe('ahmad');
    expect(pref?.reason).toBe('most_recent_close');
  });

  it('keeps the leader when the recent doctor is two or more behind', () => {
    /* The boundary. Three visits behind an established pattern is an exception,
     * not a preference. */
    const pref = preferredDoctor([
      v('siti', 'Dr. Siti', '2026-01-01'),
      v('siti', 'Dr. Siti', '2026-02-01'),
      v('siti', 'Dr. Siti', '2026-03-01'),
      v('ahmad', 'Dr. Ahmad', '2026-09-01'),
    ]);
    expect(pref?.doctorId).toBe('siti');
    expect(pref?.reason).toBe('most_visits');
  });

  it('handles a single visit', () => {
    const pref = preferredDoctor([v('siti', 'Dr. Siti', '2026-01-01')]);
    expect(pref?.doctorId).toBe('siti');
    expect(pref?.visits).toBe(1);
    expect(pref?.alsoMostRecent).toBe(true);
  });

  it('says nothing for a patient with no history', () => {
    expect(preferredDoctor([])).toBeNull();
  });

  it('respects a minimum-visit threshold', () => {
    const one = [v('siti', 'Dr. Siti', '2026-01-01')];
    expect(preferredDoctor(one, 1)?.doctorId).toBe('siti');
    expect(preferredDoctor(one, 2)).toBeNull();
  });

  it('breaks a tie in visits toward the more recent', () => {
    const pref = preferredDoctor([
      v('siti', 'Dr. Siti', '2026-01-01'),
      v('ahmad', 'Dr. Ahmad', '2026-05-01'),
    ]);
    expect(pref?.doctorId).toBe('ahmad');
  });

  it('ignores a visit with no doctor attached', () => {
    /* A slot held without a doctor — a walk-in waiting to be assigned — must not
     * become "their doctor". */
    const pref = preferredDoctor([
      { doctorId: '', doctorName: '', date: '2026-09-01' },
      v('siti', 'Dr. Siti', '2026-01-01'),
    ]);
    expect(pref?.doctorId).toBe('siti');
  });

  it('does not mutate the caller array', () => {
    const rows = [v('a', 'Dr. A', '2026-01-01'), v('b', 'Dr. B', '2026-02-01')];
    const before = rows.map((r) => r.date);
    preferredDoctor(rows);
    expect(rows.map((r) => r.date)).toEqual(before);
  });
});

describe('FASA 6B — which visits count', () => {
  it('excludes cancelled and no-show appointments', () => {
    /* A cancelled appointment tells us the patient did NOT see that doctor. */
    const visits = realVisits([
      { doctorId: 'siti', doctorName: 'Dr. Siti', date: '2026-01-01', status: 'completed' },
      { doctorId: 'ahmad', doctorName: 'Dr. Ahmad', date: '2026-02-01', status: 'cancelled' },
      { doctorId: 'bella', doctorName: 'Dr. Bella', date: '2026-03-01', status: 'no-show' },
    ]);
    expect(visits).toHaveLength(1);
    expect(visits[0]!.doctorId).toBe('siti');
  });

  it('keeps every status that means the patient was seen', () => {
    const visits = realVisits([
      { doctorId: 'a', doctorName: 'Dr. A', date: '2026-01-01', status: 'completed' },
      { doctorId: 'a', doctorName: 'Dr. A', date: '2026-01-02', status: 'checked-in' },
      { doctorId: 'a', doctorName: 'Dr. A', date: '2026-01-03', status: 'confirmed' },
    ]);
    expect(visits).toHaveLength(3);
  });

  it('keeps a future booking, since it is also an intention', () => {
    /* A confirmed appointment next week IS a preference signal — the patient
     * chose that doctor. */
    const visits = realVisits([
      { doctorId: 'siti', doctorName: 'Dr. Siti', date: '2026-12-01', status: 'confirmed' },
    ]);
    expect(visits).toHaveLength(1);
  });
});

describe('FASA 6B — what the AI is told', () => {
  it('states the doctor and the count as facts', () => {
    /* The AI is given what is KNOWN. "We think you prefer" is not a fact, and
     * a model left to infer it will phrase it as a guess. */
    const line = preferenceLine({
      doctorId: 'siti', doctorName: 'Dr. Siti', visits: 3,
      alsoMostRecent: true, reason: 'most_visits',
    });
    expect(line).toContain('Dr. Siti');
    expect(line).toContain('3 kali');
  });

  it('says "1 kali", not "1 times"', () => {
    const line = preferenceLine({
      doctorId: 'siti', doctorName: 'Dr. Siti', visits: 1,
      alsoMostRecent: true, reason: 'most_visits',
    });
    expect(line).toContain('1 kali');
  });

  it('says nothing when there is no preference', () => {
    expect(preferenceLine(null)).toBe('');
  });
});
