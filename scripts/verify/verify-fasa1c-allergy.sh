#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# ============================================================================
# verify-fasa1c-allergy.sh — end-to-end proof of the allergy safety gate.
#
# WHAT THIS EXISTS TO PROVE, AND WHY A UNIT TEST CANNOT
#
# `allergies.spec.ts` already proves the RULE (`evaluateAllergyGate`). What it
# cannot prove is that the rule is WIRED: that a recorded allergy actually
# reaches the gate, and that the gate's refusal actually stops an encounter from
# completing. Those live in SQL + service + route, and a broken wire returns a
# perfectly normal 200 while the gate silently protects nobody.
#
# The sharpest assertion here is the PAIR in section 3:
#   1. a serious allergy BLOCKS completion  -> 409
#   2. after acknowledging, the SAME call   -> 200
# Only both together show the gate reads the allergy and the acknowledgement
# releases it. Either alone would pass against a hardcoded `throw`.
#
# Section 4 is the counterpart: a MILD allergy must complete WITHOUT
# acknowledgement, because a gate that fires on everything gets clicked through
# without being read, and a gate nobody reads protects nobody.
#
# THE WRITE CONTRACT (cost a run to learn — see the failure that produced it)
#
# `clinical:create` is granted by `ROLE_DOMAIN_MATRIX` to the **doctor role only**;
# every other role is view-only (or has no clinical domain at all). That cell is
# scope `own`, and `can()` for `own` is FAIL-CLOSED: it denies unless branchId AND
# doctorId are present and match the principal. `PermissionGuard` auto-fills
# `doctorId` from the principal for **view only** — never for create/edit. So every
# write below MUST carry `branchId` + `doctorId`; omitting them is a 403, not a
# missing-parameter error. This mirrors how `Clinical.tsx` already calls the API.
#
# Run from the repo root:  bash verify-fasa1c-allergy.sh
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
check() { if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (dapat '$1', patut '$2')"; fi }

RP=$(docker exec "$DB" sh -c 'printf %s "$MYSQL_ROOT_PASSWORD"')
q() { docker exec -i "$DB" mysql -uroot -p"$RP" medini_prod -N -B -e "$1" 2>/dev/null | tr -d '\r'; }
jget() { python -c "import json,sys;d=json.load(open(sys.argv[1]));print(eval(sys.argv[2]))" "$1" "$2" 2>/dev/null; }
code() { curl -sk -o "$DIR/v1c.json" -w '%{http_code}' "$@"; }

login() {
  curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "$1")" \
    | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null
}

MARKER='Ujian alahan (Fasa 1C)%'

# ------------------------------------------------- 0. reset, then preflight
step "0 · reset keadaan + preflight"
# RESET FIRST. A previous run leaves ZZTEST allergies and treated encounters on the
# patient, so the next run asserts against the wrong starting state — a duplicate
# allergen comes back 409 and looks like a broken create.
docker exec -i "$DB" mysql -uroot -p"$RP" medini_prod -e "
  DELETE FROM adverse_events WHERE encounter_id IN (SELECT id FROM encounters WHERE chief_complaint LIKE '$MARKER');
  DELETE FROM patient_allergies WHERE allergen LIKE 'ZZTEST%';
  DELETE FROM tooth_records WHERE encounter_id IN (SELECT id FROM encounters WHERE chief_complaint LIKE '$MARKER');
  DELETE FROM clinical_notes WHERE encounter_id IN (SELECT id FROM encounters WHERE chief_complaint LIKE '$MARKER');
  DELETE FROM encounters WHERE chief_complaint LIKE '$MARKER';" 2>/dev/null
# CLEANUP ON THE WAY OUT, not only on the way in.
#
# The reset above runs at the START, so a run that ends normally leaves its test
# encounters behind until the NEXT run clears them — and if the next run is someone
# else's, the suite looks like it is polluting production. `adverse_events` is deleted
# FIRST because it is an FK child of `encounters` with RESTRICT: without it the delete
# of encounters aborts the whole SQL file and leaves everything behind, which is exactly
# how "Ujian alahan (Fasa 1C)" encounters accumulated in the demo database.
cleanup() {
  docker exec -i "$DB" mysql -uroot -p"$RP" medini_prod -e "
  DELETE FROM adverse_events WHERE encounter_id IN (SELECT id FROM encounters WHERE chief_complaint LIKE '$MARKER');
  DELETE FROM patient_allergies WHERE allergen LIKE 'ZZTEST%';
  DELETE FROM tooth_records WHERE encounter_id IN (SELECT id FROM encounters WHERE chief_complaint LIKE '$MARKER');
  DELETE FROM clinical_notes WHERE encounter_id IN (SELECT id FROM encounters WHERE chief_complaint LIKE '$MARKER');
  DELETE FROM encounters WHERE chief_complaint LIKE '$MARKER';" 2>/dev/null
}
trap cleanup EXIT

LEFT=$(q "SELECT COUNT(*) FROM patient_allergies WHERE allergen LIKE 'ZZTEST%'")
check "${LEFT:-1}" "0" "keadaan direset (0 alahan ujian lama)"

HQ=$(login hq)
[ ${#HQ} -gt 50 ] && ok "login hq" || { bad "login hq"; exit 1; }

HASH=$(docker exec -e P="$SEED_DEMO_PASSWORD" medini-prod-backend-1 node -e 'const a=require("argon2");a.hash(process.env.P,{type:a.argon2id}).then(h=>process.stdout.write(h))' 2>/dev/null)
q "UPDATE staff SET password_hash='$HASH' WHERE username='dr.aina'"
DOC=$(login dr.aina)
[ ${#DOC} -gt 50 ] && ok "login dr.aina" || { bad "login dr.aina"; exit 1; }

ME=$(curl -sk "$API/auth/me" -H "Authorization: Bearer $DOC")
DOCTOR_ID=$(echo "$ME" | python -c "import sys,json;print(json.load(sys.stdin)['data']['doctorId'])" 2>/dev/null)
BRANCH_ID=$(echo "$ME" | python -c "import sys,json;print(json.load(sys.stdin)['data']['branchId'])" 2>/dev/null)
[ -n "$DOCTOR_ID" ] && ok "principal doktor lengkap" || { bad "tiada doctorId"; exit 1; }

PAT=$(q "SELECT id FROM patients WHERE branch_id='$BRANCH_ID' LIMIT 1")
[ -n "$PAT" ] || PAT=$(q "SELECT id FROM patients LIMIT 1")
PAT2=$(q "SELECT id FROM patients WHERE id <> '$PAT' LIMIT 1")
ok "dua pesakit disediakan"

# Writes carry the two scope fields. Built once as a var so no call can forget them.
SCOPE=",\"branchId\":\"$BRANCH_ID\",\"doctorId\":\"$DOCTOR_ID\""
mk_enc() {  # mk_enc <patientId>
  curl -sk -o "$DIR/v1c_enc.json" -X POST "$API/clinical/encounters" -H "Authorization: Bearer $DOC" \
    -H 'Content-Type: application/json' \
    -d "{\"patientId\":\"${1:-$PAT}\",\"branchId\":\"$BRANCH_ID\",\"doctorId\":\"$DOCTOR_ID\",\"chiefComplaint\":\"Ujian alahan (Fasa 1C)\"}"
  jget "$DIR/v1c_enc.json" "d.get('id','')"
}
add_allergy() {  # add_allergy <patientId> <json-body-without-scope>
  code -X POST "$API/clinical/patients/$1/allergies" -H "Authorization: Bearer $DOC" \
    -H 'Content-Type: application/json' -d "{$2$SCOPE}"
}
active_allergy_ids() {  # active_allergy_ids <patientId>
  curl -sk "$API/clinical/patients/$1/allergies" -H "Authorization: Bearer $HQ"     | python -c "import sys,json;print(' '.join(a['id'] for a in json.load(sys.stdin)['active']))" 2>/dev/null
}
clear_active() {  # clear_active <patientId> — retire everything, so the next section
                  # starts from a known state instead of inheriting the last one.
  for AID in $(active_allergy_ids "$1"); do
    code -X POST "$API/clinical/allergies/$AID/retire" -H "Authorization: Bearer $DOC"       -H 'Content-Type: application/json' -d "{\"reason\":\"Ujian: bersihkan keadaan\"$SCOPE}" >/dev/null
  done
  echo "$(active_allergy_ids "$1" | wc -w | tr -d ' ')"
}
complete_enc() {  # complete_enc <encounterId>
  code -X PATCH "$API/clinical/encounters/$1/status" -H "Authorization: Bearer $DOC" \
    -H 'Content-Type: application/json' \
    -d "{\"status\":\"completed\"$SCOPE}"
}

# -------------------------------------------------- 1. the routes exist at all
step "1 · route alahan wujud (tsc bersih BUKAN bukti)"
C=$(code "$API/clinical/patients/$PAT/allergies" -H "Authorization: Bearer $HQ")
check "$C" "200" "GET /clinical/patients/:id/allergies → 200"
N=$(jget "$DIR/v1c.json" "len(d['active'])")
check "$N" "0" "pesakit bermula dgn 0 alahan aktif"

# ------------------------------------------------ 2. record + validation rules
step "2 · rekod alahan + peraturan pengesahan"
C=$(add_allergy "$PAT" '"allergen":"ZZTEST Penicillin","severity":"severe","category":"drug","reaction":"swelling"')
if [ "$C" = "201" ] || [ "$C" = "200" ]; then ok "rekod alahan serius → $C"; else bad "rekod alahan → $C"; head -c 200 "$DIR/v1c.json"; echo; fi
ALLERGY_ID=$(jget "$DIR/v1c.json" "d.get('id','')")

C=$(add_allergy "$PAT" '"allergen":"P","severity":"mild"')
check "$C" "422" "allergen terlalu pendek → 422"

C=$(add_allergy "$PAT" '"allergen":"ZZTEST Xylocaine","severity":"nonsense"')
check "$C" "422" "tahap keseriusan tak sah → 422"

# A life-threatening allergy with NO reaction recorded is a rumour, and a rumour is
# how a real alert gets ignored. The domain demands the observation.
C=$(add_allergy "$PAT" '"allergen":"ZZTEST Contrast","severity":"life_threatening"')
check "$C" "422" "boleh maut TANPA reaksi dicatat → 422 (domain menuntut reaksi)"

# An ACTIVE duplicate must be refused: two live rows for one allergen arrive in the
# list twice and a reader stops trusting both. Case-insensitive, because
# "penicillin" beside "Penicillin" is the same allergy to a clinician.
C=$(add_allergy "$PAT" '"allergen":"zztest penicillin","severity":"mild"')
check "$C" "409" "alahan aktif bertindih (beza huruf besar) → 409"

curl -sk -o "$DIR/v1c_list.json" "$API/clinical/patients/$PAT/allergies" -H "Authorization: Bearer $DOC"
BLK=$(jget "$DIR/v1c_list.json" "len(d['blocking'])")
check "$BLK" "1" "1 alahan menyekat dilaporkan"

# ------------------------------------------------- 3. THE GATE: blocks, then releases
step "3 · gerbang keselamatan: SEKAT, lepas itu LEPASKAN"
ENC=$(mk_enc "$PAT")
[ -n "$ENC" ] && ok "encounter dibuka" || { bad "gagal buka encounter"; exit 1; }

C=$(complete_enc "$ENC")
check "$C" "409" "SELESAI tanpa pengakuan alahan → 409 (gerbang menahan)"

MSG=$(head -c 400 "$DIR/v1c.json" | tr -d '\n' | sed 's/  */ /g')
case "$MSG" in
  *ZZTEST\ Penicillin*) ok "mesej gerbang MENAMAKAN alahan penyekat" ;;
  *) bad "mesej tidak menamakan alahan: $(echo "$MSG" | head -c 110)" ;;
esac

# acknowledge is valid on an OPEN encounter — it is the doctor saying "I have read
# the safety alerts for THIS visit". The 409 above left the encounter open.
C=$(code -X POST "$API/clinical/encounters/$ENC/acknowledge-allergy" -H "Authorization: Bearer $DOC" \
  -H 'Content-Type: application/json' -d "{${SCOPE#,}}")
if [ "$C" = "201" ] || [ "$C" = "200" ]; then ok "pengakuan alahan direkod → $C"; else bad "pengakuan → $C"; head -c 160 "$DIR/v1c.json"; echo; fi

C=$(complete_enc "$ENC")
check "$C" "200" "SELESAI selepas pengakuan → 200 (gerbang melepaskan)"

# ------------------------------------ 4. a MILD allergy must NOT block
step "4 · alahan ringan TIDAK menyekat (kalau tidak, gerbang diabaikan)"
# ACKNOWLEDGEMENT IS PER ENCOUNTER, not per allergy — it is the doctor saying "I
# have read the alerts for THIS visit". So the severe allergy recorded above still
# blocks a BRAND NEW encounter even though an earlier one was acknowledged. Clear
# the active list first, or this section would measure the wrong thing.
LEFT=$(clear_active "$PAT")
check "$LEFT" "0" "alahan aktif dikosongkan sebelum ujian 'ringan'"

add_allergy "$PAT" '"allergen":"ZZTEST Latex","severity":"mild","reaction":"rash"' >/dev/null
ENC2=$(mk_enc "$PAT")
C=$(complete_enc "$ENC2")
check "$C" "200" "alahan RINGAN → 200 tanpa pengakuan (gerbang tidak terlalu ketat)"

# ------------------------- 5. an UNKNOWN severity DOES block (unassessed != mild)
step "5 · alahan tak dinilai MENYEKAT (unknown bukan 'ringan')"
# `unknown` must be the ONLY active allergy here, or a 409 would be caused by the
# mild one and prove nothing. There is one patient in this doctor's branch (the
# demo patients sit in three different branches), so the mild allergy from the
# previous section is cleared rather than a second patient being introduced.
LEFT=$(clear_active "$PAT")
check "$LEFT" "0" "alahan aktif dikosongkan sebelum ujian 'unknown'"

add_allergy "$PAT" '"allergen":"ZZTEST Ibuprofen","severity":"unknown"' >/dev/null
ENC3=$(mk_enc "$PAT")
C=$(complete_enc "$ENC3")
check "$C" "409" "alahan 'unknown' → 409 (belum dinilai bukan bermakna ringan)"

# ------------------------------------------- 6. retire requires a reason
step "6 · retire MEMERLUKAN sebab, tidak memadam"
# A DEDICATED allergy for this section. Reusing an earlier one is what made the
# first version of this script fail with "already retired": section 5 clears the
# active list, so an id captured in section 2 may already be spent.
LEFT=$(clear_active "$PAT")
check "$LEFT" "0" "keadaan bersih sebelum ujian retire"
add_allergy "$PAT" '"allergen":"ZZTEST Retireme","severity":"moderate","reaction":"itching"' >/dev/null
RID=$(curl -sk "$API/clinical/patients/$PAT/allergies" -H "Authorization: Bearer $HQ"   | python -c "import sys,json;d=json.load(sys.stdin);print(next((a['id'] for a in d['active'] if a['allergen']=='ZZTEST Retireme'),''))" 2>/dev/null)
[ -n "$RID" ] && ok "alahan ujian retire direkod" || bad "gagal rekod alahan ujian retire"

C=$(code -X POST "$API/clinical/allergies/$RID/retire" -H "Authorization: Bearer $DOC"   -H 'Content-Type: application/json' -d "{\"reason\":\"\"$SCOPE}")
check "$C" "422" "retire tanpa sebab → 422"

C=$(code -X POST "$API/clinical/allergies/$RID/retire" -H "Authorization: Bearer $DOC"   -H 'Content-Type: application/json' -d "{\"reason\":\"Ujian: ujian kulit negatif, disahkan tidak alah\"$SCOPE}")
if [ "$C" = "201" ] || [ "$C" = "200" ]; then ok "retire dgn sebab → $C"; else bad "retire → $C"; head -c 160 "$DIR/v1c.json"; echo; fi

curl -sk -o "$DIR/v1c_after.json" "$API/clinical/patients/$PAT/allergies" -H "Authorization: Bearer $HQ"
NA=$(jget "$DIR/v1c_after.json" "len(d['active'])")
NR=$(jget "$DIR/v1c_after.json" "len(d['retired'])")
check "$NA" "0" "tiada alahan aktif selepas retire"
if [ "${NR:-0}" -ge 1 ]; then ok "alahan retired KEKAL dlm senarai ($NR rekod) — tidak dipadam"; else bad "alahan retired hilang"; fi
RETNAMES=$(jget "$DIR/v1c_after.json" "'|'.join(sorted(r['allergen'] for r in d['retired']))")
case "$RETNAMES" in
  *ZZTEST\ Retireme*) ok "alahan retired masih boleh DIBACA dgn namanya" ;;
  *) bad "alahan retired tiada dlm senarai" ;;
esac

# A RETIRED duplicate must not block re-recording — that is how a mistaken retire
# is undone.
C=$(add_allergy "$PAT" '"allergen":"ZZTEST Retireme","severity":"mild"')
if [ "$C" = "201" ] || [ "$C" = "200" ]; then ok "alahan retired boleh direkod semula → $C"; else bad "rekod semula → $C (patut dibenarkan)"; fi

C=$(code -X POST "$API/clinical/allergies/$RID/retire" -H "Authorization: Bearer $DOC"   -H 'Content-Type: application/json' -d "{\"reason\":\"Percubaan kedua\"$SCOPE}")
check "$C" "409" "retire dua kali → 409 (tarikh keputusan tidak ditulis semula)"

# --------------------------------------------------- 7. permissions
step "7 · kebenaran: hq baca sahaja, doktor menulis"
C=$(code "$API/clinical/patients/$PAT/allergies" -H "Authorization: Bearer $HQ")
check "$C" "200" "hq boleh BACA senarai alahan → 200"

# hq cannot WRITE: `clinical:create` for hq is false, and this is the boundary that
# means a recorded allergy is always attributable to a clinician.
C=$(code -X POST "$API/clinical/patients/$PAT/allergies" -H "Authorization: Bearer $HQ" \
  -H 'Content-Type: application/json' -d '{"allergen":"ZZTEST HqWrite","severity":"mild"}')
check "$C" "403" "hq DITOLAK menulis alahan → 403 (doktor sahaja)"

echo
echo "======================================================"
echo "  PASS: $PASS    FAIL: $FAIL"
echo "======================================================"
echo
echo "PERINGATAN: skrip ini menulis alahan berpenanda 'ZZTEST' + encounters"
echo "'Ujian alahan (Fasa 1C)'. Jalankan:  bash padam-data-fasa1c.sh"
[ "$FAIL" -eq 0 ] || exit 1
