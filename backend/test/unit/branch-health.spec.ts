import { describe, it, expect } from 'vitest';

import {
  attendanceRate,
  completionRate,
  branchHealth,
  sortByAttention,
  orgSummary,
  countAttended,
  countAll,
  THRESHOLDS,
  type AppointmentStatus,
  type BranchRawCounts,
} from '@modules/dashboard/domain/branch-health';

/**
 * FASA 1A — kesihatan cawangan.
 *
 * Kegagalan yang dijaga di sini bukan nombor yang hilang. Ia nombor yang
 * nampak munasabah tetapi salah, dan membawa kepada keputusan yang salah:
 *
 *   - cawangan belum bermula dilabel MERAH (dituduh gagal tanpa sebab)
 *   - pesakit yang membatalkan awal dikira "hilang" (menghukum klinik
 *     kerana pesakit tidak datang)
 *   - temujanji esok dikira gagal hari ini
 *   - purata sifar menurunkan gred semua orang
 *
 * Setiap satu diuji di bawah dengan contoh yang boleh dilihat mata.
 */

const raw = (
  byStatus: Partial<Record<AppointmentStatus, number>>,
  revenue = '0',
  branchId = 'b1',
): BranchRawCounts => ({ branchId, byStatus, revenue, patientTotal: 0 });

describe('FASA 1A — bacaan mentah', () => {
  it('mengira pesakit yang benar-benar sampai, termasuk yang masih menunggu', () => {
    expect(countAttended({ 'checked-in': 2, waiting: 3, called: 1, 'in-progress': 1, completed: 10 })).toBe(17);
  });

  it('TIDAK mengira pesakit yang membatalkan sebagai sampai', () => {
    expect(countAttended({ cancelled: 5 })).toBe(0);
  });

  it('mengira semua status, termasuk yang belum berlaku', () => {
    expect(countAll({ booked: 4, completed: 2, cancelled: 1 })).toBe(7);
  });
});

describe('FASA 1A — kadar hadir', () => {
  it('membahagi dengan temujanji yang SEPATUTNYA berlaku sahaja', () => {
    /* 20 booking, 4 batal → 16 sepatutnya datang, 14 datang.
       Yang batal tidak boleh dihukum. */
    const r = attendanceRate({ completed: 14, cancelled: 4, 'no-show': 2, booked: 0 });
    expect(r.available).toBe(true);
    expect(r.percent).toBe(87.5); /* 14 / 16 */
  });

  it('TIDAK mengira temujanji masa depan sebagai kegagalan', () => {
    /* Semua 'booked' = belum berlaku. Kadar hadir tak boleh dikira. */
    const r = attendanceRate({ booked: 10 });
    expect(r.available).toBe(false);
    expect(r.percent).toBeNull();
    expect(r.note).toContain('tiada temujanji');
  });

  it('cawangan yang tiada apa-apa tidak menghasilkan 0%', () => {
    /* Ini perbezaan paling penting: tiada data ≠ gagal. */
    const r = attendanceRate({});
    expect(r.available).toBe(false);
    expect(r.percent).toBeNull();
  });

  it('hadir 100% adalah mungkin dan betul', () => {
    expect(attendanceRate({ completed: 8 })?.percent).toBe(100);
  });

  it('hadir 0% apabila semua tidak datang — itu kegagalan sebenar', () => {
    const r = attendanceRate({ 'no-show': 5 });
    expect(r.available).toBe(true);
    expect(r.percent).toBe(0);
  });
});

describe('FASA 1A — kadar siap', () => {
  it('mengukur berapa ramai yang sampai selesai rawatan', () => {
    const r = completionRate({ completed: 8, waiting: 2 });
    expect(r.percent).toBe(80); /* 8 / 10 */
  });

  it('tiada siapa sampai = tidak tersedia, bukan 0%', () => {
    const r = completionRate({ booked: 5 });
    expect(r.available).toBe(false);
  });
});

describe('FASA 1A — gred kesihatan', () => {
  it('cawangan belum bermula dilabel not-started, BUKAN merah', () => {
    const h = branchHealth(raw({}), 0);
    expect(h.band).toBe('not-started');
    expect(h.reasons[0]).toEqual({ code: 'notStarted' });
  });

  it('semua temujanji masa depan = not-started (belum boleh dinilai)', () => {
    const h = branchHealth(raw({ booked: 12 }), 0);
    expect(h.band).toBe('not-started');
  });

  it('hadir 95% = hijau', () => {
    const h = branchHealth(raw({ completed: 19, 'no-show': 1 }, '1000'), 1000);
    expect(h.attendance.percent).toBe(95);
    expect(h.band).toBe('green');
    expect(h.reasons).toContainEqual({ code: 'healthy' });
  });

  it('hadir tepat 80% = cemerlang (sempadan)', () => {
    /* Ambang baharu: 80% ke atas = cemerlang (dahulu 90%). */
    const h = branchHealth(raw({ completed: 8, 'no-show': 2 }, '1000'), 1000);
    expect(h.attendance.percent).toBe(THRESHOLDS.green);
    expect(h.band).toBe('green');
  });

  it('hadir 79.9% = sederhana (satu di bawah sempadan)', () => {
    const h = branchHealth(raw({ completed: 799, 'no-show': 201 }, '1000'), 1000);
    expect(h.attendance.percent).toBe(79.9);
    expect(h.band).toBe('amber');
    expect(h.reasons.some((r) => r.code === 'attendanceLow')).toBe(true);
  });

  it('hadir tepat 50% = sederhana (sempadan)', () => {
    const h = branchHealth(raw({ completed: 5, 'no-show': 5 }, '1000'), 1000);
    expect(h.attendance.percent).toBe(50);
    expect(h.band).toBe('amber');
  });

  it('hadir 49% = amaran', () => {
    const h = branchHealth(raw({ completed: 49, 'no-show': 51 }, '1000'), 1000);
    expect(h.band).toBe('red');
  });
});

describe('FASA 1A — hasil menjejaskan gred', () => {
  it('hadir tinggi + hasil jauh bawah purata = turun ke kuning', () => {
    /* Hadir 95% tetapi hasil hanya 40% purata (RM400 vs RM1000). */
    const h = branchHealth(raw({ completed: 19, 'no-show': 1 }, '400'), 1000);
    expect(h.attendance.percent).toBe(95);
    expect(h.band).toBe('amber');
    expect(h.reasons.some((r) => r.code === 'revenueBelowAverage')).toBe(true);
  });

  it('hadir sederhana + hasil bawah purata = amaran', () => {
    const h = branchHealth(raw({ completed: 6, 'no-show': 4 }, '100'), 1000);
    expect(h.band).toBe('red');
  });

  it('hasil tepat 50% purata TIDAK menurunkan gred', () => {
    const h = branchHealth(raw({ completed: 19, 'no-show': 1 }, '500'), 1000);
    expect(h.band).toBe('green');
  });

  it('purata sifar (tiada duit di mana-mana) tidak menuduh sesiapa', () => {
    const h = branchHealth(raw({ completed: 19, 'no-show': 1 }, '0'), 0);
    expect(h.band).toBe('green');
  });

  it('amaran kekal amaran walaupun hasil bagus', () => {
    const h = branchHealth(raw({ completed: 4, 'no-show': 6 }, '99999'), 1000);
    expect(h.band).toBe('red');
  });
});

describe('FASA 1A — susunan keutamaan', () => {
  it('merah di atas, hijau di bawah, belum-bermula di tengah', () => {
    const rows = [
      branchHealth(raw({ completed: 19, 'no-show': 1 }, '1000', 'hijau'), 1000),
      branchHealth(raw({}, '0', 'kosong'), 1000),
      branchHealth(raw({ completed: 4, 'no-show': 6 }, '1000', 'merah'), 1000),
      branchHealth(raw({ completed: 7, 'no-show': 3 }, '1000', 'kuning'), 1000),
    ];
    expect(sortByAttention(rows).map((r) => r.branchId)).toEqual([
      'merah',
      'kuning',
      'kosong',
      'hijau',
    ]);
  });

  it('dalam gred sama, hadir lebih teruk di atas', () => {
    const rows = [
      branchHealth(raw({ completed: 75, 'no-show': 25 }, '1000', 'teruk-sikit'), 1000),
      branchHealth(raw({ completed: 71, 'no-show': 29 }, '1000', 'teruk-lagi'), 1000),
    ];
    expect(sortByAttention(rows).map((r) => r.branchId)).toEqual(['teruk-lagi', 'teruk-sikit']);
  });
});

describe('FASA 1A — ringkasan organisasi', () => {
  it('mengira setiap gred dan jumlah hasil', () => {
    const rows = [
      branchHealth(raw({ completed: 19, 'no-show': 1 }, '1000', 'a'), 1000),
      branchHealth(raw({ completed: 7, 'no-show': 3 }, '1000', 'b'), 1000),
      branchHealth(raw({}, '0', 'c'), 1000),
      branchHealth(raw({ booked: 3 }, '0', 'd'), 1000),
    ];
    const s = orgSummary(rows);
    expect(s.branches).toBe(4);
    expect(s.green).toBe(1);
    expect(s.amber).toBe(1);
    expect(s.notStarted).toBe(2);
    expect(s.branchesStarted).toBe(2);
    expect(Number(s.totalRevenue)).toBe(2000);
  });
});
