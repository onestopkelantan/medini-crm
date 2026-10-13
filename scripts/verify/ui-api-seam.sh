#!/usr/bin/env bash
# ui-api-seam.sh — adakah setiap endpoint yang UI panggil benar-benar wujud?
#
# Fasa 1a (27 Sep 2026). Dibina kerana 3 endpoint rosak dalam Fasa 1 WhatsApp
# lolos SEMUA ujian sedia ada:
#
#   verify-fasa1-*.sh        -> panggil API terus   -> lulus
#   verify-fasa1-clinical-ui -> panggil API terus   -> lulus
#   audit-i18n.sh            -> periksa teks/kelas  -> lulus
#
# Tiada satu pun membandingkan apa yang SKRIN panggil dengan apa yang PELAYAN
# daftarkan. Jadi badge unread + tanda dibaca 404 selama sebulan tanpa siapa
# perasan: 404 pada panggilan latar belakang tidak memaparkan apa-apa.
#
# Skrip ini membandingkan dua set itu dan melaporkan:
#   1. UI panggil, backend TIADA        <- SELALU bug (bekas ini yang penting)
#   2. backend ada, UI tak panggil      <- mungkin fitur belum disambung
#
# Guna:
#   bash ui-api-seam.sh                 # ringkasan
#   bash ui-api-seam.sh --verbose       # senarai penuh
set -euo pipefail
cd "$(dirname "$0")/../.."

VERBOSE=0; [ "${1:-}" = "--verbose" ] && VERBOSE=1
API="https://localhost/api/v1"

say() { printf '%s\n' "$*"; }
hdr() { say ""; say "======================================================"; say "$*"; say "======================================================"; }

# ---------------------------------------------------------------- 1. BACKEND
# Prefix diambil dari DEKORATOR, bukan nama folder. `administration/` serve
# `/admin`; `payors/` serve `/{panels,insurances}`; `system-admin` version ''.
python - <<'PY' > .seam-backend.txt
import re, glob, os
out = set()
for f in glob.glob("backend/src/**/*.controller.ts", recursive=True):
    src = open(f, encoding="utf-8", errors="replace").read()
    m = re.search(r"@Controller\(([^)]*)\)", src, re.S)
    if not m:
        continue
    blk = m.group(1)
    pm = re.search(r"path:\s*'([^']*)'", blk)
    if not pm:                      # @Controller('patients') bentuk lama
        pm = re.search(r"'([^']*)'", blk)
    vm = re.search(r"version:\s*'([^']*)'", blk)
    prefix = pm.group(1) if pm else ""
    ver = vm.group(1) if vm else "1"
    base = "/api" + (f"/v{ver}" if ver else "") + "/" + prefix.strip("/")
    for mm in re.finditer(r"@(Get|Post|Patch|Put|Delete)\(\s*(?:'([^']*)')?\s*\)", src):
        verb, path = mm.group(1).upper(), (mm.group(2) or "").strip("/")
        full = (base + "/" + path).rstrip("/")
        full = re.sub(r":[A-Za-z]+", ":X", full)
        out.add((verb, full))
for v, p in sorted(out, key=lambda x: (x[1], x[0])):
    print(f"{v}\t{p}")
PY

# ---------------------------------------------------------------- 2. FRONTEND
# Setiap literal path + setiap PREFIX yang diikuti ${...}. Prefix amat penting:
# `/whatsapp/conversations/${id}/` membina `/conversations/<id>/assign`, jadi
# apa-apa path yang bermula dengannya MEMANG dipanggil.
python - <<'PY' > .seam-frontend.txt
import os, re
lits, prefixes = set(), set()
for dp, dn, fn in os.walk("app/src"):
    if "node_modules" in dp: continue
    for f in fn:
        if not f.endswith((".ts", ".tsx")): continue
        s = open(os.path.join(dp, f), encoding="utf-8", errors="replace").read()
        for m in re.finditer(r"""['"`](/[^'"`\n]*)['"`]""", s):
            v = m.group(1).split("?")[0].split("#")[0]
            v = re.sub(r"/api/v1", "", v)
            if len(v) < 6 or v.startswith(("/assets", "/src", "/@")): continue
            # templat: ${...} jadi :X
            t = re.sub(r"\$\{[^}]*\}", ":X", v).rstrip("/")
            if t not in (":X",) and not t.endswith("/:X"):
                lits.add(t)
            p = re.match(r"^(/[A-Za-z0-9\-/]*/)", v)
            if p: prefixes.add(p.group(1).rstrip("/"))
for x in sorted(lits): print("L\t" + x)
for x in sorted(prefixes): print("P\t" + x)
PY

# ---------------------------------------------------------------- 3. BANDING
python - <<'PY'
import re
def norm(p):
    """Buang segmen versi + normalisasi segmen dinamik pada KEDUA-DUA belah.
    Tanpa ini, backend `/api/v1/x` dan frontend `/x` tidak pernah sepadan dan
    skrip melaporkan 238 'endpoint hilang' — positif palsu sepenuhnya.
    `.strip()` DIDAHULUKAN: baris fail berakhir dengan '\\n', dan rstrip('/')
    sahaja tidak membuangnya, jadi setiap perbandingan gagal secara senyap."""
    p = p.strip()
    p = re.sub(r"^/api(?:/v\d+)?", "", p)
    p = re.sub(r"/v\d+/", "/", p)
    p = re.sub(r":[A-Za-z]+", ":X", p)
    return p.rstrip("/")

be = {}
for line in open(".seam-backend.txt", encoding="utf-8"):
    if "\t" not in line: continue
    v, p = line.rstrip("\n").split("\t", 1)
    be.setdefault(norm(p), set()).add(v)

lits, prefixes = set(), set()
for line in open(".seam-frontend.txt", encoding="utf-8"):
    if line.startswith("L\t"): lits.add(norm(line[2:]))
    elif line.startswith("P\t"): prefixes.add(norm(line[2:]))
lits = {x for x in lits if x and x != "/"}
prefixes = {x for x in prefixes if x}

def called(path):
    if path in lits: return True
    return any(path.startswith(p + "/") for p in prefixes)

missing = sorted(p for p in be if not called(p))
# UI literal yang tidak sepadan mana-mana endpoint, DAN bukan sekadar segmen
# pendek/artifak SVG. Ae hanya lapor yang kelihatan seperti laluan API sebenar.
extra = []
for p in sorted(lits):
    if p in be or any(p.startswith(x + "/") for x in be): continue
    if len(p.split("/")) < 2: continue          # `/login` dsb — halaman SPA
    if re.match(r"^/(assets|src|@)", p): continue
    extra.append(p)

print(f"Backend endpoint : {len(be)}")
print(f"UI path literal  : {len(lits)}   (prefix dinamik: {len(prefixes)})")
print(f"UI->backend OK   : {len(be)-len(missing)}")
print()
print("### UI PANGGIL, BACKEND **TIADA**  <- SELALU BUG")
for p in extra:
    print(f"  ❌ {p}")
if not extra: print("  ✅ tiada")
print()
print(f"### backend ada, UI tak panggil ({len(missing)}) — mungkin belum disambung")
for p in missing:
    print(f"    {sorted(be[p])[0]:<6}{p}")
PY

echo
echo "Nota: 404 pada panggilan LATAR BELAKANG (badge, poll) tidak memaparkan apa-apa."
echo "Itulah sebabnya set pertama wujud — ia satu-satunya set yang selalu bug."
