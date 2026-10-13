/**
 * IMPORT TRANSAKSI/KOLEKSI Dr Partner -> Medini CRM
 *
 * Sumber: dp_5y_FINAL_b{2,4,5,8,10,12}.json  (tx + total per bulan)
 * Bentuk: satu baris sale_records per BULAN per cabang (agregat rasmi Dr Partner)
 *
 * Nota penting: Dr Partner hanya menyediakan agenda bulanan pada peringkat ini.
 * Baris per-transaksi individu TIDAK disimpan dalam fail ekstrak (hanya jumlah
 * bulanan yang disahkan lawan 2 jadual ringkasan laporan). Jadi yang diimport
 * di sini ialah HEADLINE bulanan, bukan tiket individu — dan ia ditanda sedemikian.
 *
 * Jalankan: npx tsx scripts/import-sales-v2.ts <workspace>
 */
import * as fs from 'fs';
import * as path from 'path';
import { createDatabase } from '/app/dist/infrastructure/database/database';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const WS = process.argv[2];
if (!WS) { console.error('usage: tsx import-sales-v2.ts <workspace>'); process.exit(1); }
const ORG_ID = '00000000-0000-0000-0000-000000000001';

const BRANCH_MAP: Record<string, string> = {
  '2': 'metropoint-kajang', '4': 'taman-molek', '5': 'sentosa',
  '8': 'setia-tropika', '10': 'uda-business-centre', '12': 'klinik-pergigian-uda',
};

function q(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return 'NULL';
  return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
}

async function main() {
  const db = createDatabase(process.env.DATABASE_URL!);
  const brRows = await db.execute(sql`
    SELECT id, code FROM branches WHERE org_id = ${ORG_ID} AND deleted_at IS NULL`);
  const brId = new Map<string, string>();
  for (const r of (brRows as unknown as { rows: Record<string, unknown>[] }).rows) {
    brId.set(String(r.code), String(r.id));
  }

  const rows: Array<{ branch: string; code: string; amount: number; date: string; tx: number }> = [];
  let grandTx = 0;
  let grandRm = 0;

  for (const dp of Object.keys(BRANCH_MAP)) {
    const f = path.join(WS, `dp_5y_FINAL_b${dp}.json`);
    if (!fs.existsSync(f)) { console.log(`LANGKAU: ${f} tiada`); continue; }
    const data = JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, { tx: number; total: number }>;
    const bid = brId.get(BRANCH_MAP[dp]);
    if (!bid) throw new Error(`cabang Medini tiada: ${BRANCH_MAP[dp]}`);
    let bTx = 0; let bRm = 0;
    for (const [ym, v] of Object.entries(data)) {
      if (!v || !v.tx) continue;
      const y = ym.slice(0, 4); const m = ym.slice(4, 6);
      rows.push({
        branch: bid,
        code: `DP-SALE-${dp}-${ym}`,
        amount: v.total,
        date: `${y}-${m}-01`,
        tx: v.tx,
      });
      bTx += v.tx; bRm += v.total;
    }
    console.log(`b${dp}: ${Object.keys(data).length} bulan | ${bTx} tx | RM ${bRm.toFixed(2)}`);
    grandTx += bTx; grandRm += bRm;
  }

  console.log(`\nJUMLAH SUMBER: ${grandTx} tx | RM ${grandRm.toFixed(2)}`);

  let inserted = 0;
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const values = chunk.map((r) =>
      `(${q(randomUUID())}, ${q(ORG_ID)}, ${q(r.branch)}, ${q(r.code)}, ${q('DP:' + r.code)}, ` +
      `${q('drpartner')}, ${r.amount}, ${q(r.date)}, 'confirmed', ` +
      `${q('Agregat bulanan Dr Partner: ' + r.tx + ' transaksi')})`
    ).join(',\n');
    await db.execute(sql.raw(
      `INSERT INTO sale_records (id, org_id, branch_id, sale_code, external_ref, source_system, amount, sale_date, status, notes)
       VALUES ${values}
       ON DUPLICATE KEY UPDATE amount = VALUES(amount), notes = VALUES(notes)`
    ));
    inserted += chunk.length;
  }
  console.log(`Baris sale_records dimasukkan: ${inserted}`);

  const chk = await db.execute(sql`
    SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total
    FROM sale_records WHERE org_id = ${ORG_ID} AND source_system = 'drpartner'`);
  const c = (chk as unknown as { rows: Record<string, unknown>[] }).rows[0]!;
  console.log('\n=== VERIFIKASI DB ===');
  console.log('baris:', c.n, '| jumlah RM:', Number(c.total).toFixed(2));
  console.log('sasaran sumber:  RM', grandRm.toFixed(2));
  const diff = Math.abs(Number(c.total) - grandRm);
  console.log(diff < 0.01 ? '✔ JUMLAH COCOK' : `�’ BEDA RM ${diff.toFixed(2)}`);
  process.exit(0);
}

main().catch((e) => { console.error('IMPORT JUALAN GAGAL:', e.message); process.exit(1); });
