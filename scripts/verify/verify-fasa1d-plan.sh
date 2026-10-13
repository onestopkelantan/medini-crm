#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# ============================================================================
# verify-fasa1d-plan.sh — end-to-end proof of the treatment-plan lifecycle.
#
# WHAT ONLY HTTP CAN PROVE
#
# `plan-lifecycle.spec.ts` proves the state machine as data. It cannot prove the
# machine is WIRED: that a plan actually walks draft → proposed → accepted → active
# → completed through the API, that illegal moves are refused, or that the TWO
# GATES actually bite:
#
#   1. `accepted` is refused (409) while a consent-required plan has no consent
#      record, and succeeds once one exists.
#   2. `completed` is refused while any item is pending, and succeeds when all are done.
#
# Gate 1 is the assertion this script exists for, and section 4 proves it the only
# way that means anything: same call, opposite outcome, ONE variable changed. A
# hardcoded `throw` passes a one-sided test.
#
# THE WRITE CONTRACT (same as 1B/1C): `clinical:create` / `clinical:edit` are granted
# to the **doctor** role alone, and that cell's scope is `own` — fail-closed. So every
# write carries `branchId` + `doctorId` matching the principal, and omitting them is a
# **403**, not a missing-parameter error.
#
# Run from the repo root:  bash verify-fasa1d-plan.sh
# ============================================================================
set -uo pipefail

API=https://localhost/api/v1
DB=medini-prod-mysql-1
DIR="${LOCALAPPDATA:-/tmp}/Temp"
mkdir -p "$DIR"

PASS=0; FAIL=0
ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
step() { echo; echo "== $1 =="; }
check(){ if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (dapat '$1', patut '$2')"; fi }

RP=$(docker exec "$DB" sh -c 'printf %s "$MYSQL_ROOT_PASSWORD"')
q() { docker exec -i "$DB" mysql -uroot -p"$RP" medini_prod -N -B -e "$1" 2>/dev/null | tr -d '\r'; }
jget() { python -c "import json,sys;d=json.load(open(sys.argv[1]));print(eval(sys.argv[2]))" "$1" "$2" 2>/dev/null; }
code() { curl -sk -o "$DIR/v1d.json" -w '%{http_code}' "$@"; }

login() {
  curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "$1")" \
    | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null
}

TITLE='ZZTEST Ujian pelan (Fasa 1D)'

# ------------------------------------------------- 0. reset, then preflight
# CLEANUP ON THE WAY OUT TOO. Previously this ran only at the START, so every run left
# three 'ZZTEST Ujian pelan (Fasa 1D)' plans behind. They are harmless individually and
# accumulate quietly — three were found in the demo database, and a later run's
# "should be zero" assertion fails because of rubbish an EARLIER run left. A test that
# does not take its rubbish with it turns the next person's failure into a mystery.
cleanup() {
  # The ENCOUNTER comes out too. This script creates one ("Ujian pelan (Fasa 1D)") as the
  # write path requires it, and the first version of this cleanup deleted only plans —
  # so the encounter stayed behind and the next run's count was wrong. A test that takes
  # its plans but leaves its encounter has taken only half its rubbish.
  #
  # Order matters: children before parents, and `adverse_events` / `tooth_records` /
  # `clinical_notes` restrict `encounters`, so they go first or the delete aborts the
  # whole file and nothing after it runs.
  for ENC in $(docker exec -i "$DB" mysql -uroot -p"$RP" medini_prod -N -B \
      -e "SELECT id FROM encounters WHERE chief_complaint LIKE 'Ujian pelan%'" 2>/dev/null | tr -d '\r'); do
    docker exec -i "$DB" mysql -uroot -p"$RP" medini_prod -e "
      DELETE FROM adverse_events WHERE encounter_id='$ENC';
      DELETE FROM treatment_plan_items WHERE plan_id IN (SELECT id FROM treatment_plans WHERE title LIKE 'ZZTEST%');
      DELETE FROM treatment_sessions WHERE plan_id IN (SELECT id FROM treatment_plans WHERE title LIKE 'ZZTEST%');
      DELETE FROM consent_records WHERE plan_id IN (SELECT id FROM treatment_plans WHERE title LIKE 'ZZTEST%');
      DELETE FROM treatment_plans WHERE title LIKE 'ZZTEST%';
      DELETE FROM tooth_records WHERE encounter_id='$ENC';
      DELETE FROM clinical_notes WHERE encounter_id='$ENC';
      DELETE FROM encounters WHERE id='$ENC';" 2>/dev/null
  done
}
trap cleanup EXIT

step "0 · reset keadaan + preflight"
cleanup
LEFT=$(q "SELECT COUNT(*) FROM treatment_plans WHERE title LIKE 'ZZTEST%'")
check "${LEFT:-1}" "0" "keadaan direset (0 pelan ujian lama)"

HQ=$(login hq)
HASH=$(docker exec -e P="$SEED_DEMO_PASSWORD" medini-prod-backend-1 node -e 'const a=require("argon2");a.hash(process.env.P,{type:a.argon2id}).then(h=>process.stdout.write(h))' 2>/dev/null)
q "UPDATE staff SET password_hash='$HASH' WHERE username='dr.aina'"
DOC=$(login dr.aina)
[ ${#DOC} -gt 50 ] && ok "login dr.aina" || { bad "login dr.aina"; exit 1; }

ME=$(curl -sk "$API/auth/me" -H "Authorization: Bearer $DOC")
DOCTOR_ID=$(echo "$ME" | python -c "import sys,json;print(json.load(sys.stdin)['data']['doctorId'])" 2>/dev/null)
BRANCH_ID=$(echo "$ME" | python -c "import sys,json;print(json.load(sys.stdin)['data']['branchId'])" 2>/dev/null)
PAT=$(q "SELECT id FROM patients WHERE branch_id='$BRANCH_ID' LIMIT 1")
[ -n "$PAT" ] || PAT=$(q "SELECT id FROM patients ORDER BY mrn LIMIT 1")
ok "doktor + pesakit disediakan"

SCOPE=",\"branchId\":\"$BRANCH_ID\",\"doctorId\":\"$DOCTOR_ID\""

# An encounter is needed: plan creation links to one when present, and the write path
# is doctor-scoped the same way.
code -X POST "$API/clinical/encounters" -H "Authorization: Bearer $DOC" \
  -H 'Content-Type: application/json' \
  -d "{\"patientId\":\"$PAT\"$SCOPE,\"chiefComplaint\":\"Ujian pelan (Fasa 1D)\"}" >/dev/null
ENC=$(jget "$DIR/v1d.json" "d.get('id','')")
[ -n "$ENC" ] && ok "encounter dibuka" || bad "gagal buka encounter"

mk_plan() {  # mk_plan <consentRequired:true|false> <item-line-1> [item-line-2...]
  local cr="$1"; shift
  local items=""
  for d in "$@"; do
    [ -n "$items" ] && items="$items,"
    items="$items{\"description\":\"$d\"}"
  done
  code -X POST "$API/clinical/plans" -H "Authorization: Bearer $DOC" -H 'Content-Type: application/json' \
    -d "{\"patientId\":\"$PAT\",\"encounterId\":\"$ENC\",\"title\":\"$TITLE\",\"consentRequired\":$cr,\"items\":[$items]$SCOPE}"
}
set_status() {  # set_status <planId> <status> [reason]
  local extra=""
  [ -n "${3:-}" ] && extra=",\"cancelReason\":\"$3\""
  code -X PATCH "$API/clinical/plans/$1/status" -H "Authorization: Bearer $DOC" \
    -H 'Content-Type: application/json' -d "{\"status\":\"$2\"$extra$SCOPE}"
}
read_plan() { curl -sk "$API/clinical/plans/$1" -H "Authorization: Bearer $DOC"; }

# ------------------------------------------------- 1. routes + create
step "1 · route wujud + cipta pelan (tsc bersih BUKAN bukti)"
C=$(code "$API/clinical/plans?patientId=$PAT" -H "Authorization: Bearer $DOC")
check "$C" "200" "GET /clinical/plans?patientId → 200"

C=$(mk_plan false "Tampal komposit 16" "Rawatan akar 36")
if [ "$C" = "201" ] || [ "$C" = "200" ]; then ok "cipta pelan + 2 item → $C"; else bad "cipta pelan → $C"; head -c 220 "$DIR/v1d.json"; echo; fi
PLAN=$(jget "$DIR/v1d.json" "(d.get('plan') or {}).get('id','')")
STATUS=$(jget "$DIR/v1d.json" "(d.get('plan') or {}).get('status','')")
CODE=$(jget "$DIR/v1d.json" "(d.get('plan') or {}).get('planCode','')")
check "$STATUS" "draft" "pelan baharu bermula sebagai DRAFT"
case "$CODE" in TPL-*) ok "kod pelan dijana oleh pelayan ($CODE)";; *) bad "kod pelan pelik: $CODE";; esac

NITEMS=$(python -c "import json,sys;print(len(json.load(open(sys.argv[1])).get('items',[])))" "$DIR/v1d.json" 2>/dev/null)
check "${NITEMS:-0}" "2" "2 item dicipta"

# ------------------------------------------------- 2. illegal transitions
step "2 · transisi haram ditolak"
C=$(set_status "$PLAN" "completed")
check "$C" "409" "draft → completed DILANGGAR → 409"
C=$(set_status "$PLAN" "active")
check "$C" "409" "draft → active DILANGGAR → 409"

# ------------------------------------------------- 3. the legal walk
step "3 · laluan sah: draft → proposed → active"
C=$(set_status "$PLAN" "proposed")
check "$C" "200" "draft → proposed → 200"
C=$(set_status "$PLAN" "active")
check "$C" "409" "proposed → active DILANGGAR (perlu 'accepted' dulu) → 409"

# --------------------------------------------- 4. GATE 1: the CONSENT gate
step "4 · GERBANG KEBENARAN: menahan 'accepted' sehingga consent wujud"
# A consent-required plan. This is the gate the whole script exists for.
C=$(mk_plan true "Cabut gigi 38")
if [ "$C" = "201" ] || [ "$C" = "200" ]; then ok "cipta pelan PERLU KEBENARAN → $C"; else bad "cipta pelan consent → $C"; fi
PLAN2=$(jget "$DIR/v1d.json" "(d.get('plan') or {}).get('id','')")

set_status "$PLAN2" "proposed" >/dev/null
C=$(set_status "$PLAN2" "accepted")
check "$C" "409" "TERIMA tanpa rekod kebenaran → 409 (gerbang menahan)"

MSG=$(head -c 300 "$DIR/v1d.json" | tr -d '\n')
case "$MSG" in
  *CONSENT_REQUIRED*|*onsent*) ok "mesej gerbang menyebut consent" ;;
  *) bad "mesej gerbang tidak jelas: $(echo "$MSG" | head -c 100)" ;;
esac

# Record the consent, then REPEAT THE SAME CALL. One variable changed — this pair is
# the only thing that distinguishes a working gate from a hardcoded refusal.
TEMPLATE_ID=$(q "SELECT id FROM consent_templates WHERE is_active=1 LIMIT 1")
if [ -n "$TEMPLATE_ID" ]; then
  CV=$(q "SELECT version FROM consent_templates WHERE id='$TEMPLATE_ID'")
  C=$(code -X POST "$API/clinical/consents/records" -H "Authorization: Bearer $DOC" \
    -H 'Content-Type: application/json' \
    -d "{\"patientId\":\"$PAT\",\"templateId\":\"$TEMPLATE_ID\",\"templateVersion\":$CV,\"planId\":\"$PLAN2\",\"method\":\"written\",\"consentedBy\":\"Ujian Fasa 1D\"$SCOPE}")
  if [ "$C" = "201" ] || [ "$C" = "200" ]; then ok "rekod kebenaran dicipta → $C"; else bad "rekod kebenaran → $C"; head -c 200 "$DIR/v1d.json"; echo; fi

  C=$(set_status "$PLAN2" "accepted")
  check "$C" "200" "TERIMA selepas consent wujud → 200 (gerbang melepaskan)"
else
  echo "  SKIP  tiada consent_templates aktif — gerbang lepas tidak dapat diuji"
fi

# A plan WITHOUT the flag is unaffected — the gate must not be blanket.
C=$(set_status "$PLAN" "accepted")
check "$C" "200" "pelan TANPA flag consent diterima tanpa rekod → 200 (gerbang tidak terlalu ketat)"

# ------------------------------------------ 5. GATE 2: completion needs items done
step "5 · GERBANG ITEM: 'completed' menahan selagi ada item belum siap"
set_status "$PLAN" "active" >/dev/null
C=$(set_status "$PLAN" "completed")
check "$C" "409" "SELESAI dgn item belum siap → 409 (gerbang menahan)"

PENDMSG=$(head -c 300 "$DIR/v1d.json" | tr -d '\n')
case "$PENDMSG" in
  *pending*) ok "mesej menyebut bilangan item belum siap" ;;
  *) bad "mesej gerbang item tidak jelas: $(echo "$PENDMSG" | head -c 100)" ;;
esac

# Mark both items done via the API, then repeat the same call.
curl -sk -o "$DIR/v1d_items.json" "$API/clinical/plans/$PLAN" -H "Authorization: Bearer $DOC"
ITEM_IDS=$(python -c "import json,sys;d=json.load(open(sys.argv[1]));pl=d.get('plan') or d;print(' '.join(i['id'] for i in (d.get('items') or pl.get('items') or [])))" "$DIR/v1d_items.json" 2>/dev/null)
for IID in $ITEM_IDS; do
  code -X PATCH "$API/clinical/plans/items/$IID/status" -H "Authorization: Bearer $DOC" \
    -H 'Content-Type: application/json' -d "{\"status\":\"done\"$SCOPE}" >/dev/null
done
DONE_LEFT=$(q "SELECT COUNT(*) FROM treatment_plan_items WHERE plan_id='$PLAN' AND status='pending' AND deleted_at IS NULL")
check "${DONE_LEFT:-1}" "0" "semua item ditanda siap melalui API"

C=$(set_status "$PLAN" "completed")
check "$C" "200" "SELESAI selepas semua item siap → 200 (gerbang melepaskan)"

# ------------------------------------------------- 6. terminal states
step "6 · keadaan terminal"
C=$(set_status "$PLAN" "active")
check "$C" "409" "completed → active DILANGGAR → 409 (terminal)"

C=$(mk_plan false "Item ujian batal")
PLAN3=$(jget "$DIR/v1d.json" "(d.get('plan') or {}).get('id','')")
C=$(set_status "$PLAN3" "cancelled" "Pesakit pilih rawatan lain")
check "$C" "200" "draft → cancelled → 200"
REASON=$(curl -sk "$API/clinical/plans/$PLAN3" -H "Authorization: Bearer $DOC" | python -c "import sys,json;d=json.load(sys.stdin);p=d.get('plan') or d;print(p.get('cancelReason') or '')" 2>/dev/null)
case "$REASON" in *"rawatan lain"*) ok "sebab batal disimpan";; *) bad "sebab batal hilang: '$REASON'";; esac
C=$(set_status "$PLAN3" "proposed")
check "$C" "409" "cancelled → proposed DILANGGAR → 409 (terminal)"

# ------------------------------------------------- 7. permissions
step "7 · kebenaran: doktor menulis, hq membaca"
C=$(code -X POST "$API/clinical/plans" -H "Authorization: Bearer $HQ" -H 'Content-Type: application/json' \
  -d "{\"patientId\":\"$PAT\",\"title\":\"ZZTEST hq cuba cipta\",\"items\":[]}")
check "$C" "403" "hq DITOLAK mencipta pelan → 403 (doktor sahaja)"

C=$(code "$API/clinical/plans?patientId=$PAT" -H "Authorization: Bearer $HQ")
check "$C" "200" "hq boleh BACA senarai pelan → 200"

echo
echo "======================================================"
echo "  PASS: $PASS    FAIL: $FAIL"
echo "======================================================"
echo
echo "PERINGATAN: skrip ini menulis pelan berjudul '$TITLE' + encounter."
echo "Jalankan:  bash padam-data-fasa1d.sh"
[ "$FAIL" -eq 0 ] || exit 1
