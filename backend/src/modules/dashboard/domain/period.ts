/**
 * FASA 1A — tempoh Dashboard.
 *
 * HQ mesti boleh lihat "hari ini" untuk operasi dan "bulan ini" untuk
 * prestasi. Satu tingkap tarikh dikongsi oleh semua bacaan (temujanji +
 * jualan) supaya setiap nombor di skrin bercakap tentang tempoh yang SAMA.
 *
 * Itu bukan kemudahan — ia ketepatan. Kalau temujanji ditapis "7 hari"
 * tetapi jualan ditapis "bulan ini", HQ akan bandingkan epal dengan oren
 * dan membuat keputusan salah tanpa sedar.
 *
 * `now` boleh disuntik supaya ujian deterministik (corak sama seperti
 * reports/domain/period-resolver.ts).
 */

export type DashboardPeriod = 'today' | '7D' | '30D' | 'MTD';

const DAYS: Record<Exclude<DashboardPeriod, 'MTD'>, number> = {
  today: 1,
  '7D': 7,
  '30D': 30,
};

export interface PeriodRange {
  /** Inklusif, YYYY-MM-DD. */
  from: string;
  /** Inklusif, YYYY-MM-DD. */
  to: string;
}

export function isDashboardPeriod(v: unknown): v is DashboardPeriod {
  return v === 'today' || v === '7D' || v === '30D' || v === 'MTD';
}

const iso = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export function resolveDashboardPeriod(
  period: DashboardPeriod,
  now: Date = new Date(),
): PeriodRange {
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(to);

  if (period === 'MTD') {
    /* Bulan ke tarikh: hari pertama bulan ini. Inilah yang HQ bandingkan
       dengan bulan lepas ("bulan ini setakat hari ini"). */
    from.setDate(1);
  } else {
    from.setDate(from.getDate() - (DAYS[period] - 1));
  }

  return { from: iso(from), to: iso(to) };
}
