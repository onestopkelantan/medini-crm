#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# ============================================================================
# sediakan-akaun-demo.sh — akaun untuk SETIAP peranan + sedikit data contoh.
#
# Bos mahu sahkan sendiri apa yang dilaporkan, jadi setiap peranan perlu akaun.
# Tanpa akaun kaunter, dakwaan "kaunter boleh baca, tidak boleh tulis" tidak
# boleh diperiksa oleh sesiapa kecuali saya.
#
# SEMUA baris berlabel DEMO- supaya `padam-data-demo.sh` boleh mengenal pastinya.
#
# Guna: bash sediakan-akaun-demo.sh
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")"

DB=medini-prod-mysql-1
ORG=00000000-0000-0000-0000-000000000001
WP=$(docker exec "$DB" sh -c 'printf %s "$MYSQL_PASSWORD"')
q() { docker exec -i "$DB" mysql -umedini -p"$WP" medini_prod -N -B -e "$1" 2>/dev/null | tr -d '\r'; }
HASH=$(docker exec -e P="$SEED_DEMO_PASSWORD" medini-prod-backend-1 \
  node -e 'const a=require("argon2");a.hash(process.env.P,{type:a.argon2id}).then(h=>process.stdout.write(h))')

echo "== akaun peranan =="
# Bukit Indah dipilih kerana ia ada pesakit sebenar + seorang doktor.
BUKIT=$(q "SELECT id FROM branches WHERE code='bukit-indah'")
SETIA=$(q "SELECT id FROM branches WHERE code='setia-tropika'")
[ -z "$BUKIT" ] && { echo "RALAT: cawangan bukit-indah tiada"; exit 1; }

add_staff() { # add_staff <username> <name> <role> <branch>
  local U="$1" N="$2" R="$3" B="$4"
  q "DELETE FROM staff WHERE username='$U'"
  docker exec -e H="$HASH" -e U="$U" -e N="$N" -e R="$R" -e B="$B" -e O="$ORG" "$DB" sh -c \
    'mysql -umedini -p"$MYSQL_PASSWORD" medini_prod -e "
       INSERT INTO staff (id, org_id, branch_id, username, name, role, status, password_hash, created_at)
       VALUES (UUID(), \"$O\", \"$B\", \"$U\", \"$N\", \"$R\", \"Active\", \"$H\", CURRENT_TIMESTAMP(6))"' 2>/dev/null
  printf "  %-22s %s @ %s\n" "$U" "$R" "$(q "SELECT short_name FROM branches WHERE id='$B'")"
}

add_staff "DEMO-hq"            "DEMO Ketua (HQ)"        "hq"             "$SETIA"
add_staff "DEMO-manager"       "DEMO Pengurus Cawangan" "branch_manager" "$BUKIT"
add_staff "DEMO-kaunter"       "DEMO Kaunter"           "branch_admin"   "$BUKIT"
add_staff "dr.aina"            "Dr. Aina"               "doctor"         "$SETIA"
add_staff "dr.faizal"          "Dr. Faizal Omar"        "doctor"         "$BUKIT"

echo
echo "== templat borang (teks contoh supaya boleh dilihat) =="
add_tpl() { # add_tpl <kind> <title> <body>
  local K="$1" T="$2" B="$3"
  local EX=$(q "SELECT id FROM consent_templates WHERE kind='$K' AND title='$T' LIMIT 1")
  [ -n "$EX" ] && { echo "  ada: $T"; return; }
  docker exec -e K="$K" -e T="$T" -e B="$B" -e O="$ORG" "$DB" sh -c \
    'mysql -umedini -p"$MYSQL_PASSWORD" medini_prod -e "
       INSERT INTO consent_templates (id, org_id, kind, title, body, version, is_active, created_at)
       VALUES (UUID(), \"$O\", \"$K\", \"$T\", \"$B\", 1, 1, CURRENT_TIMESTAMP(6))"' 2>/dev/null
  echo "  dicipta: $T"
}
add_tpl mc "Surat Akuan Sakit (MC)" "Saya, doktor yang bertugas, mengesahkan bahawa pesakit yang dinamakan di atas telah diperiksa pada tarikh yang tercatat dan disyorkan berehat seperti yang dinyatakan.

[CONTOH UNTUK DEMO — teks sebenar perlu disediakan oleh klinik sebelum digunakan untuk pesakit sebenar.]"
add_tpl pdpa "Notis Perlindungan Data Peribadi" "Klinik ini memproses data peribadi anda untuk tujuan rawatan, rekod perubatan dan pentadbiran. Anda berhak mengakses dan membetulkan data anda.

[CONTOH UNTUK DEMO — perlu disemak mengikut Akta Perlindungan Data Peribadi 2010 sebelum diedarkan.]"

echo
echo "== selesai =="
echo "Kata laluan akaun ditetapkan melalui SEED_DEMO_PASSWORD."
echo
q "SELECT CONCAT('  ', username, ' | ', role, ' | ', status) FROM staff ORDER BY role, username"
