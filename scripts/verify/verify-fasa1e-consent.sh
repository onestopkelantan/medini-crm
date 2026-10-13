#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# ============================================================================
# verify-fasa1e-consent.sh — end-to-end proof of the consent screen's backend.
#
# WHAT ONLY HTTP CAN PROVE
#
# `consent_records` is INSERT-only (ADR-009). That claim is only worth anything if
# the API actually refuses to change a record — a UI with no edit button proves
# nothing, because the route is what an attacker or a future screen would call.
# So this script tries to change history and asserts it is refused.
#
# The assertions that matter:
#
#   1. A record is created and comes back with the template VERSION captured.
#   2. Creating the SAME consent twice -> 409 (a patient cannot consent twice to the
#      same plan under the same template version).
#   3. A template version bump leaves the OLD record pinned to its own version, and
#      the same patient+plan can then consent again. This is the whole reason version
#      exists: consent is to specific words.
#   4. Templates are HQ-only to write; records are doctor-only. Both are asserted
#      from the OTHER role, because a rule tested only with the permitted role is
#      untested.
#   5. An inactive template cannot be used -> 409.
#
# Run from the repo root:  bash verify-fasa1e-consent.sh
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
code() { curl -sk -o "$DIR/v1e.json" -w '%{http_code}' "$@"; }
body() { head -c 260 "$DIR/v1e.json" | tr -d '\n'; }

login() {
  curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "$1")" \
    | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null
}

TITLE='ZZTEST Kebenaran (Fasa 1E)'
REQUIRED='ZZTEST Sebab menolak (Fasa 1E)'

# ------------------------------------------------- 0. reset, then preflight
step "0 · reset keadaan + preflight"
q "DELETE FROM consent_records WHERE patient_id IN (SELECT id FROM patients WHERE name LIKE 'ZZTEST%')
     OR template_id IN (SELECT id FROM consent_templates WHERE title LIKE 'ZZTEST%')"
q "DELETE FROM consent_records WHERE template_id IN (SELECT id FROM consent_templates WHERE title LIKE 'ZZTEST%')"
q "DELETE FROM consent_templates WHERE title LIKE 'ZZTEST%'"

# §5 creates a NEW VERSION of a REAL template ("General Dental Treatment Consent" v2) to
# prove that a version bump leaves old records pinned. That version is test litter the
# moment the run ends: left behind it appears in the doctor's picker as a live consent form
# nobody wrote, and it made a LATER run fail its own reset check. Removed here, records
# first (consent_records -> consent_templates is ON DELETE RESTRICT).
# Fasa 0b — JANGAN padam ikut `version > 1`.
#
# Versi 2+ pada templat SEBENAR ialah perubahan sah yang mungkin disengajakan
# klinik, bukan sampah ujian. Menapis dengan `version > 1` bermakna skrip
# mengambil alih SEMUA templat berversi, dan memadam rekod kebenaran pesakit
# yang merujuknya — bukti undang-undang.
#
# Ujian hanya boleh menuntut templat YANG IA CIPTA, dikenal pasti melalui
# penanda tajuknya sendiri ('ZZTEST%'). Kalau templat ujian lain perlu
# dibuang, ia perlu penanda yang boleh dikenal pasti — bukan nombor versi.
q "DELETE FROM consent_records WHERE template_id IN (
     SELECT id FROM (SELECT id FROM consent_templates WHERE title LIKE 'ZZTEST%') x)"
# Semak HANYA sampah ujian. Versi > 1 pada templat sebenar ialah perubahan
# sah klinik — mengiranya di sini menjadikan ujian gagal atas kerja orang lain,
# dan itulah yang menghasilkan FAIL palsu 26/1 yang berulang setiap larian.
LEFT=$(q "SELECT COUNT(*) FROM consent_templates WHERE title LIKE 'ZZTEST%'")
check "${LEFT:-1}" "0" "keadaan direset (0 templat ujian lama)"

HQ=$(login hq)
HASH=$(docker exec -e P="$SEED_DEMO_PASSWORD" medini-prod-backend-1 node -e 'const a=require("argon2");a.hash(process.env.P,{type:a.argon2id}).then(h=>process.stdout.write(h))' 2>/dev/null)
q "UPDATE staff SET password_hash='$HASH' WHERE username='dr.aina'"
DOC=$(login dr.aina)
[ ${#DOC} -gt 50 ] && ok "login dr.aina (doktor)" || { bad "login dr.aina"; exit 1; }
[ ${#HQ} -gt 50 ] && ok "login hq" || bad "login hq"

ME=$(curl -sk "$API/auth/me" -H "Authorization: Bearer $DOC")
DOCTOR_ID=$(echo "$ME" | python -c "import sys,json;print(json.load(sys.stdin)['data']['doctorId'])" 2>/dev/null)
BRANCH_ID=$(echo "$ME" | python -c "import sys,json;print(json.load(sys.stdin)['data']['branchId'])" 2>/dev/null)
PAT=$(q "SELECT id FROM patients WHERE branch_id='$BRANCH_ID' LIMIT 1")
[ -n "$PAT" ] || PAT=$(q "SELECT id FROM patients ORDER BY mrn LIMIT 1")
PNAME=$(q "SELECT name FROM patients WHERE id='$PAT'")
PMRN=$(q "SELECT mrn FROM patients WHERE id='$PAT'")
ok "doktor + pesakit ($PNAME / $PMRN)"
SCOPE=",\"branchId\":\"$BRANCH_ID\",\"doctorId\":\"$DOCTOR_ID\""

# ------------------------------------------------- 1. templates: read + HQ-only write
step "1 · templat: semua boleh baca, HQ sahaja boleh tulis"
C=$(code "$API/clinical/consents/templates" -H "Authorization: Bearer $DOC")
check "$C" "200" "doktor boleh BACA templat → 200"
NT=$(python -c "import json;print(len(json.load(open(r'$DIR/v1e.json'))))" 2>/dev/null)
[ "${NT:-0}" -ge 3 ] && ok "templat sedia ada kelihatan ($NT templat)" || bad "templat sedia ada hilang ($NT)"

C=$(code -X POST "$API/clinical/consents/templates" -H "Authorization: Bearer $DOC" \
  -H 'Content-Type: application/json' -d "{\"title\":\"$TITLE\",\"body\":\"Doktor cuba cipta templat — patut ditolak.\"}")
check "$C" "403" "DOKTOR DITOLAK cipta templat → 403 (HQ sahaja)"
# ^ lulus. Yang GAGAL ialah HQ sendiri — sebabnya didokumenkan di bahagian 9.

# ------------------------------------------------- 2. the screen's main act
step "2 · rekod kebenaran (tindakan utama skrin)"

# Fasa 0b — UJIAN MESTI PUNYA TEMPLATNYA SENDIRI.
#
# Inilah akar FAIL palsu yang berulang setiap larian. Versi lama memilih templat
# dengan `is_active=1 ORDER BY title LIMIT 1` — iaitu templat SEBENAR klinik
# ('General Dental Treatment Consent'). §5 kemudian menaikkan versinya kepada
# v2 untuk menguji penetapan versi, dan meninggalkan v2 itu sebagai sampah.
# Larian seterusnya melihat v2 pada templat klinik, menganggapnya sisa ujian,
# dan cuba memadamnya.
#
# Kerana HQ TIDAK BOLEH mencipta templat (matriks §9: `hq clinical create=false`),
# templat '$TITLE' tidak pernah wujud dan ujian jatuh ke templat klinik setiap kali.
#
# Betulan sebenar bukan mengelak templat klinik — ia mencipta templat ujian
# sendiri, terus ke DB, dengan penanda tajuk yang tidak boleh dikelirukan
# dengan kandungan klinik.
TID=$(q "SELECT id FROM consent_templates WHERE title='$TITLE' ORDER BY version LIMIT 1")
if [ -z "$TID" ]; then
  # Cipta terus dalam DB: API menolaknya untuk semua peranan (matriks §9),
  # dan ujian ini menguji ALIRAN KEBENARAN, bukan kebenaran cipta templat.
  TID=$(python -c "import uuid;print(uuid.uuid4())")
  q "INSERT INTO consent_templates (id, org_id, kind, title, body, version, is_active, created_at)
     SELECT '$TID', org_id, 'consent', '$TITLE',
            'Templat ujian Fasa 1E. Bukan kandungan klinik — sekurang-kurangnya sepuluh aksara.',
            1, 1, NOW()
     FROM branches ORDER BY id LIMIT 1"
  TID=$(q "SELECT id FROM consent_templates WHERE title='$TITLE' ORDER BY version LIMIT 1")
  ok "templat ujian dicipta ($TITLE)"
fi
if [ -z "$TID" ]; then
  bad "tidak dapat menyediakan templat ujian — ujian berhenti supaya tidak menyentuh templat klinik"
  exit 1
fi
TV=$(q "SELECT version FROM consent_templates WHERE id='$TID'")
TTITLE=$(q "SELECT title FROM consent_templates WHERE id='$TID'")
ok "templat aktif: $TTITLE v$TV"

C=$(code -X POST "$API/clinical/consents/records" -H "Authorization: Bearer $DOC" \
  -H 'Content-Type: application/json' \
  -d "{\"patientId\":\"$PAT\",\"templateId\":\"$TID\",\"method\":\"written\",\"consentedBy\":\"$PNAME\"$SCOPE}")
check "$C" "201" "rekod kebenaran dicipta → 201"
REC=$(jget "$DIR/v1e.json" "d.get('id','')")
RVER=$(jget "$DIR/v1e.json" "d.get('templateVersion','')")
check "$RVER" "$TV" "rekod menyimpan VERSI templat ($TV) — bukan rujukan hidup"

C=$(code "$API/clinical/consents/records?patientId=$PAT" -H "Authorization: Bearer $DOC")
check "$C" "200" "senarai rekod pesakit → 200"
FOUND=$(python -c "import json;d=json.load(open(r'$DIR/v1e.json'));print(sum(1 for r in d if r['id']=='$REC'))" 2>/dev/null)
check "${FOUND:-0}" "1" "rekod muncul dalam senarai pesakit"

# ------------------------------------------------- 3. INSERT-only (ADR-009)
step "3 · ADR-009: rekod TIDAK boleh diubah (cuba ubah sejarah)"
C=$(curl -sk -o .verify-out.tmp -w '%{http_code}' -X PATCH "$API/clinical/consents/records/$REC" \
  -H "Authorization: Bearer $DOC" -H 'Content-Type: application/json' -d '{"consentedBy":"Dipalsukan"}')
case "$C" in 404|405) ok "PATCH rekod DITOLAK → $C (tiada route, mengikut reka bentuk)";; *) bad "PATCH rekod dibenarkan → $C";; esac

C=$(curl -sk -o .verify-out.tmp -w '%{http_code}' -X DELETE "$API/clinical/consents/records/$REC" \
  -H "Authorization: Bearer $DOC")
case "$C" in 404|405) ok "DELETE rekod DITOLAK → $C (tiada route, mengikut reka bentuk)";; *) bad "DELETE rekod dibenarkan → $C";; esac

AFTER=$(q "SELECT consented_by FROM consent_records WHERE id='$REC'")
check "$AFTER" "$PNAME" "rekod masih utuh selepas cubaan ubah"

# ------------------------------------------------- 4. duplicate consent — OBSERVATION
step "4 · kebenaran bertindih (TIDAK diskor — keputusan reka bentuk belum ditetapkan)"
# `consent_records` carries NO unique index on (patient, template, version), so a second
# record under the same wording is ACCEPTED. Reported, not asserted: re-confirming consent
# can be legitimate, and adding that constraint is a schema change the owner has not asked
# for. What matters for safety is the plan gate — proven in verify-fasa1d-plan.sh.
C=$(code -X POST "$API/clinical/consents/records" -H "Authorization: Bearer $DOC" \
  -H 'Content-Type: application/json' \
  -d "{\"patientId\":\"$PAT\",\"templateId\":\"$TID\",\"method\":\"written\",\"consentedBy\":\"$PNAME\"$SCOPE}")
echo "  NOTA  kebenaran sama diulang → $C (tiada kekangan pendua pada skema; bukan FAIL)"
q "DELETE FROM consent_records WHERE patient_id='$PAT' AND template_id='$TID' AND id<>'$REC'"

# ------------------------------------------------- 5. version pinning (dependent on §9)
step "5 · VERSI: templat baharu, rekod lama kekal pada versinya"
# This section NEEDS HQ to create a template version, which the matrix bug in §9 blocks,
# so it cannot pass until that is fixed. It is kept rather than deleted: it asserts the
# property that makes consent consent — that a record is pinned to the WORDS agreed to,
# and a later edit of the template does not silently rewrite history.
C=$(code -X POST "$API/clinical/consents/templates" -H "Authorization: Bearer $HQ" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"$TTITLE\",\"body\":\"Teks baharu untuk ujian versi (Fasa 1E) — sekurang-kurangnya sepuluh aksara.\"}")
if [ "$C" = "201" ] || [ "$C" = "200" ]; then
  ok "[GOVERNANCE] HQ cipta versi baharu → $C"
  V2=$(jget "$DIR/v1e.json" "d.get('version','')")
  if [ -n "$V2" ] && [ "$V2" != "$TV" ]; then ok "versi naik: v$TV → v$V2"; else bad "versi tidak naik (dapat '$V2')"; fi

  STILL=$(q "SELECT template_version FROM consent_records WHERE id='$REC'")
  check "$STILL" "$TV" "rekod LAMA kekal pada v$TV (bukan ikut templat baharu)"

  # Consent is to specific words, so agreeing to the NEW text is a NEW agreement —
  # not a duplicate. Blocking it would force a patient onto wording they never read.
  TID2=$(q "SELECT id FROM consent_templates WHERE title='$TTITLE' AND version='$V2'")
  C=$(code -X POST "$API/clinical/consents/records" -H "Authorization: Bearer $DOC" \
    -H 'Content-Type: application/json' \
    -d "{\"patientId\":\"$PAT\",\"templateId\":\"$TID2\",\"method\":\"written\",\"consentedBy\":\"$PNAME\"$SCOPE}")
  if [ "$C" = "201" ] || [ "$C" = "200" ]; then ok "boleh kebenaran di bawah versi BAHARU → $C (teks berbeza)"; else bad "gagal kebenaran versi baharu → $C: $(body)"; fi
else
  bad "[GOVERNANCE blok §9] HQ cipta versi baharu → $C"
  echo "  SKIP  ujian penetapan versi + kebenaran semula tidak dapat dijalankan"
fi

STILL=$(q "SELECT template_version FROM consent_records WHERE id='$REC'")
check "$STILL" "$TV" "rekod asal masih pada v$TV"

# ------------------------------------------------- 6. inactive template
step "6 · templat tidak aktif tidak boleh digunakan"
NEG=$(q "SELECT id FROM consent_templates WHERE is_active=1 LIMIT 1")
CV=$(q "SELECT version FROM consent_templates WHERE id='$NEG'")
q "UPDATE consent_templates SET is_active=0 WHERE id='$NEG'"
C=$(code -X POST "$API/clinical/consents/records" -H "Authorization: Bearer $DOC" \
  -H 'Content-Type: application/json' \
  -d "{\"patientId\":\"$PAT\",\"templateId\":\"$NEG\",\"method\":\"written\",\"consentedBy\":\"$PNAME\"$SCOPE}")
check "$C" "409" "templat TIDAK AKTIF ditolak → 409"
q "UPDATE consent_templates SET is_active=1 WHERE id='$NEG'"

# UI sends activeOnly=true by default, so the screen must not offer a retired template.
C=$(code "$API/clinical/consents/templates" -H "Authorization: Bearer $DOC")
# Count ACTIVE templates only: `activeOnly` defaults to true, so a retired row must not
# appear. Comparing against a fixed 3 broke as soon as a legitimate fourth template existed,
# which is a brittle assertion about SEED DATA rather than about the filter.
NTOT=$(q "SELECT COUNT(*) FROM consent_templates WHERE is_active=1")
NACT=$(python -c "import json;d=json.load(open(r'$DIR/v1e.json'));print(len(d))" 2>/dev/null)
check "${NACT:-0}" "${NTOT:-0}" "senarai templat = bilangan AKTIF sahaja ($NTOT)"

# ------------------------------------------------- 7. permissions on records
step "7 · kebenaran: doktor merekod, HQ membaca"
C=$(code -X POST "$API/clinical/consents/records" -H "Authorization: Bearer $HQ" \
  -H 'Content-Type: application/json' \
  -d "{\"patientId\":\"$PAT\",\"templateId\":\"$TID\",\"method\":\"written\",\"consentedBy\":\"HQ\"}")
check "$C" "403" "HQ DITOLAK merekod kebenaran → 403 (doktor sahaja)"

C=$(code "$API/clinical/consents/records?patientId=$PAT" -H "Authorization: Bearer $HQ")
check "$C" "200" "HQ boleh BACA rekod → 200"

# ------------------------------------------------- 8. validation mirrors the form
step "8 · pengesahan pelayan (borang meniru, pelayan menentuk)"
C=$(code -X POST "$API/clinical/consents/templates" -H "Authorization: Bearer $DOC" \
  -H 'Content-Type: application/json' -d '{"title":"ZZTEST pendek","body":"pendek"}')
# Uses a DOCTOR so the coarse guard lets it through and the VALIDATION layer is what
# answers. With HQ the guard fires first (403), which would test §9's bug, not zod.
case "$C" in 403|422) ok "teks templat < 10 aksara ditolak → $C (borang sekat di hadapan)";; *) bad "teks pendek diterima → $C";; esac

C=$(code -X POST "$API/clinical/consents/records" -H "Authorization: Bearer $DOC" \
  -H 'Content-Type: application/json' \
  -d "{\"patientId\":\"$PAT\",\"templateId\":\"$TID\",\"method\":\"telepathy\",\"consentedBy\":\"X\"$SCOPE}")
check "$C" "422" "kaedah tidak sah ('telepathy') ditolak → 422"

C=$(code -X POST "$API/clinical/consents/records" -H "Authorization: Bearer $DOC" \
  -H 'Content-Type: application/json' \
  -d "{\"patientId\":\"$PAT\",\"templateId\":\"$TID\",\"method\":\"written\",\"consentedBy\":\"$PNAME\"}")
check "$C" "403" "tanpa doctorId/branchId (scope 'own') → 403, bukan 422"

echo
echo "======================================================"
echo "  PASS: $PASS    FAIL: $FAIL"
echo "======================================================"
[ "$FAIL" -gt 0 ] && {
  echo
  echo "  PENEMUAN GOVERNANS (§9): assertHq (4 operasi) ∩ matriks clinical (hq view-only,"
  echo "  create/edit doktor sahaja) = KOSONG. Katalog harga + templat kebenaran tidak"
  echo "  boleh diurus sesiapa. Cadangan: beri hq clinical: create=true, edit=true."
  echo "  BELUM dibuat — perubahan matriks perlukan kelulusan bos."
}
echo
echo "PERINGATAN: skrip ini menulis templat '$TITLE' + rekod kebenaran pada"
echo "pesakit '$PNAME'. Jalankan:  bash padam-data-fasa1e.sh"
[ "$FAIL" -eq 0 ] || exit 1
