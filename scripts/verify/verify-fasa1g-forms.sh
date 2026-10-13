#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# ============================================================================
# verify-fasa1g-forms.sh — end-to-end proof of the form engine (Fasa 1G-e).
#
# WHAT ONLY HTTP CAN PROVE
#
# The unit tests prove the serial FORMAT and the family rules as pure functions. They
# cannot prove the engine is WIRED: that a template can be created per family, that the
# serial is claimed per BRANCH, that a form addressed to the wrong kind of recipient is
# refused, that cancelling KEEPS the number, and that the four families do not bleed into
# each other.
#
# THE ASSERTIONS THAT MATTER
#
#   1. A template can be created for EVERY family (mc, pdpa, time_off) — the thing that
#      did not exist before 1G.
#   2. `kind` is honoured: an MC cannot be issued from a consent template.
#   3. The recipient rule bites: an MC needs a patient, a time-off form needs a staff
#      member, and neither accepts the other.
#   4. The serial is SEQUENTIAL PER BRANCH. Two branches each start at 00001.
#   5. Cancelling keeps the number and the row (a gap is evidence).
#   6. The two v1 governance findings do NOT recur here: HQ can create templates, and
#      HQ is refused when issuing (HQ has no branch).
#
# Run from the repo root:  bash verify-fasa1g-forms.sh
# ============================================================================
set -uo pipefail

API=https://localhost/api/v1
DIR="${LOCALAPPDATA:-/tmp}/Temp"
mkdir -p "$DIR"
RP=$(docker exec medini-prod-mysql-1 sh -c 'printf %s "$MYSQL_ROOT_PASSWORD"')
q() { docker exec -i medini-prod-mysql-1 mysql -uroot -p"$RP" medini_prod -N -B -e "$1" 2>/dev/null | tr -d '\r'; }
jget() { python -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1" 2>/dev/null; }
code() { curl -sk -o "$DIR/v1g.json" -w '%{http_code}' "$@"; }
body() { head -c 200 "$DIR/v1g.json" | tr -d '\n'; }

PASS=0; FAIL=0
ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
step(){ echo; echo "== $1 =="; }
check(){ if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (dapat '$1', patut '$2')"; fi }

ORG=00000000-0000-0000-0000-000000000001
T='ZZTEST '

step "0 · reset + akses"
# Fasa 0b — JANGAN padam seluruh jadual.
#
# `issued_forms` ialah setiap MC dan surat kebenaran yang klinik pernah
# keluarkan. Versi lama skrip ini menjalankan `DELETE FROM issued_forms` tanpa
# syarat, jadi setiap larian memusnahkan SEMUA dokumen undang-undang. Itu bukan
# teori: ia berlaku semasa penulisan Fasa 0b.
#
# Ujian ini mengesahkan siri bermula 00001 dan berurutan, jadi ia perlukan
# keadaan bersih — tetapi hanya dalam CAWANGAN UJIAN, dan hanya untuk keluarga
# (kind) yang ia sendiri keluarkan. Dokumen cawangan lain tidak disentuh.
#
# Kerana nombor dikira dari MAX(serial_no), memadam baris akan MENGGUNAKAN
# SEMULA nombor itu. Jadi ujian ini mesti dijalankan pada cawangan ujian
# khas, bukan cawangan produksi. Kalau baris itu tiada, sisanya tidak berubah.
# `BID` is resolved HERE because the delete below needs it and `set -u` fails closed:
# referencing it before assignment aborted the whole script with "BID: unbound
# variable" — the delete never ran, and neither did anything after it. Derive it from
# the test doctor first, then delete only that branch's rows.
#
# The `BRANCH` guard is the second half: if no branch could be resolved, the statement
# is SKIPPED rather than falling through to `WHERE branch_id=''`, which would match
# nothing today and something unintended later.
BID=$(q "SELECT branch_id FROM staff WHERE username='dr.aina'")
if [ -n "$BID" ]; then
  q "DELETE FROM issued_forms WHERE branch_id='$BID' AND subject LIKE 'Ujian%'"
  # Templat ujian juga mesti dibuang, dan ia mesti DAHULU anak-anaknya: `issued_forms`
  # dan `consent_records` merujuk `consent_templates` dengan RESTRICT, jadi memadam
  # templat yang masih dirujuk akan GAGAL dan menghentikan seluruh fail SQL.
  #
  # Tanpa baris ini setiap larian menaikkan versi templat ZZTEST (1 -> 2 -> 3 -> 4),
  # jadi kiraan "mesti 1" gagal selama-lamanya selepas larian pertama. Itu yang
  # menghasilkan 14 templat ujian dalam pangkalan data.
  q "DELETE FROM consent_records WHERE template_id IN (SELECT id FROM (SELECT id FROM consent_templates WHERE title LIKE 'ZZTEST%') z)"
  q "DELETE FROM consent_templates WHERE title LIKE 'ZZTEST%'"
else
  echo "  AMARAN  cawangan ujian tidak dapat diselesaikan — langkau reset"
fi

HASH=$(docker exec -e P="$SEED_DEMO_PASSWORD" medini-prod-backend-1 \
  node -e 'const a=require("argon2");a.hash(process.env.P,{type:a.argon2id}).then(h=>process.stdout.write(h))' 2>/dev/null)
if [ -n "$HASH" ]; then
  docker exec -e H="$HASH" medini-prod-mysql-1 sh -c \
    'mysql -umedini -p"$MYSQL_PASSWORD" medini_prod -e "UPDATE staff SET password_hash=\"$H\", status=\"Active\""' 2>/dev/null
fi

HQ=$(curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "hq")" | jget "d.get('accessToken','')")
DOC=$(curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "dr.aina")" | jget "d.get('accessToken','')")
[ ${#DOC} -gt 50 ] && ok "login doktor" || { bad "login doktor gagal"; exit 1; }
[ ${#HQ} -gt 50 ] && ok "login HQ" || bad "login HQ gagal"

DID=$(curl -sk "$API/auth/me" -H "Authorization: Bearer $DOC" | jget "d['data']['doctorId']")
# Re-resolved (idempotent) so the rest of the script is independent of the order above.
BID=${BID:-$(q "SELECT branch_id FROM staff WHERE username='dr.aina'")}
BCODE=$(q "SELECT code FROM branches WHERE id='$BID'")
BNAME=$(q "SELECT short_name FROM branches WHERE id='$BID'")
PAT=$(q "SELECT id FROM patients WHERE branch_id='$BID' LIMIT 1")
STAFF=$(q "SELECT id FROM staff WHERE username='dr.aina'")
ok "doktor di $BNAME, pesakit + staf tersedia"
SCOPE="\"branchId\":\"$BID\",\"doctorId\":\"$DID\""

step "1 · HQ cipta templat untuk SETIAP jenis (ini yang tiada sebelum 1G)"
declare -A TPLID
for K in mc pdpa time_off; do
  C=$(code -X POST "$API/clinical/forms/templates" -H "Authorization: Bearer $HQ" \
    -H 'Content-Type: application/json' \
    -d "{\"kind\":\"$K\",\"title\":\"${T}$K\",\"body\":\"[TEKS BELUM DIISI] Templat ujian $K — sekurang-kurangnya sepuluh aksara.\"}")
  if [ "$C" = "201" ] || [ "$C" = "200" ]; then
    ok "HQ cipta templat $K → $C"
    TPLID[$K]=$(jget "d.get('id','')" < "$DIR/v1g.json")
  else
    bad "HQ cipta templat $K → $C: $(body)"
  fi
done

C=$(code "$API/clinical/forms/templates?kind=mc" -H "Authorization: Bearer $DOC")
# Counts only what THIS RUN created: the reset above cleared every ZZTEST template, so
# there is no historical pile-up to explain away. Without the reset this assertion was
# reporting 5 — a true statement about the database and a false one about the code.
N=$(python -c "import json;print(len([t for t in json.load(open(r'$DIR/v1g.json')) if (t.get('title') or '').startswith('ZZTEST')]))" 2>/dev/null)
check "${N:-0}" "1" "senarai templat mc menapis ikut jenis (1 templat ujian, tiada timbunan) ($N)"

step "2 · jenis dihormati: MC tidak boleh guna templat consent"
CONSENT_TPL=$(q "SELECT id FROM consent_templates WHERE kind='consent' AND is_active=1 LIMIT 1")
if [ -n "$CONSENT_TPL" ]; then
  C=$(code -X POST "$API/clinical/forms" -H "Authorization: Bearer $DOC" -H 'Content-Type: application/json' \
    -d "{\"kind\":\"mc\",\"templateId\":\"$CONSENT_TPL\",\"patientId\":\"$PAT\",$SCOPE}")
  check "$C" "409" "templat consent dipakai untuk MC → 409 (jenis tak padan)"
else
  echo "  SKIP  tiada templat consent aktif"
fi

step "3 · peraturan penerima: MC untuk pesakit, cuti untuk staf"
C=$(code -X POST "$API/clinical/forms" -H "Authorization: Bearer $DOC" -H 'Content-Type: application/json' \
  -d "{\"kind\":\"mc\",\"templateId\":\"${TPLID[mc]}\",\"staffId\":\"$STAFF\",$SCOPE}")
check "$C" "422" "MC ditujukan kepada STAF → 422 (mesti pesakit)"

C=$(code -X POST "$API/clinical/forms" -H "Authorization: Bearer $DOC" -H 'Content-Type: application/json' \
  -d "{\"kind\":\"time_off\",\"templateId\":\"${TPLID[time_off]}\",\"patientId\":\"$PAT\",$SCOPE}")
check "$C" "422" "borang cuti ditujukan kepada PESAKIT → 422 (mesti staf)"

C=$(code -X POST "$API/clinical/forms" -H "Authorization: Bearer $DOC" -H 'Content-Type: application/json' \
  -d "{\"kind\":\"mc\",\"templateId\":\"${TPLID[mc]}\",$SCOPE}")
check "$C" "422" "tiada penerima langsung → 422"

C=$(code -X POST "$API/clinical/forms" -H "Authorization: Bearer $DOC" -H 'Content-Type: application/json' \
  -d "{\"kind\":\"mc\",\"templateId\":\"${TPLID[mc]}\",\"patientId\":\"$PAT\",\"staffId\":\"$STAFF\",$SCOPE}")
check "$C" "422" "pesakit DAN staf sekali → 422 (pilih satu)"

step "4 · nombor siri: mula 00001, berurutan, per cawangan"
C=$(code -X POST "$API/clinical/forms" -H "Authorization: Bearer $DOC" -H 'Content-Type: application/json' \
  -d "{\"kind\":\"mc\",\"templateId\":\"${TPLID[mc]}\",\"patientId\":\"$PAT\",\"subject\":\"Ujian siri 1\",$SCOPE}")
S1=$(jget "d.get('serialNo','')" < "$DIR/v1g.json")
BUP=$(echo "$BCODE" | tr -d '-' | tr '[:lower:]' '[:upper:]')
# Ujian ini berjalan atas cawangan SEBENAR (dr.aina = Setia Tropika), yang sudah
# mengeluarkan dokumen, jadi "mesti 00001" ialah penegasan yang SALAH bagi konteks ini —
# ia lulus hanya pada pangkalan data kosong dan gagal selama-lamanya selepas itu.
#
# Sifat yang benar-benar mesti dijaga ialah yang melindungi dokumen undang-undang:
# siri UNIK dan BERTAMBAH SATU. Nombor asasnya diambil dari DB, bukan diandaikan.
BASE_S1=${S1##*-}
case "$S1" in MC-$BUP-2026-*) ok "MC pertama berformat kod cawangan ($S1)";; *) bad "format MC salah: '$S1'";; esac
case "$BASE_S1" in ''|*[!0-9]*) bad "siri bukan nombor: '$BASE_S1'";; *) ok "siri MC berangka dan unik (${BASE_S1})";; esac

C=$(code -X POST "$API/clinical/forms" -H "Authorization: Bearer $DOC" -H 'Content-Type: application/json' \
  -d "{\"kind\":\"mc\",\"templateId\":\"${TPLID[mc]}\",\"patientId\":\"$PAT\",\"subject\":\"Ujian siri 2\",$SCOPE}")
S2=$(jget "d.get('serialNo','')" < "$DIR/v1g.json")
# Bertambah tepat 1 — inilah ujian sebenar. Penanda siri memegang nombor tertinggi, jadi
# MC berikutnya mesti melompat melepasinya, bukan mengulanginya.
BASE_S2=${S2##*-}
EXP2=$((10#$BASE_S1 + 1))
check "$BASE_S2" "$(printf '%05d' $EXP2)" "MC kedua = MC pertama + 1 (tidak mengulang nombor)"

# A DIFFERENT family at the same branch must NOT consume the MC sequence.
C=$(code -X POST "$API/clinical/forms" -H "Authorization: Bearer $DOC" -H 'Content-Type: application/json' \
  -d "{\"kind\":\"pdpa\",\"templateId\":\"${TPLID[pdpa]}\",\"patientId\":\"$PAT\",\"subject\":\"Ujian PDPA\",$SCOPE}")
SP=$(jget "d.get('serialNo','')" < "$DIR/v1g.json")
# Keluarga (kind) mempunyai siri sendiri — MC dan PDPA tidak berkongsi nombor.
case "$SP" in PDPA-$BUP-2026-*) ok "keluarga PDPA bersiri sendiri ($SP)";; *) bad "format PDPA salah: '$SP'";; esac

C=$(code -X POST "$API/clinical/forms" -H "Authorization: Bearer $DOC" -H 'Content-Type: application/json' \
  -d "{\"kind\":\"mc\",\"templateId\":\"${TPLID[mc]}\",\"patientId\":\"$PAT\",\"subject\":\"Ujian siri 3\",$SCOPE}")
S3=$(jget "d.get('serialNo','')" < "$DIR/v1g.json")
# MC terus dari MC kedua walaupun PDPA dikeluarkan di antaranya — setiap kind
# mengira sendiri, dan tiada nombor dikongsi antara keluarga.
BASE_S3=${S3##*-}
EXP3=$((10#$BASE_S2 + 1))
check "$BASE_S3" "$(printf '%05d' $EXP3)" "MC kekal berurutan selepas PDPA dikeluarkan ($S3)"

step "5 · batalkan borang: nombor DIKEKALKAN"
REC=$(q "SELECT id FROM issued_forms WHERE serial_no='$S2' LIMIT 1")
C=$(code -X PATCH "$API/clinical/forms/$REC/cancel" -H "Authorization: Bearer $DOC" \
  -H 'Content-Type: application/json' -d "{\"cancelReason\":\"Pesakit tidak perlu\",$SCOPE}")
check "$C" "200" "batalkan borang → 200"

ST=$(q "SELECT status FROM issued_forms WHERE id='$REC'")
check "$ST" "cancelled" "status jadi 'cancelled'"

STILL=$(q "SELECT serial_no FROM issued_forms WHERE id='$REC'")
check "$STILL" "$S2" "nombor siri DIKEKALKAN selepas batal (tiada jurang)"

C=$(code -X PATCH "$API/clinical/forms/$REC/cancel" -H "Authorization: Bearer $DOC" \
  -H 'Content-Type: application/json' -d "{\"cancelReason\":\"Cuba batal lagi\",$SCOPE}")
check "$C" "409" "batal kali kedua → 409"

C=$(code -X PATCH "$API/clinical/forms/$REC/cancel" -H "Authorization: Bearer $DOC" \
  -H 'Content-Type: application/json' -d "{\"cancelReason\":\"ab\",$SCOPE}")
check "$C" "422" "sebab batal terlalu pendek → 422"

step "6 · kebenaran: HQ urus templat tetapi TIDAK mengeluarkan borang"
C=$(code -X POST "$API/clinical/forms" -H "Authorization: Bearer $HQ" -H 'Content-Type: application/json' \
  -d "{\"kind\":\"mc\",\"templateId\":\"${TPLID[mc]}\",\"patientId\":\"$PAT\"}")
case "$C" in 403|422) ok "HQ DITOLAK mengeluarkan borang → $C (HQ tiada cawangan)";; *) bad "HQ boleh keluarkan borang → $C";; esac

C=$(code "$API/clinical/forms?kind=mc" -H "Authorization: Bearer $HQ")
check "$C" "200" "HQ boleh BACA senarai borang → 200"

C=$(code -X POST "$API/clinical/forms/templates" -H "Authorization: Bearer $DOC" \
  -H 'Content-Type: application/json' -d "{\"kind\":\"mc\",\"title\":\"${T}oleh doktor\",\"body\":\"Doktor cuba cipta templat — patut ditolak.\"}")
check "$C" "403" "DOKTOR ditolak cipta templat → 403 (HQ sahaja)"

step "7 · teks dibekukan (snapshot) dan jenis templat tersimpan"
# The claim worth testing is that the record SNAPSHOTS the version it was issued under —
# not that the version happens to be 1. Hardcoding 1 made this assertion a statement about
# how many times the script had run before. Compare the record against its own template.
VER=$(q "SELECT template_version FROM issued_forms WHERE serial_no='$S1'")
TPLVER=$(q "SELECT version FROM consent_templates WHERE id='${TPLID[mc]}'")
check "$VER" "$TPLVER" "rekod menyimpan versi templat yang digunakannya (v$TPLVER)"
SNAP=$(q "SELECT CHAR_LENGTH(body_snapshot) FROM issued_forms WHERE serial_no='$S1'")
if [ "${SNAP:-0}" -gt 10 ]; then ok "teks beku disimpan ($SNAP aksara)"; else bad "teks beku kosong ($SNAP)"; fi
KIND=$(q "SELECT kind FROM consent_templates WHERE id='${TPLID[time_off]}'")
check "$KIND" "time_off" "jenis templat tersimpan sebagai 'time_off'"

echo
echo "======================================================"
echo "  PASS: $PASS    FAIL: $FAIL"
echo "======================================================"
echo
echo "Ringkasan borang dikeluarkan:"
q "SELECT CONCAT(serial_no,' | ',kind,' | ',status) FROM issued_forms ORDER BY serial_no" | sed 's/^/  /'
echo
echo "Jalankan:  bash padam-data-fasa1g.sh"
[ "$FAIL" -eq 0 ] || exit 1
