#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# FASA 5A-fix — full branch-isolation proof.
#
# Creates a real channel for a second branch THROUGH THE PRODUCT'S OWN API (not
# by hand-editing the database), then sends a message on each branch's session and
# shows they land in two different branches with two different prompts.
#
# This is the end-to-end version: if the channel cannot be created via the API,
# an operator could never onboard a branch either.
set -u
cd ~/Desktop/medini-updated

API=https://localhost/api/v1
WEBHOOK=$API/whatsapp/webhook
SETIA_ID="af0a0841-0786-40b2-9b4e-30ed9270a659"
BUKIT_ID="39fef961-bd9d-4ee9-9a6b-eb38ecf819e2"

say() { echo; echo "=== $* ==="; }

TOKEN=$(curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "hq")" \
  | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null)
[ -n "$TOKEN" ] && echo "login OK" || { echo "login GAGAL"; exit 1; }

say "1. Cipta channel Bukit Indah melalui API produk (QR flow)"
curl -sk -X POST "$API/whatsapp/channels" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"branchId\":\"$BUKIT_ID\",\"phone\":\"60122220099\",\"sessionName\":\"medini-bukit-indah\"}" \
  | head -c 300
echo

say "2. Senarai channel sekarang"
docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -e "
SELECT b.short_name AS cawangan, c.session_name, c.status
FROM wa_channels c JOIN branches b ON b.id=c.branch_id
WHERE c.deleted_at IS NULL ORDER BY b.short_name;" 2>/dev/null

say "3. Hantar mesej pada SESI setiap branch"
for spec in "medini-setia-tropika:60133330001" "medini-bukit-indah:60133330002"; do
  S="${spec%%:*}"; N="${spec##*:}"
  CODE=$(curl -sk -X POST "$WEBHOOK" -H 'Content-Type: application/json' \
    -d "{\"event\":\"message\",\"session\":\"$S\",\"payload\":{\"from\":\"$N@c.us\",\"body\":\"ujian pengasingan\",\"fromMe\":false}}" \
    -o .verify-out.tmp -w '%{http_code}')
  echo "  $S -> HTTP $CODE"
done
sleep 5

say "4. Perbualan mendarat di branch MANA?"
docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -e "
SELECT b.short_name AS cawangan, c.contact_phone AS pesakit
FROM wa_conversations c JOIN branches b ON b.id=c.branch_id
WHERE c.contact_phone IN ('60133330001','60133330002') AND c.deleted_at IS NULL;" 2>/dev/null

say "5. Prompt per branch (mesti berbeza)"
docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -e "
SELECT b.short_name AS cawangan, COUNT(p.slot) AS slot, MAX(p.is_active) AS ada_aktif
FROM branches b LEFT JOIN whatsapp_bot_prompts p ON p.branch_id=b.id AND p.deleted_at IS NULL
WHERE b.id IN ('$SETIA_ID','$BUKIT_ID') GROUP BY b.id, b.short_name;" 2>/dev/null

say "6. Tiada mesej keluar ke WhatsApp sebenar"
echo "  sendText = $(docker logs medini-prod-backend-1 --since 3m 2>&1 | grep -c 'sendText')  (0 = selamat)"
