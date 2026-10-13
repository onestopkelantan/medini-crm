#!/usr/bin/env bash
# FASA 5A-fix live check: does the webhook route by session name?
#
# Before the fix every message went to one hard-coded branch. Now the session
# name decides, and an unmapped session must be REFUSED rather than guessed.
set -u
cd ~/Desktop/medini-updated

post() {
  local session="$1" from="$2" body="$3"
  curl -sk -X POST https://localhost/api/v1/whatsapp/webhook \
    -H 'Content-Type: application/json' \
    -d "{\"event\":\"message\",\"session\":\"$session\",\"payload\":{\"from\":\"$from\",\"body\":\"$body\",\"fromMe\":false}}" \
    -o .verify-out.tmp -w "%{http_code}"
}

echo "=== 1. sesi TIDAK dipetakan mesti DITOLAK (bukan diteka) ==="
docker logs medini-prod-backend-1 --since 1m > /tmp/before.log 2>&1 || true
CODE=$(post "sesi-hantu-tidak-wujud" "60111110001@c.us" "ujian sesi tak dikenali")
echo "  HTTP $CODE"
sleep 3
if docker logs medini-prod-backend-1 --since 2m 2>&1 | grep -q "tidak dipetakan kepada cawangan"; then
  echo "  PASS - ditolak dengan amaran jelas:"
  docker logs medini-prod-backend-1 --since 2m 2>&1 | grep -o 'Webhook diabaikan[^"]*' | tail -1 | sed 's/^/    /'
else
  echo "  FAIL - tiada amaran"
fi

echo
echo "=== 2. sesi yang DIPETAKAN mesti diterima ==="
CODE=$(post "medini-setia-tropika" "60111110002@c.us" "ujian routing setia tropika")
echo "  HTTP $CODE"
sleep 3
if docker logs medini-prod-backend-1 --since 1m 2>&1 | grep -q "Webhook diabaikan.*medini-setia-tropika"; then
  echo "  FAIL - sesi sah ditolak"
else
  echo "  PASS - sesi sah diterima (tiada 'diabaikan' untuknya)"
fi

echo
echo "=== 3. branch yang diselesaikan dalam log ==="
docker logs medini-prod-backend-1 --since 3m 2>&1 | grep -oE '"(branch|org)Id":"[^"]*"' | sort -u | head -6 | sed 's/^/    /'

echo
echo "=== 4. tiada mesej keluar ke WhatsApp sebenar ==="
N=$(docker logs medini-prod-backend-1 --since 3m 2>&1 | grep -c "sendText")
echo "  sendText = $N  (0 = selamat)"
