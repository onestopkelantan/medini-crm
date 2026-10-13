#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# Ujian perlumbaan: 10 permintaan serentak. Nombor siri TIDAK boleh bertindih.
set -uo pipefail
cd "C:/Users/User/Desktop/medini-updated"

API=https://localhost/api/v1
DIR="${LOCALAPPDATA:-/tmp}/Temp"
RP=$(docker exec medini-prod-mysql-1 sh -c 'printf %s "$MYSQL_ROOT_PASSWORD"')

q() { docker exec -i medini-prod-mysql-1 mysql -uroot -p"$RP" medini_prod -N -B -e "$1" 2>/dev/null | tr -d '\r'; }

# Fasa 0b — hanya baris ujian. `DELETE FROM issued_forms` (tanpa syarat)
# memusnahkan setiap MC dan surat kebenaran klinik. Ujian perlumbaan ini menulis
# subjek 'Lumba N', jadi ia bersihkan itu sahaja.
q "DELETE FROM issued_forms WHERE subject LIKE 'Lumba %'"

DOC=$(curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "dr.aina")" \
  | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
DID=$(curl -sk "$API/auth/me" -H "Authorization: Bearer $DOC" \
  | python -c "import sys,json;print(json.load(sys.stdin)['data']['doctorId'])")
BID=$(q "SELECT branch_id FROM staff WHERE username='dr.aina'")
TID=$(q "SELECT id FROM consent_templates WHERE title='ZZTEST Surat Sakit'")
PAT=$(q "SELECT id FROM patients WHERE branch_id='$BID' LIMIT 1")

echo "=== 10 permintaan SERENTAK (latar belakang) ==="
rm -f "$DIR/lumba"*.txt

for i in $(seq 1 10); do
  (
    curl -sk -X POST "$API/clinical/forms" \
      -H "Authorization: Bearer $DOC" -H 'Content-Type: application/json' \
      -d "{\"kind\":\"mc\",\"templateId\":\"$TID\",\"patientId\":\"$PAT\",\"subject\":\"Lumba $i\",\"branchId\":\"$BID\",\"doctorId\":\"$DID\"}" \
      | python -c "import sys,json;d=json.load(sys.stdin);print(d.get('serialNo') or ('RALAT:'+str(d.get('error',{}).get('code'))))"
  ) > "$DIR/lumba$i.txt" 2>&1 &
done
wait

echo "--- nombor siri yang keluar ---"
cat "$DIR"/lumba*.txt | sort

echo
echo "=== KESIMPULAN (dari DB, bukan dari respons) ==="
TOT=$(q "SELECT COUNT(*) FROM issued_forms")
UNIQ=$(q "SELECT COUNT(DISTINCT serial_no) FROM issued_forms")
BAD=$(q "SELECT COUNT(*) FROM issued_forms WHERE serial_no LIKE '%00000' OR serial_no IS NULL OR serial_no=''")
echo "  borang dicipta    : $TOT"
echo "  nombor siri UNIK  : $UNIQ"
echo "  nombor rosak      : $BAD"
echo "  kounter           : $(q 'SELECT last_serial FROM form_serial_counters')"

if [ "$TOT" = "$UNIQ" ] && [ "$BAD" = "0" ] && [ "$TOT" -gt 0 ]; then
  echo
  echo "  ✅ LULUS — tiada nombor bertindih, tiada sifar"
else
  echo
  echo "  ❌ GAGAL — ada nombor bertindih atau rosak"
fi
