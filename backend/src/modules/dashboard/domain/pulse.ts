/**
 * FASA 1G — kad nadi bisnes untuk Dashboard HQ.
 *
 * Lima kad, setiap satu menjawab satu soalan yang owner tanya bila buka
 * sistem pada pukul 8 pagi. Fungsi di sini MURNI: ia menerima nombor dan
 * memulangkan bentuk yang UI boleh lukis terus. Tiada DB, tiada masa sistem
 * kecuali apa yang disuntik — supaya boleh diuji tanpa pangkalan data.
 *
 * Prinsip yang membentuk fail ini:
 *
 * 1. JANGAN TUDUH SEBELUM MASA.
 *    Pukul 12:36 tengah hari, 30 temujanji "belum sampai" BUKAN no-show —
 *    mungkin temujanji mereka pukul 4 petang. Kita hanya boleh mengira
 *    no-show untuk temujanji yang MASANYA SUDAH LALU. Kad real-time
 *    memisahkan "belum sampai" daripada "lewat".
 *
 * 2. JANGAN TIPU TENTANG KESEGARAN DATA.
 *    Sync Bukku mungkin semalam. UI mesti berkata "data 12:36 pm", bukan
 *    "real time". Angka yang kelihatan segar tetapi sebenarnya semalam
 *    lebih berbahaya daripada angka yang jujur mengaku tua.
 *
 * 3. JANGAN PAPAR SIFAR YANG MENGELIRUKAN.
 *    Kad "Belum Dikutip" yang menunjukkan RM0 bermakna dua benda berbeza:
 *    "tiada hutang" atau "kita tidak tahu". UI mesti boleh bezakan.
 */

/* ------------------------------------------------------------------ */
/* Kad ② — temujanji hari ini (REAL TIME)                              */
/* ------------------------------------------------------------------ */

export interface AppointmentPulse {
  /** Semua temujanji yang dijadualkan hari ini. */
  booked: number;
  /** Sudah selesai treatment — inilah yang dimaksudkan "datang". */
  completed: number;
  /**
   * Masanya belum tiba. BUKAN kegagalan — cuma belum sampai masanya.
   * Dilaporkan berasingan supaya tidak pernah dikira sebagai no-show.
   */
  pending: number;
  /**
   * Masanya sudah LALU tetapi pesakit masih belum hadir.
   * Ini satu-satunya nombor yang mendesak — resit perlu telefon.
   */
  late: number;
}

/** Status yang bermakna pesakit benar-benar datang dan selesai treatment. */
const DONE = new Set(['completed']);
/** Status yang bermakna temujanji sudah berakhir tanpa kehadiran. */
const MISSED = new Set(['no-show', 'cancelled']);
/** Status yang bermakna pesakit ada di klinik sekarang. */
const PRESENT = new Set(['checked-in', 'called', 'in-progress', 'completed']);

export interface PulseInput {
  status: string;
  /** "10:30" — masa temujanji. */
  time: string;
}

/**
 * Kira nadi temujanji hari ini.
 *
 * `now` menentukan apa yang "lewat" — temujanji yang masanya sudah berlalu
 * tanpa kehadiran. Tanpa `now`, mustahil membezakan "belum sampai" daripada
 * "tak datang", dan setiap klinik akan kelihatan gagal pada pukul 9 pagi.
 */
export function appointmentPulse(rows: PulseInput[], now: Date): AppointmentPulse {
  let booked = 0;
  let completed = 0;
  let pending = 0;
  let late = 0;

  /* Beri toleransi 15 minit sebelum dianggap lewat — pesakit parking bukan
     kegagalan. Ini mengelak kad berkelip "lewat" sebaik sahaja minit tiba. */
  const GRACE_MINUTES = 15;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  for (const r of rows) {
    if (MISSED.has(r.status)) { booked += 1; late += 1; continue; }

    booked += 1;

    if (DONE.has(r.status)) { completed += 1; continue; }

    const mins = toMinutes(r.time);
    if (mins === null) { pending += 1; continue; }

    if (PRESENT.has(r.status)) { completed += 1; continue; }

    if (nowMinutes > mins + GRACE_MINUTES) late += 1;
    else pending += 1;
  }

  return { booked, completed, pending, late };
}

/** "10:30" atau "10:30:00" → minit sejak tengah malam. null kalau tidak sah. */
export function toMinutes(time: string): number | null {
  const m = /^(\d{2}):(\d{2})/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/* ------------------------------------------------------------------ */
/* Kad ④ — pesakit baharu vs kembali                                   */
/* ------------------------------------------------------------------ */

export interface PatientMix {
  newCount: number;
  returning: number;
  /** Peratus pesakit baharu. null bila tiada pesakit langsung. */
  newSharePct: number | null;
}

/**
 * Nisbah pesakit baharu.
 *
 * Kenapa ini penting untuk owner: klinik yang 100% pesakit lama kelihatan
 * sihat sepanjang tahun, kemudian tiba-tiba senyap apabila pesakit lama
 * berhenti datang. Peratusan ini adalah tanda amaran awal yang tidak
 * kelihatan dalam mana-mana angka jualan.
 */
export function patientMix(newPatients: number, totalVisits: number): PatientMix {
  /* Pesakit baharu KEKAL walau tiada lawatan selesai lagi.
   *
   * Ini pepijat yang benar-benar berlaku: klinik mendaftarkan 3 pesakit
   * pagi ini, tetapi tiada temujanji selesai sehingga tengah hari — jadi
   * kadar lawatan = 0 dan kad memaparkan "0 pesakit baharu" walaupun tiga
   * orang baru mendaftar di depan kaunter. Pembilang dan penyebut mesti
   * diuruskan berasingan: pembilang sentiasa benar, penyebut sahaja yang
   * mungkin kosong. */
  const returning = Math.max(0, totalVisits - newPatients);
  return {
    newCount: newPatients,
    returning,
    newSharePct: totalVisits === 0 ? null : Math.round((newPatients / totalVisits) * 1000) / 10,
  };
}

/* ------------------------------------------------------------------ */
/* Kad ⑤ — belum dikutip (receivables)                                 */
/* ------------------------------------------------------------------ */

export type ReceivablesState =
  | { state: 'known'; total: string; invoiceCount: number; asOf: string | null }
  | { state: 'unknown' };

/**
 * Keadaan kad "Belum Dikutip".
 *
 * RM0 dan "kita tidak tahu" berkongsi paparan yang sama, dan itu bahaya:
 * owner yang membaca RM0 akan berhenti bimbang tentang hutang yang
 * sebenarnya ada. `unknown` memaksa UI mengatakan "menunggu Bukku".
 *
 * Sumber sebenar ialah invois Bukku. Sebelum ia disambung, satu-satunya
 * jawapan jujur ialah "tidak tahu".
 */
export function receivables(
  total: string | null, invoiceCount: number, asOf: string | null,
): ReceivablesState {
  if (total === null) return { state: 'unknown' };
  return { state: 'known', total, invoiceCount, asOf };
}

/* ------------------------------------------------------------------ */
/* Kesegaran data — setiap kad mesti tahu bila ia terakhir benar        */
/* ------------------------------------------------------------------ */

export interface Freshness {
  /** ISO cap masa sync terakhir, atau null kalau tidak pernah. */
  asOf: string | null;
  /** true bila data cukup lama sehingga UI harus memberi amaran. */
  stale: boolean;
  /** Jam sejak sync terakhir. null bila tidak pernah sync. */
  hoursOld: number | null;
}

/**
 * Berapa segar data ini?
 *
 * Ambang 6 jam: sync harian yang berjalan pagi akan kelihatan "basi" pada
 * sebelah petang, dan itu memang betul — HQ patut tahu angka yang mereka
 * baca mungkin tidak termasuk jualan tengah hari.
 */
export function freshness(asOf: string | null, now: Date): Freshness {
  if (!asOf) return { asOf: null, stale: true, hoursOld: null };
  const then = new Date(asOf).getTime();
  if (Number.isNaN(then)) return { asOf: null, stale: true, hoursOld: null };
  const hoursOld = Math.round(((now.getTime() - then) / 3_600_000) * 10) / 10;
  return { asOf, stale: hoursOld > 6, hoursOld };
}

/* ------------------------------------------------------------------ */
/* Perlakuan cawangan — booking vs datang vs no-show                   */
/* ------------------------------------------------------------------ */

export interface BranchBehaviourRow {
  branchId: string;
  name: string;
  booked: number;
  completed: number;
  noShow: number;
  /** Peratus no-show. null bila tiada temujanji langsung. */
  noShowPct: number | null;
}

export interface BranchBehaviour {
  rows: BranchBehaviourRow[];
  total: { booked: number; completed: number; noShow: number; noShowPct: number | null };
}

export interface BehaviourInput {
  branchId: string;
  name: string;
  status: string;
}

/**
 * Perlakuan cawangan untuk tempoh yang sudah TUTUP.
 *
 * Hanya panggil ini untuk julat tarikh yang sudah berlalu. Untuk hari ini,
 * guna `appointmentPulse()` — mengira no-show hari yang masih berjalan akan
 * menuduh pesakit yang sebenarnya cuma datang lewat.
 */
export function branchBehaviour(rows: BehaviourInput[]): BranchBehaviour {
  const by = new Map<string, BranchBehaviourRow>();

  for (const r of rows) {
    let row = by.get(r.branchId);
    if (!row) {
      row = { branchId: r.branchId, name: r.name, booked: 0, completed: 0, noShow: 0, noShowPct: null };
      by.set(r.branchId, row);
    }
    row.booked += 1;
    if (r.status === 'completed') row.completed += 1;
    else if (MISSED.has(r.status)) row.noShow += 1;
  }

  const out = [...by.values()].map((r) => ({
    ...r,
    noShowPct: r.booked === 0 ? null : Math.round((r.noShow / r.booked) * 1000) / 10,
  }));

  /* Paling teruk dahulu — HQ patut melihat masalah tanpa mencari. */
  out.sort((a, b) => (b.noShowPct ?? -1) - (a.noShowPct ?? -1) || b.booked - a.booked);

  const total = out.reduce(
    (acc, r) => ({ booked: acc.booked + r.booked, completed: acc.completed + r.completed, noShow: acc.noShow + r.noShow }),
    { booked: 0, completed: 0, noShow: 0 },
  );

  return {
    rows: out,
    total: {
      ...total,
      noShowPct: total.booked === 0 ? null : Math.round((total.noShow / total.booked) * 1000) / 10,
    },
  };
}
