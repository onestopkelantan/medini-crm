# PELAN FASA FIX MEDINI CRM — IKUT DATA DR PARTNER
# Fasa 1 = masuk data/modul sama macam Dr Partner
# List A = apa yang MEDINI DAH ADA (fix)  ·  List B = BELUM ADA (tambah kemudian)

fasa = [
    # (fasa, nama, kumpulan modul, senarai "dah ada", senarai "belum ada", hari)
    (1, "Clinical Penuh", "Clinical",
     ["29 endpoint backend", "SOAP (S/O/A/P)", "notes + sign", "notes + amend (pindaan)",
      "17 jadual klinikal", "7 fail domain (gates)", "consent_records + templates",
      "treatment_plans + items + sessions", "prescriptions", "referrals", "adverse_events",
      "imaging_records (jadual+controller)", "tooth_records (fdiNo/condition/surfaces)",
      "FDI kekal 11-48", "7 keadaan gigi", "encounters + allergy acknowledge",
      "safety-gate.ts", "consent-gate.ts", "plan-lifecycle.ts", "5 tab UI sedia"],
     ["Odontogram visual (0 UI)", "Gigi susu 5x-8x", "Jadual alahan sebenar",
      "MC form", "Time-off form", "PDPA form", "Simbol carta boleh-konfig (chartname)",
      "Skrin pelan rawatan (0 UI)", "Skrin consent (0 UI)", "Skrin X-ray (0 UI)",
      "Tanda xrayind pada rawatan", "Laporan klinikal (6)"],
     6),

    (2, "Patients + Appointments", "Patients / Appointments",
     ["patients 20 kolum", "7 endpoint pesakit", "patient_relationships", "patient_timeline",
      "patients: create + list + 360", "appointments 17 endpoint", "slot finder (Fasa 6A)",
      "reschedule", "status flow", "doctor_schedules + holidays", "booking_requests (resit AI)"],
     ["Butang EDIT pesakit (PATCH ada, UI tak panggil)", "Patient360 penuh (93 baris)",
      "Ibu bapa vs penjaga (2 set medan)", "No. pendaftaran (sbrno)", "Sumber pesakit",
      "Appointment purpose + tempoh lalai", "Appointment procedure"],
     3),

    (3, "Finance + Bil Panel", "Finance / Bil",
     ["treatment_costs 16 kolum", "treatment_catalog 12 rawatan", "commission_ledger + payouts",
      "sale_records + source_system", "expense_categories (6 EP)", "payment_methods (6 EP)",
      "finance_alert_rules (6 EP)", "lab_payables", "reconciliation (Bukku)",
      "panel_companies (3)", "insurance_companies", "payors 12 endpoint"],
     ["doctor_id pada treatment_costs", "Harga pada treatment_catalog",
      "price / price2 / pricep(panel) / cost / sstp", "Harga per cawangan",
      "labfee (tolak dari komisen)", "Skrin doktor isi rawatan+harga",
      "Skrin manager sahkan + rekod bayaran", "paid_amount / outstanding / status",
      "quoted_amount + quoted_at", "Komisen 3 tingkat (L1/2/L3)",
      "Skrin panel/insurans (0 UI)", "Jana invois panel bulanan", "Tanda tiada rekod bayaran"],
     7),

    (4, "Administration + Staf", "Administration",
     ["administration 14 endpoint", "peranan berversi (role_assignments)",
      "last-HQ protection", "self-protection", "branch rule", "invite + link",
      "approve/reject/deactivate", "6 fail ujian"],
     ["Satu staf = banyak peranan (doctor+branchadmin+frontdesk+dispensing)",
      "medicalno (MMC/MDC)", "sintro (kepakaran)", "commlevel / acommlevel",
      "Tukar peranan dari UI (EP ada)", "Suspend dari UI", "Sejarah peranan dari UI",
      "PATCH /admin/staff/:id (edit nama)"],
     3),

    (5, "Operations + Marketing", "Operations / Marketing",
     ["operations 14 EP + 5 jadual", "tasks/checklists/incidents/doctor_statuses",
      "lab_cases (12 kolum)", "marketing 25 EP", "campaigns + leads + follow_up + recall",
      "wa_templates", "marketing_segments"],
     ["Treatment room (bilik rawatan)", "Duty roster staf", "Machine/Equipment + DOSH",
      "Voucher (% / $)", "Referral clinic", "Referral doctor + komisen perujuk",
      "Package setup (paket rawatan)"],
     5),

    (6, "Laporan", "Reports",
     ["6 endpoint laporan", "kpi_definitions", "report_audit", "revenue-trend chart (SVG)"],
     ["UI laporan (129 baris sahaja)", "30 laporan teras", "Carian + kegemaran laporan"],
     5),
]

# Modul BAHARU (tiada langsung dalam Medini)
modul_baharu = [
    ("Inventori — ubat", ["Ubat + 16 medan", "Batch + tarikh luput", "Kos/unit",
                          "maxdose/alert/controlleditem", "Pelarasan stok", "Baki stok"], 10),
    ("Inventori — produk/bahan", ["Produk (UOM, harga)", "Bahan", "Kategori",
                                  "Supplier", "Pengeluar", "PO + terimaan + transfer"], 8),
    ("Wang pesakit", ["Prepaid credit (kadar+luput)", "Deposit + refund", "Voucher",
                      "POS penuh", "Credit memo"], 6),
    ("Cukai + e-Invoice", ["Kod klasifikasi LHDN", "SST local/foreigner",
                           "Tax setup per cawangan", "Laporan SST"], 5),
    ("OSH / DOSH", ["Daftar alat", "Jadual pemeriksaan", "Peringatan dashboard"], 3),
    ("Cuti staf", ["Permohonan cuti", "Baki cuti", "Laporan"], 3),
]

J = 1
print("=" * 100)
print("BAHAGIAN A — FASA FIX DENGAN APA YANG DAH ADA  (Fasa 1–6)")
print("=" * 100)
print(f"{'Fasa':<6}{'Nama':<26}{'Dah ada (FIX)':<17}{'Belum ada (TAMBAH)':<21}{'Hari':<6}")
print("-" * 100)
tot_fix = tot_new = tot_hari = 0
for f, nama, kump, ada, belum, hari in fasa:
    tot_fix += len(ada); tot_new += len(belum); tot_hari += hari
    print(f"{f:<6}{nama:<26}{len(ada):<17}{len(belum):<21}{hari:<6}")
print("-" * 100)
print(f"{'':<6}{'JUMLAH':<26}{tot_fix:<17}{tot_new:<21}{tot_hari:<6}")

print()
print("=" * 100)
print("BAHAGIAN B — MODUL BAHARU (tiada langsung dalam Medini, tambah kemudian)")
print("=" * 100)
print(f"{'Modul':<28}{'Bilangan komponen':<20}{'Hari':<6}")
print("-" * 100)
tot_h2 = 0
for nama, item, hari in modul_baharu:
    tot_h2 += hari
    print(f"{nama:<28}{len(item):<20}{hari:<6}")
print("-" * 100)
print(f"{'JUMLAH':<28}{'':<20}{tot_h2:<6}")

print()
print("=" * 100)
grand = tot_hari + tot_h2
print(f"Fasa (fix + tambah dlm modul sedia ada) : {tot_hari} hari")
print(f"Modul baharu                            : {tot_h2} hari")
print(f"JUMLAH KESELURUHAN                      : {grand} hari (~{grand/5:.1f} minggu bekerja)")
print("=" * 100)

print()
print("FASA 1 SAHAJA (yang Bos nak mula):")
f1 = fasa[0]
print(f"  Modul      : {f1[2]}")
print(f"  DAH ADA    : {len(f1[3])} komponen")
for x in f1[3]: print(f"      • {x}")
print(f"  BELUM ADA  : {len(f1[4])} item")
for x in f1[4]: print(f"      • {x}")
print(f"  Masa       : ~{f1[5]} hari")
