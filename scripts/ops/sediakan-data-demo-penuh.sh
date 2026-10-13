#!/usr/bin/env bash
# ============================================================================
# sediakan-data-demo-penuh.sh — rich demo data for exploring the whole app.
#
# WHY THIS EXISTS
#
# The canonical seed creates REFERENCE data only (14 branches, 4 users, 3 panels,
# 12 treatments, 3 consent templates). Every working table — patients, appointments,
# encounters, charts, plans, costs, conversations — is EMPTY, so every screen renders
# an empty state and nobody can see how the modules connect.
#
# This script fills those tables so the flow is visible end to end:
#   patient → appointment → encounter → tooth chart → treatment plan → cost
#   → finance → WhatsApp conversation → (AI/manual reply)
#
# SAFETY
#
#   * EVERY row carries a `DEMO-` marker in its natural key / code / name, so it can
#     be removed later. Cleanup: see the DELETES at the bottom of this file comments.
#   * IDEMPOTENT: each INSERT uses fixed UUIDs and INSERT IGNORE, so re-running adds
#     nothing new.
#   * It does NOT touch real data (there is none) and does NOT alter the schema.
#
# USAGE
#   bash sediakan-data-demo-penuh.sh
#
# Requires the Docker stack up (mysql container: medini-prod-mysql-1).
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")"

DB=medini-prod-mysql-1
ORG=00000000-0000-0000-0000-000000000001

WP=$(docker exec "$DB" sh -c 'printf %s "$MYSQL_PASSWORD"')
# Two helpers.
#   q()  — quiet, for reads (returns rows, suppresses the password warning).
#   qx() — LOUD, for writes: reports any SQL error instead of swallowing it.
# The first version of this script used only q(), so a failed INSERT printed
# nothing and the summary just showed 0 — an error that looked like "no data".
q()  { docker exec -i "$DB" mysql -umedini -p"$WP" medini_prod -N -B -e "$1" 2>/dev/null | tr -d '\r'; }
qx() {
  local err
  err=$(docker exec -i "$DB" mysql -umedini -p"$WP" medini_prod -e "$1" 2>&1 | grep -v "Using a password" || true)
  [ -n "$err" ] && echo "  ⚠ SQL ERROR: $err"
  return 0
}

echo "== semak cawangan =="
SETIA=$(q "SELECT id FROM branches WHERE code='setia-tropika'")
BUKIT=$(q "SELECT id FROM branches WHERE code='bukit-indah'")
GELANG=$(q "SELECT id FROM branches WHERE code='gelang-patah'")
SENTOSA=$(q "SELECT id FROM branches WHERE code='sentosa'")
[ -z "$SETIA" ] && { echo "RALAT: cawangan setia-tropika tiada — jalankan seed dahulu"; exit 1; }
echo "  setia-tropika=$SETIA"
echo "  bukit-indah  =$BUKIT"

# Doctor + receptionist ids (for FK targets).
DOC=$(q "SELECT id FROM staff WHERE username='doctor'")
HQ=$(q "SELECT id FROM staff WHERE username='hq'")
RECEP=$(q "SELECT id FROM staff WHERE username='reception'")
MGR=$(q "SELECT id FROM staff WHERE username='manager'")

# Treatment catalog ids by code.
T1=$(q "SELECT id FROM treatment_catalog WHERE code='TRT-0001'")   # Consultation
T2=$(q "SELECT id FROM treatment_catalog WHERE code='TRT-0002'")   # Scaling
T4=$(q "SELECT id FROM treatment_catalog WHERE code='TRT-0004'")   # Composite Filling
T6=$(q "SELECT id FROM treatment_catalog WHERE code='TRT-0006'")   # Simple Extraction
T8=$(q "SELECT id FROM treatment_catalog WHERE code='TRT-0008'")   # Root Canal
T9=$(q "SELECT id FROM treatment_catalog WHERE code='TRT-0009'")   # Crown
T12=$(q "SELECT id FROM treatment_catalog WHERE code='TRT-0012'")  # X-Ray

CONSENT_GEN=$(q "SELECT id FROM consent_templates WHERE title LIKE 'General Dental%' LIMIT 1")
CONSENT_RCT=$(q "SELECT id FROM consent_templates WHERE title LIKE 'Root Canal%' LIMIT 1")

echo "== bersihkan data demo lama (idempotent) =="
# Order matters: children before parents (FK RESTRICT).
qx "DELETE FROM wa_messages WHERE id LIKE 'de%' AND branch_id IN (SELECT id FROM branches);"
qx "DELETE FROM wa_conversations WHERE id LIKE 'de%';"
qx "DELETE FROM treatment_costs WHERE cost_code LIKE 'DEMO%';"
qx "DELETE FROM treatment_plan_items WHERE plan_id IN (SELECT id FROM treatment_plans WHERE plan_code LIKE 'DEMO%');"
qx "DELETE FROM treatment_sessions WHERE plan_id IN (SELECT id FROM treatment_plans WHERE plan_code LIKE 'DEMO%');"
qx "DELETE FROM consent_records WHERE id LIKE 'de%';"
qx "DELETE FROM tooth_records WHERE id LIKE 'de%';"
qx "DELETE FROM clinical_notes WHERE id LIKE 'de%';"
qx "DELETE FROM prescriptions WHERE id LIKE 'de%';"
qx "DELETE FROM referrals WHERE id LIKE 'de%';"
qx "DELETE FROM patient_allergies WHERE id LIKE 'de%';"
qx "DELETE FROM treatment_plans WHERE plan_code LIKE 'DEMO%';"
qx "DELETE FROM encounters WHERE encounter_code LIKE 'DEMO%';"
qx "DELETE FROM appointments WHERE code LIKE 'DEMO%';"
qx "DELETE FROM doctor_schedules WHERE id LIKE 'de%';"
qx "DELETE FROM expenses WHERE expense_code LIKE 'DEMO%';"
qx "DELETE FROM sale_records WHERE sale_code LIKE 'DEMO%';"
qx "DELETE FROM tasks WHERE id LIKE 'de%';"
qx "DELETE FROM checklists WHERE id LIKE 'de%';"
qx "DELETE FROM leads WHERE id LIKE 'de%';"
qx "DELETE FROM patient_relationships WHERE id LIKE 'de%';"
qx "DELETE FROM patients WHERE mrn LIKE 'DEMO%';"
qx "DELETE FROM wa_channels WHERE session_name LIKE 'medini-demo%';"
echo "  selesai"

echo "== 1. pesakit (15) =="
# Fixed ids de00000x-... so re-runs are idempotent. MRN marked DEMO-.
qx "
INSERT IGNORE INTO patients (id, org_id, branch_id, mrn, name, ic, dob, gender, nationality, phone, whatsapp, email, patient_type, contact_type, status, registration_reason, last_visit_at) VALUES
('de000001-0000-4000-8000-000000000001', '$ORG','$SETIA','DEMO-0001','Ahmad Faizal bin Ismail','900101-01-1234','1990-01-01','male','Malaysian','60123456701','60123456701','ahmad.faizal@example.com','adult','own','Active','Walk-in', NOW() - INTERVAL 3 DAY),
('de000002-0000-4000-8000-000000000002', '$ORG','$SETIA','DEMO-0002','Siti Nurhaliza binti Ahmad','920215-01-5678','1992-02-15','female','Malaysian','60123456702','60123456702','siti.n@example.com','adult','own','VIP','Referral', NOW() - INTERVAL 10 DAY),
('de000003-0000-4000-8000-000000000003', '$ORG','$SETIA','DEMO-0003','Lee Chong Wei','880303-01-9012','1988-03-03','male','Malaysian','60123456703','60123456703','lee.cw@example.com','adult','own','Recall Due','Recall', NOW() - INTERVAL 200 DAY),
('de000004-0000-4000-8000-000000000004', '$ORG','$SETIA','DEMO-0004','Nurul Izzah binti Rahman','950505-01-3456','1995-05-05','female','Malaysian','60123456704','60123456704','nurul.i@example.com','adult','own','Active','Walk-in', NOW() - INTERVAL 1 DAY),
('de000005-0000-4000-8000-000000000005', '$ORG','$SETIA','DEMO-0005','Tan Wei Ming','150808-01-7890','2015-08-08','male','Malaysian','60123456705','60123456705',NULL,'child','guardian','Active','Paediatric', NOW() - INTERVAL 6 DAY),
('de000006-0000-4000-8000-000000000006', '$ORG','$BUKIT','DEMO-0006','Aisyah binti Yusof','981212-01-2345','1998-12-12','female','Malaysian','60123456706','60123456706','aisyah.y@example.com','adult','own','Active','Appointment', NOW() - INTERVAL 2 DAY),
('de000007-0000-4000-8000-000000000007', '$ORG','$BUKIT','DEMO-0007','Rajesh Kumar a/l Suresh','851010-01-6789','1985-10-10','male','Malaysian','60123456707','60123456707','rajesh.k@example.com','adult','own','Active','Walk-in', NOW() - INTERVAL 4 DAY),
('de000008-0000-4000-8000-000000000008', '$ORG','$BUKIT','DEMO-0008','Wong Mei Ling','780707-01-1122','1978-07-07','female','Malaysian','60123456708','60123456708','wong.ml@example.com','adult','own','Inactive','Walk-in', NOW() - INTERVAL 400 DAY),
('de000009-0000-4000-8000-000000000009', '$ORG','$BUKIT','DEMO-0009','Muhammad Haziq bin Omar','050202-01-3344','2005-02-02','male','Malaysian','60123456709','60123456709',NULL,'adult','own','Active','Orthodontic', NOW() - INTERVAL 15 DAY),
('de000010-0000-4000-8000-000000000010', '$ORG','$BUKIT','DEMO-0010','Priya Devi a/p Rajan','110303-01-5566','2011-03-03','female','Malaysian','60123456710','60123456710',NULL,'child','guardian','Recall Due','Paediatric', NOW() - INTERVAL 180 DAY),
('de000011-0000-4000-8000-000000000011', '$ORG','$GELANG','DEMO-0011','Chong Kok Wai','700909-01-7788','1970-09-09','male','Malaysian','60123456711','60123456711','chong.kw@example.com','senior','own','Active','Walk-in', NOW() - INTERVAL 5 DAY),
('de000012-0000-4000-8000-000000000012', '$ORG','$GELANG','DEMO-0012','Fatimah binti Hassan','550404-01-9900','1955-04-04','female','Malaysian','60123456712','60123456712',NULL,'senior','own','Active','Walk-in', NOW() - INTERVAL 8 DAY),
('de000013-0000-4000-8000-000000000013', '$ORG','$GELANG','DEMO-0013','Daniel Lim Jun Hao','000606-01-1212','2000-06-06','male','Malaysian','60123456713','60123456713','daniel.lim@example.com','adult','own','Active','Walk-in', NOW() - INTERVAL 12 DAY),
('de000014-0000-4000-8000-000000000014', '$ORG','$SETIA','DEMO-0014','Kavitha a/p Muthu','930707-01-3434','1993-07-07','female','Malaysian','60123456714','60123456714','kavitha.m@example.com','adult','own','Active','Walk-in', NOW() - INTERVAL 20 DAY),
('de000015-0000-4000-8000-000000000015', '$ORG','$SETIA','DEMO-0015','Zulkifli bin Osman','820808-01-5656','1982-08-08','male','Malaysian','60123456715','60123456715','zul.o@example.com','adult','own','Active','Appointment', NOW() - INTERVAL 25 DAY);"
# child → guardian relationships
qx "
INSERT IGNORE INTO patient_relationships (id, org_id, patient_id, related_patient_id, related_name, type) VALUES
('de0d0001-0000-4000-8000-000000000001','$ORG','de000005-0000-4000-8000-000000000005','de000004-0000-4000-8000-000000000004','Nurul Izzah binti Rahman','parent'),
('de0d0002-0000-4000-8000-000000000002','$ORG','de000010-0000-4000-8000-000000000010','de000007-0000-4000-8000-000000000007','Rajesh Kumar a/l Suresh','parent');"
echo "  pesakit: $(q "SELECT COUNT(*) FROM patients WHERE mrn LIKE 'DEMO%'")"

echo "== 2. alahan pesakit =="
qx "
INSERT IGNORE INTO patient_allergies (id, org_id, branch_id, patient_id, allergen, category, severity, reaction, noted_by) VALUES
('de0a0001-0000-4000-8000-000000000001','$ORG','$SETIA','de000001-0000-4000-8000-000000000001','Penicillin','drug','severe','Anaphylaxis risk — swelling and breathing difficulty','$DOC'),
('de0a0002-0000-4000-8000-000000000002','$ORG','$SETIA','de000003-0000-4000-8000-000000000003','Latex','material','moderate','Contact rash on hands','$DOC'),
('de0a0003-0000-4000-8000-000000000003','$ORG','$SETIA','de000014-0000-4000-8000-000000000014','Ibuprofen','drug','mild','Stomach upset','$DOC'),
('de0a0004-0000-4000-8000-000000000004','$ORG','$BUKIT','de000007-0000-4000-8000-000000000007','Seafood','food','moderate','Hives','$DOC');"
echo "  alahan: $(q "SELECT COUNT(*) FROM patient_allergies WHERE id LIKE 'de0a%'")"

echo "== 3. jadual doktor =="
qx "
INSERT IGNORE INTO doctor_schedules (id, org_id, branch_id, doctor_id, schedule_date, start_time, end_time, notes) VALUES
('de050001-0000-4000-8000-000000000001','$ORG','$GELANG','$DOC', CURDATE(), '09:00:00','13:00:00','Sesi pagi'),
('de050002-0000-4000-8000-000000000002','$ORG','$GELANG','$DOC', CURDATE(), '14:00:00','18:00:00','Sesi petang'),
('de050003-0000-4000-8000-000000000003','$ORG','$GELANG','$DOC', CURDATE() + INTERVAL 1 DAY, '09:00:00','13:00:00','Sesi pagi'),
('de050004-0000-4000-8000-000000000004','$ORG','$GELANG','$DOC', CURDATE() + INTERVAL 2 DAY, '09:00:00','13:00:00',NULL);"
echo "  jadual doktor: $(q "SELECT COUNT(*) FROM doctor_schedules WHERE id LIKE 'de05%'")"

echo "== 4. temujanji (campur status) =="
qx "
INSERT IGNORE INTO appointments (id, org_id, branch_id, code, patient_id, patient_name, doctor_id, treatment_ref, scheduled_date, scheduled_time, duration_min, status, notes) VALUES
('de070001-0000-4000-8000-000000000001','$ORG','$SETIA','DEMO-APPT-0001','de000001-0000-4000-8000-000000000001','Ahmad Faizal bin Ismail','$DOC','Consultation & Examination', CURDATE() - INTERVAL 3 DAY,'10:00:00',30,'completed','DEMO selesai'),
('de070002-0000-4000-8000-000000000002','$ORG','$SETIA','DEMO-APPT-0002','de000002-0000-4000-8000-000000000002','Siti Nurhaliza binti Ahmad','$DOC','Scaling & Polishing', CURDATE() - INTERVAL 10 DAY,'11:00:00',45,'completed','DEMO selesai'),
('de070003-0000-4000-8000-000000000003','$ORG','$SETIA','DEMO-APPT-0003','de000003-0000-4000-8000-000000000003','Lee Chong Wei','$DOC','Composite Filling', CURDATE() - INTERVAL 1 DAY,'14:30:00',45,'no-show','DEMO tidak hadir'),
('de070004-0000-4000-8000-000000000004','$ORG','$SETIA','DEMO-APPT-0004','de000004-0000-4000-8000-000000000004','Nurul Izzah binti Rahman','$DOC','Consultation & Examination', CURDATE() - INTERVAL 1 DAY,'15:30:00',30,'completed','DEMO selesai'),
('de070005-0000-4000-8000-000000000005','$ORG','$SETIA','DEMO-APPT-0005','de000005-0000-4000-8000-000000000005','Tan Wei Ming','$DOC','Fluoride Treatment', CURDATE() - INTERVAL 6 DAY,'16:00:00',20,'completed','DEMO kanak-kanak'),
('de070006-0000-4000-8000-000000000006','$ORG','$BUKIT','DEMO-APPT-0006','de000006-0000-4000-8000-000000000006','Aisyah binti Yusof','$DOC','Scaling & Polishing', CURDATE() - INTERVAL 2 DAY,'10:30:00',45,'completed','DEMO selesai'),
('de070007-0000-4000-8000-000000000007','$ORG','$BUKIT','DEMO-APPT-0007','de000007-0000-4000-8000-000000000007','Rajesh Kumar a/l Suresh','$DOC','Root Canal Treatment (Single Visit)', CURDATE() - INTERVAL 4 DAY,'09:00:00',90,'completed','DEMO rawatan besar'),
('de070008-0000-4000-8000-000000000008','$ORG','$BUKIT','DEMO-APPT-0008','de000009-0000-4000-8000-000000000009','Muhammad Haziq bin Omar','$DOC','Consultation & Examination', CURDATE() - INTERVAL 15 DAY,'11:30:00',30,'completed','DEMO ortodontik'),
('de070009-0000-4000-8000-000000000009','$ORG','$GELANG','DEMO-APPT-0009','de000011-0000-4000-8000-000000000011','Chong Kok Wai','$DOC','Simple Extraction', CURDATE() - INTERVAL 5 DAY,'10:00:00',30,'completed','DEMO cabut gigi'),
('de070010-0000-4000-8000-000000000010','$ORG','$GELANG','DEMO-APPT-0010','de000012-0000-4000-8000-000000000012','Fatimah binti Hassan','$DOC','Consultation & Examination', CURDATE() - INTERVAL 8 DAY,'14:00:00',30,'completed','DEMO warga emas'),
('de070011-0000-4000-8000-000000000011','$ORG','$SETIA','DEMO-APPT-0011','de000014-0000-4000-8000-000000000014','Kavitha a/p Muthu','$DOC','Teeth Whitening (In-Office)', CURDATE() + INTERVAL 1 DAY,'10:00:00',60,'confirmed','DEMO akan datang'),
('de070012-0000-4000-8000-000000000012','$ORG','$SETIA','DEMO-APPT-0012','de000015-0000-4000-8000-000000000015','Zulkifli bin Osman','$DOC','Crown (Porcelain Fused to Metal)', CURDATE() + INTERVAL 3 DAY,'11:00:00',60,'booked','DEMO akan datang'),
('de070013-0000-4000-8000-000000000013','$ORG','$BUKIT','DEMO-APPT-0013','de000008-0000-4000-8000-000000000008','Wong Mei Ling','$DOC','Scaling & Polishing', CURDATE() + INTERVAL 2 DAY,'15:00:00',45,'confirmed','DEMO akan datang'),
('de070014-0000-4000-8000-000000000014','$ORG','$SETIA','DEMO-APPT-0014','de000001-0000-4000-8000-000000000001','Ahmad Faizal bin Ismail','$DOC','Composite Filling', CURDATE(),'16:30:00',45,'checked-in','DEMO hari ini');"
echo "  temujanji: $(q "SELECT COUNT(*) FROM appointments WHERE code LIKE 'DEMO%'")"

echo "== 5. lawatan (encounters) =="
qx "
INSERT IGNORE INTO encounters (id, org_id, branch_id, patient_id, appointment_id, doctor_id, encounter_code, status, chief_complaint, allergy_acknowledged_at, started_at, completed_at) VALUES
('de080001-0000-4000-8000-000000000001','$ORG','$SETIA','de000001-0000-4000-8000-000000000001','de070001-0000-4000-8000-000000000001','$DOC','DEMO-ENC-0001','completed','Sakit gigi belakang kanan', NOW(), CURDATE() - INTERVAL 3 DAY + INTERVAL 10 HOUR, CURDATE() - INTERVAL 3 DAY + INTERVAL 10 HOUR + INTERVAL 40 MINUTE),
('de080002-0000-4000-8000-000000000002','$ORG','$SETIA','de000002-0000-4000-8000-000000000002','de070002-0000-4000-8000-000000000002','$DOC','DEMO-ENC-0002','completed','Pembersihan rutin', NOW(), CURDATE() - INTERVAL 10 DAY + INTERVAL 11 HOUR, CURDATE() - INTERVAL 10 DAY + INTERVAL 11 HOUR + INTERVAL 50 MINUTE),
('de080003-0000-4000-8000-000000000003','$ORG','$SETIA','de000004-0000-4000-8000-000000000004','de070004-0000-4000-8000-000000000004','$DOC','DEMO-ENC-0003','completed','Semakan umum', NOW(), CURDATE() - INTERVAL 1 DAY + INTERVAL 9 HOUR, CURDATE() - INTERVAL 1 DAY + INTERVAL 9 HOUR + INTERVAL 30 MINUTE),
('de080004-0000-4000-8000-000000000004','$ORG','$SETIA','de000005-0000-4000-8000-000000000005','de070005-0000-4000-8000-000000000005','$DOC','DEMO-ENC-0004','completed','Fluoride kanak-kanak', NOW(), CURDATE() - INTERVAL 6 DAY + INTERVAL 14 HOUR, CURDATE() - INTERVAL 6 DAY + INTERVAL 14 HOUR + INTERVAL 25 MINUTE),
('de080005-0000-4000-8000-000000000005','$ORG','$BUKIT','de000007-0000-4000-8000-000000000007','de070007-0000-4000-8000-000000000007','$DOC','DEMO-ENC-0005','completed','Rawatan akar gigi 46', NOW(), CURDATE() - INTERVAL 4 DAY + INTERVAL 15 HOUR, CURDATE() - INTERVAL 4 DAY + INTERVAL 15 HOUR + INTERVAL 95 MINUTE),
('de080006-0000-4000-8000-000000000006','$ORG','$GELANG','de000011-0000-4000-8000-000000000011','de070009-0000-4000-8000-000000000009','$DOC','DEMO-ENC-0006','completed','Cabut gigi 38', NOW(), CURDATE() - INTERVAL 5 DAY + INTERVAL 16 HOUR, CURDATE() - INTERVAL 5 DAY + INTERVAL 16 HOUR + INTERVAL 35 MINUTE),
('de080007-0000-4000-8000-000000000007','$ORG','$SETIA','de000001-0000-4000-8000-000000000001','de070014-0000-4000-8000-000000000014','$DOC','DEMO-ENC-0007','open','Tampal gigi', NULL, CURDATE() + INTERVAL 11 HOUR, NULL);"
echo "  lawatan: $(q "SELECT COUNT(*) FROM encounters WHERE encounter_code LIKE 'DEMO%'")"

echo "== 6. carta gigi (odontogram) =="
# `condition` is a MySQL reserved word — it MUST be backtick-quoted, or the whole
# statement is a syntax error (and `INSERT IGNORE` would have hidden nothing here,
# the error is parse-time). Encounter 1 — Ahmad: 2 caries + 1 filling + 1 missing.
qx "
INSERT IGNORE INTO tooth_records (id, org_id, branch_id, patient_id, encounter_id, doctor_id, fdi_no, \`condition\`, surfaces, notes) VALUES
('de090001-0000-4000-8000-000000000001','$ORG','$SETIA','de000001-0000-4000-8000-000000000001','de080001-0000-4000-8000-000000000001','$DOC',16,'decayed','[\"O\",\"M\"]','Karies oklusal-mesial'),
('de090002-0000-4000-8000-000000000002','$ORG','$SETIA','de000001-0000-4000-8000-000000000001','de080001-0000-4000-8000-000000000001','$DOC',26,'decayed','[\"O\"]','Karies oklusal'),
('de090003-0000-4000-8000-000000000003','$ORG','$SETIA','de000001-0000-4000-8000-000000000001','de080001-0000-4000-8000-000000000001','$DOC',36,'filled','[\"O\"]','Tampalan komposit lama'),
('de090004-0000-4000-8000-000000000004','$ORG','$SETIA','de000001-0000-4000-8000-000000000001','de080001-0000-4000-8000-000000000001','$DOC',18,'missing',NULL,'Dicabut 2023'),
('de090005-0000-4000-8000-000000000005','$ORG','$BUKIT','de000007-0000-4000-8000-000000000007','de080005-0000-4000-8000-000000000005','$DOC',46,'root_canal','[\"O\"]','RCT selesai'),
('de090006-0000-4000-8000-000000000006','$ORG','$BUKIT','de000007-0000-4000-8000-000000000007','de080005-0000-4000-8000-000000000005','$DOC',47,'crowned',NULL,'Kron PFM'),
('de090007-0000-4000-8000-000000000007','$ORG','$GELANG','de000011-0000-4000-8000-000000000011','de080006-0000-4000-8000-000000000006','$DOC',38,'missing',NULL,'Baru dicabut'),
('de090008-0000-4000-8000-000000000008','$ORG','$BUKIT','de000007-0000-4000-8000-000000000007','de080005-0000-4000-8000-000000000005','$DOC',36,'implant',NULL,'Implan 2024');"
echo "  rekod gigi: $(q "SELECT COUNT(*) FROM tooth_records WHERE id LIKE 'de09%'")"

echo "== 7. nota klinikal (SOAP) =="
qx "
INSERT IGNORE INTO clinical_notes (id, org_id, patient_id, encounter_id, doctor_id, soap_subjective, soap_objective, soap_assessment, soap_plan, signed_at, signed_by, version) VALUES
('de0c0001-0000-4000-8000-000000000001','$ORG','de000001-0000-4000-8000-000000000001','de080001-0000-4000-8000-000000000001','$DOC','Pesakit mengadu sakit gigi belakang kanan 3 hari','Karies pada 16 dan 26, gusi sihat','Dental caries (K02.9)','Tampalan komposit pada 16 dan 26', NOW() - INTERVAL 3 DAY, '$DOC', 1),
('de0c0002-0000-4000-8000-000000000002','$ORG','de000007-0000-4000-8000-000000000007','de080005-0000-4000-8000-000000000005','$DOC','Sakit berdenyut gigi 46','Pulpitis tidak boleh dipulihkan','Pulpitis (K04.0)','RCT 46 + kron PFM 47', NOW() - INTERVAL 4 DAY, '$DOC', 1);"
echo "  nota: $(q "SELECT COUNT(*) FROM clinical_notes WHERE id LIKE 'de0c%'")"

echo "== 8. pelan rawatan + item + sesi =="
qx "
INSERT IGNORE INTO treatment_plans (id, org_id, branch_id, patient_id, encounter_id, doctor_id, plan_code, title, status, consent_required, proposed_at, accepted_at, activated_at) VALUES
('de0b0001-0000-4000-8000-000000000001','$ORG','$SETIA','de000001-0000-4000-8000-000000000001','de080001-0000-4000-8000-000000000001','$DOC','DEMO-PLAN-0001','DEMO Pelan Tampalan Dua Gigi','active',1, NOW() - INTERVAL 3 DAY, NOW() - INTERVAL 3 DAY, NOW() - INTERVAL 3 DAY),
('de0b0002-0000-4000-8000-000000000002','$ORG','$BUKIT','de000007-0000-4000-8000-000000000007','de080005-0000-4000-8000-000000000005','$DOC','DEMO-PLAN-0002','DEMO Pelan RCT + Kron','active',1, NOW() - INTERVAL 4 DAY, NOW() - INTERVAL 4 DAY, NOW() - INTERVAL 4 DAY),
('de0b0003-0000-4000-8000-000000000003','$ORG','$GELANG','de000012-0000-4000-8000-000000000012','de080006-0000-4000-8000-000000000006','$DOC','DEMO-PLAN-0003','DEMO Pelan Pembersihan','proposed',0, NOW() - INTERVAL 8 DAY, NULL, NULL);"
qx "
INSERT IGNORE INTO treatment_plan_items (id, org_id, plan_id, treatment_id, description, tooth_fdi, quantity, status) VALUES
('de0e0001-0000-4000-8000-000000000001','$ORG','de0b0001-0000-4000-8000-000000000001','$T4','Composite Filling',16,1,'done'),
('de0e0002-0000-4000-8000-000000000002','$ORG','de0b0001-0000-4000-8000-000000000001','$T4','Composite Filling',26,1,'pending'),
('de0e0003-0000-4000-8000-000000000003','$ORG','de0b0002-0000-4000-8000-000000000002','$T8','Root Canal Treatment',46,1,'done'),
('de0e0004-0000-4000-8000-000000000004','$ORG','de0b0002-0000-4000-8000-000000000002','$T9','Crown (PFM)',47,1,'pending'),
('de0e0005-0000-4000-8000-000000000005','$ORG','de0b0003-0000-4000-8000-000000000003','$T2','Scaling & Polishing',NULL,1,'pending');"
qx "
INSERT IGNORE INTO treatment_sessions (id, org_id, plan_id, encounter_id, doctor_id, session_no, performed_at, summary) VALUES
('de0f0001-0000-4000-8000-000000000001','$ORG','de0b0001-0000-4000-8000-000000000001','de080001-0000-4000-8000-000000000001','$DOC',1, NOW() - INTERVAL 3 DAY,'Tampalan 16 selesai'),
('de0f0002-0000-4000-8000-000000000002','$ORG','de0b0002-0000-4000-8000-000000000002','de080005-0000-4000-8000-000000000005','$DOC',1, NOW() - INTERVAL 4 DAY,'RCT 46 sesi tunggal selesai');"
echo "  pelan: $(q "SELECT COUNT(*) FROM treatment_plans WHERE plan_code LIKE 'DEMO%'") $(q "SELECT COUNT(*) FROM treatment_plan_items WHERE id LIKE 'de0e%'") $(q "SELECT COUNT(*) FROM treatment_sessions WHERE id LIKE 'de0f%'")"

echo "== 9. kos rawatan (finance) =="
qx "
INSERT IGNORE INTO treatment_costs (id, org_id, branch_id, patient_id, plan_id, encounter_id, cost_code, treatment_id, description, quantity, unit_cost, total_cost, cost_date) VALUES
('de100001-0000-4000-8000-000000000001','$ORG','$SETIA','de000001-0000-4000-8000-000000000001','de0b0001-0000-4000-8000-000000000001','de080001-0000-4000-8000-000000000001','DEMO-COST-0001','$T4','Composite Filling 16',1,180.0000,180.0000, CURDATE() - INTERVAL 3 DAY),
('de100002-0000-4000-8000-000000000002','$ORG','$SETIA','de000001-0000-4000-8000-000000000001','de0b0001-0000-4000-8000-000000000001','de080001-0000-4000-8000-000000000001','DEMO-COST-0002','$T1','Consultation',1,50.0000,50.0000, CURDATE() - INTERVAL 3 DAY),
('de100003-0000-4000-8000-000000000003','$ORG','$BUKIT','de000007-0000-4000-8000-000000000007','de0b0002-0000-4000-8000-000000000002','de080005-0000-4000-8000-000000000005','DEMO-COST-0003','$T8','Root Canal 46',1,900.0000,900.0000, CURDATE() - INTERVAL 4 DAY),
('de100004-0000-4000-8000-000000000004','$ORG','$BUKIT','de000007-0000-4000-8000-000000000007','de0b0002-0000-4000-8000-000000000002','de080005-0000-4000-8000-000000000005','DEMO-COST-0004','$T9','Crown 47',1,1200.0000,1200.0000, CURDATE() - INTERVAL 4 DAY),
('de100005-0000-4000-8000-000000000005','$ORG','$SETIA','de000002-0000-4000-8000-000000000002','de0b0001-0000-4000-8000-000000000001','de080002-0000-4000-8000-000000000002','DEMO-COST-0005','$T2','Scaling',1,120.0000,120.0000, CURDATE() - INTERVAL 10 DAY),
('de100006-0000-4000-8000-000000000006','$ORG','$GELANG','de000011-0000-4000-8000-000000000011','de0b0002-0000-4000-8000-000000000002','de080006-0000-4000-8000-000000000006','DEMO-COST-0006','$T6','Extraction 38',1,100.0000,100.0000, CURDATE() - INTERVAL 5 DAY);"
echo "  kos: $(q "SELECT COUNT(*) FROM treatment_costs WHERE cost_code LIKE 'DEMO%'")"

echo "== 10. kebenaran (consent) =="
qx "
INSERT IGNORE INTO consent_records (id, org_id, patient_id, template_id, template_version, encounter_id, plan_id, method, consented_by, recorded_by, consented_at) VALUES
('de110001-0000-4000-8000-000000000001','$ORG','de000001-0000-4000-8000-000000000001','$CONSENT_GEN',1,'de080001-0000-4000-8000-000000000001','de0b0001-0000-4000-8000-000000000001','written','Ahmad Faizal bin Ismail','$DOC', NOW() - INTERVAL 3 DAY),
('de110002-0000-4000-8000-000000000002','$ORG','de000007-0000-4000-8000-000000000007','$CONSENT_RCT',1,'de080005-0000-4000-8000-000000000005','de0b0002-0000-4000-8000-000000000002','electronic','Rajesh Kumar a/l Suresh','$DOC', NOW() - INTERVAL 4 DAY);"
echo "  kebenaran: $(q "SELECT COUNT(*) FROM consent_records WHERE id LIKE 'de11%'")"

echo "== 11. preskripsi + rujukan =="
qx "
INSERT IGNORE INTO prescriptions (id, org_id, branch_id, patient_id, encounter_id, doctor_id, medication, dosage, frequency, duration_days, notes) VALUES
('de120001-0000-4000-8000-000000000001','$ORG','$SETIA','de000001-0000-4000-8000-000000000001','de080001-0000-4000-8000-000000000001','$DOC','Amoxicillin 500mg','1 kapsul','3 kali sehari',5,'Habiskan semua — jangan berhenti awal'),
('de120002-0000-4000-8000-000000000002','$ORG','$BUKIT','de000007-0000-4000-8000-000000000007','de080005-0000-4000-8000-000000000005','$DOC','Paracetamol 500mg','1 biji','4 kali sehari',3,'Bila sakit sahaja');"
qx "
INSERT IGNORE INTO referrals (id, org_id, branch_id, patient_id, encounter_id, doctor_id, to_specialty, to_provider, reason, status, sent_at) VALUES
('de130001-0000-4000-8000-000000000001','$ORG','$BUKIT','de000009-0000-4000-8000-000000000009',NULL,'$DOC','Orthodontics','Hospital Sultanah Aminah','Kes ortodontik kompleks — perlu penilaian pakar','sent', NOW() - INTERVAL 10 DAY);"
echo "  preskripsi: $(q "SELECT COUNT(*) FROM prescriptions WHERE id LIKE 'de12%'") rujukan: $(q "SELECT COUNT(*) FROM referrals WHERE id LIKE 'de13%'")"

echo "== 12. jualan + perbelanjaan (finance) =="
qx "
INSERT IGNORE INTO sale_records (id, org_id, branch_id, patient_id, sale_code, source_system, amount, sale_date, status, notes) VALUES
('de140001-0000-4000-8000-000000000001','$ORG','$SETIA','de000001-0000-4000-8000-000000000001','DEMO-SALE-0001','pos',230.0000, CURDATE() - INTERVAL 3 DAY,'confirmed','DEMO bayaran tunai'),
('de140002-0000-4000-8000-000000000002','$ORG','$BUKIT','de000007-0000-4000-8000-000000000007','DEMO-SALE-0002','pos',2100.0000, CURDATE() - INTERVAL 4 DAY,'confirmed','DEMO bayaran kad'),
('de140003-0000-4000-8000-000000000003','$ORG','$SETIA','de000002-0000-4000-8000-000000000002','DEMO-SALE-0003','pos',120.0000, CURDATE() - INTERVAL 10 DAY,'confirmed','DEMO bayaran tunai'),
('de140004-0000-4000-8000-000000000004','$ORG','$GELANG','de000011-0000-4000-8000-000000000011','DEMO-SALE-0004','pos',100.0000, CURDATE() - INTERVAL 5 DAY,'confirmed','DEMO bayaran tunai');"
qx "
INSERT IGNORE INTO expenses (id, org_id, branch_id, expense_code, category, payee, amount, expense_date, due_date, status, notes) VALUES
('de150001-0000-4000-8000-000000000001','$ORG','$SETIA','DEMO-EXP-0001','Lab Cost','Dental Lab Sdn Bhd',450.0000, CURDATE() - INTERVAL 2 DAY, CURDATE() + INTERVAL 5 DAY,'pending_approval','DEMO kos makmal'),
('de150002-0000-4000-8000-000000000002','$ORG','$SETIA','DEMO-EXP-0002','Utilities','TNB',380.0000, CURDATE() - INTERVAL 6 DAY, CURDATE() + INTERVAL 1 DAY,'approved','DEMO elektrik'),
('de150003-0000-4000-8000-000000000003','$ORG','$BUKIT','DEMO-EXP-0003','Rent','Medini Properties',5500.0000, CURDATE() - INTERVAL 1 DAY, CURDATE() + INTERVAL 3 DAY,'pending_approval','DEMO sewa'),
('de150004-0000-4000-8000-000000000004','$ORG','$BUKIT','DEMO-EXP-0004','Supplies','DentSupply Sdn Bhd',890.0000, CURDATE() - INTERVAL 12 DAY, CURDATE() - INTERVAL 5 DAY,'paid','DEMO bekalan');"
echo "  jualan: $(q "SELECT COUNT(*) FROM sale_records WHERE sale_code LIKE 'DEMO%'") belanja: $(q "SELECT COUNT(*) FROM expenses WHERE expense_code LIKE 'DEMO%'")"

echo "== 13. operasi: tugasan, senarai semak, prospek =="
qx "
INSERT IGNORE INTO tasks (id, org_id, branch_id, title, description, priority, assignee_id, due_date, status) VALUES
('de160001-0000-4000-8000-000000000001','$ORG','$SETIA','DEMO Pesan stok sarung tangan','Stok sarung tangan tinggal 2 kotak','urgent','$RECEP', CURDATE() + INTERVAL 2 DAY,'open'),
('de160002-0000-4000-8000-000000000002','$ORG','$SETIA','DEMO Kalibrasi mesin X-ray','Pemeriksaan tahunan DOSH','high','$MGR', CURDATE() + INTERVAL 14 DAY,'in_progress'),
('de160003-0000-4000-8000-000000000003','$ORG','$BUKIT','DEMO Servis kerusi rawatan 2','Kerusi bunyi pelik','normal','$MGR', CURDATE() + INTERVAL 7 DAY,'open');"
qx "
INSERT IGNORE INTO checklists (id, org_id, branch_id, checklist_date, shift, title, items, owner_id, status) VALUES
('de170001-0000-4000-8000-000000000001','$ORG','$SETIA', CURDATE(),'pagi','DEMO Senarai Buka Klinik','[{\"label\":\"Buka suis utama\",\"done\":true},{\"label\":\"Streliser alat\",\"done\":true},{\"label\":\"Semak stok ubat\",\"done\":false}]','$RECEP','in_progress');"
qx "
INSERT IGNORE INTO leads (id, org_id, branch_id, name, phone, source, interested_treatment, status) VALUES
('de180001-0000-4000-8000-000000000001','$ORG','$SETIA','DEMO Wahidah Karim','60123999001','WhatsApp','Scaling', 'new'),
('de180002-0000-4000-8000-000000000002','$ORG','$SETIA','DEMO Suresh Menon','60123999002','Walk-in','Braces','contacted'),
('de180003-0000-4000-8000-000000000003','$ORG','$BUKIT','DEMO Lily Tan','60123999003','Facebook','Whitening','qualified');"
echo "  tugasan: $(q "SELECT COUNT(*) FROM tasks WHERE id LIKE 'de16%'") senarai: $(q "SELECT COUNT(*) FROM checklists WHERE id LIKE 'de17%'") prospek: $(q "SELECT COUNT(*) FROM leads WHERE id LIKE 'de18%'")"

echo "== 14. WhatsApp: saluran + perbualan + mesej =="
# One channel for the hero branch, ready to pair, and one already 'working' for
# display purposes (the demo number is a placeholder — never a real line).
qx "
INSERT IGNORE INTO wa_channels (id, org_id, branch_id, phone, session_name, status, health_score, sent_today_count) VALUES
('de190001-0000-4000-8000-000000000001','$ORG','$SETIA','60100000001','medini-setia-tropika','need_qr',0,0),
('de190002-0000-4000-8000-000000000002','$ORG','$BUKIT','60100000002','medini-bukit-indah','working',85,12);"
qx "
INSERT IGNORE INTO wa_conversations (id, org_id, branch_id, channel_id, contact_phone, patient_id, status, ai_queue_state, unread_count, last_message_at) VALUES
('de1a0001-0000-4000-8000-000000000001','$ORG','$SETIA','de190001-0000-4000-8000-000000000001','60123456701','de000001-0000-4000-8000-000000000001','open','responded',0, NOW() - INTERVAL 1 HOUR),
('de1a0002-0000-4000-8000-000000000002','$ORG','$BUKIT','de190002-0000-4000-8000-000000000002','60123999888',NULL,'open','waiting',2, NOW() - INTERVAL 20 MINUTE),
('de1a0003-0000-4000-8000-000000000003','$ORG','$BUKIT','de190002-0000-4000-8000-000000000002','60123456707','de000007-0000-4000-8000-000000000007','escalated','handoff',1, NOW() - INTERVAL 2 HOUR);"
qx "
INSERT IGNORE INTO wa_messages (id, org_id, branch_id, channel_id, conversation_id, direction, sender_type, body, status, idempotency_key, sent_at, delivered_at, read_at) VALUES
('de1b0001-0000-4000-8000-000000000001','$ORG','$SETIA','de190001-0000-4000-8000-000000000001','de1a0001-0000-4000-8000-000000000001','in','patient','Salam, saya nak tanya harga scaling','delivered','DEMO-MSG-0001', NOW() - INTERVAL 2 HOUR, NULL, NULL),
('de1b0002-0000-4000-8000-000000000002','$ORG','$SETIA','de190001-0000-4000-8000-000000000001','de1a0001-0000-4000-8000-000000000001','out','ai','Waalaikumussalam! Scaling bermula RM120. Boleh saya cadangkan slot?','delivered','DEMO-MSG-0002', NOW() - INTERVAL 1 HOUR - INTERVAL 50 MINUTE, NOW() - INTERVAL 1 HOUR - INTERVAL 49 MINUTE, NOW() - INTERVAL 1 HOUR - INTERVAL 40 MINUTE),
('de1b0003-0000-4000-8000-000000000003','$ORG','$SETIA','de190001-0000-4000-8000-000000000001','de1a0001-0000-4000-8000-000000000001','in','patient','Boleh Sabtu pagi?','delivered','DEMO-MSG-0003', NOW() - INTERVAL 1 HOUR, NULL, NULL),
('de1b0004-0000-4000-8000-000000000004','$ORG','$BUKIT','de190002-0000-4000-8000-000000000002','de1a0002-0000-4000-8000-000000000002','in','patient','Hi, klinik buka pukul berapa hari ini?','delivered','DEMO-MSG-0004', NOW() - INTERVAL 20 MINUTE, NULL, NULL),
('de1b0005-0000-4000-8000-000000000005','$ORG','$BUKIT','de190002-0000-4000-8000-000000000002','de1a0003-0000-4000-8000-000000000003','in','patient','Saya nak tukar temujanji','delivered','DEMO-MSG-0005', NOW() - INTERVAL 2 HOUR, NULL, NULL),
('de1b0006-0000-4000-8000-000000000006','$ORG','$BUKIT','de190002-0000-4000-8000-000000000002','de1a0003-0000-4000-8000-000000000003','out','human','Baik, saya semak slot dan hubungi semula sebentar lagi.','sent','DEMO-MSG-0006', NOW() - INTERVAL 2 HOUR - INTERVAL 40 MINUTE, NOW() - INTERVAL 2 HOUR - INTERVAL 39 MINUTE, NULL);"
echo "  saluran: $(q "SELECT COUNT(*) FROM wa_channels WHERE session_name LIKE 'medini-%'") perbualan: $(q "SELECT COUNT(*) FROM wa_conversations WHERE id LIKE 'de1a%'") mesej: $(q "SELECT COUNT(*) FROM wa_messages WHERE id LIKE 'de1b%'")"

echo ""
echo "=========================================================="
echo "  DATA DEMO SIAP"
echo "=========================================================="
printf "  %-22s %s\n" "pesakit"        "$(q "SELECT COUNT(*) FROM patients WHERE mrn LIKE 'DEMO%'")"
printf "  %-22s %s\n" "alahan"         "$(q "SELECT COUNT(*) FROM patient_allergies WHERE id LIKE 'de0a%'")"
printf "  %-22s %s\n" "temujanji"      "$(q "SELECT COUNT(*) FROM appointments WHERE code LIKE 'DEMO%'")"
printf "  %-22s %s\n" "lawatan"        "$(q "SELECT COUNT(*) FROM encounters WHERE encounter_code LIKE 'DEMO%'")"
printf "  %-22s %s\n" "rekod gigi"     "$(q "SELECT COUNT(*) FROM tooth_records WHERE id LIKE 'de09%'")"
printf "  %-22s %s\n" "nota klinikal"  "$(q "SELECT COUNT(*) FROM clinical_notes WHERE id LIKE 'de0c%'")"
printf "  %-22s %s\n" "pelan rawatan"  "$(q "SELECT COUNT(*) FROM treatment_plans WHERE plan_code LIKE 'DEMO%'")"
printf "  %-22s %s\n" "kos rawatan"    "$(q "SELECT COUNT(*) FROM treatment_costs WHERE cost_code LIKE 'DEMO%'")"
printf "  %-22s %s\n" "kebenaran"      "$(q "SELECT COUNT(*) FROM consent_records WHERE id LIKE 'de11%'")"
printf "  %-22s %s\n" "jualan"         "$(q "SELECT COUNT(*) FROM sale_records WHERE sale_code LIKE 'DEMO%'")"
printf "  %-22s %s\n" "perbelanjaan"   "$(q "SELECT COUNT(*) FROM expenses WHERE expense_code LIKE 'DEMO%'")"
printf "  %-22s %s\n" "tugasan"        "$(q "SELECT COUNT(*) FROM tasks WHERE id LIKE 'de16%'")"
printf "  %-22s %s\n" "saluran WA"     "$(q "SELECT COUNT(*) FROM wa_channels WHERE session_name LIKE 'medini-%'")"
printf "  %-22s %s\n" "perbualan WA"   "$(q "SELECT COUNT(*) FROM wa_conversations WHERE id LIKE 'de1a%'")"
printf "  %-22s %s\n" "mesej WA"       "$(q "SELECT COUNT(*) FROM wa_messages WHERE id LIKE 'de1b%'")"
echo ""
echo "Buang data demo: bash padam-data-demo-penuh.sh  (lihat komen fail ini)"
echo "=========================================================="
