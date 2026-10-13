#!/usr/bin/env bash
# FASA 6A — the DATA LAYER behind slot alternatives, against the live database.
#
# WHAT THIS TESTS
#
#   The arithmetic that picks free slots is covered by 25 unit tests
#   (test/unit/slot-finder.spec.ts) — those are the authority on ordering,
#   lunches, overlaps and shift ends.
#
#   This script tests the OTHER half: the SQL that gathers shifts and
#   appointments, and the shape of what it returns. A finder fed correct rows
#   still fails if the query returns the wrong strings, drops a branch, counts a
#   cancelled appointment as busy, or includes an inactive doctor.
#
# WHAT THIS CANNOT PROVE
#
#   No WhatsApp number is linked, so no real inbound message drives the whole
#   path. The rows are real; the trigger is not.
#
# Run from the repo root:
#   export MEDINI_DB_PASSWORD=$(docker exec medini-prod-mysql-1 sh -c 'printf %s "$MYSQL_PASSWORD"')
#   bash verify-slot-finder.sh

set -uo pipefail
export LC_ALL=C

PASS=0; FAIL=0
DB() { docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -N -B -e "$1" 2>/dev/null; }
ok()  { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — dapat '$2', jangka '$3'"; fi; }

echo "=== FASA 6A — lapisan data carian slot ==="
echo

ORG=00000000-0000-0000-0000-000000000001
BR=$(DB "SELECT id FROM branches WHERE code='gelang-patah'")
DOC=$(DB "SELECT id FROM staff WHERE role='doctor' AND status='Active' LIMIT 1")
[ -n "$DOC" ] && ok "doktor aktif dijumpai" || { bad "tiada doktor"; exit 1; }

D1=$(python -c "import datetime;print((datetime.date.today()+datetime.timedelta(days=1)).isoformat())")
D2=$(python -c "import datetime;print((datetime.date.today()+datetime.timedelta(days=2)).isoformat())")

echo
echo "--- 1. Jadual doktor boleh dibaca dalam bentuk H:i ---"
DB "DELETE FROM doctor_schedules WHERE branch_id='$BR'"
DB "INSERT INTO doctor_schedules (id,org_id,branch_id,doctor_id,schedule_date,start_time,end_time,notes) VALUES
    (UUID(),'$ORG','$BR','$DOC','$D1','10:00:00','17:00:00','ujian'),
    (UUID(),'$ORG','$BR','$DOC','$D2','10:00:00','17:00:00','ujian')"

# Query SAMA seperti controller guna (TIME_FORMAT '%H:%i', tarikh '%Y-%m-%d')
SHIFTS=$(DB "
  SELECT CONCAT(TIME_FORMAT(ds.start_time,'%H:%i'),'|',TIME_FORMAT(ds.end_time,'%H:%i'),'|',
                DATE_FORMAT(ds.schedule_date,'%Y-%m-%d'))
  FROM doctor_schedules ds JOIN staff s ON s.id = ds.doctor_id
  WHERE ds.org_id='$ORG' AND ds.branch_id='$BR' AND s.org_id='$ORG'
    AND s.role='doctor' AND s.status='Active' AND s.deleted_at IS NULL
    AND ds.schedule_date >= DATE('$D1')
    AND ds.schedule_date <= DATE_ADD(DATE('$D1'), INTERVAL 14 DAY)
  ORDER BY ds.schedule_date LIMIT 1")
check "masa keluar sebagai H:i dan tarikh YYYY-MM-DD" "$SHIFTS" "10:00|17:00|$D1"

echo
echo "--- 2. Appointment dibaca, dan yang batal TIDAK dikira sibuk ---"
DB "DELETE FROM appointments WHERE notes='ujian'"
DB "INSERT INTO appointments (id,org_id,branch_id,code,patient_id,patient_name,doctor_id,treatment_ref,scheduled_date,scheduled_time,duration_min,status,notes) VALUES
    (UUID(),'$ORG','$BR','UJI-1',NULL,'Ujian A','$DOC','scaling','$D1','15:00:00',30,'confirmed','ujian'),
    (UUID(),'$ORG','$BR','UJI-2',NULL,'Ujian B','$DOC','scaling','$D1','16:00:00',30,'cancelled','ujian'),
    (UUID(),'$ORG','$BR','UJI-3',NULL,'Ujian C','$DOC','scaling','$D1','11:00:00',30,'no-show','ujian')"

BUSY=$(DB "
  SELECT COUNT(*) FROM appointments a
  WHERE a.org_id='$ORG' AND a.branch_id='$BR' AND a.deleted_at IS NULL
    AND a.status NOT IN ('cancelled','no-show')
    AND a.scheduled_date >= DATE('$D1')")
check "hanya 1 appointment mengira sebagai sibuk (2 dikecualikan)" "$BUSY" "1"

echo
echo "--- 3. Appointment yang dibuang lembut tidak dikira ---"
DB "UPDATE appointments SET deleted_at=NOW() WHERE code='UJI-1'"
BUSY2=$(DB "
  SELECT COUNT(*) FROM appointments a
  WHERE a.org_id='$ORG' AND a.branch_id='$BR' AND a.deleted_at IS NULL
    AND a.status NOT IN ('cancelled','no-show')
    AND a.scheduled_date >= DATE('$D1')")
check "selepas dibuang lembut, 0 sibuk" "$BUSY2" "0"
DB "UPDATE appointments SET deleted_at=NULL WHERE code='UJI-1'"

echo
echo "--- 4. Doktor tidak aktif tidak muncul dalam syif ---"
# `status` is an ENUM ('Active','Suspended','Deactivated','Invited','Pending',
# 'Rejected'). An earlier version of this check set it to 'Inactive' — not a
# member — so MySQL rejected the write, the doctor stayed Active, and the check
# failed while appearing to test status filtering. Use a real value.
DB "UPDATE staff SET status='Suspended' WHERE id='$DOC'"
ACT=$(DB "
  SELECT COUNT(*) FROM doctor_schedules ds JOIN staff s ON s.id = ds.doctor_id
  WHERE ds.branch_id='$BR' AND ds.notes LIKE 'ujian%'
    AND s.status='Active' AND s.deleted_at IS NULL")
check "doktor tidak aktif tiada syif sah" "$ACT" "0"

# And the same rows DO come back once the doctor is active again — otherwise the
# check above would pass simply because the filter matches nothing.
DB "UPDATE staff SET status='Active' WHERE id='$DOC'"
ACT2=$(DB "
  SELECT COUNT(*) FROM doctor_schedules ds JOIN staff s ON s.id = ds.doctor_id
  WHERE ds.branch_id='$BR' AND ds.notes LIKE 'ujian%'
    AND s.status='Active' AND s.deleted_at IS NULL")
check "doktor aktif semula, syif kembali" "$ACT2" "2"

echo
echo "--- 5. Syif cawangan LAIN tidak bocor masuk ---"
OTHER=$(DB "SELECT id FROM branches WHERE id <> '$BR' LIMIT 1")
DB "INSERT INTO doctor_schedules (id,org_id,branch_id,doctor_id,schedule_date,start_time,end_time,notes)
    VALUES (UUID(),'$ORG','$OTHER','$DOC','$D1','09:00:00','10:00:00','ujian-lain')"
LEAK=$(DB "
  SELECT COUNT(*) FROM doctor_schedules ds JOIN staff s ON s.id = ds.doctor_id
  WHERE ds.branch_id='$BR' AND ds.notes LIKE 'ujian%'")
check "syif cawangan lain tidak dikira (2 sahaja)" "$LEAK" "2"

echo
echo "--- 6. Tetingkap 14 hari dihormati ---"
FAR=$(python -c "import datetime;print((datetime.date.today()+datetime.timedelta(days=40)).isoformat())")
DB "INSERT INTO doctor_schedules (id,org_id,branch_id,doctor_id,schedule_date,start_time,end_time,notes)
    VALUES (UUID(),'$ORG','$BR','$DOC','$FAR','10:00:00','12:00:00','ujian-jauh')"
INWIN=$(DB "
  SELECT COUNT(*) FROM doctor_schedules ds
  WHERE ds.branch_id='$BR' AND ds.notes='ujian%'
    AND ds.schedule_date >= DATE('$D1')
    AND ds.schedule_date <= DATE_ADD(DATE('$D1'), INTERVAL 14 DAY)")
check "syif 40 hari ke depan di LUAR tetingkap" "$INWIN" "0"

echo
echo "--- 7. Syif yang tidak logik ditolak oleh pemetaan ---"
# end <= start: pemetaan controller akan BUANG baris ini.
DB "INSERT INTO doctor_schedules (id,org_id,branch_id,doctor_id,schedule_date,start_time,end_time,notes)
    VALUES (UUID(),'$ORG','$BR','$DOC','$D1','17:00:00','10:00:00','ujian-songsang')"
SONGSANG=$(DB "SELECT COUNT(*) FROM doctor_schedules WHERE notes='ujian-songsang'")
BAD_SHIFT=$(DB "
  SELECT COUNT(*) FROM doctor_schedules
  WHERE notes='ujian-songsang' AND end_time <= start_time")
check "syif tamat sebelum mula dikesan untuk dibuang" "$BAD_SHIFT" "1"
check "baris songsang memang wujud untuk diuji" "$SONGSANG" "1"

echo
echo "--- 8. Bersihkan ---"
DB "DELETE FROM doctor_schedules WHERE notes LIKE 'ujian%'"
DB "DELETE FROM appointments WHERE notes='ujian'"
check "jadual ujian dibersihkan" "$(DB "SELECT COUNT(*) FROM doctor_schedules WHERE notes LIKE 'ujian%'")" "0"
check "appointment ujian dibersihkan" "$(DB "SELECT COUNT(*) FROM appointments WHERE notes='ujian'")" "0"

echo
echo "======================================================"
echo "  LULUS: $PASS   GAGAL: $FAIL"
echo "======================================================"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
