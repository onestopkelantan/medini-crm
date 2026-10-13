/**
 * FASA 1C — menterjemah invois Bukku menjadi rekod jualan Medini.
 *
 * Ditulis semula mengikut SPESIFIKASI SEBENAR Bukku
 * (docs/bukku-api/bukku-sales-api.yaml + res_invoice_list.yaml).
 * Versi pertama fail ini mengagak nama medan dan SALAH — lihat nota di bawah.
 *
 * Kenapa terjemahan ini fail berasingan:
 *
 * Bentuk invois Bukku bukan urusan kami, dan bentuk sale_records bukan
 * urusan Bukku. Kalau terjemahan ini hidup dalam service, setiap ujian
 * memerlukan sambungan HTTP tiruan — dan kes paling penting (medan hilang,
 * tarikh pelik, invois void) hampir mustahil dihasilkan semula.
 *
 * Jadi terjemahan PURE: masuk satu invois, keluar satu rekod jualan atau
 * sebab ia ditolak. Tiada I/O.
 *
 * Prinsip yang dipegang:
 *
 *   Data yang tidak boleh dipercayai TIDAK PERNAH dipaksa masuk.
 *   Invois yang tiada jumlah atau tarikh ditolak dengan sebab yang jelas,
 *   bukan disimpan sebagai RM0 — kerana RM0 yang salah akan mengalir ke
 *   Dashboard, padanan, dan keputusan HQ tanpa sesiapa perasan.
 */

/* ---------- bentuk sebenar dari Bukku ---------- */

/**
 * Satu invois Bukku, seperti yang datang dalam `transactions[]`.
 *
 * Medan mengikut spesifikasi sebenar:
 *   - `id`      integer  — pengenal unik Bukku
 *   - `number`  string   — nombor invois, cth 'IV-00231'
 *   - `date`    string   — TARIKH, bukan 'invoice_date'
 *   - `amount`  number   — JUMLAH, bukan 'total'
 *   - `status`  string   — 'draft' | 'pending_approval' | 'ready' | 'void'
 *
 * Semua medan dinyatakan sebagai `unknown` dengan sengaja: API luar boleh
 * berubah tanpa memberi tahu kami, dan penukar mesti bertahan dengan bentuk
 * yang tidak dijangka — bukan crash.
 */
export interface BukkuInvoice {
  id?: unknown;
  number?: unknown;
  number2?: unknown;
  date?: unknown;
  amount?: unknown;
  status?: unknown;
  contact_name?: unknown;
  currency_code?: unknown;
}

/** Rekod jualan yang sedia untuk dimasukkan ke sale_records. */
export interface SaleRecordInput {
  /** id Bukku sebagai teks — asas idempotensi sync. */
  externalRef: string;
  saleCode: string;
  amount: string;
  saleDate: string;
  status: 'recorded' | 'confirmed' | 'cancelled';
}

export type TranslateResult =
  | { ok: true; sale: SaleRecordInput }
  | { ok: false; reason: string; externalRef: string | null };

/* ---------- pembantu ---------- */

const str = (v: unknown): string | null => {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  /* Bukku memberi id sebagai INTEGER. Ia mesti menjadi teks sebelum masuk
     kolum varchar, jika tidak setiap perbandingan idempotensi gagal. */
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};

const pad = (v: string | number) => String(v).padStart(2, '0');

/** Tolak 31 Februari, bulan 13, dsb. — tarikh yang "kelihatan" sah tetapi tidak wujud. */
function validYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Tukar tarikh Bukku kepada YYYY-MM-DD.
 *
 * Spesifikasi kata format ISO ('2022-02-01'), tetapi masa datang dalam
 * bentuk '2022-06-23 15:42:41' untuk medan created_at. Kami terima kedua-dua,
 * dan juga DD/MM/YYYY sebagai perlindungan.
 *
 * Tarikh yang tidak difahami ditolak — bukan diteka. Tarikh yang salah
 * bermakna invois masuk dalam hari yang salah, dan padanan harian tidak
 * akan menemui pasangannya.
 */
export function normaliseDate(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;

  /* ISO: 2026-09-22 (dengan atau tanpa masa). */
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const [, y, m, d] = iso;
    if (!validYmd(Number(y), Number(m), Number(d))) return null;
    return `${y}-${m}-${d}`;
  }

  /* DD/MM/YYYY — biasa di Malaysia. Mesti diuji sebelum MM/DD. */
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (dmy) {
    const d = dmy[1]!;
    const m = dmy[2]!;
    const y = dmy[3]!;
    if (!validYmd(Number(y), Number(m), Number(d))) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  return null;
}

/**
 * Jumlah wang sebagai perpuluhan.
 *
 * Bukku memberi nombor (2000). Kami juga terima teks ('1,234.50') sebagai
 * perlindungan. Nombor negatif ditolak: nota kredit bukan jualan, dan kalau
 * ia masuk, jumlah cawangan turun secara misteri.
 */
export function normaliseAmount(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;

  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string') {
    const cleaned = raw.replace(/[^0-9.-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
    n = Number(cleaned);
  } else {
    return null;
  }

  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return n.toFixed(4);
}

/**
 * Status invois Bukku → status jualan Medini.
 *
 * Enum SEBENAR Bukku: 'draft' | 'pending_approval' | 'ready' | 'void'.
 *
 * Versi pertama fail ini mencari 'paid' — perkataan yang Bukku TIDAK GUNA.
 * Kesannya setiap invois akan jatuh ke 'recorded', dan Dashboard (yang hanya
 * mengira 'confirmed') akan melaporkan sifar hasil selamanya — tanpa ralat,
 * tanpa amaran. Itulah sebabnya spesifikasi dibaca, bukan diagak.
 *
 * Pemetaan:
 *   'ready'            → confirmed  (sedia = boleh dikira sebagai hasil)
 *   'void'             → cancelled  (dibatalkan = tidak boleh dikira)
 *   'draft' / 'pending_approval' → recorded (belum dikira, tetapi disimpan)
 */
export function normaliseStatus(raw: unknown): SaleRecordInput['status'] {
  const s = (str(raw) ?? '').toLowerCase();

  if (s === 'void' || s.includes('void') || s.includes('cancel')) return 'cancelled';
  if (s === 'ready' || s.includes('paid') || s.includes('confirm')) return 'confirmed';

  /* 'draft', 'pending_approval', dan apa-apa yang tidak dikenali.
     Yang tidak dikenali TIDAK boleh menaikkan hasil — ia kekal 'recorded'. */
  return 'recorded';
}

/* ---------- penukar utama ---------- */

/**
 * Tukar satu invois Bukku menjadi rekod jualan.
 *
 * Medan yang WAJIB ada:
 *   - pengenal (`id`)  — tanpa ini, sync tidak boleh idempoten, dan setiap
 *                        tarikan akan menghasilkan pendua. Invois tanpa id
 *                        DITOLAK walaupun ada nombor: nombor boleh berulang
 *                        antara siri, id tidak.
 *   - jumlah (`amount`) — tanpa ini, jualan RM0 palsu.
 *   - tarikh sah        — tanpa ini, invois jatuh pada hari yang salah dan
 *                        padanan harian tidak menemui pasangannya.
 */
export function translateInvoice(inv: BukkuInvoice): TranslateResult {
  const externalRef = str(inv.id);

  if (!externalRef) {
    return { ok: false, reason: 'tiada id invois Bukku', externalRef: str(inv.number) };
  }

  const amount = normaliseAmount(inv.amount);
  if (amount === null) {
    return { ok: false, reason: 'jumlah tidak sah atau hilang', externalRef };
  }

  const saleDate = normaliseDate(inv.date);
  if (saleDate === null) {
    return { ok: false, reason: 'tarikh tiada atau tidak difahami', externalRef };
  }

  /* Kod jualan mesti unik per organisasi (had 32 aksara). Nombor Bukku unik
     dalam sistemnya; awalan BKK menandakannya datang dari luar. */
  const number = str(inv.number) ?? externalRef;
  const saleCode = `BKK-${number}`.slice(0, 32);

  return {
    ok: true,
    sale: {
      externalRef,
      saleCode,
      amount,
      saleDate,
      status: normaliseStatus(inv.status),
    },
  };
}

/** Terjemah satu kelompok; pulangkan apa yang berjaya dan apa yang ditolak. */
export function translateBatch(records: unknown[]): {
  sales: SaleRecordInput[];
  rejected: Array<{ reason: string; externalRef: string | null }>;
} {
  const sales: SaleRecordInput[] = [];
  const rejected: Array<{ reason: string; externalRef: string | null }> = [];

  for (const rec of records) {
    if (rec === null || typeof rec !== 'object') {
      rejected.push({ reason: 'rekod bukan objek', externalRef: null });
      continue;
    }
    const out = translateInvoice(rec as BukkuInvoice);
    if (out.ok) sales.push(out.sale);
    else rejected.push({ reason: out.reason, externalRef: out.externalRef });
  }

  return { sales, rejected };
}

/** Baca `transactions[]` dari pembalut respons Bukku. */
export function readInvoicePage(body: unknown): {
  transactions: unknown[];
  total: number | null;
  currentPage: number | null;
} {
  if (body === null || typeof body !== 'object') {
    return { transactions: [], total: null, currentPage: null };
  }
  const b = body as Record<string, unknown>;
  const transactions = Array.isArray(b.transactions) ? b.transactions : [];
  const paging = (b.paging ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    transactions,
    total: num(paging.total),
    currentPage: num(paging.current_page),
  };
}
