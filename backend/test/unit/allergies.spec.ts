import { describe, it, expect } from 'vitest';
import {
  ALLERGY_SEVERITIES, requiresAcknowledgement, severityRank,
  evaluateAllergyGate, validateAllergyDraft, validateRetire, sortAllergies,
  type ActiveAllergy,
} from '@modules/clinical/domain/allergies';

const mild: ActiveAllergy = { id: 'a1', allergen: 'Latex', severity: 'mild', reaction: 'rash' };
const unknownSev: ActiveAllergy = { id: 'a2', allergen: 'Ibuprofen', severity: 'unknown', reaction: null };
const severe: ActiveAllergy = { id: 'a3', allergen: 'Penicillin', severity: 'severe', reaction: 'swelling' };
const lifeThreat: ActiveAllergy = { id: 'a4', allergen: 'Contrast dye', severity: 'life_threatening', reaction: 'anaphylaxis' };

describe('allergy severity ordering', () => {
  it('ranks life-threatening highest and mild lowest', () => {
    expect(severityRank('life_threatening')).toBeGreaterThan(severityRank('severe'));
    expect(severityRank('severe')).toBeGreaterThan(severityRank('unknown'));
    expect(severityRank('mild')).toBe(1);
  });

  it('puts UNKNOWN above the human-downgraded tiers, not below them', () => {
    /* An allergy nobody assessed is not a mild allergy. Ranking it low would let
     * a half-filled form wave a patient through the gate. */
    expect(severityRank('unknown')).toBeGreaterThan(severityRank('moderate'));
    expect(severityRank('unknown')).toBeGreaterThan(severityRank('mild'));
    expect(severityRank('unknown')).toBeLessThan(severityRank('severe'));
  });

  it('requires acknowledgement from moderate upward, including unknown', () => {
    expect(requiresAcknowledgement('mild')).toBe(false);
    expect(requiresAcknowledgement('moderate')).toBe(true);
    expect(requiresAcknowledgement('unknown')).toBe(true);
    expect(requiresAcknowledgement('severe')).toBe(true);
    expect(requiresAcknowledgement('life_threatening')).toBe(true);
  });
});

describe('allergy gate — block, not warn', () => {
  it('allows when there are no allergies at all', () => {
    const v = evaluateAllergyGate({ activeAllergies: [], allergyAcknowledgedAt: null });
    expect(v.allowed).toBe(true);
    expect(v.blockers).toEqual([]);
  });

  it('allows when only mild allergies exist, even unacknowledged', () => {
    const v = evaluateAllergyGate({ activeAllergies: [mild], allergyAcknowledgedAt: null });
    expect(v.allowed).toBe(true);
  });

  it('BLOCKS a serious allergy that has not been acknowledged', () => {
    const v = evaluateAllergyGate({ activeAllergies: [severe], allergyAcknowledgedAt: null });
    expect(v.allowed).toBe(false);
    expect(v.blockers).toContain('ALLERGY_UNACKNOWLEDGED');
  });

  it('unblocks once acknowledged', () => {
    const v = evaluateAllergyGate({ activeAllergies: [severe], allergyAcknowledgedAt: new Date() });
    expect(v.allowed).toBe(true);
    expect(v.blockers).toEqual([]);
  });

  it('blocks on an UNASSESSED allergy — the half-filled-form case', () => {
    const v = evaluateAllergyGate({ activeAllergies: [unknownSev], allergyAcknowledgedAt: null });
    expect(v.allowed).toBe(false);
  });

  it('does not block a mild allergy just because a serious one is also present and acknowledged', () => {
    const v = evaluateAllergyGate({
      activeAllergies: [mild, severe], allergyAcknowledgedAt: new Date(),
    });
    expect(v.allowed).toBe(true);
    /* The serious ones are still reported so the UI can name them. */
    expect(v.blockingAllergies.map((a) => a.id)).toContain('a3');
  });

  it('names the blocking allergies, most serious first', () => {
    const v = evaluateAllergyGate({
      activeAllergies: [severe, lifeThreat, mild], allergyAcknowledgedAt: null,
    });
    expect(v.allowed).toBe(false);
    expect(v.blockingAllergies.map((a) => a.severity)).toEqual(['life_threatening', 'severe']);
    /* mild is not a blocker and must not be listed as one */
    expect(v.blockingAllergies.map((a) => a.id)).not.toContain('a1');
  });

  it('treats any non-null acknowledgement as acknowledged', () => {
    expect(evaluateAllergyGate({ activeAllergies: [severe], allergyAcknowledgedAt: '2026-01-01T00:00:00Z' }).allowed).toBe(true);
    expect(evaluateAllergyGate({ activeAllergies: [severe], allergyAcknowledgedAt: null }).allowed).toBe(false);
  });

  it('does not mutate the array it was given', () => {
    const rows = [mild, severe];
    const before = rows.map((r) => r.id);
    evaluateAllergyGate({ activeAllergies: rows, allergyAcknowledgedAt: null });
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe('allergy draft validation', () => {
  it('rejects an empty or one-character allergen', () => {
    expect(validateAllergyDraft({ allergen: '', severity: 'mild' }).allergen).toBeDefined();
    expect(validateAllergyDraft({ allergen: 'P', severity: 'mild' }).allergen).toBeDefined();
    expect(validateAllergyDraft({ allergen: 'Penicillin', severity: 'mild' }).allergen).toBeUndefined();
  });

  it('rejects an unknown severity and accepts every defined one', () => {
    expect(validateAllergyDraft({ allergen: 'Penicillin', severity: 'bad' }).severity).toBeDefined();
    for (const s of ALLERGY_SEVERITIES) {
      expect(validateAllergyDraft({ allergen: 'Penicillin', severity: s, reaction: 'x' }).severity).toBeUndefined();
    }
  });

  it('DEMANDS a reaction when the allergy is life-threatening', () => {
    /* A chart claiming a life-threatening allergy without saying what happened is
     * a rumour, and it is how a real alert gets ignored. */
    const errs = validateAllergyDraft({ allergen: 'Contrast dye', severity: 'life_threatening', reaction: '' });
    expect(errs.reaction).toBeDefined();

    const ok = validateAllergyDraft({ allergen: 'Contrast dye', severity: 'life_threatening', reaction: 'anaphylaxis' });
    expect(ok).toEqual({});
  });

  it('does not demand a reaction for lower severities', () => {
    expect(validateAllergyDraft({ allergen: 'Penicillin', severity: 'severe', reaction: null })).toEqual({});
    expect(validateAllergyDraft({ allergen: 'Latex', severity: 'mild', reaction: null })).toEqual({});
  });

  it('caps the length of both free-text fields', () => {
    expect(validateAllergyDraft({ allergen: 'x'.repeat(257), severity: 'mild' }).allergen).toBeDefined();
    expect(validateAllergyDraft({ allergen: 'Penicillin', severity: 'mild', reaction: 'x'.repeat(513) }).reaction).toBeDefined();
  });
});

describe('retiring an allergy requires a reason', () => {
  it('refuses an empty, short or oversized reason', () => {
    expect(validateRetire({ reason: '' }).reason).toBeDefined();
    expect(validateRetire({ reason: 'no' }).reason).toBeDefined();
    expect(validateRetire({ reason: 'x'.repeat(513) }).reason).toBeDefined();
    expect(validateRetire({}).reason).toBeDefined();
  });

  it('accepts a real reason', () => {
    expect(validateRetire({ reason: 'Skin test negative, confirmed not allergic' })).toEqual({});
  });
});

describe('allergy list ordering', () => {
  it('sorts most serious first and breaks ties alphabetically', () => {
    const rows = [
      { allergen: 'Zinc', severity: 'severe' as const },
      { allergen: 'Latex', severity: 'mild' as const },
      { allergen: 'Aspirin', severity: 'severe' as const },
    ];
    expect(sortAllergies(rows).map((r) => r.allergen)).toEqual(['Aspirin', 'Zinc', 'Latex']);
  });

  it('does not mutate the input array', () => {
    const rows = [{ allergen: 'B', severity: 'mild' as const }, { allergen: 'A', severity: 'severe' as const }];
    sortAllergies(rows);
    expect(rows.map((r) => r.allergen)).toEqual(['B', 'A']);
  });
});
