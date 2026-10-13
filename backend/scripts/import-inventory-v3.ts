/**
 * IMPORT INVENTORI Dr Partner -> Medini CRM  (v3)
 * Sumber: dp_inventory_parsed.json — materials 882 · products 33 · suppliers 26
 *
 * Keputusan pemilik (2026-10-10):
 *  - sku AUTO-GENERATED (MAT-0001 / PRD-0001) kerana 'Item code' Dr Partner
 *    BUKAN kod unik (352 daripadanya lokasi: ROOM 1, COUNTER, ORTHO)
 *  - kod asal Dr Partner disimpan dalam external_ref (dilacak)
 *  - baris lokasi DIKEKALKAN (ia barang sebenar), baris tiada UOM juga dikekalkan
 *  - patients.sku telah dilonggarkan jadi NULLABLE + unique pada (org_id, external_ref)
 *
 * Idempoten: external_ref unik.
 * Jalankan: npx tsx scripts/import-inventory-v3.ts <workspace>
 */
import * as fs from 'fs';
import * as path from 'path';
import { createDatabase } from '/app/dist/infrastructure/database/database';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const WS = process.argv[2];
if (!WS) { console.error('usage: tsx import-inventory-v3.ts <workspace>'); process.exit(1); }
const ORG_ID = '00000000-0000-0000-0000-000000000001';
const BATCH = 200;

function q(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return 'NULL';
  return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
}

async function main() {
  const db = createDatabase(process.env.DATABASE_URL!);
  const inv = JSON.parse(fs.readFileSync(path.join(WS, 'dp_inventory_parsed.json'), 'utf8'));
  const stats: Record<string, number> = {};

  /* supplier dulu (idempoten guna external_ref) */
  for (const s of inv.suppliers as Array<Record<string, string>>) {
    const name = (s.name || '').trim();
    if (!name) continue;
    const ext = 'DP:SUP:' + name.slice(0, 40);
    await db.execute(sql`
      INSERT INTO suppliers (id, org_id, name, person_in_charge, contact, status, external_ref)
      VALUES (${randomUUID()}, ${ORG_ID}, ${name}, ${(s.pic || '').trim() || null},
              ${(s.contact || '').trim() || null}, ${(s.status || 'Active').trim()}, ${ext})
      ON DUPLICATE KEY UPDATE person_in_charge = VALUES(person_in_charge), contact = VALUES(contact)`);
  }
  stats['suppliers'] = (inv.suppliers as unknown[]).length;

  /* inv_items: satu baris per rekod Dr Partner (881 nama unik) */
  type Item = { sku: string; name: string; category: string; unit: string; ext: string };
  const items: Item[] = [];

  (inv.materials as Array<Record<string, string>>).forEach((m, i) => {
    items.push({
      sku: `MAT-${String(i + 1).padStart(4, '0')}`,
      name: (m.name || '').trim(),
      category: (m.category || '').trim(),
      unit: (m.uom || '').trim() || 'UNIT',
      ext: `DP:MAT:${i + 1}`,
    });
  });
  (inv.products as Array<Record<string, string>>).forEach((p, i) => {
    items.push({
      sku: `PRD-${String(i + 1).padStart(4, '0')}`,
      name: (p.name || '').trim(),
      category: (p.category || '').trim(),
      unit: (p.uom || '').trim() || 'UNIT',
      ext: `DP:PRD:${i + 1}`,
    });
  });

  const valid = items.filter((it) => it.name);
  console.log(`item untuk import: ${valid.length} (material ${inv.materials.length} + produk ${inv.products.length})`);

  for (let i = 0; i < valid.length; i += BATCH) {
    const chunk = valid.slice(i, i + BATCH);
    const values = chunk.map((it) =>
      `(${q(randomUUID())}, ${q(ORG_ID)}, ${q(it.sku)}, ${q(it.name)}, ${q(it.category || null)}, ` +
      `${q(it.unit)}, NULL, ${q(it.ext)}, 1, 'drpartner')`
    ).join(',\n');
    await db.execute(sql.raw(
      `INSERT INTO inv_items (id, org_id, sku, name, category, unit, supplier, external_ref, is_active, created_by)
       VALUES ${values}
       ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category), unit = VALUES(unit)`
    ));
    stats['inv_items'] = (stats['inv_items'] || 0) + chunk.length;
  }

  console.log('\n=== RINGKASAN ===');
  console.log(JSON.stringify(stats, null, 1));
  const chk = await db.execute(sql`
    SELECT COUNT(*) AS n FROM inv_items WHERE org_id = ${ORG_ID} AND created_by = 'drpartner'`);
  console.log('inv_items dalam DB:', (chk as unknown as { rows: Record<string, unknown>[] }).rows[0]?.n);
  process.exit(0);
}

main().catch((e) => { console.error('IMPORT INVENTORI GAGAL:', e.message); process.exit(1); });
