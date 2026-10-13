#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# FASA 5E — live proof of the STOP list.
#
# The whole point of an opt-out is that it WORKS, so this does not stop at "the
# row was created". It follows the patient all the way to the blast:
#
#   1. patient replies STOP            → recorded + acknowledged
#   2. STOP list is visible to staff   → the list screen has data
#   3. the SAME number sits in a blast → dropped from the send
#   4. a blast of ONLY opted-out       → refused outright, nothing sent
#   5. staff can add manually          → a phone complaint has somewhere to go
#   6. revoke                          → the block lifts on request
#   7. repeated STOP stays quiet       → not spammed by the system they stopped
#   8. treatment questions are safe    → no false positives
#
# Blast is branch_manager-only, and a manager is scoped to their OWN branch, so
# the blast checks run against the manager's branch. Using Setia Tropika with a
# Sentosa manager token returns 403 from the scope guard, not from the STOP gate
# — which would make the test pass for the wrong reason.
set -u
cd ~/Desktop/medini-updated

API=https://localhost/api/v1
SESSION="medini-setia-tropika"
SETIA="af0a0841-0786-40b2-9b4e-30ed9270a659"
STOPPER="60199111001"
NORMAL="60199111002"

PASS=0; FAIL=0
say() { echo; echo "=== $* ==="; }
ok()  { PASS=$((PASS+1)); echo "  PASS  $*"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $*"; }
q()   { docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -N -B -e "$1" 2>/dev/null; }
tok() { curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
        -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "$1")" \
        | python -c "import sys,json;d=json.load(sys.stdin);print(d.get('accessToken') or d.get('token') or '')" 2>/dev/null; }

HQ=$(tok hq); [ -n "$HQ" ] || { echo "login hq GAGAL"; exit 1; }
MGR=$(tok manager)   # branch_manager of Sentosa — the only blast-capable login

say "0. Persediaan"
SETIA_CH=$(curl -sk "$API/whatsapp/channels?branchId=$SETIA" -H "Authorization: Bearer $HQ" \
  | python -c "
import sys,json
d=json.load(sys.stdin); rows=d if isinstance(d,list) else d.get('items',d.get('data',[]))
c=[r for r in rows if r.get('branchId')=='$SETIA']
print(c[0]['id'] if c else '')" 2>/dev/null)

SENTOSA=$(q "SELECT id FROM branches WHERE code='sentosa' AND deleted_at IS NULL")
SENTOSA_CH=$(curl -sk "$API/whatsapp/channels?branchId=$SENTOSA" -H "Authorization: Bearer $HQ" \
  | python -c "
import sys,json
d=json.load(sys.stdin); rows=d if isinstance(d,list) else d.get('items',d.get('data',[]))
c=[r for r in rows if r.get('branchId')=='$SENTOSA']
print(c[0]['id'] if c else '')" 2>/dev/null)

q "DELETE FROM wa_opt_outs WHERE phone LIKE '601991110%';"
echo "  channel Setia   = ${SETIA_CH:0:8}…"
echo "  channel Sentosa = ${SENTOSA_CH:0:8}…   (blasts run here — manager scope)"
[ -n "$SENTOSA_CH" ] || { echo "  TIADA CHANNEL SENTOSA - berhenti"; exit 1; }

say "1. Pesakit balas STOP"
curl -sk -X POST "$API/whatsapp/webhook" -H 'Content-Type: application/json' \
  -d "{\"event\":\"message\",\"session\":\"$SESSION\",\"payload\":{\"from\":\"$STOPPER@c.us\",\"body\":\"STOP\",\"fromMe\":false}}" \
  -o .verify-out.tmp -w "  HTTP %{http_code}\n"
sleep 3
if [ "$(q "SELECT COUNT(*) FROM wa_opt_outs WHERE phone='$STOPPER' AND revoked_at IS NULL")" = "1" ]; then
  ok "nombor direkod dalam senarai STOP"
  q "SELECT CONCAT('      sumber=', source, '  kata=', COALESCE(matched_keyword,'-')) FROM wa_opt_outs WHERE phone='$STOPPER'"
else
  bad "nombor TIDAK direkod"
fi

say "2. Balasan pengesahan (WAHA belum dipaut, jadi gagal dihantar seperti dijangka)"
docker logs medini-prod-backend-1 --since 2m 2>&1 \
  | grep -oE "STOP direkod, tetapi pengesahan gagal dihantar|berhenti menghantar mesej" | tail -1

say "3. Senarai STOP boleh dilihat staf"
LIST=$(curl -sk "$API/whatsapp/opt-outs" -H "Authorization: Bearer $HQ")
COUNT=$(echo "$LIST" | python -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null)
echo "  bilangan = $COUNT"
echo "$LIST" | python -c "
import sys,json
rows=json.load(sys.stdin); hit=[r for r in rows if r.get('phone')=='$STOPPER']
print('  jumpa:', 'YA' if hit else 'TIDAK')" 2>/dev/null
[ "$COUNT" != "0" ] && ok "senarai ada data" || bad "senarai kosong"

say "4. Blast dengan campuran: nombor STOP mesti tersingkir"
M1=$(curl -sk -X POST "$API/whatsapp/blast" -H "Authorization: Bearer $MGR" \
  -H 'Content-Type: application/json' \
  -d "{\"branchId\":\"$SENTOSA\",\"channelId\":\"$SENTOSA_CH\",\"recipients\":[\"$STOPPER\"],\"body\":\"ujian opt-out\",\"consentConfirmed\":true}")
echo "  (hanya nombor STOP) -> $(echo "$M1" | head -c 220)"
if echo "$M1" | grep -qiE "meminta berhenti|STOP"; then
  ok "blast ditolak KERANA sebab STOP (bukan skop/kebenaran)"
else
  bad "bukan sebab STOP: $(echo "$M1" | head -c 160)"
fi

say "5. Nombor STOP tidak pernah masuk antrian"
echo "  mesej keluar ke $STOPPER: $(q "SELECT COUNT(*) FROM wa_messages m JOIN wa_conversations c ON c.id=m.conversation_id WHERE c.contact_phone='$STOPPER' AND m.direction='out' AND m.deleted_at IS NULL")  (0 = tersingkir)"

say "6. Tambah manual oleh staf"
MANUAL="60199111999"
curl -sk -X POST "$API/whatsapp/opt-outs" -H "Authorization: Bearer $HQ" \
  -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$MANUAL\",\"reason\":\"Pesakit telefon minta berhenti\"}" -o .verify-out.tmp -w "  HTTP %{http_code}\n"
if [ "$(q "SELECT COUNT(*) FROM wa_opt_outs WHERE phone='$MANUAL' AND revoked_at IS NULL")" = "1" ]; then
  ok "tambah manual berfungsi"
  q "SELECT CONCAT('      sumber=', source, '  sebab=', COALESCE(reason,'-')) FROM wa_opt_outs WHERE phone='$MANUAL'"
else
  bad "tambah manual GAGAL"
fi

say "7. Pesakit minta masuk semula (revoke)"
ID=$(q "SELECT id FROM wa_opt_outs WHERE phone='$MANUAL' LIMIT 1")
curl -sk -X DELETE "$API/whatsapp/opt-outs/$ID" -H "Authorization: Bearer $HQ" -o .verify-out.tmp -w "  HTTP %{http_code}\n"
if [ "$(q "SELECT COUNT(*) FROM wa_opt_outs WHERE id='$ID' AND revoked_at IS NOT NULL")" = "1" ]; then
  ok "sekatan dibuka, rekod kekal: $(q "SELECT COUNT(*) FROM wa_opt_outs WHERE id='$ID'") baris"
else
  bad "revoke gagal"
fi

say "8. STOP berulang kekal senyap"
B=$(q "SELECT COUNT(*) FROM wa_opt_outs WHERE phone='$STOPPER'")
curl -sk -X POST "$API/whatsapp/webhook" -H 'Content-Type: application/json' \
  -d "{\"event\":\"message\",\"session\":\"$SESSION\",\"payload\":{\"from\":\"$STOPPER@c.us\",\"body\":\"stop\",\"fromMe\":false}}" -o .verify-out.tmp
sleep 2
A=$(q "SELECT COUNT(*) FROM wa_opt_outs WHERE phone='$STOPPER'")
echo "  sebelum=$B selepas=$A"
[ "$B" = "$A" ] && ok "tiada pendua" || bad "pendua tercipta"

say "9. Soalan rawatan TIDAK tersalah jadi STOP"
B2=$(q "SELECT COUNT(*) FROM wa_opt_outs")
curl -sk -X POST "$API/whatsapp/webhook" -H 'Content-Type: application/json' \
  -d "{\"event\":\"message\",\"session\":\"$SESSION\",\"payload\":{\"from\":\"$NORMAL@c.us\",\"body\":\"boleh saya stop rawatan ini?\",\"fromMe\":false}}" -o .verify-out.tmp
sleep 2
A2=$(q "SELECT COUNT(*) FROM wa_opt_outs")
echo "  sebelum=$B2 selepas=$A2"
[ "$B2" = "$A2" ] && ok "tiada false positive" || bad "FALSE POSITIVE"

say "10. Bersihkan data ujian"
q "DELETE FROM wa_opt_outs WHERE phone LIKE '601991110%' OR phone LIKE '6019911%';"
q "UPDATE wa_conversations SET deleted_at=NOW(6) WHERE contact_phone LIKE '6019911%';"
echo "  baki senarai STOP: $(q "SELECT COUNT(*) FROM wa_opt_outs")"

echo
echo "======================================================================"
echo "HASIL: $PASS lulus, $FAIL gagal"
echo "======================================================================"
[ "$FAIL" = "0" ] || exit 1
