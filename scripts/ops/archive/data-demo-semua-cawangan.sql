-- ============================================================================
-- data-demo-semua-cawangan.sql — isi 6 cawangan yang masih kosong total.
-- (Norfaizah, Pearl, Meor Ahmad, Metropoint Kajang, Klinik Pergigian UDA,
--  Taman Molek, Taman Mutiara Mas) + tambah variasi pada yang tipis.
--
-- Matlamat pemilik: "datanya sebisa mungkin harus dipisah per branch supaya
-- terlihat HQ beneran bisa akses seluruh branch". Setiap cawangan mesti ada
-- pesakit, temujanji, jualan, prospek — bilangan BERBEZA supaya carta
-- perbandingan HQ bermakna (bukan semua sama).
--
-- Idempoten: fixed UUID + INSERT IGNORE. Padam dengan padam-data-demo.sh
-- (semua id bermula 'de5'/'DEMO').
-- ============================================================================
SET @org = '00000000-0000-0000-0000-000000000001';

-- helper: id cawangan
SET @norf  = (SELECT id FROM branches WHERE code='norfaizah');
SET @pearl = (SELECT id FROM branches WHERE code='pearl');
SET @meor  = (SELECT id FROM branches WHERE code='meor-ahmad');
SET @metro = (SELECT id FROM branches WHERE code='metropoint-kajang');
SET @uda   = (SELECT id FROM branches WHERE code='klinik-pergigian-uda');
SET @molek = (SELECT id FROM branches WHERE code='taman-molek');
SET @mutiara = (SELECT id FROM branches WHERE code='taman-mutiara-mas');
SET @tmdaya = (SELECT id FROM branches WHERE code='taman-daya');
SET @doc = (SELECT id FROM staff WHERE username='doctor');
SET @recep = (SELECT id FROM staff WHERE username='reception');
SET @hq = (SELECT id FROM staff WHERE username='hq');
SET @t1 = (SELECT id FROM treatment_catalog WHERE code='TRT-0002'); -- scaling
SET @t2 = (SELECT id FROM treatment_catalog WHERE code='TRT-0004'); -- filling

-- ============================================================ PESAKIT
-- 2-3 pesakit baharu setiap cawangan kosong (MRN DEMO-00xx sambung)
INSERT IGNORE INTO patients (id, org_id, branch_id, mrn, name, phone, gender, dob, created_by) VALUES
('de500001-0000-4000-8000-000000000001',@org,@norf, 'DEMO-0101','Nurul Hidayah binti Hamid','60111222001','female','1992-04-11',@recep),
('de500001-0000-4000-8000-000000000002',@org,@norf, 'DEMO-0102','Shahrul Nizam bin Kamal','60111222002','male','1987-09-23',@recep),
('de500001-0000-4000-8000-000000000003',@org,@pearl,'DEMO-0103','Tan Wei Jie','60111222003','male','1995-01-30',@recep),
('de500001-0000-4000-8000-000000000004',@org,@pearl,'DEMO-0104','Priya Darshini a/p Raman','60111222004','female','1990-06-17',@recep),
('de500001-0000-4000-8000-000000000005',@org,@meor, 'DEMO-0105','Mohd Ridzuan bin Ali','60111222005','male','1983-12-02',@recep),
('de500001-0000-4000-8000-000000000006',@org,@metro,'DEMO-0106','Lim Jia Hui','60111222006','female','1997-03-08',@recep),
('de500001-0000-4000-8000-000000000007',@org,@metro,'DEMO-0107','Aiman Hakim bin Rosli','60111222007','male','1999-08-19',@recep),
('de500001-0000-4000-8000-000000000008',@org,@uda,  'DEMO-0108','Nur Aina binti Zulkifli','60111222008','female','1994-11-25',@recep),
('de500001-0000-4000-8000-000000000009',@org,@molek,'DEMO-0109','Gopal a/l Krishnan','60111222009','male','1979-05-14',@recep),
('de500001-0000-4000-8000-000000000010',@org,@mutiara,'DEMO-0110','Siti Khadijah binti Omar','60111222010','female','1988-10-06',@recep);

-- ============================================================ TEMUJANJI
INSERT IGNORE INTO appointments (id, org_id, branch_id, code, patient_id, patient_name, doctor_id, treatment_ref, scheduled_date, scheduled_time, duration_min, status, created_by) VALUES
('de510001-0000-4000-8000-000000000001',@org,@norf,'DEMO-APPT-0101','de500001-0000-4000-8000-000000000001','Nurul Hidayah binti Hamid',@doc,'Scaling',CURDATE()+INTERVAL 2 DAY,'10:00:00',30,'confirmed',@recep),
('de510001-0000-4000-8000-000000000002',@org,@norf,'DEMO-APPT-0102','de500001-0000-4000-8000-000000000002','Shahrul Nizam bin Kamal',@doc,'Filling',CURDATE()+INTERVAL 4 DAY,'15:30:00',45,'booked',@recep),
('de510001-0000-4000-8000-000000000003',@org,@pearl,'DEMO-APPT-0103','de500001-0000-4000-8000-000000000003','Tan Wei Jie',@doc,'Scaling',CURDATE()+INTERVAL 1 DAY,'11:00:00',30,'confirmed',@recep),
('de510001-0000-4000-8000-000000000004',@org,@pearl,'DEMO-APPT-0104','de500001-0000-4000-8000-000000000004','Priya Darshini a/p Raman',@doc,'Whitening',CURDATE()+INTERVAL 6 DAY,'14:00:00',60,'booked',@recep),
('de510001-0000-4000-8000-000000000005',@org,@meor, 'DEMO-APPT-0105','de500001-0000-4000-8000-000000000005','Mohd Ridzuan bin Ali',@doc,'Extraction',CURDATE()+INTERVAL 3 DAY,'09:30:00',45,'confirmed',@recep),
('de510001-0000-4000-8000-000000000006',@org,@metro,'DEMO-APPT-0106','de500001-0000-4000-8000-000000000006','Lim Jia Hui',@doc,'Scaling',CURDATE()+INTERVAL 2 DAY,'16:00:00',30,'booked',@recep),
('de510001-0000-4000-8000-000000000007',@org,@metro,'DEMO-APPT-0107','de500001-0000-4000-8000-000000000007','Aiman Hakim bin Rosli',@doc,'Braces Review',CURDATE()+INTERVAL 8 DAY,'10:30:00',30,'confirmed',@recep),
('de510001-0000-4000-8000-000000000008',@org,@uda,  'DEMO-APPT-0108','de500001-0000-4000-8000-000000000008','Nur Aina binti Zulkifli',@doc,'Filling',CURDATE()+INTERVAL 5 DAY,'11:30:00',45,'booked',@recep),
('de510001-0000-4000-8000-000000000009',@org,@molek,'DEMO-APPT-0109','de500001-0000-4000-8000-000000000009','Gopal a/l Krishnan',@doc,'Scaling',CURDATE()+INTERVAL 7 DAY,'09:00:00',30,'confirmed',@recep),
('de510001-0000-4000-8000-000000000010',@org,@mutiara,'DEMO-APPT-0110','de500001-0000-4000-8000-000000000010','Siti Khadijah binti Omar',@doc,'Consultation',CURDATE()+INTERVAL 2 DAY,'14:30:00',30,'booked',@recep);

-- ============================================================ JUALAN (jumlah berbeza per cawangan)
INSERT IGNORE INTO sale_records (id, org_id, branch_id, patient_id, sale_code, source_system, amount, sale_date, status, created_by) VALUES
('de520001-0000-4000-8000-000000000001',@org,@norf,'de500001-0000-4000-8000-000000000001','DEMO-SALE-0101','counter',120.00,CURDATE()-INTERVAL 5 DAY,'confirmed',@recep),
('de520001-0000-4000-8000-000000000002',@org,@norf,'de500001-0000-4000-8000-000000000002','DEMO-SALE-0102','counter',180.00,CURDATE()-INTERVAL 2 DAY,'confirmed',@recep),
('de520001-0000-4000-8000-000000000003',@org,@pearl,'de500001-0000-4000-8000-000000000003','DEMO-SALE-0103','counter',120.00,CURDATE()-INTERVAL 6 DAY,'confirmed',@recep),
('de520001-0000-4000-8000-000000000004',@org,@pearl,'de500001-0000-4000-8000-000000000004','DEMO-SALE-0104','counter',450.00,CURDATE()-INTERVAL 1 DAY,'confirmed',@recep),
('de520001-0000-4000-8000-000000000005',@org,@meor, 'de500001-0000-4000-8000-000000000005','DEMO-SALE-0105','counter',95.00,CURDATE()-INTERVAL 3 DAY,'confirmed',@recep),
('de520001-0000-4000-8000-000000000006',@org,@metro,'de500001-0000-4000-8000-000000000006','DEMO-SALE-0106','counter',120.00,CURDATE()-INTERVAL 4 DAY,'confirmed',@recep),
('de520001-0000-4000-8000-000000000007',@org,@metro,'de500001-0000-4000-8000-000000000007','DEMO-SALE-0107','counter',320.00,CURDATE()-INTERVAL 2 DAY,'confirmed',@recep),
('de520001-0000-4000-8000-000000000008',@org,@uda,  'de500001-0000-4000-8000-000000000008','DEMO-SALE-0108','counter',180.00,CURDATE()-INTERVAL 5 DAY,'confirmed',@recep),
('de520001-0000-4000-8000-000000000009',@org,@molek,'de500001-0000-4000-8000-000000000009','DEMO-SALE-0109','counter',120.00,CURDATE()-INTERVAL 8 DAY,'confirmed',@recep),
('de520001-0000-4000-8000-000000000010',@org,@mutiara,'de500001-0000-4000-8000-000000000010','DEMO-SALE-0110','counter',60.00,CURDATE()-INTERVAL 1 DAY,'confirmed',@recep);

-- ============================================================ PERBELANJAAN
INSERT IGNORE INTO expenses (id, org_id, branch_id, expense_code, category, subcategory, payee, amount, expense_date, status, created_by) VALUES
('de530001-0000-4000-8000-000000000001',@org,@norf,'DEMO-EXP-0101','utilities','elektrik','TNB',210.00,CURDATE()-INTERVAL 10 DAY,'paid',@hq),
('de530001-0000-4000-8000-000000000002',@org,@pearl,'DEMO-EXP-0102','supplies','dental','DentalMart',380.00,CURDATE()-INTERVAL 7 DAY,'paid',@hq),
('de530001-0000-4000-8000-000000000003',@org,@meor,'DEMO-EXP-0103','utilities','air','SAJ',95.00,CURDATE()-INTERVAL 12 DAY,'paid',@hq),
('de530001-0000-4000-8000-000000000004',@org,@metro,'DEMO-EXP-0104','maintenance','peralatan','TechnoFix',550.00,CURDATE()-INTERVAL 4 DAY,'pending',@hq),
('de530001-0000-4000-8000-000000000005',@org,@uda,'DEMO-EXP-0105','supplies','PPE','Medisupply',160.00,CURDATE()-INTERVAL 9 DAY,'paid',@hq);

-- ============================================================ PROSPEK (leads)
INSERT IGNORE INTO leads (id, org_id, branch_id, name, phone, source, interested_treatment, status, assignee_id) VALUES
('de540001-0000-4000-8000-000000000001',@org,@norf,'Fatin Nabila','60111223001','tiktok','Whitening','new',@recep),
('de540001-0000-4000-8000-000000000002',@org,@pearl,'Kavitha Raman','60111223002','referral','Braces','contacted',@recep),
('de540001-0000-4000-8000-000000000003',@org,@meor,'Azlan Mat Isa','60111223003','walk-in','Denture','qualified',@recep),
('de540001-0000-4000-8000-000000000004',@org,@metro,'Chloe Ng','60111223004','instagram','Veneer','negotiation',@recep),
('de540001-0000-4000-8000-000000000005',@org,@uda,'Farid Kamarudin','60111223005','facebook','Scaling','converted',@recep),
('de540001-0000-4000-8000-000000000006',@org,@molek,'Rosnah Idris','60111223006','whatsapp','Extraction','new',@recep);

-- ============================================================ TUGASAN OPERASI
INSERT IGNORE INTO tasks (id, org_id, branch_id, title, priority, due_date, status, assignee_id, created_by) VALUES
('de550001-0000-4000-8000-000000000001',@org,@norf,'DEMO Susun stok bilik rawatan','normal',CURDATE()+INTERVAL 3 DAY,'open',@recep,@hq),
('de550001-0000-4000-8000-000000000002',@org,@pearl,'DEMO Semak tarikh luput anestetik','high',CURDATE()+INTERVAL 1 DAY,'open',@recep,@hq),
('de550001-0000-4000-8000-000000000003',@org,@metro,'DEMO Penyenggaraan autoclave','normal',CURDATE()+INTERVAL 10 DAY,'open',@recep,@hq);

-- ============================================================ KES MAKMAL
INSERT IGNORE INTO lab_cases (id, org_id, branch_id, patient_id, lab_vendor, work_description, due_date, status) VALUES
('de560001-0000-4000-8000-000000000001',@org,@pearl,'de500001-0000-4000-8000-000000000004','Prostho Lab JB','Veneer Seramik 6 unit',CURDATE()+INTERVAL 9 DAY,'pending'),
('de560001-0000-4000-8000-000000000002',@org,@uda,'de500001-0000-4000-8000-000000000008','DentCare Lab','Gigi palsu separa',CURDATE()+INTERVAL 14 DAY,'in_progress');

-- ============================================================ RINGKASAN
SELECT b.short_name,
 (SELECT COUNT(*) FROM patients p WHERE p.branch_id=b.id) pesakit,
 (SELECT COUNT(*) FROM appointments a WHERE a.branch_id=b.id) temujanji,
 (SELECT COUNT(*) FROM sale_records s WHERE s.branch_id=b.id) jualan,
 (SELECT COUNT(*) FROM expenses x WHERE x.branch_id=b.id) belanja,
 (SELECT COUNT(*) FROM leads l WHERE l.branch_id=b.id) prospek
FROM branches b WHERE b.deleted_at IS NULL ORDER BY pesakit DESC;
