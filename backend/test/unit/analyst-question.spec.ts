import { describe, it, expect } from 'vitest';

import { resolveAnalystQuestion } from '@modules/ai-manager/domain/analyst-question';

/** Periods, keys, and fail-closed behaviour for the Data Analyst. */
describe('resolveAnalystQuestion', () => {
  it('revenue question (BM) → kpis + revenueByBranch, default 30D', () => {
    const q = resolveAnalystQuestion('berapa kutipan bulan lepas?', '2026-10-02');
    expect(q.keys).toEqual(['kpis', 'revenueByBranch']);
    expect(q.period).toBe('30D');
  });

  it('revenue question (EN) → same keys', () => {
    const q = resolveAnalystQuestion('what is our revenue this month?', '2026-10-02');
    expect(q.keys).toEqual(['kpis', 'revenueByBranch']);
  });

  it('no-show question → kpis + appointmentTrends', () => {
    const q = resolveAnalystQuestion('berapa kadar tidak hadir?', '2026-10-02');
    expect(q.keys).toEqual(['kpis', 'appointmentTrends']);
  });

  it('treatment mix question', () => {
    const q = resolveAnalystQuestion('rawatan paling popular 30 hari', '2026-10-02');
    expect(q.keys).toEqual(['treatmentMix']);
    expect(q.period).toBe('30D');
  });

  it('doctor production question', () => {
    const q = resolveAnalystQuestion('produksi doktor minggu ini', '2026-10-02');
    expect(q.keys).toEqual(['doctorProduction']);
    expect(q.period).toBe('7D');
  });

  it('new patients question', () => {
    const q = resolveAnalystQuestion('berapa pesakit baharu 90 hari lepas', '2026-10-02');
    expect(q.keys).toEqual(['newPatients']);
    expect(q.period).toBe('90D');
  });

  it('forms question', () => {
    const q = resolveAnalystQuestion('berapa MC dikeluarkan bulan ni', '2026-10-02');
    expect(q.keys).toEqual(['formsIssued']);
  });

  it('explicit short period (7 hari) wins', () => {
    const q = resolveAnalystQuestion('jualan 7 hari lepas', '2026-10-02');
    expect(q.period).toBe('7D');
  });

  it('annual period', () => {
    const q = resolveAnalystQuestion('jualan tahun ini', '2026-10-02');
    expect(q.period).toBe('12M');
  });

  it('multi-topic question merges keys in canonical order', () => {
    const q = resolveAnalystQuestion('jualan dan kadar no-show bulan lepas', '2026-10-02');
    expect(q.keys).toEqual(['kpis', 'revenueByBranch', 'appointmentTrends']);
  });

  it('no match → keys [] (fail-closed, never guesses)', () => {
    const q = resolveAnalystQuestion('apa khabar hari ini?', '2026-10-02');
    expect(q.keys).toEqual([]);
    expect(q.period).toBe('30D');
  });

  it('unrelated numbers in text do not set period', () => {
    const q = resolveAnalystQuestion('sebut 3 rawatan termurah', '2026-10-02');
    expect(q.period).toBe('30D');
  });

  /* The AI Assistant panel's own EXAMPLE questions must resolve — the
   * panel shipped before anyone re-checked the resolver against its
   * examples, and the plural bug ("treatments", "patients") plus the
   * missing appointments topic made every one of them hit the
   * capability fallback. These tests pin the contract. */
  describe('assistant examples (EN)', () => {
    it('"Top treatments in the last 30 days?" resolves treatmentMix', () => {
      const q = resolveAnalystQuestion('Top treatments in the last 30 days?', '2026-10-02');
      expect(q.keys).toContain('treatmentMix');
      expect(q.period).toBe('30D');
    });

    it('"How many new patients this month?" resolves newPatients', () => {
      const q = resolveAnalystQuestion('How many new patients this month?', '2026-10-02');
      expect(q.keys).toContain('newPatients');
      expect(q.period).toBe('30D');
    });

    it('"Appointment trends this week?" resolves appointmentTrends, 7D', () => {
      const q = resolveAnalystQuestion('Appointment trends this week?', '2026-10-02');
      expect(q.keys).toContain('appointmentTrends');
      expect(q.period).toBe('7D');
    });

    it('"How is revenue this month vs last month?" resolves kpis + compare', () => {
      const q = resolveAnalystQuestion('How is revenue this month vs last month?', '2026-10-02');
      expect(q.keys).toContain('kpis');
      expect(q.compare).toBe(true);
    });
  });
});
