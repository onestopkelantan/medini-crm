/**
 * IMPORT Dr Partner -> Medini CRM
 * Sumber: workspace Dr Partner extraction (JSON)
 * Idempoten: guna external_ref / nama sebagai kunci, ON DUPLICATE tidak menggandakan.
 *
 * Jalankan: npx tsx backend/scripts/import-drpartner.ts <path-workspace>
 */
import * as fs from 'fs';
import * as path from 'path';
import { createDatabase } from '/app/dist/infrastructure/database/database';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const WS = process.argv[2];
if (!WS) { console.error('usage: tsx import-drpartner.ts <workspace>'); process.exit(1); }
const ORG_ID = '00000000-0000-0000-0000-000000000001';

/* Pemetaan cabang Dr Partner -> kod Medini (disahkan pemilik 2026-10-10) */
const BRANCH_MAP: Record<string, string> = {
  '2': 'metropoint-kajang',
  '4': 'taman-molek',
  '5': 'sentosa',
  '8': 'setia-tropika',
  '10': 'uda-business-centre',
  '12': 'klinik-pergigian-uda',
};

/* Normalkan ejaan cara bayar (Dr Partner tidak konsisten) */
function normPayType(v: string): string {
  const s = (v || '').trim();
  const t = s.toLowerCase();
  if (t.includes('debit') || t.includes('debt')) return 'Debit Card';
  if (t.includes('visa')) return 'Visa Card';
  if (t.includes('master')) return 'Master Card';
  if (t.includes('credit')) return 'Credit Card';
  if (t.includes('qr')) return 'QR Pay';
  if (t.includes('cash')) return 'Cash';
  if (t.includes('bank transfer') || t.includes('transfer bank')) return 'Bank Transfer';
  if (t.includes('tng') || t.includes('ewallet')) return 'TnG eWallet';
  return s || 'Unknown';
}
/* Normalkan kode rawatan Dr Partner */
function normTreatment(v: string): string {
  return (v || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*&\s*/g, ' & ')
    .replace(/\s*\/\s*/g, ' / ')
    .trim();
}
function parseDateMY(v: string): string | null {
  const s = (v || '').trim();
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

type Row = Record<string, unknown>;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required');
  const db = createDatabase(url);
  const stats: Record<string, number> = {};

  /* --- cabang: baca id Medini --- */
  const branchRows = await db.execute(sql`
    SELECT id, code FROM branches WHERE org_id = ${ORG_ID} AND deleted_at IS NULL`);
  const branchIdByCode = new Map<string, string>();
  for (const r of (branchRows as unknown as { rows: Row[] }).rows) {
    branchIdByCode.set(String(r.code), String(r.id));
  }
  for (const [dp, medini] of Object.entries(BRANCH_MAP)) {
    if (!branchIdByCode.has(medini)) throw new Error(`cabang Medini tidak dijumpai: ${medini} (DP ${dp})`);
  }

  const load = (f: string) => JSON.parse(fs.readFileSync(path.join(WS, f), 'utf8'));

  /* =================================================================
   * 1. MASTER KECIL (UOM, kategori, tujuan temujanji, voucher)
   * ================================================================= */
  const master = load('dp_master_parsed_b8.json');
  const masterTables: Array<[string, string, string[]]> = [
    ['uomsetup', 'uoms', ['code']],
    ['treatmentcatsetup', 'treatment_categories', ['code']],
    ['cscatsetup', 'inventory_categories', ['name']],
    ['prodcatsetup', 'inventory_categories', ['name']],
  ];
  for (const [key, table, cols] of masterTables) {
    const rows = (master[key] || []) as string[][];
    for (const r of rows.slice(1)) {
      const name = (r[0] || '').trim();
      if (!name || name === 'Category' || name === 'UOM' || name === 'Channel') continue;
      if (table === 'uoms') {
        await db.execute(sql`INSERT INTO uoms (id, org_id, code, name) VALUES (${randomUUID()}, ${ORG_ID}, ${name}, ${name})
          ON DUPLICATE KEY UPDATE code = code`);
      } else if (table === 'treatment_categories') {
        await db.execute(sql`INSERT INTO treatment_categories (id, org_id, code, name) VALUES (${randomUUID()}, ${ORG_ID}, ${name}, ${name})
          ON DUPLICATE KEY UPDATE code = code`);
      } else {
        await db.execute(sql`INSERT INTO inventory_categories (id, org_id, item_kind, name)
          VALUES (${randomUUID()}, ${ORG_ID}, ${key === 'prodcatsetup' ? 'PRODUCT' : 'MATERIAL'}, ${name})`);
      }
      stats[table] = (stats[table] || 0) + 1;
    }
  }

  /* tujuan temujanji */
  for (const r of ((master['apptpurposesetup'] || []) as string[][]).slice(1)) {
    const name = (r[0] || '').trim();
    if (!name || name === 'Purpose') continue;
    await db.execute(sql`INSERT INTO appointment_purposes (id, org_id, name, default_hours, default_minutes)
      VALUES (${randomUUID()}, ${ORG_ID}, ${name}, ${Number(r[1]) || 0}, ${Number(r[2]) || 0})
      ON DUPLICATE KEY UPDATE name = name`);
    stats['appointment_purposes'] = (stats['appointment_purposes'] || 0) + 1;
  }

  /* voucher */
  for (const r of ((master['vouchersetup'] || []) as string[][]).slice(1)) {
    const name = (r[0] || '').trim();
    if (!name || name === 'Voucher name') continue;
    await db.execute(sql`INSERT INTO vouchers (id, org_id, name, discount_method, discount_amount)
      VALUES (${randomUUID()}, ${ORG_ID}, ${name}, ${(r[1] || '%').trim()}, ${Number((r[2] || '0').trim()) || 0})`);
    stats['vouchers'] = (stats['vouchers'] || 0) + 1;
  }

  /* senarai rujukan ubat */
  const refLists: Array<[string, string]> = [
    ['medicatsetup', 'CATEGORY'], ['medigradesetup', 'GRADE'], ['medialertsetup', 'ALERT'],
    ['medimealsetup', 'MEAL'], ['mediusagesetup', 'USAGE'], ['medidosagesetup', 'DOSAGE'],
    ['mediattsetup', 'ATTRIBUTE'], ['medigroupsetup', 'GROUP'],
  ];
  for (const [key, type] of refLists) {
    let i = 0;
    for (const r of ((master[key] || []) as string[][]).slice(1)) {
      const v = (r[0] || '').trim();
      if (!v || /^(Category|Grade|Alert|Meal|Usage|Dosage|Attribute|Group)$/i.test(v)) continue;
      await db.execute(sql`INSERT INTO medicine_ref_lists (id, org_id, list_type, value, sort_order)
        VALUES (${randomUUID()}, ${ORG_ID}, ${type}, ${v}, ${i++})`);
      stats['medicine_ref_lists'] = (stats['medicine_ref_lists'] || 0) + 1;
    }
  }

  /* panel — tambah yang kurang (pemilik: tambah 7 jadi 10) */
  for (const r of ((master['panelsetup'] || []) as string[][]).slice(1)) {
    const name = (r[0] || '').trim();
    if (!name || name === 'Panel name') continue;
    const exist = await db.execute(sql`SELECT id FROM panel_companies WHERE org_id = ${ORG_ID} AND name = ${name} LIMIT 1`);
    if ((exist as unknown as { rows: Row[] }).rows.length) continue;
    const seq = await db.execute(sql`SELECT COUNT(*) AS n FROM panel_companies WHERE org_id = ${ORG_ID}`);
    const n = Number((seq as unknown as { rows: Row[] }).rows[0]?.n || 0) + 1;
    await db.execute(sql`INSERT INTO panel_companies (id, org_id, code, name, pic, phone, status, source)
      VALUES (${randomUUID()}, ${ORG_ID}, ${'PNL-' + String(n).padStart(4, '0')}, ${name}, ${(r[1] || '').trim() || null}, ${(r[2] || '').trim() || null}, ${'Active'}, ${'drpartner'})`);
    stats['panel_companies'] = (stats['panel_companies'] || 0) + 1;
  }

  /* supplier */
  for (const r of ((master['suppliersetup'] || []) as string[][]).slice(1)) {
    const name = (r[0] || '').trim();
    if (!name || name === 'Supplier name') continue;
    await db.execute(sql`INSERT INTO suppliers (id, org_id, name, person_in_charge, contact, status, external_ref)
      VALUES (${randomUUID()}, ${ORG_ID}, ${name}, ${(r[1] || '').trim() || null}, ${(r[2] || '').trim() || null}, ${(r[3] || 'Active').trim()}, ${'DP:' + name.slice(0, 40)})`);
    stats['suppliers'] = (stats['suppliers'] || 0) + 1;
  }

  /* ubat */
  for (const r of ((master['medisetup'] || []) as string[][]).slice(1)) {
    const uom = r[2] || '';
    const cat = (r[0] || '').trim();
    const name = (r[1] || '').trim();
    if (!name || name === 'Medicine') continue;
    const dbe = await db.execute(sql`SELECT id FROM medicines WHERE org_id = ${ORG_ID} AND name = ${name} AND deleted_at IS NULL LIMIT 1`);
    if ((dbe as unknown as { rows: Row[] }).rows.length) continue;
    await db.execute(sql`INSERT INTO medicines (id, org_id, name, category, uom, external_ref)
      VALUES (${randomUUID()}, ${ORG_ID}, ${name}, ${cat || null}, ${uom || null}, ${'DP:MED:' + name.slice(0, 40)})`);
    stats['medicines'] = (stats['medicines'] || 0) + 1;
  }

  console.log('=== MASTER ===');
  console.log(JSON.stringify(stats, null, 1));
  console.log('BRANCH IDS:', JSON.stringify([...branchIdByCode.keys()]));
}

main().catch((e) => { console.error('IMPORT GAGAL:', e.message); process.exit(1); });
