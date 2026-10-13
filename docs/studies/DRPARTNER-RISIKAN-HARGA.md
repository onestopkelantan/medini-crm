# RISIKAN DR PARTNER — HARGA RAWATAN & ALIRAN CAJ
**Tarikh:** 27 Sept 2026 · **Akses:** READ ONLY · **Cawangan:** 5 dalam group (Setia Tropika, Molek, Sentosa, UBC, Kajang)

---

## 1 · JAWAPAN KEPADA SOALAN BOS

> *"Harga tu siapa tulis atau dah ready ada? Maksudnya klik je rawatan terus ada harga?"*

**YA — klik rawatan, harga terus muncul.** Mekanismenya disahkan hidup:

```javascript
// addtreatment.php (skrin doktor) — bila nama rawatan ditukar:
$.ajax({ url: "dd_treatment.php", data: "treatment=" + val,
         success: html => { $("#unitprice").html(html); } });
```

**Tetapi satu penemuan penting:** harga yang muncul itu datang dari **`tsetupprice`** — senarai harga cawangan. Kalau nama rawatan **tiada** dalam senarai, ia jatuh kepada **nilai lalai hardcoded**.

**Bukti (cawangan Kajang):**
| Rawatan | Senarai harga cawangan | Auto-isi bagi | |
|---|---|---|---|
| `CONSULTATION (ADULT)` | RM30 | **RM30** | ✅ padan |
| `CONSULTATION (KIDS)` | RM20 | **RM20** | ✅ padan |
| `GIC FILLING (ADULT)` | RM100 | **RM100** | ✅ padan |
| `CONSULTATION` *(nama generik)* | *tiada* | RM50 | ⚠️ **nilai lalai** |
| `FILLING` *(nama generik)* | *tiada* | RM25 | ⚠️ **nilai lalai** |
| `SCALING AND POLISHING` *(generik)* | *tiada* | RM100 | ⚠️ **nilai lalai** |

**Implikasi:** kalau klinik guna nama generik, harga yang muncul **bukan** harga sebenar cawangan — ia nilai lalai sistem. Sumber kebenaran tetap **senarai harga cawangan**.

---

## 2 · JAWAPAN KEPUTUSAN A vs B — **JAWAPANNYA: B**

> *"Harga Scaling di Setia Tropika sama dengan 14 cawangan lain, atau beza?"*

**BEZA. Disahkan dengan bukti.**

| Rawatan | Setia Tropika | Molek | Sentosa | UBC | Kajang |
|---|---|---|---|---|---|
| OPG X-Ray | **RM100** | **RM120** | RM0 | RM0 | **RM100** |
| Consultation | RM0 | **RM80** | RM0 | RM0 | **RM30** (dewasa) / **RM20** (kanak) |

Harga **berbeza antara cawangan** untuk rawatan yang sama. Dan **senarai rawatan pun berbeza** — Kajang ada 41, Setia Tropika 25, Molek dan Sentosa 23.

⇒ **A (HQ sahaja) tidak sesuai.** **B (pengurus cawangan urus kadar sendiri) adalah model sebenar.**

---

## 3 · INI PUNCA MASALAH SEBENAR

**ID rawatan tidak konsisten antara cawangan — ini bug sistem Dr Partner:**

| ID | Setia Tropika | Kajang |
|---|---|---|
| 6 | EXTRACTION | SCALING & POLISHING |
| 8 | MEDICATIONS | FILLING |
| 20 | CBCT XRAY | CLEAR ALIGNER |
| 24 | ROOT CANAL TREATMENT | DENTURE |
| 35 | IMPLANT | OPG XRAY |

**Hanya 13 daripada 41 ID sama** antara Setia Tropika dan Kajang. Bila setiap cawangan cipta baris sendiri, **satu rawatan jadi 2-3 entri berbeza**:

```
OPG:  "OPG X-RAY" (Setia)  ·  "OPG XRAY" (Molek/Kajang)  ·  "OPG" (master)
```

Selepas 5 cawangan, laporan harga peringkat kumpulan jadi **mustahil** — sistem tak tahu "OPG X-RAY" dan "OPG XRAY" itu rawatan sama.

⚠️ **Setia Tropika hampir kosong (2/25 berharga).** Jadi senarai harga Medini Dental Group **belum wujud** — hanya Kajang siap.

---

## 4 · SENARAI HARGA KAJANG (paling lengkap — 30/41 berharga)

| Rawatan | Harga | | Rawatan | Harga |
|---|---:|---|---|---:|
| CLEAR ALIGNER | 8,000 | | GIC FILLING (ADULT) | 100 |
| VENEER | 1,500 | | OPG XRAY | 100 |
| ROOT CANAL (MOLAR) | 1,300 | | GIC FILLING (KIDS) | 70 |
| CROWN | 900 | | DECIDUOUS EXTRACTION | 60 |
| ROOT CANAL (PRE-MOLAR) | 900 | | POLISHING (KIDS) | 60 |
| MINOR ORAL SUGERY | 800 | | DRY SOCKET MX | 50 |
| FIBER REINFORCED COMPOSITE | 700 | | PA XRAY | 50 |
| ROOT CANAL (ANTERIOR) | 700 | | SUTURE | 50 |
| WHITENING | 699 | | FLOURIDE | 40 |
| DIFFICULT EXTRACTION | 300 | | CONSULTATION (ADULT) | 30 |
| PULPOTOMY / PULPECTOMY | 300 | | CONSULTATION (KIDS) | 20 |
| RETAINER | 300 | | LOCAL ANESTHESIA | 10 |
| COMPOSITE VENEER | 200 | | | |
| EXPRESS WHITENING | 180 | | | |
| ALVEOLOPLASTY · EMERGENCY · OPERCULECTOMY · SCALING | 150 | | | |

**Kosong (0.00) di Kajang:** IMPLANT, EXTRACTION, STO, BRIDGE, LA CEPH XRAY — 11 rawatan belum berharga.

⚠️ **Kolom `Price 2`, `Panel price`, `Cost`, `SST` — KOSONG SEMUA cawangan.** Jadi Dr Partner pun belum guna medan itu.

---

## 5 · 48 RAWATAN MASTER (senarai rujukan)

Sistem ada **48 nama rawatan terbina** (`treatmenthdr_copybi.php`). Klinik pilih dari senarai ini, atau cipta sendiri.

```
ALVEOLOPLASTY · AMALGAM FILLING · BLANC ONE WHITENING · CBCT · COMPOSITE FILLING
CONSULTATION · DENTURE · DRY SOCKET MX · EXTRACTION · F/F DENTURE ACRYLIC
F/F DENTURE FLEXIBLE · FILLING · FISSURE SEALANT · FLUORIDE APPLICATION
FULL METAL CROWN · GIC FILLING · IMPLANT CROWN ISSUED · IMPLANT IMPRESSION
INVISALIGN · INVISALIGN MODERATE · INVISALIGN REVIEW · LASER EMUNDO
LASER GINGIVECTOMY · MFT + EXPANDER · MFT + TRAINER · MFT REVIEW
MILK TOOTH EXTRACTION · OPG · ORTHO DEBOND · ORTHO REVIEW · PA RADIOGRAPH
PARTIAL DENTURE ACRYLIC · PARTIAL DENTURE THERMOSENSE · PFM BRIDGE · PFM CROWN
PULPOTOMY · RETAINER · ROOT CANAL - ANTERIOR · ROOT CANAL - MOLAR
ROOT CANAL - PREMOLAR · SCALING AND POLISHING · STO · STRAUMANN IMPLANT
WHITENING · WISDOM TOOTH EXTRACTION · WISDOM TOOTH SURGERY
ZIRCONIA BRIDGE · ZIRCONIA CROWN
```
**Tanda X-ray:** CBCT · OPG · PA RADIOGRAPH

---

## 6 · ALIRAN CAJ — siapa buat apa

| Langkah | Siapa | Bukti |
|---|---|---|
| 1. Pesakit masuk queue | Kaunter | `queuepage.php` — nama, masa masuk, aduan, doktor. Status `EP`/`WIP` |
| 2. Doktor pilih rawatan | Doktor | `addtreatment.php` |
| 3. **Harga AUTO-ISI** | Sistem | `dd_treatment.php` — dari senarai harga cawangan |
| 4. Doktor boleh **ubah** `unitprice` | Doktor | `<input name="unitprice" id="unitprice">` |
| 5. Doktor tulis deskripsi + nota kes | Doktor | `descs`, `note` |
| 6. Simpan | Doktor | `Add treatment` |
| 7. Bayaran | Kaunter | `payment.php` |

**⇒ Doktor BOLEH ubah harga sebelum simpan.** Tiada pengesahan berasingan — doktor dan kaunter itu sahaja lapisan.

---

## 7 · APA YANG CRM KITA BOLEH SESUAIKAN + TAMBAH BAIK

### 🔴 Pembetulan wajib (Dr Partner ada masalah, kita jangan ulang)

| # | Masalah Dr Partner | CRM kita patut buat |
|---|---|---|
| 1 | **ID rawatan tidak konsisten** antara cawangan → satu rawatan jadi 3 entri | **Kod rawatan global** (`TRT-####`) + nama cawangan sebagai *harga*, bukan rawatan baharu |
| 2 | **Nama hampir sama** (`OPG` / `OPG XRAY` / `OPG X-RAY`) | Kod unik + **nama piawai**; larang cipta nama serupa, cadang yang hampir |
| 3 | **Harga lalai hardcoded** muncul bila nama tak padan | **Tiada harga lalai.** Kalau tak padan → **kosong**, dan beritahu sebab |
| 4 | **Doktor boleh ubah harga tanpa jejak** | Kalau doktor ubah, **rekod siapa ubah + kenapa** (audit) |
| 5 | **Cukai/kaedah bayaran kosong semua cawangan** | Isi semasa setup; sistem ingatkan kalau kosong |
| 6 | **2 sumber harga** (senarai + hardcoded) bercanggah | **Satu sumber sahaja** |

### 🟢 Kelebihan yang kita patut ambil

| # | Ciri Dr Partner | CRM kita |
|---|---|---|
| 1 | **Harga auto-isi bila pilih rawatan** | ✅ **WAJIB** — ini yang buat doktor laju |
| 2 | **48 senarai master** | Bina serupa sebagai titik mula, bukan paksa guna |
| 3 | **Tanda X-ray pada rawatan** | ✅ dah ada (`requires_xray`) |
| 4 | **Pintasan papan kekunci** | ✅ dah ada lajur |
| 5 | **Kategori rawatan** (17) | ✅ dah ada |
| 6 | **Status queue** (`EP`, `WIP`) | Status lawatan — jelas untuk kaunter |
| 7 | **`unitprice` boleh ubah** | Ganti dgn **pelarasan baris bil** + audit, bukan edit bebas |

### Struktur harga — cadangan konkrit

```
SEKARANG (kita):          price · price2 · panel_price · cost · local_sst_pct
                          · foreigner_sst_pct · classification_code · keyboard_letter
                          ↑ di treatment_catalog (peringkat ORGANISASI)

DR PARTNER:               harga disimpan PER CAWANGAN
                          tsetupprice_N, tsetupprice2_N, tsetuppricep_N, tclasscode_N, fsst_N

KITA PATUT:               treatment_catalog   = APA rawatan (kod, nama, kategori, xray)
                          treatment_pricing   = BERAPA, PER CAWANGAN
                                                (treatment_id, branch_id, price, price2,
                                                 panel_price, cost, sst_local, sst_foreign,
                                                 classification_code, effective_from)
```

**Kenapa berasingan:** satu rawatan, 14 harga. Tanpa jadual berasingan, kita ulang bug Dr Partner (14 salinan rawatan sama).

---

## 8 · HAD RISIKAN (jujur)

| Perkara | Status |
|---|---|
| Perubahan data | ❌ **tiada** — read only sepenuhnya |
| Cawangan disemak | **5 daripada 14** (yang ada dalam dropdown group) |
| `Price 2` · `Panel price` · `Cost` · `SST` | Kosong di semua cawangan — **tak dapat disahkan** |
| Harga sebenar 14 cawangan | ❌ hanya 5 disemak |
| Ujian simpan | ❌ tidak dilakukan |
| 9 cawangan lain | Tidak muncul dalam dropdown group |
