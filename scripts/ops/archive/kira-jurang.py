# Kiraan jurang Medini vs Dr Partner — kaedah + nombor
# Skor = liputan Medini berbanding Dr Partner (Dr Partner = 100 sebagai garis dasar)

modules = [
    # (modul, skor_liputan_medini, kumpulan_fasa, berat_fasa)
    ("Pesakit (CRM)",              95,  1, 20),
    ("Temujanji",                 100,  1, 20),
    ("Queue",                      90,  1, 20),
    ("SOAP",                      100,  1, 20),
    ("Rekod gigi (gigi susu)",     70,  1, 20),
    ("Odontogram visual",          10,  1, 20),
    ("X-ray / imaging",            30,  1, 20),
    ("Kebenaran (consent)",       105,  1, 20),
    ("Alahan",                     25,  1, 20),
    ("Pelan rawatan",             105,  1, 20),
    ("Preskripsi",                 85,  1, 20),
    ("Rujukan",                    80,  1, 20),
    ("Insiden",                    85,  1, 20),
    ("MC (surat sakit)",            0,  1, 20),
    ("Time-off / PDPA",            15,  1, 20),
    ("Bilik rawatan",               0,  1, 20),

    ("treatment_costs + doctor_id",30,  2, 20),
    ("Harga master rawatan",       35,  2, 20),
    ("Komisen",                    25,  2, 20),
    ("Bil panel & insurans",       35,  2, 20),
    ("POS",                        20,  2, 20),

    ("Inventori ubat",              0,  3, 15),
    ("Inventori produk/bahan",      0,  3, 15),
    ("Supplier / PO",               0,  3, 15),

    ("Prepaid / Deposit / Voucher", 0,  4, 10),
    ("Cukai & e-Invoice",           0,  5, 10),

    ("Laporan",                     6,  6, 15),

    ("Cuti staf",                   0,  7, 10),
    ("OSH / DOSH",                  0,  7, 10),
    ("Paket rawatan",               0,  7, 10),

    # kelebihan Medini (skor > 100 = kita lebih baik)
    ("AI WhatsApp",               150,  8,  0),
    ("Dashboard nadi",            140,  8,  0),
    ("Keselamatan data (RLS)",    160,  8,  0),
    ("Teknologi (React/NestJS)",  150,  8,  0),
]

n = len(modules)
simple = sum(m[1] for m in modules) / n

# purata berwajaran ikut berat fasa
wsum = 0.0
wtot = 0.0
from collections import defaultdict
per_fasa = defaultdict(list)
for name, score, fasa, w in modules:
    if w:
        per_fasa[fasa].append(score)
for fasa, scores in sorted(per_fasa.items()):
    avg = sum(scores) / len(scores)
    w = [m[3] for m in modules if m[2] == fasa][0]
    wsum += avg * w
    wtot += w

weighted = wsum / wtot

print("=" * 66)
print(f"Bilangan modul dinilai            : {n}")
print(f"1) Purata MUDAH (semua sama berat): {simple:.1f}%")
print(f"2) Purata BERWAJAR (ikut fasa)    : {weighted:.1f}%")
print("=" * 66)
print()
print("PECAHAN IKUT FASA:")
print(f"{'Fasa':<6}{'Berat':<8}{'Skor Medini':<14}{'Sumbangan':<12}")
print("-" * 66)
for fasa, scores in sorted(per_fasa.items()):
    avg = sum(scores) / len(scores)
    w = [m[3] for m in modules if m[2] == fasa][0]
    print(f"{fasa:<6}{str(w)+'%':<8}{avg:<14.1f}{avg*w/100:<12.1f}")
print("-" * 66)
print(f"{'JUMLAH':<6}{'100%':<8}{'':<14}{weighted:<12.1f}")
print()
kedua = [m for m in modules if m[3] == 0]
print("KELEBIHAN MEDINI (skor >100, tiada tandingan Dr Partner):")
for name, score, _, _ in kedua:
    print(f"  {name:<30} {score}%")
print()
ahead = [m for m in modules if m[1] > 100]
print(f"Modul kita LEBIH BAIK : {len(ahead)}")
print(f"Modul setanding (75-100): {len([m for m in modules if 75 <= m[1] <= 100])}")
print(f"Modul kita KURANG (<75) : {len([m for m in modules if m[1] < 75])}")
print(f"Modul kita SIFAR        : {len([m for m in modules if m[1] == 0])}")
