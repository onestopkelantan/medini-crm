#!/usr/bin/env bash
# ============================================================================
# data-demo-gelombang2.sh — isi fitur yang masih kosong utk demo penuh.
#
# Pelengkap sediakan-data-demo-penuh.sh (pesakit/temujanji/klinikal/jualan).
# Skrip ini isi: inventori penuh (item+BOM+restock+kiraan+flag), dokumen,
# pelan bayaran + jadual angsuran, prospek (leads), borang MC/PDPA diterbitkan,
# kes makmal, senarai tunggu, peringatan temujanji, segmen marketing,
# kes susulan, insiden, panel & insurans, komisen, scrubbing & recall rules,
# recurring commitments.
#
# Semua ID fixed 'de3xxxxx' / kod 'DEMO-' — idempoten (INSERT IGNORE),
# dibuang dengan padam-data-demo.sh (gelombang ini menambah padanannya).
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

echo "== semak rujukan =="
SETIA=$(q "SELECT id FROM branches WHERE code='setia-tropika'")
BUKIT=$(q "SELECT id FROM branches WHERE code='bukit-indah'")
GELANG=$(q "SELECT id FROM branches WHERE code='gelang-patah'")
SENTOSA=$(q "SELECT id FROM branches WHERE code='sentosa'")
DOC=$(q "SELECT id FROM staff WHERE username='doctor'")
HQ=$(q "SELECT id FROM staff WHERE username='hq'")
RECEP=$(q "SELECT id FROM staff WHERE username='reception'")
P1=$(q "SELECT id FROM patients WHERE mrn='DEMO-0001'")
P2=$(q "SELECT id FROM patients WHERE mrn='DEMO-0002'")
P5=$(q "SELECT id FROM patients WHERE mrn='DEMO-0005'")
[ -z "$P1" ] && { echo "RALAT: jalankan sediakan-data-demo-penuh.sh dahulu"; exit 1; }
E1=$(q "SELECT id FROM encounters WHERE encounter_code='DEMO-ENC-0001' LIMIT 1")
ENC1=${E1:-$(q "SELECT id FROM encounters WHERE encounter_code LIKE 'DEMO%' LIMIT 1")}

# ============================================================================
echo "== 15. INVENTORI: katalog item (12) =="
# Katalog lengkap klinik pergigian: sarung tangan, masker, anestetik, dll.
qx "INSERT IGNORE INTO inv_items (id, org_id, sku, name, category, unit, unit_cost, supplier) VALUES
('de300001-0000-4000-8000-000000000001','$ORG','GLV-M','Sarung Tangan Lateks Medium','PPE','box',18.50,'Medisupply Sdn Bhd'),
('de300001-0000-4000-8000-000000000002','$ORG','GLV-L','Sarung Tangan Lateks Large','PPE','box',18.50,'Medisupply Sdn Bhd'),
('de300001-0000-4000-8000-000000000003','$ORG','MASK-3P','Masker 3-Ply Biru','PPE','box',9.80,'Medisupply Sdn Bhd'),
('de300001-0000-4000-8000-000000000004','$ORG','ANES-LIDO','Anestetik Lidocaine 2% (Kartus)','Anestetik','kartus',3.20,'DentalMart'),
('de300001-0000-4000-8000-000000000005','$ORG','NEEDLE-27G','Jarum Anestetik 27G','Anestetik','pack',12.00,'DentalMart'),
('de300001-0000-4000-8000-000000000006','$ORG','BUR-DIA','Bur Diamond Pelbagai Saiz','Instrument','unit',22.00,'Kerr Dental'),
('de300001-0000-4000-8000-000000000007','$ORG','COMP-A2','Resin Komposit A2','Restoratif','syringe',48.00,'3M ESPE'),
('de300001-0000-4000-8000-000000000008','$ORG','ETCH-GEL','Etching Gel 37%','Restoratif','bottle',26.00,'3M ESPE'),
('de300001-0000-4000-8000-000000000009','$ORG','GIC-FUJI','Glass Ionomer Fuji IX','Restoratif','pack',65.00,'GC Asia'),
('de300001-0000-4000-8000-000000000010','$ORG','SUCT-TIP','Tip Suction Pakai Buang','PPE','pack',8.50,'Medisupply Sdn Bhd'),
('de300001-0000-4000-8000-000000000011','$ORG','XRAY-FILM','Filem X-Ray Saiz 2','Radiografi','pack',38.00,'Kodak Dental'),
('de300001-0000-4000-8000-000000000012','$ORG','IRR-NAOCL','Irrigant NaOCl 5.25%','Endodontik','bottle',15.00,'DentalMart');"

echo "== 16. INVENTORI: bilik stor + BOM =="
qx "INSERT IGNORE INTO inv_rooms (id, org_id, branch_id, code, name) VALUES
('de310001-0000-4000-8000-000000000001','$ORG','$SETIA','STR-01','Stor Utama Setia Tropika'),
('de310001-0000-4000-8000-000000000002','$ORG','$BUKIT','STR-02','Stor Utama Bukit Indah');"
# BOM: berapa unit setiap item digunakan per kes rawatan (untuk kiraan varians)
qx "INSERT IGNORE INTO inv_bom (id, org_id, treatment_type, item_id, qty_per_case) VALUES
('de320001-0000-4000-8000-000000000001','$ORG','Scaling','de300001-0000-4000-8000-000000000001',2),
('de320001-0000-4000-8000-000000000002','$ORG','Scaling','de300001-0000-4000-8000-000000000003',2),
('de320001-0000-4000-8000-000000000003','$ORG','Filling','de300001-0000-4000-8000-000000000007',1),
('de320001-0000-4000-8000-000000000004','$ORG','Filling','de300001-0000-4000-8000-000000000008',0.5),
('de320001-0000-4000-8000-000000000005','$ORG','Extraction','de300001-0000-4000-8000-000000000004',2),
('de320001-0000-4000-8000-000000000006','$ORG','Extraction','de300001-0000-4000-8000-000000000005',1);"

echo "== 17. INVENTORI: restock mingguan =="
qx "INSERT IGNORE INTO inv_restocks (id, org_id, branch_id, room_id, item_id, qty, unit_cost, supplier, restock_date, received_by, created_by) VALUES
('de330001-0000-4000-8000-000000000001','$ORG','$SETIA','de310001-0000-4000-8000-000000000001','de300001-0000-4000-8000-000000000001',20,18.50,'Medisupply Sdn Bhd',CURDATE() - INTERVAL 6 DAY,'$RECEP','$RECEP'),
('de330001-0000-4000-8000-000000000002','$ORG','$SETIA','de310001-0000-4000-8000-000000000001','de300001-0000-4000-8000-000000000004',50,3.20,'DentalMart',CURDATE() - INTERVAL 6 DAY,'$RECEP','$RECEP'),
('de330001-0000-4000-8000-000000000003','$ORG','$BUKIT','de310001-0000-4000-8000-000000000002','de300001-0000-4000-8000-000000000003',15,9.80,'Medisupply Sdn Bhd',CURDATE() - INTERVAL 5 DAY,'$RECEP','$RECEP');"

echo "== 18. INVENTORI: kiraan mingguan (lulus + menunggu) =="
# Kiraan lulus minggu lepas (snapshot baki) + satu menunggu kelulusan minggu ini
qx "INSERT IGNORE INTO inv_counts (id, org_id, branch_id, room_id, item_id, opening_qty, stock_in, ending_qty, week, status, submitted_by, approved_by, created_by, updated_by) VALUES
('de340001-0000-4000-8000-000000000001','$ORG','$SETIA','de310001-0000-4000-8000-000000000001','de300001-0000-4000-8000-000000000001',30,20,25,DATE_FORMAT(CURDATE() - INTERVAL 7 DAY, '%x-W%v'),'approved','$RECEP','$HQ','$RECEP','$HQ'),
('de340001-0000-4000-8000-000000000002','$ORG','$SETIA','de310001-0000-4000-8000-000000000001','de300001-0000-4000-8000-000000000004',40,50,60,DATE_FORMAT(CURDATE() - INTERVAL 7 DAY, '%x-W%v'),'approved','$RECEP','$HQ','$RECEP','$HQ'),
('de340001-0000-4000-8000-000000000003','$ORG','$BUKIT','de310001-0000-4000-8000-000000000002','de300001-0000-4000-8000-000000000003',20,15,18,DATE_FORMAT(CURDATE(), '%x-W%v'),'pending','$RECEP',NULL,'$RECEP','$RECEP');"

echo "== 19. INVENTORI: bendera varians contoh =="
qx "INSERT IGNORE INTO inv_variance_flags (id, org_id, branch_id, item_id, iso_week, expected_qty, actual_qty, variance_qty, variance_pct, threshold_pct, status, note, created_by, updated_by) VALUES
('de350001-0000-4000-8000-000000000001','$ORG','$SETIA','de300001-0000-4000-8000-000000000001',DATE_FORMAT(CURDATE() - INTERVAL 7 DAY, '%x-W%v'),10,14,4,40.0,5,'investigating','Kes sibuk minggu lepas — staf diminta jelaskan','doctor','doctor');"

# ============================================================================
echo "== 20. DOKUMEN (X-Ray & Documents) =="
qx "INSERT IGNORE INTO documents (id, org_id, branch_id, patient_id, title, category, file_name, mime_type, size_bytes, storage_key, status, uploaded_by) VALUES
('de360001-0000-4000-8000-000000000001','$ORG','$SETIA','$P1','X-Ray Periapikal Gigi 36 (DEMO)','xray','demo-xray-36.png','image/png',184320,'demo/de360001.png','ready','$DOC'),
('de360001-0000-4000-8000-000000000002','$ORG','$SETIA','$P2','X-Ray Panoramik (DEMO)','xray','demo-opg.png','image/png',262144,'demo/de360002.png','ready','$DOC'),
('de360001-0000-4000-8000-000000000003','$ORG','$SETIA','$P5','Borang Persetujuan Rawatan (DEMO)','consent','demo-consent.pdf','application/pdf',90000,'demo/de360003.pdf','ready','$RECEP');"

echo "== 21. PELAN BAYARAN + JADUAL ANGSURAN =="
qx "INSERT IGNORE INTO payment_plans (id, org_id, branch_id, patient_id, plan_title_snapshot, total_amount, down_payment, installments, frequency, status, start_date, next_due_date, notes, created_by) VALUES
('de370001-0000-4000-8000-000000000001','$ORG','$SETIA','$P5','Pelan Rawatan Ortodontik DEMO (Braces)',4500.00,500.00,8,'monthly','active',CURDATE() - INTERVAL 60 DAY,CURDATE() + INTERVAL 10 DAY,'Angsuran bulanan RM500','$HQ');"
qx "INSERT IGNORE INTO payment_plan_schedules (id, org_id, payment_plan_id, installment_no, amount, due_date, paid_date, paid_amount, status, created_by) VALUES
('de371001-0000-4000-8000-000000000001','$ORG','de370001-0000-4000-8000-000000000001',1,500.00,CURDATE() - INTERVAL 60 DAY,CURDATE() - INTERVAL 60 DAY,500.00,'paid','$HQ'),
('de371001-0000-4000-8000-000000000002','$ORG','de370001-0000-4000-8000-000000000001',2,500.00,CURDATE() - INTERVAL 30 DAY,CURDATE() - INTERVAL 30 DAY,500.00,'paid','$HQ'),
('de371001-0000-4000-8000-000000000003','$ORG','de370001-0000-4000-8000-000000000001',3,500.00,CURDATE() + INTERVAL 10 DAY,NULL,0.00,'pending','$HQ');"

echo "== 22. PROSPEK (Leads) =="
qx "INSERT IGNORE INTO leads (id, org_id, branch_id, name, phone, source, interested_treatment, status, assignee_id) VALUES
('de380001-0000-4000-8000-000000000001','$ORG','$SETIA','Aina Sofea','60198887771','instagram','Whitening','new','$RECEP'),
('de380001-0000-4000-8000-000000000002','$ORG','$SETIA','Harith Danial','60198887772','walk-in','Braces','contacted','$RECEP'),
('de380001-0000-4000-8000-000000000003','$ORG','$BUKIT','Nurul Izzah','60198887773','facebook','Scaling','qualified','$RECEP'),
('de380001-0000-4000-8000-000000000004','$ORG','$GELANG','Wan Ahmad Faiz','60198887774','whatsapp','Implant','negotiation','$HQ'),
('de380001-0000-4000-8000-000000000005','$ORG','$SENTOSA','Chong Mei Ling','60198887775','referral','Veneer','converted','$RECEP');"

echo "== 23. BORANG DITERBITKAN (MC/PDPA) =="
qx "INSERT IGNORE INTO issued_forms (id, org_id, branch_id, kind, serial_no, serial_year, title_snapshot, body_snapshot, patient_id, staff_id, encounter_id, subject, details, status, issued_at, issued_by) VALUES
('de390001-0000-4000-8000-000000000001','$ORG','$SETIA','mc','DEMO-MC-0001',YEAR(CURDATE()),'Sijil Sakit (MC) — DEMO','Pesakit dinasihatkan rehat 2 hari selepas rawatan pergigian.','$P1','$DOC','$ENC1','Sijil Sakit 2 hari','MC diterbitkan selepas cabutan gigi; sah 2 hari bekerja.','issued',NOW() - INTERVAL 2 DAY,'$DOC'),
('de390001-0000-4000-8000-000000000002','$ORG','$SETIA','pdpa','DEMO-PDPA-0001',YEAR(CURDATE()),'Persetujuan PDPA — DEMO','Pesakit bersetuju data peribadi digunakan untuk rawatan dan komunikasi klinik.','$P2','$RECEP','$ENC1','Persetujuan PDPA','Dimeterai semasa pendaftaran pesakit baharu.','issued',NOW() - INTERVAL 10 DAY,'$RECEP');"

echo "== 24. KES MAKMAL (Lab Cases) =="
qx "INSERT IGNORE INTO lab_cases (id, org_id, branch_id, patient_id, encounter_id, lab_vendor, work_description, due_date, status) VALUES
('de3a0001-0000-4000-8000-000000000001','$ORG','$SETIA','$P2','$ENC1','Prostho Lab JB','Mahkota Porselin Gigi 46',CURDATE() + INTERVAL 5 DAY,'in_progress'),
('de3a0001-0000-4000-8000-000000000002','$ORG','$BUKIT','$P5',NULL,'DentCare Lab','Retainer Selepas Braces',CURDATE() + INTERVAL 12 DAY,'pending');"

echo "== 25. SENARAI TUNGGU (Waitlist) =="
qx "INSERT IGNORE INTO waitlist_entries (id, org_id, branch_id, patient_id, doctor_id, preferred_days, preferred_time, notes, status) VALUES
('de3b0001-0000-4000-8000-000000000001','$ORG','$SETIA','$P1','$DOC','Sabtu','Pagi (9-12)','Nak slot awal Sabtu kalau ada pembatalan','waiting'),
('de3b0001-0000-4000-8000-000000000002','$ORG','$BUKIT','$P2','$DOC','Isnin,Jumaat','Petang (14-17)','Fleksibel, boleh datang pantas','waiting');"

echo "== 26. PERINGKAT TEMUJANJI =="
APPT1=$(q "SELECT id FROM appointments WHERE code LIKE 'DEMO%' AND scheduled_date >= CURDATE() LIMIT 1")
[ -n "$APPT1" ] && qx "INSERT IGNORE INTO appointment_reminders (id, org_id, appointment_id, reminder_type, scheduled_for, status) VALUES
('de3c0001-0000-4000-8000-000000000001','$ORG','$APPT1','H-8h',CONCAT(CURDATE(), ' 08:00:00'),'scheduled');"

echo "== 27. SEGMEN MARKETING + RECALL RULES =="
qx "INSERT IGNORE INTO marketing_segments (id, org_id, branch_id, name, filters) VALUES
('de3d0001-0000-4000-8000-000000000001','$ORG','$SETIA','Pesakit Scaling >6 bulan (DEMO)','{\"last_treatment\":\"scaling\",\"months_since\":6}'),
('de3d0001-0000-4000-8000-000000000002','$ORG','$BUKIT','Prospek Whitening Belum Convert (DEMO)','{\"lead_status\":\"contacted\",\"interested\":\"whitening\"}');"
qx "INSERT IGNORE INTO recall_rules (id, org_id, branch_id, name, treatment_code, interval_months, active, effective_from) VALUES
('de3e0001-0000-4000-8000-000000000001','$ORG','$SETIA','Scaling semula setiap 6 bulan (DEMO)','TRT-0002',6,1,CURDATE() - INTERVAL 30 DAY),
('de3e0001-0000-4000-8000-000000000002','$ORG','$BUKIT','Pemeriksaan braces bulanan (DEMO)','TRT-0003',1,1,CURDATE() - INTERVAL 30 DAY);"
qx "INSERT IGNORE INTO scrubbing_rules (id, org_id, branch_id, treatment_code, interval_months, enabled) VALUES
('de3f0001-0000-4000-8000-000000000001','$ORG','$SETIA','TRT-0002',6,1);"

echo "== 28. KES SUSULAN + INSIDEN =="
qx "INSERT IGNORE INTO follow_up_cases (id, org_id, branch_id, patient_id, appointment_id, encounter_id, assignee_id, due_date, status) VALUES
('de400001-0000-4000-8000-000000000001','$ORG','$SETIA','$P1',NULL,'$ENC1','$RECEP',CURDATE() + INTERVAL 2 DAY,'open');"
qx "INSERT IGNORE INTO incidents (id, org_id, branch_id, title, description, severity, owner_id, status) VALUES
('de410001-0000-4000-8000-000000000001','$ORG','$SETIA','Mesin X-Ray rosak ringan (DEMO)','Mesin X-Ray bilik 2 perlu penyelenggaraan — slot X-Ray dipindah ke bilik 1.','medium','$HQ','open');"

echo "== 29. PANEL & INSURANS =="
qx "INSERT IGNORE INTO panel_companies (id, org_id, code, name, pic, phone, address, status, source) VALUES
('de420001-0000-4000-8000-000000000001','$ORG','PNL-DEMO1','Panel Medini Dental Care (DEMO)','Encik Rahim','6071234567','Jalan Harmoni, Johor Bahru','active','manual');"
qx "INSERT IGNORE INTO insurance_companies (id, org_id, code, name, pic, phone, address, status, source) VALUES
('de430001-0000-4000-8000-000000000001','$ORG','INS-DEMO1','Great Eastern Dental (DEMO)','Puan Sarah','60321112222','Menara GE, KL','active','manual');"

echo "== 30. KOMISEN + RECURRING =="
qx "INSERT IGNORE INTO commission_ledger (id, org_id, branch_id, doctor_id, commission_code, period, gross_revenue, eligible_direct_costs, commission_base, rate, commission_amount, net_payable, outstanding_amount, status) VALUES
('de440001-0000-4000-8000-000000000001','$ORG','$SETIA','$DOC','DEMO-KOM-001',DATE_FORMAT(CURDATE() - INTERVAL 30 DAY, '%Y-%m'),18500.00,4200.00,14300.00,0.30,4290.00,4290.00,4290.00,'pending');"
qx "INSERT IGNORE INTO recurring_commitments (id, org_id, branch_id, recurring_code, name, category, amount, frequency, next_due_date, status, auto_create) VALUES
('de450001-0000-4000-8000-000000000001','$ORG','$SETIA','DEMO-RENT-01','Sewa Premis Setia Tropika (DEMO)','sewa',3500.00,'monthly',CURDATE() + INTERVAL 15 DAY,'active',1);"

# ============================================================================
echo ""
echo "=========================================================="
echo " SEKARANG (gelombang 2):"
echo "=========================================================="
q "SELECT CONCAT('  inv_items:         ', COUNT(*)) FROM inv_items
UNION ALL SELECT CONCAT('  inv_bom:           ', COUNT(*)) FROM inv_bom
UNION ALL SELECT CONCAT('  inv_restocks:      ', COUNT(*)) FROM inv_restocks
UNION ALL SELECT CONCAT('  inv_counts:        ', COUNT(*)) FROM inv_counts
UNION ALL SELECT CONCAT('  inv_variance_flags:', COUNT(*)) FROM inv_variance_flags
UNION ALL SELECT CONCAT('  documents:         ', COUNT(*)) FROM documents
UNION ALL SELECT CONCAT('  payment_plans:     ', COUNT(*)) FROM payment_plans
UNION ALL SELECT CONCAT('  payment_schedules: ', COUNT(*)) FROM payment_plan_schedules
UNION ALL SELECT CONCAT('  leads:             ', COUNT(*)) FROM leads
UNION ALL SELECT CONCAT('  issued_forms:      ', COUNT(*)) FROM issued_forms
UNION ALL SELECT CONCAT('  lab_cases:         ', COUNT(*)) FROM lab_cases
UNION ALL SELECT CONCAT('  waitlist:          ', COUNT(*)) FROM waitlist_entries
UNION ALL SELECT CONCAT('  recall_rules:      ', COUNT(*)) FROM recall_rules
UNION ALL SELECT CONCAT('  follow_up:         ', COUNT(*)) FROM follow_up_cases
UNION ALL SELECT CONCAT('  panel+insurans:    ', (SELECT COUNT(*) FROM panel_companies) + (SELECT COUNT(*) FROM insurance_companies))
UNION ALL SELECT CONCAT('  komisen:           ', COUNT(*)) FROM commission_ledger
UNION ALL SELECT CONCAT('  recurring:         ', COUNT(*)) FROM recurring_commitments;"
