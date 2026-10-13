# MIGRASI DR PARTNER → MEDINI CRM — LAPORAN SELESAI

**Tarikh:** 2026-10-10
**Sumber:** thedrpartner.com (READ ONLY, GET sahaja — tiada data diubah di Dr Partner)
**Sasaran:** medini_prod (MySQL 8.4)

---

## HASIL AKHIR (disahkan)

| Data | Jumlah dalam Medini | Sumber Dr Partner | Status |
|---|---|---|---|
| **Pasien** | **53.320** | 53.320 | ✅ tepat |
| Pasien `external_ref` unik | 53.320 | — | ✅ tiada pendua |
| **Koleksi (RM)** | **RM 20.555.730,61** | RM 20.555.730,61 | ✅ tepat (2 desimal) |
| Baris sale_records | 338 | 6 cabang × ~61 bulan | ✅ agregat bulanan |
| Katalog rawatan | 24 kod | 24 kod | ✅ Opsi B |
| Ubat | 13 | 13 | ✅ |
| Supplier | 26 | 26 | ✅ |
| Item inventori | 915 (882 material + 33 produk) | 882 + 33 | ✅ |
| Panel | 11 | 8 (DP) + 3 (sedia ada) | ✅ |
| UOM | 5 | 5 | ✅ |
| Kategori rawatan | 17 | 17 | ✅ |
| Tujuan temujanji | 9 | 9 | ✅ |
| Voucher | 1 | 1 | ✅ |
| Senarai rujukan ubat | 17 | 17 | ✅ |

---

## PASIEN PER CABANG

| Cabang Medini | Dr Partner | Pasien |
|---|---|---|
| klinik-pergigian-uda | b12 Klinik Pergigian UDA | 15.344 |
| uda-business-centre | b10 Medini UBC | 14.411 |
| setia-tropika | b8 Setia Tropika | 9.459 |
| sentosa | b5 Sentosa | 7.938 |
| taman-molek | b4 Taman Molek | 4.951 |
| metropoint-kajang | b2 Metropoint Kajang | 1.217 |

---

## PERUBAHAN SKEMA

**Migrasi:** `backend/drizzle-mysql/0035_drpartner_migration.sql`

- `patients`: +16 kolum (race, marital_status, occupation, blood_type, id_type,
  member_no, address, second_address, temperature, vaccine_dose, remark, refer_by,
  tin_no, e_invoice_name, e_invoice_ic_no, preferred_language, external_ref)
- `inv_items`: +5 kolum (supplier_id, external_ref, barcode, expiry_date, reorder_level)
- 9 jadual baharu: `patient_guardians`, `suppliers`, `medicines`, `uoms`,
  `treatment_categories`, `appointment_purposes`, `vouchers`, `medicine_ref_lists`,
  `inventory_categories`
- Longgar: `inv_items.sku` NULLABLE (kod Dr Partner bukan unik)
- Unique baharu: `patients(org_id, external_ref)`, `suppliers(org_id, external_ref)`

---

## JEJAK SILANG (traceability)

Setiap baris boleh dilacak balik ke Dr Partner:
- Pasien: `external_ref = 'DP:PT:<branch>:<id Dr Partner>'`
- Koleksi: `external_ref = 'DP:DP-SALE-<branch>-<YYYYMM>'`, `source_system = 'drpartner'`
- Supplier: `external_ref = 'DP:SUP:<nama>'`
- Inventori: `external_ref = 'DP:MAT:<n>'` / `'DP:PRD:<n>'`

---

## SKRIP (boleh dijalankan semula, idempoten)

| Skrip | Guna |
|---|---|
| `backend/scripts/delete-demo-data.sql` | Buang data demo |
| `backend/scripts/import-drpartner.ts` | Master (panel, ubat, supplier, rujukan) |
| `backend/scripts/import-patients-v2.ts` | 53.320 pasien (batch 500) |
| `backend/scripts/import-sales-v2.ts` | Koleksi bulanan |
| `backend/scripts/import-inventory-v3.ts` | 915 item + 26 supplier |
| `backend/scripts/import-catalog-v2.ts` | 24 kod katalog |

**Backup:** `backups/medini_prod_pre-drpartner_20261010_231900.sql`

---

## HAD & PERKARA BELUM SELESAI (jujur)

1. **Koleksi ialah AGREGAT BULANAN**, bukan tiket individu. Jumlah RM tepat, tetapi
   tiada detail per-transaksi (siapa bayar berapa, cara bayar apa, doktor mana).
   Data tersebut masih ada dalam sistem Dr Partner dan boleh ditarik jika perlu.
2. **Harga katalog TIDAK diisi** — katalog Dr Partner kosong (0.00). Menunggu harga
   sebenar daripada bos. JANGAN reka nombor.
3. **Appointment, encounter, clinical** — tiada dalam Dr Partner (sistem itu simpan
   sejarah berbeza). Tidak dimigrasi.
4. **8 cabang Medini tanpa data Dr Partner** dibiarkan kosong (keputusan pemilik):
   Gelang Patah, Taman Daya, Pasir Gudang, Bukit Indah, Mutiara Mas, Meor Ahmad,
   Pearl, Norfaizah.
5. **8 pasien tiada nama** dalam sumber (ditanda `(TIADA NAMA) <id>`).
6. **Ubat/ubat klinikal** (dos, peringatan) hanya disimpan sebagai nama + kategori;
   medan lanjut (alert, meal, dosage) belum diisi.

---

## PERBEZAAN DITEMUI vs RISET LAMA REPO

Riset lama (`docs/DRPARTNER-SENARAI-IMPORT.json`) mencatat angka yang tidak tepat:

| Perkara | Riset lama | Sebenar |
|---|---|---|
| Ubat | 14 | **13** |
| Supplier | 27 | **26** (1 pendua: MR BUR ×2) |
| Material | 669 | **882** |
| Produk | 25 | **33** |
| Panel | 10 | **9** (AIA tidak ada dalam data b8) |
| Tarikh mula data | 2022-12 | **berbeza tiap cabang** (b10 sejak 2015) |
