#!/usr/bin/env bash
# Padam SEMUA data demo yang dimasukkan semasa menguji Fasa 1F.
#
# Guna sebelum memasukkan data sebenar. Semua data demo berlabel 'DEMO'
# dalam kod/mrn/username, jadi ia boleh dikenal pasti tepat.
#
# Kegunaan: bash padam-data-demo.sh
set -euo pipefail
cd "$(dirname "$0")"

PW=$(docker exec medini-prod-mysql-1 sh -c 'printf %s "$MYSQL_PASSWORD"')
q() { docker exec medini-prod-mysql-1 mysql -umedini -p"$PW" medini_prod -B --execute="$1" 2>&1 | grep -v "Warning"; }

echo "Sebelum:"
q "SELECT 'temujanji' AS jenis, COUNT(*) AS bil FROM appointments WHERE code LIKE 'DEMO%'
   UNION ALL SELECT 'jualan', COUNT(*) FROM sale_records WHERE sale_code LIKE 'DEMO%'
   UNION ALL SELECT 'pesakit', COUNT(*) FROM patients WHERE mrn LIKE 'DEMO%'
   UNION ALL SELECT 'kakitangan', COUNT(*) FROM staff WHERE id LIKE 'dddd2222%'"

echo ""
echo "Memadam..."
# Susunan penting: temujanji dahulu (ia merujuk staff), kemudian staff.
# Susunan bergantungan: rekod klinikal dahulu sebelum pesakit.
q "DELETE FROM treatment_costs WHERE encounter_id LIKE 'de08%' OR plan_id LIKE 'de09%'"
q "DELETE FROM clinical_notes WHERE encounter_id LIKE 'de08%'"
q "DELETE FROM tooth_records WHERE encounter_id LIKE 'de08%'"
q "DELETE FROM treatment_plans WHERE id LIKE 'de09%'"
q "DELETE FROM prescriptions WHERE patient_id LIKE 'de000%'"
q "DELETE FROM referrals WHERE patient_id LIKE 'de000%'"
q "DELETE FROM consent_records WHERE patient_id LIKE 'de000%'"
q "DELETE FROM encounters WHERE encounter_code LIKE 'DEMO%'"
q "DELETE FROM doctor_schedules WHERE id LIKE 'de05%'"
q "DELETE FROM expenses WHERE expense_code LIKE 'DEMO%'"
q "DELETE FROM sale_records WHERE sale_code LIKE 'DEMO%'"
q "DELETE FROM waitlist_entries WHERE patient_id LIKE 'de000%'"
q "DELETE FROM appointments WHERE code LIKE 'DEMO%'"
q "DELETE FROM patients WHERE mrn LIKE 'DEMO%'"
q "DELETE FROM staff WHERE id LIKE 'dddd2222%'"

echo ""
echo "Selepas (semua sepatutnya 0):"
q "SELECT 'temujanji' AS jenis, COUNT(*) AS bil FROM appointments WHERE code LIKE 'DEMO%'
   UNION ALL SELECT 'jualan', COUNT(*) FROM sale_records WHERE sale_code LIKE 'DEMO%'
   UNION ALL SELECT 'pesakit', COUNT(*) FROM patients WHERE mrn LIKE 'DEMO%'
   UNION ALL SELECT 'kakitangan', COUNT(*) FROM staff WHERE id LIKE 'dddd2222%'"
echo ""
echo "✅ Data demo dipadam."
