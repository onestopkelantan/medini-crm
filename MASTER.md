# MEDINI CRM — Master Document

**Single source of truth.** Status, priorities, how to run, and where the
reference material lives. Everything else in `docs/` is either reference
architecture (still valid) or archive (historical). Replaces the old
`NEXT-STEPS.md` / `STATUS.md` / `docs/CURRENT-STATE.md`.

- **Last updated:** 11 Oct 2026
- **Repo:** `github.com/rafienajwan/medini-crm` (private, `main`)
- **Stack:** NestJS 11 backend (REST `/api/v1`) · React 19 + Vite frontend · MySQL 8.4 · Redis/BullMQ · Garage (S3) · Caddy · Prometheus
- **Run:** `docker compose -f docker-compose.prod.yml -f docker-compose.override.yml up -d --build` → http://localhost:8080
- **Demo logins:** `hq` / `doctor` / `reception` (password per `.env`)

---

## 1. BOSS DIRECTIVE SCOREBOARD (8 Oct, 10 points)

The directive from the boss (8 Oct) is the priority order. Status as of 11 Oct:

| # | Directive | Status | Evidence |
|---|---|---|---|
| 1 | MVP: WhatsApp org → AI reply 24/7 → booking into CRM | ✅ ~90% — full path works (webhook → Nur → booking → transcript); end-to-end verify waits for a live WA number | Fasa A–E commits |
| 2 | "Number" channel + replies saved + 1–2 month chat history | ✅ | `7403cac`, `37c85f6` (4 paths audited, live data verified) |
| 3 | Prompt templates — casual / professional presets | ✅ preset apply writes INACTIVE slot; operator activates; fixed `getForBot()` bug (bot always read slot 1) | `9baecc7` |
| 4 | Scrubbing list by treatment + manager interval UI | 🟡 **backend done** — `scrubbing_rules` (0031), `/marketing/scrubbing-rules` list/upsert/`due` verified live; **remaining: manager settings UI** | `4dd04f8` |
| 5 | Remove unused AI agents | ✅ 2 archived, 6 kept (referenced in code), 1 retired | `9baecc7` |
| 6 | Extract DentalERP reference, especially clinical | ✅✅ **exceeded** — Dr Partner (the production system) studied read-only, then **fully migrated**: 53,320 patients (unique `external_ref`), RM 20.55M collections (338 monthly rows), 24-code catalog, 13 medicines, 26 suppliers, 915 inventory items, 11 panels, 17 categories. Schema 0035: patients 30→47 cols, 9 new tables. Study plan: `docs/studies/DRPARTNER-LAPORAN-PENUH.md`; report: `docs/studies/LAPORAN-MIGRASI-DRPARTNER.md` | `ec9ff26`, `b55c730`, `d50df25` |
| 7 | Bukku study + auto-sync | ⏳ blocked on API key from owner. Scope + bidirectional sync plan done: `docs/integrations/` · API specs: `docs/bukku-api/` | — |
| 8 | Easy to use (DentalERP is the benchmark) | 🔄 continuous — theme rebranded to medinidentalgroup.com palette, login redesign, i18n sweep, per-branch demo data, click-through audits | `e1455d6`, `b7ba8fe`, `2d7927b`, `c881fb7` |
| 9 | Don't follow old documentation | ✅ this file supersedes; directive = priority source | — |
| 10 | Inventory per Invelli PRD | ✅ tables (0034) + 915 real items imported | `04923d3`, `b55c730` |

### What's next (priority order)

1. **Scrubbing manager UI** (closes #4) — interval editor + due-patients screen, manager-scoped.
2. **Bukku auto-sync** (#7) — starts when the API key arrives; scope already written.
3. **Web App Executor engine** (mentor Track A gap) — "urus upload jadwal" / office management; needs guardrails + approval rules active — it *changes* things.
4. **WhatsApp production path** — WAHA stays for dev; production = official WhatsApp Business API via Meta/BSP. Never pair a valuable number on WAHA. Owner will re-verify the old number (possibly unbanned).
5. **Form template texts (MC/PDPA/leave)** — engine done; Forms page lets HQ staff write the text themselves; only gap: issuing panel for STAFF forms not yet mounted.

### Mentor Track A (AI agent program)

| Agent | Status | Domain |
|---|---|---|
| **Nur** (WhatsApp receptionist) | ✅ live | whatsapp |
| **Booking Manager** | ✅ live | appointments — system-verified free slots |
| **Data Analyst** | ✅ live | reports — grounded answers from real numbers ("Tanya Data" panel + `/assistant` page) |
| **Web App Executor** | ❌ registered, no engine | settings — the remaining gap (item 3 above) |

### Build ladder (Track B)

```
P0 Foundation   ✅      P1 Clinical    ✅      P2 Money bridge ✅
P3 Data + E2E   ⏸ blocked on Boss (real prices; MC/PDPA text — self-service now exists)
P4 Payments     🟡 core done (plans/pay/waive/receipts); e-Invoice pending decision
P5 Reports      🟡 partial      P6 Inventory  ✅ (Invelli PRD)
P7 Wiring       🟡 partial      P8 Polish     🟡
```

---

## 2. SYSTEM STATE (11 Oct 2026)

- **Data:** REAL data from the Dr Partner migration (53,320 patients, RM 20.5M history) + clearly-labelled `DEMO-` rows on top; `scripts/ops/padam-data-demo.sh` wipes demo only.
- **Migrations:** 0001–0035. 0027, 0029–0031, 0034–0035 are hand-applied + listed in the RA-1 drift guard (`backend/test/integration/ra1-schema-drift.spec.ts`).
- **Backups:** `backups/` (git-ignored) holds pre-import dumps — restore point for the Dr Partner load. Production backup tool candidate: `databasement` (github.com/David-Crty/databasement) — slot into deploy phase.
- **WhatsApp:** no live number. Old number banned (frozen QR, `connection closed` loop). Channel primary switch (0029) lets a dead number be replaced without delete-and-recreate. Anti-ban: typing pacing, burst debounce, presence simulation — keep replies human-paced.
- **Tests:** backend 809 pass (3 pre-existing failures: pulse ×2, permission-matrix ×1); frontend vitest 47/47.
- **Reminder design:** single WhatsApp confirmation **H-8** before the visit (`appointment_reminders`, 0030) — sender cron starts once a WA number is live.
- **No-show risk: REMOVED by owner decision** (reverts `76a8959`/`941e456`) — "booking already carries the data". The waitlist (E1–E3) stands.

### Open questions for the Boss

1. e-Invoice: direct LHDN/MyInvois API, or via Bukku? (blocks P4 tail / P6)
2. Real treatment prices — clinic staff self-enter in the catalog UI; Dr Partner's per-branch price matrix (Metropoint/UDA) is in `docs/studies/` as reference.

---

## 3. WHERE EVERYTHING LIVES

| Path | What |
|---|---|
| `docs/architecture/` | **Living reference** — per-domain architecture + `*-LOCKED.md` decision records (referenced by code; do not rename) |
| `docs/studies/` | **Living reference** — Dr Partner intelligence, comparison vs dental-erp, price data, migration reports |
| `docs/integrations/` | Bukku sync scope, WAHA connection flow, Power BI |
| `docs/bukku-api/` | Bukku OpenAPI specs (used by `backend/src/modules/finance/domain/bukku-invoice.ts`) |
| `docs/operations/` | Runbooks: deployment, backup/RPO, monitoring, staging |
| `docs/superpowers/` | Design specs (booking manager slot visibility, data analyst agent) |
| `docs/archive/` | **Historical** — session reports, fasa plans, sprint notes. Move-only; never edited |
| `scripts/ops/` | Demo data generators, per-branch seeds, cleanup scripts |
| `scripts/audit/`, `scripts/verify/` | i18n/UI comment audits, verification helpers |
| `backend/scripts/` | One-off import/migration scripts (Dr Partner import pipeline lives here) |

---

## 4. HOUSE RULES & GOTCHAS

1. **Small commits** — one logical change each; never big-bang.
2. **Gates before commit:** `tsc -b` (frontend; plain `tsc --noEmit` lies) · `tsc --noEmit` (backend) · eslint `--max-warnings=0` · related tests · build.
3. **Hand-applied migrations** must be listed in the RA-1 drift guard.
4. **Old documents are move-only** — archive, never edit.
5. **Language:** code, commits, docs in English; chat with owner in Indonesian.
6. **No credentials in summaries.** Demo passwords only via `.env`.
7. **MySQL has no RLS** — branch/role scope lives in the app layer (`useScope()`, fail-closed guards); every create/edit must send `branchId`.
8. **Never pair a valuable WhatsApp number on WAHA.**
9. Frontend `tsc --noEmit` falsely reports 0 errors (references-only tsconfig) → always `tsc -b`.
10. After a UI change, **rebuild** the frontend image; Caddy does not hot-reload config.
11. `organizations` table is empty — read `org_id` from a `branches` row.
12. `wa_conversations.unread_count` (thread) ≠ `wa_notifications.read_at` (bell).
13. `database.ts` is a MySQL compatibility shim (Proxy-based) — load-bearing; type-only changes.
14. Docker often OFF — integration tests then honestly skip. Check before trusting green.
15. **Never fan out multiple agents on one working tree.**
16. Seed requires `SEED_DEMO_PASSWORD`; no hard-coded passwords.
