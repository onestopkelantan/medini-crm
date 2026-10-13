# LAPORAN KAJIAN — Dr Partner (thedrpartner.com)
**Tarikh:** 24 Sep 2026 · **Akses:** aicrm@gmail.com → Medini Dental Group → **Setia Tropika**
**Skop:** kajian read-only (tiada apa-apa diubah, tiada data dimasukkan/dipadam)
**Kaedah:** masuk guna akaun sedia ada, buka ~35 halaman, kutip borang + lajur + data contoh

---

## 0. JAWAPAN RINGKAS

> **YA — ini ERP pergigian yang lengkap**, bukan sekadar CRM.
> Ia lebih tepat dipanggil **PMS (Practice Management System) + ERP + Billing**.
>
> Saya kira **12 kumpulan modul utama**, ~230 item menu, dan **100+ laporan**.
> Cakupannya **jauh lebih luas** daripada Medini CRM sekarang — terutamanya dalam
> **inventori (3 peringkat dengan batch + luput), percukaian (SST + e-Invoice LHDN),
> komisen berperingkat, dan pelaporan**.

**Satu penemuan yang terus menjawab soalan lama kita:** Dr Partner **letak harga dalam
master rawatan** (`Price`, `Price 2`, `Panel price`, `Cost`, `Tax %`, `Local SST %`,
`Foreigner SST`). Jadi soalan "senarai harga rasmi di mana" — dalam industri, ia
**memang dalam master rawatan**, bukan dalam rekod setiap pesakit.

---

## 1. BUKTI AKSES

| Perkara | Nilai |
|---|---|
| Login | `drlogin.php` → `drchooseclinic.php` → `staffboardgadmin.php` |
| Pilih group | **Medini Dental Group** (value `41`) |
| Pilih cawangan | **Setia Tropika** (value `8`) |
| Peranan dikesan | **Branch admin** — menu penuh *Setting* + *Transaction* + *Reports* |
| Cawangan tersedia | 6 sahaja: Metropoint (Kajang), Taman Molek, Sentosa, **Setia Tropika**, UBC, UDA |
| Teknologi | PHP 7.2.34 · Apache 2.4.66 · jQuery + Foundation (lama, klasik) |
| Bahasa | **4** — English, BM, 简体中文, 繁体中文 |
| Kuota storan | `File storage: 0.0288GB / 2GB` (had 2GB per cawangan) |

> ⚠️ **Perhatian:** akaun ini nampak **cawangan sahaja**, bukan HQ. Jadi mungkin ada
> menu HQ yang saya tak nampak (contoh: tetapan seluruh grup, pakej multi-cawangan).

---

## 2. 12 KUMPULAN MODUL

| # | Modul | Bukti |
|---|---|---|
| **1** | **CRM / Pesakit** | Patient, Patient status, Reactivate, timeline, contact listing, patient source, birthday, callback reminder, follow-up |
| **2** | **Temujanji + Barisan (Queue)** | Appointment, **Queue** (Call queue, Time in, Complain, Doctor), appointment roster per hari, purpose/procedure setup |
| **3** | **Klinikal (SOAP + carta gigi)** | SOAP option setup (S/O/A/P), **Dental chart symbol**, **Xray**, consent/MC/time-off/PDPA forms, case note history |
| **4** | **Inventori — 3 peringkat** | Medicine · Product · Material — setiap satu ada **stock in / adjustment / internal use**, UOM, supplier, manufacturer, **PO**, internal transfer |
| **5** | **Farmasi (ubat)** | Grade, Attribute, **Alert**, Meal, Usage, Dosage, Category, **Medi formula**, Medicine group |
| **6** | **Bil / Panel / Insurans** | Generate invoice (daily/monthly/void), Payment received, Outstanding, Unpaid, **POS** |
| **7** | **Kewangan khas** | **Prepaid credit** (beli/guna/luput), **Deposit** (balance/refund), **Voucher**, refund, credit memo, void receipt |
| **8** | **Cukai + e-Invoice** | **Tax setup**, **Classification code (eInvoice)** pada rawatan & produk, **e-Invoice staff**, laporan **SST** (local/foreigner) |
| **9** | **Komisen** | Doctor treatment L1/2/3, Doctor medicine L1/2/3, Assistant L1/2/3, Product L1/2/3, **Deduct xray**, **Deduct lab fee** |
| **10** | **HR + Staf** | Staff type, branch staff (doctor/front desk/management), duty roster, **staff leave**, MMC/MDC no, Specialty |
| **11** | **Keselamatan Kerja (OSH/DOSH)** | Machine/Equipment register (serial no, manufacturer, brand), **Inspection record**, **reminder tarikh pemeriksaan seterusnya** |
| **12** | **Pemasaran + Pelaporan** | WhatsApp template + **WhatsApp campaign**, referral clinic/doctor, **100+ laporan** |

---

## 3. BUKTI MENDALAM — 5 MODUL YANG MEDINI TAK ADA

### 3.1 Inventori sebenar (bukan sekadar senarai)

Ini yang paling mengagumkan. Bukan inventori main-main:

```
Medicine stock in
  ┌───────────────────────────────────────────────┐
  │ Medicine · Expiry date · Batch no. ·          │
  │ Quantity · Cost/unit                          │
  │ Invoice no · Supplier · Shipment fee ·        │
  │ Invoice discount · Discount remark            │
  └───────────────────────────────────────────────┘
  [Select medicine]  [Finish and save]

Balance (data sebenar dalam sistem):
  Invoice            Medicine          Batch        Luput        Baki
  AMOXY22/9/2026-SU  AMOXY 500mg       MST 1234     2029-02-02   485.00
  MP26062191         ARCOXIA 120MG     2605003475   2029-01-31    22.00
  1234               IBUFERN 400MG     1234         2028-02-28    92.00
  MP26012782-TASHA   IBUFERN 400MG     40800326     2029-04-01   246.00

Laporan: Medicine balance → Stock no · Invoice · Batch · Luput ·
         Baki · Tarikh masuk · Kos/unit · Jumlah kos
         [Print] [Save PDF] [Download Excel]
```

**Maksudnya:** setiap ubat ada **nombor batch + tarikh luput**, dan kos dikira per batch.
Ini **FEFO/lot tracking** sebenar — keperluan klinikal dan farmasi, bukan ciri tambahan.

**Data sebenar yang saya nampak:**

| Jenis | Contoh sebenar |
|---|---|
| Ubat | AMOXY 250MG, AMOXY 500mg, AUGMENTIN 625MG, METRO 400MG, ARCOXIA 120MG, IBUFERN 400MG, SYRUP AMOXY 250MG |
| Produk | COLGATE ANTICAVITY, COLGATE FLOSS, COLGATE MINION |
| Kategori ubat | ANTIBIOTIC · BENGKAK · **PAINKILLER** |
| UOM | PCS · BOTTLE · BOX · UNIT · CARTON |
| Supplier | APEX PHARMACY · AZYM SYNERGY · DENTOPIA · EVEREST DENTAL SUPPLY · ACME MD GLOBAL |
| Panel | AIA · E-MAS · HealthMetrics · MBJB |
| Staf | WANI (Mgmt) · SUHAIDA (Front desk) · SU (STOCK) · NUR NATASHA (Front desk) · NUR CS |

> **Perhatikan `SU (STOCK)`** — ada satu orang khusus jawatan stok. Sistem ini
> direka untuk klinik yang **ada kerja inventori sepenuh masa**.

### 3.2 Cukai + e-Invoice (keperluan Malaysia)

Kedua-dua **rawatan** dan **produk** ada lajur:

```
Category | Classification code (eInvoice) | Treatment | Xray |
Keyboard letter | Item code | Price | Price 2 | Panel price | Cost |
Tax % | Local SST % | Foreigner SST | Dental chart symbol
```

- **Classification code (eInvoice)** = pemetaan kod **LHDN MyInvois**
- **Local SST %** vs **Foreigner SST** — **kadar cukai berbeza untuk warga asing**
- **Tax setup** per cawangan
- Laporan: Daily/Monthly SST, Daily/Monthly SST CN

**Ini pematuhan Malaysia yang serius.** Bukan tambahan hujung.

### 3.3 Komisen berperingkat (bukan satu kadar)

```
Deduct xray                     [Yes] [No]
Deduct lab fee                  [Yes] [No]
Doctor treatment commission     Level 1 | Level 2 | Level 3
Doctor medicine commission      Level 1 | Level 2 | Level 3
Assistant treatment commission  Level 1 | Level 2 | Level 3
Product commission              Level 1 | Level 2 | Level 3
```

Dan pada setiap staf: **Commission level (0–3)** + **Assist Comm level (0–3)**.
Ada laporan **Commission calculate** dan **Monthly staff commission**.

> Ini menjawab soalan lama: Dr Partner **tolak kos x-ray dan lab dari asas komisen**,
> dan guna **3 peringkat** (doktor junior/senior/pegawai). Medini simpan satu kadar sahaja.

### 3.4 Prepaid credit, deposit, voucher (3 sistem wang yang berasingan)

| Sistem | Bukti |
|---|---|
| **Prepaid credit** | `Usage of $1 = 1 credit` → kadar tukar boleh ubah. Beli / guna / **luput**. Dashboard HQ tunjuk **amaran kredit hampir luput** |
| **Deposit** | Balance report, refund, void refund — deposit pesakit dijejak berasingan |
| **Voucher** | Contoh sebenar: **`GOOGLE REVIEW` → diskaun 10%** — insentif minta ulasan |
| **POS** | Barcode · Product items · Qty · Unit price · **Discount %** · Tax % · Total — daftar runcit |

> `GOOGLE REVIEW` 10% tu kecil tapi bermakna: sistem ini **menyambung pemasaran dengan kutipan**.

### 3.5 Kepatuhan keselamatan kerja (OSH/DOSH) — tak disangka dalam sistem pergigian

```
Machine / Equipment: STRAIGHT HANDPIECE
  Manufacturer: WISEDENT - SHENZHEN · Brand: WISEDENT · Serial: SSB25F11002
DOSH inspection reminder (muncul di dashboard HQ)
  Machine/Equipment | Manufacturer | Brand | Serial no | Next inspection date
```

Peralatan klinikal ada **daftar + jadual pemeriksaan**, dan tarikh pemeriksaan
**berikutnya** keluar sebagai peringatan pada dashboard. Ini keperluan DOSH Malaysia.

---

## 4. SENARAI PENUH MODUL (daripada menu sebenar)

<details>
<summary><b>Setting</b> (klik untuk buka)</summary>

- **Master setup** — Referral clinic · Referral doctor · Staff type
- **Treatment** — Category · Treatment · Package · Panel company · Insurance company · Payment mode · Know about clinic
- **Custom forms** — Consent · MC · Time off · PDPA · Treatment room · Voucher · Frontdesk message · Appointment purpose · Appointment procedure
- **SOAP option** — Subjective · Objective · Diagnosis · Treatment Plan
- **Inventory** — UOM · Supplier · Manufacturer · Purchase order · Internal transfer
- **Medicine** — Grade · Attribute · Alert · Meal · Usage · Dosage · Category · Medicine · Medi formula · Group
- **Product** — Category · Product
- **Material** — Category · Material
- **Transaksi** — Medicine/Product/Material: stock in · adjustment · internal use
- **OSH** — Machine/Equipment · Inspection record
- **Kewangan** — Credit setup · Tax setup
- **Klinik** — Clinic details · Clinic logo · Appointment roster · Clinic holiday
- **Keselamatan** — System setting · Appointment interface · **Commission setup**
- **Staf** — Branch staff · e-Invoice staff
- **WhatsApp** — Message template · Campaign setup
- **Lain** — Change password · File storage · Switch language (4)

</details>

<details>
<summary><b>Transaction</b></summary>

- **Staf** — Staff leave · Commission calculate
- **Temujanji** — Appointment · Queue
- **Pesakit** — Patient · Reactivate patient
- **Kutipan** — Payment · Void payment · Refund payment · Outstanding invoice · Unpaid invoice
- **Panel** — Monthly/Daily invoice · Void invoice · Payment received
- **Insurans** — Generate invoice · Void invoice · Payment received
- **POS** — POS transaction · Void POS transaction
- **Lain** — Incident report · Death report

</details>

<details>
<summary><b>Reports</b> — 100+ laporan, 12 sub-kumpulan</summary>

1. **Patient** — Daily/Monthly/Yearly visit · summary · statistics
2. **Various** — MC · Time off · XRAY · Lab · Medicine usage
3. **Profil pesakit** — profile · contact listing · appointment timeline
4. **Suggested treatment** — Daily · Monthly
5. **No-show** — Monthly · Yearly
6. **Pesakit baharu** — Monthly · Yearly
7. **Pelancongan** — Daily/Monthly report · Daily/Monthly/Yearly summary *(dental tourism)*
8. **Sumber pesakit** — Monthly patient source
9. **Susulan** — Callback reminder · Birthday listing · Follow-up
10. **Kes klinikal** — Patient case note history · Monthly
11. **Prepaid credit** — Purchase · Utilise · Expired
12. **Klinik** — Holiday · Staff leave · Commission · OSH · Incident · Death
13. **Transaksi** — Outstanding
14. **Pakej** — Monthly usage · Active package
15. **Statistik** — Doctor treatment (monthly/yearly) · Treatment (daily/monthly/yearly) · Medicine · Voucher · Account
16. **Rawatan** — Daily · Monthly · Invoice
17. **Kutipan** — Treatment/Medicine/Product/Payment (daily/monthly) · Payment type (termasuk **per doktor**) · **SST** · Treatment & collection
18. **Deposit** · **Refund** · **Credit memo** · **POS** · **Panel** · **Insurans**
19. **Inventori** — PO (daily/monthly/received/void) · Medicine/Product/Material balance · invoice · movement
20. **Pemasaran** — Semua senarai pesakit · lawatan terakhir · rawatan terakhir · yearly treatment
21. **Carta** — Yearly collection · Monthly/Yearly doctor collection
22. **Panduan pengguna** — e-Invoice · SO · Appt · Balance · POS · Daily patient · Daily collection

</details>

---

## 5. JAWAPAN: ERP LENGKAP?

| Kriteria ERP | Dr Partner | Bukti |
|---|---|---|
| **CRM** | ⚠️ **Sebahagian** | Ada pesakit, temujanji, queue, WhatsApp, susulan — tetapi ini **PMS**, bukan CRM saluran jualan. Tiada pipeline/lead scoring |
| **Inventori** | ✅ **PENUH** | 3 peringkat × 3 transaksi + batch + luput + PO + supplier |
| **Bil & kutipan** | ✅ **PENUH** | Panel + insurans + POS + deposit + prepaid + voucher + refund |
| **Perakaunan / cukai** | ✅ **PENUH** | SST local/foreigner · e-Invoice LHDN · credit memo · void |
| **Gaji / komisen** | ✅ **Ada** | Komisen 3 tingkat × 4 jenis · cuti staf · calculate |
| **HR** | ⚠️ **Asas** | Jenis staf · roster · MMC/MDC · kepakaran. Tiada payroll penuh |
| **Klinikal** | ✅ **Ada** | SOAP · carta gigi · x-ray · consent/PDPA/MC |
| **Kepatuhan** | ✅ **Ada** | DOSH/OSH · PDPA · SST · e-Invoice |
| **Multi-cawangan** | ✅ **Ada** | Pilih grup → cawangan; cukai/komisen/kredit/roster/logi **per cawangan** |
| **Pelaporan** | ✅ **Sangat kuat** | 100+ laporan, eksport Excel/PDF |
| **Multi-bahasa** | ✅ **4 bahasa** | EN · BM · 简体 · 繁體 |

> **Verdict: YA, ERP pergigian yang lengkap dan matang.**
> Kekuatannya: **kewangan + inventori + cukai + pelaporan**.
> Kelemahannya: **CRM sebenar** (pemasaran/lead) nipis, dan **teknologi lama**
> (PHP 7.2 + jQuery, storan 2GB/cawangan — had seni bina 2010-an).

---

## 6. MEDINI vs DR PARTNER — apa kita ada, apa kita tiada

| Keupayaan | Medini CRM | Dr Partner | Jurang |
|---|---|---|---|
| Pesakit + temujanji | ✅ | ✅ | **Setanding** |
| Queue / barisan | ✅ ada | ✅ | Setanding |
| AI WhatsApp | ✅ **lebih baik** (AI auto-book) | ⚠️ templat + kempen sahaja | **Kita lebih maju** |
| Dwibahasa | ✅ BM/BI | ✅ 4 bahasa | Kita cukup |
| **Harga rawatan** | ❌ tiada kolum harga | ✅ Price/Price 2/Panel/Cost/Tax/SST | **KITA KETINGGALAN** |
| **Inventori (batch+luput)** | ❌ | ✅ 3 peringkat penuh | **KITA TIADA** |
| **e-Invoice LHDN** | ❌ | ✅ classification code | **KITA TIADA** |
| **SST local/foreigner** | ❌ | ✅ | **KITA TIADA** |
| **Komisen 3 tingkat** | ⚠️ ada jadual, buta sumber | ✅ L1/2/3 × 4 jenis | **KITA TIADA** |
| **Prepaid credit / deposit / voucher** | ❌ | ✅ 3 sistem | **KITA TIADA** |
| **POS runcit** | ⚠️ `sale_records` | ✅ POS penuh + void | Kita asas sahaja |
| **OSH/DOSH alat** | ❌ | ✅ daftar + jadual | **KITA TIADA** |
| **Laporan** | 6 endpoint | **100+ laporan** | **JURANG BESAR** |
| **PDPA/consent/MC forms** | ✅ consent templates | ✅ | Setanding |
| **Paket rawatan** | ❌ | ✅ + laporan penggunaan | **KITA TIADA** |
| **Referral (clinic/doctor)** | ⚠️ leads | ✅ + komisen perujuk | Kita asas sahaja |
| **Dental tourism** | ❌ | ✅ laporan penuh | **KITA TIADA** |
| **Dashboard amaran** | ✅ 5 kad nadi | ⚠️ alert sahaja | **Kita lebih baik** |
| **Teknologi** | ✅ React/NestJS/MySQL | ⚠️ PHP 7.2/jQuery | **Kita lebih moden** |

---

## 7. TIGA PENGAJARAN PALING BERNILAI

**① Harga memang duduk dalam master rawatan.**
Saya keliru sebelum ini dengan ADR-004. Industri (termasuk perisian yang Medini sendiri
guna) letak `Price` + `Panel price` + `Cost` dalam **Treatment setup**. Jadi kebimbangan
ADR-004 dan kehendak Bos **boleh didamaikan**: master ada kadar rujukan; rekod pesakit
simpan harga sebenar. Dr Partner buat **kedua-duanya**.

**② Inventori pergigian = batch + luput, bukan bilangan.**
`Batch no` + `Expiry date` + `Cost/unit` per baris. Ini bukan kemewahan — ini
keperluan farmasi dan audit. Medini langsung tiada.

**③ Laporan adalah produk, bukan tambahan.**
100+ laporan merentas setiap modul. Inilah yang buat ERP boleh dijual kepada
**tuan punya** (bukan jururawat). Medini ada **6 endpoint laporan**.

---

## 8. HAD KAJIAN INI (jujur)

| Perkara | Status |
|---|---|
| Halaman dilawati | **~35** daripada ~230 menu |
| Perubahan data | ❌ **TIADA** — read-only sepenuhnya |
| Kedalaman | **Borang + lajur + data contoh**. Saya **tidak** uji aliran simpan/hantar |
| Modul klinikal | Saya **tidak** buka rekod pesakit sebenar (privasi) |
| Peringkat HQ | Akaun ini **cawangan** — menu HQ grup mungkin ada yang tak nampak |
| Harga | Lajur harga **ada**; nilai dalam senarai nampak kosong (mungkin belum diset untuk baris itu) |
| e-Invoice | Ada setup + kod klasifikasi; saya **tidak** sahkan ia benar-benar hantar ke LHDN |

---

## 9. CADANGAN SUSULAN (tidak dibuat — menunggu arahan)

1. **Treatment setup** — buka satu baris untuk lihat medan harga penuh (jawab terus soalan harga)
2. **SOAP + dental chart** — buka halaman rawatan pesakit untuk lihat carta gigi sebenar
3. **Reports** — ambil 2–3 laporan contoh sebagai rujukan reka bentuk
4. **WhatsApp campaign** — bandingkan dengan Fasa 5 Medini
5. **Menú peringkat HQ** — kalau ada akaun HQ, itu yang paling bernilai untuk dibandingkan
