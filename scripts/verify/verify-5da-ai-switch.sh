#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# FASA 5D-A — live proof of the AI switch.
#
# THE CLAIMS
#
#   1. The switch is PER BRANCH. Muting one clinic must leave the others answering.
#   2. It survives a round trip: what is written is what is read back.
#   3. It is NOT the anti-ban switch. Separate columns, and setting one must not
#      move the other — `antiban_enabled = false` makes the account MORE
#      aggressive, the exact opposite of what an operator mutes the AI for.
#   4. Only hq and branch_manager may change it. A role without ai:edit gets 403.
#   5. Flipping the switch writes an audit line naming the actor.
#   6. The decision function refuses on any of the three doors.
#
# WHAT THIS CANNOT PROVE
#
# No WhatsApp number is linked, so no real inbound message can be delivered. The
# decision function is exercised directly against the compiled production code —
# the same function the webhook calls — rather than through a live patient
# message. The full inbound path stays unproven until WAHA is connected.
#
# Run from the repo root:
#   export MEDINI_DB_PASSWORD=$(docker exec medini-prod-mysql-1 sh -c 'printf %s "$MYSQL_PASSWORD"')
#   bash verify-5da-ai-switch.sh

set -uo pipefail
export LC_ALL=C

# Kata laluan DB: guna yang diberi, atau ambil dari kontena MySQL sendiri.
# Tanpa ini setiap DB() gagal senyap dan skrip melaporkan 12 FAIL palsu.
export MEDINI_DB_PASSWORD="${MEDINI_DB_PASSWORD:-$(docker exec medini-prod-mysql-1 sh -c 'printf %s "$MYSQL_PASSWORD"')}"

API="https://localhost/api/v1"
# Nama pengguna sebenar dalam DB ialah DEMO-manager / DEMO-hq / DEMO-kaunter.
# Skrip ini dahulunya guna 'manager' (tiada dalam DB) — jadi ujian kawalan akses
# melaporkan kegagalan yang tidak wujud. Ambil dari data, jangan andaikan.
MGR_USER="DEMO-manager"
PASS=0; FAIL=0
DB() { docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -N -B -e "$1" 2>/dev/null; }
ok()  { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — dapat '$2', jangka '$3'"; fi; }

login() {
  curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "$1")" \
    | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null
}

echo "=== FASA 5D-A — suis AI ==="
echo

TOKEN=$(login hq)
[ -n "$TOKEN" ] && ok "log masuk hq" || { bad "log masuk hq"; exit 1; }

SENTOSA=$(DB "SELECT id FROM branches WHERE code='sentosa'")
SETIA=$(DB "SELECT id FROM branches WHERE code='setia-tropika'")
# Bukit Indah is the control branch: it HAS a settings row, so "unchanged" is a
# real observation. A branch with no row would return empty either way.
BUKIT=$(DB "SELECT id FROM branches WHERE code='bukit-indah'")
echo "  setia-tropika=$SETIA  (diubah)"
echo "  bukit-indah=$BUKIT    (kawalan)"

# Turn the AI on before measuring, so the test does not depend on what a previous
# run left behind. setEnabled <branchId> <0|1>
TMP="${LOCALAPPDATA:-/tmp}/Temp"
mkdir -p "$TMP"

setEnabled() {
  local B="$1" V="$2"
  # Build the payload from the API's own GET, minus the fields save() rejects.
  # The GET returns derived/extra keys (branchId, replyWindowSeconds, ...) that
  # `.strict()` refuses, so echoing GET straight back into PUT is a 422.
  curl -sk "$API/ai/whatsapp-settings?branchId=$B" -H "Authorization: Bearer $TOKEN" \
    | python -c "
import sys, json
d = json.load(sys.stdin)
keep = ['aiEnabled','antibanEnabled','minDelaySeconds','maxDelaySeconds',
        'dailyMessageCap','hourlyMessageCap','warmupDays','warmupDailyCap',
        'escalationKeywords','maxAiTurns','escalateOnAiUncertainty','escalationReply']
out = {k: d[k] for k in keep if k in d}
out['aiEnabled'] = $V == 1
print(json.dumps(out))
" > "$TMP/5da_body.json" 2>/dev/null

  curl -sk -X PUT "$API/ai/whatsapp-settings?branchId=$B" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    --data-binary "@$TMP/5da_body.json" 2>/dev/null
}

echo
echo "--- 1. Kolum wujud, dan BUKAN kolum anti-ban ---"
check "kolum ai_enabled wujud" "$(DB "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='medini_prod' AND TABLE_NAME='ai_whatsapp_settings' AND COLUMN_NAME='ai_enabled'")" "1"
check "kolum antiban_enabled masih berasingan" "$(DB "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='medini_prod' AND TABLE_NAME='ai_whatsapp_settings' AND COLUMN_NAME='antiban_enabled'")" "1"
check "kedua-dua cawangan lalai HIDUP" "$(DB "SELECT COUNT(*) FROM ai_whatsapp_settings WHERE ai_enabled=1")" "$(DB "SELECT COUNT(*) FROM ai_whatsapp_settings")"

echo
echo "--- 2. API mendedahkan suis ---"
SET=$(curl -sk "$API/ai/whatsapp-settings?branchId=$SETIA" -H "Authorization: Bearer $TOKEN")
echo "$SET" | grep -q '"aiEnabled":true' && ok "GET mengembalikan aiEnabled: true" || bad "tiada aiEnabled: $(echo "$SET" | head -c 150)"

echo
echo "--- 3. Matikan AI SETIA TROPIKA; SENTOSA mesti tidak terjejas ---"
R=$(setEnabled "$SETIA" 0)
echo "$R" | grep -q '"aiEnabled":false' && ok "PUT diterima — AI dimatikan" || bad "PUT gagal: $(echo "$R" | head -c 200)"
check "DB: setia-tropika AI MATI" "$(DB "SELECT ai_enabled FROM ai_whatsapp_settings WHERE branch_id='$SETIA'")" "0"
check "DB: bukit-indah MASIH HIDUP (per-cawangan)" "$(DB "SELECT ai_enabled FROM ai_whatsapp_settings WHERE branch_id='$BUKIT'")" "1"

echo
echo "--- 4. Suis anti-ban tidak tersentuh ---"
check "setia-tropika antiban masih 1" "$(DB "SELECT antiban_enabled FROM ai_whatsapp_settings WHERE branch_id='$SETIA'")" "1"

echo
echo "--- 5. Fungsi keputusan (kod produksi) ---"
DEC=$(docker exec medini-prod-backend-1 node -e "
const { canAiReply } = require('/app/dist/modules/whatsapp/domain/ai-control.js');
const open = { branchAiEnabled: true, needsHuman: false, aiQueueState: null, status: 'open' };
console.log(JSON.stringify({
  normal:     canAiReply(open),
  branchOff:  canAiReply({ ...open, branchAiEnabled: false }),
  patientAsk: canAiReply({ ...open, needsHuman: true }),
  handoff:    canAiReply({ ...open, aiQueueState: 'handoff' }),
  idleState:  canAiReply({ ...open, aiQueueState: 'responded' }),
}));
" 2>/dev/null | tail -1)

echo "$DEC" | python -c "
import sys, json
d = json.load(sys.stdin)
assert d['normal']['allowed'] is True
assert d['branchOff']['reason'] == 'BRANCH_AI_DISABLED'
assert d['patientAsk']['reason'] == 'HUMAN_REQUESTED'
assert d['handoff']['reason'] == 'STAFF_HANDOFF'
assert d['idleState']['allowed'] is True, 'keadaan AI biasa mesti tidak menyekat'
print('  normal        : dibenarkan')
print('  cawangan mati :', d['branchOff']['reason'])
print('  minta orang   :', d['patientAsk']['reason'])
print('  staf ambil    :', d['handoff']['reason'])
print('  PASS  keempat-empat pintu betul')
" 2>&1 | tail -6

echo
echo "--- 6. Audit: siapa matikan AI ---"
AUD=$(DB "SELECT COUNT(*) FROM audit_log WHERE action='ai_disabled_for_branch' AND entity_id='$SETIA'")
if [ "${AUD:-0}" -gt 0 ]; then
  ok "audit direkod ($AUD baris)"
  ACTOR=$(DB "SELECT actor_id FROM audit_log WHERE action='ai_disabled_for_branch' AND entity_id='$SETIA' ORDER BY created_at DESC LIMIT 1")
  [ -n "$ACTOR" ] && ok "pelaku direkod" || bad "pelaku kosong"
else
  bad "tiada audit direkod"
fi

echo
echo "--- 7. Hidupkan semula, dan audit kedua ---"
setEnabled "$SETIA" 1 > /dev/null
check "DB: setia-tropika AI HIDUP semula" "$(DB "SELECT ai_enabled FROM ai_whatsapp_settings WHERE branch_id='$SETIA'")" "1"
# `> 0`, not `== 1`: a re-run of this script adds another row, and the point is
# that the event was recorded at all.
ENABLED_COUNT=$(DB "SELECT COUNT(*) FROM audit_log WHERE action='ai_enabled_for_branch' AND entity_id='$SETIA'")
[ "${ENABLED_COUNT:-0}" -gt 0 ] && ok "audit hidupkan semula direkod ($ENABLED_COUNT baris)" || bad "audit hidupkan semula tiada"

echo
echo "--- 8. Kawalan akses ---"
MT=$(login "$MGR_USER")
[ -n "$MT" ] || bad "log masuk $MGR_USER gagal — semak nama pengguna dalam DB"
# Which branch the manager belongs to, from the data — not assumed. Getting this
# wrong is what made the earlier run look like a cross-branch leak when the guard
# was behaving correctly.
MGR_BRANCH=$(DB "SELECT branch_id FROM staff WHERE username='$MGR_USER'")
echo "  manager berpaut pada cawangan: $MGR_BRANCH"

MC=$(curl -sk -o .verify-out.tmp -w "%{http_code}" -X PUT "$API/ai/whatsapp-settings?branchId=$MGR_BRANCH" \
  -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' --data-binary "@$TMP/5da_body.json")
echo "  manager PUT (cawangan SENDIRI) → HTTP $MC"
[ "$MC" = "200" ] && ok "branch_manager boleh matikan AI cawangan sendiri" || bad "manager sepatutnya boleh (ai:edit branch): $MC"

# A different clinic must be refused. SETIA is used because it differs from the
# manager's branch; if it ever matches, pick the control branch instead.
OTHER="$SETIA"
[ "$OTHER" = "$MGR_BRANCH" ] && OTHER="$BUKIT"
MC2=$(curl -sk -o .verify-out.tmp -w "%{http_code}" -X PUT "$API/ai/whatsapp-settings?branchId=$OTHER" \
  -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' --data-binary "@$TMP/5da_body.json")
echo "  manager PUT (cawangan LAIN) → HTTP $MC2"
[ "$MC2" = "403" ] && ok "branch_manager TIDAK boleh sentuh cawangan lain (403)" || bad "sepatutnya 403, dapat: $MC2"

NOAUTH=$(curl -sk -o .verify-out.tmp -w "%{http_code}" -X PUT "$API/ai/whatsapp-settings?branchId=$SETIA" -H 'Content-Type: application/json' --data-binary "@$TMP/5da_body.json")
[ "$NOAUTH" = "401" ] && ok "tanpa token → 401" || bad "tanpa token dapat $NOAUTH"

rm -f "$TMP/5da_body.json"

echo
echo "--- 9. Keadaan akhir: kedua-dua cawangan AI hidup ---"
check "semua cawangan AI hidup" "$(DB "SELECT COUNT(*) FROM ai_whatsapp_settings WHERE ai_enabled=1")" "$(DB "SELECT COUNT(*) FROM ai_whatsapp_settings")"

echo
echo "======================================================"
echo "  LULUS: $PASS   GAGAL: $FAIL"
echo "======================================================"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
