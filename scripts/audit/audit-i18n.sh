#!/usr/bin/env bash
# ============================================================================
# audit-i18n.sh — cari teks UI yang ditulis keras dalam kod.
#
# KENAPA SKRIP INI DITULIS SEMULA
#
# Versi lama hanya mencari teks BAHASA MELAYU keras. Ia mengesahkan tiada BM keras —
# dan BM keras memang bukan masalahnya. Halaman Clinical lama lulus dengan "BERSIH"
# walaupun 27 ayat Bahasa Inggeris tertulis keras di dalamnya ("No encounters",
# "Sign Note", "Open Encounter"). Audit itu buta pada separuh masalah.
#
# Versi baharu mencari KEDUA-DUA arah, dan membetulkan dua kelemahan lagi:
#
#   1. BM keras + BI keras + kelas warna keras
#   2. HANYA teks paparan diperiksa — bukan pengenal kod. Versi pertama versi ini
#      menandakan `onClose`, `isLoading`, `DialogPrimitive.Close` sebagai teks BI,
#      kerana ia hanya mencocokkan perkataan. Sekarang ia MENGESAN bentuk teks
#      paparan dahulu (anak teks JSX `>teks<` atau prop paparan), jadi pengenal
#      kod tidak boleh masuk senarai.
#   3. Komen dikecualikan sebelum pemeriksaan.
#
# Guna: bash audit-i18n.sh
# ============================================================================
set -uo pipefail
# Dipindah ke scripts/audit/ (8 Okt): naik 3 aras ke akar repo, kemudian app/src.
cd "$(dirname "$0")/../../app/src" || exit 1

# Perkataan yang hanya muncul sebagai teks kepada pengguna.
BM='Pesakit|Temujanji|Jumlah|Cawangan|Doktor|Jadual|Klinikal|Simpan|Menyimpan|Mendaftar|Tutup|Batal|Tambah|Cari|Hantar|Rekod|Tempahan|Pengurus|Rawatan|Tunggakan|Kadar|Hadir|Selesai|Menunggu|Ditempah|Disahkan|Dibatalkan|Semua|Tiada|Gagal|Berjaya|dibaca|disimpan|dimuatkan|Taip|pilih|Lihat|Buka|Masuk|Tandatangan|Cetak|Padam|Ubah|Baru|Aktif|Alahan|Kebenaran|Pelan|Pembayaran|Gaji|Belanja|Untung|Rugi|Langganan|Sekatan'

# Frasa BI yang jelas untuk pembaca manusia.
EN='No [a-z]|Not [a-z]|Unable to|Failed to|Loading|Save |Sign |Open |Close|Cancel|Select |Enter |Search|Add |Edit |Delete|Create |Complete |appear here|recorded yet|will appear|Total|Amount|Name|Date|Status|Active|Inactive|Pending|Approved|Rejected|Paid|Unpaid|Overdue'

# Kelas warna keras: pecah tema gelap kerana ia tidak mengikut token tema.
# Kelas warna keras: pecah tema gelap kerana ia tidak mengikut token tema.
# `border-white` / `ring-white` / `text-white` disertakan kerana ia paling mudah
# terlepas pandang: ia kelihatan betul pada tema cerah dan hanya muncul sebagai
# garis atau teks halimunan pada tema gelap — jadi tiada siapa melaporkannya.
# Versi pertama corak ini tertinggal ketiga-tiganya, jadi kiraan 41 fail adalah
# satu KIRAAN BAWAH, bukan jumlah sebenar.
HARD='bg-white|border-white|ring-white|text-white|bg-black|text-black|border-black|text-slate-|bg-slate-|border-slate-|divide-slate-|ring-slate-|text-teal-|bg-teal-|border-teal-|ring-teal-|from-teal-|to-cyan-|text-gray-|bg-gray-|border-gray-'

# Ambil HANYA teks paparan: (a) anak teks JSX  >teks<  (b) prop paparan ="teks"
candidates() {
  local f="$1"
  grep -vE '^\s*(//|\*|/\*)' "$f" 2>/dev/null \
    | grep -oE '>[A-Z][A-Za-z0-9 ,.'"'"'’&()/+-]{2,}<|(placeholder|title|aria-label|label|description|emptyText)="[^"]{3,}"' \
    | sed -E 's/^>//; s/<$//; s/^[a-z-]+="//; s/"$//' \
    | grep -vE '^\{|^\}|aria-|^https?|^/api' 
}

FAIL=0; ENFAIL=0; HARDFAIL=0

echo "=== 1. Teks BM keras dalam UI ==="
while read -r f; do
  hits=$(candidates "$f" | grep -E "$BM" | sort -u)
  if [ -n "$hits" ]; then
    echo ""; echo "--- $f"; echo "$hits" | head -5 | sed 's/^/     /'
    FAIL=$((FAIL+1))
  fi
done < <(find . -name '*.tsx' -not -path './node_modules/*' | sort)

echo ""
echo "=== 2. Teks BI keras dalam UI (yang audit lama terlepas) ==="
while read -r f; do
  hits=$(candidates "$f" | grep -E "$EN" | sort -u)
  if [ -n "$hits" ]; then
    echo ""; echo "--- $f"; echo "$hits" | head -5 | sed 's/^/     /'
    ENFAIL=$((ENFAIL+1))
  fi
done < <(find . -name '*.tsx' -not -path './node_modules/*' | sort)

echo ""
echo "=== 3. Kelas warna keras (pecah tema gelap) ==="
while read -r f; do
  # Komen dikecualikan: komen yang MENYEBUT kelas keras (cth menerangkan
  # pembetulan) bukan kelas yang berkuat kuasa.
  n=$(grep -vE '^\s*(/\*|\*|//)' "$f" 2>/dev/null | grep -oE "$HARD" | wc -l)
  if [ "$n" -gt 0 ]; then
    printf "     %-50s %3d kelas\n" "${f#./}" "$n"
    HARDFAIL=$((HARDFAIL+1))
  fi
done < <(find . -name '*.tsx' -not -path './node_modules/*' | sort)

echo ""
echo ""
echo "=== 3b. Kelas warna keras dalam CSS (dilangkau oleh carian .tsx) ==="
# HUJUNG YANG PALING MUDAH TERLEPAS: warna keras yang hidup dalam fail CSS, bukan
# dalam komponen. `.glass-card` menggunakan `bg-white/85` dan dipakai 49 kali di 8
# halaman — jadi menukar setiap .tsx TIDAK menyentuh punca sebenar, dan audit yang
# hanya memeriksa .tsx akan melaporkan "bersih" sambil skrin kekal putih pada tema
# gelap. Periksa kedua-duanya atau audit itu memberi jaminan palsu.
CSSFAIL=0
while read -r f; do
  n=$(grep -oE "$HARD" "$f" 2>/dev/null | wc -l)
  if [ "$n" -gt 0 ]; then
    printf "     %-50s %3d kelas
" "${f#./}" "$n"
    CSSFAIL=$((CSSFAIL+1))
  fi
done < <(find . -name '*.css' -not -path './node_modules/*' | sort)

echo "======================================================"
printf "  Teks BM keras : %d fail\n" "$FAIL"
printf "  Teks BI keras : %d fail\n" "$ENFAIL"
printf "  Warna keras   : %d fail\n" "$HARDFAIL"
if [ "$FAIL" -eq 0 ] && [ "$ENFAIL" -eq 0 ] && [ "$HARDFAIL" -eq 0 ] && [ "$CSSFAIL" -eq 0 ]; then
  echo "  ✅ BERSIH"
else
  echo "  ⚠️  Ada kerja — lihat senarai di atas."
fi
echo "======================================================"
exit 0
