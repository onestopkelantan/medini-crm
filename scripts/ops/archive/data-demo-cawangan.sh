#!/usr/bin/env bash
# ============================================================================
# data-demo-cawangan.sh — variasi data demo merentas CAWANGAN (8 Okt 2026).
#
# MENGAPA SKRIP INI WUJUD
#   sediakan-data-demo-penuh.sh mengisi 3 cawangan (Setia Tropika, Bukit
#   Indah, Gelang Patah) sahaja. Akaun demo manager (Sentosa) dan reception
#   (UDA Business Centre) log masuk dan nampak SKRIN KOSONG — tak boleh
#   menguji skop cawangan dengan mata sendiri.
#
#   Skrip ini menambah beberapa baris DEMO pada cawangan berbeda supaya
#   perbezaan antara cawangan KELIHATAN: setiap branch ada yang SAMA
#   (temujanji scaling, misalnya) dan yang BERBEZA (jumlah, jenis pesakit,
#   status jualan). Semua baris berlabel DEMO- dan boleh dibuang dengan
#   padam-data-demo.sh.
#
# IDEMPOTEN: fixed UUID + INSERT IGNORE — jalankan berkali-kali tidak
# mendatangkan apa-apa.
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")"

DB=medini-prod-mysql-1
ORG=00000000-0000-0000-0000-000000000001
WP=$(docker exec "$DB" sh -c 'printf %s "$MYSQL_PASSWORD"')
q()  { docker exec -i "$DB" mysql -umedini -p"$WP" medini_prod -N -B -e "$1" 2>/dev/null | tr -d '\r'; }
qx() {
  local err
  err=$(docker exec -i "$DB" mysql -umedini -p"$WP" medini_prod -e "$1" 2>&1 | grep -v "Using a password" || true)
  [ -n "$err" ] && echo "  SQL ERROR: $err"
  return 0
}

SENTOSA=$(q "SELECT id FROM branches WHERE code='sentosa'")
UDA=$(q "SELECT id FROM branches WHERE code='uda-business-centre'")
PASIR=$(q "SELECT id FROM branches WHERE code='pasir-gudang'")
TAMAN=$(q "SELECT id FROM branches WHERE code='taman-daya'")
echo "cawangan sasaran: Sentosa=$SENTOSA UDA=$UDA PasirGudang=$PASIR TamanDaya=$TAMAN"

echo "== pesakit baharu (2 setiap cawangan, profil berbeza) =="
qx "
INSERT IGNORE INTO patients (id, org_id, branch_id, mrn, name, ic, dob, gender, nationality, phone, whatsapp, email, patient_type, contact_type, status, patient_source, created_at) VALUES
('de000016-0000-4000-8000-000000000016','$ORG','$SENTOSA','DEMO-0016','Gan Zhi Wei','900909-01-1234','1990-09-09','male','Malaysian','60123456716','60123456716',NULL,'adult','own','Active','Walk-in', NOW() - INTERVAL 4 DAY),
('de000017-0000-4000-8000-000000000017','$ORG','$SENTOSA','DEMO-0017','Noraini binti Kassim','600505-01-5678','1960-05-05','female','Malaysian','60123456717','60123456717','noraini.k@example.com','senior','own','Active','Referral', NOW() - INTERVAL 9 DAY),
('de000018-0000-4000-8000-000000000018','$ORG','$UDA','DEMO-0018','Amirul Hakim bin Roslan','950303-01-9012','1995-03-03','male','Malaysian','60123456718','60123456718',NULL,'adult','own','Active','Walk-in', NOW() - INTERVAL 2 DAY),
('de000019-0000-4000-8000-000000000019','$ORG','$UDA','DEMO-0019','Grace Tan Mei Yee','881212-01-3456','1988-12-12','female','Malaysian','60123456719','60123456719','grace.t@example.com','adult','own','VIP','Referral', NOW() - INTERVAL 30 DAY),
('de000020-0000-4000-8000-000000000020','$ORG','$PASIR','DEMO-0020','Hafiz bin Salleh','000101-01-7890','2000-01-01','male','Malaysian','60123456720','60123456720',NULL,'adult','own','Active','Walk-in', NOW() - INTERVAL 7 DAY),
('de000021-0000-4000-8000-000000000021','$ORG','$TAMAN','DEMO-0021','Siti Aminah binti Abdullah','980707-01-1357','1998-07-07','female','Malaysian','60123456721','60123456721',NULL,'adult','own','Active','Appointment', NOW() - INTERVAL 11 DAY);"
echo "  pesakit baharu: $(q "SELECT COUNT(*) FROM patients WHERE mrn LIKE 'DEMO-%'")"

echo "== temujanji: SAMA jenis (scaling) tapi status BERBEZA antara cawangan =="
qx "
INSERT IGNORE INTO appointments (id, org_id, branch_id, code, patient_id, patient_name, doctor_id, treatment_ref, scheduled_date, scheduled_time, duration_min, status, notes) VALUES
('de070015-0000-4000-8000-000000000015','$ORG','$SENTOSA','DEMO-APPT-0015','de000016-0000-4000-8000-000000000016','Gan Zhi Wei',NULL,'Scaling & Polishing', CURDATE(),'09:30:00',45,'confirmed','DEMO scaling - sama seperti branch lain'),
('de070016-0000-4000-8000-000000000016','$ORG','$SENTOSA','DEMO-APPT-0016','de000017-0000-4000-8000-000000000017','Noraini binti Kassim',NULL,'Consultation & Examination', CURDATE() - INTERVAL 1 DAY,'10:00:00',30,'completed','DEMO selesai'),
('de070017-0000-4000-8000-000000000017','$ORG','$UDA','DEMO-APPT-0017','de000018-0000-4000-8000-000000000018','Amirul Hakim bin Roslan',NULL,'Scaling & Polishing', CURDATE(),'11:00:00',45,'checked-in','DEMO scaling - kini di klinik'),
('de070018-0000-4000-8000-000000000018','$ORG','$UDA','DEMO-APPT-0018','de000019-0000-4000-8000-000000000019','Grace Tan Mei Yee',NULL,'Teeth Whitening (In-Office)', CURDATE() + INTERVAL 2 DAY,'15:00:00',60,'booked','DEMO akan datang'),
('de070019-0000-4000-8000-000000000019','$ORG','$PASIR','DEMO-APPT-0019','de000020-0000-4000-8000-000000000020','Hafiz bin Salleh',NULL,'Scaling & Polishing', CURDATE() - INTERVAL 2 DAY,'16:00:00',45,'no-show','DEMO tidak hadir'),
('de070020-0000-4000-8000-000000000020','$ORG','$TAMAN','DEMO-APPT-0020','de000021-0000-4000-8000-000000000021','Siti Aminah binti Abdullah',NULL,'Scaling & Polishing', CURDATE() + INTERVAL 1 DAY,'10:30:00',45,'confirmed','DEMO scaling - esok');"
echo "  temujanji baharu: $(q "SELECT COUNT(*) FROM appointments WHERE code LIKE 'DEMO-APPT-001[5-9]' OR code='DEMO-APPT-0020'")"

echo "== jualan: Setia tropika sedia ada; tambah Sentosa (besar) & UDA (kecil) =="
qx "
INSERT IGNORE INTO sale_records (id, org_id, branch_id, patient_id, sale_code, source_system, amount, sale_date, status, notes) VALUES
('de140005-0000-4000-8000-000000000005','$ORG','$SENTOSA','de000016-0000-4000-8000-000000000016','DEMO-SALE-0005','pos',350.0000, CURDATE() - INTERVAL 1 DAY,'confirmed','DEMO bayaran tunai'),
('de140006-0000-4000-8000-000000000006','$ORG','$SENTOSA','de000017-0000-4000-8000-000000000017','DEMO-SALE-0006','pos',180.0000, CURDATE() - INTERVAL 9 DAY,'confirmed','DEMO bayaran kad'),
('de140007-0000-4000-8000-000000000007','$ORG','$UDA','de000019-0000-4000-8000-000000000019','DEMO-SALE-0007','pos',800.0000, CURDATE() - INTERVAL 30 DAY,'confirmed','DEMO whitening pakej'),
('de140008-0000-4000-8000-000000000008','$ORG','$PASIR',NULL,'DEMO-SALE-0008','pos',60.0000, CURDATE() - INTERVAL 2 DAY,'pending','DEMO belum sahkan');"

echo "== perbelanjaan: UDA (sewa besar) & Pasir Gudang (utiliti kecil) =="
qx "
INSERT IGNORE INTO expenses (id, org_id, branch_id, expense_code, category, payee, amount, expense_date, due_date, status, notes) VALUES
('de150005-0000-4000-8000-000000000005','$ORG','$UDA','DEMO-EXP-0005','Rent','UDA Holdings',4200.0000, CURDATE() - INTERVAL 3 DAY, CURDATE() + INTERVAL 7 DAY,'approved','DEMO sewa UDA'),
('de150006-0000-4000-8000-000000000006','$ORG','$PASIR','DEMO-EXP-0006','Utilities','TNB',290.0000, CURDATE() - INTERVAL 8 DAY, CURDATE(),'paid','DEMO elektrik Pasir Gudang');"

echo ""
echo "== RINGKASAN VARIASI CAWANGAN =="
q "SELECT b.short_name,
  (SELECT COUNT(*) FROM patients p WHERE p.branch_id=b.id AND p.mrn LIKE 'DEMO%') AS pesakit,
  (SELECT COUNT(*) FROM appointments a WHERE a.branch_id=b.id AND a.code LIKE 'DEMO%') AS temujanji,
  (SELECT COALESCE(SUM(s.amount),0) FROM sale_records s WHERE s.branch_id=b.id AND s.sale_code LIKE 'DEMO%') AS hasil
FROM branches b WHERE b.deleted_at IS NULL
  AND (SELECT COUNT(*) FROM patients p WHERE p.branch_id=b.id AND p.mrn LIKE 'DEMO%') > 0
ORDER BY b.short_name;"
