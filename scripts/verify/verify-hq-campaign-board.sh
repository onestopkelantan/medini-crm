#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# WhatsApp Campaign — papan pemantauan HQ.
#
# THE CLAIM
#
#   HQ watches, branches send. HQ sees every branch side by side so a meeting can
#   ask "which branch is behind" — and gets an answer that includes the branch
#   that has run nothing at all.
#
# WHY THAT LAST PART MATTERS
#
#   A list built only from campaigns cannot show a branch with no campaigns. That
#   is exactly the row the meeting is about, so the board groups by branch and
#   keeps the empty ones.
#
# Run from the repo root:
#   export MEDINI_DB_PASSWORD=$(docker exec medini-prod-mysql-1 sh -c 'printf %s "$MYSQL_PASSWORD"')
#   bash verify-hq-campaign-board.sh

set -uo pipefail
export LC_ALL=C

API="https://localhost/api/v1"
PASS=0; FAIL=0
DB() { docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -N -B -e "$1" 2>/dev/null; }
ok()  { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — dapat '$2', jangka '$3'"; fi; }
tok() { curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "$1")" \
  | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null; }
py() { python -c "$1" 2>/dev/null; }

echo "=== WhatsApp Campaign — papan HQ ==="
echo

ORG=$(DB "SELECT org_id FROM branches WHERE code='sentosa'")
B1=$(DB "SELECT id FROM branches WHERE code='sentosa'")
B2=$(DB "SELECT id FROM branches WHERE code<>'sentosa' LIMIT 1")
C1=$(DB "SELECT id FROM wa_channels WHERE branch_id='$B1' LIMIT 1")
C2=$(DB "SELECT id FROM wa_channels WHERE branch_id='$B2' LIMIT 1")
TODAY=$(DB "SELECT CURDATE()")
ENDA=$(DB "SELECT DATE_ADD(CURDATE(), INTERVAL 13 DAY)")

HQ=$(tok hq)
MG=$(tok manager)
[ -n "$HQ" ] && ok "log masuk hq" || { bad "log masuk hq"; exit 1; }
[ -n "$MG" ] && ok "log masuk manager" || { bad "log masuk manager"; exit 1; }

echo
echo "--- 1. HQ nampak endpoint (sebelum ini dilontar, kerana guard) ---"
CODE=$(curl -sk -o .verify-out.tmp -w "%{http_code}" "$API/whatsapp/campaigns/progress" -H "Authorization: Bearer $HQ")
check "HQ GET campaigns/progress" "$CODE" "200"
NOAUTH=$(curl -sk -o .verify-out.tmp -w "%{http_code}" "$API/whatsapp/campaigns/progress")
check "tanpa token → 401" "$NOAUTH" "401"

echo
echo "--- 2. Data ujian: 2 kempen, 2 cawangan berbeza ---"
DB "DELETE FROM wa_blast_campaigns WHERE name LIKE 'UJIAN-%'"
DB "INSERT INTO wa_blast_campaigns (id,org_id,branch_id,channel_id,batch_id,name,status,total_count,sent_count,body,window_start_hour,window_end_hour,per_day,start_date,end_date)
    VALUES (UUID(),'$ORG','$B1','$C1','UJI-A','UJIAN-Merdeka','running',1400,842,'t',8,22,100,'$TODAY','$ENDA')"
DB "INSERT INTO wa_blast_campaigns (id,org_id,branch_id,channel_id,batch_id,name,status,total_count,sent_count,body,window_start_hour,window_end_hour,per_day,start_date,end_date)
    VALUES (UUID(),'$ORG','$B2','$C2','UJI-B','UJIAN-Raya','running',400,400,'t',8,22,100,'$TODAY','$ENDA')"
check "2 kempen dicipta" "$(DB "SELECT COUNT(*) FROM wa_blast_campaigns WHERE name LIKE 'UJIAN-%'")" "2"

echo
echo "--- 3. HQ nampak SEMUA cawangan ---"
N=$(curl -sk "$API/whatsapp/campaigns/progress" -H "Authorization: Bearer $HQ" \
  | py "import sys,json;print(len(json.load(sys.stdin)['campaigns']))")
check "HQ nampak 2 kempen (2 cawangan)" "$N" "2"

echo
echo "--- 4. Manager nampak CAWANGAN SENDIRI sahaja ---"
M=$(curl -sk "$API/whatsapp/campaigns/progress" -H "Authorization: Bearer $MG" \
  | py "import sys,json;d=json.load(sys.stdin);print(len(d['campaigns']))")
check "manager nampak 1 kempen" "$M" "1"

MNAME=$(curl -sk "$API/whatsapp/campaigns/progress" -H "Authorization: Bearer $MG" \
  | py "import sys,json;d=json.load(sys.stdin);print(d['campaigns'][0]['name'] if d['campaigns'] else '')")
check "dan ia kempen cawangannya" "$MNAME" "UJIAN-Merdeka"

echo
echo "--- 5. branchId dikembalikan (papan perlu ia untuk kumpulkan ikut cawangan) ---"
HAS=$(curl -sk "$API/whatsapp/campaigns/progress" -H "Authorization: Bearer $HQ" \
  | py "import sys,json;d=json.load(sys.stdin);print('yes' if all('branchId' in c for c in d['campaigns']) else 'no')")
check "setiap kempen ada branchId" "$HAS" "yes"

DIFF=$(curl -sk "$API/whatsapp/campaigns/progress" -H "Authorization: Bearer $HQ" \
  | py "import sys,json;d=json.load(sys.stdin);print(len({c['branchId'] for c in d['campaigns']}))")
check "2 cawangan berbeza dalam data" "$DIFF" "2"

echo
echo "--- 6. Manager TIDAK boleh menipu dengan ?branchId= cawangan lain ---"
# Stronger than expected: the request is REFUSED with 403, not silently filtered
# to an empty list. A silent empty result would leave the operator wondering
# whether the branch has no campaigns or they lack access; a refusal says which.
LEAK=$(curl -sk -o .verify-out.tmp -w "%{http_code}" "$API/whatsapp/campaigns/progress?branchId=$B2" -H "Authorization: Bearer $MG")
check "manager tanya cawangan lain → 403 ditolak" "$LEAK" "403"

# And its own branch still works through the same parameter.
OWN=$(curl -sk -o .verify-out.tmp -w "%{http_code}" "$API/whatsapp/campaigns/progress?branchId=$B1" -H "Authorization: Bearer $MG")
check "manager tanya cawangan sendiri → 200" "$OWN" "200"

echo
echo "--- 7. HQ masih TIDAK boleh blast (papan bukan borang) ---"
BL=$(curl -sk -o .verify-out.tmp -w "%{http_code}" -X POST "$API/whatsapp/blast" \
  -H "Authorization: Bearer $HQ" -H 'Content-Type: application/json' \
  -d '{"branchId":"'"$B1"'","numbers":["60123456789"],"body":"test","consentConfirmed":true}')
check "HQ POST /whatsapp/blast ditolak" "$BL" "403"

echo
echo "--- 8. Manager masih BOLEH blast (tiada regresi) ---"
# Gate sebenar: nombor dalam senarai STOP, atau channel tak 'working'. Kita uji
# bahawa ia TIDAK ditolak dengan 403 (kebenaran lulus); status lain bermakna ia
# sampai ke perniagaan-blok, yang membuktikan kebenaran berjaya.
MB=$(curl -sk -o .verify-out.tmp -w "%{http_code}" -X POST "$API/whatsapp/blast" \
  -H "Authorization: Bearer $MG" -H 'Content-Type: application/json' \
  -d '{"branchId":"'"$B1"'","numbers":["60123456789"],"body":"test","consentConfirmed":true}')
[ "$MB" != "403" ] && ok "manager tidak ditolak kebenaran ($MB)" || bad "manager ditolak 403 — REGRESI"

echo
echo "--- 9. Ringkasan papan ---"
SUM=$(curl -sk "$API/whatsapp/campaigns/progress" -H "Authorization: Bearer $HQ" \
  | py "import sys,json;d=json.load(sys.stdin);print('yes' if 'summary' in d and 'behindCount' in d else 'no')")
check "ada summary + behindCount" "$SUM" "yes"

echo
echo "--- 10. Bersihkan ---"
DB "DELETE FROM wa_blast_campaigns WHERE name LIKE 'UJIAN-%'"
check "data ujian dibersihkan" "$(DB "SELECT COUNT(*) FROM wa_blast_campaigns WHERE name LIKE 'UJIAN-%'")" "0"

echo
echo "======================================================"
echo "  LULUS: $PASS   GAGAL: $FAIL"
echo "======================================================"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
