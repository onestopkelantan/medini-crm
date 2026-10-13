#!/usr/bin/env bash
# ============================================================================
# verify-fasa1-clinical-ui.sh — sahkan tiga tindakan klinikal yang sebelum ini
# TIADA UI, dan satu pindaan nota (item Fasa 1 #3).
#
# YANG DIUJI
#   1. POST /clinical/prescriptions     -> 201, ubat tersimpan dengan dos/tempoh
#   2. POST /clinical/adverse-events    -> 201, rekod keselamatan
#   3. POST /clinical/referrals         -> 201, rujukan
#   4. PATCH /clinical/referrals/:id/status -> 200, aliran pending->sent->...
#   5. POST /clinical/notes/:id/amend   -> 201, pindaan mengekalkan nota asal
#   6. NOTA DRAF tidak boleh dipinda   -> 409 (hanya nota bertandatangan)
#   7. Bukan doktor ditolak            -> 403
#
# Ujian 6 dan 7 ialah ujian NEGATIF: ia membuktikan penapis itu benar-benar
# menolak, bukan hanya menerima apa sahaja. Skrip yang hanya menguji laluan
# berjaya akan lulus walaupun pengesahan dimatikan sepenuhnya.
#
# Bersihkan guna: bash padam-data-fasa1-clinical-ui.sh
# ============================================================================
set -uo pipefail
BASE="${BASE:-https://localhost}"
CURL="curl -sk"
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); printf "  \033[32mPASS\033[0m  %s\n" "$1"; }
bad()  { FAIL=$((FAIL+1)); printf "  \033[31mFAIL\033[0m  %s\n" "$1"; }
head1(){ printf "\n=== %s ===\n" "$1"; }

jget() { python -c "
import sys, json
try:
  d = json.load(sys.stdin)
  for k in '$1'.split('.'):
    d = d[int(k)] if k.isdigit() else d.get(k)
    if d is None: break
  print(d if d is not None else '')
except Exception:
  print('')
"; }

login() {
  $CURL -X POST "$BASE/api/v1/auth/login" -H 'Content-Type: application/json' \
    -d "$(LOGIN_PASSWORD="$2" python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["LOGIN_PASSWORD"]}))' "$1")" | jget accessToken
}

DOCTOK=$(login "${DOC_USER:-dr.aina}" "${DOC_PASS:-${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}}")
HQTOK=$(login "${HQ_USER:-DEMO-hq}" "${HQ_PASS:-${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}}")

if [ -z "$DOCTOK" ]; then
  echo "GAGAL LOGIN doktor (${DOC_USER:-dr.aina}) — tunggu 60s jika throttler."
  exit 1
fi
[ -z "$HQTOK" ] && echo "AMARAN: login HQ gagal — ujian 403 dilangkau."

AUTH_D="Authorization: Bearer $DOCTOK"
AUTH_H="Authorization: Bearer $HQTOK"

head1 "0. Persediaan — pesakit + sesi rawatan doktor"
PAT=$(  $CURL "$BASE/api/v1/patients?limit=1" -H "$AUTH_D" | python -c "
import sys,json
d=json.load(sys.stdin); rows=d.get('data',d) if isinstance(d,dict) else d
print(rows[0]['id'] if rows else '')" )
ENC=$(  $CURL "$BASE/api/v1/clinical/encounters?limit=1" -H "$AUTH_D" | python -c "
import sys,json
d=json.load(sys.stdin); rows=d.get('data',d) if isinstance(d,dict) else d
print(rows[0]['id'] if rows else '')" )
# /auth/me membalut hasil dalam { data: {...} } — bukan di aras atas.
ME=$($CURL "$BASE/api/v1/auth/me" -H "$AUTH_D")
DOCID=$(echo "$ME" | jget data.doctorId)
BRID=$( echo "$ME" | jget data.branchId)

[ -n "$PAT" ] && ok "pesakit dijumpai: ${PAT:0:8}…" || bad "tiada pesakit"
[ -n "$ENC" ] && ok "sesi rawatan dijumpai: ${ENC:0:8}…" || bad "tiada sesi rawatan — butang UI akan lumpuh (betul)"
[ -n "$DOCID" ] && ok "doctorId hadir dalam token" || bad "doctorId tiada"
[ -n "$BRID" ] && ok "branchId hadir dalam token" || bad "branchId tiada"

# Skop sedia untuk dipakai oleh SEMUA tulisan di bawah. Guard `scope:'own'` hanya
# mengisi doctorId untuk `view`; setiap create/edit mesti menghantarnya sendiri.
SCOPE="\"branchId\":\"$BRID\",\"doctorId\":\"$DOCID\""

head1 "1. Preskripsi — POST /clinical/prescriptions"
RXBODY="{\"patientId\":\"$PAT\",\"encounterId\":\"$ENC\",\"branchId\":\"$BRID\",\"doctorId\":\"$DOCID\",
 \"medication\":\"ZZTEST Amoxicillin 500mg\",\"dosage\":\"1 tablet\",\"frequency\":\"3 kali sehari\",\"durationDays\":5}"
RX=$(echo "$RXBODY" | $CURL -X POST "$BASE/api/v1/clinical/prescriptions" -H "$AUTH_D" -H 'Content-Type: application/json' -d @- -w '\n%{http_code}')
RXCODE=$(echo "$RX" | tail -1); RXJSON=$(echo "$RX" | sed '$d')
RXID=$(echo "$RXJSON" | jget id)
[ "$RXCODE" = "201" ] && ok "preskripsi dicipta (201)" || bad "jangkaan 201, dapat $RXCODE"
[ "$(echo "$RXJSON" | jget medication)" = "ZZTEST Amoxicillin 500mg" ] && ok "nama ubat tersimpan betul" || bad "nama ubat salah"
[ "$(echo "$RXJSON" | jget durationDays)" = "5" ] && ok "tempoh (5 hari) tersimpan" || bad "tempoh salah"
[ "$(echo "$RXJSON" | jget frequency)" = "3 kali sehari" ] && ok "kekerapan tersimpan" || bad "kekerapan salah"

head1 "2. Kesan buruk — POST /clinical/adverse-events"
AEBODY="{\"patientId\":\"$PAT\",\"encounterId\":\"$ENC\",\"branchId\":\"$BRID\",\"doctorId\":\"$DOCID\",
 \"severity\":\"moderate\",\"description\":\"ZZTEST bengkak selepas cabutan\",\"actionTaken\":\"Beri antibiotik\"}"
AE=$(echo "$AEBODY" | $CURL -X POST "$BASE/api/v1/clinical/adverse-events" -H "$AUTH_D" -H 'Content-Type: application/json' -d @- -w '\n%{http_code}')
AECODE=$(echo "$AE" | tail -1); AEJSON=$(echo "$AE" | sed '$d'); AEID=$(echo "$AEJSON" | jget id)
[ "$AECODE" = "201" ] && ok "kesan buruk direkod (201)" || bad "jangkaan 201, dapat $AECODE"
[ "$(echo "$AEJSON" | jget severity)" = "moderate" ] && ok "tahap keterukan tersimpan" || bad "keterukan salah"

head1 "3. Rujukan — POST /clinical/referrals"
RFBODY="{\"patientId\":\"$PAT\",\"encounterId\":\"$ENC\",\"branchId\":\"$BRID\",\"doctorId\":\"$DOCID\",
 \"toSpecialty\":\"ZZTEST Surgeri Oral\",\"toProvider\":\"Hospital KL\",\"reason\":\"Gigi bongsu tersekat\"}"
RF=$(echo "$RFBODY" | $CURL -X POST "$BASE/api/v1/clinical/referrals" -H "$AUTH_D" -H 'Content-Type: application/json' -d @- -w '\n%{http_code}')
RFCODE=$(echo "$RF" | tail -1); RFJSON=$(echo "$RF" | sed '$d'); RFID=$(echo "$RFJSON" | jget id)
[ "$RFCODE" = "201" ] && ok "rujukan dicipta (201)" || bad "jangkaan 201, dapat $RFCODE"
[ "$(echo "$RFJSON" | jget status)" = "pending" ] && ok "status awal = pending" || bad "status awal bukan pending"

head1 "4. Aliran status rujukan — PATCH /clinical/referrals/:id/status"
for ST in sent acknowledged completed; do
  if [ -n "$RFID" ]; then
    R=$(echo "{\"status\":\"$ST\",\"branchId\":\"$BRID\",\"doctorId\":\"$DOCID\"}" | $CURL -X PATCH "$BASE/api/v1/clinical/referrals/$RFID/status" \
        -H "$AUTH_D" -H 'Content-Type: application/json' -d @- -w '\n%{http_code}')
    C=$(echo "$R" | tail -1); S=$(echo "$R" | sed '$d' | jget status)
    [ "$C" = "200" ] && [ "$S" = "$ST" ] && ok "status -> $ST (200)" || bad "status $ST: dapat $C / $S"
  fi
done
# NEGATIF: status karut mesti ditolak
if [ -n "$RFID" ]; then
  N=$(echo "{\"status\":\"terbang\",$SCOPE}" | $CURL -X PATCH "$BASE/api/v1/clinical/referrals/$RFID/status" \
      -H "$AUTH_D" -H 'Content-Type: application/json' -d @- -o .verify-out.tmp -w '%{http_code}')
  [ "$N" = "400" ] || [ "$N" = "422" ] && ok "status karut ditolak ($N)" || bad "status karut DITERIMA ($N) — penapis lemah"
fi

head1 "5. Pindaan nota — item Fasa 1 #3 (ADR-009)"
NB="{\"encounterId\":\"$ENC\",$SCOPE,\"soapSubjective\":\"ZZTEST subjektif\",\"soapObjective\":\"objektif\",
 \"soapAssessment\":\"penilaian\",\"soapPlan\":\"pelan\"}"
NEW=$(echo "$NB" | $CURL -X POST "$BASE/api/v1/clinical/notes" -H "$AUTH_D" -H 'Content-Type: application/json' -d @- -w '\n%{http_code}')
NOTEID=$(echo "$NEW" | sed '$d' | jget id)

# NEGATIF: nota DRAF tidak boleh dipinda
if [ -n "$NOTEID" ]; then
  A=$(echo "$NB" | $CURL -X POST "$BASE/api/v1/clinical/notes/$NOTEID/amend" -H "$AUTH_D" -H 'Content-Type: application/json' -d @- -o .verify-out.tmp -w '%{http_code}')
  [ "$A" = "409" ] && ok "nota DRAF ditolak untuk pindaan (409) — betul" || bad "jangkaan 409 untuk draf, dapat $A"

  S=$(echo "{$SCOPE}" | $CURL -X POST "$BASE/api/v1/clinical/notes/$NOTEID/sign" -H "$AUTH_D" -H 'Content-Type: application/json' -d @- -o .verify-out.tmp -w '%{http_code}')
  [ "$S" = "200" ] || [ "$S" = "201" ] && ok "nota ditandatangani ($S)" || bad "gagal tandatangan nota ($S)"

  AM=$(echo "$NB" | $CURL -X POST "$BASE/api/v1/clinical/notes/$NOTEID/amend" -H "$AUTH_D" -H 'Content-Type: application/json' -d @- -w '\n%{http_code}')
  AC=$(echo "$AM" | tail -1); AJ=$(echo "$AM" | sed '$d')
  AMID=$(echo "$AJ" | jget id)
  [ "$AC" = "201" ] || [ "$AC" = "200" ] && ok "pindaan dicipta ($AC)" || bad "pindaan gagal ($AC)"
  [ -n "$AMID" ] && [ "$AMID" != "$NOTEID" ] && ok "pindaan ialah rekod BAHARU (asal dikekalkan)" || bad "pindaan menulis ganti nota asal — jejak hilang"
  [ "$(echo "$AJ" | jget amendsNoteId)" = "$NOTEID" ] && ok "pindaan merujuk nota asal (amendsNoteId)" || bad "pautan ke nota asal tiada"

  # Nota asal mesti masih ada
  STILL=$($CURL "$BASE/api/v1/clinical/notes?encounterId=$ENC" -H "$AUTH_D" | python -c "
import sys,json
d=json.load(sys.stdin); rows=d.get('data',d) if isinstance(d,dict) else d
print(len(rows) if rows else 0)")
  [ "$STILL" -ge 2 ] && ok "kedua-dua nota (asal + pindaan) ada dalam rekod: $STILL" || bad "nota asal hilang (hanya $STILL)"
fi

head1 "5b. Skop WAJIB pada tulisan (bukti bug kelas ke-4)"
# Rujukan BAHARU: yang di atas sudah "completed" dan tidak boleh undur ke "sent".
RF2BODY="{\"patientId\":\"$PAT\",\"encounterId\":\"$ENC\",$SCOPE,\"toSpecialty\":\"ZZTEST Skop\",\"reason\":\"Uji keperluan skop\"}"
RF2=$(echo "$RF2BODY" | $CURL -X POST "$BASE/api/v1/clinical/referrals" -H "$AUTH_D" -H 'Content-Type: application/json' -d @- -w '\n%{http_code}')
RF2ID=$(echo "$RF2" | sed '$d' | jget id)
if [ -n "$RF2ID" ]; then
  NS=$(echo '{"status":"sent"}' | $CURL -X PATCH "$BASE/api/v1/clinical/referrals/$RF2ID/status" \
      -H "$AUTH_D" -H 'Content-Type: application/json' -d @- -o .verify-out.tmp -w '%{http_code}')
  [ "$NS" = "403" ] && ok "TANPA skop -> 403 (guard fail-closed, seperti didakwa)" \
                    || bad "tanpa skop dapat $NS — andaian guard tidak tepat"
  WS=$(echo "{\"status\":\"sent\",$SCOPE}" | $CURL -X PATCH "$BASE/api/v1/clinical/referrals/$RF2ID/status" \
      -H "$AUTH_D" -H 'Content-Type: application/json' -d @- -o .verify-out.tmp -w '%{http_code}')
  [ "$WS" = "200" ] && ok "DENGAN skop -> 200 (pembetulan UI betul)" \
                    || bad "dengan skop dapat $WS — masih rosak"
else
  bad "rujukan ujian skop gagal dicipta"
fi

head1 "6. Peranan bukan doktor ditolak"
if [ -n "$HQTOK" ]; then
  H=$(echo "$RXBODY" | $CURL -X POST "$BASE/api/v1/clinical/prescriptions" -H "$AUTH_H" -H 'Content-Type: application/json' -d @- -o .verify-out.tmp -w '%{http_code}')
  [ "$H" = "403" ] && ok "HQ ditolak menulis preskripsi (403)" || bad "HQ boleh tulis preskripsi ($H) — RBAC bocor"
fi

echo ""
echo "======================================================"
printf "  LULUS: %d   GAGAL: %d\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] && echo "  ✅ SEMUA LULUS" || echo "  ❌ ADA GAGAL"
echo "======================================================"
echo "  (Data ujian berlabel ZZTEST masih ada — bersihkan dengan:)"
echo "  bash padam-data-fasa1-clinical-ui.sh"
exit 0
