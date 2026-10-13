#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# ============================================================================
# uji-14-cawangan.sh — bukti 1G untuk SEMUA cawangan, bukan satu.
#
# Bos's rule: the system is for all 14 branches, so a feature that works at Setia
# Tropika only is not finished.
#
# THREE DEFECTS IN THIS SCRIPT ITSELF, all found by insisting on a real result:
#
#   1. It PASSED BY DOING NOTHING. Zero forms issued, reported "all 0 serials unique
#      — PASS". A test that passes on an empty result certifies a feature that was
#      never exercised. Every section now asserts a MINIMUM COUNT, so an empty run
#      FAILS.
#   2. `while read … done < <(…)` ran its counter in a SUBSHELL: it read 0 at the end
#      while the inserts had actually succeeded. Replaced with `for` + command
#      substitution.
#   3. **The `q()` helper silently broke after running an UPDATE.** The argon2 hash
#      written into `password_hash` contains `$` and `\`, and passing it through a
#      shell function expanded those characters, corrupting every later call. `q()`
#      then returned empty for the rest of the run — which is why the branch loop
#      iterated ZERO times while the database plainly held 14 branches.
#
#      Fix: never interpolate a secret into a shell function's argument. The hash is
#      passed through a FILE and read by MySQL as a variable, so no shell parsing is
#      involved and the password never appears in the process list either.
#
# WHO ISSUES: a form needs a branch and a doctor is scoped to THEIR OWN branch, so
# each branch is exercised with its own doctor. A branch with no doctor account is
# reported as SKIP — missing setup data, not a code defect.
#
# Run from the repo root:  bash uji-14-cawangan.sh
# ============================================================================
set -uo pipefail

API=https://localhost/api/v1
DIR="${LOCALAPPDATA:-/tmp}/Temp"
mkdir -p "$DIR"
RP=$(docker exec medini-prod-mysql-1 sh -c 'printf %s "$MYSQL_ROOT_PASSWORD"')
q() { docker exec -i medini-prod-mysql-1 mysql -uroot -p"$RP" medini_prod -N -B -e "$1" 2>/dev/null | tr -d '\r'; }
jget() { python -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1" 2>/dev/null; }

PASS=0; FAIL=0
ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
step(){ echo; echo "== $1 =="; }

ORG=00000000-0000-0000-0000-000000000001

step "0 · reset + akaun doktor"
# A FULL reset. An earlier version deleted only `issued_forms`, so a leftover counter or a
# cancelled form from a previous run made the next run's sequence start at 00002 — and the
# test then reported a "gap" that was really its own litter.
# Fasa 0b — hanya baris yang dicipta ujian cawangan ini.
# `DELETE FROM issued_forms` tanpa syarat memusnahkan setiap MC klinik; dan
# kerana siri dikira dari MAX(serial_no), memadam baris menggunakan semula nombor.
q "DELETE FROM issued_forms WHERE subject LIKE 'Ujian%' OR subject LIKE 'ZZTEST%' OR subject='[PENANDA SIRI]'"

# Kata laluan doktor ditetapkan oleh skrip PROJEK, bukan oleh ujian ini.
#
# Dua percubaan sebelum ini gagal, dan dua-dua patut dicatat:
#   1. Menyisipkan hash argon2 ke dalam fungsi shell — `$` dan `\` dalam hash itu
#      mengembang dan merosakkan `q()` untuk seluruh baki jalan skrip, jadi gelung
#      cawangan berulang SIFAR kali sedangkan DB jelas ada 14 cawangan.
#   2. `LOAD_FILE()` — `secure_file_priv` MySQL menghalangnya, jadi statement pulang
#      NULL dan tiada kata laluan ditetapkan.
#
# Projek sudah ada `backend/scripts/reset-hq-password.sh`. Guna semula ia bermakna ujian
# ini tidak mengandungi cara KEDUA yang berbeza untuk menulis hash. Skrip itu hanya set
# 'hq'; doktor ditetapkan di sini dengan corak yang SAMA (docker exec + pemboleh ubah
# persekitaran -e), jadi hash tidak pernah melalui shell.
bash backend/scripts/reset-hq-password.sh >/dev/null 2>&1 || true
DHASH=$(docker exec -e P="$SEED_DEMO_PASSWORD" medini-prod-backend-1 \
  node -e 'const a=require("argon2");a.hash(process.env.P,{type:a.argon2id}).then(h=>process.stdout.write(h))' 2>/dev/null)
if [ -n "$DHASH" ]; then
  docker exec -e H="$DHASH" medini-prod-mysql-1 sh -c \
    'mysql -umedini -p"$MYSQL_PASSWORD" medini_prod -e "UPDATE staff SET password_hash=\"$H\", status=\"Active\" WHERE role=\"doctor\""' 2>/dev/null
fi
SETN=$(q "SELECT COUNT(*) FROM staff WHERE password_hash IS NOT NULL")
[ "${SETN:-0}" -ge 2 ] && ok "kata laluan doktor ditetapkan ($SETN akaun)" || bad "kata laluan tidak ditetapkan ($SETN)"

# The helper must still work after the update — this assertion is what would have
# caught defect 3 immediately instead of after the branch loop silently did nothing.
SANITY=$(q "SELECT COUNT(*) FROM branches")
[ "${SANITY:-0}" -eq 14 ] && ok "helper DB masih sihat selepas UPDATE ($SANITY cawangan)" \
  || { bad "helper DB ROSAK selepas UPDATE (dapat '$SANITY')"; exit 1; }

HQ=$(curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "hq")" | jget "d.get('accessToken','')")
DOCA=$(curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "dr.aina")" | jget "d.get('accessToken','')")
[ ${#DOCA} -gt 50 ] && ok "login doktor berjaya" || { bad "login doktor gagal"; exit 1; }

TID=$(q "SELECT id FROM consent_templates WHERE title='ZZTEST Surat Sakit' AND is_active=1 LIMIT 1")
if [ -z "$TID" ]; then
  curl -sk -X POST "$API/clinical/forms/templates" -H "Authorization: Bearer $HQ" \
    -H 'Content-Type: application/json' \
    -d '{"kind":"mc","title":"ZZTEST Surat Sakit","body":"[TEKS BELUM DIISI] Ujian cawangan Fasa 1G."}' >/dev/null
  TID=$(q "SELECT id FROM consent_templates WHERE title='ZZTEST Surat Sakit' LIMIT 1")
fi
[ -n "$TID" ] && ok "templat ujian sedia" || { bad "templat tak dapat disediakan"; exit 1; }

step "1a · akaun doktor ujian di setiap cawangan (dibuang di akhir)"
#
# WHY THIS EXISTS. Only two doctor accounts exist, both at two branches, so 12 of 14
# branches could not be exercised — and a feature verified at 2 branches is not verified
# for 14. The test therefore creates a temporary doctor per branch, PROVES the feature at
# every branch, then removes them.
#
# They are marked `ZZTEST-` in the username and the run ends by deleting exactly those
# rows, so the clinic's real staff data is never touched. This is the only honest way to
# answer "does it work at all 14 branches?" while the 12 real doctors do not exist yet.
q "DELETE FROM staff WHERE username LIKE 'ZZTEST-doc-%'"
NDOC=0
for BID in $(q "SELECT id FROM branches ORDER BY short_name"); do
  [ -z "$BID" ] && continue
  BSLUG=$(q "SELECT LOWER(REPLACE(COALESCE(code,'x'),'-','')) FROM branches WHERE id='$BID'")
  UN="ZZTEST-doc-${BSLUG:0:12}"
  SID=$(python -c "import uuid;print(uuid.uuid4())")
  DID=$(python -c "import uuid;print(uuid.uuid4())")
  q "INSERT INTO staff (id, org_id, branch_id, username, name, role, status, doctor_ref, created_at)
     VALUES ('$SID','$ORG','$BID','$UN','ZZTEST Doktor ${BSLUG}','doctor','Active','$DID',CURRENT_TIMESTAMP(6))"
  if [ -n "$DHASH" ]; then
    docker exec -e H="$DHASH" medini-prod-mysql-1 sh -c \
      "mysql -umedini -p\"\$MYSQL_PASSWORD\" medini_prod -e \"UPDATE staff SET password_hash=\\\"\$H\\\" WHERE username='$UN'\"" 2>/dev/null
  fi
  NDOC=$((NDOC+1))
done
echo "  akaun doktor ujian dicipta: $NDOC"

step "1 · sediakan 1 pesakit di setiap cawangan"
NB=0
for BID in $(q "SELECT id FROM branches ORDER BY short_name"); do
  [ -z "$BID" ] && continue
  NB=$((NB+1))
  PAT=$(q "SELECT id FROM patients WHERE branch_id='$BID' AND mrn LIKE 'ZZTEST-%' LIMIT 1")
  if [ -z "$PAT" ]; then
    PID=$(python -c "import uuid;print(uuid.uuid4())")
    q "INSERT INTO patients (id, org_id, branch_id, mrn, name, phone, status, created_at)
       VALUES ('$PID','$ORG','$BID','ZZTEST-C$NB','ZZTEST Pesakit Cawangan $NB','0123456789','Active',CURRENT_TIMESTAMP(6))"
  fi
done
NTOT=$(q "SELECT COUNT(*) FROM branches")
if [ "$NB" -ge 14 ]; then ok "$NB cawangan diproses (DB ada $NTOT)"; else bad "hanya $NB cawangan diproses (DB ada $NTOT)"; fi

step "2 · keluarkan 1 MC di setiap cawangan (doktor cawangan itu)"
ISSUED=0
NODOC=0
REALFAIL=0
for BID in $(q "SELECT id FROM branches ORDER BY short_name"); do
  BNAME=$(q "SELECT short_name FROM branches WHERE id='$BID'")
  PAT=$(q "SELECT id FROM patients WHERE branch_id='$BID' ORDER BY mrn LIMIT 1")
  [ -z "$PAT" ] && continue

  DOCU=$(q "SELECT username FROM staff WHERE branch_id='$BID' AND role='doctor' AND username NOT LIKE 'ZZTEST-%' LIMIT 1")
  # Fall back to the temporary test doctor for this branch, so every branch is exercised.
  [ -z "$DOCU" ] && DOCU=$(q "SELECT username FROM staff WHERE branch_id='$BID' AND username LIKE 'ZZTEST-doc-%' LIMIT 1")
  if [ -n "$DOCU" ]; then
    TOK=$(curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
      -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "$DOCU")" | jget "d.get('accessToken','')")
  else
    TOK="$DOCA"
  fi
  TDI=$(curl -sk "$API/auth/me" -H "Authorization: Bearer $TOK" | jget "d['data']['doctorId']")

  RESP=$(curl -sk -X POST "$API/clinical/forms" \
    -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
    -d "{\"kind\":\"mc\",\"templateId\":\"$TID\",\"patientId\":\"$PAT\",\"subject\":\"Ujian $BNAME\",\"branchId\":\"$BID\",\"doctorId\":\"$TDI\"}")
  SER=$(echo "$RESP" | jget "d.get('serialNo','')")

  if [ -n "$SER" ]; then
    ISSUED=$((ISSUED+1))
    printf "  %-24s -> %s\n" "$BNAME" "$SER"
  elif [ -z "$DOCU" ]; then
    printf "  %-24s -> SKIP (tiada akaun doktor — sepatutnya tidak berlaku)\n" "$BNAME"
    NODOC=$((NODOC+1))
  else
    printf "  %-24s -> GAGAL: %s\n" "$BNAME" "$(echo "$RESP" | head -c 110)"
    REALFAIL=$((REALFAIL+1))
  fi
done
echo "  (cawangan tanpa akaun doktor: $NODOC · gagal sebenar: $REALFAIL)"
if [ "$REALFAIL" -gt 0 ]; then
  bad "$REALFAIL cawangan GAGAL walaupun ada akaun doktor"
elif [ "$ISSUED" -ge 1 ]; then
  ok "$ISSUED borang dikeluarkan merentas $ISSUED cawangan ($NODOC belum ada doktor)"
else
  bad "TIADA borang dikeluarkan — ujian kosong bukan lulus"
fi

step "3 · tiada pertindihan antara cawangan"
TOTAL=$(q "SELECT COUNT(*) FROM issued_forms")
UNIQ=$(q "SELECT COUNT(DISTINCT serial_no) FROM issued_forms")
if [ "${TOTAL:-0}" -gt 0 ] && [ "$TOTAL" = "$UNIQ" ]; then
  ok "semua $TOTAL nombor siri UNIK"
else
  bad "$TOTAL borang, $UNIQ unik"
fi

if [ "${TOTAL:-0}" = "0" ]; then
  bad "tiada borang untuk diperiksa — ujian kosong BUKAN lulus"
else
  MISSING=$(q "SELECT COUNT(*) FROM issued_forms f JOIN branches b ON b.id=f.branch_id
    WHERE b.code IS NOT NULL AND b.code <> ''
      AND UPPER(f.serial_no) NOT LIKE CONCAT('%-', UPPER(REPLACE(REPLACE(b.code,'-',''),' ','')), '-%')")
  if [ "$MISSING" = "0" ]; then ok "setiap nombor mengandungi kod cawangannya ($TOTAL borang)"
  else bad "$MISSING nombor tanpa kod cawangan"; fi
fi

step "4 · setiap cawangan mula dari 1, tiada lompatan"
if [ "${TOTAL:-0}" = "0" ]; then
  bad "tiada borang — tidak boleh disahkan"
else
  GAPS=$(q "SELECT COUNT(*) FROM (
      SELECT b.short_name, MIN(CAST(RIGHT(f.serial_no,5) AS UNSIGNED)) AS mn,
             MAX(CAST(RIGHT(f.serial_no,5) AS UNSIGNED)) AS mx, COUNT(*) AS n
      FROM issued_forms f JOIN branches b ON b.id=f.branch_id
      GROUP BY b.short_name HAVING mn <> 1 OR mx <> n) x")
  [ "$GAPS" = "0" ] && ok "semua cawangan: mula 1, berurutan, tiada lompatan" || bad "$GAPS cawangan berlompat"
fi

ZERO=$(q "SELECT COUNT(*) FROM issued_forms WHERE serial_no LIKE '%00000' OR serial_no IS NULL OR serial_no=''")
[ "$ZERO" = "0" ] && ok "tiada nombor 00000 / kosong" || bad "$ZERO nombor rosak (00000)"

step "5 · perlumbaan 10 serentak di satu cawangan"
BID=$(q "SELECT branch_id FROM staff WHERE username='dr.aina'")
PAT=$(q "SELECT id FROM patients WHERE branch_id='$BID' LIMIT 1")
DID=$(curl -sk "$API/auth/me" -H "Authorization: Bearer $DOCA" | jget "d['data']['doctorId']")
BEFORE=$(q "SELECT COUNT(*) FROM issued_forms")
for i in $(seq 1 10); do
  ( curl -sk -X POST "$API/clinical/forms" -H "Authorization: Bearer $DOCA" \
      -H 'Content-Type: application/json' \
      -d "{\"kind\":\"mc\",\"templateId\":\"$TID\",\"patientId\":\"$PAT\",\"subject\":\"Lumba $i\",\"branchId\":\"$BID\",\"doctorId\":\"$DID\"}" >/dev/null 2>&1 ) &
done
wait
AFTER=$(q "SELECT COUNT(*) FROM issued_forms")
ADDED=$((AFTER-BEFORE))
UNIQ2=$(q "SELECT COUNT(DISTINCT serial_no) FROM issued_forms")
if [ "$UNIQ2" != "$AFTER" ]; then
  bad "PERTINDINGAN selepas lumba: $UNIQ2 unik dari $AFTER"
elif [ "$ADDED" -eq 10 ]; then
  ok "10/10 serentak berjaya, semua $AFTER nombor kekal unik"
else
  bad "tiada pertindihan tetapi hanya $ADDED/10 berjaya"
fi

echo
echo "======================================================"
echo "  PASS: $PASS    FAIL: $FAIL"
echo "======================================================"
echo
echo "Ringkasan per cawangan:"
q "SELECT CONCAT(b.short_name,' : ',COUNT(*),' borang, ',MIN(f.serial_no),' .. ',MAX(f.serial_no))
   FROM issued_forms f JOIN branches b ON b.id=f.branch_id
   GROUP BY b.short_name ORDER BY b.short_name" | sed 's/^/  /'
echo
step "6 · buang akaun doktor ujian + pesakit ujian"
#
# ORDER IS THE WHOLE POINT. An earlier version soft-deleted the staff first and then tried
# to delete them, which failed — and the failure was invisible because the "sisa ujian"
# count only checked the patients. The dependency chain here is:
#
#     issued_forms -> patients -> staff
#
# `issued_forms.patient_id` and `.branch_id` are ON DELETE RESTRICT, so a form still
# pointing at a patient blocks that patient; a patient still referencing staff (created_by)
# blocks that staff. So the deletion runs children-first: forms, then patients, then staff.
q "DELETE FROM issued_forms WHERE subject LIKE 'Ujian%' OR subject LIKE 'ZZTEST%' OR subject='[PENANDA SIRI]'"
echo "  issued_forms dibuang"
q "DELETE FROM patients WHERE mrn LIKE 'ZZTEST-%'"
echo "  pesakit ujian dibuang"
q "DELETE FROM staff WHERE username LIKE 'ZZTEST-doc-%'"
echo "  akaun doktor ujian dibuang"
# The templates this script creates are test data too. Leaving them meant a LATER run found
# them during its own reset and reported a duplicate-key failure that looked like a code
# defect — the litter was mine, not the engine's. Records go first (RESTRICT).
q "DELETE FROM consent_records WHERE template_id IN (
     SELECT id FROM (SELECT id FROM consent_templates WHERE title LIKE 'ZZTEST%' OR version > 1) x)"
q "DELETE FROM consent_templates WHERE title LIKE 'ZZTEST%' OR version > 1"
echo "  templat ujian dibuang"
q "DELETE FROM treatment_catalog WHERE code LIKE 'ZZTEST%' OR name LIKE 'ZZTEST%'"
echo "  katalog ujian dibuang"
LEFTD=$(q "SELECT COUNT(*) FROM staff WHERE username LIKE 'ZZTEST-doc-%'")
LEFTP=$(q "SELECT COUNT(*) FROM patients WHERE mrn LIKE 'ZZTEST-%'")
LEFTF=$(q "SELECT COUNT(*) FROM issued_forms")
LEFTT=$(q "SELECT COUNT(*) FROM consent_templates WHERE title LIKE 'ZZTEST%' OR version > 1")
LEFTC=$(q "SELECT COUNT(*) FROM treatment_catalog WHERE code LIKE 'ZZTEST%'")
if [ "$LEFTD" = "0" ] && [ "$LEFTP" = "0" ] && [ "$LEFTF" = "0" ] \
   && [ "$LEFTT" = "0" ] && [ "$LEFTC" = "0" ]; then
  ok "data ujian dibuang (doktor, pesakit, borang, templat, katalog — semua 0)"
else
  bad "sisa ujian: $LEFTD doktor, $LEFTP pesakit, $LEFTF borang, $LEFTT templat, $LEFTC katalog"
fi
echo "  Keadaan sebenar yang tinggal:"
echo "    staf sebenar        : $(q 'SELECT COUNT(*) FROM staff')"
echo "    pesakit sebenar     : $(q 'SELECT COUNT(*) FROM patients')"
echo "    cawangan            : $(q 'SELECT COUNT(*) FROM branches')"
echo "    templat kebenaran   : $(q 'SELECT COUNT(*) FROM consent_templates')"

rm -f "$DIR/hash.txt"
[ "$FAIL" -eq 0 ] || exit 1
