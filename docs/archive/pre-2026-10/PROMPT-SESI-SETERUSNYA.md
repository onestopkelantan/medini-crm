Sambung kerja Medini CRM. Baca handoff dulu.

**FAIL WAJIB BACA (ikut urutan):**
1. `C:\Users\User\Desktop\medini-updated\HANDOFF-SESI-SETERUSNYA.md` ← mula di sini
2. `FASA-APA-ADA-APA-TAMBAH.md`
3. `RISIKAN-DRPARTNER-12-MODUL.md`

**KEADAAN:** commit `aee7935` · git bersih · `tsc -b` 0 ralat · ujian backend 616/616 lulus.
Docker MATI — hidupkan dulu: `docker compose -f docker-compose.prod.yml -f docker-compose.override.yml up -d`

**KERJA: MULA FASA 1 (Clinical, ~6 hari)**

Clinical kita ada **29 endpoint** tetapi UI cuma panggil **6**. Jadi 4 item tinggal ialah
SKRIN yang perlu disambung ke endpoint yang SUDAH ADA:
- Odontogram visual (`tooth_records` sedia) ← draf mockup dulu
- Skrin pelan rawatan (8 EP sedia)
- Skrin consent (5 EP sedia)
- Skrin X-ray (controller sedia)

Dan 8 item kecil: gigi susu 5x–8x (`fdi.ts`) · jadual alahan · MC · time-off · PDPA ·
`chartname` · tanda `xrayind` · laporan klinikal (Fasa 6)

**LANGKAH PERTAMA (ikut urutan):**
1. Hidupkan Docker, sahkan stack
2. `cd app && npx tsc -b --force` → mesti 0 ralat. `bash audit-i18n.sh` → mesti bersih
3. **Sahkan harga per cawangan Dr Partner** (read-only):
   - Login `thedrpartner.com` guna vault handle `vault_b5e496af6540` (JANGAN taip password)
   - Pilih Medini Dental Group → **cuba Pearl atau Sentosa** (bukan Setia Tropika — ia tiada medan `_N`)
   - Semak sama ada `tsetupprice_33`/`_7`/`_15` ada nilai sebenar
   - **Logout** bila siap (`dplogout.php`)
4. **Draf odontogram sebagai mockup HTML** ke `Desktop\medini-ui-screens\draf-odontogram.html`
   - 32 gigi kekal + 20 gigi susu
   - 7 keadaan sedia ada: healthy·decayed·filled·missing·crowned·root_canal·implant
   - Cadangan tambah: impacted·extracted·bridge·denture·veneer·periapical·mobility
   - Buka dengan `cmd.exe /c start "" "<path>"` dan tunjuk
   - **DAPAT KELULUSAN DULU** sebelum bina sebenar

**PERINGATAN TEKNIKAL (jangan ulang silap):**
- **`tsc --noEmit` BOHONG untuk frontend** — `app/tsconfig.json` = `{"files":[], "references":[...]}` → taip-semak 0 fail. **GUNA `tsc -b`**
- `tsc -b` ambil 60–180s — **jangan pipe** ke `head`/`grep`; redirect ke fail dulu (`> "$LOCALAPPDATA/Temp/fe.txt" 2>&1`)
- Ubah UI → **rebuild kontena frontend**, bukan `restart`. Sahkan dengan **banding md5** container vs host
- Betulkan `t` undefined → ikat **per KOMPONEN**, bukan di atas fail. **Jangan** `declare global`/`window.t`
- `organizations` KOSONG — baca `org_id` dari `branches`

**GAYA KERJA (Bos):**
- BM informal (aku/bos), terus, ringkas. **Tables**, bukan esei panjang
- **DRAF dulu** sebelum kod — tunjuk mockup, tunggu setuju
- Jujur bila tak dapat / tak disahkan. **Jangan reka nombor**
- Report dalam 3 seksyen: apa siap · apa disahkan · apa tinggal
- Jangan expose tool noise

**5 SOALAN MASIH TERGANTUNG — tanya bila relevan:**
1. Senarai harga rawatan rasmi di mana? (Fasa 3)
2. e-Invoice: API LHDN sendiri atau melalui Bukku? (Fasa 5)
3. Satu staf banyak peranan perlu? (sekarang 1 peranan sahaja)
4. Halaman `/profil` untuk manager/reception/doktor? (Settings jadi HQ sahaja)
5. Buang Settings dari sidebar manager/admin? (belum siap)
