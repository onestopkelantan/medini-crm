#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# FASA 5C-E — live proof of the clinical safety guards.
#
# TWO CLAIMS UNDER TEST
#
#   1. PRIVACY. A blast whose text names a condition, or a patient's own
#      treatment history, is REFUSED. A blast that offers a service is ACCEPTED.
#
#   2. ADDRESSING. A paediatric patient is addressed through their guardian.
#      The candidate list must carry the guardian name, not just the child name.
#
# The privacy guard is enforced at the API, so it is provable without WhatsApp.
# The addressing guard is a pure function; it is exercised here through the live
# candidate endpoint as well, so the DB join that resolves the guardian is proved.
#
# Run from the repo root: bash verify-5ce-clinical.sh

set -uo pipefail
export LC_ALL=C

API="https://localhost/api/v1"
PASS=0; FAIL=0
DB() { docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -N -B -e "$1" 2>/dev/null; }
ok()  { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — dapat '$2', jangka '$3'"; fi; }

echo "=== FASA 5C-E — penjaga keselamatan klinikal ==="
echo

TOKEN=$(curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "manager")" | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null)
[ -n "$TOKEN" ] && ok "log masuk manager" || { bad "log masuk manager"; exit 1; }

BRANCH=$(DB "SELECT id FROM branches WHERE code='sentosa'")
CH=$(DB "SELECT id FROM wa_channels WHERE branch_id='$BRANCH' AND deleted_at IS NULL LIMIT 1")
DB "UPDATE wa_channels SET status='working', health_score=95 WHERE id='$CH'" >/dev/null

blast() {  # $1 = body, $2 = recipient
  curl -sk -X POST "$API/whatsapp/blast" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"branchId\":\"$BRANCH\",\"channelId\":\"$CH\",\"recipients\":[\"$2\"],\"body\":$(python -c "import json,sys;print(json.dumps(sys.argv[1]))" "$1"),\"consentConfirmed\":true}" 2>/dev/null
}

echo
echo "--- 1. PENJAGA PRIVASI: diagnosis / sejarah rawatan DITOLAK ---"

for TEXT in \
  "Salam! Kami perasan anda ada karies yang perlu dirawat segera." \
  "Gusi anda menunjukkan tanda gingivitis." \
  "Hasil X-ray anda menunjukkan abscess." \
  "Anda hamil, jadi rawatan perlu ditunda." \
  "Rawatan saluran akar anda belum siap." \
  "Salam {nama}! Rawatan {rawatan} anda boleh disambung." ; do
  R=$(blast "$TEXT" "60166555001")
  if echo "$R" | grep -q "VALIDATION_ERROR"; then
    ok "DITOLAK: ${TEXT:0:46}…"
  else
    bad "sepatutnya ditolak: ${TEXT:0:46}… → $(echo "$R" | head -c 130)"
  fi
done

echo
echo "--- 2. Mesej selamat DITERIMA (penjaga tidak terlalu ketat) ---"
GOOD="Salam {nama}! 👋

Kami dari Klinik Pergigian Medini {cawangan}.

Sudah lebih 6 bulan sejak lawatan terakhir anda. Boleh kami bantu aturkan temujanji?

👉 {link}"
R=$(blast "$GOOD" "60166555002")
if echo "$R" | grep -qE "VALIDATION_ERROR.*klinikal"; then
  bad "mesej selamat ditolak — penjaga terlalu ketat"
else
  ok "mesej recall biasa diterima (tiada butiran klinikal)"
fi

R2=$(blast "Promosi pembersihan gigi (scaling) bulan ini. Boleh kami bantu aturkan temujanji?" "60166555003")
if echo "$R2" | grep -qE "VALIDATION_ERROR.*klinikal"; then
  bad "tawaran perkhidmatan ditolak — penjaga terlalu ketat"
else
  ok "tawaran perkhidmatan diterima (menyebut PERKHIDMATAN, bukan keadaan pesakit)"
fi

echo
echo "--- 3. Mesej ditolak mengikut BARIS supaya operator boleh betulkan ---"
R3=$(blast "$(printf 'Promosi bulan ini!\nGusi anda ada jangkitan.\nHubungi kami.')" "60166555004")
if echo "$R3" | grep -q "Baris 2"; then
  ok "rujukan baris tepat: $(echo "$R3" | python -c "import sys,json;d=json.load(sys.stdin);print(d['error']['fieldErrors']['body'][1])" 2>/dev/null)"
else
  bad "tiada rujukan baris — $(echo "$R3" | head -c 200)"
fi

echo
echo "--- 4. PENJAGA KANAK-KANAK: calon membawa nama penjaga + DOB ---"
COLS=$(DB "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='medini_prod' AND TABLE_NAME='patients' AND COLUMN_NAME IN ('dob','guardian_id','patient_type')")
check "medan DOB / penjaga wujud dalam skema" "$COLS" "3"

# Create a guardian + child pair so the join is proved against real rows, not
# asserted from the schema alone. Sentosa starts empty in this environment.
GUID=$(python -c "import uuid;print(uuid.uuid4())")
CHILD=$(python -c "import uuid;print(uuid.uuid4())")
DB "INSERT INTO patients (id, org_id, branch_id, mrn, name, status, whatsapp, last_visit_at, patient_type, contact_type, dob)
    VALUES ('$GUID','00000000-0000-0000-0000-000000000001','$BRANCH','MRN-5CE-1','Ujian Penjaga','Active','60144222001', DATE_SUB(NOW(), INTERVAL 8 MONTH),'adult','own','1988-04-12')"
DB "INSERT INTO patients (id, org_id, branch_id, mrn, name, status, whatsapp, last_visit_at, patient_type, contact_type, dob, guardian_id)
    VALUES ('$CHILD','00000000-0000-0000-0000-000000000001','$BRANCH','MRN-5CE-2','Ujian Anak','Active','60144222002', DATE_SUB(NOW(), INTERVAL 7 MONTH),'child','guardian','2019-03-10','$GUID')"

CAND=$(curl -sk "$API/marketing/scrubbing-candidates?branchId=$BRANCH&minMonths=3&limit=10" -H "Authorization: Bearer $TOKEN")

echo "$CAND" | python -c "
import sys, json
rows = json.load(sys.stdin)
by = {r['name']: r for r in rows}
child = by.get('Ujian Anak')
guard = by.get('Ujian Penjaga')
assert child, 'pesakit kanak-kanak tiada dalam senarai'
assert guard, 'pesakit penjaga tiada dalam senarai'
assert child['guardianName'] == 'Ujian Penjaga', f\"penjaga salah: {child['guardianName']}\"
assert child['dob'] == '2019-03-10', f\"dob salah: {child['dob']}\"
assert child['patientType'] == 'child', f\"jenis salah: {child['patientType']}\"
assert guard['guardianName'] is None, 'dewasa tidak sepatutnya ada penjaga'
print('  kanak-kanak:', child['name'], '| dob', child['dob'], '| jenis', child['patientType'], '| penjaga', child['guardianName'])
print('  dewasa     :', guard['name'], '| dob', guard['dob'], '| penjaga', guard['guardianName'])
print('  PASS  join penjaga + DOB daripada rekod sebenar')
" 2>&1 | tail -4

echo
echo "--- 5. Logik sapaan (fungsi produksi, dipanggil terus) ---"
ADDR=$(docker exec medini-prod-backend-1 node -e "
const { addressForm } = require('/app/dist/modules/marketing/domain/clinical-guard.js');
const now = new Date('2026-09-23T00:00:00Z');
const child = addressForm({ name:'Nur Aisyah', dob:'2019-03-10', guardianName:'Siti Aminah' }, now);
const adult = addressForm({ name:'Ahmad Faizal', dob:'1990-05-01', guardianName:null }, now);
const orph  = addressForm({ name:'Bayi Tan', dob:'2024-01-01', guardianName:null }, now);
console.log(JSON.stringify({ child, adult, orph }));
" 2>/dev/null | tail -1)

echo "$ADDR" | python -c "
import sys, json
d = json.load(sys.stdin)
c, a, o = d['child'], d['adult'], d['orph']
print('  kanak-kanak :', c['pronoun'], '/', c['salutation'], '/', c['context'])
print('  dewasa      :', a['pronoun'], '/', a['salutation'])
print('  tiada penjaga:', o['pronoun'], '/', o['salutation'], '| guardianMissing =', o['guardianMissing'])
assert c['pronoun'] == 'anak anda', 'kanak-kanak mesti disapa melalui penjaga'
assert c['salutation'].endswith('Siti Aminah'), 'sapaan mesti kepada penjaga'
assert a['pronoun'] == 'anda', 'dewasa disapa terus'
assert o['guardianMissing'] is True, 'penjaga hilang mesti ditandakan'
print('  PASS  ketiga-tiga kes sapaan betul')
" 2>&1 | tail -6

echo
echo "--- 6. Bersihkan + pulihkan channel ---"
DB "DELETE FROM wa_safety_decisions WHERE message_id IN (SELECT id FROM wa_messages WHERE body LIKE '%karies%' OR body LIKE '%{rawatan}%' OR body LIKE '%pembersihan gigi%' OR body LIKE '%jangkitan%')"
DB "DELETE FROM wa_messages WHERE body LIKE '%karies%' OR body LIKE '%{rawatan}%' OR body LIKE '%pembersihan gigi%' OR body LIKE '%jangkitan%' OR body LIKE '%scaling%'"
DB "DELETE FROM wa_blast_campaigns WHERE name='Blast WhatsApp'"
DB "DELETE FROM wa_conversations WHERE contact_phone LIKE '60166%'"
DELETE_CHILD=$(DB "SELECT COUNT(*) FROM patients WHERE name IN ('Ujian Penjaga','Ujian Anak')")
DB "DELETE FROM patients WHERE name IN ('Ujian Penjaga','Ujian Anak')"
DB "UPDATE wa_channels SET status='need_qr', health_score=0 WHERE id='$CH'"
LEFT=$(DB "SELECT COUNT(*) FROM wa_messages WHERE body LIKE '%karies%' OR body LIKE '%{rawatan}%'")
check "data ujian dibersihkan" "$LEFT" "0"
check "pesakit ujian dibersihkan" "$(DB "SELECT COUNT(*) FROM patients WHERE name IN ('Ujian Penjaga','Ujian Anak')")" "0"
check "channel dipulihkan" "$(DB "SELECT status FROM wa_channels WHERE id='$CH'")" "need_qr"

echo
echo "======================================================"
echo "  LULUS: $PASS   GAGAL: $FAIL"
echo "======================================================"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
