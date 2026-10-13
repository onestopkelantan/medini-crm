# DR PARTNER → MEDINI CRM
## Laporan Risikan Penuh + Pelan 100%

**Sumber:** `thedrpartner.com` — Medini Dental Group → **Klinik Pergigian Medini Setia Tropika** (`branch=8`) · akaun Admin
**Mod:** 🔒 READ ONLY — tiada data diubah
**Tarikh:** 25 Sept 2026
**Status:** Modul Setting + Pesakit + Klinikal **SIAP**. Reports + Transaction **BELUM**.

---

# BAHAGIAN A · SENIBINA DR PARTNER

## A1 · Cara sistem itu berfungsi (penting untuk risikan akan datang)

Halaman Dr Partner **kosong bila dibaca terus**. Data dimuat melalui AJAX:

```
<nama>.php                 → rangka kosong + <script src="dpjs/<nama>.js">
dpjs/<nama>.js             → function init() { $.ajax({url:"<nama>_init.php"}) }
<nama>_init.php            → JSON { "nama_kotak": "<html jadual>" }
```

**Pola endpoint:**

| Kegunaan | Pola |
|---|---|
| Muat borang + senarai | `<nama>_init.php` |
| Muat senarai sahaja | `<nama>_list.php` |
| Tambah | `<nama>_insert.php` |
| Kemas kini | `<nama>_update.php` |
| Padam | `<nama>_remove.php` |

⚠️ **Endpoint perlukan konteks halaman.** `fetch()` dari halaman lain → 200 + HTML kosong. **Kena navigasi ke halaman itu dahulu, baru baca.**

⚠️ **Sesi luput** selepas ~30 minit. Bila `appointments.php` lontar balik ke login, login semula.

---

# BAHAGIAN B · MASTER DATA DISAHKAN (Setia Tropika sebenar)

| Modul | Bilangan | Butiran |
|---|---|---|
| **Katalog rawatan** | **24** | 🔴 **hanya 2 berharga** |
| Kategori rawatan | 17 | — |
| **Panel** | **10** | AIA · E-MAS · HealthMetrics · MBJB · MediDent · MedKad · MEDNEFITS · MiCare · PM CARE · UTM |
| **Ubat** | **14** | 3 kategori |
| **Pembekal** | **27** | — |
| **Tujuan temujanji** | **8** | **ada tempoh lalai** |
| UOM | 5 | BOTTLE · BOX · CATTON · PCS · UNIT |
| Jenis staf | 3 | Doctor · Front desk · Management |
| Voucher | 1 | GOOGLE REVIEW 10% |
| Slot roster | 8 | — |

## B1 · Katalog rawatan — 24 kod, 2 berharga

| Kod | Harga |
|---|---|
| APPLIANCE | 0.00 |
| BRACES / ORTHO | 0.00 |
| BRIDGE | 0.00 |
| CBCT XRAY | 0.00 |
| CLEAR ALIGNER | 0.00 |
| CONSULTATION | 0.00 |
| CROWN | 0.00 |
| DENTURE | 0.00 |
| EXTRACTION | 0.00 |
| FIBER REINFORCED COMPOSITE | 0.00 |
| FILLING | 0.00 |
| FLUORIDE | 0.00 |
| GINGEVECTOMY | 0.00 |
| LA CEPH XRAY | 0.00 |
| LOCAL ANESTHESIA | 0.00 |
| MEDICATIONS | 0.00 |
| MINOR ORAL SURGERY | 0.00 |
| **OPG X-RAY** | ✅ **100.00** |
| **PA X-RAY** | ✅ **50.00** |
| ROOT CANAL TREATMENT | 0.00 |
| SCALING AND POLISHING | 0.00 |
| STO | 0.00 |
| VENEER | 0.00 |
| WHITENING | 0.00 |
| IMPLANT | 0.00 |

## B2 · Ubat (14) + kategori

| Kategori | Ubat |
|---|---|
| ANTIBIOTIC | AMOXY 250MG · AMOXY 500mg · AUGMENTIN 625MG · METRO 400MG · SYRUP AMOXY 250MG |
| BENGKAK | PAPASE |
| PAINKILLER | ARCOXIA 120MG · ARCOXIA 90MG · IBUFERN 400MG · IBUPROFEN 200MG · PCM 500MG · PONSTAN 500MG · SYRUP PCM 250MG |

## B3 · Tujuan temujanji + tempoh lalai

| Tujuan | Jam | Minit |
|---|---|---|
| CHECK UP | 0 | 30 |
| DENTURE IMPRESSION | 0 | 30 |
| EXTRACTION | 0 | 30 |
| FILLING | 1 | 0 |
| MOS | 1 | 30 |
| RCT | 1 | 30 |
| REV ORTHO | 0 | 30 |
| SCALING POLISHING | 0 | 30 |
| WHITENING | 1 | 30 |

## B4 · 27 pembekal (contoh)

ACME MD GLOBAL · APEX PHARMACY · AZYM SYNERGY · DENTOPIA · dksh · EVEREST DENTAL SUPPLY · GALLA DENTAL · GREEN ORTHO · In house stock · JSI GLOBAL · KENG YEW DENTAL · MEDES (M) · MSLI DENTAL · N DENT · NTC DENTAL · ONE DENTAL SUPPLY · ORTHO DENTAL SUPPLY · PAHANG PHARMACY · Pharmaniaga · SUTRAMEDIC · T&K PREMIUM · ZUELLIG PHARMA

## B5 · Kosong di Setia Tropika (modul berfungsi, data tiada)

| Modul | Baris |
|---|---|
| Bilik rawatan | **0** |
| Paket rawatan | **0** |
| Insurans | **0** |
| Mod bayaran | **0** |
| Custom forms (MC/Time-off/PDPA/Consent) | **0** |
| SOAP options (S/O/A/P) | **0** |
| Grade/Alert/Meal/Dosage ubat | **0** |
| Produk · Bahan · kategori | **0** |
| Cuti klinik · Referral | **0** |

> **Ini penting:** tiada teks MC/PDPA sebenar untuk disalin — cawangan ini tak pernah isi.

---

# BAHAGIAN C · BORANG PESAKIT — 76 MEDAN

## C1 · Medan yang CRM kita TIADA

| # | Medan | Kenapa penting | Fasa |
|---|---|---|---|
| 1 | **Nationality \*** | **SST** — cukai beza warga asing | 3/5 |
| 2 | **Pregnant?** | 🔴 **KONTRA-INDIKASI** X-ray & ubat | 1 |
| 3 | **Blood type** | Kecemasan perubatan | 1 |
| 4 | **Bapa/Ibu/Penjaga** (nama+IC+telefon) | Consent pesakit kanak-kanak | 1 |
| 5 | **Emergency contact** | Keselamatan | 1 |
| 6 | ID jenis **NRIC/BRN/PASSPORT/ARMY** | Pesakit asing + syarikat | 1 |
| 7 | **Prefer message language** (English/BM/中文) | WhatsApp ikut bahasa | 2 |
| 8 | **Title** (11 pilihan) | Formaliti Malaysia | 2 |
| 9 | **Race** | Demografi + laporan | 6 |
| 10 | **Marital status** | Profil | 2 |
| 11 | **Occupation** | Profil + laporan | 2 |
| 12 | **Refer by** | Jejak sumber pesakit | 2 |
| 13 | **Vegetarian** | Keutamaan rawatan/ubat | 4 |
| 14 | **Second address** | Surat-menyurat | 2 |
| 15 | **Temperature ºc** | Saringan | — |
| 16 | **Dose of vaccine** | Vaksin | — |
| 17 | **IC Reader** (MyKad auto-isi) | Kelajuan kaunter | 7 |

## C2 · Yang kita SUDAH ada
`Name` · `IC` · `Gender` · `DOB` · `Age` · `Mobile` · `Email` · `Address` · `Panel` · `Allergy` (**kita berstruktur**)

---

# BAHAGIAN D · JADUAL BEFORE & AFTER + JUSTIFIKASI

## D1 · Dashboard

| Item | BEFORE | AFTER | Justifikasi |
|---|---|---|---|
| KPI | Pesakit · janji temu | **+ pesakit baharu hari ini · kadar tidak hadir · hasil hari ini** | Dr Partner: `bdailyvisit` · `bmthnoshowrpt` · `bdailycollection` — 3 nombor yang doktor tanya tiap pagi |
| Carta | ada | **+ trend 7/30 hari** | Dr Partner `bchart_yrsale` |
| Amaran | ❌ | **+ stok rendah · ubat luput · perlu susulan** | Dr Partner `medialertsetup` + `rptfollowup` |

## D2 · Pesakit

| Item | BEFORE | AFTER | Justifikasi |
|---|---|---|---|
| Medan | ~25 | **+16** (§C1) | `Nationality` **WAJIB** untuk SST; `Pregnant?` **kontra-indikasi**; keluarga untuk consent kanak-kanak |
| Alahan | ✅ berstruktur + gerbang | **KEKAL** | 🟢 **Kita LEBIH BAIK** — Dr Partner teks bebas, tiada gerbang |
| Panel | ada | **+10 panel sebenar** | Data sebenar sedia untuk Fasa 3 |
| ID | IC sahaja | **+jenis ID** | Pesakit asing + syarikat |

## D3 · Klinikal

| Item | BEFORE | AFTER | Justifikasi |
|---|---|---|---|
| Katalog | 7 lajur | **+8 lajur** — `Price · Price 2 · Panel price · Cost · Local SST % · Foreigner SST · classification_code · keyboard_letter` | 🔴 **`classification_code` WAJIB e-Invoice LHDN**; `Panel price` untuk panel billing; `Cost` untuk margin |
| Bilik rawatan | ❌ tiada | **+`rooms` + `appointments.room_id`** | Dr Partner `roomsetup` |
| Paket rawatan | ❌ tiada | **+`treatment_packages`** | Dr Partner `packagesetup` (braces berperingkat) |
| SOAP options | ❌ | **+4 senarai S/O/A/P** | Doktor taip laju, tiada silap ejaan |
| Custom forms | ✅ enjin + PDF | **+isi teks** | Enjin kita lebih baik (versi + snapshot) |
| Carta gigi | ✅ 14 keadaan | **KEKAL** | 🟢 Kita LEBIH BAIK — Dr Partner 7 |
| Alahan | ✅ berstruktur | **KEKAL** | 🟢 Kita LEBIH BAIK |

## D4 · Kewangan

| Item | BEFORE | AFTER | Justifikasi |
|---|---|---|---|
| Harga | 0 diisi | **6 medan harga** | Dr Partner ada 6; kita ada 1 (kosong) |
| Mod bayaran | ❌ | **+senarai** | Dr Partner `paymodesetup` |
| Insurans | ❌ | **+jadual** (asing dari panel) | Dr Partner `insurancesetup` |
| Voucher | ❌ | **+% atau RM** | Dr Partner: GOOGLE REVIEW 10% |
| Komisen | ❌ | **+komisen doktor** | Dr Partner `bcommsetup` + `bstaffcommcal` |

## D5 · Inventori

| Item | BEFORE | AFTER | Justifikasi |
|---|---|---|---|
| Ubat | ❌ | **+16 medan** | Dr Partner: 14 ubat + `Controlled drug` + `Alert` + `Maximum dose` |
| Pembekal | ❌ | **+jadual** | 27 pembekal sedia disalin |
| UOM | ❌ | **+5 unit** | — |
| Produk/Bahan | ❌ | **+2 modul** | Dr Partner asingkan produk (jual) vs bahan (guna) |
| Stok | ❌ | **+3 transaksi × 3 jenis** | stock in · adjustment · internal use |

## D6 · Laporan

| Item | BEFORE | AFTER | Justifikasi |
|---|---|---|---|
| Laporan | ~6 | **+30 teras** | Dr Partner ada **53** laporan (§F) |

## D7 · Tetapan

| Item | BEFORE | AFTER | Justifikasi |
|---|---|---|---|
| Cuti klinik | ❌ | **+kalendar** | Elak janji temu pada cuti |
| Roster | ❌ | **+8 slot masa** | Dr Partner `bapptroster` |
| Tujuan temujanji | ❌ | **+8 tujuan + tempoh** | Kita ada `duration_min`, tiada senarai pilihan |
| Jenis staf | ✅ RBAC | **+paparan 3 jenis** | Doctor · Front desk · Management |
| Staf e-Invoice | ❌ | **+penetapan** | Dr Partner `einvstaffsetup` |
| Templat WhatsApp | ✅ | **+kategori kampanye** | Dr Partner `messagecampsetting` |

---

# BAHAGIAN E · KITA LEBIH BAIK DARIPADA DR PARTNER

| Perkara | **Kita** | Dr Partner |
|---|---|---|
| **Alahan** | Jadual berstruktur + **gerbang keselamatan** (blok jika serius & tak diakui) | Teks bebas sahaja |
| **Carta gigi** | 14 keadaan + 7 simbol boleh-konfig | 7 keadaan |
| **Audit (ADR-009)** | Nota bertandatangan tak boleh ubah; pindaan berjejak | Tiada |
| **PDF borang** | Enjin + snapshot versi | Cetak |
| **Tema** | Mod gelap + BM/EN | Putih, 4 bahasa |
| **Bilik/paket** | Akan datang (Fasa 1) | Ada tetapi **0 data** |

**Kesimpulan:** Dr Partner **kaya data**, kita **lebih baik struktur**. Terutamanya **alahan berstruktur + gerbang keselamatan** — Dr Partner hanya teks bebas, yang bermakna sistem mereka **tidak boleh menghalang** preskripsi kepada pesakit alah.

---

# BAHAGIAN F · 53 LAPORAN DR PARTNER

| Kategori | Bil | Senarai |
|---|---|---|
| **Pesakit** | 15 | daily/monthly/yearly visit · visit summary · statistics · **no-show** · **new registered** · tourism · source · birthday · callback · **follow-up** · case note history (patient/bulanan) · patient profile · contact listing · appointment timeline |
| **Kewangan** | 18 | collection (daily/monthly/summary/yearly) · payment · payment type (±Doctor) · **SST** (+CN) · void receipt · **deposit** (+refund) · **refund** · credit memo · POS · panel collection/invoice/payment · insurance collection/invoice/payment · outstanding |
| **Klinikal** | 12 | **MC** · time-off · **X-RAY** · lab · medicine usage · package usage · active package · doctor treatment · treatment statistics · daily/monthly treatment · treatment+medicine |
| **Inventori** | 6 | medicine/product/material balance + movement |
| **e-Invoice** | 3 | user guide · training · SO |
| **Lain** | 5 | holiday · staff leave · staff commission · OSH · incident/death |

**Kita ada ~6. Dr Partner ada 53. Jurang terbesar dalam projek.**

---

# BAHAGIAN G · URUTAN KERJA DICADANG

| Fasa | Tambah | Saiz |
|---|---|---|
| **1 baki** | 16 medan pesakit · 4 halaman SOAP options · bilik · paket | 2 hari |
| **2** | Aliran duit + mod bayaran (10 panel) | 3 hari |
| **3** | **8 lajur harga** + inventori (ubat 16 medan · 27 pembekal · UOM · produk · bahan) | 7 hari |
| **4** | Wang pesakit (deposit · refund · credit) | 3 hari |
| **5** | **Cukai + e-Invoice** (classification_code!) | 5 hari |
| **6** | **30 laporan teras** (dari 53) | 5 hari |
| **7** | Sisa (cuti · roster · voucher · komisen · IC reader · eInvoice staf) | 4 hari |
| | **JUMLAH** | **~29 hari** |

---

# BAHAGIAN H · HAD KAJIAN INI — JUJUR

| Perkara | Status |
|---|---|
| Setting (44 endpoint) | ✅ **Siap** — data kosong direkod |
| Pesakit (borang 76 medan) | ✅ **Siap** |
| Klinikal (katalog, kategori, custom forms, bilik, paket) | ✅ **Siap** |
| **Reports (53)** | ⚠️ **Nama + kategori sahaja** — kolum belum dibaca (perlu parameter tarikh) |
| **Transaction (23)** | ❌ **Belum dibaca** |
| 9 halaman tanpa endpoint | `proceduresetup` · `branchtaxedit` · `dpsetting` · `apptinterfacesetup` · `bcommsetup` · `messagesetting` · `messagecampsetting` · `branchlogo` · `branchedit` — nama endpoint berbeza |
| Teks MC/PDPA | ⚠️ **Tiada** — cawangan ini tak isi |
| SOAP options | ⚠️ Berfungsi, **0 data** |
| Senarai pesakit | ⚠️ Kosong (tiada pesakit di cawangan ini) |

**Aku baca modul Setting + Pesakit + Klinikal sepenuhnya. Reports dan Transaction belum — itu 76 daripada 250 halaman.**

---

# BAHAGIAN I · SENARAI IMPORT UNTUK FASA 3

Data ini **sedia untuk dimasukkan** bila bos sahkan:

| # | Data | Kuantiti |
|---|---|---|
| 1 | Kategori rawatan | 17 |
| 2 | Kod rawatan | 24 |
| 3 | Panel | 10 |
| 4 | Ubat | 14 |
| 5 | Kategori ubat | 3 |
| 6 | Pembekal | 27 |
| 7 | UOM | 5 |
| 8 | Tujuan temujanji + tempoh | 8 |
| 9 | Jenis staf | 3 |

⚠️ **Peringatan:** harga rawatan **hampir semua 0.00** di Dr Partner. Bos kena beri senarai harga sebenar — **jangan reka nombor**.
