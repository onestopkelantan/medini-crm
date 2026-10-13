import { describe, it, expect } from 'vitest';

import {
  matchDay,
  summarise,
  sortBySeverity,
  differenceOf,
  money,
  type DailyFigure,
} from '@modules/finance/domain/reconciliation';

/**
 * FASA 1C — padanan harian Bukku (HQ) berbanding CRM (cawangan).
 *
 * Kegagalan yang dijaga di sini bukan nombor yang hilang. Ia wang yang tidak
 * dapat dijelaskan:
 *
 *   - beza satu sen terlepas kerana "terlalu kecil" (RM5 × 100 pesakit = RM500)
 *   - cawangan yang belum key-in dikelaskan sebagai "padan" (senyap, bukan merah)
 *   - arah beza tidak disebut, jadi HQ tidak tahu siapa perlu ditanya
 *   - jumlah rasmi diambil dari CRM, jadi Dashboard menunjukkan nombor yang
 *     HQ sendiri tidak pernah sahkan
 *   - ralat titik terapung menghasilkan amaran palsu pada nilai wang yang tepat
 */

const fig = (amount: string, date = '2026-09-24', branchId = 'b1'): DailyFigure => ({
  branchId, date, amount, count: 1,
});

describe('FASA 1C — aritmetik wang', () => {
  it('mengira beza dengan tanda yang betul', () => {
    expect(differenceOf('8500.0000', '8000.0000')).toBe('500.0000');
    expect(differenceOf('8000.0000', '8500.0000')).toBe('-500.0000');
  });

  it('memberi sifar apabila sama', () => {
    expect(differenceOf('8000.0000', '8000.0000')).toBe('0.0000');
  });

  it('mengesan beza SATU SEN dengan tepat', () => {
    /* Ini ujian paling penting dalam fail ini. */
    expect(differenceOf('8000.0000', '7999.9900')).toBe('0.0100');
  });

  it('TIADA ralat titik terapung pada nilai wang sebenar', () => {
    /* 0.1 + 0.2 dalam Number ialah 0.30000000000000004. Aritmetik skal
       integer wang mesti mengelak ini sepenuhnya. */
    expect(differenceOf('0.3000', '0.2000')).toBe('0.1000');
    expect(differenceOf('0.1000', '0.2000')).toBe('-0.1000');
  });

  it('mengendalikan nilai besar dengan tepat', () => {
    expect(differenceOf('1234567.8901', '1234567.8900')).toBe('0.0001');
  });

  it('memformat wang untuk paparan', () => {
    expect(money('8000.0000')).toBe('RM8,000.00');
    expect(money('0.5000')).toBe('RM0.50');
  });
});

describe('FASA 1C — keputusan padanan', () => {
  it('kedua-dua sama = matched, tanpa mesej', () => {
    const m = matchDay(fig('8000.0000'), fig('8000.0000'), '2026-09-24', 'b1');
    expect(m.status).toBe('matched');
    expect(m.message).toBeNull();
    expect(m.bukku).toBe('8000.0000');
  });

  it('beza satu sen = MISMATCH (sifar toleransi)', () => {
    /* Kalau ujian ini gagal, beza kecil mula terlepas. */
    const m = matchDay(fig('8000.0000'), fig('7999.9900'), '2026-09-24', 'b1');
    expect(m.status).toBe('mismatch');
    expect(m.message).toContain('Beza');
    expect(m.message).toContain('RM0.01');
  });

  it('beza besar = mismatch dengan kedua-dua nombor dan arah', () => {
    const m = matchDay(fig('8500.0000'), fig('8000.0000'), '2026-09-24', 'b1');
    expect(m.status).toBe('mismatch');
    expect(m.message).toContain('RM500.00');
    expect(m.message).toContain('lebih di Bukku');
    expect(m.message).toContain('CRM RM8,000.00');
    expect(m.message).toContain('Bukku RM8,500.00');
  });

  it('CRM lebih tinggi = arah disebut berbeza', () => {
    const m = matchDay(fig('8000.0000'), fig('8500.0000'), '2026-09-24', 'b1');
    expect(m.status).toBe('mismatch');
    expect(m.message).toContain('lebih di CRM');
    /* Magnitud kekal positif pada paparan walaupun arah negatif. */
    expect(m.message).toContain('RM500.00');
    expect(m.message).not.toContain('-RM');
  });

  it('Bukku ada, CRM tiada = not-submitted (cawangan belum buat kerja)', () => {
    const m = matchDay(fig('8000.0000'), null, '2026-09-24', 'b1');
    expect(m.status).toBe('not-submitted');
    expect(m.message).toContain('Belum di-key-in');
    expect(m.bukku).toBe('8000.0000');
    expect(m.crm).toBeNull();
  });

  it('CRM ada, Bukku tiada = not-in-bukku (HQ belum masukkan)', () => {
    const m = matchDay(null, fig('3000.0000'), '2026-09-24', 'b1');
    expect(m.status).toBe('not-in-bukku');
    expect(m.message).toContain('Belum masuk Bukku');
  });

  it('kedua-dua tiada = matched (tiada jualan, bukan kegagalan)', () => {
    const m = matchDay(null, null, '2026-09-24', 'b1');
    expect(m.status).toBe('matched');
    expect(m.message).toBeNull();
  });

  it('nombor RASMI sentiasa dari Bukku, bukan CRM', () => {
    /* Kalau ini tersilap, Dashboard menunjukkan nombor yang HQ tidak sahkan. */
    const m = matchDay(fig('8500.0000'), fig('8000.0000'), '2026-09-24', 'b1');
    expect(m.bukku).toBe('8500.0000');
    expect(m.crm).toBe('8000.0000');
  });
});

describe('FASA 1C — ringkasan', () => {
  it('mengira setiap status dan menjumlahkan Bukku sahaja', () => {
    const matches = [
      matchDay(fig('1000.0000', '2026-09-24', 'a'), fig('1000.0000', '2026-09-24', 'a'), '2026-09-24', 'a'),
      matchDay(fig('2000.0000', '2026-09-24', 'b'), fig('1500.0000', '2026-09-24', 'b'), '2026-09-24', 'b'),
      matchDay(fig('3000.0000', '2026-09-24', 'c'), null, '2026-09-24', 'c'),
      matchDay(null, fig('500.0000', '2026-09-24', 'd'), '2026-09-24', 'd'),
    ];
    const s = summarise(matches);
    expect(s.checked).toBe(4);
    expect(s.matched).toBe(1);
    expect(s.mismatch).toBe(1);
    expect(s.notSubmitted).toBe(1);
    expect(s.notInBukku).toBe(1);
    expect(s.branchesWithIssues).toBe(3);
    /* Jumlah rasmi = 1000 + 2000 + 3000 (Bukku sahaja, bukan 1500 CRM). */
    expect(s.bukkuTotal).toBe('6000.0000');
    /* Nilai mutlak beza = 500. */
    expect(s.absoluteDifference).toBe('500.0000');
  });

  it('jumlah nilai beza menggunakan magnitud, bukan tanda', () => {
    const matches = [
      matchDay(fig('1000.0000', '2026-09-24', 'a'), fig('1500.0000', '2026-09-24', 'a'), '2026-09-24', 'a'),
      matchDay(fig('2000.0000', '2026-09-24', 'b'), fig('1500.0000', '2026-09-24', 'b'), '2026-09-24', 'b'),
    ];
    /* Satu +500, satu −500. Jumlah mutlak = 1000, bukan 0. */
    expect(summarise(matches).absoluteDifference).toBe('1000.0000');
  });

  it('semua padan = tiada isu', () => {
    const matches = [
      matchDay(fig('1000.0000', '2026-09-24', 'a'), fig('1000.0000', '2026-09-24', 'a'), '2026-09-24', 'a'),
    ];
    const s = summarise(matches);
    expect(s.branchesWithIssues).toBe(0);
    expect(s.absoluteDifference).toBe('0.0000');
  });

  it('senarai kosong tidak crash', () => {
    const s = summarise([]);
    expect(s.checked).toBe(0);
    expect(s.bukkuTotal).toBe('0.0000');
  });
});

describe('FASA 1C — susunan keutamaan', () => {
  it('mismatch dahulu, kemudian belum-key-in, kemudian padan', () => {
    const rows = [
      matchDay(fig('1000.0000', '2026-09-24', 'padan'), fig('1000.0000', '2026-09-24', 'padan'), '2026-09-24', 'padan'),
      matchDay(fig('3000.0000', '2026-09-24', 'belum'), null, '2026-09-24', 'belum'),
      matchDay(fig('2000.0000', '2026-09-24', 'beza'), fig('1500.0000', '2026-09-24', 'beza'), '2026-09-24', 'beza'),
    ];
    expect(sortBySeverity(rows).map((r) => r.branchId)).toEqual(['beza', 'belum', 'padan']);
  });

  it('dalam mismatch, beza lebih besar di atas', () => {
    const rows = [
      matchDay(fig('1100.0000', '2026-09-24', 'kecil'), fig('1000.0000', '2026-09-24', 'kecil'), '2026-09-24', 'kecil'),
      matchDay(fig('5000.0000', '2026-09-24', 'besar'), fig('1000.0000', '2026-09-24', 'besar'), '2026-09-24', 'besar'),
    ];
    expect(sortBySeverity(rows).map((r) => r.branchId)).toEqual(['besar', 'kecil']);
  });
});
