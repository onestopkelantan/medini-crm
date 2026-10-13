#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# FASA 5A-fix (b) — prove every branch is QR-ready.
#
# "Opened and ready to scan" means three things together, and all three are
# checked here because any one missing makes the Hub's Connect flow dead:
#   1. The branch has a channel row (otherwise the webhook refuses its messages).
#   2. The channel is in NEED_QR, not FAILED (invited to scan, not told it broke).
#   3. Generating a QR creates the WAHA session AND registers the webhook on it.
set -u
cd ~/Desktop/medini-updated

API=https://localhost/api/v1
SETIA_ID="af0a0841-0786-40b2-9b4e-30ed9270a659"

say() { echo; echo "=== $* ==="; }

say "1. Setiap cawangan ada channel + status need_qr"
docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -e "
SELECT COUNT(*) AS jumlah_cawangan,
       SUM(c.id IS NOT NULL) AS ada_channel,
       SUM(c.status='need_qr') AS sedia_scan,
       SUM(c.status='failed') AS rosak
FROM branches b LEFT JOIN wa_channels c ON c.branch_id=b.id AND c.deleted_at IS NULL
WHERE b.deleted_at IS NULL;" 2>/dev/null

say "2. Login hq"
TOKEN=$(curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "hq")" \
  | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null)
[ -n "$TOKEN" ] && echo "  login OK" || { echo "  GAGAL"; exit 1; }

say "3. Dapatkan channel Setia Tropika"
CH=$(curl -sk "$API/whatsapp/channels?branchId=$SETIA_ID" -H "Authorization: Bearer $TOKEN" \
  | python -c "
import sys,json
d=json.load(sys.stdin)
rows=d if isinstance(d,list) else d.get('items',d.get('data',[]))
c=[r for r in rows if r.get('branchId')=='$SETIA_ID']
print(c[0]['id'] if c else '')" 2>/dev/null)
echo "  channelId = $CH"

if [ -z "$CH" ]; then echo "  TIADA CHANNEL - berhenti"; exit 1; fi

say "4. Jana QR (ini patut cipta sesi WAHA + daftar webhook)"
curl -sk "$API/whatsapp/channels/$CH/qr" -H "Authorization: Bearer $TOKEN" | head -c 260
echo

sleep 3

say "5. Sesi WAHA tercipta?"
KEY=$(docker inspect waha-medini --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^WAHA_API_KEY=' | cut -d= -f2-)
docker exec waha-medini node -e "
fetch('http://localhost:3000/api/sessions',{headers:{'X-Api-Key':'$KEY'}})
 .then(r=>r.json())
 .then(j=>{ console.log('  jumlah sesi:', j.length);
   j.forEach(s=>console.log('   -', s.name, '|', s.status)); })
 .catch(e=>console.log('  GAGAL:', e.message));
" 2>&1 | tail -8

say "6. Webhook terdaftar pada sesi medini-setia-tropika? (baca balik)"
docker exec waha-medini node -e "
fetch('http://localhost:3000/api/sessions/medini-setia-tropika',{headers:{'X-Api-Key':'$KEY'}})
 .then(r=>r.json())
 .then(j=>{
   const h=(j&&j.config&&j.config.webhooks)||[];
   console.log('  webhook:', h.length);
   h.forEach(x=>console.log('   -', x.url, JSON.stringify(x.events)));
   console.log(h.length ? '  RESULT: PASS' : '  RESULT: FAIL - webhook tiada');
 })
 .catch(e=>console.log('  sesi belum wujud:', e.message));
" 2>&1 | tail -6

say "7. Log amaran pendaftaran webhook (kalau ada)"
docker logs medini-prod-backend-1 --since 2m 2>&1 | grep -oE 'Gagal daftar webhook[^"]*' | tail -2
echo "  (kosong = tiada masalah)"

say "8. Keselamatan"
echo "  sendText = $(docker logs medini-prod-backend-1 --since 3m 2>&1 | grep -c 'sendText')  (0 = selamat)"
