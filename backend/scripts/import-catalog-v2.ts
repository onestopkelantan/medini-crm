/**
 * IMPORT KATALOG RAWATAN Dr Partner -> Medini CRM
 * Sumber: docs/DRPARTNER-SENARAI-IMPORT.json (kod_rawatan) + kategori dari Dr Partner
 *
 * Keputusan pemilik (2026-10-10): OPSI B — ganti 12 kod generik Medini
 * dengan 24 kod Dr Partner. Harga TIDAK diisi (katalog Dr Partner kosong 0.00;
 * menunggu harga sebenar dari bos). JANGAN reka nombor.
 *
 * Jalankan: npx tsx scripts/import-catalog-v2.ts
 */
import * as fs from 'fs';
import { createDatabase } from '/app/dist/infrastructure/database/database';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const ORG_ID = '00000000-0000-0000-0000-000000000001';

/* 24 kod Dr Partner (dari DRPARTNER-SENARAI-IMPORT.json) + kategori */
const CATALOG: Array<{ code: string; name: string; category: string }> = [
  { code: 'APPLIANCE', name: 'APPLIANCE', category: 'APPLICATION' },
  { code: 'BRACES_ORTHO', name: 'BRACES / ORTHO', category: 'BRACES' },
  { code: 'BRIDGE', name: 'BRIDGE', category: 'BRIDGE' },
  { code: 'CBCT_XRAY', name: 'CBCT XRAY', category: 'DENTAL SURGICAL' },
  { code: 'CLEAR_ALIGNER', name: 'CLEAR ALIGNER', category: 'CLEAR ALIGNER' },
  { code: 'CONSULTATION', name: 'CONSULTATION', category: 'CONSULTATION' },
  { code: 'CROWN', name: 'CROWN', category: 'CROWN' },
  { code: 'DENTURE', name: 'DENTURE', category: 'DENTURE' },
  { code: 'EXTRACTION', name: 'EXTRACTION', category: 'EXTRACTION' },
  { code: 'FIBER_REINFORCED_COMPOSITE', name: 'FIBER REINFORCED COMPOSITE', category: 'FIBER REINFORCED COMPOSITE' },
  { code: 'FILLING', name: 'FILLING', category: 'FILLING' },
  { code: 'FLUORIDE', name: 'FLUORIDE', category: 'APPLICATION' },
  { code: 'GINGEVECTOMY', name: 'GINGEVECTOMY', category: 'MINOR ORAL SUGERY' },
  { code: 'LA_CEPH_XRAY', name: 'LA CEPH XRAY', category: 'DENTAL SURGICAL' },
  { code: 'LOCAL_ANESTHESIA', name: 'LOCAL ANESTHESIA', category: 'MINOR ORAL SUGERY' },
  { code: 'MEDICATIONS', name: 'MEDICATIONS', category: 'APPLICATION' },
  { code: 'MINOR_ORAL_SURGERY', name: 'MINOR ORAL SURGERY', category: 'MINOR ORAL SUGERY' },
  { code: 'OPG_XRAY', name: 'OPG X-RAY', category: 'DENTAL SURGICAL' },
  { code: 'PA_XRAY', name: 'PA X-RAY', category: 'DENTAL SURGICAL' },
  { code: 'ROOT_CANAL_TREATMENT', name: 'ROOT CANAL TREATMENT', category: 'ROOT CANAL TREATMENT' },
  { code: 'SCALING_POLISHING', name: 'SCALING AND POLISHING', category: 'SCALING' },
  { code: 'STO', name: 'STO', category: 'DENTAL SURGICAL' },
  { code: 'VENEER', name: 'VENEER', category: 'VENEER' },
  { code: 'WHITENING', name: 'WHITENING', category: 'WHITENING' },
];

async function main() {
  const db = createDatabase(process.env.DATABASE_URL!);
  let n = 0;
  for (const c of CATALOG) {
    await db.execute(sql`
      INSERT INTO treatment_catalog (id, org_id, code, name, category, is_active)
      VALUES (${randomUUID()}, ${ORG_ID}, ${c.code}, ${c.name}, ${c.category}, 1)
      ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category)`);
    n++;
  }
  console.log(`katalog dimasukkan: ${n}`);
  const chk = await db.execute(sql`
    SELECT COUNT(*) AS n FROM treatment_catalog WHERE org_id = ${ORG_ID} AND deleted_at IS NULL`);
  console.log('katalog dalam DB:', (chk as unknown as { rows: Record<string, unknown>[] }).rows[0]?.n);
  process.exit(0);
}

main().catch((e) => { console.error('IMPORT KATALOG GAGAL:', e.message); process.exit(1); });
