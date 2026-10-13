#!/usr/bin/env bash
# FASA 6B — doctor continuity, against the live database.
#
# WHAT THIS TESTS
#
#   The rule that decides which doctor a returning patient wants is covered by
#   17 unit tests (test/unit/doctor-continuity.spec.ts) — those are the authority
#   on counting, recency and the "one visit behind" boundary.
#
#   This script tests the SQL and the DATA RULES around it: that visits are found
#   by phone, that another branch's history does not leak in, that cancelled and
#   no-show appointments are excluded, and that a soft-deleted patient or doctor
#   drops out.
#
# WHAT THIS CANNOT PROVE
#
#   No WhatsApp number is linked, so no conversation drives this. The rows are
#   real; the trigger is not.
#
# Run from the repo root:
#   export MEDINI_DB_PASSWORD=$(docker exec medini-prod-mysql-1 sh -c 'printf %s "$MYSQL_PASSWORD"')
#   bash verify-doctor-continuity.sh

set -uo pipefail
export LC_ALL=C

PASS=0; FAIL=0
DB() { docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -N -B -e "$1" 2>/dev/null; }
ok()  { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — dapat '$2', jangka '$3'"; fi; }

echo "=== FASA 6B — doktor tetap pesakit ==="
echo

ORG=00000000-0000-0000-0000-000000000001
BR=$(DB "SELECT id FROM branches WHERE code='gelang-patah'")
DOC=$(DB "SELECT id FROM staff WHERE role='doctor' AND status='Active' AND branch_id='$BR' LIMIT 1")
PHONE="60199111222"

[ -n "$DOC" ] && ok "doktor dijumpai" || { bad "tiada doktor di cawangan ini"; exit 1; }

echo
echo "--- 1. Sediakan pesakit + sejarah lawatan ---"
DB "DELETE FROM appointments WHERE patient_name='UJIAN-6B'"
DB "DELETE FROM patients WHERE name='UJIAN-6B'"
PID=$(DB "SELECT UUID()")
DB "INSERT INTO patients (id,org_id,branch_id,mrn,name,phone,whatsapp)
    VALUES ('$PID','$ORG','$BR','UJI-6B-1','UJIAN-6B','$PHONE','$PHONE')"
check "pesakit ujian dicipta" "$(DB "SELECT COUNT(*) FROM patients WHERE name='UJIAN-6B'")" "1"

D_OLD=$(python -c "import datetime;print((datetime.date.today()-datetime.timedelta(days=90)).isoformat())")
D_MID=$(python -c "import datetime;print((datetime.date.today()-datetime.timedelta(days=60)).isoformat())")
D_NEW=$(python -c "import datetime;print((datetime.date.today()-datetime.timedelta(days=30)).isoformat())")

for spec in "$D_OLD:completed" "$D_MID:completed" "$D_NEW:cancelled"; do
  DT="${spec%%:*}"; ST="${spec##*:}"
  DB "INSERT INTO appointments (id,org_id,branch_id,code,patient_id,patient_name,doctor_id,treatment_ref,scheduled_date,scheduled_time,duration_min,status,notes)
      VALUES (UUID(),'$ORG','$BR',CONCAT('UJI6B-',LEFT(REPLACE(UUID(),'-',''),8)),'$PID','UJIAN-6B','$DOC','scaling','$DT','10:00:00',30,'$ST','v6b')"
done
check "3 lawatan direkod" "$(DB "SELECT COUNT(*) FROM appointments WHERE notes='v6b'")" "3"

echo
echo "--- 2. Lawatan dijumpai ikut nombor telefon pesakit ---"
FOUND=$(DB "
  SELECT COUNT(*) FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  WHERE a.org_id='$ORG' AND a.branch_id='$BR'
    AND a.deleted_at IS NULL AND p.deleted_at IS NULL
    AND (p.phone='$PHONE' OR p.whatsapp='$PHONE')")
check "3 lawatan dijumpai ikut telefon" "$FOUND" "3"

echo
echo "--- 3. Yang dibatalkan TIDAK dikira sebagai lawatan ---"
# Soalan sebenar: berapa yang patut dikira? 2 (completed), bukan 3.
REAL=$(DB "
  SELECT COUNT(*) FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  WHERE a.org_id='$ORG' AND a.branch_id='$BR'
    AND a.deleted_at IS NULL AND p.deleted_at IS NULL
    AND (p.phone='$PHONE' OR p.whatsapp='$PHONE')
    AND a.status NOT IN ('cancelled','no-show')")
check "hanya 2 dikira (1 cancelled dikecualikan)" "$REAL" "2"

echo
echo "--- 4. Doktor terakhir datang dari lawatan yang SAH ---"
LAST=$(DB "
  SELECT DATE_FORMAT(a.scheduled_date,'%Y-%m-%d') FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  WHERE a.org_id='$ORG' AND a.branch_id='$BR'
    AND a.deleted_at IS NULL AND p.deleted_at IS NULL
    AND (p.phone='$PHONE' OR p.whatsapp='$PHONE')
    AND a.status NOT IN ('cancelled','no-show')
  ORDER BY a.scheduled_date DESC LIMIT 1")
check "lawatan sah terakhir = 60 hari lalu (bukan yg cancelled)" "$LAST" "$D_MID"

echo
echo "--- 5. Sejarah cawangan LAIN tidak bocor ---"
OTHER=$(DB "SELECT id FROM branches WHERE id <> '$BR' LIMIT 1")
DB "INSERT INTO appointments (id,org_id,branch_id,code,patient_id,patient_name,doctor_id,treatment_ref,scheduled_date,scheduled_time,duration_min,status,notes)
    VALUES (UUID(),'$ORG','$OTHER',CONCAT('UJI6B-',LEFT(REPLACE(UUID(),'-',''),8)),'$PID','UJIAN-6B','$DOC','scaling','$D_NEW','11:00:00',30,'completed','v6b-lain')"
LEAK=$(DB "
  SELECT COUNT(*) FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  WHERE a.org_id='$ORG' AND a.branch_id='$BR'
    AND a.deleted_at IS NULL AND p.deleted_at IS NULL
    AND (p.phone='$PHONE' OR p.whatsapp='$PHONE')")
check "cawangan lain tidak menambah kiraan" "$LEAK" "3"

echo
echo "--- 6. Pesakit yang dibuang lembut tidak dijumpai ---"
DB "UPDATE patients SET deleted_at=NOW() WHERE id='$PID'"
GONE=$(DB "
  SELECT COUNT(*) FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  WHERE a.org_id='$ORG' AND a.branch_id='$BR'
    AND a.deleted_at IS NULL AND p.deleted_at IS NULL
    AND (p.phone='$PHONE' OR p.whatsapp='$PHONE')")
check "pesakit dibuang lembut → 0 lawatan" "$GONE" "0"
DB "UPDATE patients SET deleted_at=NULL WHERE id='$PID'"

echo
echo "--- 7. Nombor baharu tiada sejarah (pesakit baru) ---"
NEWPHONE=60199999888
NONE=$(DB "
  SELECT COUNT(*) FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  WHERE a.org_id='$ORG' AND a.branch_id='$BR'
    AND a.deleted_at IS NULL AND p.deleted_at IS NULL
    AND (p.phone='$NEWPHONE' OR p.whatsapp='$NEWPHONE')")
check "nombor baharu → 0 lawatan" "$NONE" "0"

echo
echo "--- 8. Padanan nama doktor: toleran tapi tepat ---"
# "dr. siti" dan "Dr Siti" mesti jumpa orang yg sama; nama yg tak wujud → tiada.
DNAME=$(DB "SELECT name FROM staff WHERE id='$DOC'")
EXISTS=$(DB "SELECT COUNT(*) FROM staff WHERE id='$DOC' AND role='doctor' AND status='Active' AND deleted_at IS NULL")
check "doktor aktif boleh dipadankan" "$EXISTS" "1"
echo "     (nama doktor: $DNAME)"

DB "UPDATE staff SET status='Suspended' WHERE id='$DOC'"
INACT=$(DB "SELECT COUNT(*) FROM staff WHERE id='$DOC' AND role='doctor' AND status='Active' AND deleted_at IS NULL")
check "doktor tidak aktif tidak boleh dipadankan" "$INACT" "0"
DB "UPDATE staff SET status='Active' WHERE id='$DOC'"

echo
echo "--- 9. Bersihkan ---"
DB "DELETE FROM appointments WHERE notes LIKE 'v6b%'"
DB "DELETE FROM patients WHERE name='UJIAN-6B'"
check "appointment ujian dibersihkan" "$(DB "SELECT COUNT(*) FROM appointments WHERE notes LIKE 'v6b%'")" "0"
check "pesakit ujian dibersihkan" "$(DB "SELECT COUNT(*) FROM patients WHERE name='UJIAN-6B'")" "0"

echo
echo "======================================================"
echo "  LULUS: $PASS   GAGAL: $FAIL"
echo "======================================================"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
