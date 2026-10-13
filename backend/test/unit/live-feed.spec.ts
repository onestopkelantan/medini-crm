import { describe, it, expect } from 'vitest';

import {
  minutesFrom,
  inLiveWindow,
  sortByTimeAsc,
  buildLiveFeed,
  LIVE_MAX_ROWS,
  LIVE_PAST_MINUTES,
  LIVE_FUTURE_MINUTES,
  type LiveAppointment,
} from '@modules/dashboard/domain/live-feed';

/**
 * FASA 1F — panel masa-nyata.
 *
 * Kegagalan yang dijaga:
 *   - tetingkap terlalu lebar → papan tenggelam, 10 baris penuh dengan
 *     temujanji malam semasa pukul 10 pagi
 *   - masa lalu dikecualikan sepenuhnya → pesakit yang menunggu 20 minit
 *     hilang dari papan, tepat apabila dia paling perlu dilihat
 *   - masa tidak sah diandaikan → baris muncul pada waktu yang salah
 *   - susunan menurun → garis masa terbalik, "akan datang" di atas
 *     "sekarang", jadi tidak boleh dibaca sebagai masa
 */

const NOW = new Date(2026, 8, 24, 10, 55, 0); /* 24 Sep 2026, 10:55 */

const appt = (over: Partial<LiveAppointment> = {}): LiveAppointment => ({
  id: Math.random().toString(36),
  time: '11:00',
  patientName: 'Ahmad',
  doctorName: 'Dr. Aina',
  branchName: 'Setia Tropika',
  status: 'confirmed',
  minutesFromNow: 5,
  ...over,
});

describe('FASA 1F — kiraan minit', () => {
  it('mengira minit ke hadapan', () => {
    expect(minutesFrom('11:00', NOW)).toBe(5);
    expect(minutesFrom('12:00', NOW)).toBe(65);
  });

  it('mengira minit ke belakang sebagai negatif', () => {
    expect(minutesFrom('10:30', NOW)).toBe(-25);
  });

  it('menerima format dengan detik', () => {
    expect(minutesFrom('11:00:00', NOW)).toBe(5);
  });

  it('MENOLAK masa tidak sah — jangan teka', () => {
    expect(minutesFrom('', NOW)).toBeNull();
    expect(minutesFrom('entah', NOW)).toBeNull();
    expect(minutesFrom('25:00', NOW)).toBeNull();
    expect(minutesFrom('11:99', NOW)).toBeNull();
  });
});

describe('FASA 1F — tetingkap masa-nyata', () => {
  it('menerima masa dalam tetingkap', () => {
    expect(inLiveWindow('11:00', NOW)).toBe(true); /* +5 min */
    expect(inLiveWindow('10:30', NOW)).toBe(true); /* -25 min */
  });

  it('menerima tepat sempadan', () => {
    /* -30 dan +120 mesti diterima — sempadan inklusif. */
    const past = new Date(NOW.getTime() - LIVE_PAST_MINUTES * 60_000);
    const future = new Date(NOW.getTime() + LIVE_FUTURE_MINUTES * 60_000);
    const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    expect(inLiveWindow(hhmm(past), NOW)).toBe(true);
    expect(inLiveWindow(hhmm(future), NOW)).toBe(true);
  });

  it('MENOLAK yang sudah lama berlalu', () => {
    expect(inLiveWindow('08:00', NOW)).toBe(false);
  });

  it('MENOLAK yang jauh akan datang', () => {
    /* Ini yang menghalang papan tenggelam dengan temujanji malam. */
    expect(inLiveWindow('20:00', NOW)).toBe(false);
  });

  it('menolak masa tidak sah', () => {
    expect(inLiveWindow('', NOW)).toBe(false);
    expect(inLiveWindow('abc', NOW)).toBe(false);
  });
});

describe('FASA 1F — susunan', () => {
  it('paling lama di atas, paling baru di bawah', () => {
    const rows = [appt({ time: '11:30' }), appt({ time: '10:45' }), appt({ time: '11:00' })];
    expect(sortByTimeAsc(rows).map((r) => r.time)).toEqual(['10:45', '11:00', '11:30']);
  });
});

describe('FASA 1F — bina suapan', () => {
  it('menyaring kepada tetingkap dan menyusun menaik', () => {
    const rows = [
      appt({ time: '08:00', patientName: 'Terlalu awal' }),
      appt({ time: '11:30', patientName: 'Akan datang' }),
      appt({ time: '10:45', patientName: 'Sedang tunggu' }),
      appt({ time: '20:00', patientName: 'Terlalu lewat' }),
    ];
    const feed = buildLiveFeed(rows, NOW);
    expect(feed.items.map((i) => i.patientName)).toEqual(['Sedang tunggu', 'Akan datang']);
    expect(feed.total).toBe(2);
  });

  it('mengecualikan selesai dan dibatalkan', () => {
    /* Yang sudah selesai bukan "sedang berlaku". */
    const rows = [
      appt({ time: '10:50', status: 'completed' }),
      appt({ time: '10:50', status: 'cancelled' }),
      appt({ time: '10:50', status: 'in-progress', patientName: 'Sedang dirawat' }),
    ];
    const feed = buildLiveFeed(rows, NOW);
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]!.patientName).toBe('Sedang dirawat');
  });

  it('hadkan kepada 10 baris tetapi laporkan jumlah sebenar', () => {
    const rows = Array.from({ length: 18 }, (_, i) =>
      appt({ time: `11:${String(i).padStart(2, '0')}` }),
    );
    const feed = buildLiveFeed(rows, NOW);
    expect(feed.items).toHaveLength(LIVE_MAX_ROWS);
    expect(feed.total).toBe(18);
  });

  it('senarai kosong tidak crash', () => {
    const feed = buildLiveFeed([], NOW);
    expect(feed.items).toHaveLength(0);
    expect(feed.total).toBe(0);
  });

  it('masa tidak sah dilangkau, bukan dipaparkan secara salah', () => {
    const rows = [
      appt({ time: 'abc' }),
      appt({ time: '11:00', patientName: 'Sah' }),
    ];
    expect(buildLiveFeed(rows, NOW).items.map((i) => i.patientName)).toEqual(['Sah']);
  });
});
