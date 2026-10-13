-- 0017_fasa1a_recall_templates.sql
-- Seed 4 recall templates for each branch (1/3/6/12 bulan)

-- Template untuk 1 bulan (braces, follow-up pendek)
INSERT INTO wa_templates (id, org_id, branch_id, name, body, category, active, created_at, updated_at)
SELECT
  UUID() as id,
  b.org_id,
  b.id as branch_id,
  'Recall 1 Bulan' as name,
  CONCAT('Hi {nama}, salam dari Klinik Medini {cawangan}.

Rekod kami menunjukkan rawatan {rawatan} terakhir anda pada {tarikh}. Sudah 1 bulan sejak lawatan terakhir anda.

{ayat_peribadi}

Klik untuk booking: {link}
Balas STOP untuk berhenti menerima mesej.') as body,
  'recall' as category,
  1 as active,
  NOW(6) as created_at,
  NOW(6) as updated_at
FROM branches b
WHERE b.deleted_at IS NULL
AND NOT EXISTS (
  SELECT 1 FROM wa_templates t
  WHERE t.branch_id = b.id AND t.name = 'Recall 1 Bulan' AND t.deleted_at IS NULL
);

-- Template untuk 3 bulan (extraction, root canal)
INSERT INTO wa_templates (id, org_id, branch_id, name, body, category, active, created_at, updated_at)
SELECT
  UUID() as id,
  b.org_id,
  b.id as branch_id,
  'Recall 3 Bulan' as name,
  CONCAT('Hi {nama}, salam dari Klinik Medini {cawangan}.

Rekod kami menunjukkan rawatan {rawatan} terakhir anda pada {tarikh}. Sudah 3 bulan sejak lawatan terakhir anda.

{ayat_peribadi}

Klik untuk booking: {link}
Balas STOP untuk berhenti menerima mesej.') as body,
  'recall' as category,
  1 as active,
  NOW(6) as created_at,
  NOW(6) as updated_at
FROM branches b
WHERE b.deleted_at IS NULL
AND NOT EXISTS (
  SELECT 1 FROM wa_templates t
  WHERE t.branch_id = b.id AND t.name = 'Recall 3 Bulan' AND t.deleted_at IS NULL
);

-- Template untuk 6 bulan (scaling, check-up, filling)
INSERT INTO wa_templates (id, org_id, branch_id, name, body, category, active, created_at, updated_at)
SELECT
  UUID() as id,
  b.org_id,
  b.id as branch_id,
  'Recall 6 Bulan' as name,
  CONCAT('Hi {nama}, salam dari Klinik Medini {cawangan}.

Rekod kami menunjukkan rawatan {rawatan} terakhir anda pada {tarikh}. Sudah 6 bulan sejak lawatan terakhir anda.

{ayat_peribadi}

Klik untuk booking: {link}
Balas STOP untuk berhenti menerima mesej.') as body,
  'recall' as category,
  1 as active,
  NOW(6) as created_at,
  NOW(6) as updated_at
FROM branches b
WHERE b.deleted_at IS NULL
AND NOT EXISTS (
  SELECT 1 FROM wa_templates t
  WHERE t.branch_id = b.id AND t.name = 'Recall 6 Bulan' AND t.deleted_at IS NULL
);

-- Template untuk 12 bulan (long overdue)
INSERT INTO wa_templates (id, org_id, branch_id, name, body, category, active, created_at, updated_at)
SELECT
  UUID() as id,
  b.org_id,
  b.id as branch_id,
  'Recall 12 Bulan' as name,
  CONCAT('Hi {nama}, salam dari Klinik Medini {cawangan}.

Kami perasan anda sudah 12 bulan tidak mengunjungi klinik kami. Kesihatan gigi anda penting bagi kami.

{ayat_peribadi}

Klik untuk booking: {link}
Balas STOP untuk berhenti menerima mesej.') as body,
  'recall' as category,
  1 as active,
  NOW(6) as created_at,
  NOW(6) as updated_at
FROM branches b
WHERE b.deleted_at IS NULL
AND NOT EXISTS (
  SELECT 1 FROM wa_templates t
  WHERE t.branch_id = b.id AND t.name = 'Recall 12 Bulan' AND t.deleted_at IS NULL
);
