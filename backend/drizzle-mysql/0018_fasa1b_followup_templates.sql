-- 0018_fasa1b_followup_templates.sql
-- Seed 4 follow-up templates for each branch (1/3/7/14 hari)

-- Template untuk 1 hari (extraction, surgery)
INSERT INTO wa_templates (id, org_id, branch_id, name, body, category, active, created_at, updated_at)
SELECT
  UUID() as id,
  b.org_id,
  b.id as branch_id,
  'Follow-up 1 Hari' as name,
  CONCAT('Hi {nama}, salam dari Klinik Medini {cawangan}.

Kami ingin mengetahui keadaan anda selepas {rawatan} semalam. Adakah anda mengalami sebarang kesakitan atau ketidakselesaan?

Balas jika ada masalah — kami sedia membantu.') as body,
  'followup' as category,
  1 as active,
  NOW(6) as created_at,
  NOW(6) as updated_at
FROM branches b
WHERE b.deleted_at IS NULL
AND NOT EXISTS (
  SELECT 1 FROM wa_templates t
  WHERE t.branch_id = b.id AND t.name = 'Follow-up 1 Hari' AND t.deleted_at IS NULL
);

-- Template untuk 3 hari (standard follow-up)
INSERT INTO wa_templates (id, org_id, branch_id, name, body, category, active, created_at, updated_at)
SELECT
  UUID() as id,
  b.org_id,
  b.id as branch_id,
  'Follow-up 3 Hari' as name,
  CONCAT('Hi {nama}, salam dari Klinik Medini {cawangan}.

Bagaimana perasaan anda selepas {rawatan} 3 hari lepas? Kami harap semuanya baik.

Jika ada sebarang masalah atau soalan, sila balas mesej ini.') as body,
  'followup' as category,
  1 as active,
  NOW(6) as created_at,
  NOW(6) as updated_at
FROM branches b
WHERE b.deleted_at IS NULL
AND NOT EXISTS (
  SELECT 1 FROM wa_templates t
  WHERE t.branch_id = b.id AND t.name = 'Follow-up 3 Hari' AND t.deleted_at IS NULL
);

-- Template untuk 7 hari (braces adjustment)
INSERT INTO wa_templates (id, org_id, branch_id, name, body, category, active, created_at, updated_at)
SELECT
  UUID() as id,
  b.org_id,
  b.id as branch_id,
  'Follow-up 7 Hari' as name,
  CONCAT('Hi {nama}, salam dari Klinik Medini {cawangan}.

Sudah seminggu selepas {rawatan}. Bagaimana keadaan anda? Adakah braces atau rawatan terasa selesa?

Balas jika perlu temujanji semula.') as body,
  'followup' as category,
  1 as active,
  NOW(6) as created_at,
  NOW(6) as updated_at
FROM branches b
WHERE b.deleted_at IS NULL
AND NOT EXISTS (
  SELECT 1 FROM wa_templates t
  WHERE t.branch_id = b.id AND t.name = 'Follow-up 7 Hari' AND t.deleted_at IS NULL
);

-- Template untuk 14 hari (post-op check)
INSERT INTO wa_templates (id, org_id, branch_id, name, body, category, active, created_at, updated_at)
SELECT
  UUID() as id,
  b.org_id,
  b.id as branch_id,
  'Follow-up 14 Hari' as name,
  CONCAT('Hi {nama}, salam dari Klinik Medini {cawangan}.

Dua minggu selepas {rawatan}. Kami ingin memastikan pemulihan anda lancar.

Adakah semuanya baik? Balas untuk maklumkan kami.') as body,
  'followup' as category,
  1 as active,
  NOW(6) as created_at,
  NOW(6) as updated_at
FROM branches b
WHERE b.deleted_at IS NULL
AND NOT EXISTS (
  SELECT 1 FROM wa_templates t
  WHERE t.branch_id = b.id AND t.name = 'Follow-up 14 Hari' AND t.deleted_at IS NULL
);
