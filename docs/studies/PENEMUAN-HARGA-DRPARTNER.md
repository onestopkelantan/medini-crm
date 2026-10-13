# DR PARTNER — HARGA PER CAWANGAN: PENEMUAN DISAHKAN
**Tarikh:** 25 Sep 2026 · **Kaedah:** login read-only, lawat 6 cawangan Medini Dental Group
**Tujuan:** sahkan tafsiran `tsetupprice_N` dalam `RISIKAN-DRPARTNER-12-MODUL.md` (§0 #1)

---

## 1. JAWAPAN POKOK

| Soalan | Jawapan |
|---|---|
| Harga per cawangan wujud? | ✅ **YA** — disahkan |
| `_33` / `_7` / `_15` = ID **cawangan**? | ❌ **TIDAK** — ia ID **baris rawatan dalam cawangan itu** |
| Setia Tropika ada harga? | ✅ **ADA** — OPG X-RAY 100, PA X-RAY 50 |
| Cawangan mana paling lengkap? | **Metropoint** — 30 daripada 41 rawatan ada harga |

---

## 2. BUKTI — SUFFIX BUKAN ID CAWANGAN

Medan yang sama, dua cawangan berbeza, **suffix berbeza**:

| Rawatan | Field di cawangan A | Field di cawangan B |
|---|---|---|
| APPLIANCE | `tsetupprice_33` | `tsetupprice_31` |
| BRIDGE | `tsetupprice_15` | `tsetupprice_26` |
| CROWN | `tsetupprice_14` | `tsetupprice_25` |
| DENTURE | `tsetupprice_16` | `tsetupprice_24` |

Kalau `_N` ialah ID cawangan, suffix **mesti sama** di kedua-dua cawangan.
Ia berubah → jadi `_N` = **ID baris rawatan** dalam jadual cawangan itu sendiri.

**Juga:** bilangan suffix berbeza ikut cawangan — Setia Tropika **25** baris,
Metropoint **41** baris. Cawangan yang sama takkan ada bilangan ID cawangan berbeza.

**Kesimpulan:** `tsetupprice_N` = harga **satu rawatan** (`treatment` ID = N) **di cawangan yang
sedang dibuka**. Setiap cawangan ada senarai rawatan SENDIRI, dengan ID sendiri.

> Setia Tropika pun **ada** harga — cuma bukan pada baris yang dilihat semalam.
> Nilai `0.00` pada kebanyakan baris bermakna **rawatan itu belum ditetapkan harga**
> di cawangan itu, bukan "harga tersembunyi".

---

## 3. HARGA SEBENAR IKUT CAWANGAN (read-only, tiada apa diubah)

| Cawangan | Rawatan berharga | Contoh |
|---|---|---|
| **Metropoint** | **30 / 41** | CONSULTATION (ADULT) 30 · WHITENING 699 · CROWN 900 · RCT MOLAR 1300 · CLEAR ALIGNER 8000 |
| **UDA** | 6 / 23 | CONSULTATION 80 · EXTRACTION 150 · RCT/ENDO 800 · SCALING+POLISH 150 |
| **Molek** | 2 / 23 | CONSULTATION 80 · OPG XRAY 120 |
| **Setia Tropika** | 2 / 26 | OPG X-RAY 100 · PA X-RAY 50 |
| **UBC** | **0 / 24** | — |
| **Sentosa** | **0 / 24** | — |

Senarai penuh Metropoint: `drpartner-metropoint-prices.json`
Ringkasan semua cawangan: `drpartner-harga-per-cawangan.json`

---

## 4. `price2` dan `pricep` — KOSONG DI SEMUA CAWANGAN

| Medan | Status |
|---|---|
| `tsetupprice_N` (harga) | ada nilai di 4 cawangan |
| `tsetupprice2_N` (harga 2) | **0.00 di semua** |
| `tsetuppricep_N` (harga panel) | **0.00 di semua** |
| `tsetupcost_N` (kos) | **0.00 di semua** |
| `tsetupsstp_N` (% SST) | **0.00 di semua** |
| `tclasscode_N` (kod e-Invoice) | **kosong di semua** |

**Maksud untuk Fasa 3:** Medini perlu tetapkan struktur harga sendiri — Dr Partner
**bukan** sumber harga panel, kos, SST atau kod LHDN. Yang boleh disalin hanya
**cadangan harga runcit**, dan itu pun hanya **4 daripada 6 cawangan**.

---

## 5. KESAN PADA RANCANGAN

| # | Sebelum | Selepas disahkan |
|---|---|---|
| 1 | "Harga cawangan tersembunyi, cari cawangan yang ada" | Tiada yang tersembunyi — setiap cawangan ada senarai sendiri |
| 2 | "Tunggu jumpa harga penuh" | Harga runcit terbaik = **Metropoint (30 rawatan)** — guna sebagai titik mula |
| 3 | Reka bentuk harga panel/cukai | **Tiada sumber** — perlu keputusan Bos (soalan #1 tergantung) |

**Cadangan:** guna senarai Metropoint sebagai **draf senarai harga**, jangan salin bulat-bulat
(harga lain cawangan, dan Medini boleh tetapkan sendiri).
