#!/usr/bin/env bash
# Final 5A-fix proof.
#
# Earlier, Setia Tropika was correctly REFUSED because it had no channel. Now that
# every branch has one, the same message must be ACCEPTED and stored — that is the
# difference between "the routing is right" and "the branch actually works".
#
# Two branches are sent together to show isolation still holds.
set -u
cd ~/Desktop/medini-updated

WEBHOOK=https://localhost/api/v1/whatsapp/webhook
say() { echo; echo "=== $* ==="; }

say "1. Setia Tropika — dulu DITOLAK, sekarang mesti DITERIMA"
CODE=$(curl -sk -X POST "$WEBHOOK" -H 'Content-Type: application/json' \
  -d '{"event":"message","session":"medini-setia-tropika","payload":{"from":"60155550001@c.us","body":"harga cabut gigi anak 8 tahun","fromMe":false}}' \
  -o .verify-out.tmp -w '%{http_code}')
echo "  HTTP $CODE"

say "2. Pearl — cawangan kedua, serentak"
CODE=$(curl -sk -X POST "$WEBHOOK" -H 'Content-Type: application/json' \
  -d '{"event":"message","session":"medini-pearl","payload":{"from":"60155550002@c.us","body":"nak buat temujanji scaling","fromMe":false}}' \
  -o .verify-out.tmp -w '%{http_code}')
echo "  HTTP $CODE"

sleep 6

say "3. PENGASINGAN — setiap pesakit mendarat di cawangan betul"
docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -e "
SELECT b.short_name AS cawangan, c.contact_phone AS pesakit, LEFT(m.body,34) AS mesej
FROM wa_messages m
JOIN wa_conversations c ON c.id=m.conversation_id
JOIN branches b ON b.id=c.branch_id
WHERE c.contact_phone IN ('60155550001','60155550002')
ORDER BY b.short_name;" 2>/dev/null

say "4. Ada ralat 'Channel WhatsApp tiada' lagi?"
N=$(docker logs medini-prod-backend-1 --since 2m 2>&1 | grep -c 'Channel WhatsApp tiada')
echo "  bilangan = $N  (0 = setiap cawangan boleh simpan mesej)"

say "5. Sesi tak dikenali masih DITOLAK"
curl -sk -X POST "$WEBHOOK" -H 'Content-Type: application/json' \
  -d '{"event":"message","session":"sesi-hantu","payload":{"from":"60155550003@c.us","body":"ujian","fromMe":false}}' \
  -o .verify-out.tmp -w '  HTTP %{http_code}\n'
sleep 2
docker logs medini-prod-backend-1 --since 1m 2>&1 | grep -oE 'tidak dipetakan kepada cawangan' | tail -1 | sed 's/^/  ditolak: /'

say "6. Keselamatan"
echo "  sendText = $(docker logs medini-prod-backend-1 --since 3m 2>&1 | grep -c 'sendText')  (0 = selamat)"

say "7. Bersihkan data ujian"
docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -e "
UPDATE wa_conversations SET deleted_at=NOW(6) WHERE contact_phone LIKE '6015555%';
SELECT COUNT(*) AS perbualan_aktif FROM wa_conversations WHERE deleted_at IS NULL;" 2>/dev/null
