#!/usr/bin/env bash
# Verify the silent-failure fix: an inbound message with no channel row must now
# be REPORTED in the logs instead of vanishing without a trace.
set -u
cd ~/Desktop/medini-updated

BODY='{"event":"message","payload":{"from":"60199999999@c.us","body":"ujian lapor","fromMe":false}}'

echo "=== hantar mesej ujian ==="
curl -sk -X POST https://localhost/api/v1/whatsapp/webhook \
  -H 'Content-Type: application/json' \
  -d "$BODY" -o .verify-out.tmp -w "  HTTP %{http_code}\n"

sleep 4

echo "=== log: adakah ralat DILAPORKAN (bukan senyap)? ==="
if docker logs medini-prod-backend-1 --since 2m 2>&1 | grep -q "Channel WhatsApp tiada"; then
  echo "  PASS - ralat dilaporkan dengan jelas:"
  docker logs medini-prod-backend-1 --since 2m 2>&1 | grep -o "Channel WhatsApp tiada untuk branch[^\"]*" | head -1 | sed 's/^/    /'
else
  echo "  FAIL - masih senyap"
fi

echo
echo "=== pastikan tiada mesej keluar ke WhatsApp sebenar ==="
N=$(docker logs medini-prod-backend-1 --since 3m 2>&1 | grep -c "sendText")
echo "  sendText calls = $N  (0 = selamat)"
