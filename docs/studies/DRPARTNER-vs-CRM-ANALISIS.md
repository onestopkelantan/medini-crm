# DR PARTNER → MEDINI CRM — Analisis Jurang & Pelan Tambah Baik

> **Sumber:** `thedrpartner.com` · Medini Dental Group → Klinik Pergigian Medini **Setia Tropika** (`branch=8`)
> **Mod:** READ ONLY — tiada data diubah
> **Tarikh:** 25 Sept 2026

---

## 1 · SENIBINA DR PARTNER (yang kita kena tahu)

Setiap halaman Dr Partner **kosong bila dibaca terus** — data dimuat melalui AJAX:

```
<nama_halaman>.php            → rangka kosong + <script src="dpjs/<nama>.js">
dpjs/<nama>.js               → function init() { $.ajax({url:"<nama>_init.php"}) }
<nama>_init.php  ATAU  <nama>_list.php  →  JSON { "nama_kotak": "<html jadual>" }
```

**Pola nama endpoint:**
| Kegunaan | Endpoint |
|---|---|
| Muat senarai + borang | `<nama>_init.php` |
| Muat senarai sahaja (custom forms) | `<nama>_list.php` |
| Tambah | `<nama>_insert.php` |
| Kemas kini | `<nama>_update.php` |
| Padam | `<nama>_remove.php` |

⚠️ **Endpoint perlukan konteks halaman** — `fetch()` dari halaman lain pulangkan 200 + HTML kosong. Kena navigasi ke halaman dulu, baru baca.

---

## 2 · MASTER DATA DISAHKAN (Setia Tropika sebenar)

| Modul | Bilangan | Butiran |
|---|---|---|
| **Katalog rawatan** | **24** | 🔴 **hanya 2 berharga** — OPG X-RAY RM100, PA X-RAY RM50 |
| Kategori rawatan | 17 | APPLICATION · BRACES · BRIDGE · CLEAR ALIGNER · CONSULTATION · CROWN · DENTAL SURGICAL · DENTURE · EXTRACTION · FIBER REINFORCED COMPOSITE · FILLING · IMPLANT · MINOR ORAL SUGERY · ROOT CANAL TREATMENT · SCALING · VENEER · WHITENING |
| **Panel** | **10** | AIA · E-MAS · HealthMetrics · MBJB · **MediDent** · MedKad · MEDNEFITS · MiCare · PM CARE · UTM |
| **Ubat** | **14** | 3 kategori: ANTIBIOTIC · BENGKAK · PAINKILLER |
| **Pembekal** | **27** | ACME · APEX PHARMACY · DENTOPIA · Pharmaniaga · ZUELLIG · dksh · … |
| **Tujuan temujanji** | **8** | **ada tempoh lalai** (jam+minit) |
| UOM | 5 | BOTTLE · BOX · CATTON · PCS · UNIT |
| Jenis staf | 3 | Doctor · Front desk · Management |
| Voucher | 1 | GOOGLE REVIEW — 10% |
| Roster temujanji | 8 slot | — |

### Senarai ubat penuh (14)
```
ANTIBIOTIC : AMOXY 250MG · AMOXY 500mg · AUGMENTIN 625MG · METRO 400MG · SYRUP AMOXY 250MG
BENGKAK    : PAPASE
PAINKILLER : ARCOXIA 120MG · ARCOXIA 90MG · IBUFERN 400MG · IBUPROFEN 200MG · PCM 500MG · PONSTAN 500MG · SYRUP PCM 250MG
```

### Tujuan temujanji + tempoh lalai
| Tujuan | Jam | Minit |
|---|---|---|
| CHECK UP | 0 | 30 |
| DENTURE IMPRESSION | 0 | 30 |
| EXTRACTION | 0 | 30 |
| FILLING | **1** | 0 |
| MOS | **1** | 30 |
| RCT | **1** | 30 |
| REV ORTHO | 0 | 30 |
| SCALING POLISHING | 0 | 30 |
| WHITENING | **1** | 30 |

---

## 3 · BORANG PESAKIT DR PARTNER — 76 MEDAN

### Medan yang CRM kita **TIADA** (jurang sebenar)

| # | Medan Dr Partner | Kenapa penting | Fasa |
|---|---|---|---|
| 1 | **Nationality \*** | Untuk **SST** — cukai berbeza warga asing | 3/5 |
| 2 | **Blood type** | Kecemasan perubatan | 1 |
| 3 | **Marital status** | Profil pesakit | 2 |
| 4 | **Race** | Demografi + laporan | 6 |
| 5 | **Prefer message language** (English/BM/中文) | WhatsApp ikut bahasa pesakit | 2 |
| 6 | **Bapa / Ibu / Penjaga** (nama + IC + telefon) | Pesakit kanak-kanak — **wajib** untuk consent | 1 |
| 7 | **Emergency contact** (nama + telefon) | Keselamatan | 1 |
| 8 | **Occupation** | Profil + laporan | 2 |
| 9 | **Refer by** | Jejak sumber pesakit | 2 |
| 10 | **Vegetarian** | Keutamaan rawatan/ubat | 4 |
| 11 | **Second address** | Alamat surat-menyurat | 2 |
| 12 | **Pregnant?** | 🔴 **KONTRA-INDIKASI** X-ray & ubat | 1 |
| 13 | **Temperature ºc** | Saringan (waktu COVID dulu) | — |
| 14 | **Dose of vaccine** | Vaksin | — |
| 15 | **schemeID: NRIC/BRN/PASSPORT/ARMY** | Jenis dokumen ID | 1 |
| 16 | **Title** (11 pilihan: Mr/Mrs/Dato/Tan Sri/…) | Formaliti Malaysia | 2 |
| 17 | **IC Reader** (MyKad auto-isi) | Kelajuan kaunter | 7 |

### Medan yang kita **SUDAH ada** (bagus)
`Name` · `IC` · `Gender` · `DOB` · `Age` · `Mobile` · `Email` · `Address` · `Panel company` · `Allergy` (kita **berstruktur** — Dr Partner teks bebas)

---

## 4 · JADUAL PERBANDINGAN — BEFORE & AFTER + JUSTIFIKASI

### 4.1 · Dashboard

| | **SEKARANG (CRM kita)** | **SELEPAS (cadangan)** | Justifikasi |
|---|---|---|---|
| KPI | Jumlah pesakit, janji temu | **+ pesakit baharu hari ini · kadar tidak hadir · hasil hari ini** | Dr Partner ada `bdailyvisit.php`, `bmthnoshowrpt.php`, `bdailycollection.php` — 3 nombor yang doktor tanya setiap pagi |
| Carta | Ada | **+ carta trend 7/30 hari** | Dr Partner ada `bchart_yrsale.php` |
| Amaran | Tiada | **+ amaran stok rendah · ubat hampir luput · pesakit perlu susulan** | Dr Partner ada `medialertsetup.php` + `rptfollowup.php` |

### 4.2 · Pesakit

| | **SEKARANG** | **SELEPAS** | Justifikasi |
|---|---|---|---|
| Medan | ~25 | **+16 medan** (§3) | **`Nationality` WAJIB** untuk SST (Dr Partner tanda `*`); **`Pregnant?`** kontra-indikasi X-ray/ubat; **Bapa/Ibu/Penjaga** perlu untuk consent kanak-kanak |
| Alahan | ✅ **Jadual berstruktur + gerbang keselamatan** | **KEKAL** | 🟢 **Kita LEBIH BAIK** — Dr Partner hanya teks bebas `Allergy / Medical history`, tiada gerbang |
| Panel | Ada | **+10 panel sebenar** (§2) | Data sebenar klinik — sedia untuk Fasa 3 |
| ID | IC sahaja | **+jenis (NRIC/BRN/PASSPORT/ARMY)** | Pesakit warga asing + syarikat |

### 4.3 · Klinikal (Rawatan)

| | **SEKARANG** | **SELEPAS** | Justifikasi |
|---|---|---|---|
| Katalog | `code · name · category · duration_min · is_active · requires_xray · chart_symbol_code` | **+8 lajur:** `Price · Price 2 · Panel price · Cost · Local SST % · Foreigner SST · classification_code · keyboard_letter` | 🔴 **`Classification code` WAJIB e-Invoice LHDN**. `Panel price` perlu untuk panel billing. `Cost` untuk margin |
| Bilik rawatan | ❌ **tiada jadual** | **+jadual `rooms` + `appointments.room_id`** | Dr Partner `roomsetup.php`. Penjadualan kerusi |
| Paket rawatan | ❌ tiada jadual | **+jadual `treatment_packages`** | Dr Partner `packagesetup.php` (braces berperingkat) |
| Custom forms | ✅ enjin + PDF | **+isi teks sebenar** | Enjin kita **lebih baik** (versioning + snapshot). Bos isi teks |
| SOAP options | ❌ | **+4 senarai pilihan S/O/A/P** | Dr Partner `option*setup.php` — doktor taip laju, tiada silap ejaan |
| Carta gigi | ✅ **14 keadaan + simbol** | **KEKAL** | 🟢 Kita LEBIH BAIK — Dr Partner 7 sahaja |
| Alahan | ✅ berstruktur + gerbang | **KEKAL** | 🟢 Kita LEBIH BAIK |

### 4.4 · Kewangan (Fasa 3)

| | **SEKARANG** | **SELEPAS** | Justifikasi |
|---|---|---|---|
| Harga | code/name sahaja | **Price · Price 2 · Panel · Cost · SST tempatan · SST asing** | Dr Partner ada 6 medan harga. Kita ada **1** (belum diisi) |
| Mod bayaran | ❌ 0 | **+senarai mod** | Dr Partner `paymodesetup.php` |
| Insurans | ❌ 0 | **+jadual insurans** | Dr Partner `insurancesetup.php` (berasingan daripada panel) |
| Voucher | ❌ | **+voucher (% atau RM)** | Dr Partner ada GOOGLE REVIEW 10% — promosi sebenar |
| Komisen | ❌ | **+komisen doktor** | Dr Partner `bcommsetup.php` + `bstaffcommcal.php` |

### 4.5 · Inventori (Fasa 3)

| | **SEKARANG** | **SELEPAS** | Justifikasi |
|---|---|---|---|
| Ubat | ❌ | **+jadual ubat: 16 medan** | Dr Partner ada 14 ubat sebenar + `Controlled drug` + `Alert` + `Maximum dose` |
| Pembekal | ❌ | **+jadual pembekal** | 27 pembekal sebenar sedia untuk disalin |
| UOM | ❌ | **+5 unit** | BOTTLE · BOX · CATTON · PCS · UNIT |
| Produk/Bahan | ❌ | **+2 modul** | Dr Partner asingkan Produk (jual) vs Bahan (guna) |
| Stok masuk/keluar | ❌ | **+3 transaksi × 3 jenis** | Dr Partner: stock in · adjustment · internal use |

### 4.6 · laporan (Fasa 6) — **53 laporan Dr Partner**

| Kategori | Bil | Contoh |
|---|---|---|
| Pesakit | 15 | daily/monthly/yearly visit · no-show · new registered · tourism · source · birthday · follow-up |
| Kewangan | 18 | collection · payment type · SST · deposit · refund · credit memo · POS · panel · insurance |
| Klinikal | 12 | MC · time-off · **X-RAY** · lab · medicine usage · package usage · treatment statistics |
| e-Invoice | 3 | user guide · training · SO |
| Inventori | 6 | medicine/product/material balance + movement |

### 4.7 · Tetapan (Fasa 7)

| | **SEKARANG** | **SELEPAS** | Justifikasi |
|---|---|---|---|
| Cuti klinik | ❌ | **+kalendar cuti** | Dr Partner `bcholiday.php` — elak janji temu pada cuti |
| Roster temujanji | ❌ | **+8 slot masa** | Dr Partner `bapptroster.php` |
| Tujuan + tempoh lalai | ❌ | **+8 tujuan** | Kita ada `duration_min` tetapi tiada senarai pilihan |
| Jenis staf | Ada (RBAC) | **+paparan 3 jenis** | Dr Partner: Doctor · Front desk · Management |
| Staf e-Invoice | ❌ | **+penetapan staf e-Invoice** | Dr Partner `einvstaffsetup.php` |
| Templat WhatsApp | Ada | **+kategori kampanye** | Dr Partner `messagesetting.php` + `messagecampsetting.php` |

---

## 5 · APA YANG KITA **LEBIH BAIK** DARIPADA DR PARTNER

| Perkara | Kita | Dr Partner |
|---|---|---|
| **Alahan** | Jadual berstruktur + **gerbang keselamatan** (blok jika serius & tak diakui) | Teks bebas sahaja |
| **Carta gigi** | 14 keadaan + 7 simbol boleh-konfig | 7 keadaan |
| **Keborangan (audit)** | ADR-009 — nota bertandatangan tidak boleh diubah, pindaan jejak | — |
| **Bilik/paket** | Akan datang | Ada tetapi **0 data** |
| **Tema** | Mod gelap + BM/EN | Putih sahaja, 4 bahasa |
| **PDF borang** | Enjin + snapshot versi | Cetak |

---

## 6 · URUTAN KERJA DICADANG

| Fasa | Tambah | Saiz |
|---|---|---|
| **Fasa 1 baki** | 16 medan pesakit · bilik · paket · SOAP options | 2 hari |
| **Fasa 2** | Aliran duit betul + mod bayaran | 3 hari |
| **Fasa 3** | **8 lajur harga rawatan** + inventori (ubat/pembekal/UOM) | 7 hari |
| **Fasa 4** | Wang pesakit (deposit/refund) | 3 hari |
| **Fasa 5** | **Cukai + e-Invoice** (classification code!) | 5 hari |
| **Fasa 6** | 30 laporan teras | 5 hari |
| **Fasa 7** | Sisa (cuti, roster, voucher, komisen, IC reader) | 4 hari |

---

## 7 · ⚠️ HAD KAJIAN INI — JUJUR

| Perkara | Status |
|---|---|
| Halaman **Setting** | 44 endpoint dijumpai, data **kosong** di Setia Tropika untuk kebanyakan |
| 9 halaman tanpa endpoint | `proceduresetup` · `branchtaxedit` · `dpsetting` · `apptinterfacesetup` · `bcommsetup` · `messagesetting` · `messagecampsetting` · `branchlogo` · `branchedit` — nama endpoint **berbeza** |
| **53 halaman Reports** | ❌ **belum dibaca** — nama laporan sahaja |
| **23 halaman Transaction** | ❌ **belum dibaca** |
| SOAP options | Berfungsi, **0 data** — tiada teks untuk disalin |
| Custom forms | Berfungsi, **0 data** — tiada teks MC/PDPA untuk disalin |
| Paparan (bukan data) | Struktur jadual/borang dibaca dari halaman; nilai sebenar dari `_init.php` |

**Kesimpulan:** Kajian ini meliputi **modul Setting + Pesakit + Klinikal**. Reports dan Transaction belum diterokai — itu kerja seterusnya.
