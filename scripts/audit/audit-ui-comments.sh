#!/usr/bin/env bash
# ============================================================================
# audit-ui-comments.sh — cari komen JSX yang terpampang sebagai TEKS kepada pengguna.
#
# KENAPA INI PERLU DISEMAK
#
# Dalam JSX, anak teks ialah TEKS. Komen blok mesti dibungkus {/* ... */}.
# Tanpa kurungan itu, React memaparkan komen itu pada skrin — jadi pemeriksaan
# yang memeriksa kod kelihatan seperti pemeriksaan, bukan seperti komen.
#
# Contoh sebenar yang ditemui dalam /clinical (tab Rawatan):
#     /* `isActive`, bukan `status`: API katalog tidak menghantar medan status… */
#     <StatusBadge … />
# Dipaparkan sebagai ayat di bawah nama setiap rawatan.
#
# `tsc -b` lulus 0 ralat. audit-i18n.sh lulus. Kedua-duanya BUTA kepadanya,
# kerana ia kod yang sah dari segi sintaks — hanya salah tempatnya di dalam JSX.
# Ia ditemui hanya dengan membaca teks yang benar-benar dipaparkan pelayar.
#
# APA YANG TIDAK DIBENDERA (kalau tidak ia bising):
#   - komen dalam ungkapan JS:  onClick={() => /* ok */ setX(1)}
#   - komen sebelum nilai atribut:  onChange={(e) => /* ok */ set(...)}
#   - komen dalam blok <script>/fungsi biasa di luar JSX
# Ia hanya membendera komen yang berada di kedudukan ANAK JSX — iaitu apabila
# baris sebelumnya menutup sebuah tag.
#
# Guna: bash audit-ui-comments.sh
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

FAIL=0
echo "=== Komen JSX yang terpampang sebagai teks ==="

while read -r f; do
  hits=$(python - "$f" <<'PYEOF'
import sys

path = sys.argv[1]
try:
    lines = open(path, encoding='utf-8').read().split('\n')
except Exception:
    sys.exit(0)

out = []
for i, ln in enumerate(lines, 1):
    st = ln.strip()
    # Komen blok yang TIDAK dibungkus sebagai anak JSX.
    if not st.startswith('/*') or st.startswith('{/*'):
        continue
    prev = lines[i - 2].strip() if i >= 2 else ''
    # Anak JSX = baris sebelumnya MENUTUP sebuah tag. Dua pengecualian, dan
    # kedua-duanya menyebabkan positif palsu yang menenggelamkan isyarat:
    #   '=>'        — anak panah fungsi, bukan penutup tag
    #   '={...)}'  — nilai atribut; komen di sini sah dan tidak dipaparkan
    is_child = (prev.endswith('>') and not prev.endswith('=>')) or (
        prev.endswith(')}') and '={' not in prev
    )
    if is_child:
        out.append('%d: %s' % (i, st[:64]))

print('\n'.join(out))
PYEOF
)
  if [ -n "$hits" ]; then
    echo ""
    echo "--- ${f#./}"
    echo "$hits" | sed 's/^/     /'
    FAIL=$((FAIL + 1))
  fi
done < <(find app/src -name '*.tsx' -not -path '*/node_modules/*' | sort)

echo ""
echo "======================================================"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ BERSIH — tiada komen terpampang"
else
  printf "  ⚠️  %d fail — komen ini DIPAPARKAN kepada pengguna\n" "$FAIL"
  echo "  Betulkan: bungkus sebagai {/* ... */}"
fi
echo "======================================================"
exit 0
