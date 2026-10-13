#!/usr/bin/env bash
# Prove webhook registration works end-to-end, then READ IT BACK.
#
# Uses the session that actually exists in WAHA (setia-tropika) because a PUT
# against a non-existent session correctly 404s — that check is itself useful but
# it does not prove storage. The read-back is the real assertion.
set -u
cd ~/Desktop/medini-updated

KEY=$(docker inspect waha-medini --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^WAHA_API_KEY=' | cut -d= -f2-)
SESSION="setia-tropika"
URL="http://medini-prod-backend-1:3000/api/v1/whatsapp/webhook"

echo "=== 1. daftar webhook pada sesi $SESSION ==="
docker exec waha-medini node -e "
fetch('http://localhost:3000/api/sessions/$SESSION', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'X-Api-Key': '$KEY' },
  body: JSON.stringify({ config: { webhooks: [{ url: '$URL', events: ['message'], retries: { attempts: 3, delaySeconds: 2 } }] } }),
}).then(async r => console.log('PUT ->', r.status, (await r.text()).slice(0, 160)))
  .catch(e => console.log('GAGAL:', e.message));
" 2>&1 | tail -3

echo
echo "=== 2. BACA BALIK (bukti sebenar tersimpan) ==="
docker exec waha-medini node -e "
fetch('http://localhost:3000/api/sessions/$SESSION', { headers: { 'X-Api-Key': '$KEY' } })
  .then(r => r.json())
  .then(j => {
    const hooks = (j && j.config && j.config.webhooks) || [];
    console.log('bilangan webhook:', hooks.length);
    hooks.forEach(h => console.log('  url =', h.url, '| events =', JSON.stringify(h.events)));
    console.log(hooks.some(h => h.url === '$URL') ? 'RESULT: PASS - webhook tersimpan' : 'RESULT: FAIL - tidak tersimpan');
  })
  .catch(e => console.log('GAGAL:', e.message));
" 2>&1 | tail -6

echo
echo "=== 3. sesi tidak wujud mesti ditolak (bukan senyap) ==="
docker exec waha-medini node -e "
fetch('http://localhost:3000/api/sessions/sesi-yang-tidak-wujud', {
  method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Api-Key': '$KEY' },
  body: JSON.stringify({ config: { webhooks: [] } }),
}).then(r => console.log('PUT sesi hantu ->', r.status, r.status === 404 ? '(betul)' : '(tak dijangka)'))
  .catch(e => console.log('GAGAL:', e.message));
" 2>&1 | tail -2
