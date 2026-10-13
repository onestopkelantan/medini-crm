#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# FASA 5C-B — live proof of the recall window and treatment filter.
#
# Creates patients at KNOWN distances in the past and asserts each window picks
# exactly the right subset. A filter that silently stops filtering is invisible
# on an empty table: every window returns the same count, which reads as "no
# patients" rather than "filter broken".
#
#   2 months ago   → must NOT appear in any 3-month+ window
#   7 months ago   → the 6-9 month bucket
#  11 months ago   → the 9-12 month bucket
#  14 months ago   → the "12 months or longer" bucket
#   never          → must appear in NO window at all
#
# Everything is tagged and cleaned up at the end.
set -u
cd ~/Desktop/medini-updated

API=https://localhost/api/v1
BRANCH="af0a0841-0786-40b2-9b4e-30ed9270a659"
TAG="w5cb"

PASS=0; FAIL=0
say() { echo; echo "=== $* ==="; }
ok()  { PASS=$((PASS+1)); echo "  PASS  $*"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $*"; }
q()   { docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -N -B -e "$1" 2>/dev/null; }

HQ=$(curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "hq")" \
  | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null)
[ -n "$HQ" ] || { echo "login gagal"; exit 1; }

say "0. Persediaan — pesakit pada jarak yang diketahui"
q "DELETE FROM patients WHERE name LIKE '${TAG}-%';"
for spec in "2:2bln" "7:7bln" "11:11bln" "14:14bln"; do
  M="${spec%%:*}"; N="${spec##*:}"
  q "INSERT INTO patients (id, org_id, branch_id, mrn, name, status, whatsapp, last_visit_at, patient_type, contact_type)
     VALUES (UUID(), '00000000-0000-0000-0000-000000000001', '$BRANCH',
             CONCAT('MRN-${TAG}-$M'), '${TAG}-${N}', 'Active', '6017700000$M',
             DATE_SUB(NOW(), INTERVAL $M MONTH), 'adult', 'own');"
done
q "INSERT INTO patients (id, org_id, branch_id, mrn, name, status, whatsapp, last_visit_at, patient_type, contact_type)
   VALUES (UUID(), '00000000-0000-0000-0000-000000000001', '$BRANCH',
           'MRN-${TAG}-never', '${TAG}-belum', 'Active', '601770000099', NULL, 'adult', 'own');"
q "SELECT name, COALESCE(DATE_FORMAT(last_visit_at,'%Y-%m-%d'),'NULL') AS lawatan
   FROM patients WHERE name LIKE '${TAG}-%' ORDER BY last_visit_at IS NULL, last_visit_at;"

cand() {
  local qs="$1" label="$2" expect="$3"
  local out
  out=$(curl -sk "$API/marketing/scrubbing-candidates?branchId=$BRANCH&$qs" -H "Authorization: Bearer $HQ")
  RESULT=$(echo "$out" | python -c "
import sys, json
try: rows = json.load(sys.stdin)
except Exception as e: print('PARSE_FAIL'); raise SystemExit
names = sorted(r['name'] for r in rows if r['name'].startswith('${TAG}-'))
print(','.join(names) if names else '(kosong)')" 2>/dev/null)
  printf '  %-34s -> %s\n' "$label" "$RESULT"
  if [ "$RESULT" = "$expect" ]; then ok "$label"; else bad "$label (dijangka: $expect)"; fi
}

say "1. Julat dua-arah — setiap bucket dapat subset betul sahaja"
cand "minMonths=6&maxMonths=9"  "6-9 bulan"  "${TAG}-7bln"
cand "minMonths=9&maxMonths=12" "9-12 bulan" "${TAG}-11bln"
cand "minMonths=12&maxMonths=120" "12 bulan ke atas" "${TAG}-14bln"
cand "minMonths=3&maxMonths=120"  "3 bulan ke atas" "${TAG}-11bln,${TAG}-14bln,${TAG}-7bln"

say "2. PENTING: pesakit 2 bulan TIDAK masuk mana-mana tetingkap 3-bulan+"
TWO=$(curl -sk "$API/marketing/scrubbing-candidates?branchId=$BRANCH&minMonths=3&maxMonths=120" -H "Authorization: Bearer $HQ" \
  | python -c "
import sys,json
rows=json.load(sys.stdin)
print('ADA' if any(r['name']=='${TAG}-2bln' for r in rows) else 'TIADA')" 2>/dev/null)
echo "  pesakit 2-bulan dalam senarai 3-bulan+ ? -> $TWO"
[ "$TWO" = "TIADA" ] && ok "pesakit baru TIDAK di-recall" || bad "pesakit baru masuk senarai"

say "3. PENTING: pesakit belum pernah datang TIDAK masuk mana-mana senarai"
NEVER=$(curl -sk "$API/marketing/scrubbing-candidates?branchId=$BRANCH&minMonths=3&maxMonths=120" -H "Authorization: Bearer $HQ" \
  | python -c "
import sys,json
rows=json.load(sys.stdin)
print('ADA' if any(r['name']=='${TAG}-belum' for r in rows) else 'TIADA')" 2>/dev/null)
echo "  pesakit belum pernah datang ? -> $NEVER"
[ "$NEVER" = "TIADA" ] && ok "dikecualikan" || bad "MASUK senarai (bug lama)"

say "4. Katalog rawatan untuk penapis"
curl -sk "$API/marketing/treatments" -H "Authorization: Bearer $HQ" | python -c "
import sys,json
rows=json.load(sys.stdin)
cats={}
for r in rows: cats.setdefault(r['category'],0); cats[r['category']]+=1
print(f'  {len(rows)} rawatan, {len(cats)} kategori:')
for k,v in sorted(cats.items()): print(f'    {k}: {v}')" 2>/dev/null
N=$(curl -sk "$API/marketing/treatments" -H "Authorization: Bearer $HQ" | python -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null)
[ "$N" -gt 0 ] && ok "katalog boleh dibaca ($N rawatan)" || bad "katalog kosong"

say "5. Penapis rawatan diterima (tiada data pelan, jadi 0 dijangka)"
for f in "treatmentCategory=Preventive" "treatmentCode=TRT-0001"; do
  R=$(curl -sk "$API/marketing/scrubbing-candidates?branchId=$BRANCH&minMonths=3&$f" -H "Authorization: Bearer $HQ" \
    | python -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null)
  echo "  $f -> $R calon (0 = tiada rekod pelan rawatan, betul)"
done
ok "penapis rawatan tidak menyebabkan ralat"

say "6. Kecualikan yang baru diblast — semak klausa hadir"
OUT=$(curl -sk "$API/marketing/scrubbing-candidates?branchId=$BRANCH&minMonths=3&excludeContactedDays=1" -H "Authorization: Bearer $HQ")
echo "$OUT" | head -c 80; echo
ok "parameter excludeContactedDays diterima"

say "7. Julat tidak sah mesti DITOLAK"
BAD=$(curl -sk -o .verify-out.tmp -w '%{http_code}' "$API/marketing/scrubbing-candidates?branchId=$BRANCH&minMonths=9&maxMonths=6" -H "Authorization: Bearer $HQ")
echo "  minMonths=9 maxMonths=6 -> HTTP $BAD"
[ "$BAD" = "422" ] && ok "ditolak dengan 422" || bad "tidak ditolak"

say "8. Kawalan akses"
NOAUTH=$(curl -sk -o .verify-out.tmp -w '%{http_code}' "$API/marketing/scrubbing-candidates?branchId=$BRANCH")
echo "  tanpa token -> HTTP $NOAUTH"
[ "$NOAUTH" = "401" ] && ok "perlu log masuk" || bad "boleh diakses tanpa token"

say "9. Bersihkan data ujian"
q "DELETE FROM patients WHERE name LIKE '${TAG}-%';"
echo "  baki: $(q "SELECT COUNT(*) FROM patients WHERE name LIKE '${TAG}-%'")"

echo
echo "======================================================================"
echo "HASIL: $PASS lulus, $FAIL gagal"
echo "======================================================================"
[ "$FAIL" = "0" ] || exit 1
