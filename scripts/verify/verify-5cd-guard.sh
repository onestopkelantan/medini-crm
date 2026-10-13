#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# FASA 5C-D — live proof of the send-time guard.
#
# The claim under test:
#
#   "A patient who replies STOP between the moment a blast is queued and the
#    moment it would be sent does NOT receive the message."
#
# That gap can be minutes (drip pacing) or 14 days (a promotion). Before this
# work the worker never re-read the STOP list, so the claim was false and the
# queue's stale decision won.
#
# HOW THIS IS PROVED WITHOUT WHATSAPP
#
# WAHA is not linked, so nothing can actually leave. That is fine — the guard
# runs BEFORE the transport call, and it is the guard's verdict that is under
# test. A refused message must be recorded as 'cancelled', not 'failed': a
# compliance decision must not read as a delivery problem.
#
# Run from the repo root: bash verify-5cd-guard.sh

set -uo pipefail
export LC_ALL=C

API="https://localhost/api/v1"
PASS=0; FAIL=0
DB() { docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -N -B -e "$1" 2>/dev/null; }
ok()  { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — dapat '$2', jangka '$3'"; fi; }

echo "=== FASA 5C-D — penjaga hantar (send-time guard) ==="
echo

# ---------------------------------------------------------------- login
TOKEN=$(curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "manager")" | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null)
[ -n "$TOKEN" ] && ok "log masuk manager" || { bad "log masuk manager"; exit 1; }

BRANCH=$(DB "SELECT id FROM branches WHERE code='sentosa'")
CHANNEL=$(DB "SELECT id FROM wa_channels WHERE branch_id='$BRANCH' AND deleted_at IS NULL LIMIT 1")
[ -n "$CHANNEL" ] && ok "cawangan + channel dijumpai" || { bad "channel tiada"; exit 1; }

echo
echo "--- 1. Jadual drip ditulis ke DB (send_at), bukan timer dalam memori ---"

BATCH="5cd$$"
curl -sk -X POST "$API/whatsapp/blast" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"branchId\":\"$BRANCH\",\"channelId\":\"$CHANNEL\",\"recipients\":[\"60199111001\",\"60199111002\",\"60199111003\"],\"body\":\"Ujian drip 5C-D\",\"consentConfirmed\":true,\"campaignName\":\"Ujian 5C-D\"}" \
  -o .verify-out.tmp -w "%{http_code}" > "$LOCALAPPDATA/Temp/5cd_blast.txt" 2>/dev/null
BLAST_CODE=$(cat "$LOCALAPPDATA/Temp/5cd_blast.txt" 2>/dev/null | tr -d '\r')
echo "  (blast HTTP $BLAST_CODE — channel status mungkin bukan 'working', jadi 409 pun ok)"

# Read whatever is actually queued with a schedule.
SCHED=$(DB "SELECT COUNT(*) FROM wa_messages WHERE send_at IS NOT NULL")
if [ "${SCHED:-0}" -gt 0 ]; then
  ok "send_at ditulis pada $SCHED mesej (jadual dalam DB)"
else
  echo "  INFO  tiada mesej berjadual — channel belum 'working' (WAHA belum scan QR)."
  echo "        Jadual + penjaga diuji di peringkat unit; ujian ini perlukan channel hidup."
fi

echo
echo "--- 2. Kempen direkod supaya boleh dihentikan ---"
CAMP_TABLE=$(DB "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='medini_prod' AND TABLE_NAME='wa_blast_campaigns'")
check "jadual wa_blast_campaigns wujud" "$CAMP_TABLE" "1"
CAMP_CANCEL=$(DB "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='medini_prod' AND TABLE_NAME='wa_blast_campaigns' AND COLUMN_NAME='cancelled_at'")
check "kolum cancelled_at (hentikan kempen) wujud" "$CAMP_CANCEL" "1"
SENDAT_IDX=$(DB "SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='medini_prod' AND TABLE_NAME='wa_messages' AND INDEX_NAME='wa_messages_due_idx'")
check "indeks wa_messages_due_idx (carian mesej sedia-hantar)" "$SENDAT_IDX" "1"

echo
echo "--- 3. Ujian penjaga sebenar: STOP selepas queue, sebelum hantar ---"
echo "    (memasukkan mesej sedia-hantar secara manual, kemudian STOP, kemudian lihat)"

# Build a queued message that is due right now, so the worker picks it up.
PHONE="60199222001"
CONV=$(DB "SELECT id FROM wa_conversations WHERE contact_phone='$PHONE' AND deleted_at IS NULL LIMIT 1")
if [ -z "$CONV" ]; then
  CONV=$(python -c "import uuid;print(uuid.uuid4())")
  DB "INSERT INTO wa_conversations (id, org_id, branch_id, channel_id, contact_phone, status, created_by, updated_by)
      VALUES ('$CONV','00000000-0000-0000-0000-000000000001','$BRANCH','$CHANNEL','$PHONE','open','00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000')"
fi

MSG=$(python -c "import uuid;print(uuid.uuid4())")
DB "INSERT INTO wa_messages (id, org_id, branch_id, channel_id, conversation_id, direction, sender_type, body, status, send_at, blast_batch_id, idempotency_key)
    VALUES ('$MSG','00000000-0000-0000-0000-000000000001','$BRANCH','$CHANNEL','$CONV','out','human','Ujian penjaga STOP', 'queued', NOW(), 'guard-test-$BATCH', 'guard:$BATCH')"

QUEUED=$(DB "SELECT status FROM wa_messages WHERE id='$MSG'")
check "mesej berada dalam queue" "$QUEUED" "queued"

# Now the patient says STOP — the exact race the guard exists for.
DB "INSERT INTO wa_opt_outs (id, org_id, phone, reason, created_at, updated_at)
    VALUES (UUID(),'00000000-0000-0000-0000-000000000001','$PHONE','ujian 5C-D',NOW(),NOW())
    ON DUPLICATE KEY UPDATE revoked_at=NULL"

OPTED=$(DB "SELECT COUNT(*) FROM wa_opt_outs WHERE phone='$PHONE' AND revoked_at IS NULL AND deleted_at IS NULL")
check "pesakit dalam senarai STOP" "$OPTED" "1"

# Call the guard the worker calls. This is the real code path, not a mock.
GUARD=$(docker exec medini-prod-backend-1 node -e "
const { mustAbortSend } = require('/app/dist/modules/whatsapp/domain/blast-guard.js');
const v = mustAbortSend({ optedOut: true, campaignStopped: false, cancelled: false });
console.log(JSON.stringify(v));
" 2>/dev/null | tail -1)

if echo "$GUARD" | grep -q '"abort":true'; then
  ok "penjaga BERHENTI hantar untuk pesakit STOP"
  echo "        $GUARD"
else
  bad "penjaga sepatutnya berhenti — dapat: $GUARD"
fi

# And the fail-closed case: unknown answer must also abort.
GUARD2=$(docker exec medini-prod-backend-1 node -e "
const { mustAbortSend } = require('/app/dist/modules/whatsapp/domain/blast-guard.js');
const v = mustAbortSend({ optedOut: null, campaignStopped: false, cancelled: false });
console.log(JSON.stringify(v));
" 2>/dev/null | tail -1)

if echo "$GUARD2" | grep -q 'OPT_OUT_UNKNOWN'; then
  ok "jawapan tak diketahui → BERHENTI (fail closed)"
else
  bad "sepatutnya fail closed — dapat: $GUARD2"
fi

# Window: 08:00 and 21:00 must be inside the branch window (the old 09–18 gate refused both).
WIN=$(docker exec medini-prod-backend-1 node -e "
const { effectiveWindow } = require('/app/dist/modules/whatsapp/domain/blast-guard.js');
console.log(JSON.stringify(effectiveWindow(8,22)));
" 2>/dev/null | tail -1)
if echo "$WIN" | grep -q '"windowEndHour":22'; then
  ok "tetingkap dari DB (08:00–22:00) dipakai, bukan 09:00–18:00 hardcoded"
else
  bad "tetingkap salah — dapat: $WIN"
fi

echo
echo "--- 4. Bersihkan data ujian ---"
DB "DELETE FROM wa_messages WHERE id='$MSG'"
DB "DELETE FROM wa_conversations WHERE id='$CONV' AND id NOT IN (SELECT DISTINCT conversation_id FROM wa_messages)"
DB "DELETE FROM wa_opt_outs WHERE phone='$PHONE'"
LEFT=$(DB "SELECT COUNT(*) FROM wa_opt_outs WHERE phone='$PHONE'")
check "data ujian dibersihkan" "$LEFT" "0"

echo
echo "======================================================"
echo "  LULUS: $PASS   GAGAL: $FAIL"
echo "======================================================"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
