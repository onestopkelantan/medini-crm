import { describe, it, expect } from 'vitest';

import {
  actualUsage, expectedUsage, variance, isoWeek, previousIsoWeek,
} from '../../src/modules/inventory/domain/inventory-formulas';

/**
 * P6 — formula PRD Invelli sebagai kontrak teruji (C1/C2/D2/D3/D4).
 * Angka contoh diambil TERUS daripada PRD supaya ikatan jelas.
 */
describe('C1 — actualUsage = opening + stockIn − ending', () => {
  it('contoh PRD D4: opening 200, masuk 100, baki 20 → guna 280', () => {
    expect(actualUsage({ opening: 200, stockIn: 100, ending: 20 })).toBe(280);
  });
  it('tiada pergerakan → sifar', () => {
    expect(actualUsage({ opening: 50, stockIn: 0, ending: 50 })).toBe(0);
  });
  it('stok naik (ending > opening+in) → negatif (kiraan perlu disemak)', () => {
    expect(actualUsage({ opening: 10, stockIn: 0, ending: 30 })).toBe(-20);
  });
});

describe('D2 — expectedUsage = Σ(volum rawatan × BOM)', () => {
  it('Scaling 10 kes × (2 sarung + 1 cup) → setiap item bersasar', () => {
    const volumes = { Scaling: 10 };
    /* expectedUsage dipanggil per item: bom item = treatmentType → qty */
    expect(expectedUsage(volumes, { Scaling: 2 })).toBe(20);  /* sarung */
    expect(expectedUsage(volumes, { Scaling: 1 })).toBe(10);  /* cup */
    expect(expectedUsage(volumes, { Extraction: 1 })).toBe(0);/* tidak digunakan minggu ini */
  });
  it('volum kosong → expected sifar', () => {
    expect(expectedUsage({}, { Scaling: 2 })).toBe(0);
  });
});

describe('D3/D4 — variance + ambang flag', () => {
  it('contoh PRD: expected 200, actual 280 → +80 unit, +40%, FLAG', () => {
    const r = variance(280, 200, 5);
    expect(r.varianceQty).toBe(80);
    expect(r.variancePct).toBeCloseTo(40, 5);
    expect(r.flagged).toBe(true);
  });
  it('dalam ambang → tiada flag', () => {
    const r = variance(210, 200, 5); /* +5% — tepat pada ambang, bukan melebihi */
    expect(r.variancePct).toBeCloseTo(5, 5);
    expect(r.flagged).toBe(false);
  });
  it('penggunaan di bawah jangkaan turut di-flag (bazar/kecurian songsang)', () => {
    const r = variance(100, 200, 5);
    expect(r.flagged).toBe(true);
    expect(r.varianceQty).toBe(-100);
  });
  it('expected sifar + actual sifar → tidak di-flag', () => {
    expect(variance(0, 0, 5).flagged).toBe(false);
  });
  it('expected sifar + actual wujud → flag (tiada asas rawatan)', () => {
    const r = variance(30, 0, 5);
    expect(r.flagged).toBe(true);
    expect(r.variancePct).toBe(100);
  });
});

describe('isoWeek / previousIsoWeek (kunci kiraan mingguan)', () => {
  it('minggu ISO betul (contoh diketahui: 1 Jan 2026 = Khamis → 2026-W01)', () => {
    expect(isoWeek(new Date(2026, 0, 1))).toBe('2026-W01');
  });
  it('minggu melintasi tahun (29 Dis 2025 = Isnin, Khamis minggu itu 1 Jan 2026 → 2026-W01)', () => {
    /* Fakta kalendar: minggu ISO Isnin 29 Dis 2025..Ahad 4 Jan 2026 milik
     * tahun ISO 2026 kerana Khamisnya jatuh 1 Jan 2026. Fungsi betul;
     * ujian lama mengharapkan 2025-W52 — itu salah. */
    expect(isoWeek(new Date(2025, 11, 29))).toBe('2026-W01');
    expect(isoWeek(new Date(2025, 11, 22))).toBe('2025-W52');
  });
  it('previousIsoWeek memberi minggu betul-betul sebelumnya', () => {
    expect(previousIsoWeek('2026-W41')).toBe('2026-W40');
    expect(previousIsoWeek('2026-W02')).toBe('2026-W01');
    /* 2026-W01 mengandungi 29 Dis 2025 → sebelumnya minggu terakhir ISO 2025.
     * Fakta kalendar ISO: 2025 hanya 52 minggu (Khamis 25 Dis → W52,
     * 22-28 Dis). Ujian awal mengharapkan W53 — salah. */
    expect(previousIsoWeek('2026-W01')).toBe('2025-W52');
  });
  it('format tidak sah ditolak keras', () => {
    expect(() => previousIsoWeek('bukan-minggu')).toThrow();
  });
});
