-- Hapus data DEMO Dr Partner migration prep
-- Pesakit demo dikenal pasti dengan mrn LIKE 'DEMO-%'
-- Susunan: anak -> induk (elak FK error)
-- Dijalankan dalam satu transaksi

SET FOREIGN_KEY_CHECKS = 0;

SET @demo = (SELECT GROUP_CONCAT(CONCAT("'", id, "'")) FROM patients WHERE mrn LIKE 'DEMO-%');

-- === Tahap 1: cucu (merujuk encounter/plan/appointment) ===
DELETE FROM appointment_reminders WHERE appointment_id IN (SELECT id FROM appointments WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%'));
DELETE FROM booking_requests WHERE linked_appointment_id IN (SELECT id FROM appointments WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%'));
DELETE FROM lab_cases WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM treatment_sessions WHERE encounter_id IN (SELECT id FROM encounters WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%'));
DELETE FROM payment_plan_schedules WHERE payment_plan_id IN (SELECT id FROM payment_plans WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%'));
DELETE FROM treatment_plan_items WHERE plan_id IN (SELECT id FROM treatment_plans WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%'));
DELETE FROM consent_records WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM treatment_costs WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');

-- === Tahap 2: anak (merujuk pesakit) ===
DELETE FROM adverse_events WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM clinical_notes WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM clinical_timeline_events WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM documents WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM external_invoice_refs WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM follow_up_cases WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM imaging_records WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM issued_forms WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM leads WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM patient_relationships WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%') OR related_patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM patient_timeline_events WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM patient_allergies WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM payment_status WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM prescriptions WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM recall_cases WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM referrals WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM sale_records WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM tooth_records WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM wa_conversations WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM waitlist_entries WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM encounters WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM treatment_plans WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM payment_plans WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');
DELETE FROM appointments WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'DEMO-%');

-- === Tahap 3: pesakit demo sendiri ===
DELETE FROM patients WHERE mrn LIKE 'DEMO-%';

-- === Tahap 4: panel demo ===
DELETE FROM panel_companies WHERE code LIKE 'PNL-DEMO%' OR name LIKE '%(DEMO)%';

-- === Tahap 5: SEMUA inventori demo (pilihan A — bersihkan sepenuhnya) ===
-- Semua inv_* sedia ada adalah demo (supplier fiktif, dibuat 2026-10-09/10)
DELETE FROM inv_variance_flags;
DELETE FROM inv_counts;
DELETE FROM inv_restocks;
DELETE FROM inv_bom;
DELETE FROM inv_items;
DELETE FROM inv_rooms;

SET FOREIGN_KEY_CHECKS = 1;
