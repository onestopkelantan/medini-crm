/**
 * P6 Inventory domain (murni) — formula PRD Invelli sebagai kontrak.
 *
 * Semua pengiraan di sini TANPA I/O supaya boleh diuji unit dan jadi
 * kebenaran tunggal yang dipakai servis. Semua kuantiti dalam bentuk
 * string DECIMAL (konvensi MySQL repo) atau number; output string.
 *
 * PRD §6:
 *   C1  Actual Usage = Opening + StockIn − Ending
 *   C2  Opening(minggu N) = Ending(minggu N−1)  (carry-forward)
 *   D2  Expected Usage = Σ (volum rawatan jenis T × qty BOM item T)
 *   D3  Variance = Actual − Expected (unit & %)
 *   D4  Flag bila |variance%| > ambang (default 5%)
 */

export interface UsageInput {
  opening: number;
  stockIn: number;
  ending: number;
}

/** C1: Actual Usage = Opening + StockIn − Ending. */
export function actualUsage(u: UsageInput): number {
  return u.opening + u.stockIn - u.ending;
}

/** D2: Expected = Σ volume[treatmentType] × bomQty[item][treatmentType]. */
export function expectedUsage(
  volumes: Record<string, number>,
  bom: Record<string, number>,                /* treatmentType → qty per case (untuk item ini) */
): number {
  let sum = 0;
  for (const [treatment, qty] of Object.entries(bom)) {
    const volume = volumes[treatment] ?? 0;
    sum += volume * qty;
  }
  return sum;
}

export interface VarianceResult {
  varianceQty: number;
  /** Peratus relatif kepada EXPECTED (asas PRD D4: 'Expected 200, Actual 280 → +80' = 40%). */
  variancePct: number;
  flagged: boolean;
}

/** D3 + D4: variance terhadap expected; flag bila |%| melebihi ambang. */
export function variance(actual: number, expected: number, thresholdPct = 5): VarianceResult {
  const varianceQty = actual - expected;
  /* Expected sifar: tiada asas perbandingan — jika ada penggunaan sebenar,
   * ia tetap anomali (gunakan expected=epsilon supaya % besar dan ter-flag). */
  const base = expected === 0 ? (actual === 0 ? 0 : Math.abs(actual)) : expected;
  const variancePct = base === 0 ? 0 : (varianceQty / base) * 100;
  return {
    varianceQty,
    variancePct,
    flagged: base !== 0 && Math.abs(variancePct) > thresholdPct,
  };
}

/** Minggu ISO 'yyyy-Www' daripada tarikh — kunci kiraan mingguan PRD B3. */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;                 // Isnin = 1 .. Ahad = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);         // Khamis minggu ini
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Minggu sebelumnya (untuk carry-forward C2). */
export function previousIsoWeek(week: string): string {
  const m = week.match(/^(\d{4})-W(\d{2})$/);
  if (!m) throw new Error(`isoWeek tidak sah: ${week}`);
  const [year, weekNo] = [Number(m[1]), Number(m[2])];
  /* 4 Jan tahun itu sentiasa minggu 1 atau minggu 52/53 tahun lepas —
   * guna padanan standard ISO: Isnin minggu W ialah (Jan4 Isnin) + (W-1)*7. */
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const target = new Date(week1Monday);
  target.setUTCDate(target.getUTCDate() + (weekNo - 2) * 7); /* Isnin minggu sebelum */
  return isoWeek(new Date(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate() + 1 /* Selasa cukup */));
}
