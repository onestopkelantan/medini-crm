import { describe, it, expect } from 'vitest';

import {
  translateInvoice,
  translateBatch,
  normaliseDate,
  normaliseAmount,
  normaliseStatus,
  readInvoicePage,
} from '@modules/finance/domain/bukku-invoice';

/**
 * FASA 1C — invois Bukku → rekod jualan.
 *
 * Ujian ini ditulis SEMULA mengikut spesifikasi Bukku yang sebenar
 * (docs/bukku-api/). Versi pertama menggunakan nama medan yang salah:
 * mencari 'invoice_date', 'total', dan status 'paid' — ketiga-tiganya
 * TIDAK WUJUD dalam API Bukku.
 *
 * Yang paling berbahaya bukan ralat yang melemparkan pengecualian. Ia
 * pemetaan status yang salah yang berjalan tanpa ralat dan melaporkan
 * hasil sifar selamanya. Ujian di bawah mengunci enum sebenar supaya
 * ia tidak boleh berlaku lagi.
 */

describe('FASA 1C — tarikh (medan sebenar: date)', () => {
  it('menerima format ISO seperti dalam spesifikasi Bukku', () => {
    expect(normaliseDate('2026-09-22')).toBe('2026-09-22');
  });

  it('menerima bentuk tarikh-masa yang Bukku gunakan untuk created_at', () => {
    expect(normaliseDate('2022-06-23 15:42:41')).toBe('2022-06-23');
  });

  it('menerima ISO dengan Zon', () => {
    expect(normaliseDate('2026-09-22T10:30:00Z')).toBe('2026-09-22');
  });

  it('menerima DD/MM/YYYY Malaysia sebagai perlindungan', () => {
    expect(normaliseDate('22/09/2026')).toBe('2026-09-22');
  });

  it('membaca 01/02/2026 sebagai 1 Februari, bukan 2 Januari', () => {
    expect(normaliseDate('01/02/2026')).toBe('2026-02-01');
  });

  it('MENOLAK 31 Februari — tarikh yang kelihatan sah tetapi tidak wujud', () => {
    expect(normaliseDate('31/02/2026')).toBeNull();
    expect(normaliseDate('2026-02-31')).toBeNull();
  });

  it('menerima 29 Feb pada tahun lompat, menolak pada tahun biasa', () => {
    expect(normaliseDate('2028-02-29')).toBe('2028-02-29');
    expect(normaliseDate('2027-02-29')).toBeNull();
  });
});

describe('FASA 1C — jumlah (medan sebenar: amount)', () => {
  it('menerima nombor seperti dalam spesifikasi (amount: 2000)', () => {
    expect(normaliseAmount(2000)).toBe('2000.0000');
  });

  it('menerima perpuluhan', () => {
    expect(normaliseAmount(1234.5)).toBe('1234.5000');
  });

  it('menerima teks dengan koma sebagai perlindungan', () => {
    expect(normaliseAmount('1,234.50')).toBe('1234.5000');
  });

  it('menerima sifar — invois sifar adalah sah', () => {
    expect(normaliseAmount(0)).toBe('0.0000');
  });

  it('MENOLAK jumlah negatif (nota kredit bukan jualan)', () => {
    expect(normaliseAmount(-500)).toBeNull();
  });

  it('menolak jumlah hilang', () => {
    expect(normaliseAmount(null)).toBeNull();
    expect(normaliseAmount(undefined)).toBeNull();
  });
});

describe('FASA 1C — status (enum sebenar: draft/pending_approval/ready/void)', () => {
  it("'ready' → confirmed — ini yang mengira hasil", () => {
    /* Kalau ini salah, Dashboard melaporkan RM0 selamanya. */
    expect(normaliseStatus('ready')).toBe('confirmed');
  });

  it("'void' → cancelled — invois dibatalkan tidak dikira hasil", () => {
    expect(normaliseStatus('void')).toBe('cancelled');
  });

  it("'draft' → recorded — disimpan tetapi TIDAK dikira", () => {
    expect(normaliseStatus('draft')).toBe('recorded');
  });

  it("'pending_approval' → recorded — belum diluluskan, belum dikira", () => {
    expect(normaliseStatus('pending_approval')).toBe('recorded');
  });

  it('status tidak dikenali TIDAK menaikkan hasil', () => {
    expect(normaliseStatus('entah_apa')).toBe('recorded');
    expect(normaliseStatus(undefined)).toBe('recorded');
    expect(normaliseStatus(123)).toBe('recorded');
  });

  it("'paid' masih dihormati sebagai perlindungan antara sistem", () => {
    /* Bukku tidak menggunakannya, tetapi andaian lama mungkin ada di tempat
       lain; menerimanya tidak memudaratkan kerana ia bermaksud perkara sama. */
    expect(normaliseStatus('paid')).toBe('confirmed');
  });
});

describe('FASA 1C — penukar invois', () => {
  it('menukar invois Bukku sebenar dengan betul', () => {
    const r = translateInvoice({
      id: 1, number: 'IV-00231', date: '2022-02-01', amount: 2000, status: 'ready',
      contact_name: 'Alex Wong',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sale).toEqual({
      externalRef: '1', /* integer → teks */
      saleCode: 'BKK-IV-00231',
      amount: '2000.0000',
      saleDate: '2022-02-01',
      status: 'confirmed',
    });
  });

  it('MENOLAK invois tanpa id — walaupun ada nombor', () => {
    /* Nombor boleh berulang antara siri invois; id tidak. Tanpa id, sync
       tidak boleh idempoten dan setiap tarikan menghasilkan pendua. */
    const r = translateInvoice({ number: 'IV-1', date: '2026-09-22', amount: 100 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('id');
  });

  it('MENOLAK invois tanpa jumlah — bukan simpan sebagai RM0', () => {
    const r = translateInvoice({ id: 2, date: '2026-09-22' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('jumlah');
  });

  it('MENOLAK invois tanpa tarikh', () => {
    const r = translateInvoice({ id: 3, amount: 100 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('tarikh');
  });

  it('MENOLAK jumlah negatif', () => {
    const r = translateInvoice({ id: 4, date: '2026-09-22', amount: -50 });
    expect(r.ok).toBe(false);
  });

  it('TIDAK membaca medan lama yang salah (invoice_date/total)', () => {
    /* Ini mengunci pepijat asal: kod versi pertama mencari nama medan ini. */
    const legacy = { id: 5, invoice_date: '2026-09-22', total: 999 } as unknown as Parameters<typeof translateInvoice>[0];
    const r = translateInvoice(legacy);
    expect(r.ok).toBe(false); /* tarikh hilang kerana 'invoice_date' bukan medan sebenar */
  });

  it('memendekkan kod jualan kepada 32 aksara (had kolum)', () => {
    const r = translateInvoice({ id: 6, number: 'A'.repeat(60), date: '2026-09-01', amount: 5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sale.saleCode.length).toBeLessThanOrEqual(32);
  });

  it('invois void lulus terjemahan tetapi berstatus cancelled', () => {
    /* Ia MESTI boleh masuk: sync berikutnya perlu boleh mengemas kini invois
       yang dahulunya sah. Penyaringan berlaku di lapisan bacaan. */
    const r = translateInvoice({ id: 7, date: '2026-09-01', amount: 100, status: 'void' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sale.status).toBe('cancelled');
  });
});

describe('FASA 1C — kelompok', () => {
  it('memisahkan yang berjaya daripada yang ditolak, dengan sebab', () => {
    const out = translateBatch([
      { id: 1, date: '2026-09-01', amount: 100, status: 'ready' },
      { id: 2, date: '2026-09-02', amount: 200 },
      { date: '2026-09-03', amount: 300 },      /* tiada id */
      { id: 4, date: '2026-09-04' },            /* tiada jumlah */
    ]);
    expect(out.sales).toHaveLength(2);
    expect(out.rejected).toHaveLength(2);
  });

  it('satu rekod rosak tidak membatalkan seluruh kelompok', () => {
    const out = translateBatch([
      { id: 1, date: '2026-09-01', amount: 1 },
      null,
      'teks sampah',
      { id: 4, date: '2026-09-02', amount: 2 },
    ]);
    expect(out.sales).toHaveLength(2);
    expect(out.rejected).toHaveLength(2);
  });

  it('kelompok kosong = tiada jualan, tiada penolakan', () => {
    const out = translateBatch([]);
    expect(out.sales).toHaveLength(0);
    expect(out.rejected).toHaveLength(0);
  });
});

describe('FASA 1C — pembalut respons Bukku', () => {
  it('membaca transactions[] dan paging', () => {
    const page = readInvoicePage({
      paging: { current_page: 2, per_page: 30, total: 45 },
      transactions: [{ id: 1 }, { id: 2 }],
    });
    expect(page.transactions).toHaveLength(2);
    expect(page.total).toBe(45);
    expect(page.currentPage).toBe(2);
  });

  it('bertahan dengan pembalut yang tidak dijangka', () => {
    expect(readInvoicePage(null).transactions).toHaveLength(0);
    expect(readInvoicePage({}).transactions).toHaveLength(0);
    expect(readInvoicePage({ transactions: 'bukan array' }).transactions).toHaveLength(0);
  });
});
