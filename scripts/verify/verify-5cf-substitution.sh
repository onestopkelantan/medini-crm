#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# FASA 5C-F — live proof of tag substitution.
#
# THE CLAIM
#
#   "A blast using {nama}/{cawangan}/{link} reaches each recipient with real
#    values, and a minor's message is addressed to the GUARDIAN."
#
# Before this existed, every recipient received the literal text "Salam {nama}!"
# — which is why the privacy screen refuses unresolved tags.
#
# HOW THE ASSERTIONS ARE ANCHORED
#
# Every read below is keyed by the `batchId` returned by the POST. Not by phone
# number, and not by campaign name: both are ambiguous across runs and across
# leftover test rows, and a lookup that silently matches nothing makes a broken
# feature look merely absent.
#
# Run from the repo root:
#   export MEDINI_DB_PASSWORD=$(docker exec medini-prod-mysql-1 sh -c 'printf %s "$MYSQL_PASSWORD"')
#   bash verify-5cf-substitution.sh

set -uo pipefail
export LC_ALL=C

API="https://localhost/api/v1"
PASS=0; FAIL=0
TMP="${LOCALAPPDATA:-/tmp}/Temp"
mkdir -p "$TMP"
DB() { docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -N -B -e "$1" 2>/dev/null; }
ok()  { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — dapat '$2', jangka '$3'"; fi; }

echo "=== FASA 5C-F — substitusi tag ==="
echo

TOKEN=$(curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "manager")" | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null)
[ -n "$TOKEN" ] && ok "log masuk manager" || { bad "log masuk"; exit 1; }

BRANCH=$(DB "SELECT id FROM branches WHERE code='sentosa'")
CH=$(DB "SELECT id FROM wa_channels WHERE branch_id='$BRANCH' AND deleted_at IS NULL LIMIT 1")
# The channel is set to 'working' AFTER cleanup() runs below — cleanup resets it,
# so setting it here would be undone.

# ---------------------------------------------------------------- fixtures
ADULT_PHONE="60177666001"
CHILD_PHONE="60177666002"
GUARD=$(python -c "import uuid;print(uuid.uuid4())")
CHILD=$(python -c "import uuid;print(uuid.uuid4())")

cleanup() {
  # Delete messages by the batchId captured from the POST response.
  #
  # NOT by joining through wa_blast_campaigns: the campaign row is deleted in the
  # same pass, and a delete that depends on a row being present silently does
  # nothing once it is gone. That is what left two messages behind on the first
  # run of this script.
  if [ -n "${BATCH:-}" ]; then
    DB "DELETE FROM wa_safety_decisions WHERE message_id IN (SELECT id FROM wa_messages WHERE blast_batch_id='$BATCH')" >/dev/null
    DB "DELETE FROM wa_messages WHERE blast_batch_id='$BATCH'" >/dev/null
  fi
  DB "DELETE FROM wa_blast_campaigns WHERE name LIKE 'Ujian 5C-F%'" >/dev/null
  # Belt and braces: remove anything addressed to the fixtures, and any body that
  # still contains a raw tag (a body that failed substitution must not persist).
  DB "DELETE FROM wa_messages WHERE conversation_id IN (SELECT id FROM wa_conversations WHERE contact_phone IN ('$ADULT_PHONE','$CHILD_PHONE','60177999999'))" >/dev/null
  DB "DELETE FROM wa_messages WHERE body LIKE 'Salam %{nama}%' OR body LIKE '%{nma}%'" >/dev/null
  DB "DELETE FROM wa_conversations WHERE contact_phone IN ('$ADULT_PHONE','$CHILD_PHONE','60177999999')" >/dev/null
  DB "DELETE FROM patients WHERE mrn IN ('MRN-5CF-1','MRN-5CF-2','MRN-DBG-1')" >/dev/null
  DB "UPDATE wa_channels SET status='need_qr', health_score=0 WHERE id='$CH'" >/dev/null
}
BATCH=""
cleanup
trap cleanup EXIT

# Now safe to open the channel: cleanup has already run for this invocation.
DB "UPDATE wa_channels SET status='working', health_score=95 WHERE id='$CH'" >/dev/null
check "channel dibuka untuk ujian" "$(DB "SELECT status FROM wa_channels WHERE id='$CH'")" "working"

echo
echo "--- 1. Fixtures: seorang dewasa + seorang kanak-kanak dgn penjaga ---"
DB "INSERT INTO patients (id, org_id, branch_id, mrn, name, status, whatsapp, last_visit_at, patient_type, contact_type, dob)
    VALUES ('$GUARD','00000000-0000-0000-0000-000000000001','$BRANCH','MRN-5CF-1','Zaid Bin Ali','Active','$ADULT_PHONE', DATE_SUB(NOW(), INTERVAL 8 MONTH),'adult','own','1985-06-10')"
DB "INSERT INTO patients (id, org_id, branch_id, mrn, name, status, whatsapp, last_visit_at, patient_type, contact_type, dob, guardian_id)
    VALUES ('$CHILD','00000000-0000-0000-0000-000000000001','$BRANCH','MRN-5CF-2','Nur Iman','Active','$CHILD_PHONE', DATE_SUB(NOW(), INTERVAL 7 MONTH),'child','guardian','2019-05-04','$GUARD')"
check "dua pesakit ujian dicipta" "$(DB "SELECT COUNT(*) FROM patients WHERE mrn IN ('MRN-5CF-1','MRN-5CF-2')")" "2"

echo
echo "--- 2. Hantar blast dgn ketiga-tiga tag ---"
BODY='Salam {nama}! 👋

Kami dari Klinik Pergigian Medini {cawangan}. Sudah lebih 6 bulan sejak lawatan terakhir. Boleh kami aturkan temujanji?
👉 {link}'
RESP=$(curl -sk -X POST "$API/whatsapp/blast" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"branchId\":\"$BRANCH\",\"channelId\":\"$CH\",\"recipients\":[\"$ADULT_PHONE\",\"$CHILD_PHONE\"],\"body\":$(python -c "import json,sys;print(json.dumps(sys.argv[1]))" "$BODY"),\"consentConfirmed\":true,\"campaignName\":\"Ujian 5C-F\",\"bookingUrl\":\"https://medini.my/b/sentosa\"}" 2>/dev/null)
if echo "$RESP" | grep -q '"ok":true'; then
  ok "blast diterima"
else
  bad "blast gagal: $(echo "$RESP" | head -c 220)"
  # Return rather than exit so the EXIT trap still restores the channel.
  BATCH=""
fi

BATCH=$(echo "$RESP" | python -c "import sys,json;print(json.load(sys.stdin).get('batchId',''))" 2>/dev/null)
echo "        batchId = $BATCH"
check "batchId dipulangkan" "$([ -n "$BATCH" ] && echo yes)" "yes"
check "dua mesej berada dalam queue" "$(DB "SELECT COUNT(*) FROM wa_messages WHERE blast_batch_id='$BATCH'")" "2"

echo
echo "--- 3. Badan mesej SETIAP penerima (dari DB, ikut batchId) ---"
DB "SELECT c.contact_phone, REPLACE(m.body, CHAR(10), ' | ') FROM wa_messages m
    JOIN wa_conversations c ON c.id = m.conversation_id
    WHERE m.blast_batch_id='$BATCH' ORDER BY c.contact_phone" > "$TMP/5cf_bodies.$$"
while IFS=$'\t' read -r PHONE BODY; do
  [ -z "${PHONE:-}" ] && continue
  echo "  ── $PHONE"
  echo "     ${BODY:0:110}"
  if echo "$BODY" | grep -q "{[a-z]"; then
    bad "$PHONE masih ada tag mentah"
  else
    ok "$PHONE tiada tag mentah"
  fi
done < "$TMP/5cf_bodies.$$"
rm -f "$TMP/5cf_bodies.$$"

echo
echo "--- 4. Dewasa → nama sendiri; kanak-kanak → nama PENJAGA ---"
ADULT_B=$(DB "SELECT m.body FROM wa_messages m JOIN wa_conversations c ON c.id=m.conversation_id
  WHERE m.blast_batch_id='$BATCH' AND c.contact_phone='$ADULT_PHONE' LIMIT 1")
CHILD_B=$(DB "SELECT m.body FROM wa_messages m JOIN wa_conversations c ON c.id=m.conversation_id
  WHERE m.blast_batch_id='$BATCH' AND c.contact_phone='$CHILD_PHONE' LIMIT 1")

echo "$ADULT_B" | grep -q "Salam Zaid Bin Ali!" && ok "dewasa → 'Salam Zaid Bin Ali!'" || bad "dewasa salah: '$(echo "$ADULT_B" | head -1)'"
echo "$CHILD_B" | grep -q "Salam Zaid Bin Ali!" && ok "kanak-kanak → disapa IBU BAPA, bukan 'Nur Iman'" || bad "kanak-kanak salah: '$(echo "$CHILD_B" | head -1)'"
echo "$CHILD_B" | grep -q "Nur Iman" && bad "nama kanak-kanak muncul dalam mesej" || ok "nama kanak-kanak tidak didedahkan"

echo
echo "--- 5. {cawangan} dan {link} betul ---"
ADULT_EXPECTED_CABANG="Medini Sentosa"
echo "$ADULT_B" | grep -q "$ADULT_EXPECTED_CABANG" && ok "{cawangan} → '$ADULT_EXPECTED_CABANG'" || bad "{cawangan} salah: '$(echo "$ADULT_B" | grep -o 'Medini[^.]*' | head -1)'"
echo "$ADULT_B" | grep -q "https://medini.my/b/sentosa" && ok "{link} → pautan tempahan diisi" || bad "{link} tidak diisi"

echo
echo "--- 6. Tag tak dikenali DITOLAK (bukan dihantar mentah) ---"
R=$(curl -sk -X POST "$API/whatsapp/blast" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"branchId\":\"$BRANCH\",\"channelId\":\"$CH\",\"recipients\":[\"$ADULT_PHONE\"],\"body\":\"Salam {nma}!\",\"consentConfirmed\":true}" 2>/dev/null)
echo "$R" | grep -q "Tag tidak dikenali" && ok "tag salah eja {nma} ditolak" || bad "sepatutnya ditolak: $(echo "$R" | head -c 170)"

echo
echo "--- 7. Tag klinikal masih DIBLOK (penjaga 5C-E tidak terjejas) ---"
R2=$(curl -sk -X POST "$API/whatsapp/blast" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"branchId\":\"$BRANCH\",\"channelId\":\"$CH\",\"recipients\":[\"$ADULT_PHONE\"],\"body\":\"Rawatan {rawatan} anda belum siap.\",\"consentConfirmed\":true}" 2>/dev/null)
echo "$R2" | grep -q "klinikal" && ok "tag klinikal {rawatan} ditolak" || bad "sepatutnya ditolak: $(echo "$R2" | head -c 170)"

echo
echo "--- 8. Bilangan penerima tanpa rekod pesakit dilaporkan ---"
R3=$(curl -sk -X POST "$API/whatsapp/blast" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"branchId\":\"$BRANCH\",\"channelId\":\"$CH\",\"recipients\":[\"60177999999\"],\"body\":\"Salam {nama}!\",\"consentConfirmed\":true}" 2>/dev/null)
echo "$R3" | grep -q '"unmatchedRecipients":1' && ok "nombor tiada rekod → unmatchedRecipients:1" || bad "tidak dilaporkan: $(echo "$R3" | head -c 170)"

echo
echo "--- 9. Bersihkan ---"
cleanup
check "mesej ujian dibersihkan" "$(DB "SELECT COUNT(*) FROM wa_messages WHERE blast_batch_id='$BATCH'")" "0"
check "kempen ujian dibersihkan" "$(DB "SELECT COUNT(*) FROM wa_blast_campaigns WHERE name LIKE 'Ujian 5C-F%'")" "0"
check "pesakit ujian dibersihkan" "$(DB "SELECT COUNT(*) FROM patients WHERE mrn LIKE 'MRN-5CF-%'")" "0"
check "tiada mesej tag mentah tertinggal" "$(DB "SELECT COUNT(*) FROM wa_messages WHERE body LIKE 'Salam %{nama}%'")" "0"
check "channel dipulihkan" "$(DB "SELECT status FROM wa_channels WHERE id='$CH'")" "need_qr"

echo
echo "======================================================"
echo "  LULUS: $PASS   GAGAL: $FAIL"
echo "======================================================"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
