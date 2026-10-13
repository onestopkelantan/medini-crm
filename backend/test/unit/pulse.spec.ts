import { describe, it, expect } from 'vitest';

import {
  appointmentPulse,
  toMinutes,
  patientMix,
  receivables,
  freshness,
  branchBehaviour,
} from '@modules/dashboard/domain/pulse';

/**
 * FASA 1G — kad nadi bisnes.
 *
 * Kegagalan yang dijaga, semuanya pernah berlaku dalam sistem sebenar:
 *
 *   - "belum sampai" dikira sebagai no-show → setiap klinik kelihatan gagal
 *     pada pukul 9 pagi
 *   - RM0 dipaparkan sedangkan maknanya "tidak tahu" → owner berhenti
 *     bimbang tentang hutang yang sebenarnya ada
 *   - data semalam dipaparkan sebagai "real time" → keputusan dibuat atas
 *     angka yang sudah lapuk
 *   - masa tidak sah diandaikan → pesakit muncul dalam tong yang salah
 */

/* 24 Sep 2026, 12:36 tengah hari — masa yang digunakan pengguna dalam
   contoh sebenar. */
/* Two clocks, both fixed at 24 Sep 2026 12:36 Malaysia (+08):
 * - NOW_LOCAL: wall-clock 12:36 in the HOST timezone. appointmentPulse()
 *   compares clinic-local HH:MM strings against getHours()/getMinutes(),
 *   so its "now" must be a local wall-clock date, not an ISO instant.
 * - NOW: the same instant anchored to +08:00. freshness() compares
 *   against ISO timestamps, so it must not drift with the host timezone
 *   (a WIB host made the old local Date read 11:36 +07 -> one hour off).
 */
const NOW_LOCAL = new Date(2026, 8, 24, 12, 36, 0);
const NOW = new Date('2026-09-24T12:36:00+08:00');

const at = (time: string, status: string) => ({ time, status });

describe('FASA 1G — temujanji hari ini (real time)', () => {
  it('mengira booked, selesai, belum sampai, lewat', () => {
    const rows = [
      at('09:00', 'completed'),
      at('09:30', 'completed'),
      at('10:00', 'completed'),
      at('11:00', 'completed'),
      at('14:00', 'booked'),   /* belum tiba masanya */
      at('15:00', 'confirmed'),/* belum tiba masanya */
      at('16:00', 'booked'),   /* belum tiba masanya */
      at('09:15', 'booked'),   /* masanya sudah lama lalu → lewat */
      at('10:30', 'confirmed'),/* sudah lalu → lewat */
    ];
    const p = appointmentPulse(rows, NOW_LOCAL);
    expect(p.booked).toBe(9);
    expect(p.completed).toBe(4);
    expect(p.pending).toBe(3);
    expect(p.late).toBe(2);
  });

  it('BUKAN no-show: temujanji petang belum dikira gagal', () => {
    /* Ini kegagalan paling penting. Kalau 30 temujanji petang dikira
       "tak datang" pada pukul 12:36, kad berbohong sepanjang hari. */
    const rows = Array.from({ length: 30 }, () => at('16:00', 'booked'));
    const p = appointmentPulse(rows, NOW_LOCAL);
    expect(p.late).toBe(0);
    expect(p.pending).toBe(30);
  });

  it('memberi toleransi 15 minit sebelum dianggap lewat', () => {
    /* Pesakit parking bukan kegagalan. */
    const rows = [
      at('12:30', 'booked'),  /* 6 min lalu — dalam toleransi */
      at('12:20', 'booked'),  /* 16 min lalu — lewat */
      at('12:21', 'booked'),  /* 15 min lalu — tepat sempadan, belum lewat */
    ];
    const p = appointmentPulse(rows, NOW_LOCAL);
    expect(p.late).toBe(1);
    expect(p.pending).toBe(2);
  });

  it('pesakit di klinik dikira DATANG, bukan lewat', () => {
    /* Walau masanya sudah lalu, kalau dia sedang dirawat dia tetap datang.
       Kad "datang" = ada di klinik ATAU sudah selesai — bukan 'completed'
       sahaja. Kalau tidak, klinik pada pukul 12 tengah hari akan kelihatan
       seolah-olah semua pesakit tidak hadir. */
    const rows = [at('11:00', 'in-progress'), at('11:30', 'checked-in'), at('10:00', 'called')];
    const p = appointmentPulse(rows, NOW_LOCAL);
    expect(p.completed).toBe(3);
    expect(p.late).toBe(0);
    expect(p.pending).toBe(0);
    expect(p.booked).toBe(3);
  });

  it('no-show dan batal dikira lewat segera', () => {
    const rows = [at('16:00', 'no-show'), at('17:00', 'cancelled')];
    const p = appointmentPulse(rows, NOW_LOCAL);
    expect(p.late).toBe(2);
    expect(p.pending).toBe(0);
  });

  it('senarai kosong tidak crash', () => {
    const p = appointmentPulse([], NOW);
    expect(p).toEqual({ booked: 0, completed: 0, pending: 0, late: 0 });
  });

  it('masa tidak sah diandaikan belum sampai, bukan lewat', () => {
    /* Salah anggap ke arah "belum sampai" lebih selamat — ia tidak
       menghantar resit menelefon pesakit yang tidak bersalah. */
    const p = appointmentPulse([at('', 'booked'), at('entah', 'booked')], NOW);
    expect(p.late).toBe(0);
    expect(p.pending).toBe(2);
  });
});

describe('FASA 1G — toMinutes', () => {
  it('menerima HH:MM dan HH:MM:SS', () => {
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('12:36')).toBe(756);
    expect(toMinutes('12:36:45')).toBe(756);
    expect(toMinutes('23:59')).toBe(1439);
  });

  it('menolak yang tidak sah', () => {
    expect(toMinutes('')).toBeNull();
    expect(toMinutes('abc')).toBeNull();
    expect(toMinutes('24:00')).toBeNull();
    expect(toMinutes('12:60')).toBeNull();
  });
});

describe('FASA 1G — pesakit baharu vs kembali', () => {
  it('mengira nisbah pesakit baharu', () => {
    const m = patientMix(12, 50);
    expect(m.newCount).toBe(12);
    expect(m.returning).toBe(38);
    expect(m.newSharePct).toBe(24);
  });

  it('tiada pesakit → peratus null, bukan 0', () => {
    /* 0% baharu dan "tiada pesakit" adalah benda berbeza. */
    const m = patientMix(0, 0);
    expect(m.newSharePct).toBeNull();
    expect(m.returning).toBe(0);
  });

  it('PEPIJAT SEBENAR: pesakit baharu KEKAL walau tiada lawatan selesai', () => {
    /* Ini berlaku dalam pengeluaran. Klinik mendaftarkan 3 pesakit pagi
       ini, tetapi tiada temujanji SELESAI sehingga tengah hari — lawatan
       pulang 0. Kad memaparkan "0 pesakit baharu" walaupun tiga orang
       baru mendaftar di depan kaunter. Pembilang tidak boleh dimusnahkan
       oleh penyebut yang kosong. */
    const m = patientMix(3, 0);
    expect(m.newCount).toBe(3);
    expect(m.newSharePct).toBeNull(); /* peratus tidak boleh dikira */
  });

  it('semua pesakit baharu = 100%', () => {
    expect(patientMix(8, 8).newSharePct).toBe(100);
  });

  it('sentiasa mencapai 100% baharu → tanda klinik tidak berkembang', () => {
    const m = patientMix(0, 40);
    expect(m.newSharePct).toBe(0);
    expect(m.returning).toBe(40);
  });
});

describe('FASA 1G — belum dikutip', () => {
  it('RM0 yang DIKETAHUI berbeza daripada TIDAK DIKETAHUI', () => {
    /* Ini pembezaan terpenting dalam kad ini. */
    const known = receivables('0', 0, '2026-09-24T12:00:00Z');
    const unknown = receivables(null, 0, null);
    expect(known.state).toBe('known');
    expect(unknown.state).toBe('unknown');
  });

  it('melaporkan jumlah dan bilangan invois', () => {
    const r = receivables('31650.0000', 6, '2026-09-24T12:00:00Z');
    expect(r.state).toBe('known');
    if (r.state === 'known') {
      expect(r.total).toBe('31650.0000');
      expect(r.invoiceCount).toBe(6);
    }
  });
});

describe('FASA 1G — kesegaran data', () => {
  it('data segar tidak ditanda basi', () => {
    const f = freshness('2026-09-24T11:00:00+08:00', NOW);
    expect(f.stale).toBe(false);
    expect(f.hoursOld).toBeCloseTo(1.6, 1);
  });

  it('data semalam ditanda BASI — jangan panggilnya real time', () => {
    const f = freshness('2026-09-23T12:00:00+08:00', NOW);
    expect(f.stale).toBe(true);
    expect(f.hoursOld).toBeCloseTo(24.6, 1);
  });

  it('tidak pernah sync → basi dan jam null', () => {
    const f = freshness(null, NOW);
    expect(f.stale).toBe(true);
    expect(f.hoursOld).toBeNull();
  });

  it('cap masa rosak tidak crash', () => {
    expect(freshness('entah', NOW).stale).toBe(true);
  });
});

describe('FASA 1G — perlakuan cawangan', () => {
  const rows = [
    { branchId: 'a', name: 'Setia Tropika', status: 'completed' },
    { branchId: 'a', name: 'Setia Tropika', status: 'completed' },
    { branchId: 'b', name: 'Taman Molek', status: 'completed' },
    { branchId: 'b', name: 'Taman Molek', status: 'no-show' },
    { branchId: 'b', name: 'Taman Molek', status: 'no-show' },
    { branchId: 'c', name: 'Pasir Gudang', status: 'cancelled' },
  ];

  it('mengira booking, datang, no-show setiap cawangan', () => {
    const b = branchBehaviour(rows);
    const molek = b.rows.find((r) => r.name === 'Taman Molek')!;
    expect(molek.booked).toBe(3);
    expect(molek.completed).toBe(1);
    expect(molek.noShow).toBe(2);
    expect(molek.noShowPct).toBeCloseTo(66.7, 1);
  });

  it('paling teruk di ATAS — HQ patut nampak masalah tanpa mencari', () => {
    /* Pasir Gudang 1/1 = 100% no-show, jadi ia LEBIH teruk daripada
       Taman Molek (2/3 = 66.7%). Kad mesti menyusun ikut peratus, bukan
       ikut bilangan — cawangan kecil dengan satu kegagalan tidak boleh
       tenggelam di bawah cawangan besar dengan dua. */
    const b = branchBehaviour(rows);
    expect(b.rows[0]!.name).toBe('Pasir Gudang');
    expect(b.rows[0]!.noShowPct).toBe(100);
    expect(b.rows.find((r) => r.name === 'Setia Tropika')!.noShowPct).toBe(0);
  });

  it('dibatalkan dikira no-show untuk tujuan perlakuan', () => {
    expect(branchBehaviour(rows).total.noShow).toBe(3);
  });

  it('jumlah keseluruhan betul', () => {
    const b = branchBehaviour(rows);
    expect(b.total.booked).toBe(6);
    expect(b.total.completed).toBe(3);
    expect(b.total.noShowPct).toBe(50);
  });

  it('tiada temujanji → peratus null, bukan 0', () => {
    expect(branchBehaviour([]).total.noShowPct).toBeNull();
  });
});
