/**
 * IMPORT PASIEN Dr Partner -> Medini CRM  (v2 — batch + idempoten betul)
 *
 * Perbaikan dari v1 (yang mencipta duplikat):
 *  - external_ref disimpan di kolomnya SENDIRI (v1 menulisnya ke `mrn`,
 *    jadi cek "sudah ada?" tidak pernah cocok -> tiap jalankan menambah baris baharu)
 *  - batch insert 500 baris sekali (v1 satu-satu -> timeout -> dijalankan ulang -> duplikat)
 *  - dedup dalam memori + ON DUPLICATE KEY UPDATE (selamat dijalankan berulang)
 *
 * Jalankan: npx tsx scripts/import-patients-v2.ts <workspace>
 */
import * as fs from 'fs';
import * as path from 'path';
import { createDatabase } from '/app/dist/infrastructure/database/database';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const WS = process.argv[2];
if (!WS) { console.error('usage: tsx import-patients-v2.ts <workspace>'); process.exit(1); }
const ORG_ID = '00000000-0000-0000-0000-000000000001';
const BATCH = 500;

const BRANCH_MAP: Record<string, string> = {
  '2': 'metropoint-kajang', '4': 'taman-molek', '5': 'sentosa',
  '8': 'setia-tropika', '10': 'uda-business-centre', '12': 'klinik-pergigian-uda',
};

function dobISO(v: string): string | null {
  const m = (v || '').trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
function gender(v: string): string | null {
  const t = (v || '').trim().toLowerCase();
  if (t.startsWith('m')) return 'Male';
  if (t.startsWith('f')) return 'Female';
  return null;
}
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

  const mrnRow = await db.execute(sql`
    SELECT COALESCE(MAX(CAST(SUBSTRING(mrn, 5) AS UNSIGNED)), 0) AS n
    FROM patients WHERE org_id = ${ORG_ID} AND mrn REGEXP '^MRN-[0-9]+$'`);
  let mrnSeq = Number((mrnRow as unknown as { rows: Record<string, unknown>[] }).rows[0]?.n || 0);

  /* --- fasa 1: kumpul SEMUA baris, dedup dalam memori --- */
  const collected: Array<{ ext: string; branch: string; name: string; dob: string | null; gender: string | null; phone: string | null }> = [];
  const seen = new Set<string>();
  const perBranch: Record<string, number> = {};

  for (const dp of Object.keys(BRANCH_MAP)) {
    const f = path.join(WS, `dp_patients_b${dp}.json`);
    if (!fs.existsSync(f)) { console.log(`LANGKAU: ${f} tiada`); continue; }
    const data = JSON.parse(fs.readFileSync(f, 'utf8')) as { rows: Array<Record<string, string>> };
    const bid = brId.get(BRANCH_MAP[dp]);
    if (!bid) throw new Error(`cabang Medini tiada: ${BRANCH_MAP[dp]}`);
    let n = 0;
    for (const r of data.rows) {
      const ext = `DP:PT:${dp}:${r.id}`;
      if (seen.has(ext)) continue;
      seen.add(ext);
      collected.push({
        ext, branch: bid,
        name: (r.name || '').trim() || `(TIADA NAMA) ${r.id}`,
        dob: dobISO(r.dob), gender: gender(r.gender),
        phone: (r.mobile || '').trim() || null,
      });
      n++;
    }
    perBranch[`b${dp}`] = n;
    console.log(`b${dp} dibaca: ${n}`);
  }
  console.log(`\nJumlah unik dikumpul: ${collected.length}`);

  /* --- fasa 2: batch insert --- */
  let inserted = 0;
  for (let i = 0; i < collected.length; i += BATCH) {
    const chunk = collected.slice(i, i + BATCH);
    const values = chunk.map((c) => {
      mrnSeq += 1;
      const mrn = `MRN-${String(mrnSeq).padStart(6, '0')}`;
      return `(${q(randomUUID())}, ${q(ORG_ID)}, ${q(c.branch)}, ${q(mrn)}, ${q(c.ext)}, ` +
             `${q(c.name)}, ${q(c.dob)}, ${q(c.gender)}, ${q(c.phone)}, 'Active', 'drpartner', NOW())`;
    }).join(',\n');

    await db.execute(sql.raw(
      `INSERT INTO patients (id, org_id, branch_id, mrn, external_ref, name, dob, gender, phone, status, patient_source, created_at)
       VALUES ${values}
       ON DUPLICATE KEY UPDATE name = VALUES(name), dob = VALUES(dob),
                               gender = VALUES(gender), phone = VALUES(phone)`
    ));
    inserted += chunk.length;
    if (inserted % 5000 === 0 || inserted === collected.length) {
      console.log(`  dimasukkan: ${inserted}/${collected.length}`);
    }
  }

  const total = await db.execute(sql`SELECT COUNT(*) AS n FROM patients WHERE org_id = ${ORG_ID}`);
  console.log('\n=== SELESAI ===');
  console.log('per cabang:', JSON.stringify(perBranch));
  console.log('TOTAL dalam DB:', (total as unknown as { rows: Record<string, unknown>[] }).rows[0]?.n);
  process.exit(0);
}

main().catch((e) => { console.error('IMPORT PASIEN GAGAL:', e.message); process.exit(1); });
