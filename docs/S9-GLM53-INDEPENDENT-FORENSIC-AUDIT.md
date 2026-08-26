# GLM 5.3 — S9 INDEPENDENT FORENSIC AUDIT

**Tarikh:** 2026-08-18
**Auditor:** GLM 5.3 (Independent Senior Production Backend Auditor)
**Baseline:** S8 LOCK `c0ac25c762c686bb594498b3ec9754c03ea16161`
**Kaedah:** Source/migration/test inspection + live PostgreSQL probes (`medini_app`, bukan superuser) + fresh replay DB + independent suite ×2 + TSC/LINT/BUILD. READ-ONLY terhadap repo; sifar perubahan oleh auditor; semua artifak audit (probe rows, replay DB `medini_s9_audit`) dibersihkan selepas verifikasi.

---

## EXECUTIVE VERDICT

### 🟢 APPROVE FOR CHATGPT GOVERNANCE REVIEW

**Confidence: TINGGI.** S9 implementasi adalah additive, selamat, dan setia kepada scope yang diluluskan. Ketiga-tiga isu governance yang dibenderakan oleh Neo disahkan SAH untuk dibawa ke governance (bukan resolusi teknikal tersembunyi). Tiada finding yang menyekat (BLOCK) lock. Satu item R-01 kekal WAJIB sebelum produksi (S10).

**Bukti independent teras:**
- Suite: **475/475 PASS ×2 (0 fail, 0 skip)** — dilaksanakan sendiri oleh auditor, bukan claim Neo
- TSC ✅ / LINT ✅ / BUILD ✅
- Replay `0000→0024`: **BERSIH** — drift **SIFAR 7/7 dimensi** (69 tables / 69 RLS / 977 columns / 264 indexes / 219 policies / 4 KPI seeds / 2 table S9)
- RLS live probes pada `kpi_definitions` + `report_audit`: **11/11 mengikut spec** (matrix penuh di §4)
- S8 immutability: diff sebenar vs `c0ac25c` — **sifar perubahan** pada S8 runtime/migrations/tests

---

## 1. BLUEPRINT COMPLIANCE (§24, §28, S9 scope)

| Komponen | Klasifikasi | Bukti independent |
|---|---|---|
| 6 report endpoints | 🟢 REQUIRED | §28-S9 "RPT_KPIS, dashboards"; REPORTS-ANALYTICS-LOCKED §10 |
| KPI strip (4 cards + honest chair) | 🟢 REQUIRED | LOCK §10 Overview |
| `kpi_definitions` registry | 🟡 GOVERNANCE (lihat §3) | §24 = *Testing Architecture* — **TIADA** senarai table di sana; sumber sebenar ialah REPORTS-ANALYTICS-ARCHITECTURE "Schema: report_definitions, kpi_definitions, report_views, report_audit" (L254). Neo salah cite §24 tetapi kesimpulan KEEP tetap defensible |
| `report_audit` | 🟢 REQUIRED | LOCK §16 "setiap report view … immutable" |
| RecallReadPort | 🟢 JUSTIFIED | Diperlukan untuk recall_rate KPI tanpa pecah module boundary; read-only tulen |
| `/metrics` + prom-client + QueueEvents + backlog gauge + alert doc | 🟢 REQUIRED/JUSTIFIED | §28-S9 "metrics/tracing/alerting"; §19 Observability |
| report_definitions/report_views tables TIDAK dicipta | 🟢 JUSTIFIED OMISSION | Code-defined views, KISS; LOCK tidak menuntut persistence |
| Power BI PBIP | 🟡 GOVERNANCE (lihat §9) | BUKAN dalam §28; masuk melalui Bos ruling 18 Aug "S9-T6" (S9-IMPLEMENTATION-PLAN L9) |

**Scope melebihi §28?** Ya — Power BI sahaja, dan ia mempunyai ruling Bos eksplisit yang didokumenkan. Selebihnya setia kepada blueprint.

## 2. S8 IMMUTABILITY (verified actual diff vs `c0ac25c`)

- `git diff` modules whatsapp/finance/marketing/outbox/queue + migrations 0000–0023 + tests S8 → **KOSONG**
- 12 fail modified semuanya additive: `main.ts` (+`metrics` prefix exclude), `app.module.ts` (+2 module), `architecture.contract.ts` (doctor reports cell — satu-satunya contract change, lihat §6), `logger.module.ts` (+interceptor), 3 read-ports (kaedah S9 additive), `package.json` (+prom-client), `_journal.json` (idx 23 append), `ci.yml` (+0024 dalam replay loop)
- Frontend `app/` **KOSONG diff**; `CURRENT-MEDINI-REVIEW.html` MD5 `84f3993a…` unchanged ✅
- **PASS — tiada hidden changes menyamar sebagai S9**

## 3. kpi_definitions — DEEP AUDIT (challenge Neo's KEEP)

| # | Soalan | Jawapan independent |
|---|---|---|
| 1 | §24 require DB table? | **TIDAK** — §24 ialah Testing Architecture; tiada `kpi_definitions` di situ. Requirement sebenar dari REPORTS-ANALYTICS-ARCHITECTURE (domain doc) |
| 2 | Role sebenar | Registry metadata inspectable: `/api/v1/reports/kpi-registry` (HQ-only) membaca dari table ini |
| 3 | Truly canonical? | **SePARAh** — `formula` text ialah dokumentasi; pengiraan sebenar dalam `kpi-formulas.ts` (kod). Ia canonical *registry of record*, bukan compute engine |
| 4 | Formula code + metadata DB? | Ya — itu reka bentuk sekarang; selamat selagi mapped |
| 5 | 3 sources of truth? | **Risiko wujud tapi terkawal**: (a) kod = executable truth, (b) DB = declared truth, (c) DAX PBI = mirror by documented mapping. Tiada mekanisma automated drift-detection antara tiga — LOW risk (all 3 ditulis sekali, version-controlled), tapi governance perlu tahu |
| 6 | Versioning implemented? | Ya — `(org_id, kpi_key, version)` UNIQUE, seed version=1; no DELETE by design |
| 7 | HQ governance? | Ya — RLS live: hq INSERT ✅ / UPDATE ✅ / branch_manager INSERT ❌ DENY / doctor SELECT 0 rows / worker SELECT 0 rows / hq DELETE ❌ (grant) |
| 8 | Mutable? | UPDATE oleh HQ sahaja; append-only untuk selain hq |
| 9 | Seeds authoritative? | Ya — 4 seed canonical, idempotent `ON CONFLICT DO NOTHING`; dev == replay (4=4) |
| 10 | Formula berubah? | Insert version baru (governance event); versi lama kekal |
| 11 | PBI consume reliable? | TIDAK at runtime — DAX mirror mapping documented, tidak query table. Selamat |
| 12 | Remove breaks S9? | Ya — `/kpi-registry` endpoint hilang data source + LOCK "canonical registry inspectable" |

**Recommendasi GLM: KEEP (🟡 governance confirmation sahaja).** Table kecil (4 rows), RLS ketat, zero coupling dengan compute. Neo salah attribute §24 — pembetulan cite: **REPORTS-ANALYTICS-ARCHITECTURE L254** — tetapi kesimpulan KEEP kekal betul. Ganti kod = kehilangan inspectable registry yang LOCK doc minta.

## 4. report_audit — DEEP AUDIT + LIVE MATRIX

**Keperluan dedicated table:** YA — `AuditService` (S0) menghalang view-only records dalam `audit_log` berkongsi; volume isolation; domain ownership (LOCK). Menggunakan `audit_log` akan melanggar kontrak S0/S2.

**Live probes (medini_app, GUC per-role):**

| Probe | Keputusan | Spec |
|---|---|---|
| org isolation (RESTRICTIVE, cross-org) | 0 rows kedua-dua arah | ✅ |
| hq SELECT | ✅ ALLOW | ✅ |
| branch_manager SELECT | ❌ DENY (0 rows) | ✅ |
| hq INSERT | ✅ | ✅ |
| branch_manager INSERT | ✅ | ✅ (rekod view sendiri) |
| hq UPDATE | ❌ `permission denied` | ✅ append-only |
| hq DELETE | ❌ `permission denied` | ✅ append-only |
| system_worker (kpi + audit) | SELECT 0 / tiada policy write | ✅ |

**Transaction behaviour:** `recordView` berlaku DALAM `runAs()` transaction yang sama dengan read (ReportsService) — atomic. **Actor identity/timestamp/correlation_id** NOT NULL. Tiada FK aktor (intentional — audit row survive staff changes; direkod sebagai fakta). Tamper resistance = RLS + grants, memadai untuk threat model dalaman. **Semua probe rows dibersihkan selepas verifikasi.**

## 5. REPORT ENDPOINTS (6/6)

Semua endpoint: `@RequirePermission('reports','view')` + scope server-derived (AD-6, TIADA `branchId` param) + period whitelist (invalid → ForbiddenError) + audit dalam tx sama.

| Endpoint | Verifikasi | Status |
|---|---|---|
| `/kpis` | Revenue dari `revenueTotal` canonical (`status='confirmed'`, `deletedAt IS NULL`); parity test: spec L119 banding direct `revenueTotal` vs card | ✅ |
| `/revenue-by-branch` | `revenueByBranch` predicate **IDENTIK** dengan `revenueTotal` (verified char-by-char: org+deletedAt+confirmed+date-range+branch) → parity by construction; limit clamp 1–50; `branchName` null-safe | ✅ |
| `/treatment-mix` | clinical.read-port (treatment_plan_items⋈plans), relationally safe, share=null bila total=0 | ✅ |
| `/appointment-trends` | `scheduledDate` (DATE) between inclusive from/to; pipeline→booked, completed/no-show berasingan | ✅ |
| `/doctor-production` | attribution via `appointments.doctor_id` NOT NULL, completed-only, branch scope; names lookup RLS-scoped | ✅ |
| `/kpi-registry` | HQ-only double enforcement (scope + role check) + RLS table-level | ✅ |

**Timezone:** `resolvePeriod` guna server-local date (Asia/Kuala_Lumpur di deploy) — konsisten dengan `sale_records.sale_date`/`scheduled_date` yang juga DATE server-side. Selamat untuk single-TZ Malaysia; NOTE untuk multi-TZ (tidak dalam scope). **Cross-branch leakage:** Manager pinned `branchId` di SEMUA query path + RLS org-isolation lapisan kedua + spec assert manager hanya nampak branch sendiri. **Empty/null:** spec kedua (`empty org`) verified honest zeros/unavailable cards.

## 6. RBAC DOCTOR CONFLICT

1. **Dokumen authoritative:** `REPORTS-ANALYTICS-LOCKED.md` (Phase-7 domain lock) — L31: "RBAC: Receptionist/Doctor blocked (permissionMatrix)". `ROLE_DOMAIN_MATRIX` dalam code ialah *port* dokumen, bukan authority.
2. **Phase-7 LOCK lebih baru?** Ya — matrix cell `view/own` adalah artifact pra-lock yang tidak pernah diselaraskan.
3. **Amendment documented?** Ya — comment in-code cite Q1 + precedent S6 D1 + S9-GOVERNANCE-RECONCILIATION Review F.
4. **Contract test?** Ya — s9 spec `doctor → 403` + scope-spec `others denied`.
5. **Break approved functionality?** TIDAK — frontend Reports sudah memblok Doctor (LOCK L31), jadi backend kini MATCH frontend locked behaviour (sebelum ini backend lebih longgar daripada kontrak).
6. **Technically safe?** Ya — deny-by-default `ALLOWED_ROLES` set, fail-closed untuk manager tanpa branch.

**Klasifikasi: 🟡 GOVERNANCE CONFIRMATION (bukan remediation).** Amendment adalah pembetulan alignment, bukan pecah kontrak. Neo betul — dan kali ini saya verify sendiri dokumen authority-nya.

## 7. `/metrics` SECURITY — CRITICAL REVIEW

**Kandungan (verified source):** default process metrics (prom-client), `http_request_duration_seconds`/`http_requests_total` (label: method, **route-pattern** atau path-sans-query — bukan URL penuh), `worker_jobs_total` (queue name constant set), `worker_job_duration_seconds`, `outbox_unpublished_events`, `db_pool_clients`.

- PII: **TIADA** — tiada org/branch/patient/staff ID sebagai label (R6 enforced + cardinality test assert)
- Secrets: TIADA (registry tidak touch env/headers)
- Route names: YA — nama path API terdedah (info leak rendah; route pattern bukan raw query)
- Queue names: YA — constant `QUEUE_NAMES` (bounded)
- High-cardinality: **TIDAK** — spec assert hanya method/route/status/queue/state; route fallback path-sans-query masih boleh berisi ID path parameter jika route pattern tidak match — interceptor guna `req.route.path` bila ada; fallback hanya untuk non-Nest paths. **LOW residual** (fallback path), diterima untuk S9.

**Safe to LOCK sekarang?** **YA** — production TIDAK deployed; tiada exposure hari ini. Safe-to-lock ≠ safe-to-production.
**WAJIB sebelum S10 production:** R-01 — network restriction (reverse-proxy ACL / bind infra-network / bearer token). Sudah didokumenkan dalam OBSERVABILITY.md. **MUST BE FIXED BEFORE PRODUCTION — DOES NOT BLOCK S9 LOCK.**

## 8. prom-client + WORKER OBSERVABILITY

- `prom-client ^15.1.3` — satu-satunya dependency baharu; standard de-facto Prometheus untuk Node; Apache-2.0; justified minimal
- QueueEvents: subscribe Redis event stream BullMQ sendiri — **zero diff pada S8 worker code** (verified: diff kosong). No-Redis → listeners tidak start (honest no-op). `onModuleDestroy` close semua listeners — tiada leak. Duplicate listeners: satu `QueueEvents` per queue, sekali
- Outbox backlog gauge: in-process 30s poll — tidak sentuh outbox table contract (read count sahaja)
- Live worker probe (jobs melewati queue sebenar): **DEFERRED ke S10** — memerlukan Redis runtime penuh; diterima sebagai limitation bukan defect (unit + wiring tests ada)

## 9. POWER BI SCOPE

1. Explicitly S9? BUKAN dalam §28 — masuk via **Bos ruling 18 Aug** (didokumenkan S9-IMPLEMENTATION-PLAN L9: "Power BI foundation added as T6")
2. §28? Tidak
3. Bos ruling? Ya, eksplisit
4. Isolated? Ya — tree `power-bi/` berasingan, zero backend coupling
5. Release risk? RENDAH — statik sahaja (te validate 0 errors)
6. Live DB validation? TIDAK (perlu Desktop+gateway) — S10
7. S10 infra? Ya (activation checklist documented)
8. Foundation-only safe? Ya
9. Remove/defer affect backend? TIDAK — zero coupling

**Recommendasi GLM: KEEP IN S9 as foundation-only (🟡 governance confirm).** Kerana ruling Bos wujud dan didokumenkan, ini *confirmation ritual* sahaja. Jika governance mahu minimal surface, tree boleh pindah S10 dengan sifar impak backend.

## 10. KISS AUDIT

Tiada duplicate sources of truth *computable* (kod = compute, DB = registry metadata, DAX = mirror documented). Tiada port/module/abstraction spekulatif melebihi keperluan LOCK. Dua table baharu = minimum untuk LOCK §16 + registry inspectable. `report_definitions`/`report_views` sengaja TIDAK dibuat — KISS betul. **Satu kritikan kecil:** `MetricsService.onModuleDestroy` no-op dengan comment (kosmetik). Keseluruhan: **LEAN — lulus.**

## 11. TEST QUALITY

| Kawasan | Klasifikasi | Bukti |
|---|---|---|
| Revenue parity | **STRONG** | spec L119: direct `revenueTotal` vs KPI card + revenueByBranch predicate identik |
| Branch isolation + HQ access + manager own-branch | **STRONG** | hq 2 branches vs manager 1 branch asserted |
| Doctor/Receptionist denial | **STRONG** | 403 asserted + scope unit tests |
| Audit persistence + append-only | **STRONG** | INSERT ok / UPDATE+DELETE blocked (spec + live saya) |
| RLS org isolation dua arah | **STRONG** | foundation spec L133 |
| KPI formulas + divide-by-zero honesty | **STRONG** | pure unit + empty-org integration |
| Period boundaries | **ADEQUATE** | inclusive ranges unit-tested; boundary midnight tidak eksplisit (LOW) |
| Metrics cardinality/security | **ADEQUATE** | label-name whitelist asserted; kandungan response `/metrics` tidak di-audit byte-level untuk PII (saya semak source — tiada PII path) |
| Migration replay | **STRONG** | saya replay sendiri 0000→0024 clean + drift 0 |
| Worker observability (live) | **DEFERRED** | S10 (Redis runtime) |
| Regression S8 | **STRONG** | 475 termasuk semua S8 specs ×2 run bebas |

False-confidence risk: **RENDAH**. Tiada simulation-only tests ditemui pada path kritikal.

## 12. FINAL FINDINGS TABLE

| Area | Finding | Severity | Evidence | Required Action | S9 Lock Impact |
|---|---|---|---|---|---|
| `/metrics` exposure | `@Public` tanpa network control | HIGH (prod) / INFO (lock) | metrics.controller.ts L8 + OBSERVABILITY.md R-01 | R-01 sebelum S10 deployment | DOES NOT BLOCK |
| kpi_definitions cite | Neo cite §24 salah; sumber sebenar REPORTS-ANALYTICS-ARCH L254 | LOW | dokumen | Correct cite dalam governance review | DOES NOT BLOCK |
| 3-source KPI mapping | kod/DB/DAX tanpa automated drift check | LOW | §3 atas | Governance aware; optional S10 test | DOES NOT BLOCK |
| Route-label fallback | interceptor fallback path bila route pattern tiada | LOW | http-metrics.interceptor.ts L26 | Monitor; harden S10 | DOES NOT BLOCK |
| Doctor RBAC | amendment kontrak terkunci | MEDIUM (governance) | §6 atas | Governance confirm | DOES NOT BLOCK (confirm sahaja) |
| Power BI scope | bukan §28, Bos ruling ada | MEDIUM (governance) | §9 atas | Governance confirm | DOES NOT BLOCK (confirm sahaja) |
| Live worker metrics | tiada runtime Redis | INFO | §8 | S10 | DOES NOT BLOCK |
| kpi_registry audit | recordView(null filter) — konsisten design | INFO | reports.service L175 | — | DOES NOT BLOCK |

## 13. PRODUCTION READINESS (dipisah)

**A. Boleh LOCK? YA** — semua keperluan lock dipenuhi dengan bukti bebas.
**B. Production-ready? BELUM** — berikut S10: R-01 network restriction `/metrics`, Power BI live validation + publish + gateway, frontend integration, infra/backup/restore, monitoring deployment, live worker probe. Semua bukan scope S9 dan tidak menyekat lock.

---

## VERDICT

# 🟢 APPROVE FOR CHATGPT GOVERNANCE REVIEW

S9 adalah implementasi yang bersih, additive, dan teruji secara bebas (475/475 ×2, replay sifar drift, RLS live 11/11). Ketiga-tiga isu governance (kpi_definitions, doctor RBAC amendment, Power BI scope) adalah confirmation sahaja — tiada yang memerlukan remediation kod sebelum governance review. R-01 kekal wajib sebelum produksi dan sudah didokumenkan.

**Status repo: UNCOMMITTED atas `c0ac25c`, sifar perubahan oleh auditor, artifak audit dibersihkan. Keputusan LOCK adalah milik governance (Bos + ChatGPT).**

S9 GLM 5.3 INDEPENDENT FORENSIC AUDIT COMPLETE
