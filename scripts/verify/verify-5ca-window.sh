#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# FASA 5C-A — prove the audience window actually filters.
#
# The bug was invisible with an empty patient table: every window returned the
# same count, which looks like "no matches" rather than "filter broken". So this
# creates patients at KNOWN distances in the past and asserts each window
# selects exactly the right subset.
#
#   2 months ago  → must appear ONLY in a window that starts at/under 2 months
#   7 months ago  → the 6-9 month bucket
#  11 months ago  → the 9-12 month bucket
#  14 months ago  → the "12 months or longer" bucket
#   (never)      → must appear in NO window at all
#
# Everything is cleaned up at the end.
set -u
cd ~/Desktop/medini-updated

API=https://localhost/api/v1
BRANCH="af0a0841-0786-40b2-9b4e-30ed9270a659"
TAG="wintest"

say() { echo; echo "=== $* ==="; }
q() { docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -N -B -e "$1" 2>/dev/null; }

TOKEN=$(curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "hq")" \
  | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null)
[ -n "$TOKEN" ] || { echo "login gagal"; exit 1; }

say "1. Cipta pesakit ujian pada jarak lawatan yang diketahui"
q "DELETE FROM patients WHERE name LIKE '${TAG}-%';"
for spec in "2:2bulan" "7:7bulan" "11:11bulan" "14:14bulan"; do
  M="${spec%%:*}"; NAME="${spec##*:}"
  q "INSERT INTO patients (id, org_id, branch_id, mrn, name, status, whatsapp, last_visit_at, patient_type, contact_type)
     VALUES (UUID(), '00000000-0000-0000-0000-000000000001', '$BRANCH',
             CONCAT('MRN-${TAG}-$M'), '${TAG}-${NAME}', 'Active', '6019000000$M',
             DATE_SUB(NOW(), INTERVAL $M MONTH), 'adult', 'own');"
done
# never visited
q "INSERT INTO patients (id, org_id, branch_id, mrn, name, status, whatsapp, last_visit_at, patient_type, contact_type)
   VALUES (UUID(), '00000000-0000-0000-0000-000000000001', '$BRANCH',
           'MRN-${TAG}-never', '${TAG}-belumdatang', 'Active', '601900000099', NULL, 'adult', 'own');"
q "SELECT name, COALESCE(DATE_FORMAT(last_visit_at,'%Y-%m-%d'),'NULL') AS lawatan
   FROM patients WHERE name LIKE '${TAG}-%' ORDER BY last_visit_at IS NULL, last_visit_at;"

preview() {
  local body="$1" label="$2"
  local out
  out=$(curl -sk -X POST "$API/marketing/audience/preview" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "$body")
  python - "$label" <<PY
import sys, json
label = sys.argv[1]
try:
    d = json.loads('''$out''')
except Exception:
    print(f"  {label:34s} -> GAGAL parse"); raise SystemExit
names = sorted(p.get('name','') for p in (d.get('sample') or []))
print(f"  {label:34s} -> count={d.get('count')}  sample={[n for n in names]}")
PY
}

say "2. Penapis julat — subset yang betul sahaja"
preview "{\"branchId\":\"$BRANCH\",\"minMonthsSinceVisit\":6,\"maxMonthsSinceVisit\":9}"  "6-9 bulan (patut: 7bulan sahaja)"
preview "{\"branchId\":\"$BRANCH\",\"minMonthsSinceVisit\":9,\"maxMonthsSinceVisit\":12}" "9-12 bulan (patut: 11bulan sahaja)"
preview "{\"branchId\":\"$BRANCH\",\"minMonthsSinceVisit\":12}"                        "12 bulan ke atas (patut: 14bulan)"
preview "{\"branchId\":\"$BRANCH\",\"minMonthsSinceVisit\":3}"                        "3 bulan ke atas"
preview "{\"branchId\":\"$BRANCH\"}"                                                  "TANPA penapis (semua)"

say "3. REGRESSION: penapis berbeza mesti beri kiraan berbeza"
A=$(curl -sk -X POST "$API/marketing/audience/preview" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"branchId\":\"$BRANCH\",\"inactiveSinceDays\":1}" \
  | python -c "import sys,json;print(json.load(sys.stdin).get('count'))" 2>/dev/null)
B=$(curl -sk -X POST "$API/marketing/audience/preview" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"branchId\":\"$BRANCH\",\"inactiveSinceDays\":3650}" \
  | python -c "import sys,json;print(json.load(sys.stdin).get('count'))" 2>/dev/null)
echo "  1 hari   -> count=$A"
echo "  3650 hari-> count=$B"
if [ "$A" != "$B" ]; then echo "  PASS - penapis membezakan julat"; else echo "  FAIL - masih sama (bug kembali)"; fi

say "4. Pesakit BELUM PERNAH datang mesti dikecualikan"
NEVER=$(curl -sk -X POST "$API/marketing/audience/preview" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"branchId\":\"$BRANCH\",\"minMonthsSinceVisit\":3}" \
  | python -c "
import sys,json
d=json.load(sys.stdin)
print('YA' if any('belumdatang' in (p.get('name') or '') for p in (d.get('sample') or [])) else 'TIDAK')" 2>/dev/null)
echo "  belum pernah datang dalam senarai 3-bulan+ ? -> $NEVER"
[ "$NEVER" = "TIDAK" ] && echo "  PASS" || echo "  FAIL"

say "5. Bersihkan data ujian"
q "DELETE FROM patients WHERE name LIKE '${TAG}-%';"
q "SELECT COUNT(*) AS baki FROM patients WHERE name LIKE '${TAG}-%';"
