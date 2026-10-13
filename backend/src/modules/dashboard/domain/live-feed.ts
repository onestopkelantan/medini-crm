/**
 * FASA 1F — panel masa-nyata: apa yang sedang berlaku di semua cawangan.
 *
 * Soalan yang dijawab: "Apa jadi SEKARANG?"
 * Bukan "berapa temujanji hari ini" — itu laporan. Ini aktiviti hidup.
 *
 * Dua keputusan yang membentuk fail ini:
 *
 * 1. Tetingkap, bukan hari penuh.
 *    Menunjukkan 24 jam bermakna tenggelam dalam temujanji malam semasa
 *    pukul 10 pagi. Kami ambil dari 30 minit lalu hingga 2 jam akan datang —
 *    cukup untuk nampak siapa sedang dirawat, siapa menunggu, dan siapa
 *    akan sampai tidak lama lagi.
 *
 * 2. Maksimum 10 baris.
 *    Papan ini dibaca sekejap, bukan digelungsur. Kalau lebih daripada 10
 *    perkara berlaku serentak, yang LEBIH AWAL dipaparkan — kerana yang
 *    lama menunggu lebih mungkin terlupa.
 */

export interface LiveAppointment {
  /** Kunci untuk UI */
  id: string;
  /** HH:MM, masa dijadualkan */
  time: string;
  patientName: string;
  doctorName: string | null;
  branchName: string;
  status: string;
  /** Berapa minit dari sekarang. Negatif = sudah berlalu. */
  minutesFromNow: number;
}

export interface LiveFeed {
  now: string;
  /** Bilangan baris maksimum yang dipulangkan. */
  limit: number;
  /** Jumlah yang layak (boleh lebih besar daripada items.length). */
  total: number;
  items: LiveAppointment[];
}

/** Berapa minit ke belakang yang dikira "masih relevan". */
export const LIVE_PAST_MINUTES = 30;
/** Berapa minit ke hadapan yang dikira "akan datang tidak lama lagi". */
export const LIVE_FUTURE_MINUTES = 120;
/** Berapa baris dipaparkan. */
export const LIVE_MAX_ROWS = 10;

/**
 * Adakah aktiviti ini berada dalam tetingkap masa-nyata?
 *
 * Diterima: dari 30 minit lalu hingga 2 jam akan datang.
 */
export function inLiveWindow(
  scheduledTime: string,
  now: Date,
  pastMinutes = LIVE_PAST_MINUTES,
  futureMinutes = LIVE_FUTURE_MINUTES,
): boolean {
  const mins = minutesFrom(scheduledTime, now);
  if (mins === null) return false;
  return mins >= -pastMinutes && mins <= futureMinutes;
}

/**
 * Berapa minit dari sekarang. 'HH:MM' atau 'HH:MM:SS'.
 * null bila masa tidak sah — pemanggil mesti langkau, bukan teka.
 */
export function minutesFrom(scheduledTime: string, now: Date): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(scheduledTime ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const then = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min, 0, 0);
  return Math.round((then.getTime() - now.getTime()) / 60_000);
}

/**
 * Susun untuk paparan: paling lama di ATAS, paling baru di BAWAH.
 *
 * Ini keputusan pengguna, dan ia masuk akal: masa mengalir ke bawah, jadi
 * senarai yang mengalir cara sama boleh dibaca sebagai garis masa. Yang
 * tertinggal di atas juga lebih mudah dilihat.
 */
export function sortByTimeAsc<T extends { time: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.time.localeCompare(b.time));
}

/** Kekalkan hanya baris yang layak, susun, dan hadkan bilangan. */
export function buildLiveFeed(
  rows: LiveAppointment[],
  now: Date,
  limit = LIVE_MAX_ROWS,
): LiveFeed {
  const eligible = rows.filter((r) => {
    /* Status terminal dikecualikan — yang sudah selesai atau dibatalkan
       bukan "sedang berlaku". */
    if (r.status === 'cancelled' || r.status === 'completed') return false;
    return inLiveWindow(`${r.time}:00`.slice(0, 8), now);
  });
  const sorted = sortByTimeAsc(eligible);
  return {
    now: now.toISOString(),
    limit,
    total: sorted.length,
    items: sorted.slice(0, limit),
  };
}
