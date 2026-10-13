#!/usr/bin/env bash
# gua-ujian.sh — GUARD: elak skrip ujian memusnahkan data sebenar
#
# Mengapa fail ini wujud (Fasa 0b, 27 Sep 2026)
# -------------------------------------------------
# Skrip ujian perlu bermula dari keadaan bersih, jadi cara termudah ialah
# "buang semua, mula semula". Cara itu BETUL pada hari pertama (jadual kosong)
# dan MEMUSNAHKAN pada hari ke-100 (jadual penuh data pesakit).
#
# Enam skrip dalam repo ini menjalankan `DELETE FROM <jadual>` TANPA SYARAT:
#
#   verify-fasa1g-forms.sh    DELETE FROM issued_forms
#   uji-14-cawangan.sh        DELETE FROM issued_forms   (3 tempat)
#   uji-lumba-siri.sh         DELETE FROM issued_forms
#   padam-data-fasa1g.sh      DELETE FROM issued_forms
#   verify-5db-notifications.sh  DELETE FROM wa_notifications
#   verify-fasa1e-consent.sh  DELETE FROM consent_templates WHERE version > 1
#
# `issued_forms` ialah setiap MC dan surat kebenaran yang klinik pernah
# keluarkan. Ia dokumen undang-undang: satu arahan boleh memusnahkan bukti
# bertahun-tahun. Ini bukan teori — ia berlaku semasa penulisan fail ini.
#
# CARA GUNA (ganti DELETE tanpa syarat)
# -------------------------------------
#   . ./gua-ujian.sh                    # sumber sekali di atas skrip
#   guard_table_empty issued_forms "Nama ujian"     # berhenti kalau ada data
#   skrip_delete issued_forms "LIKERTAHUNAN-2026"   # hanya baris ujian
#
# Setiap padam mesti boleh jawab: "barang ini SIAPA punya?"
# Kalau jawapannya "sesiapa dalam jadual" — itu rampasan, bukan pembersihan.

set -uo pipefail

# --- sambungan DB (sama seperti skrip verify lain) -------------------------
GU_DB="${GU_DB:-medini-prod-mysql-1}"
GU_SCHEMA="${GU_SCHEMA:-medini_prod}"

gu_q() {
  local rp
  rp=$(docker exec "$GU_DB" sh -c 'printf %s "$MYSQL_ROOT_PASSWORD"' 2>/dev/null)
  docker exec -i "$GU_DB" mysql -uroot -p"$rp" "$GU_SCHEMA" -N -B -e "$1" 2>/dev/null | tr -d '\r'
}

# --- pagar 1: BERHENTI kalau jadual ada data sebenar ----------------------
# Ujian hanya boleh dijalankan pada jadual ujian-kosong, ATAU ia mesti bersih
# barangnya sendiri dahulu. Fungsi ini menjawab: "selamat ke nak mula?"
guard_table_empty() {
  local table="$1" label="${2:-$1}" n
  n=$(gu_q "SELECT COUNT(*) FROM \`$table\`")
  n=${n:-0}
  if [ "$n" != "0" ]; then
    printf '  \033[31m✗\033[0m  %s: %s ada %s baris.\n' "GUARD" "$label" "$n" >&2
    printf '      Ujian ini TIDAK akan berjalan — ia akan memusnahkan data sebenar.\n' >&2
    printf '      Betulkan skrip supaya ia padam baris YANG IA CIPTA sahaja\n' >&2
    printf '      (guna skrip_delete dgn corak penanda), bukan seluruh jadual.\n' >&2
    return 1
  fi
  return 0
}

# --- pagar 2: padam HANYA baris yang padan penanda ujian -------------------
# `marker` mesti BENAR-BENAR unik kepada ujian (contoh 'ZZTEST%', 'Ujian 5C-F%').
# Ia memadam ikut corak, BUKAN seluruh jadual.
skrip_delete() {
  local table="$1" where="$2"
  case "$where" in
    *"%"*|*"LIKE"*|*"="*|*"IN"*) : ;;
    *)
      printf '  \033[31m✗\033[0m  GUARD: skrip_delete perlu syarat WHERE yg mengecilkan skop (dapat: %s)\n' "$where" >&2
      return 1 ;;
  esac
  gu_q "DELETE FROM \`$table\` WHERE $where"
}

# --- pagar 3: BERHENTI kalau padam akan sentuh rekod rujukan --------------
# Untuk dokumen undang-undang (borang, kebenaran): kalau ada rekod PESAKIT
# merujuknya, jangan padam — lapor. Bukti undang-undang tak boleh hilang
# secara automatik.
guard_no_patient_refs() {
  local table="$1" fk_col="$2" ref_table="$3" label="${4:-$table}" n
  n=$(gu_q "SELECT COUNT(*) FROM \`$table\` WHERE $fk_col IN (SELECT id FROM \`$ref_table\`)")
  n=${n:-0}
  n=$(gu_q "SELECT COUNT(*) FROM \`$table\` WHERE $fk_col IS NOT NULL")
  n=${n:-0}
  if [ "$n" != "0" ]; then
    printf '  \033[33m⚠\033[0m  %s: %s merujuk %s pesakit.\n' "GUARD" "$label" "$n" >&2
    printf '      Rekod perubatan TIDAK dipadam secara automatik — semak secara manual.\n' >&2
    return 1
  fi
  return 0
}

# --- pagar 4: tunjuk apa yang AKAN dipadam sebelum padam -------------------
skrip_delete_preview() {
  local table="$1" where="$2" n
  n=$(gu_q "SELECT COUNT(*) FROM \`$table\` WHERE $where")
  printf '      akan padam %s baris dari %s (WHERE %s)\n' "${n:-0}" "$table" "$where"
}
