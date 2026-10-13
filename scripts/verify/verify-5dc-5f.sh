#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# FASA 5D-C (SLA) + 5F (campaign schedule) — live proof.
#
# THE CLAIMS
#
#   SLA
#     1. A conversation waiting longer than the branch limit is reported as
#        breached, and the wait is measured from the PATIENT's message — not from
#        when the AI gave up.
#     2. The board sorts longest-wait-first. This is the feature: a newest-first
#        inbox sinks the person who has waited longest.
#     3. Once somebody replies, the clock stops and the conversation drops out of
#        the waiting count.
#     4. The limit is a per-branch setting, and is reported with the board so the
#        screen cannot measure against one number and breach against another.
#
#   CAMPAIGN SCHEDULE
#     5. 1400 over 14 days is accepted at 100/day.
#     6. 1400 over 7 days is REFUSED — 200/day exceeds the number's ceiling —
#        and the refusal carries the arithmetic.
#     7. An end date before the start is refused.
#     8. Progress reports day N of M, and calls a campaign behind only against
#        the plan (300/1400 is fine on day 3, behind on day 13).
#
# WHAT THIS CANNOT PROVE
#
# No WhatsApp number is linked, so no real inbound message arrives. Conversations
# are inserted directly against the live database and the board is read through
# the running API — the measurement, ordering and limits are real; the inbound
# trigger is not.
#
# Run from the repo root:
#   export MEDINI_DB_PASSWORD=$(docker exec medini-prod-mysql-1 sh -c 'printf %s "$MYSQL_PASSWORD"')
#   bash verify-5dc-5f.sh

set -uo pipefail
export LC_ALL=C

API="https://localhost/api/v1"
PASS=0; FAIL=0
DB() { docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -N -B -e "$1" 2>/dev/null; }
ok()  { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — dapat '$2', jangka '$3'"; fi; }

echo "=== FASA 5D-C (SLA) + 5F (kempen) ==="
echo

TOKEN=$(curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "hq")" | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null)
[ -n "$TOKEN" ] && ok "log masuk hq" || { bad "log masuk"; exit 1; }

BRANCH=$(DB "SELECT id FROM branches WHERE code='sentosa'")
# ORG IS READ FROM THE BRANCH ROW, NOT FROM `organizations`.
#
# The organizations table is EMPTY in this database while every business row
# carries the org id directly. `(SELECT id FROM organizations LIMIT 1)` therefore
# evaluates to NULL, the inserts fail their not-null constraint, and the failure
# looks like a broken endpoint rather than a broken test. The branch already
# knows its org.
ORG=$(DB "SELECT org_id FROM branches WHERE code='sentosa'")
CHANNEL=$(DB "SELECT id FROM wa_channels WHERE branch_id='$BRANCH' AND org_id='$ORG' LIMIT 1")
[ -n "$CHANNEL" ] || CHANNEL=$(DB "SELECT id FROM wa_channels WHERE branch_id='$BRANCH' LIMIT 1")

[ -n "$ORG" ] && ok "org dibaca dari cawangan ($ORG)" || { bad "org tidak dijumpai"; exit 1; }
[ -n "$CHANNEL" ] && ok "saluran WhatsApp dijumpai" || { bad "tiada saluran"; exit 1; }

echo
echo "--- 1. Kolum SLA wujud ---"
check "sla_minutes dalam tetapan" "$(DB "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='medini_prod' AND TABLE_NAME='ai_whatsapp_settings' AND COLUMN_NAME='sla_minutes'")" "1"
check "tarikh kempen wujud" "$(DB "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='medini_prod' AND TABLE_NAME='wa_blast_campaigns' AND COLUMN_NAME IN ('start_date','end_date')")" "2"

echo
echo "--- 2. Had SLA boleh diset, dan dilaporkan bersama papan ---"
DB "UPDATE ai_whatsapp_settings SET sla_minutes=15 WHERE branch_id='$BRANCH'"
SLA=$(curl -sk "$API/whatsapp/conversations/sla?branchId=$BRANCH" -H "Authorization: Bearer $TOKEN" \
  | python -c "import sys,json;print(json.load(sys.stdin).get('slaMinutes',''))" 2>/dev/null)
check "had SLA dibaca dari tetapan cawangan" "$SLA" "15"
NOAUTH=$(curl -sk -o .verify-out.tmp -w "%{http_code}" "$API/whatsapp/conversations/sla")
check "papan SLA tanpa token → 401" "$NOAUTH" "401"

echo
echo "--- 3. Susunan: paling lama menunggu di ATAS ---"
# Three conversations: 40 min, 3 min, 25 min. The board must come back 40, 25, 3.
DB "DELETE FROM wa_conversations WHERE contact_phone LIKE '60199%'"
for spec in "601991110001:40" "601991110002:3" "601991110003:25"; do
  PHONE="${spec%%:*}"; MINS="${spec##*:}"
  DB "INSERT INTO wa_conversations (id, org_id, branch_id, channel_id, contact_phone, status, unread_count, needs_human, last_message_at, created_at)
      VALUES (UUID(), '$ORG', '$BRANCH', '$CHANNEL', '$PHONE', 'open', 1, 1,
              NOW() - INTERVAL $MINS MINUTE, NOW() - INTERVAL $MINS MINUTE)"
done

BOARD=$(curl -sk "$API/whatsapp/conversations/sla?branchId=$BRANCH" -H "Authorization: Bearer $TOKEN")
ORDER=$(echo "$BOARD" | python -c "
import sys,json
d=json.load(sys.stdin)
ws=[c['waitingMinutes'] for c in d['conversations'] if c['contactPhone'].startswith('60199')]
print(','.join(str(w) for w in ws))
" 2>/dev/null)
check "susunan menunggu-terlama-dahulu" "$ORDER" "40,25,3"

LONGEST=$(echo "$BOARD" | python -c "import sys,json;print(json.load(sys.stdin)['summary']['longest'])" 2>/dev/null)
check "ringkasan sebut menunggu paling lama" "$LONGEST" "40"

LEVEL=$(echo "$BOARD" | python -c "
import sys,json
d=json.load(sys.stdin)
c=[x for x in d['conversations'] if x['contactPhone']=='601991110001'][0]
print(c['level'])
" 2>/dev/null)
check "40 minit lepas had 15 → breached" "$LEVEL" "breached"

WARN=$(echo "$BOARD" | python -c "
import sys,json
d=json.load(sys.stdin)
c=[x for x in d['conversations'] if x['contactPhone']=='601991110003'][0]
print(c['level'])
" 2>/dev/null)
# 25 min against a 15-min limit is BREACHED, not a warning. A warning is the band
# BEFORE the limit. Asserting 'warning' here was asserting the wrong thing — the
# 15-min case below proves the boundary, this proves above-limit is flagged.
check "25 minit → breached (>15)" "$WARN" "breached"

# The warning band: past two-thirds of the limit but not yet at it.
DB "INSERT INTO wa_conversations (id, org_id, branch_id, channel_id, contact_phone, status, unread_count, needs_human, last_message_at, created_at)
    VALUES (UUID(), '$ORG', '$BRANCH', '$CHANNEL', '601991110004', 'open', 1, 1, NOW() - INTERVAL 11 MINUTE, NOW() - INTERVAL 11 MINUTE)"
WARN2=$(curl -sk "$API/whatsapp/conversations/sla?branchId=$BRANCH" -H "Authorization: Bearer $TOKEN" \
  | python -c "
import sys,json
d=json.load(sys.stdin)
c=[x for x in d['conversations'] if x['contactPhone']=='601991110004'][0]
print(c['level'])
" 2>/dev/null)
check "11 minit → warning (belum had 15)" "$WARN2" "warning"

echo
echo "--- 4. Balasan menghentikan jam ---"
DB "UPDATE wa_conversations SET first_response_at=NOW() WHERE contact_phone='601991110001'"
AFTER=$(curl -sk "$API/whatsapp/conversations/sla?branchId=$BRANCH" -H "Authorization: Bearer $TOKEN" \
  | python -c "
import sys,json
d=json.load(sys.stdin)
c=[x for x in d['conversations'] if x['contactPhone']=='601991110001'][0]
print('null' if c['waitingMinutes'] is None else c['waitingMinutes'])
" 2>/dev/null)
check "selepas dibalas, tiada masa menunggu" "$AFTER" "null"

WAITING=$(curl -sk "$API/whatsapp/conversations/sla?branchId=$BRANCH" -H "Authorization: Bearer $TOKEN" \
  | python -c "
import sys,json
d=json.load(sys.stdin)
print(sum(1 for c in d['conversations'] if c['contactPhone'].startswith('60199') and c['waitingMinutes'] is not None))
" 2>/dev/null)
check "kiraan menunggu turun ke 3" "$WAITING" "3"

echo
echo "--- 5. Had SLA per-cawangan benar-benar berbeza ---"
DB "UPDATE ai_whatsapp_settings SET sla_minutes=60 WHERE branch_id='$BRANCH'"
LVL=$(curl -sk "$API/whatsapp/conversations/sla?branchId=$BRANCH" -H "Authorization: Bearer $TOKEN" \
  | python -c "
import sys,json
d=json.load(sys.stdin)
c=[x for x in d['conversations'] if x['contactPhone']=='601991110003'][0]
print(c['level'])
" 2>/dev/null)
check "25 minit dengan had 60 → ok (bukan breached)" "$LVL" "ok"
DB "UPDATE ai_whatsapp_settings SET sla_minutes=15 WHERE branch_id='$BRANCH'"

echo
echo "--- 5b. Had TIDAK bocor antara cawangan ---"
# REGRESSION. The board once read ONE limit with LIMIT 1 and no branch filter, so
# HQ on "All Branches" was graded against whichever row MySQL reached first. Two
# branches are given different limits and the same 25-minute wait must be judged
# differently in each — and the per-row limit must match the row's own branch.
OTHER=$(DB "SELECT branch_id FROM ai_whatsapp_settings WHERE branch_id <> '$BRANCH' LIMIT 1")
if [ -n "$OTHER" ]; then
  DB "UPDATE ai_whatsapp_settings SET sla_minutes=90 WHERE branch_id='$OTHER'"
  DB "UPDATE ai_whatsapp_settings SET sla_minutes=10 WHERE branch_id='$BRANCH'"

  PERCAMP=$(curl -sk "$API/whatsapp/conversations/sla?branchId=$BRANCH" -H "Authorization: Bearer $TOKEN" \
    | python -c "
import sys,json
d=json.load(sys.stdin)
c=[x for x in d['conversations'] if x['contactPhone']=='601991110003'][0]
print(f\"{c['slaMinutes']}|{c['level']}\")
" 2>/dev/null)
  check "setiap baris bawa had cawangannya sendiri (10 → breached)" "$PERCAMP" "10|breached"

  # And the header must not report the OTHER branch's 90 while showing this one.
  HDR=$(curl -sk "$API/whatsapp/conversations/sla?branchId=$BRANCH" -H "Authorization: Bearer $TOKEN" \
    | python -c "import sys,json;print(json.load(sys.stdin)['slaMinutes'])" 2>/dev/null)
  check "had header = had cawangan itu (10, bukan 90)" "$HDR" "10"

  DB "UPDATE ai_whatsapp_settings SET sla_minutes=15 WHERE branch_id='$OTHER'"
fi
DB "UPDATE ai_whatsapp_settings SET sla_minutes=15 WHERE branch_id='$BRANCH'"

echo
echo "--- 6. Kempen: 1400 dalam 14 hari DITERIMA ---"
DB "DELETE FROM wa_blast_campaigns WHERE name LIKE 'UJIAN-%'"
CAMP=$(DB "SELECT UUID()")
DB "INSERT INTO wa_blast_campaigns (id, org_id, branch_id, channel_id, batch_id, name, status, total_count, sent_count, body, window_start_hour, window_end_hour, per_day)
    VALUES ('$CAMP', '$ORG', '$BRANCH', '$CHANNEL', 'UJIAN-BATCH-1', 'UJIAN-Merdeka', 'running', 1400, 0, 'test', 8, 22, 100)"
# batch_id is NOT NULL with no default — the insert fails without it, and the
# PATCH then returns 404 for a campaign that was never created. Supplied here so
# the test exercises the endpoint rather than testing its own broken fixture.
check "kempen ujian dicipta" "$(DB "SELECT COUNT(*) FROM wa_blast_campaigns WHERE id='$CAMP'")" "1"

SCHED=$(curl -sk -X PATCH "$API/whatsapp/campaigns/$CAMP/schedule" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"startDate":"2026-09-01","endDate":"2026-09-14"}' \
  -w "\n%{http_code}")
CODE=$(echo "$SCHED" | tail -1)
PERDAY=$(echo "$SCHED" | head -1 | python -c "import sys,json;print(json.load(sys.stdin).get('perDay',''))" 2>/dev/null)
check "1400/14 hari diterima" "$CODE" "200"
check "kadar dikira 100/hari" "$PERDAY" "100"

echo
echo "--- 6b. Sasaran harian KEKAL selepas ubah tarikh sahaja ---"
# REGRESSION. The endpoint accepted `dailyTarget`, then dropped it: changing only
# the dates reverted a deliberate slower pace to the derived rate, with no error.
# A plan that cannot be read back cannot be reviewed.
curl -sk -o .verify-out.tmp -X PATCH "$API/whatsapp/campaigns/$CAMP/schedule" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"startDate":"2026-09-01","endDate":"2026-09-14","dailyTarget":40}'
STORED=$(DB "SELECT daily_target FROM wa_blast_campaigns WHERE id='$CAMP'")
check "sasaran 40 disimpan" "$STORED" "40"
PERDAY2=$(DB "SELECT per_day FROM wa_blast_campaigns WHERE id='$CAMP'")
check "kadar dikira ikut sasaran (40, bukan 100)" "$PERDAY2" "40"

# Change ONLY the dates. The target must survive.
curl -sk -o .verify-out.tmp -X PATCH "$API/whatsapp/campaigns/$CAMP/schedule" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"startDate":"2026-09-02","endDate":"2026-09-15"}'
KEPT=$(DB "SELECT daily_target FROM wa_blast_campaigns WHERE id='$CAMP'")
check "sasaran 40 KEKAL selepas ubah tarikh sahaja" "$KEPT" "40"
KEPT_RATE=$(DB "SELECT per_day FROM wa_blast_campaigns WHERE id='$CAMP'")
check "kadar kekal 40 (tidak revert ke 100)" "$KEPT_RATE" "40"

# And a target ABOVE the ceiling is still refused even when only it changes.
OVER=$(curl -sk -o .verify-out.tmp -w "%{http_code}" -X PATCH "$API/whatsapp/campaigns/$CAMP/schedule" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"dailyTarget":500}')
check "sasaran 500 (had 100) ditolak" "$OVER" "422"

# CLEAR THE TARGET so the sections after this one see the plain derived rate.
# Leaving 40 in place made section 7 accept a 7-day plan (40/day fits) and
# section 9 expect 40 instead of 100 — the new check was leaking state into the
# checks below it, which is the same class of fault as depending on leftover rows.
DB "UPDATE wa_blast_campaigns SET daily_target=NULL, per_day=100 WHERE id='$CAMP'"
check "sasaran dibersihkan untuk ujian seterusnya" "$(DB "SELECT daily_target IS NULL FROM wa_blast_campaigns WHERE id='$CAMP'")" "1"

echo
echo "--- 7. Kempen: 1400 dalam 7 hari DITOLAK (had 200/hari > 100) ---"
REJ=$(curl -sk -X PATCH "$API/whatsapp/campaigns/$CAMP/schedule" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"startDate":"2026-09-01","endDate":"2026-09-07"}' \
  -w "\n%{http_code}")
RCODE=$(echo "$REJ" | tail -1)
# 422, not 400: ValidationError maps to 422 across this API (errors.ts). The
# endpoint refuses correctly; the earlier expectation of 400 was simply wrong
# about the project's convention.
check "pelan mustahil ditolak (bukan dipaksa)" "$RCODE" "422"
echo "$REJ" | head -1 | grep -q "200/hari" && ok "penolakan membawa kiraan (200/hari)" || bad "penolakan tiada kiraan: $(echo "$REJ" | head -1)"

echo
echo "--- 8. Kempen: tarikh tamat sebelum mula DITOLAK ---"
BADCODE=$(curl -sk -o .verify-out.tmp -w "%{http_code}" -X PATCH "$API/whatsapp/campaigns/$CAMP/schedule" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"startDate":"2026-09-14","endDate":"2026-09-01"}')
check "tamat sebelum mula ditolak" "$BADCODE" "422"

echo
echo "--- 9. Kemajuan: hari N/M, dan 'lewat' diukur ikut pelan ---"
# Dates are computed RELATIVE TO TODAY, not hardcoded. A campaign pinned to
# 1-14 Sept only reports the day numbers I expect on one particular date; the
# test would pass today and fail tomorrow for no reason. Starting today makes
# "day 1 of 14" true whenever this runs.
TODAY=$(DB "SELECT CURDATE()")
END=$(DB "SELECT DATE_ADD(CURDATE(), INTERVAL 13 DAY)")
DB "UPDATE wa_blast_campaigns SET start_date='$TODAY', end_date='$END', sent_count=300, per_day=100 WHERE id='$CAMP'"
# Day 1, so expected = 100. With 300 sent the campaign is AHEAD, hence on track.
PROG=$(curl -sk "$API/whatsapp/campaigns/progress?branchId=$BRANCH" -H "Authorization: Bearer $TOKEN" \
  | python -c "
import sys,json
d=json.load(sys.stdin)
c=[x for x in d['campaigns'] if x['name']=='UJIAN-Merdeka'][0]
p=c['progress']
print(f\"{p['elapsed']}/{p['days']}|{p['expected']}|{p['onTrack']}\")
" 2>/dev/null)
check "hari 1/14 (mula hari ini), jangkaan 100, ikut jadual" "$PROG" "1/14|100|True"

# And behind: 0 sent on day 1 is within the one-day grace; push the start back so
# the elapsed days make the shortfall real, proving the flag can fire.
START5=$(DB "SELECT DATE_ADD(CURDATE(), INTERVAL -5 DAY)")
END5=$(DB "SELECT DATE_ADD(CURDATE(), INTERVAL 8 DAY)")
DB "UPDATE wa_blast_campaigns SET start_date='$START5', end_date='$END5', sent_count=50, per_day=100 WHERE id='$CAMP'"
BEHIND=$(curl -sk "$API/whatsapp/campaigns/progress?branchId=$BRANCH" -H "Authorization: Bearer $TOKEN" \
  | python -c "
import sys,json
d=json.load(sys.stdin)
c=[x for x in d['campaigns'] if x['name']=='UJIAN-Merdeka'][0]
print(c['progress']['onTrack'])
" 2>/dev/null)
check "hari 6/14, hanya 50 dihantar → lewat (False)" "$BEHIND" "False"

BEHINDSUM=$(curl -sk "$API/whatsapp/campaigns/progress?branchId=$BRANCH" -H "Authorization: Bearer $TOKEN" \
  | python -c "import sys,json;print(json.load(sys.stdin)['behindCount'])" 2>/dev/null)
check "ringkasan kira 1 kempen lewat" "$BEHINDSUM" "1"

check "ringkasan kempen ada" "$(curl -sk "$API/whatsapp/campaigns/progress?branchId=$BRANCH" -H "Authorization: Bearer $TOKEN" | python -c "import sys,json;print('yes' if 'summary' in json.load(sys.stdin) else 'no')" 2>/dev/null)" "yes"

echo
echo "--- 10. Bersihkan ---"
DB "DELETE FROM wa_conversations WHERE contact_phone LIKE '60199%'"
DB "DELETE FROM wa_blast_campaigns WHERE name LIKE 'UJIAN-%'"
check "data ujian dibersihkan" "$(DB "SELECT COUNT(*) FROM wa_conversations WHERE contact_phone LIKE '60199%'")" "0"

echo
echo "======================================================"
echo "  LULUS: $PASS   GAGAL: $FAIL"
echo "======================================================"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
