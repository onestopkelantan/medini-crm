import { describe, it, expect } from 'vitest';

import { buildAnalystFacts } from '@modules/ai-manager/domain/analyst-facts';

/**
 * Fixtures mirror the LIVE /reports/* envelopes (verified 2 Oct 2026):
 * kpis cards {kpiKey, value, unit, available}; revenueByBranch rows
 * {branchName, revenue}; treatmentMix {category, count, share}.
 */
describe('buildAnalystFacts — report results become prompt FACTS', () => {
  it('renders KPI numbers with labels and marks unavailable ones honestly', () => {
    const out = buildAnalystFacts('30D', {
      kpis: {
        period: '30D',
        cards: [
          { kpiKey: 'revenue', value: '2550.0000', unit: 'MYR', available: true },
          { kpiKey: 'no_show_rate', value: '10.0', unit: 'percent', available: true },
          { kpiKey: 'recall_rate', value: null, unit: 'percent', available: false, note: 'no recall cases due in period' },
        ],
      },
    });
    expect(out).toContain('DATA DISAHKAN SISTEM');
    expect(out).toContain('Jumlah Kutipan: RM2,550.00');
    expect(out).toContain('Kadar No-Show: 10.0%');
    expect(out).toContain('Kadar Recall: tidak tersedia');
    expect(out).toContain('JANGAN mereka');
  });

  it('renders revenue by branch lines', () => {
    const out = buildAnalystFacts('30D', {
      revenueByBranch: {
        period: '30D',
        rows: [
          { branchName: 'Bukit Indah', revenue: '2100.0000' },
          { branchName: 'Setia Tropika', revenue: '350.0000' },
        ],
      },
    });
    expect(out).toContain('• Bukit Indah: RM2,100.00');
    expect(out).toContain('• Setia Tropika: RM350.00');
  });

  it('renders treatment mix entries', () => {
    const out = buildAnalystFacts('30D', {
      treatmentMix: { period: '30D', rows: [{ category: 'Restorative', count: 2, share: 40 }] },
    });
    expect(out).toContain('Restorative');
    expect(out).toContain('40%');
  });

  it('bounds appointment trends to the last 10 series points', () => {
    const series = Array.from({ length: 15 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      booked: 0, completed: 1, noShow: 0,
    }));
    const out = buildAnalystFacts('30D', { appointmentTrends: { period: '30D', series } });
    expect(out).toContain('10 hari terkini');
    expect(out).toContain('…(5 hari lain');
    expect(out).not.toContain('2026-09-01');
  });

  it('empty data object still yields the header (the reply says no data)', () => {
    const out = buildAnalystFacts('30D', {});
    expect(out).toContain('DATA DISAHKAN SISTEM');
    expect(out).toContain('tiada data');
  });
});
