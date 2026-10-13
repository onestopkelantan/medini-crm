-- ============================================================================
-- 0034 — P6 INVENTORY (Invelli PRD): katalog, bilik, BOM, restock, kiraan
-- mingguan, dan penanda variance. Enjin pengiraan dalam servis; tabel ini
-- menyimpan master data + transaksi + hasil pengiraan yang di-flag.
--
-- PRD Invelli → Medini:
--   Actual Usage = Opening + StockIn − Ending          (Modul C1)
--   Opening(N) = Ending(N−1)                          (C2, carry-forward)
--   Expected Usage = Σ(volum rawatan × kuantiti BOM)  (D2)
--   Variance > ambang → flag                          (D3/D4)
-- Peranan: staf kira (submit), manager luluskan (B7), HQ semua cawangan (E6).
-- ============================================================================

-- 1. Katalog item standard merentas klinik (PRD A1)
CREATE TABLE IF NOT EXISTS `inv_items` (
  `id`          varchar(36)  NOT NULL,
  `org_id`      varchar(36)  NOT NULL,
  `sku`         varchar(64)  NOT NULL,
  `name`        varchar(256) NOT NULL,
  `category`    varchar(128) DEFAULT NULL,
  `unit`        varchar(32)  NOT NULL DEFAULT 'unit',
  `unit_cost`   decimal(19,4) NOT NULL DEFAULT 0,
  `supplier`    varchar(256) DEFAULT NULL,
  `is_active`   tinyint(1)   NOT NULL DEFAULT 1,
  `created_at`  datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_by`  varchar(36)  DEFAULT NULL,
  `updated_at`  datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `updated_by`  varchar(36)  DEFAULT NULL,
  `deleted_at`  datetime(6)  DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `inv_items_org_sku_uq` (`org_id`, `sku`),
  KEY `inv_items_org_idx` (`org_id`),
  KEY `inv_items_name_idx` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Bilik stor / kawasan kiraan per cawangan (PRD A3)
CREATE TABLE IF NOT EXISTS `inv_rooms` (
  `id`          varchar(36)  NOT NULL,
  `org_id`      varchar(36)  NOT NULL,
  `branch_id`   varchar(36)  NOT NULL,
  `code`        varchar(64)  NOT NULL,           -- "kod barkod bilik" PRD (manual/dropdown dulu)
  `name`        varchar(128) NOT NULL,
  `created_at`  datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `deleted_at`  datetime(6)  DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `inv_rooms_branch_code_uq` (`org_id`, `branch_id`, `code`),
  KEY `inv_rooms_branch_idx` (`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Clinical Baseline / BOM: item standard mengikut jenis rawatan (PRD A2)
CREATE TABLE IF NOT EXISTS `inv_bom` (
  `id`               varchar(36)  NOT NULL,
  `org_id`           varchar(36)  NOT NULL,
  `treatment_type`   varchar(128) NOT NULL,      -- padan kategori treatment_catalog
  `item_id`          varchar(36)  NOT NULL,
  `qty_per_case`     decimal(12,4) NOT NULL DEFAULT 1,
  `created_at`       datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_by`       varchar(36)  DEFAULT NULL,
  `deleted_at`       datetime(6)  DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `inv_bom_uq` (`org_id`, `treatment_type`, `item_id`),
  KEY `inv_bom_item_idx` (`item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Restock masuk dengan kos & pembekal (PRD C3)
CREATE TABLE IF NOT EXISTS `inv_restocks` (
  `id`            varchar(36)  NOT NULL,
  `org_id`        varchar(36)  NOT NULL,
  `branch_id`      varchar(36)  NOT NULL,
  `room_id`       varchar(36)  DEFAULT NULL,
  `item_id`       varchar(36)  NOT NULL,
  `qty`           decimal(12,4) NOT NULL,
  `unit_cost`     decimal(19,4) NOT NULL DEFAULT 0,
  `supplier`      varchar(256) DEFAULT NULL,
  `restock_date`  date         NOT NULL,
  `received_by`   varchar(36)  DEFAULT NULL,
  `created_at`    datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_by`    varchar(36)  DEFAULT NULL,
  `deleted_at`    datetime(6)  DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `inv_restocks_org_idx` (`org_id`, `restock_date`),
  KEY `inv_restocks_item_idx` (`item_id`),
  KEY `inv_restocks_branch_idx` (`branch_id`, `restock_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Kiraan mingguan per item per bilik (PRD B; approval = B7)
CREATE TABLE IF NOT EXISTS `inv_counts` (
  `id`            varchar(36)  NOT NULL,
  `org_id`        varchar(36)  NOT NULL,
  `branch_id`     varchar(36)  NOT NULL,
  `room_id`       varchar(36)  NOT NULL,
  `item_id`       varchar(36)  NOT NULL,
  `iso_week`      varchar(10)  NOT NULL,          -- '2026-W41'
  `qty_counted`   decimal(12,4) NOT NULL,
  `status`        enum('draft','submitted','approved','rejected') NOT NULL DEFAULT 'draft',
  `counted_by`    varchar(36)  DEFAULT NULL,
  `approved_by`   varchar(36)  DEFAULT NULL,
  `approved_at`   datetime(6)  DEFAULT NULL,
  `opening_qty`   decimal(12,4) DEFAULT NULL,    -- snapshot semasa approved (C2)
  `stock_in`      decimal(12,4) DEFAULT NULL,    -- snapshot restock dalam minggu
  `created_at`    datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`    datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `deleted_at`    datetime(6)  DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `inv_counts_week_uq` (`org_id`, `room_id`, `item_id`, `iso_week`),
  KEY `inv_counts_branch_week_idx` (`branch_id`, `iso_week`),
  KEY `inv_counts_status_idx` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Penanda variance kebocoran (PRD D4/D5) — hasil computeWeek()
CREATE TABLE IF NOT EXISTS `inv_variance_flags` (
  `id`             varchar(36)  NOT NULL,
  `org_id`         varchar(36)  NOT NULL,
  `branch_id`      varchar(36)  NOT NULL,
  `item_id`        varchar(36)  NOT NULL,
  `iso_week`       varchar(10)  NOT NULL,
  `expected_qty`   decimal(12,4) NOT NULL,
  `actual_qty`     decimal(12,4) NOT NULL,
  `variance_qty`   decimal(12,4) NOT NULL,
  `variance_pct`   decimal(8,4)  NOT NULL,
  `threshold_pct`  decimal(8,4)  NOT NULL DEFAULT 5,
  `status`         enum('open','investigating','closed') NOT NULL DEFAULT 'open',
  `note`           varchar(512) DEFAULT NULL,
  `flagged_at`     datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`     datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `updated_by`     varchar(36)  DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `inv_flags_week_uq` (`org_id`, `branch_id`, `item_id`, `iso_week`),
  KEY `inv_flags_branch_idx` (`branch_id`, `iso_week`),
  KEY `inv_flags_status_idx` (`status`, `iso_week`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
