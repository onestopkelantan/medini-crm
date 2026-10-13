#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# Prove side-by-side branch isolation between two branches that BOTH have a
# channel. (Setia Tropika has no number yet by design, so it correctly refuses.)
set -u
cd ~/Desktop/medini-updated

API=https://localhost/api/v1
WEBHOOK=$API/whatsapp/webhook
SENTOSA_ID=$(docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -N -B \
  -e "SELECT id FROM branches WHERE code='sentosa' AND deleted_at IS NULL" 2>/dev/null | tr -d '\r')
BUKIT_ID="39fef961-bd9d-4ee9-9a6b-eb38ecf819e2"

say() { echo; echo "=== $* ==="; }
echo "Sentosa branch id: $SENTOSA_ID"

TOKEN=$(curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "hq")" \
  | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null)

say "1. Kenapa Setia Tropika ditolak (patut LAPOR, bukan senyap)"
docker logs medini-prod-backend-1 --since 5m 2>&1 | grep -oE 'Channel WhatsApp tiada untuk branch [a-f0-9-]*' | tail -1

say "2. Cipta channel untuk Sentosa melalui API produk"
curl -sk -X POST "$API/whatsapp/channels" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"branchId\":\"$SENTOSA_ID\",\"phone\":\"60177770001\",\"sessionName\":\"medini-sentosa\"}" | head -c 250
echo

say "3. Hantar mesej pada sesi DUA branch berbeza"
for spec in "medini-bukit-indah:60144440001" "medini-sentosa:60144440002"; do
  S="${spec%%:*}"; N="${spec##*:}"
  CODE=$(curl -sk -X POST "$WEBHOOK" -H 'Content-Type: application/json' \
    -d "{\"event\":\"message\",\"session\":\"$S\",\"payload\":{\"from\":\"$N@c.us\",\"body\":\"ujian pengasingan dua branch\",\"fromMe\":false}}" \
    -o .verify-out.tmp -w '%{http_code}')
  echo "  $S -> HTTP $CODE"
done
sleep 6

say "4. PENGASINGAN: perbualan di branch MANA?"
docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -e "
SELECT b.short_name AS cawangan, c.contact_phone AS pesakit
FROM wa_conversations c JOIN branches b ON b.id=c.branch_id
WHERE c.contact_phone IN ('60144440001','60144440002') AND c.deleted_at IS NULL;" 2>/dev/null

say "5. Mesej tersimpan di perbualan yang betul?"
docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -e "
SELECT b.short_name AS cawangan, LEFT(m.body,32) AS mesej
FROM wa_messages m
JOIN wa_conversations c ON c.id=m.conversation_id
JOIN branches b ON b.id=c.branch_id
WHERE m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 4;" 2>/dev/null

say "6. Keselamatan"
echo "  sendText = $(docker logs medini-prod-backend-1 --since 5m 2>&1 | grep -c 'sendText')  (0 = selamat)"
