import { describe, it, expect } from 'vitest';

import {
  resolveDashboardPeriod,
  isDashboardPeriod,
} from '@modules/dashboard/domain/period';

/**
 * FASA 1A — tingkap tarikh.
 *
 * Kegagalan yang dijaga: tingkap yang bergerak senyap. Kalau "7 hari"
 * bermaksud 8 hari, atau "bulan ini" bermula bulan lepas, HQ membandingkan
 * tempoh yang berbeza daripada yang dipaparkan — dan tiada apa di skrin
 * memberitahu mereka.
 *
 * `now` disuntik supaya ujian tidak bergantung pada hari ia dijalankan.
 */

const NOW = new Date(2026, 8, 24); /* 24 September 2026 */

describe('FASA 1A — tingkap tarikh', () => {
  it('hari ini = hari ini sahaja (from = to)', () => {
    const r = resolveDashboardPeriod('today', NOW);
    expect(r.from).toBe('2026-09-24');
    expect(r.to).toBe('2026-09-24');
  });

  it('7D merangkumi 7 hari TERMASUK hari ini', () => {
    /* 18..24 September = 7 hari. Kalau seseorang tulis "-7" ia jadi 8 hari. */
    const r = resolveDashboardPeriod('7D', NOW);
    expect(r.from).toBe('2026-09-18');
    expect(r.to).toBe('2026-09-24');
  });

  it('30D merangkumi 30 hari termasuk hari ini', () => {
    const r = resolveDashboardPeriod('30D', NOW);
    expect(r.from).toBe('2026-08-26');
    expect(r.to).toBe('2026-09-24');
  });

  it('MTD bermula pada hari pertama bulan ini', () => {
    const r = resolveDashboardPeriod('MTD', NOW);
    expect(r.from).toBe('2026-09-01');
    expect(r.to).toBe('2026-09-24');
  });

  it('MTD pada hari pertama bulan = satu hari sahaja', () => {
    const r = resolveDashboardPeriod('MTD', new Date(2026, 8, 1));
    expect(r.from).toBe('2026-09-01');
    expect(r.to).toBe('2026-09-01');
  });

  it('tingkap merentas sempadan bulan dengan betul', () => {
    /* 1 Oktober tolak 6 hari = 25 September (bulan sebelumnya). */
    const r = resolveDashboardPeriod('7D', new Date(2026, 9, 1));
    expect(r.from).toBe('2026-09-25');
    expect(r.to).toBe('2026-10-01');
  });

  it('tingkap merentas sempadan tahun dengan betul', () => {
    const r = resolveDashboardPeriod('7D', new Date(2027, 0, 2));
    expect(r.from).toBe('2026-12-27');
    expect(r.to).toBe('2027-01-02');
  });

  it('MTD Januari tidak jatuh ke Disember tahun sebelumnya', () => {
    const r = resolveDashboardPeriod('MTD', new Date(2027, 0, 15));
    expect(r.from).toBe('2027-01-01');
    expect(r.to).toBe('2027-01-15');
  });

  it('menerima tempoh yang sah dan menolak yang lain', () => {
    expect(isDashboardPeriod('today')).toBe(true);
    expect(isDashboardPeriod('7D')).toBe(true);
    expect(isDashboardPeriod('30D')).toBe(true);
    expect(isDashboardPeriod('MTD')).toBe(true);
    expect(isDashboardPeriod('12M')).toBe(false); /* itu tempoh Reports */
    expect(isDashboardPeriod('')).toBe(false);
    expect(isDashboardPeriod(undefined)).toBe(false);
    expect(isDashboardPeriod(null)).toBe(false);
  });
});
