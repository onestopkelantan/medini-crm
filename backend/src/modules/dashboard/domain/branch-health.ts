/**
 * FASA 1A — Branch health: satu cawangan sihat atau tidak, dan kenapa.
 *
 * Kenapa fail ini wujud berasingan (bukan dalam service):
 *
 * Dashboard HQ mesti jawab "cawangan mana perlukan perhatian" dalam satu
 * pandangan. Kalau logik itu bercampur dengan SQL, ia cuma boleh diuji
 * dengan pangkalan data hidup — dan keadaan paling penting (cawangan tiada
 * data, pembahagi sifar, purata sifar) hampir mustahil dihasilkan semula.
 *
 * Jadi peraturan di sini PURE: masuk nombor, keluar penilaian. Tiada I/O.
 * Corak ini sama seperti reports/domain/kpi-formulas.ts — dan satu peraturan
 * dari sana diwarisi di sini dengan sengaja:
 *
 *   Pembahagi sifar TIDAK PERNAH menghasilkan nombor rekaan.
 *   Ia pulangkan available:false dan sebabnya.
 *
 * Sebab ia penting: "0%" dan "tiada data" nampak sama di skrin, tetapi
 * maksudnya bertentangan. 0% bermakna cawangan gagal. Tiada data bermakna
 * cawangan belum bermula. Menyamakan dua ini akan menyalahkan cawangan yang
 * tidak pernah diberi peluang.
 */

/* ---------- status mentah dari appointments ---------- */

export type AppointmentStatus =
  | 'booked'
  | 'confirmed'
  | 'checked-in'
  | 'waiting'
  | 'called'
  | 'in-progress'
  | 'completed'
  | 'cancelled'
  | 'no-show';

/** Nombor mentah satu cawangan, seperti yang dikira SQL. */
export interface BranchRawCounts {
  branchId: string;
  /** Bilangan setiap status. Status yang tiada = 0. */
  byStatus: Partial<Record<AppointmentStatus, number>>;
  /** Jumlah jualan confirmed dalam tempoh (string — decimal dari DB). */
  revenue: string;
  /** Bilangan pesakit berdaftar (sepanjang masa, bukan tempoh). */
  patientTotal: number;
}

/**
 * Status yang bermakna pesakit BENAR-BENAR sampai.
 *
 * 'checked-in' dikira hadir: pesakit sampai ke kaunter. Kalau dia menunggu,
 * itu masalah aliran, bukan masalah kehadiran — dua perkara berbeza dan
 * Dashboard mesti bezakan.
 */
const ATTENDED: AppointmentStatus[] = [
  'checked-in',
  'waiting',
  'called',
  'in-progress',
  'completed',
];

/**
 * 'cancelled' SENGAJA tidak dikira sebagai kegagalan.
 *
 * Pesakit yang membatalkan awal memberi klinik peluang mengisi slot itu.
 * Itu bukan kehadiran yang hilang. 'no-show' pula pesakit yang tidak datang
 * tanpa berita — itulah kerugian sebenar.
 */
const FAILED: AppointmentStatus[] = ['no-show'];

/* ---------- bacaan mentah ---------- */

const n = (
  counts: Partial<Record<AppointmentStatus, number>>,
  statuses: AppointmentStatus[],
): number => statuses.reduce((acc, s) => acc + (counts[s] ?? 0), 0);

export const countAttended = (c: Partial<Record<AppointmentStatus, number>>) => n(c, ATTENDED);
export const countFailed = (c: Partial<Record<AppointmentStatus, number>>) => n(c, FAILED);
export const countCompleted = (c: Partial<Record<AppointmentStatus, number>>) => c.completed ?? 0;
export const countCancelled = (c: Partial<Record<AppointmentStatus, number>>) => c.cancelled ?? 0;

/** Semua temujanji yang pernah dijadualkan, apa-apa status. */
export const countAll = (c: Partial<Record<AppointmentStatus, number>>): number =>
  Object.values(c).reduce((acc, v) => acc + (v ?? 0), 0);

/* ---------- penunjuk ---------- */

export interface Ratio {
  available: boolean;
  /** Peratus 0–100, dibundarkan 1 tempat. null apabila tidak tersedia. */
  percent: number | null;
  /** Mengapa tidak tersedia — hanya bila available:false. */
  note?: string;
}

const pct = (num: number, den: number, whyEmpty: string): Ratio => {
  if (den === 0) return { available: false, percent: null, note: whyEmpty };
  return { available: true, percent: Math.round((num / den) * 1000) / 10 };
};

/**
 * Kadar hadir.
 *
 * Pembahagi: temujanji yang pesakit sepatutnya datang (hadir + tidak hadir).
 * 'cancelled' dan status masa depan ('booked','confirmed') dikecualikan —
 * kita tidak boleh menuduh pesakit gagal hadir untuk temujanji esok.
 */
export function attendanceRate(c: Partial<Record<AppointmentStatus, number>>): Ratio {
  const attended = countAttended(c);
  const failed = countFailed(c);
  return pct(attended, attended + failed, 'tiada temujanji yang sepatutnya berlaku');
}

/**
 * Kadar siap: daripada pesakit yang sampai, berapa selesai rawatan.
 * Pembahagi nol bermakna tiada siapa sampai — bukan kecekapan sifar.
 */
export function completionRate(c: Partial<Record<AppointmentStatus, number>>): Ratio {
  const attended = countAttended(c);
  return pct(countCompleted(c), attended, 'tiada pesakit yang hadir');
}

/* ---------- kesihatan ---------- */

/**
 * Empat keadaan, dan yang keempat sengaja berasingan.
 *
 * 'not-started' BUKAN kegagalan. Cawangan yang belum dilancarkan tidak boleh
 * dinilai dengan penanda yang sama seperti cawangan yang gagal, dan
 * memasukkan mereka ke dalam 'red' akan memenuhi papan dengan amaran palsu
 * sehingga amaran sebenar tidak lagi kelihatan.
 */
export type HealthBand = 'green' | 'amber' | 'red' | 'not-started';

/** Kod sebab — UI menterjemah mengikut bahasa pengguna. */
export type HealthReason =
  | { code: 'notStarted' }
  | { code: 'noActivity' }
  | { code: 'attendanceLow'; percent: number }
  | { code: 'revenueBelowAverage'; percent: number }
  | { code: 'healthy' };

export interface BranchHealth {
  branchId: string;
  band: HealthBand;
  attendance: Ratio;
  completion: Ratio;
  revenue: string;
  /**
   * SEBAB sebagai kod, bukan ayat.
   *
   * Backend tidak sepatutnya memilih bahasa. Ia memberikan kod
   * ('attendanceLow', 'revenueBelowAverage'), dan UI memilih ayat mengikut
   * bahasa pengguna. Menghantar ayat Melayu bermakna pengguna English
   * melihat "hasil 100% di bawah purata" di tengah skrin English — pepijat
   * yang kelihatan seperti kelalaian terjemahan tetapi sebenarnya
   * keputusan seni bina.
   */
  reasons: HealthReason[];
}

/** Ambang — satu tempat, senang diubah, senang diuji. */
export const THRESHOLDS = {
  /** Hadir ≥ 80% = cemerlang (keputusan pengguna: longgarkan dari 90%). */
  green: 80,
  /** Hadir ≥ 50% = sederhana. Bawah ini amaran. */
  amber: 50,
  /** Hasil bawah pecahan ini daripada purata = turun satu gred. */
  revenueDropFactor: 0.5,
} as const;

/**
 * Nilai kesihatan satu cawangan.
 *
 * Peraturan, mengikut keutamaan:
 *
 * 1. TIADA temujanji langsung = 'not-started'.
 *    Ini BUKAN merah. Cawangan yang belum dilancarkan tidak boleh dinilai
 *    dengan penanda yang sama seperti cawangan yang gagal. HQ mesti nampak
 *    perbezaannya.
 *
 * 2. Hadir ≥ 80% = cemerlang. ≥ 50% = sederhana. Bawah 50% = amaran.
 *
 * 3. Hasil di bawah 50% purata menurunkan satu gred (hijau→kuning,
 *    kuning→merah). Merah kekal merah.
 *
 *    Kenapa ini perlu: cawangan boleh hadir 95% tetapi hanya menjual rawatan
 *    murah, atau sebaliknya. Kehadiran sahaja mengukur operasi, bukan klinik.
 *
 * 4. Purata sifar (tiada hasil langsung) tidak menurunkan gred.
 *    Kalau tiada duit di mana-mana, tiada sebab menuduh sesiapa.
 */
export function branchHealth(
  raw: BranchRawCounts,
  orgAvgRevenue: number,
): BranchHealth {
  const all = countAll(raw.byStatus);
  const attendance = attendanceRate(raw.byStatus);
  const completion = completionRate(raw.byStatus);
  const revenue = raw.revenue;
  const reasons: HealthReason[] = [];

  if (all === 0) {
    return {
      branchId: raw.branchId,
      band: 'not-started',
      attendance,
      completion,
      revenue,
      reasons: [{ code: 'notStarted' }],
    };
  }

  if (!attendance.available || attendance.percent === null) {
    /* Ada temujanji tetapi semuanya masa depan atau dibatalkan: belum boleh
       dinilai. Ini juga bukan kegagalan. */
    return {
      branchId: raw.branchId,
      band: 'not-started',
      attendance,
      completion,
      revenue,
      reasons: [{ code: 'noActivity' }],
    };
  }

  let band: HealthBand =
    attendance.percent >= THRESHOLDS.green
      ? 'green'
      : attendance.percent >= THRESHOLDS.amber
        ? 'amber'
        : 'red';

  if (band !== 'green') {
    reasons.push({ code: 'attendanceLow', percent: attendance.percent });
  }

  /* Hasil: turunkan satu gred sahaja, dan hanya bila ada purata bermakna. */
  const rev = Number(revenue);
  const underperforming =
    orgAvgRevenue > 0 && rev < orgAvgRevenue * THRESHOLDS.revenueDropFactor;

  if (underperforming) {
    const shortfall = Math.round((1 - rev / orgAvgRevenue) * 100);
    reasons.push({ code: 'revenueBelowAverage', percent: shortfall });
    if (band === 'green') band = 'amber';
    else if (band === 'amber') band = 'red';
  }

  if (band === 'green' && reasons.length === 0) reasons.push({ code: 'healthy' });

  return { branchId: raw.branchId, band, attendance, completion, revenue, reasons };
}

/** Susun cawangan: paling perlu perhatian di atas.
 *
 * Generik supaya medan tambahan (nama, kod cawangan) tidak hilang semasa
 * susun — penggilan hanya tahu band dan kadar hadir, dan tidak sepatutnya
 * perlu tahu apa lagi yang dibawa baris itu.
 */
export function sortByAttention<T extends BranchHealth>(rows: T[]): T[] {
  const rank: Record<HealthBand, number> = { red: 0, amber: 1, 'not-started': 2, green: 3 };
  return [...rows].sort((a, b) => {
    if (rank[a.band] !== rank[b.band]) return rank[a.band] - rank[b.band];
    /* Dalam gred yang sama, yang hadir lebih teruk di atas. */
    const ap = a.attendance.percent ?? 100;
    const bp = b.attendance.percent ?? 100;
    return ap - bp;
  });
}

/** Ringkasan org untuk kad atas Dashboard HQ. */
export interface OrgSummary {
  branches: number;
  branchesStarted: number;
  green: number;
  amber: number;
  red: number;
  notStarted: number;
  totalRevenue: string;
}

export function orgSummary(rows: BranchHealth[]): OrgSummary {
  const total = rows.reduce((acc, r) => acc + Number(r.revenue), 0);
  return {
    branches: rows.length,
    branchesStarted: rows.filter((r) => r.band !== 'not-started').length,
    green: rows.filter((r) => r.band === 'green').length,
    amber: rows.filter((r) => r.band === 'amber').length,
    red: rows.filter((r) => r.band === 'red').length,
    notStarted: rows.filter((r) => r.band === 'not-started').length,
    totalRevenue: total.toFixed(4),
  };
}
