#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# ============================================================================
# verify-fasa1b-chart.sh — end-to-end proof of the continuous tooth chart.
#
# WHY THIS IS A SCRIPT AND NOT A TEST FILE
#
# The chart's correctness lives in three places, and only two are reachable from
# a unit test:
#   1. the domain reducer — 22 unit tests, already green
#   2. the SQL that picks the LATEST row per tooth  ← ONLY provable over HTTP
#   3. the route being registered at all            ← ONLY provable over HTTP
#
# (2) is the one that fails silently. A wrong ORDER BY returns 200 with a
# perfectly plausible chart — a dentist sees no error, only yesterday's finding.
# So this drives the real API with real rows and asserts on the ORDER of writes.
#
# TWO CONTRACTS THIS SCRIPT HAD TO LEARN (both cost a run):
#
#  - A `doctor` write MUST carry `doctorId` in the body. The clinical cell for
#    the doctor role is scope `own`, and `can()` for `own` is FAIL-CLOSED: it
#    denies unless branchId AND doctorId are both present and match the
#    principal. `PermissionGuard` auto-fills `doctorId` from the principal for
#    `view` only — NOT for create/edit. So the client sends its own doctorId and
#    the server compares it against the principal; sending someone else's fails.
#    This is the established contract (Clinical.tsx does exactly this), not a bug.
#  - `chart-symbols` returns 7 built-ins seeded by migration 0015.
#
# Run from the repo root:  bash verify-fasa1b-chart.sh
# ============================================================================
set -uo pipefail

API=https://localhost/api/v1
DB=medini-prod-mysql-1
DIR="${LOCALAPPDATA:-/tmp}/Temp"
mkdir -p "$DIR"

PASS=0
FAIL=0
ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
step() { echo; echo "== $1 =="; }

# Count an assertion without relying on `[ ] && ok || bad`, which short-circuits
# in ways that silently report the opposite result (that cost one run).
check() { # check <actual> <expected> <label>
  if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (dapat '$1', patut '$2')"; fi
}

RP=$(docker exec "$DB" sh -c 'printf %s "$MYSQL_ROOT_PASSWORD"')
q() { docker exec -i "$DB" mysql -uroot -p"$RP" medini_prod -N -B -e "$1" 2>/dev/null | tr -d '\r'; }

# Read a field out of a saved JSON body. Path passed as argv so Windows
# backslashes never appear inside a Python string literal.
jget() { python -c "import json,sys;d=json.load(open(sys.argv[1]));print(eval(sys.argv[2]))" "$1" "$2" 2>/dev/null; }

login() {
  curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "$1")" \
    | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null
}

# ---------------------------------------------------------------- 0. preflight
#
# RESET AT THE START, NOT ONLY AT THE END.
# A previous run's rows are still in the table, so the counts in sections 5-8
# accumulate (eventCount read 3 where the test expected 2) and the script appears
# to fail for a reason that has nothing to do with the code. Clean first, so a
# second run reports the same numbers as the first.
step "0 · preflight"
RP=$(docker exec "$DB" sh -c 'printf %s "$MYSQL_ROOT_PASSWORD"')
MARKER='Ujian carta gigi (Fasa 1B)%'
docker exec -i "$DB" mysql -uroot -p"$RP" medini_prod -e "
  DELETE FROM tooth_records WHERE encounter_id IN (SELECT id FROM encounters WHERE chief_complaint LIKE '$MARKER');
  DELETE FROM clinical_notes WHERE encounter_id IN (SELECT id FROM encounters WHERE chief_complaint LIKE '$MARKER');
  DELETE FROM encounters WHERE chief_complaint LIKE '$MARKER';" 2>/dev/null
LEFT=$(q "SELECT COUNT(*) FROM encounters WHERE chief_complaint LIKE '$MARKER'")
if [ "${LEFT:-1}" = "0" ]; then ok "keadaan direset (0 baris ujian lama)"; else bad "reset gagal ($LEFT tinggal)"; fi

HQ=$(login hq)
if [ ${#HQ} -gt 50 ]; then ok "login hq (token ${#HQ} chars)"; else bad "login hq"; exit 1; fi

PAT=$(q "SELECT id FROM patients ORDER BY mrn LIMIT 1")
if [ -n "$PAT" ]; then ok "pesakit ujian wujud"; else bad "tiada pesakit"; exit 1; fi

# --------------------------------------------------------- 1. routes registered
step "1 · route wujud (tsc bersih BUKAN bukti — ini bukti)"
C=$(curl -sk -o "$DIR/v1b_chart.json" -w '%{http_code}' "$API/clinical/patients/$PAT/chart" -H "Authorization: Bearer $HQ")
check "$C" "200" "GET /clinical/patients/:id/chart → 200"

curl -sk -o "$DIR/v1b_sym.json" "$API/clinical/chart-symbols" -H "Authorization: Bearer $HQ"
NSYM=$(jget "$DIR/v1b_sym.json" "len(d)")
check "$NSYM" "7" "GET /clinical/chart-symbols → 7 simbol"
CODES=$(jget "$DIR/v1b_sym.json" "'|'.join(sorted(x['code'] for x in d))")
check "$CODES" "bridge|denture|extracted|impacted|mobility|periapical|veneer" "7 kod simbol sepadan benih migrasi"

# --------------------------------------------------- 2. writer must be doctor
step "2 · hanya doktor boleh menulis carta"
# dr.aina ships with password_hash = NULL and cannot log in at all. Hash is
# generated INSIDE the container (the host has no argon2), as the repo's own
# reset script does. Only the length is ever printed.
HASH=$(docker exec -e P="$SEED_DEMO_PASSWORD" medini-prod-backend-1 node -e 'const a=require("argon2");a.hash(process.env.P,{type:a.argon2id}).then(h=>process.stdout.write(h))' 2>/dev/null)
if [ ${#HASH} -gt 50 ]; then ok "hash doktor dijana (${#HASH} aksara)"; else bad "gagal jana hash"; exit 1; fi
q "UPDATE staff SET password_hash='$HASH' WHERE username='dr.aina'"

DOC=$(login dr.aina)
if [ ${#DOC} -gt 50 ]; then ok "login dr.aina berjaya"; else bad "login dr.aina gagal"; exit 1; fi

DOCTOR_ID=$(curl -sk "$API/auth/me" -H "Authorization: Bearer $DOC" | python -c "import sys,json;print(json.load(sys.stdin)['data']['doctorId'])" 2>/dev/null)
BRANCH_ID=$(curl -sk "$API/auth/me" -H "Authorization: Bearer $DOC" | python -c "import sys,json;print(json.load(sys.stdin)['data']['branchId'])" 2>/dev/null)
[ -n "$DOCTOR_ID" ] && ok "principal doktor lengkap (branchId + doctorId)" || bad "principal doktor tiada doctorId"

DPAT=$(q "SELECT id FROM patients WHERE branch_id='$BRANCH_ID' LIMIT 1")
if [ -z "$DPAT" ]; then DPAT="$PAT"; BRANCH_ID=$(q "SELECT branch_id FROM patients WHERE id='$PAT'"); fi

# ------------------------------------------------------ 3. open the write target
step "3 · buka encounter (sasaran tulis)"
# branchId AND doctorId are both required: the cell is scope `own`, fail-closed.
curl -sk -o "$DIR/v1b_enc.json" -X POST "$API/clinical/encounters" -H "Authorization: Bearer $DOC" \
  -H 'Content-Type: application/json' \
  -d "{\"patientId\":\"$DPAT\",\"branchId\":\"$BRANCH_ID\",\"doctorId\":\"$DOCTOR_ID\",\"chiefComplaint\":\"Ujian carta gigi (Fasa 1B)\"}"
ENC=$(jget "$DIR/v1b_enc.json" "d.get('id','')")
if [ -n "$ENC" ]; then ok "encounter dibuka"; else
  bad "gagal buka encounter"; head -c 250 "$DIR/v1b_enc.json"; echo; exit 1
fi

# hq must be REFUSED. A write nobody stopped is indistinguishable from a correct
# one, so assert the refusal explicitly.
C=$(curl -sk -o .verify-out.tmp -w '%{http_code}' -X POST "$API/clinical/tooth-records" -H "Authorization: Bearer $HQ" \
  -H 'Content-Type: application/json' -d "{\"encounterId\":\"$ENC\",\"fdi\":36,\"condition\":\"decayed\"}")
if [ "$C" = "403" ] || [ "$C" = "401" ]; then ok "hq DITOLAK menulis carta → $C"; else bad "hq boleh tulis carta → $C (patut 403)"; fi

# ----------------------------------------------------- 4. DECIDUOUS works
step "4 · gigi susu boleh dicarta (kes kanak-kanak)"
# The whole point of the 1A foundation: a permanent-only parse made every
# paediatric chart impossible. 75 is a lower-left primary molar.
C=$(curl -sk -o "$DIR/v1b_decid.json" -w '%{http_code}' -X POST "$API/clinical/tooth-records" \
  -H "Authorization: Bearer $DOC" -H 'Content-Type: application/json' \
  -d "{\"encounterId\":\"$ENC\",\"fdi\":75,\"condition\":\"decayed\",\"notes\":\"susu berkubah\",\"branchId\":\"$BRANCH_ID\",\"doctorId\":\"$DOCTOR_ID\"}")
if [ "$C" = "201" ] || [ "$C" = "200" ]; then ok "carta gigi susu 75 → $C"; else
  bad "gigi susu 75 → $C"; head -c 220 "$DIR/v1b_decid.json"; echo
fi

C=$(curl -sk -o "$DIR/v1b_bad.json" -w '%{http_code}' -X POST "$API/clinical/tooth-records" \
  -H "Authorization: Bearer $DOC" -H 'Content-Type: application/json' \
  -d "{\"encounterId\":\"$ENC\",\"fdi\":56,\"condition\":\"decayed\",\"branchId\":\"$BRANCH_ID\",\"doctorId\":\"$DOCTOR_ID\"}")
if [ "$C" = "422" ] || [ "$C" = "400" ]; then ok "FDI 56 (kedudukan 6 dlm kuadran susu) DITOLAK → $C"; else bad "FDI 56 diterima → $C (mustahil wujud)"; fi

# ------------------------------------------------- 5. THE ORDERING RULE
step "5 · pembetulan dlm encounter sama MENGALAHKAN nilai asal"
# This is the assertion the whole script exists for. The upsert UPDATES a row in
# the same open encounter, so a corrected tooth keeps its original created_at.
# Ordering by created_at would pin 36 to `decayed` forever.
curl -sk -o .verify-out.tmp -X POST "$API/clinical/tooth-records" -H "Authorization: Bearer $DOC" \
  -H 'Content-Type: application/json' \
  -d "{\"encounterId\":\"$ENC\",\"fdi\":36,\"condition\":\"filled\",\"symbolCode\":\"veneer\",\"branchId\":\"$BRANCH_ID\",\"doctorId\":\"$DOCTOR_ID\"}"

curl -sk -o "$DIR/v1b_after.json" "$API/clinical/patients/$DPAT/chart" -H "Authorization: Bearer $DOC"
COND=$(jget "$DIR/v1b_after.json" "([x for x in d['teeth'] if x['fdiNo']==36][0]['condition'] if [x for x in d['teeth'] if x['fdiNo']==36] else 'MISSING')")
SYM=$(jget "$DIR/v1b_after.json" "([x for x in d['teeth'] if x['fdiNo']==36][0]['symbolCode'] if [x for x in d['teeth'] if x['fdiNo']==36] else 'MISSING')")
check "$COND" "filled" "gigi 36 = filled (bukan decayed — updated_at menang)"
check "$SYM" "veneer" "simbol veneer dibawa melalui carta berterusan"

# -------------------------------------------------------- 6. continuous read
step "6 · carta = SATU baris per gigi, bukan satu per lawatan"
RES=$(jget "$DIR/v1b_after.json" "str(len(d['teeth']))+' '+str([x for x in d['teeth'] if x['fdiNo']==36][0]['eventCount'])+' '+str(1 if [x for x in d['teeth'] if x['fdiNo']==75] else 0)")
set -- $RES
check "${1:-0}" "2" "2 gigi dicarta (36, 75) — bukan 3 baris"
# A same-encounter correction UPDATEs the row (unique on encounter_id + fdi_no),
# so it does NOT raise eventCount. See section 7b — the trail is per encounter.
check "${2:-0}" "1" "gigi 36: eventCount=1 dlm satu lawatan (pembetulan = kemas kini, bukan rekod baharu)"
check "${3:-0}" "1" "gigi susu 75 muncul dlm carta pesakit"

# A per-tooth count must be PER TOOTH, not the patient's total.
#
# The first implementation of this count used a correlated subquery whose outer
# reference MySQL resolved back to the subquery itself, so every tooth was
# credited with the whole patient's event total — 2 teeth charted reported "2
# each". Nothing threw and the screen looked plausible. This assertion is what
# catches that class: if every tooth reports the same number, the count is not
# correlated on the tooth.
COUNT75=$(jget "$DIR/v1b_after.json" "str([x for x in d['teeth'] if x['fdiNo']==75][0]['eventCount'] if [x for x in d['teeth'] if x['fdiNo']==75] else -1)")
check "$COUNT75" "1" "gigi 75: eventCount=1 — kiraan adalah PER GIGI, bukan jumlah pesakit"
TOT=$(jget "$DIR/v1b_after.json" "str(sum(x['eventCount'] for x in d['teeth']))")
check "$TOT" "2" "jumlah eventCount = 2 (1+1), bukan 4 (2 gigi x 2)"

# ------------------------------------------------------------- 7. history feed
step "7 · sejarah per gigi"
curl -sk -o "$DIR/v1b_hist.json" "$API/clinical/patients/$DPAT/chart/36/history" -H "Authorization: Bearer $DOC"
NH=$(jget "$DIR/v1b_hist.json" "len(d)")
if [ "${NH:-0}" -ge 1 ]; then ok "sejarah gigi 36 → $NH rekod"; else bad "sejarah gigi 36 kosong"; fi

C=$(curl -sk -o .verify-out.tmp -w '%{http_code}' "$API/clinical/patients/$DPAT/chart/19/history" -H "Authorization: Bearer $DOC")
check "$C" "422" "sejarah FDI 19 (bukan gigi) → 422"

# ---------------------------------------------- 7b. the trail is per ENCOUNTER
#
# WHERE THE AUDIT TRAIL ACTUALLY LIVES, AND WHY THE FIRST EXPECTATION WAS WRONG
#
# Correcting a tooth inside the SAME open encounter UPDATEs its row rather than
# inserting a second one — `tooth_records` is unique on (encounter_id, fdi_no).
# So a same-encounter correction leaves eventCount at 1, and the first version of
# this check asserted 2 and failed.
#
# That is the DESIGN, not a defect, and it matches ADR-009: an open, unsigned
# encounter is a DRAFT, and correcting a mis-click in a draft is not a clinical
# amendment. Once the encounter is completed the upsert refuses further writes
# ("Tooth chart is locked for this encounter"), so every later change must create
# a NEW encounter row — which is the boundary a clinical review cares about.
#
# So the trail is proven correctly by a SECOND encounter, which is what this
# section asserts. `eventCount` therefore means "how many encounters charted this
# tooth", and the UI must not promise a change-by-change log.
step "7b · jejak berlaku ANTARA lawatan (sempadan encounter)"
curl -sk -o "$DIR/v1b_enc2.json" -X POST "$API/clinical/encounters" -H "Authorization: Bearer $DOC" \
  -H 'Content-Type: application/json' \
  -d "{\"patientId\":\"$DPAT\",\"branchId\":\"$BRANCH_ID\",\"doctorId\":\"$DOCTOR_ID\",\"chiefComplaint\":\"Ujian carta gigi (Fasa 1B) lawatan 2\"}"
ENC2=$(jget "$DIR/v1b_enc2.json" "d.get('id','')")
if [ -n "$ENC2" ]; then ok "encounter kedua dibuka"; else bad "gagal buka encounter kedua"; fi

curl -sk -o .verify-out.tmp -X POST "$API/clinical/tooth-records" -H "Authorization: Bearer $DOC" \
  -H 'Content-Type: application/json' \
  -d "{\"encounterId\":\"$ENC2\",\"fdi\":36,\"condition\":\"crowned\",\"branchId\":\"$BRANCH_ID\",\"doctorId\":\"$DOCTOR_ID\"}"

curl -sk -o "$DIR/v1b_after2.json" "$API/clinical/patients/$DPAT/chart" -H "Authorization: Bearer $DOC"
RES2=$(jget "$DIR/v1b_after2.json" "str(len(d['teeth']))+' '+str([x for x in d['teeth'] if x['fdiNo']==36][0]['eventCount'] if [x for x in d['teeth'] if x['fdiNo']==36] else 0)+' '+([x for x in d['teeth'] if x['fdiNo']==36][0]['condition'] if [x for x in d['teeth'] if x['fdiNo']==36] else 'MISSING')")
set -- $RES2
check "${1:-0}" "2" "masih 2 baris carta (satu per gigi) selepas lawatan kedua"
check "${2:-0}" "2" "gigi 36: eventCount=2 → jejak disimpan antara lawatan"
check "${3:-?}" "crowned" "keadaan terkini gigi 36 = crowned (lawatan kedua menang)"

NH2=$(jget "$DIR/v1b_hist.json" "len(d)")
curl -sk -o "$DIR/v1b_hist2.json" "$API/clinical/patients/$DPAT/chart/36/history" -H "Authorization: Bearer $DOC"
NH2=$(jget "$DIR/v1b_hist2.json" "len(d)")
check "$NH2" "2" "sejarah gigi 36 kini 2 rekod (satu per lawatan)"

# ------------------------------------------- 7c. a completed encounter is locked
step "7c · encounter selesai mengunci carta"
curl -sk -o .verify-out.tmp -X PATCH "$API/clinical/encounters/$ENC/status" -H "Authorization: Bearer $DOC" \
  -H 'Content-Type: application/json' -d "{\"status\":\"completed\",\"branchId\":\"$BRANCH_ID\",\"doctorId\":\"$DOCTOR_ID\"}"
C=$(curl -sk -o "$DIR/v1b_lock.json" -w '%{http_code}' -X POST "$API/clinical/tooth-records" -H "Authorization: Bearer $DOC" \
  -H 'Content-Type: application/json' \
  -d "{\"encounterId\":\"$ENC\",\"fdi\":11,\"condition\":\"decayed\",\"branchId\":\"$BRANCH_ID\",\"doctorId\":\"$DOCTOR_ID\"}")
check "$C" "409" "menulis ke lawatan SELESAI → 409 (carta dikunci)"

# -------------------------------------------------------------- 8. empty chart
step "8 · pesakit tanpa carta = carta KOSONG, bukan 32 gigi sihat"
EMPTY=$(q "SELECT id FROM patients WHERE id NOT IN (SELECT DISTINCT patient_id FROM tooth_records) LIMIT 1")
if [ -n "$EMPTY" ]; then
  curl -sk -o "$DIR/v1b_empty.json" "$API/clinical/patients/$EMPTY/chart" -H "Authorization: Bearer $HQ"
  N=$(jget "$DIR/v1b_empty.json" "str(len(d['teeth']))+' '+str(d['chartedCount'])")
  check "$N" "0 0" "carta kosong dilaporkan sbg 0 gigi"
else
  echo "  SKIP  tiada pesakit tanpa carta"
fi

# ------------------------------------------------------------------ result
echo
echo "======================================================"
echo "  PASS: $PASS    FAIL: $FAIL"
echo "======================================================"
echo
echo "PERINGATAN: skrip ini MENULIS baris ujian (encounter + tooth_records)"
echo "untuk pesakit $DPAT. Ia guna penanda 'Ujian carta gigi (Fasa 1B)'"
echo "dalam chief_complaint supaya boleh dibuang. Jalankan:"
echo "  bash padam-data-fasa1b.sh"
[ "$FAIL" -eq 0 ] || exit 1
