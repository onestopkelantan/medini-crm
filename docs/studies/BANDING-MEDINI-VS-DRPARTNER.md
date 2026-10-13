# MEDINI CRM vs DR PARTNER — PERBANDINGAN MODUL
**Tarikh:** 24 Sep 2026 · **Kaedah:** baca skema + kod Medini · study 35 halaman Dr Partner (read-only)
**Tujuan:** apa perlu kita tambah supaya CRM **complete siap**

---

## 0. RINGKASAN (3 ayat)

Medini **menang** dalam **AI, teknologi, keselamatan data (RLS), tempahan pintar, dan dashboard nadi**.
Dr Partner **menang** dalam **inventori, cukai/e-Invoice, wang pesakit (prepaid/deposit/voucher), komisen, dan pelaporan (100+)**.
**Clinical kita hampir setanding** — SOAP, FDI, consent gate, safety gate, plans, sessions, prescriptions semuanya ADA. Yang tinggal jurang **kecil tetapi kritikal**: carta gigi **visual**, **gigi susu**, **MC**, **treatment room**, dan **paket**.

**Nombor:** Medini **79 jadual** · Dr Partner **12 kumpulan modul / 100+ laporan**.

---

## 1. JADUAL PERBANDINGAN PENUH — 26 MODUL

**Legenda:** ✅ ada · ⚠️ asas/sebahagian · ❌ tiada

| # | Modul | Medini CRM | Dr Partner | Verdict | Perlu tambah? |
|---|---|---|---|---|---|
| **1** | **Pesakit (CRM)** | ✅ 7 EP · timeline · 360 · hubungan keluarga | ✅ penuh + sumber + ulasan | Setanding | ⚠️ kecil |
| **2** | **Temujanji** | ✅ 17 EP · reschedule · status · slot finder | ✅ + purpose/procedure setup | **Setanding** | ➖ |
| **3** | **Barisan (Queue)** | ✅ | ✅ + "Call queue" · suhu · dos | Setanding | ⚠️ kecil |
| **4** | **Klinikal — SOAP** | ✅ `soapSubjective/Objective/Assessment/Plan` | ✅ + master option setup | **Setanding** | ➖ |
| **5** | **Klinikal — rekod gigi** | ⚠️ `fdiNo` + `condition` + `surfaces` — **hanya gigi kekal (11–48)** | ✅ + simbol carta + **gigi susu** | **KITA KURANG** | 🔴 **YA** |
| **6** | **Odontogram visual** | ❌ **tiada** (`tooth_records` ada, UI tiada) | ✅ | **KITA KURANG** | 🔴 **YA** |
| **7** | **X-ray / imaging** | ⚠️ `imaging_records` (jadual) · **0 fail UI** | ✅ + laporan X-ray bulanan | **KITA KURANG (UI)** | 🔴 **YA** |
| **8** | **Kebenaran (consent)** | ✅ `consent_records` + `templates` + **consent gate** | ✅ | **KITA LEBIH BAIK** | ➖ |
| **9** | **Alahan / amaran** | ⚠️ `allergyAcknowledgedAt` sahaja — **tiada jadual alahan** | ✅ | **KITA KURANG** | 🔴 **YA (keselamatan)** |
| **10** | **Pelan rawatan** | ✅ `treatment_plans` + items + sessions + gate | ✅ | **KITA LEBIH BAIK** | ➖ |
| **11** | **Preskripsi ubat** | ✅ `prescriptions` | ✅ + kaitan inventori | Setanding | 🔗 |
| **12** | **Rujukan (referral)** | ✅ `referrals` + status | ✅ + **komisen perujuk** | Setanding | ⚠️ |
| **13** | **Insiden / kematian** | ⚠️ `adverse_events` (klinikal) + `incidents` (ops) | ✅ laporan harian/bulanan | Setanding | ➖ |
| **14** | **MC (surat sakit)** | ❌ **tiada langsung** | ✅ `mcformsetup` + laporan MC bulanan | **KITA KURANG** | 🟠 **YA** |
| **15** | **Time off / PDPA form** | ⚠️ `pdpa` 2 rujukan sahaja | ✅ kedua-dua | **KITA KURANG** | 🟠 YA |
| **16** | **Bilik rawatan** | ❌ tiada (`room` = perkataan lain dlm kod) | ✅ `roomsetup` | **KITA KURANG** | 🟡 kecil |
| **17** | **Inventori ubat** | ❌ **TIADA LANGSUNG** | ✅ **batch + luput + kos/unit** | **KITA KURANG BESAR** | 🔴 **YA** |
| **18** | **Inventori produk/bahan** | ❌ tiada | ✅ 2 lagi peringkat | **KITA KURANG BESAR** | 🟠 YA |
| **19** | **Supplier / PO / transfer** | ❌ tiada | ✅ penuh | **KITA KURANG** | 🟠 YA |
| **20** | **Bil panel & insurans** | ✅ 12 EP · `panel_companies` · `insurance_companies` | ✅ + jana/hapus invois + terima bayaran | ⚠️ asas | 🔴 **YA** |
| **21** | **POS** | ⚠️ `sale_records` sahaja | ✅ POS penuh + void | **KITA KURANG** | 🟠 YA |
| **22** | **Prepaid credit / Deposit / Voucher** | ❌ ketiga-tiga tiada | ✅ ketiga-tiga | **KITA KURANG** | 🔴 **YA** |
| **23** | **Komisen** | ⚠️ `commission_ledger` + payouts, tapi **buta sumber** (`treatment_costs` tiada `doctor_id`) | ✅ 3 tingkat × 4 jenis + tolak xray/lab | **KITA KURANG** | 🔴 **YA** |
| **24** | **e-Invoice / SST** | ❌ tiada | ✅ kod klasifikasi LHDN + SST local/foreigner | **KITA KURANG** | 🟠 YA |
| **25** | **Paket rawatan** | ❌ tiada | ✅ + laporan penggunaan | **KITA KURANG** | 🟡 |
| **26** | **OSH / DOSH (alat)** | ❌ tiada | ✅ daftar + jadual pemeriksaan | **KITA KURANG** | 🟡 |
| **27** | **Cuti staf** | ❌ tiada | ✅ + laporan | **KITA KURANG** | 🟡 |
| **28** | **AI WhatsApp** | ✅ **auto-book · anti-ban · SLA · prompt** | ⚠️ templat + kempen | **KITA LEBIH BAIK** | ➖ |
| **29** | **Dashboard** | ✅ **5 kad nadi + panel masa-nyata** | ⚠️ 2 alert sahaja | **KITA LEBIH BAIK** | ➖ |
| **30** | **Laporan** | ⚠️ **6 endpoint** · UI 129 baris | ✅ **100+ laporan** | **KITA KURANG BESAR** | 🔴 **YA** |
| **31** | **Keselamatan data** | ✅ **RLS 3 lapisan · audit · role matrix** | ⚠️ peranan PHP biasa | **KITA LEBIH BAIK** | ➖ |
| **32** | **Teknologi** | ✅ **React · NestJS · MySQL** | ⚠️ PHP 7.2 · jQuery | **KITA LEBIH BAIK** | ➖ |
| **33** | **Dwibahasa** | ✅ BM/BI | ✅ 4 bahasa | Setanding | ➖ |
| **34** | **Referral clinic/doctor** | ⚠️ `leads` | ✅ + komisen | ⚠️ asas | 🟡 |

```
KIRAAN:  Kita lebih baik 5  ·  Setanding 9  ·  Kita kurang 20
```

---

## 2. CLINICAL — ANALISIS MENDALAM (yang kau minta)

### 2.1 Apa Clinical kita SUDAH ada (dan bagus)

Saya periksa fail demi fail — Clinical kita **lebih berstruktur** daripada yang nampak:

| Fail domain | Baris | Fungsi |
|---|---|---|
| `soap-sign.ts` | 41 | Tandatangan SOAP + **amendment** (tak boleh ubah, hanya tambah) |
| `safety-gate.ts` | 34 | **Gerbang alahan** — blok penamatkan encounter kalau amaran tak diakui |
| `consent-gate.ts` | 23 | Pelan bertanda consent → **tak boleh terima** tanpa rekod consent |
| `plan-lifecycle.ts` | 43 | `proposed → accepted → activated → completed` |
| `fdi.ts` | 22 | FDI **11–48** (gigi kekal) |
| `encounter-status.ts` | 18 | Aliran status encounter |
| `referral-status.ts` | 23 | Aliran rujukan |

**17 jadual klinikal:**

```
encounters              chiefComplaint · allergyAcknowledgedAt · status
clinical_notes          soapSubjective · soapObjective · soapAssessment · soapPlan
                        signedAt · signedBy · amendsNoteId · supersededByNoteId · version
tooth_records           fdiNo · condition · surfaces
treatment_plans         planCode · title · status · consentRequired · proposedAt/acceptedAt/…
treatment_plan_items    treatmentId · description · toothFdi · quantity · status
treatment_sessions      sessionNo · performedAt · summary
prescriptions           medication · dosage · frequency · durationDays
referrals               toSpecialty · toProvider · reason · status
adverse_events          severity · description · actionTaken
consent_records         templateId · templateVersion · method · consentedBy · witnessedBy
consent_templates       title · body · version · isActive
imaging_records         kind · title · fileRef · takenAt
clinical_timeline_events  type · summary · payload
```

**Kosa kata keadaan gigi kita:** `healthy · decayed · filled · missing · crowned · root_canal · implant` — **7 keadaan**.

### 2.2 Apa Clinical kita KURANG (berbanding Dr Partner)

| # | Jurang | Bukti | Keseriusan |
|---|---|---|---|
| **C1** | **Tiada odontogram visual** | `tooth_records` ada + backend tulis, tetapi **0 fail UI** pakai. `Tooth3D.tsx` cuma ikon hiasan | 🔴 **Kritikal** |
| **C2** | **Gigi susu tiada** | `fdi.ts` kata terang: *"Deciduous (5x–8x) is deliberately out of scope for v1 (documented debt)"*. **Setiap kanak-kanak tak boleh direkod betul** | 🔴 **Kritikal** |
| **C3** | **Tiada jadual alahan** | `safety-gate.ts` sendiri mengaku: *"the locked patients schema carries no allergy/medical-alert column"* — jadi gerbang guna **adverse events** sebagai ganti | 🔴 **Kritikal (keselamatan)** |
| **C4** | **Tiada MC** | Dr Partner ada `mcformsetup` + laporan MC bulanan. Medini **0 padanan** | 🟠 Tinggi |
| **C5** | **Tiada X-ray UI** | `imaging_records` ada, backend ada, **0 fail UI** | 🟠 Tinggi |
| **C6** | **Keadaan gigi kurang** | Kita **7 keadaan**; Dr Partner ada `Dental chart symbol` (lambang boleh dikonfigur) | 🟡 Sederhana |
| **C7** | **Tiada bilik rawatan** | Dr Partner `roomsetup`. Medini tiada → tak boleh jadualkan "chair/room" | 🟡 Sederhana |
| **C8** | **Tiada paket rawatan** | Dr Partner `packagesetup` + laporan penggunaan | 🟡 Sederhana |
| **C9** | **Tiada time-off form** | Dr Partner `toformsetup` | 🟢 Rendah |
| **C10** | **Tiada laporan klinikal** | Dr Partner: kes nota pesakit, MC, X-ray, lab, penggunaan ubat, statistik rawatan | 🟠 Tinggi |

> **Ini yang paling penting tentang Clinical:** ia **bukan** kerja "copy je semua" seperti yang kau sangka.
> Asasnya **sudah ada dan lebih kemas** daripada Dr Partner (tandatangan, amendment, gerbang).
> Yang tinggal ialah **UI** (odontogram, x-ray) dan **3–4 jadual kecil** (alahan, gigi susu, MC, bilik).

---

## 3. JURANG MENGIKUT KESERIUSAN

### 🔴 KRITIKAL — klinik tak boleh jalan dengan betul tanpa ini

| # | Jurang | Sebab kritikal |
|---|---|---|
| **1** | **Odontogram visual** | Doktor gigi **wajib** nampak peta gigi. Data ada, skrin tiada |
| **2** | **Gigi susu (5x–8x)** | **Semua pesakit kanak-kanak** tak boleh direkod dengan betul sekarang |
| **3** | **Jadual alahan** | Keselamatan pesakit — sekarang hanya "tandatangan amaran" tanpa data alahan |
| **4** | **`treatment_costs.doctor_id`** | Tanpa ini: jualan per doktor + komisen **mustahil** |
| **5** | **Harga rawatan (`Price`/`Panel price`)** | Sudah disahkan Dr Partner letak dalam master rawatan. Kita tiada |
| **6** | **Bayaran pesakit (rekod)** | Bil & kutipan — modul wang kita nipis berbanding Dr Partner |
| **7** | **Laporan (6 vs 100+)** | Tuan punya beli ERP **untuk laporan** |

### 🟠 TINGGI — perlu untuk "complete"

Inventori ubat (batch+luput) · Inventori produk/bahan · Supplier/PO · Bil panel penuh ·
POS · Prepaid credit / Deposit / Voucher · Komisen 3 tingkat · e-Invoice + SST ·
MC + time-off + PDPA forms · X-ray UI + laporan

### 🟡 SEDERHANA / RENDAH — elok ada

Bilik rawatan · Paket rawatan · OSH/DOSH alat · Cuti staf · Simbol carta boleh-konfig ·
Referral komisen

---

## 4. CADANGAN URUTAN — supaya CRM "complete siap"

Ikut **kebergantungan**, bukan ikut senang. Setiap fasa boleh disiapkan tanpa tunggu fasa bawah.

### FASA 1 — CLINICAL JADI PENUH *(doktor boleh kerja betul)*
| # | Kerja | Ada apa | Perlu |
|---|---|---|---|
| 1A | **Odontogram visual** | `tooth_records` + backend + 7 keadaan | **UI sahaja** |
| 1B | **Gigi susu** | `fdi.ts` (kekal sahaja) | tambah 5x–8x + ujian |
| 1C | **Jadual alahan** + gerbang betul | `safety-gate.ts` guna adverse events sebagai ganti | jadual baharu + UI |
| 1D | **X-ray UI** | `imaging_records` + backend | **UI sahaja** |
| 1E | **MC / time-off / PDPA** | tiada | 3 templat + UI |
| 1F | **Bilik rawatan** | tiada | 1 jadual + jadualkan |

### FASA 2 — WANG JADI BETUL *(rantaian hasil)*
| # | Kerja |
|---|---|
| 2A | `treatment_costs` + **`doctor_id`** ← blok tunggal |
| 2B | Harga master (`Price` · `Price 2` · **`Panel price`** · `Cost` · `Tax %`) |
| 2C | `+ quoted_amount` · `paid_amount` · `outstanding_amount` · `status` |
| 2D | Skrin doktor isi → manager sahkan → kaunter rekod bayaran |
| 2E | **Komisen 3 tingkat** + tolak kos x-ray/lab |

### FASA 3 — INVENTORI *(yang kita langsung tiada)*
| # | Kerja |
|---|---|
| 3A | Ubat: kategori · UOM · pembekal · pengeluar |
| 3B | **Stok masuk + batch + tarikh luput + kos/unit** |
| 3C | Pelarasan stok · guna dalaman · baki · **amaran hampir luput** |
| 3D | Produk + bahan (2 lagi peringkat) |
| 3E | PO · terimaan · pemindahan dalaman |

### FASA 4 — WANG PESAKIT
**Prepaid credit** (kadar + luput + amaran) · **Deposit** (baki/refund) · **Voucher** · **POS penuh**

### FASA 5 — CUKAI & E-INVOICE
Kod klasifikasi LHDN · **SST local/foreigner** · invois panel jana/hapus/terima bayaran

### FASA 6 — LAPORAN *(produk yang tuan punya beli)*
30+ laporan teras dari 100+ Dr Partner — kutipan, rawatan, doktor, pesakit, inventori

### FASA 7 — SISA
Bilik rawatan · Paket · OSH/DOSH · Cuti staf

---

## 5. YANG **TAK PERLU COPY** dari Dr Partner

Agar kita tak buang masa:

| Jangan copy | Sebab |
|---|---|
| Teknologi PHP/jQuery | Kita **React/NestJS** — lebih moden |
| `dpsetting.php` (tetapan sistem mentah) | Kita ada Settings + settings_definitions (lebih kemas) |
| Menu 100+ laporan **satu-satu** | Banyak bertindih. Bina **30 teras** dulu |
| e-Invoice **penuh** sekarang | Fasa 5 — perlu keputusan sama ada guna API LHDN sendiri atau tengah (Bukku) |
| Chat/MC form **sebagai PDF sahaja** | Kita boleh buat lebih baik (digital + tandatangan) |
| 2GB storan per cawangan | Had lama. Kita guna object storage |
| `SU (STOCK)` sebagai **satu orang** | Kita boleh buat peranan, bukan orang |

---

## 6. RINGKASAN UNTUK KEPUTUSAN

| Ukuran | Nilai |
|---|---|
| Modul dibandingkan | **34** |
| Kita **lebih baik** | **5** — AI WhatsApp, Dashboard, keselamatan data, teknologi, pelan rawatan+consent |
| **Setanding** | **9** — pesakit, temujanji, queue, SOAP, consent, preskripsi, rujukan, insiden, dwibahasa |
| **Kita kurang** | **20** |
| Jurang **kritikal** | **7** |
| Fasa untuk complete | **7 fasa** |

**Dua ayat penutup:**
Clinical kita **bukan** ketinggalan — asasnya **lebih kemas** daripada Dr Partner.
Yang tinggal ialah **4 jadual kecil + 2 skrin** (odontogram, x-ray), dan itu **Fasa 1** sahaja.
Sebab tu **Fasa 1 patut jadi yang pertama** — ia paling murah, paling nampak, dan doktor terus boleh guna.

---

## 7. HAD LAPORAN INI

| Perkara | Status |
|---|---|
| Perubahan pada Dr Partner | ❌ **tiada** — read-only |
| Kedalaman Dr Partner | Borang + lajur + data contoh. **Tidak** uji aliran simpan |
| Rekod pesakit sebenar | **Tidak** dibuka |
| Peringkat HQ Dr Partner | Akaun cawangan sahaja — menu HQ grup mungkin ada |
| Medini | Baca skema + kod, bukan ujian hidup setiap endpoint |
