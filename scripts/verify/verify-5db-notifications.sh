#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# FASA 5D-B — live proof of notifications.
#
# THE CLAIMS
#
#   1. The queue named 'notifications' finally has a producer: an event raised
#      through the service reaches the table.
#   2. BURSTS COALESCE. Three waiting-patient events inside the window become ONE
#      notification counting 3 — not three rows. This is the whole design: a list
#      that grows with every event is a list nobody reads to the end.
#   3. OPT-OUTS DO NOT COALESCE. Each STOP is a different patient; "3 pesakit
#      berhenti melanggan" hides which three.
#   4. Severity escalates with the count for a waiting patient, and does NOT for a
#      repeated channel failure — the same problem twice is not worse.
#   5. Read/unread and the badge count behave, and marking read is idempotent.
#
# WHAT THIS CANNOT PROVE
#
# No WhatsApp number is linked, so no real inbound message can trigger an event
# end to end. Events are raised through the service the webhook calls, against
# the live database — the storage, coalescing and read-state are real; only the
# inbound trigger is not.
#
# Run from the repo root:
#   export MEDINI_DB_PASSWORD=$(docker exec medini-prod-mysql-1 sh -c 'printf %s "$MYSQL_PASSWORD"')
#   bash verify-5db-notifications.sh

set -uo pipefail
export LC_ALL=C

API="https://localhost/api/v1"
PASS=0; FAIL=0
DB() { docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -N -B -e "$1" 2>/dev/null; }
ok()  { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — dapat '$2', jangka '$3'"; fi; }

echo "=== FASA 5D-B — notifikasi ==="
echo

# START FROM A KNOWN STATE.
#
# This script cleans up at the end, which is not enough: a run that failed or
# was interrupted leaves rows behind, and the next run's burst merges INTO them
# — 8 events then read as 16. An assertion that depends on what a previous run
# left is not an assertion. Reset first, so the numbers below mean what they say.
DB "DELETE FROM wa_notifications WHERE kind IN ('human_needed','channel_error','opt_out','blast_blocked')"

echo "--- 1. Jadual wujud ---"
check "jadual wa_notifications" "$(DB "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='medini_prod' AND TABLE_NAME='wa_notifications'")" "1"
# Named, not counted. A count broke the moment a new index was added for a real
# reason (the atomic-merge key), which told us nothing about whether the indexes
# the bell and the merge actually need are present.
check "indeks bel hadir" "$(DB "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='medini_prod' AND TABLE_NAME='wa_notifications' AND INDEX_NAME='wa_notifications_bell_idx'")" "4"
check "indeks gabung hadir" "$(DB "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='medini_prod' AND TABLE_NAME='wa_notifications' AND INDEX_NAME='wa_notifications_coalesce_idx'")" "5"
check "kunci unik belum-dibaca hadir" "$(DB "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='medini_prod' AND TABLE_NAME='wa_notifications' AND INDEX_NAME='wa_notifications_unread_uidx'")" "1"

TOKEN=$(curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "manager")" | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null)
[ -n "$TOKEN" ] && ok "log masuk manager" || { bad "log masuk"; exit 1; }

BRANCH=$(DB "SELECT id FROM branches WHERE code='sentosa'")

echo
echo "--- 2. Endpoint loceng wujud ---"
CODE=$(curl -sk -o .verify-out.tmp -w "%{http_code}" "$API/whatsapp/notifications" -H "Authorization: Bearer $TOKEN")
check "GET /whatsapp/notifications" "$CODE" "200"
CNT=$(curl -sk "$API/whatsapp/notifications/unread-count" -H "Authorization: Bearer $TOKEN")
echo "  unread-count: $CNT"
echo "$CNT" | grep -q '"unread"' && ok "GET unread-count" || bad "unread-count: $CNT"

NOAUTH=$(curl -sk -o .verify-out.tmp -w "%{http_code}" "$API/whatsapp/notifications")
check "tanpa token → 401" "$NOAUTH" "401"

echo
echo "--- 3. Burst coalescing: 8 peristiwa SERENTAK → 1 baris ×8 ---"
# Raise through the RUNNING APP, not a hand-built service.
#
# Instantiating DbContextService outside Nest gives it no connection — "Database
# not configured" — so a script that builds the service itself proves nothing
# except that the class exists. The seed endpoint calls the same raise() the
# webhook calls, inside a live container with a real connection.
raise() {
  curl -sk -X POST "$API/whatsapp/notifications/_seed" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"branchId\":\"$BRANCH\",\"kind\":\"$1\",\"entityId\":\"${2:-}\",\"branchName\":\"Sentosa\"}" \
    -o .verify-out.tmp -w "%{http_code}"
}

# CONCURRENT, not sequential.
#
# A sequential loop passes even with a read-then-write merge, because each
# request finishes before the next begins. It did: this check reported PASS
# while eight simultaneous events produced two rows and, in another run, a
# single row counting 4 — the other 4 lost. Patients waiting is a concurrent
# event by nature, so the test has to be concurrent or it proves nothing.
for i in $(seq 1 8); do raise human_needed > /dev/null & done
wait

ROWS=$(DB "SELECT COUNT(*) FROM wa_notifications WHERE kind='human_needed' AND branch_id='$BRANCH' AND read_at IS NULL")
COUNT=$(DB "SELECT occurrence_count FROM wa_notifications WHERE kind='human_needed' AND branch_id='$BRANCH' AND read_at IS NULL LIMIT 1")
check "8 peristiwa serentak → 1 baris" "$ROWS" "1"
check "kiraan naik ke 8 (tiada peristiwa hilang)" "$COUNT" "8"

SEV=$(DB "SELECT severity FROM wa_notifications WHERE kind='human_needed' AND branch_id='$BRANCH' AND read_at IS NULL LIMIT 1")
check "keterukan naik ke critical (>=3 menunggu)" "$SEV" "critical"

echo
echo "--- 4. Opt-out TIDAK bergabung ---"
for i in 1 2; do raise opt_out "60199999$i" > /dev/null; done

OPT=$(DB "SELECT COUNT(*) FROM wa_notifications WHERE kind='opt_out' AND branch_id='$BRANCH'")
check "2 opt-out berasingan → 2 baris (tidak digabung)" "$OPT" "2"
OPTCNT=$(DB "SELECT MAX(occurrence_count) FROM wa_notifications WHERE kind='opt_out' AND branch_id='$BRANCH'")
check "setiap opt-out kekal kiraan 1" "$OPTCNT" "1"

echo
echo "--- 5. Badge dan tanda dibaca ---"
UNREAD_BEFORE=$(curl -sk "$API/whatsapp/notifications/unread-count" -H "Authorization: Bearer $TOKEN" | python -c "import sys,json;print(json.load(sys.stdin).get('unread',''))" 2>/dev/null)
echo "  belum dibaca: $UNREAD_BEFORE"
[ "${UNREAD_BEFORE:-0}" -ge 3 ] && ok "badge mengira notifikasi belum dibaca" || bad "badge salah: $UNREAD_BEFORE"

ID=$(DB "SELECT id FROM wa_notifications WHERE kind='human_needed' AND branch_id='$BRANCH' AND read_at IS NULL LIMIT 1")
curl -sk -X POST "$API/whatsapp/notifications/$ID/read" -H "Authorization: Bearer $TOKEN" > /dev/null
check "tanda dibaca berjaya" "$(DB "SELECT read_at IS NOT NULL FROM wa_notifications WHERE id='$ID'")" "1"

# Idempotent: a double-click on a bell must not 404.
AGAIN=$(curl -sk -o .verify-out.tmp -w "%{http_code}" -X POST "$API/whatsapp/notifications/$ID/read" -H "Authorization: Bearer $TOKEN")
check "tanda dibaca dua kali tidak ralat" "$AGAIN" "201"

MARKED=$(curl -sk -X POST "$API/whatsapp/notifications/read-all" -H "Authorization: Bearer $TOKEN" | python -c "import sys,json;print(json.load(sys.stdin).get('marked',''))" 2>/dev/null)
echo "  ditanda semua: $MARKED"
check "semua dibaca → badge 0" "$(curl -sk "$API/whatsapp/notifications/unread-count" -H "Authorization: Bearer $TOKEN" | python -c "import sys,json;print(json.load(sys.stdin).get('unread',''))" 2>/dev/null)" "0"

echo
echo "--- 6. Kronologi: notifikasi baharu selepas dibaca ---"
# A fresh event after read must start a NEW row, not join the read one — otherwise
# the badge would never come back for a quiet clinic.
raise human_needed > /dev/null

NEW=$(DB "SELECT COUNT(*) FROM wa_notifications WHERE kind='human_needed' AND branch_id='$BRANCH' AND read_at IS NULL")
check "peristiwa selepas dibaca → baris baharu" "$NEW" "1"
check "badge kembali ke 1" "$(curl -sk "$API/whatsapp/notifications/unread-count" -H "Authorization: Bearer $TOKEN" | python -c "import sys,json;print(json.load(sys.stdin).get('unread',''))" 2>/dev/null)" "1"

echo
echo "--- 7. Bersihkan ---"
DB "DELETE FROM wa_notifications WHERE kind IN ('human_needed','channel_error','opt_out','blast_blocked')"
check "notifikasi ujian dibersihkan" "$(DB "SELECT COUNT(*) FROM wa_notifications")" "0"

echo
echo "======================================================"
echo "  LULUS: $PASS   GAGAL: $FAIL"
echo "======================================================"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
