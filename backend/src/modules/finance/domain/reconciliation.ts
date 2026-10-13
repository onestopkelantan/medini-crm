/**
 * FASA 1C — padanan harian: Bukku (HQ) berbanding CRM (cawangan).
 *
 * Kenapa fail ini wujud:
 *
 * HQ memasukkan jualan rasmi ke Bukku. Cawangan memasukkan jualan mereka ke
 * CRM. Dua orang, dua tempat, satu hari yang sama. Apabila nombor tidak
 * padan, itu bukan sekadar ralat paparan — ia wang yang tidak dapat
 * dijelaskan, dan sesiapa sahaja boleh tersilap.
 *
 * Jadi padanan ini PURE: masuk dua nombor, keluar keputusan. Tiada I/O.
 * Corak sama seperti branch-health.ts.
 *
 * Dua peraturan yang membentuk seluruh fail ini:
 *
 * 1. SIAPAKAH YANG BETUL?
 *    Bukku yang betul. Ia nombor rasmi yang HQ sendiri sahkan. Dashboard
 *    menunjukkan BUKKU. Nombor CRM hanya digunakan untuk membandingkan.
 *
 * 2. SIFAR TOLERANSI.
 *    Apa-apa beza — walau satu sen — menjadi amaran. Ini keputusan pengguna,
 *    dan ia betul: RM5 yang hilang pada 100 pesakit ialah RM500 yang hilang
 *    tanpa sesiapa perasan. Amaran yang terlalu bising masih boleh diabaikan
 *    oleh manusia; amaran yang terlepas beza kecil tidak boleh dipulihkan.
 */

/* ---------- input ---------- */

/** Jumlah harian satu cawangan, dari satu sumber. */
export interface DailyFigure {
  branchId: string;
  /** YYYY-MM-DD. */
  date: string;
  /** Jumlah sebagai teks perpuluhan (dari DB) — tiada ralat titik terapung. */
  amount: string;
  /** Bilangan rekod yang membentuk jumlah ini. */
  count: number;
}

/* ---------- output ---------- */

export type MatchStatus = 'matched' | 'mismatch' | 'not-submitted' | 'not-in-bukku';

export interface DailyMatch {
  branchId: string;
  date: string;
  /** Nombor RASMI (Bukku). Ini yang Dashboard tunjuk. null = Bukku tiada rekod. */
  bukku: string | null;
  /** Nombor cawangan (CRM). Untuk bandingkan sahaja, bukan dipaparkan sebagai rasmi. */
  crm: string | null;
  /** Bukku − CRM, sebagai teks perpuluhan. null bila salah satu tiada. */
  difference: string | null;
  status: MatchStatus;
  /** Ayat sedia-papar untuk HQ. Kosong apabila padan. */
  message: string | null;
}

/* ---------- pembantu ---------- */

/**
 * Bandingkan dua jumlah perpuluhan TANPA titik terapung.
 *
 * Wang diambil dari DB sebagai teks ('8000.0000'). Menukarnya kepada Number
 * menjemput ralat pembundaran yang boleh menghasilkan amaran palsu — dan
 * memandangkan toleransi kita sifar, satu amaran palsu bermakna HQ memburu
 * beza yang tidak wujud.
 *
 * Jadi kami bekerja pada digit: buang titik, samakan panjang, bandingkan
 * sebagai integer. Keputusan tepat untuk nilai wang sebenar.
 */
function toScaled(s: string, decimals = 4): bigint {
  const neg = s.trim().startsWith('-');
  const clean = s.replace(/[^0-9.]/g, '');
  const [intPart = '0', fracPart = ''] = clean.split('.');
  const frac = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  const v = BigInt(intPart + frac);
  return neg ? -v : v;
}

function fromScaled(v: bigint, decimals = 4): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const s = abs.toString().padStart(decimals + 1, '0');
  const intPart = s.slice(0, s.length - decimals);
  const fracPart = s.slice(s.length - decimals);
  return `${neg ? '-' : ''}${intPart}.${fracPart}`;
}

/** Beza = bukku − crm. Tanda menunjukkan arah. */
export function differenceOf(bukku: string, crm: string, decimals = 4): string {
  return fromScaled(toScaled(bukku, decimals) - toScaled(crm, decimals), decimals);
}

/** Format jumlah untuk paparan: '8000.0000' → 'RM8,000.00'. */
export function money(raw: string): string {
  const n = Number(raw);
  const formatted = n.toLocaleString('ms-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `RM${formatted}`;
}

/**
 * Gred satu hari.
 *
 * Empat keadaan, dan yang paling penting di sini ialah yang TERAKHIR:
 *
 *   matched        — kedua-dua ada, sama
 *   mismatch       — kedua-dua ada, berbeza (walau satu sen)
 *   not-submitted  — Bukku ada, CRM tiada  → cawangan belum buat kerja
 *   not-in-bukku   — CRM ada, Bukku tiada  → HQ belum masukkan ke Bukku
 *
 * 'not-submitted' dan 'not-in-bukku' bukan sekadar "tiada data". Ia KEGAGALAN
 * PROSES yang perlu diselesaikan, dan ia mesti berwarna sama seperti beza
 * yang ketara — jika tidak, cawangan yang tersenyap akan terlepas pandang.
 */
export function matchDay(
  bukku: DailyFigure | null,
  crm: DailyFigure | null,
  date: string,
  branchId: string,
): DailyMatch {
  const base = { branchId, date };

  /* Bukku ada, CRM tiada — cawangan belum key-in. */
  if (bukku && !crm) {
    return {
      ...base,
      bukku: bukku.amount,
      crm: null,
      difference: null,
      status: 'not-submitted',
      message: `Belum di-key-in — Bukku ${money(bukku.amount)}, CRM tiada rekod`,
    };
  }

  /* CRM ada, Bukku tiada — HQ belum masukkan. */
  if (!bukku && crm) {
    return {
      ...base,
      bukku: null,
      crm: crm.amount,
      difference: null,
      status: 'not-in-bukku',
      message: `Belum masuk Bukku — CRM ${money(crm.amount)}, Bukku tiada rekod`,
    };
  }

  /* Kedua-dua tiada — tiada jualan hari ini, bukan kegagalan. */
  if (!bukku && !crm) {
    return { ...base, bukku: null, crm: null, difference: null, status: 'matched', message: null };
  }

  /* Kedua-dua ada — bandingkan dengan toleransi SIFAR. */
  const b = bukku as DailyFigure;
  const c = crm as DailyFigure;
  const diff = differenceOf(b.amount, c.amount);
  const isZero = toScaled(diff) === 0n;

  if (isZero) {
    return {
      ...base,
      bukku: b.amount,
      crm: c.amount,
      difference: '0.0000',
      status: 'matched',
      message: null,
    };
  }

  /* Arah beza disebut, supaya HQ tahu ke mana perlu ditanya. */
  const more = toScaled(diff) > 0n;
  const side = more ? 'lebih di Bukku' : 'lebih di CRM';

  return {
    ...base,
    bukku: b.amount,
    crm: c.amount,
    difference: diff,
    status: 'mismatch',
    message: `Beza ${money(diff.replace('-', ''))} ${side} — CRM ${money(c.amount)} vs Bukku ${money(b.amount)}`,
  };
}

/* ---------- ringkasan ---------- */

export interface ReconciliationSummary {
  /** Bilangan pasangan (cawangan × hari) yang diperiksa. */
  checked: number;
  matched: number;
  mismatch: number;
  notSubmitted: number;
  notInBukku: number;
  /** Jumlah RASMI dari Bukku, untuk keseluruhan tempoh. */
  bukkuTotal: string;
  /** Bilangan cawangan yang ada sekurang-kurangnya satu masalah. */
  branchesWithIssues: number;
  /** Jumlah nilai mutlak semua beza — satu nombor untuk "betapa teruk". */
  absoluteDifference: string;
}

/**
 * Ringkaskan satu set padanan.
 *
 * `bukkuTotal` dijumlahkan dari nombor Bukku sahaja — kerana itulah nombor
 * rasmi. Menjumlahkan CRM juga akan menghasilkan dua jumlah yang berbeza
 * pada skrin, dan HQ tidak sepatutnya perlu meneka yang mana betul.
 */
export function summarise(matches: DailyMatch[]): ReconciliationSummary {
  let bukkuTotal = 0n;
  let absDiff = 0n;
  const issueBranches = new Set<string>();
  let matched = 0, mismatch = 0, notSubmitted = 0, notInBukku = 0;

  for (const m of matches) {
    if (m.bukku !== null) bukkuTotal += toScaled(m.bukku);

    switch (m.status) {
      case 'matched':
        matched += 1;
        break;
      case 'mismatch':
        mismatch += 1;
        issueBranches.add(m.branchId);
        if (m.difference) {
          const d = toScaled(m.difference);
          absDiff += d < 0n ? -d : d;
        }
        break;
      case 'not-submitted':
        notSubmitted += 1;
        issueBranches.add(m.branchId);
        break;
      case 'not-in-bukku':
        notInBukku += 1;
        issueBranches.add(m.branchId);
        break;
    }
  }

  return {
    checked: matches.length,
    matched,
    mismatch,
    notSubmitted,
    notInBukku,
    bukkuTotal: fromScaled(bukkuTotal),
    branchesWithIssues: issueBranches.size,
    absoluteDifference: fromScaled(absDiff),
  };
}

/** Susun: paling teruk di atas. Ketara dahulu, kemudian mengikut magnitud beza.
 *
 * Generik supaya medan tambahan (nama cawangan) tidak hilang semasa susun.
 */
export function sortBySeverity<T extends DailyMatch>(matches: T[]): T[] {
  const rank: Record<MatchStatus, number> = {
    mismatch: 0,
    'not-submitted': 1,
    'not-in-bukku': 2,
    matched: 3,
  };
  return [...matches].sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    const da = a.difference ? Number(a.difference) : 0;
    const db = b.difference ? Number(b.difference) : 0;
    return Math.abs(db) - Math.abs(da);
  });
}
