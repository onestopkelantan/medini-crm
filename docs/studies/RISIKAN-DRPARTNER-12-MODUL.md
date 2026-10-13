# RISIKAN DATA DR PARTNER + APA MEDINI KENA FIX (12 MODUL)
**Tarikh:** 24 Sep 2026 · **Skop:** struktur data sebenar Dr Partner (read-only) vs Medini CRM
**Prinsip:** copy keperluan data · **naik taraf UI/UX** (Dr Partner teknologi 2010-an)

---

## 0. TIGA PENEMUAN BESAR DARI BORANG SEBENAR

### 🔴 #1 — HARGA PER CAWANGAN, DALAM BORANG YANG SAMA

```
Treatment setup:
  price[number]        ← harga HQ/asas
  price2[number]
  pricep[number]       ← harga panel
  cost[number]
  sstp[number]

  TAPI juga:
  tsetupprice_33[number]   tclasscode_33   tsetupsstp_33   fsst_33[checkbox]
  tsetupprice_7[number]    tclasscode_7    tsetupsstp_7    fsst_7[checkbox]
  tsetupprice_15[number]   tclasscode_15   tsetupsstp_15   fsst_15[checkbox]
       ↑ suffix `_33`, `_7`, `_15` = ID CAWANGAN
```

> **Ini menjawab terus kebimbangan kau semalam** — *"kat branch pun nampak jugak kan"*.
> Dr Partner **memang** beri harga per cawangan, di permukaan yang sama.
> Bukan tab berasingan, bukan skrin lain — **satu senarai, nilai berbeza ikut cawangan**.

**Sama pada ubat:** `msetupprice_13`, `msetupprice_1`, `msetupprice_14`, `msetupprice_4`, `msetupprice_7` … (ID cawangan)

### 🔴 #2 — KALENDAR HARGA + KESAN CUKAI PER CAWANGAN

Setiap cawangan ada **`tclasscode_N`** (kod klasifikasi e-Invoice) dan **`fsst_N`** (tanda cukai asing).
Maksudnya: **kod LHDN dan kadar cukai pun berbeza per cawangan.** Ini kepatuhan, bukan kemewahan.

### 🔴 #3 — BANYAK SKRIN DR PARTNER HANYA STRUKTUR (kosong)

`consentsetup` · `toformsetup` · `pdpaformsetup` · `optioncomplainsetup` — semuanya
**"Add new template" kosong**. Malah `package setup` dan `insurance company` = **"No record found"**.

> **Kesannya pada strategi kita:** Dr Partner **rangka lengkap tetapi isinya kena isi sendiri**.
> Jadi kita **tidak perlu kejar 100% ciri** — kita perlu **rangka yang sama, UI lebih baik**,
> dan **isi panduan** supaya Medini terus berguna tanpa setup berminggu.

---

## 1. STRUKTUR DATA DR PARTNER (rujukan copy)

### 1.1 Treatment setup — 12 medan

| Medan | Jenis | Nota |
|---|---|---|
| `catid` | select | Kategori rawatan |
| `einvclasscode` | text | **Kod klasifikasi e-Invoice LHDN** |
| `treatment` | text | Nama rawatan |
| `xrayind` | checkbox | Perlukan X-ray |
| `pingying` | text | Nama fonetik (Cina) — **boleh buang untuk kita** |
| `itemcode` | text | Kod item |
| `price` · `price2` | number | Harga asas · harga ke-2 |
| **`pricep`** | number | **Harga panel** |
| **`cost`** | number | **Kos** (untuk kira margin + komisen) |
| `sstp` | number | % SST tempatan |
| `chartname` | text | **Simbol carta gigi** |
| `pointearn` · `pointredeem` | hidden | Mata ganjaran |
| **`labfee`** | hidden | **Kos lab** (untuk tolak dari komisen) |

### 1.2 Medicine setup — 16 medan

| Medan | Contoh sebenar |
|---|---|
| `itemcode` · `name` | — · AMOXY 500mg |
| `mprice` | Harga jual |
| `mcat` | ANTIBIOTIC · BENGKAK · PAINKILLER |
| **`maxdose`** | **Dos maksimum** |
| `minorder` | Pesanan minimum |
| `uom` | BOTTLE · BOX · UNIT · PCS · CARTON |
| **`grade` · `attribute` · `alert`** | Gred · sifat · **amaran** |
| **`controlitem`** | **Ubat terkawal: Yes/No** ← kepatuhan |
| **`meal` · `usage` · `dosage`** | Makanan · kegunaan · dos |
| `sstp` | % SST |

### 1.3 Medicine stock in — 5 medan + 4 invois

```
Borang:  invno · suppliername · shipmentfee[number] · ddisc[number] · rmk
Baris:   Medicine · Expiry date · Batch no. · Quantity · Cost/unit
```

### 1.4 Pesakit — ada 3 jenis penjaga (!)

```
sname · sicno · smobileno · smbrno            ← pesakit
parentname · parentphone                       ← IBU BAPA
guardianname · guardianphone                   ← PENJAGA
```
> Medini ada **1** `guardianId` sahaja. Dr Partner bezakan **ibu bapa** vs **penjaga**.
> Sama masalah untuk mana-mana klinik yang layan kanak-kanak.

### 1.5 Appointment purpose — ada tempoh lalai sebenar

```
Purpose              Hours  Minutes
CHECK UP               0      30
DENTURE IMPRESSION     0      30
EXTRACTION             0      30
FILLING                1       0
MOS                    1      30
RCT                    1      30
REV ORTHO              0      30
SCALING POLISHING      0      30
```
> **Medini tiada ini.** Kita ada `durationMin` pada katalog rawatan, tetapi **tiada
> "purpose"** (sebab datang) dengan tempoh lalai. Sistem tempahan tak tahu nak blok berapa lama.

### 1.6 Staf — 14 medan + peranan berlapis

```
staff_code · name · email · password
category (Staff type: Doctor | Front desk | Management)
doctor[Y/N] · branchadmin[Y/N] · frontdesk[Y/N] · dispensing[Y/N]
commlevel[0-3] · acommlevel[0-3]
medicalno (MMC/MDC) · sintro (Specialty)
```
> **Satu staf boleh jadi: doktor + branch admin + front desk + dispensing serentak.**
> Medini: **satu peranan sahaja** (`hq | branch_manager | branch_admin | doctor`).
> Ini had sebenar — jururawat yang juga kaunter tak boleh diwakili.

### 1.7 Lain-lain (ringkas)

| Borang | Medan |
|---|---|
| **Treatment room** | `sroom` (nama bilik) |
| **Appointment procedure** | `proname` |
| **Referral doctor** | clinic · name · contact · email |
| **Credit setup** | `pamt` ($) · `camt` (kredit) · `dvalid` (**hari sah**) → `$1 = 1 credit` |
| **Voucher** | `vtype` · `vdisctype` (`%` / `$`) · `vdiscamt` → `GOOGLE REVIEW 10%` |
| **Insurance invoice** | `gym` (YearMonth) · `panel` (syarikat) → **jana invois bulanan** |
| **Staff type** | `type` |
| **MC / Consent / Time-off / PDPA** | templat (kosong, isi sendiri) |

---

## 2. JADUAL UTAMA — 12 MODUL MEDINI × APA KENA FIX

**Legenda:** 🔧 = kita ada, perlu fix · 🆕 = kita tiada, copy dari Dr Partner · ⭐ = peluang UI/UX lebih baik

| # | Modul Medini | 🔧 DAH ADA (fix) | 🆕 COPY DARI DR PARTNER | ⭐ UI/UX ENHANCE |
|---|---|---|---|---|
| **1** | **Patients** | `patients` 20 kolum · 7 EP · timeline · `patient_relationships` | **Ibu bapa vs penjaga** (3 medan) · `sbrno` (no. pendaftaran) · sumber pesakit | Timeline visual + kad 360 dengan gambar; **gabung ibu bapa/penjaga dalam satu panel keluarga** |
| **2** | **Appointments** | 17 EP · slot finder · `durationMin` katalog · reschedule | **`apptpurposesetup`** (purpose + jam/minit lalai) · **`proceduresetup`** | **Auto-isi tempoh** bila pilih purpose; paparan kalendar mingguan; drag-resize |
| **3** | **Clinical** | 29 EP · SOAP + **sign + amend** · plans · consents · gates (7 fail domain) | **Odontogram** · **gigi susu 5x–8x** · **`chartname` (simbol boleh-konfig)** · **MC form** · **time-off** · **PDPA** | **Odontogram moden SVG** (Dr Partner guna imej); warna ikut keadaan; klik kanan untuk menu; sejarah per gigi |
| **4** | **Patients → Alahan** | ⚠️ `safety-gate.ts` guna adverse-events sebagai ganti | **Jadual alahan sebenar** + `medicalno` doktor | **Banner amaran merah** di kepala rekod pesakit; checkbox wajib sebelum rawatan |
| **5** | **Clinical → X-ray** | `imaging_records` + controller · **0 UI** | **`xrayind`** (tanda perlu X-ray pada rawatan) · laporan X-ray bulanan | **Galeri X-ray dengan pembanding sebelum/selepas**; tanda gigi pada X-ray |
| **6** | **Bil / Panel** | `panel_companies` · `insurance_companies` · 12 EP · **0 UI** | **`pricep` harga panel** · jana invois bulanan · terima bayaran · void | Papan invois satu skrin; status berwarna; jana 1 klik |
| **7** | **Finance** | `treatment_costs` (**tiada `doctor_id`**) · `treatment_catalog` (**tiada harga**) | **`price`/`price2`/`pricep`/`cost`/`sstp`** per rawatan **per cawangan** · **`labfee`** | Kad kadar per cawangan (jangan borang; jadual boleh edit sebaris) |
| **8** | **Operations** | 14 EP · 5 jadual · UI 305 b | **Treatment room** (`sroom`) · **Duty roster** · **Machine/Equipment + DOSH** | Papan operasi harian; papan tanda bilik kosong |
| **9** | **Marketing** | 25 EP · campaigns · follow-up · recall | **Voucher** (`vtype`/`vdisctype`/`vdiscamt`) · **Referral clinic + doctor** | Bina voucher seperti kad diskaun boleh pratonton |
| **10** | **WhatsApp** | 44 EP · anti-ban · SLA · AI auto-book — **lebih baik dari Dr Partner** | — (kita mendahului) | — |
| **11** | **AI Manager** | 34 EP · agents · guardrails · playground — **Dr Partner tiada** | — | — |
| **12** | **Administration** | 14 EP · peranan berversi · last-HQ protection | **Satu staf = banyak peranan** (`doctor`+`branchadmin`+`frontdesk`+`dispensing`) · `medicalno` · `sintro` · **`commlevel`/`acommlevel`** | Editor peranan **berbilang tanda** (bukan dropdown tunggal); papar beza kebenaran di sisi |

---

## 3. MODUL YANG KITA **TIADA** (perlu tambah — 4 modul baharu)

| Modul baharu | Data Dr Partner untuk copy | Nilai |
|---|---|---|
| **13 · Inventori** | `medisetup` (16 medan) · `medistockin` (batch+luput+kos) · produk · bahan · UOM · supplier · pengeluar · PO · transfer | 🔴 Kepatuhan farmasi |
| **14 · Prepaid / Deposit / Voucher** | Credit setup (`pamt`/`camt`/`dvalid`) · deposit · voucher | 🔴 Hasil berulang |
| **15 · Cukai / e-Invoice** | `einvclasscode` · `sstp` · **`fsst`** (asing) · laporan SST | 🟠 Kepatuhan LHDN |
| **16 · OSH / DOSH** | Machine/Equipment (serial, brand, pengilang) · jadual pemeriksaan | 🟡 Kepatuhan keselamatan kerja |

---

## 4. PELUANG UI/UX — DI MANA KITA BOLEH LEBIH BAIK

Dr Partner teknologi **PHP 7.2 + jQuery + Foundation** (2010-an). Ini yang kita boleh menang:

| Kawasan | Dr Partner | Cadangan Medini |
|---|---|---|
| **Odontogram** | Imej statik, simbol dari `chartname` | **SVG interaktif** — warna ikut keadaan, klik untuk sejarah gigi, seret untuk pilih beberapa gigi |
| **Kadar harga** | Satu borang panjang dengan `price_33`, `price_7`, `price_15` **bercampur** (sukar dibaca) | **Satu senarai + pemilih cawangan** di atas; nilai berubah; tanda "diwarisi/sendiri" |
| **Komisen** | Dropdown L1/2/3 di skrin tetapan berasingan | **Kalkulator komisen langsung** — taip harga, nampak komisen |
| **Inventori** | Jadual panjang + borang stok masuk | **Kad stok dengan bar luput**; amaran merah untuk batch hampir luput |
| **Laporan** | 100+ pautan menu, sukar dicari | **30 teras + carian + simpan kegemaran** |
| **Tambah staf** | 14 medan satu borang | **Berpandu 3 langkah** (siapa → peranan → bayaran) |
| **Setup kosong** | "Add new template" tanpa panduan | **Templat siap pakai** (consent/MC/PDPA contoh Malaysia) — terus boleh guna |
| **Multi-bahasa** | Suis bahasa penuh halaman | Kita sudah ada BM/BI segera ✅ |

---

## 5. URUTAN FIX — ikut modul, 6 fasa

| Fasa | Modul | 🔧 Fix | 🆕 Copy | Fokus UI/UX |
|---|---|---|---|---|
| **1** | **Clinical** (#3) | 4 skrin tinggal (odontogram, pelan, consent, X-ray) | Odontogram · gigi susu · chartname · MC · time-off · PDPA | **Odontogram SVG** |
| **2** | **Patients + Appointments** (#1, #2) | Edit pesakit · Patient360 penuh | Ibu bapa/penjaga · purpose+tempoh · procedures | Kad keluarga · auto-tempoh |
| **3** | **Finance + Bil** (#6, #7) | `doctor_id` · harga katalog | `price2`/`pricep`/`cost`/`sstp`/`labfee` · harga per cawangan | Kad kadar per cawangan · papan invois |
| **4** | **Administration** (#12) | Tukar peranan dari UI | Peranan berbilang · `medicalno` · `sintro` · `commlevel` | Editor peranan berbilang tanda |
| **5** | **Operations + Marketing** (#8, #9) | Buang 3 bahagian tak perlu | Treatment room · duty roster · voucher · referral | Papan operasi · kad voucher |
| **6** | **Inventori + Cukai + OSH** (#13–16) | — | Semua (modul baharu) | Kad stok luput · panduan setup |

---

## 6. JAWAPAN SATU JADUAL — APA KENA FIX

| Modul | % Sedia | Kerja Utama |
|---|---|---|
| **Clinical** | 62% | **4 skrin** (odontogram, pelan, consent, X-ray) + gigi susu + 3 templat |
| **Patients** | 95% | **Butang Edit** + kad keluarga (ibu bapa/penjaga) |
| **Appointments** | 100% | Purpose + tempoh lalai (auto-blok masa) |
| **Finance** | 29% | **`doctor_id`** + harga katalog + skrin kadar |
| **Bil/Panel** | 35% | Harga panel + jana invois + skrin (0 UI sekarang) |
| **Administration** | 78% | Peranan berbilang + tukar peranan dari UI |
| **Operations** | 72% | Bilik rawatan + duty roster + DOSH |
| **Marketing** | 68% | Voucher + referral clinic/doctor |
| **WhatsApp** | 90% | Tidak perlu — kita sudah lebih baik |
| **AI Manager** | 70% | Tidak perlu — Dr Partner tiada |
| **Settings** | 60% | 4 bahagian (keputusan kau semalam) |
| **Laporan** | 6% | **30 laporan teras** |

---

## 7. HAD RISIKAN

| Perkara | Status |
|---|---|
| Perubahan pada Dr Partner | ❌ **tiada** — read-only |
| Halaman dilawati | ~45 daripada ~230 |
| Struktur data | Dari **nama medan borang** (bukan skema DB sebenar) |
| Nilai harga | Sel nampak kosong untuk baris yang dilihat |
| Peringkat HQ | Akaun **cawangan** sahaja |
| Ujian simpan | ❌ tidak dilakukan |

> **Nota kejujuran:** `tsetupprice_33` saya tafsir sebagai harga per cawangan kerana
> corak `_N` berulang. Untuk **sahkan**, kena buka satu rawatan dan lihat sama ada
> nilai berbeza antara cawangan. Saya **tidak** ubah apa-apa data — jadi ini tafsiran,
> bukan bukti muktamad. Kalau kau nak pasti, saya boleh banding nilai antara 2 cawangan.
