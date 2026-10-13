#!/usr/bin/env bash
# ============================================================================
# verify-1c-bukku.sh — verifikasi hidup FASA 1C (Bukku sync + padanan)
#
# KENAPA skrip ini wujud, bukan hanya ujian vitest integrasi:
#
# Ujian integrasi MySQL (backend/test/integration/bukku-sync.spec.ts) tidak
# boleh dijalankan pada mesin dev ini — Docker Desktop di sini tidak memetakan
# port MySQL ke hos (docker port medini-prod-mysql-1 pulangan kosong), jadi
# ujian melangkau dengan jujur. Ujian itu kekal untuk CI / mesin lain.
#
# Skrip ini memberikan bukti SEBENAR di mesin ini: ia menulis data melalui
# pangkalan data, kemudian mengesahkan tingkah laku melalui API yang LIVE —
# laluan yang sama digunakan oleh UI.
#
# Setiap pemeriksaan mencetak LULUS/GAGAL. Keluar bukan-sifar jika ada gagal.
# ============================================================================
set -u
cd "$(dirname "$0")" || exit 1

API=https://localhost/api/v1
export MEDINI_DB_PASSWORD=$(docker exec medini-prod-mysql-1 sh -c 'printf %s "$MYSQL_PASSWORD"')

# Guna --execute (bukan stdin) supaya kerja dalam fungsi, dan dalam gelung.
DB() { docker exec medini-prod-mysql-1 mysql -umedini -p"$MEDINI_DB_PASSWORD" medini_prod -N -B --execute="$1" 2>/dev/null; }

ORG="00000000-0000-0000-0000-000000000001"
SETIA="af0a0841-0786-40b2-9b4e-30ed9270a659"
BUKIT="39fef961-bd9d-4ee9-9a6b-eb38ecf819e2"
TM=$(DB "SELECT id FROM branches WHERE code='taman-molek'")
D=$(date +%Y-%m-%d)
R=$RANDOM
PASS=0; FAIL=0

ok()   { echo "  ✅ LULUS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ GAGAL  $1"; FAIL=$((FAIL+1)); }
check(){ [ "$2" = "$3" ] && ok "$1 ($2)" || bad "$1 — jangka '$3', dapat '$2'"; }

TOK=$(curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"username":"hq","password":"MediniPilot2026!"}' | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null)
H="Authorization: Bearer $TOK"
[ -z "$TOK" ] && { echo "LOGIN GAGAL"; exit 1; }
echo "Login hq OK"
echo ""

echo "=============== 1. STATUS SAMBUNGAN ==============="
ST=$(curl -sk "$API/finance/integration/bukku/status" -H "$H")
check "configured=false (tiada API key)" "$(echo "$ST" | python -c "import sys,json;print(json.load(sys.stdin)['configured'])")" "False"
check "syncEnabled=false (flag mati)" "$(echo "$ST" | python -c "import sys,json;print(json.load(sys.stdin)['syncEnabled'])")" "False"

echo ""
echo "=============== 2. SYNC DITOLAK (flag mati) ==============="
CODE=$(curl -sk -o .verify-out.tmp -w "%{http_code}" -X POST "$API/finance/integration/bukku/sync-sales" -H "$H" -H 'Content-Type: application/json' -d "{\"from\":\"$D\",\"to\":\"$D\"}")
check "sync-sales ditolak dengan 403" "$CODE" "403"

echo ""
echo "=============== 3. PADANAN — SIAPKAN DATA ==============="
DB "DELETE FROM sale_records WHERE sale_code LIKE 'V1C-%'"
DB "INSERT INTO sale_records (id,org_id,branch_id,sale_code,external_ref,source_system,amount,sale_date,status) VALUES
 (UUID(),'$ORG','$SETIA','V1C-ST-B','$R-1','bukku',8500.0000,'$D','confirmed'),
 (UUID(),'$ORG','$SETIA','V1C-ST-C',NULL,'manual',8000.0000,'$D','confirmed'),
 (UUID(),'$ORG','$BUKIT','V1C-BI-B','$R-2','bukku',8000.0000,'$D','confirmed'),
 (UUID(),'$ORG','$BUKIT','V1C-BI-C',NULL,'manual',8000.0000,'$D','confirmed'),
 (UUID(),'$ORG','$TM','V1C-TM-B','$R-3','bukku',3200.0000,'$D','confirmed'),
 (UUID(),'$ORG','$TM','V1C-TM-VOID','$R-4','bukku',9999.0000,'$D','cancelled')"
N=$(DB "SELECT COUNT(*) FROM sale_records WHERE sale_code LIKE 'V1C-%'")
check "6 baris ujian dimasukkan" "$N" "6"

echo ""
echo "=============== 4. PADANAN — HASIL ==============="
RV=$(curl -sk "$API/finance/integration/bukku/reconcile?from=$D&to=$D" -H "$H")
echo "  ringkasan: $(echo "$RV" | python -c "import sys,json;print(json.dumps(json.load(sys.stdin)['summary']))")"
check "jumlah rasmi (Bukku, void dikecualikan)" "$(echo "$RV" | python -c "import sys,json;print(json.load(sys.stdin)['summary']['bukkuTotal'])")" "19700.0000"
check "jumlah beza mutlak" "$(echo "$RV" | python -c "import sys,json;print(json.load(sys.stdin)['summary']['absoluteDifference'])")" "500.0000"
check "bilangan mismatch" "$(echo "$RV" | python -c "import sys,json;print(json.load(sys.stdin)['summary']['mismatch'])")" "1"
check "bilangan not-submitted" "$(echo "$RV" | python -c "import sys,json;print(json.load(sys.stdin)['summary']['notSubmitted'])")" "1"
check "cawangan bermasalah" "$(echo "$RV" | python -c "import sys,json;print(json.load(sys.stdin)['summary']['branchesWithIssues'])")" "2"

echo ""
echo "=============== 5. MESEJ MENGANDUNGI ARAH ==============="
MSG=$(echo "$RV" | python -c "
import sys,json
d=json.load(sys.stdin)
for r in d['days']:
    if r['status']=='mismatch' and r['branchId']=='$SETIA': print(r['message'])
")
echo "  mesej: $MSG"
echo "$MSG" | grep -q "lebih di Bukku" && ok "menyebut arah 'lebih di Bukku'" || bad "arah tidak disebut"
echo "$MSG" | grep -q "RM500.00" && ok "menyebut magnitud RM500.00" || bad "magnitud salah"

SUB=$(echo "$RV" | python -c "
import sys,json
d=json.load(sys.stdin)
for r in d['days']:
    if r['status']=='not-submitted': print(r['message'])
")
echo "  mesej: $SUB"
echo "$SUB" | grep -q "Belum di-key-in" && ok "beza 'belum key-in' diklasifikasi" || bad "kelas belum-key-in salah"

echo ""
echo "=============== 6. BEZA SATU SEN DIKESAN ==============="
DB "DELETE FROM sale_records WHERE sale_code LIKE 'V1C-%'"
DB "INSERT INTO sale_records (id,org_id,branch_id,sale_code,external_ref,source_system,amount,sale_date,status) VALUES
 (UUID(),'$ORG','$SETIA','V1C-S1','$R-5','bukku',1000.0000,'$D','confirmed'),
 (UUID(),'$ORG','$SETIA','V1C-S2',NULL,'manual',999.9900,'$D','confirmed')"
RV2=$(curl -sk "$API/finance/integration/bukku/reconcile?from=$D&to=$D" -H "$H")
D1=$(echo "$RV2" | python -c "import sys,json;print(json.load(sys.stdin)['summary']['absoluteDifference'])")
check "beza satu sen dikesan (sifar toleransi)" "$D1" "0.0100"
M2=$(echo "$RV2" | python -c "
import sys,json
d=json.load(sys.stdin)
for r in d['days']:
    if r['status']=='mismatch': print(r['message'])
")
echo "$M2" | grep -q "RM0.01" && ok "mesej menyebut RM0.01" || bad "mesej tidak sebut RM0.01"

echo ""
echo "=============== 7. BERSIHKAN ==============="
DB "DELETE FROM sale_records WHERE sale_code LIKE 'V1C-%'"
N=$(DB "SELECT COUNT(*) FROM sale_records WHERE sale_code LIKE 'V1C-%'")
check "data ujian dibuang" "$N" "0"
TOT=$(DB "SELECT COUNT(*) FROM sale_records")
check "jadual sale_records kosong" "$TOT" "0"

echo ""
echo "======================================================"
echo "  LULUS: $PASS    GAGAL: $FAIL"
echo "======================================================"
[ "$FAIL" -eq 0 ] || exit 1
