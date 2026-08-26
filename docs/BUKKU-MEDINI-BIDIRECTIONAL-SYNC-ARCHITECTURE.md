# BUKKU ↔ MEDINI — BIDIRECTIONAL SYNC ARCHITECTURE v1.0

**Artifact:** `docs/BUKKU-MEDINI-BIDIRECTIONAL-SYNC-ARCHITECTURE.md`
**Date:** 14 Ogos 2026 · **Author:** Neo (Principal Solution Architect)
**Status:** ARCHITECTURE DESIGN ONLY — NO IMPLEMENTATION. M1 Fasa 2 belum start.
**Baseline:** 768/768 tests PASS · M1 Fasa 1 contract layer LOCKED

> **Business rule (locked):** Medini CRM = CRM/operational system (Payment STATUS layer).
> Bukku = accounting/financial system. BUKAN payment gateway / FPX / card processing.
> Target: **CONNECTED · SYNCHRONIZED · TRACEABLE · RECONCILABLE**

---

## 1. EXECUTIVE SUMMARY

Integrasi Medini ↔ Bukku ialah **bidirectional financial sync** dengan sempadan jelas:

```
MEDINI CRM                                    BUKKU
(operational truth)                           (financial truth)
                                 
Patient / Treatment /                Invoice / Payment /
Payment STATUS (PENDING/    ◄────►   Accounting / Ledger /
PAID/OVERDUE) projection             Tax / Reporting
        │                                  ▲
        └────── Integration Layer ─────────┘
         (Mapping · Idempotency · Audit)
```

**Prinsip utama:**
1. **Bukan semua field owner sama** — ownership dipecah PER DATA TYPE (section 5).
2. **Bukku = financial source of truth** untuk transaction/ledger. **Medini = operational source of truth** untuk patient/treatment/appointment.
3. **Payment status** = projection dalam Medini, derive dari Bukku payment state. Receptionist confirm dalam CRM → push ke Bukku; Bukku payment state → reflect balik ke CRM.
4. **Tiada auto-overwrite** field kewangan berbahaya. Conflict → HQ Finance review.
5. **Idempotency + loop prevention** wajib — event yang sama tak boleh hasilkan 2 transaksi; returned state tak boleh push balik.

**Keputusan Real-time vs Polling:** **Option C — Hybrid, POLLING primary** (webhook Bukku = **UNVERIFIED**, section 15).

---

## 2. CURRENT STATE AUDIT

Audit terhadap `CURRENT-MEDINI-REVIEW.html` (Bukku P4 + Phase 5 sync + reconciliation):

| Komponen | Lokasi | Status | Nota |
|---|---|---|---|
| API helper `bukkuFetch` | 10688 | **REAL** | fetch + Bearer token + `Company-Subdomain` header |
| Credentials `BUKKU.creds` | 10664 | **REAL (prototype)** | dari `localStorage('bukkuCreds')` — ⚠️ **prototype limitation**, production mesti server-side vault |
| Test connection | 10725 | **REAL** | GET `/sales/invoices?page=1&per_page=1`, check `paging.total` |
| Pull invoices `bukkuPullLive` | 10750 | **REAL (read-only)** | GET `/sales/invoices?page=1&per_page=8` |
| Push invoice `bukkuDoPush` | 10785 | **REAL (gated)** | POST `/sales/invoices` — confirm dialog + HQ-only |
| Sync queue `BUKKU.queue` | 10821 | **REAL (queue)** | enqueues invoices/payables/commissions |
| Simulate sync `bukkuSimulateSync` | 10868 | **SIMULATED** | boundary only, no HTTP |
| `VIRTUAL_BUKKU` two-way | 10882 | **SIMULATED** | in-memory "other side", no real HTTP |
| Conflict detection `syncConflictCheck` | 10905 | **SIMULATED** | detect mismatch, OPEN status |
| Conflict resolve `syncResolveConflict` | 10985 | **SIMULATED** | Use Medini / Use Bukku |
| Reconciliation `reconBuildRecords` | 11214 | **PARTIAL** | match by normalized number + idMap + amount. Read-only. |
| `RECON` records/audit | 11206 | **PARTIAL** | MATCHED/MISMATCH/MISSING_IN_BUKKU/UNMATCHED_BUKKU/REVIEWED |

### REAL vs SIMULATED vs MISSING — ringkasan

| | Item |
|---|---|
| **REAL** | bukkuFetch, test conn, pull invoices (GET), push invoice (POST, gated), sync queue, audit trail |
| **SIMULATED** | two-way sync, conflict detection/resolve, VIRTUAL_BUKKU |
| **PARTIAL** | reconciliation (matching by normalized number sahaja — lemah) |
| **MISSING** | webhook support, idempotency key, loop prevention metadata, payment status mapping (Bukku state ↔ PENDING/PAID/OVERDUE), incremental sync cursor, rate-limit handling, payment push endpoint, HQ credential vault |

---

## 3. TARGET ARCHITECTURE

```
┌────────────────────────────────────────────────────────────────────┐
│                          MEDINI CRM (SPA)                          │
│  Patient │ Treatment │ Finance │ Payment STATUS (PENDING/PAID/OVERDUE) │
└──────────────┬─────────────────────────────────────────────────────┘
               │ domain events (MEDINI_ARCHITECTURE.CROSS_DOMAIN_EVENTS)
               ▼
┌────────────────────────────────────────────────────────────────────┐
│              INTEGRATION LAYER (server-side, post-M1)              │
│                                                                    │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Identity │  │ Idempotency│  │  Sync    │  │  Conflict &    │  │
│  │ Mapping  │  │ Registry   │  │  State   │  │  Reconciliation│  │
│  │ Contract │  │ (processed │  │  Machine │  │  Engine        │  │
│  │          │  │  events)   │  │          │  │  (read-only)   │  │
│  └──────────┘  └────────────┘  └──────────┘  └────────────────┘  │
│                                                                    │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Outbound │  │  Inbound   │  │  Audit   │  │  Credential    │  │
│  │ Queue    │  │  Poller    │  │  Logger  │  │  Vault (HQ)    │  │
│  │ (retry)  │  │  (cursor)  │  │          │  │                │  │
│  └──────────┘  └────────────┘  └──────────┘  └────────────────┘  │
└──────────────┬───────────────────────────▲────────────────────────┘
               │ push (POST/PUT)            │ pull (GET, incremental)
               ▼                            │
        ┌────────────────────────────────────────┐
        │            BUKKU API (api.bukku.my)      │
        │  /sales/invoices · /sales/payments ·     │
        │  /purchases/bills · /journal_entries     │
        └────────────────────────────────────────┘
```

**Penting:** Integration Layer ialah **server-side** (backend), BUKAN dalam SPA. SPA hanya trigger + display. Ini sebab:
- Credential tak boleh duduk di frontend localStorage (production)
- Polling scheduler perlukan server clock, bukan browser tab
- Idempotency registry mesti persistent, bukan in-memory

---

## 4. SYSTEM BOUNDARIES

| System | Bertanggungjawab | TIDAK bertanggungjawab |
|---|---|---|
| **Medini CRM** | Patient master, appointment, treatment, operational workflow, payment STATUS projection (PENDING/PAID/OVERDUE), front-desk confirmation | Payment processing, ledger, tax calc, accounting posting, FPX/card |
| **Integration Layer** | Mapping, idempotency, retry, conflict queue, audit, credential vault, polling scheduler | Business logic, clinical workflow |
| **Bukku** | Invoice, payment transaction, accounting, ledger, financial reporting, tax | Patient master data, appointment scheduling, clinical records |

**Boundary rule:** Medini hantar *operational event* (payment confirmed, invoice issued) → Integration Layer translate ke *financial operation* (create/update Bukku transaction). Bukku hantar *financial state* (payment status, amount) → Integration Layer translate ke *CRM projection* (PENDING/PAID/OVERDUE).

---

## 5. DATA OWNERSHIP MATRIX (per data type)

| Data Type | OWNER_SYSTEM | READ_SOURCE | WRITE from MEDINI | WRITE from BUKKU | SYNC_DIRECTION | CONFLICT_POLICY |
|---|---|---|---|---|---|---|
| Patient identity | **Medini** | Medini | ✅ create/update | ❌ | M→B (contact ref) | Medini wins (master) |
| Treatment | **Medini** | Medini | ✅ | ❌ | M→B (line item desc) | Medini wins |
| Treatment cost | **Medini** | Medini | ✅ | ❌ | M→B (unit_price) | Medini wins |
| Invoice | **Bukku** | Bukku | ✅ create (via push) | ✅ | **Bidirectional** | Bukku wins (financial doc) |
| Invoice status | **Bukku** | Bukku | ❌ (read) | ✅ | B→M | Bukku wins |
| Payment transaction | **Bukku** | Bukku | ❌ create direct | ✅ | B→M | Bukku wins |
| **Payment status** | **Bukku** (state) / **Medini** (projection) | Medini (projection) | ✅ confirm (PENDING→PAID) | ✅ state change | **Bidirectional** | Bukku wins (financial truth) |
| Payment reference | **Bukku** | Bukku | ❌ | ✅ | B→M | Bukku wins |
| Amount | **Bukku** | Bukku | ✅ initial (invoice amt) | ✅ final | B→M (truth) | **HQ Finance review** (dangerous) |
| Payable | **Bukku** | Bukku | ✅ create (bill) | ✅ | Bidirectional | Bukku wins |
| Commission | **Medini** (rules) / **Bukku** (posting) | Bukku (posted) | ✅ rules/calc | ✅ posting | M→B (calc) → B→M (posted) | Bukku wins (posted) |
| Bukku transaction ID | **Bukku** | Bukku | ❌ | ✅ | B→M (store ref) | Bukku wins (immutable) |
| Reconciliation status | **Integration Layer** | Integration | ❌ | ❌ | computed | HQ resolve |

**Prinsip:**
- **Bukku own semua financial document/transaction** (invoice, payment, payable, transaction ID, reconciliation amount).
- **Medini own semua operational master** (patient, treatment, appointment).
- **Payment status** special: Bukku own *state*, Medini own *projection*. Receptionist confirm dalam CRM = *request* untuk update, tapi Bukku yang finalize.
- **Amount** = dangerous field. Conflict → **HQ Finance review**, bukan auto-overwrite.

---

## 6. SYNC DIRECTION MATRIX

| Scenario | Direction | Trigger | Endpoint |
|---|---|---|---|
| Receptionist confirm payment | M→B | `PAYMENT_STATUS_UPDATED` | POST `/sales/payments` (atau update invoice status) |
| Invoice issued dalam CRM | M→B | `INVOICE_CREATED` | POST `/sales/invoices` |
| Bukku payment received | B→M | poll detect status change | GET `/sales/invoices?updated_at>` |
| Bukku invoice updated | B→M | poll incremental | GET `/sales/invoices` (cursor) |
| Payable created dalam CRM | M→B | `BILL_APPROVED` | POST `/purchases/bills` |
| Commission posted | M→B | payout approved | POST `/journal_entries` |
| Reconciliation | B→M (read) | manual/scheduled | GET (read-only) |

---

## 7. SOURCE-OF-TRUTH MATRIX (ringkasan eksekutif)

| | Medini | Bukku |
|---|---|---|
| **Master** | Patient, Treatment, Appointment | Invoice, Payment, Ledger |
| **Status** | Payment STATUS projection (PENDING/PAID/OVERDUE) | Payment/Invoice state (financial truth) |
| **Amount** | initial (treatment cost) | **final truth** |
| **Reference** | MRN, Medini invoice ID | Bukku transaction ID, payment reference |

**Satu arah kebenaran per field.** Tiada field yang dua-dua sistem own serentak tanpa hierarchy. Hierarchy: **financial = Bukku, operational = Medini**.

---

## 8. IDENTITY MAPPING CONTRACT

**Kritikal.** Setiap Bukku record mesti map ke Medini record melalui identifier yang stabil.

| Identifier | Peranan | Kekuatan |
|---|---|---|
| **Bukku transaction ID** | **PRIMARY MATCH KEY** | Immutable, unique dalam Bukku |
| **Medini invoice ID** (INV-2026-XXXX) | **SECONDARY MATCH KEY** | Deterministic, unique dalam Medini |
| **Payment reference** (EXT-XXXX / Bukku ref) | **FALLBACK MATCH KEY** | Semi-unique, untuk reconciliation |
| MRN (patient) | link key | untuk patient resolution, BUKAN match utama |
| Amount | **BUKAN match key** | hanya untuk verification, BUKAN identity |
| Patient name | **DILARANG** sebagai match key | tak unique, tak stabil |

### Mapping store (Integration Layer)
```
SYNC_MAP
  mediniInvoiceId  → bukkuTransactionId
  mediniPatientId  → bukkuContactId
  bukkuTransactionId → mediniInvoiceId (reverse)
  bukkuContactId     → mediniPatientId (reverse)
```

### Rules
1. **PRIMARY:** match by `bukkuTransactionId` (disimpan dalam Medini record selepas push pertama).
2. **SECONDARY:** kalau tiada transaction ID, match by `mediniInvoiceId` (dalam Bukku `number` field, normalized).
3. **FALLBACK:** kalau dua-dua gagal, match by `paymentReference`.
4. **JANGAN** auto-create Medini payment record untuk Bukku transaction yang tak match.
5. **Unmatched** → masuk `SYNC_REVIEW` / reconciliation queue, status `UNMATCHED`.

---

## 9. EVENT CONTRACT

Guna canonical event architecture (M1 Fasa 1 `CROSS_DOMAIN_EVENTS`). Tambah sync-specific events:

| Event | Source | Destination | Bila |
|---|---|---|---|
| `PAYMENT_STATUS_UPDATED` | finance | integration → Bukku | Receptionist/HQ confirm payment |
| `INVOICE_CREATED` | finance | integration → Bukku | Invoice issued |
| `INVOICE_UPDATED` | finance | integration → Bukku | Invoice amended |
| `PAYMENT_RECORDED` | integration | finance (CRM projection) | Bukku payment detected |
| `PAYMENT_RECONCILED` | integration | finance/reports | Reconciliation matched |
| `BUKKU_SYNC_COMPLETED` | integration | finance/dashboard | Sync cycle success |
| `BUKKU_SYNC_FAILED` | integration | finance/dashboard (alert) | Sync cycle failed |
| `BUKKU_CONFLICT_DETECTED` | integration | finance (HQ review queue) | Conflict found |

### Event envelope (setiap event)
```json
{
  "eventName": "PAYMENT_STATUS_UPDATED",
  "eventId": "evt-2026-08-14-000123",
  "source": "MEDINI",
  "destination": "BUKKU",
  "payload": { "patientId": "MDN-0042", "invoiceId": "INV-2026-0401", "status": "PAID" },
  "idempotencyKey": "MEDINI:INV-2026-0401:PAYMENT_STATUS_UPDATED:v3",
  "correlationId": "corr-2026-08-14-000123",
  "causationId": "evt-2026-08-14-000120",
  "syncDirection": "MEDINI_TO_BUKKU",
  "timestamp": "2026-08-14T10:30:00+08:00",
  "version": 3
}
```

---

## 10. IDEMPOTENCY STRATEGY

**Jaminan:** Event yang sama diterima dua kali → hanya SATU financial operation.

### Idempotency key (deterministic)
```
idempotencyKey = sourceSystem + ":" + entityId + ":" + operationType + ":" + version

Contoh:
  MEDINI:INV-2026-0401:PAYMENT_STATUS_UPDATED:v3
  MEDINI:INV-2026-0401:INVOICE_CREATED:v1
```

### Mekanisma
1. **Processed-event registry** (persistent, server-side): setiap `idempotencyKey` yang dah diproses disimpan.
2. Sebelum execute → check registry. Kalau wujud → **skip, return cached result**. Kalau baru → execute + register.
3. **Duplicate detection:** Bukku side, gunakan unique constraint pada `number` (invoice) / reference. Kalau POST duplicate → Bukku return existing, bukan create baru.
4. **Retry behaviour:** retry dengan **SAMA** idempotency key → safe, tak double-post.
5. **Version:** setiap entity ada version counter. Update hanya kalau version lebih tinggi (optimistic concurrency).

### Contoh
```
PAYMENT_STATUS_UPDATED (INV-2026-0401, v3)
  → registry check: MEDINI:INV-2026-0401:PAYMENT_STATUS_UPDATED:v3
  → belum wujud → POST /sales/payments → register key
  → (retry) → key wujud → skip, return success cached
```

---

## 11. LOOP PREVENTION

**Masalah:** Medini → Bukku → Medini → Bukku → ∞

### Penyelesaian: event metadata + origin tag

Setiap event ada `sourceSystem` dan `causationId`:

```
1. Receptionist confirm payment
   → emit PAYMENT_STATUS_UPDATED { sourceSystem: "MEDINI", causationId: null }
2. Integration push ke Bukku
   → Bukku invoice status berubah
3. Poller detect perubahan Bukku
   → emit PAYMENT_RECORDED { sourceSystem: "BUKKU", causationId: "evt-asal" }
4. Medini update projection
   → TAPI: sebab causationId wujud DAN sourceSystem=BUKKU,
     Medini TAK emit balik PAYMENT_STATUS_UPDATED
```

### Rules
1. Setiap sync operation tag dengan `syncOrigin` dalam Bukku record metadata (contoh `remarks: "sync:MEDINI:evt-123"`).
2. Bila poller detect perubahan, check `syncOrigin`. Kalau origin = MEDINI dan correlationId match operasi sendiri → **suppress re-push**.
3. **Echo suppression window:** selepas push, tandakan entity sebagai `justSyncedBy:MEDINI` untuk tempoh X saat — poller skip entity ni dalam window tu.
4. `causationId` chain: event anak sentiasa refer event induk. Kalau chain balik ke origin yang sama → stop.

---

## 12. CONFLICT RESOLUTION

### Conflict states
```
MATCHED          — dua-dua bersetuju
PENDING_SYNC     — menunggu push/pull
SYNCED           — berjaya diselaraskan
CONFLICT         — nilai bercanggah (auto-detect)
UNMATCHED        — tiada padanan
FAILED           — sync gagal (retryable)
REQUIRES_REVIEW  — konflik kewangan berbahaya, perlu HQ
```

### Conflict scenarios & policy

| Scenario | Detection | Policy | Resolver |
|---|---|---|---|
| Medini=PAID, Bukku=PENDING | status mismatch | **Bukku wins** (financial truth) → Medini projection revert ke PENDING | auto (Bukku) + audit |
| Medini=RM500, Bukku=RM550 | amount mismatch | **REQUIRES_REVIEW** — jangan auto-overwrite | **HQ Finance** |
| Medini patient=A, Bukku patient=B | patient mismatch | **REQUIRES_REVIEW** — jangan auto-link | **HQ Finance** |
| Bukku transaction tiada Medini match | UNMATCHED | masuk SYNC_REVIEW, **jangan auto-create** | HQ Finance |
| Dua Medini record match satu Bukku | duplicate | **REQUIRES_REVIEW** | HQ Finance |

### Prinsip
- **Financial field conflict** (amount, payment reference, transaction ID) → **HQ Finance review**, bukan silent overwrite.
- **Status conflict** → Bukku wins (Bukku = financial truth), tapi log + audit.
- **Identity conflict** (patient) → sentiasa manual review.

---

## 13. SYNC STATE MACHINE

Setiap synchronizable record ada state machine eksplisit:

```
                 ┌────────────┐
                 │ LOCAL_ONLY │  (rekod baru dalam Medini, belum sync)
                 └─────┬──────┘
                       │ enqueue
                       ▼
                 ┌────────────┐
                 │PENDING_SYNC│
                 └─────┬──────┘
                       │ worker pickup
                       ▼
                 ┌────────────┐      success       ┌─────────┐
                 │  SYNCING   │ ─────────────────► │ SYNCED  │
                 └─────┬──────┘                    └────┬────┘
                       │                                │
          ┌────────────┼─────────────┐                  │ new version
          │            │             │                  ▼
          ▼            ▼             ▼            ┌────────────┐
      ┌───────┐  ┌──────────┐  ┌──────────┐      │PENDING_SYNC│ (re-sync)
      │FAILED │  │ CONFLICT │  │ TIMEOUT  │      └────────────┘
      └───┬───┘  └────┬─────┘  └────┬─────┘
          │           │             │
          │ retry     │ HQ review   │ retry
          ▼           ▼             ▼
      ┌─────────────────────────────────┐
      │  SYNCING (semula)               │
      └─────────────────────────────────┘
                       
      CONFLICT ──► REQUIRES_REVIEW ──► RESOLVED ──► SYNCED
```

### State transitions
| From | To | Trigger |
|---|---|---|
| LOCAL_ONLY | PENDING_SYNC | event emitted |
| PENDING_SYNC | SYNCING | worker pickup |
| SYNCING | SYNCED | Bukku ACK + ref stored |
| SYNCING | FAILED | network/API error (retryable) |
| SYNCING | CONFLICT | value mismatch detected |
| SYNCING | TIMEOUT | no response |
| FAILED | SYNCING | retry (exponential backoff) |
| TIMEOUT | SYNCING | retry |
| CONFLICT | REQUIRES_REVIEW | dangerous field (amount/identity) |
| REQUIRES_REVIEW | RESOLVED | HQ Finance decision |
| RESOLVED | SYNCED | apply resolution |
| SYNCED | PENDING_SYNC | new version |

---

## 14. RECONCILIATION ARCHITECTURE

**Soalan:** "Adakah Medini dan Bukku financially in sync?"

### Detection types
| Jenis | Maksud |
|---|---|
| MISSING_IN_BUKKU | Medini ada, Bukku tiada |
| MISSING_IN_MEDINI | Bukku ada, Medini tiada (→ SYNC_REVIEW, jangan auto-create) |
| AMOUNT_MISMATCH | jumlah berbeza |
| STATUS_MISMATCH | status berbeza |
| PATIENT_MISMATCH | patient berbeza |
| DUPLICATE | dua Medini match satu Bukku |
| UNMATCHED | tiada padanan langsung |

### Modes
- **Automatic:** scheduled (contoh setiap 6 jam), read-only, detect + flag sahaja.
- **Manual:** HQ trigger on-demand (existing `reconRun` pattern).

### Frequency
- Auto: setiap 6 jam (off-peak).
- Manual: bila-bila (HQ only).
- Post-sync: quick recon selepas setiap sync cycle.

### Output
- **Reconciliation report** (existing RECON pattern): MATCHED/MISMATCH/MISSING/UNMATCHED/REVIEWED.
- **Exception queue:** semua non-MATCHED masuk queue untuk HQ review.
- **READ-ONLY by default** — reconciliation takde side effect, hanya detect + report.

### Existing → Target
Existing `reconBuildRecords` (11214) dah detect MISSING_IN_BUKKU/UNMATCHED_BUKKU/MISMATCH. **Target:** kekalkan engine ni, tambah match strategy (primary transaction ID, bukan normalized number sahaja), dan server-side persistence.

---

## 15. REAL-TIME / POLLING ARCHITECTURE

### Bukku API capability (disiasat dari code + docs)

| Capability | Status | Evidence |
|---|---|---|
| Webhooks | **UNVERIFIED** | Tiada dalam code/docs. Hanya WAHA webhook wujud (WhatsApp), BUKAN Bukku. |
| Event notifications | **UNVERIFIED** | Tiada rujukan |
| Updated-at filtering | **UNVERIFIED** | `bukkuPullLive` guna `?page=1&per_page=8` sahaja — tiada `updated_at` filter dalam code |
| Incremental retrieval | **UNVERIFIED** | Belum digunakan |
| Pagination | ✅ **CONFIRMED** | `paging.total` wujud dalam response (10729) |
| Transaction lookup | ✅ **CONFIRMED** | GET `/sales/invoices` (10750) |
| Payment lookup | ⚠️ **PARTIAL** | `/sales/payments` dirujuk dalam field mapping (10856) tapi belum dipanggil |
| Invoice lookup | ✅ **CONFIRMED** | GET `/sales/invoices` |

### Keputusan: **Option C — HYBRID, POLLING primary**

```
PRIMARY:  POLLING (scheduled incremental pull)
          ↓ setiap N minit, cursor-based
SECONDARY: WEBHOOK (kalau Bukku support — UNVERIFIED)
          ↓ real-time push bila Bukku berubah
FALLBACK: MANUAL PULL (HQ trigger, existing bukkuPullLive)
```

**Kenapa polling primary:**
1. Webhook Bukku **UNVERIFIED** — tak boleh bergantung pada benda yang belum tentu wujud.
2. Polling **confirmed working** (pagination + invoice lookup dah REAL).
3. Polling boleh incremental (kalau `updated_at` filter wujud) atau full-page scan (kalau takde).
4. Webhook jadi **enhancement** nanti — kalau Bukku support, tambah sebagai low-latency layer di atas polling.

### Polling design
| Parameter | Cadangan |
|---|---|
| Frequency | setiap **15 minit** (business hours), 1 jam (off-peak) |
| Incremental | `updated_at > lastSyncCursor` (kalau API support — verify) |
| Cursor | `lastSyncCursor` = timestamp/ID rekod terakhir, persistent server-side |
| Pagination | loop `page=1..N` ikut `paging.total`, `per_page=50` |
| Rate limit | respect `429` → exponential backoff (1s, 2s, 4s, 8s, max 60s) |
| Batch | max 100 records/cycle, queue lebih untuk next cycle |

---

## 16. SECURITY ARCHITECTURE

### Credential management
| Aspek | Prototype (sekarang) | Production (target) |
|---|---|---|
| Storage | ⚠️ `localStorage('bukkuCreds')` — **prototype limitation** | Server-side vault (env var / secrets manager) |
| Encryption | ❌ plaintext dalam localStorage | at-rest encryption, TLS in-transit |
| Access | HQ role check dalam SPA | HQ-only + server-side permission |
| Rotation | manual | scheduled rotation + audit |
| Masking | ✅ masked dalam UI (`Saved (masked)`) | kekal masked |

**⚠️ EXPLICIT:** localStorage credential = **PROTOTYPE LIMITATION**. Production: **server-side vault, JANGAN localStorage**. (Ini selaras dengan nota sedia ada dalam code line 1483 dan amaran line 10706.)

### Principles
- **Least privilege:** API key Bukku dengan scope minimum (read invoices, write payments — bukan full admin).
- **HQ-only config:** credential setup/rotation HQ sahaja.
- **Audit trail:** setiap API call log (siapa, bila, apa, result).
- **Request logging:** semua request/response log (mask sensitive field).
- **Sensitive data masking:** API key, reference, partial amount dalam log.
- **Token rotation:** scheduled, dengan graceful rollover.
- **Failure logging:** semua failure log dengan context (tanpa expose secret).

---

## 17. FAILURE & RETRY STRATEGY

| # | Scenario | Behaviour |
|---|---|---|
| 1 | Bukku API unavailable | queue event, retry exponential backoff (1s→2s→4s→8s→60s max), alert selepas N gagal |
| 2 | CRM unavailable | event persist dalam queue, process bila CRM kembali |
| 3 | Network timeout | tandakan TIMEOUT, retry dengan **sama idempotency key** (safe) |
| 4 | Bukku accepts tapi response hilang | retry dengan sama idempotency key → Bukku return existing (duplicate prevention) |
| 5 | Duplicate event | idempotency registry → skip, return cached |
| 6 | Duplicate transaction | Bukku unique constraint → return existing, bukan create baru |
| 7 | Invalid patient mapping | status UNMATCHED → SYNC_REVIEW, **jangan auto-create** |
| 8 | Invalid payment reference | FAILED + audit + SYNC_REVIEW |
| 9 | Amount mismatch | REQUIRES_REVIEW → HQ Finance |
| 10 | Status mismatch | Bukku wins → update projection + audit |
| 11 | Rate limit (429) | exponential backoff, respect `Retry-After` header |
| 12 | Partial sync | resume dari `lastSyncCursor`, tiada re-process yang dah SYNCED |
| 13 | Concurrent update | optimistic concurrency (version check) → conflict kalau version clash |
| 14 | Manual correction dalam Bukku | poller detect → update projection + audit (sourceSystem=BUKKU) |
| 15 | Manual correction dalam CRM | emit event → push ke Bukku (dengan permission check) |

### Retry policy
```
attempt 1: immediate
attempt 2: +1s
attempt 3: +2s
attempt 4: +4s
attempt 5: +8s
attempt 6+: +60s (capped)
max retries: 10 → kemudian DEAD_LETTER + HQ alert
```

---

## 18. AUDIT ARCHITECTURE

Setiap sync operation mesti traceable.

### Audit record
```json
{
  "auditId": "aud-2026-08-14-000456",
  "timestamp": "2026-08-14T10:30:00+08:00",
  "actor": "hq | receptionist | system",
  "action": "push_invoice | pull_payment | reconcile | resolve_conflict",
  "entityType": "invoice | payment | payable",
  "mediniId": "INV-2026-0401",
  "bukkuId": "BK-88231",
  "syncDirection": "MEDINI_TO_BUKKU",
  "idempotencyKey": "MEDINI:INV-2026-0401:...:v3",
  "correlationId": "corr-...",
  "result": "SYNCED | FAILED | CONFLICT | REVIEWED",
  "detail": "..."
}
```

### Principles
- **Immutable:** audit tak boleh edit/delete, hanya append.
- **Complete:** setiap push/pull/conflict/resolve/reconcile ada audit.
- **Traceable:** ikut `correlationId` boleh trace satu operation end-to-end.
- **Retention:** ikut Settings (3/6/12/36 bulan / Forever — existing WAHA retention pattern).
- Existing `bukkuAudit` (10681) + `syncAudit` (10900) + `reconAudit` (11207) → consolidate ke satu audit stream dalam Integration Layer.

---

## 19. API DEPENDENCY MATRIX

| Bukku Endpoint | Method | Guna untuk | Status sekarang |
|---|---|---|---|
| `/sales/invoices` | GET | pull invoices, test conn, reconciliation | ✅ REAL (10729, 10750) |
| `/sales/invoices` | POST | push invoice (M→B) | ✅ REAL (10797, gated) |
| `/sales/payments` | POST | push payment (M→B) | ⚠️ dirujuk, belum dipanggil |
| `/sales/payments` | GET | pull payment (B→M) | ⚠️ belum digunakan |
| `/purchases/bills` | POST | push payable | ⚠️ field mapping sahaja |
| `/journal_entries` | POST | push commission | ⚠️ field mapping sahaja |
| `/contacts` | GET/POST | patient ↔ contact mapping | ❌ belum digunakan |

**Nota:** endpoint POST push payment/payable/commission perlu verify dengan Bukku API docs sebelum implementation. Yang REAL sekarang: GET+POST `/sales/invoices` sahaja.

---

## 20. PRODUCTION READINESS GAP

| # | Gap | Severity | Usaha |
|---|---|---|---|
| 1 | Credential dalam localStorage | **P0** | Pindah ke server-side vault |
| 2 | Tiada idempotency registry | **P0** | Server-side persistent store |
| 3 | Tiada loop prevention metadata | **P0** | Event envelope + origin tag |
| 4 | Tiada backend Integration Layer | **P0** | Server (post-M1/backend phase) |
| 5 | Payment status mapping (Bukku↔CRM) belum | **P1** | Deterministic mapping table |
| 6 | Polling scheduler tiada | **P1** | Server cron/worker |
| 7 | Incremental cursor tiada | **P1** | Persistent `lastSyncCursor` |
| 8 | Webhook UNVERIFIED | **P1** | Verify Bukku docs / support |
| 9 | Reconciliation match lemah (normalized number) | **P1** | Primary transaction ID match |
| 10 | Rate-limit handling tiada | **P2** | Backoff + Retry-After |
| 11 | POST payment/payable endpoint belum verify | **P2** | Bukku API docs |
| 12 | Two-way sync masih SIMULATED | **P1** | Real pull + push cycle |

---

## 21. IMPLEMENTATION PHASES

> **DO NOT IMPLEMENT YET.** Fasa ni untuk approval, kemudian execute selepas M1-M3 siap.

```
PHASE 0 — ARCHITECTURE (INI) ✅
   Dokumen ni. Contract, mapping, state machine, security.

PHASE 1 — CONTRACT & MAPPING
   SYNC_MAP store, event envelope, idempotency key scheme,
   payment status mapping table (Bukku state ↔ PENDING/PAID/OVERDUE).
   Dependency: M1 contract layer (DAH ADA).

PHASE 2 — READ-ONLY Bukku → Medini
   Polling pull (real), incremental cursor, payment status projection.
   Reconciliation read-only. NO write ke Bukku.
   Dependency: backend poller.

PHASE 3 — MEDINI → BUKKU CONTROLLED WRITE
   Push invoice/payment dengan idempotency + loop prevention.
   Gated (HQ + confirm). Credential vault.
   Dependency: Phase 1 contract + backend.

PHASE 4 — BIDIRECTIONAL SYNC
   Full two-way dengan conflict detection + resolution queue.
   Sync state machine aktif.

PHASE 5 — RECONCILIATION
   Auto + manual recon, exception queue, reporting.

PHASE 6 — PRODUCTION HARDENING
   Rate-limit, retry, monitoring, alerting, webhook (kalau support),
   security audit, credential rotation.
```

**Susunan semasa:** M1 (Fasa 2-3) → M2 (WhatsApp) → M3 (P9 QA) → **Backend** → Bukku Phase 1-6.

---

## 22. TEST STRATEGY

> **Jangan ubah 768 tests sedia ada.** Test baru berasingan (prefix `bk` untuk Bukku sync).

| # | Test | Verify |
|---|---|---|
| bk01 | successful Medini→Bukku sync | invoice push → Bukku ID disimpan |
| bk02 | successful Bukku→Medini sync | pull → projection updated |
| bk03 | duplicate event | idempotency → satu operation sahaja |
| bk04 | duplicate transaction prevention | POST duplicate → return existing |
| bk05 | retry | FAILED → retry → SYNCED |
| bk06 | timeout | TIMEOUT → retry sama key → safe |
| bk07 | conflict | amount mismatch → REQUIRES_REVIEW |
| bk08 | unmatched record | → SYNC_REVIEW, no auto-create |
| bk09 | amount mismatch | HQ review, no silent overwrite |
| bk10 | status mismatch | Bukku wins → projection revert |
| bk11 | loop prevention | echo event suppressed |
| bk12 | idempotency | same key → cached result |
| bk13 | reconciliation | detect MISSING/MISMATCH/UNMATCHED |
| bk14 | permission enforcement | non-HQ tak boleh push |
| bk15 | branch scope | BM own branch sync sahaja |
| bk16 | audit trail | setiap operation logged |

---

## 23. ARCHITECTURE RISKS

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Webhook tak disokong Bukku | Sederhana | Sederhana | Polling primary (dah decide) |
| Credential leak (localStorage) | Tinggi (prototype) | **Tinggi** | Server vault (Phase 6) — **rotate key sekarang** (dah expose dalam chat) |
| Double posting | Rendah (dengan idempotency) | **Tinggi** | Idempotency registry + unique constraint |
| Infinite loop | Rendah (dengan metadata) | Sederhana | Loop prevention (section 11) |
| Amount mismatch silent overwrite | Rendah | **Tinggi** | REQUIRES_REVIEW + HQ approval |
| Rate limit dari polling | Sederhana | Rendah | Backoff + batch + cursor |
| Identity mismatch (patient) | Sederhana | Sederhana | Multi-key matching + manual review |
| SPA-based sync (tiada backend) | Tinggi (sekarang) | Sederhana | Backend Integration Layer (Phase 1+) |

---

## 24. FINAL RECOMMENDATION

### Keputusan utama
1. **Source of truth:** Bukku = financial, Medini = operational. **Per-field ownership** (section 5), bukan blanket.
2. **Sync direction:** **Bidirectional**, dengan hierarchy — Bukku wins untuk financial fields, Medini wins untuk operational masters.
3. **Real-time/Polling:** **Option C — Hybrid, POLLING primary** (webhook UNVERIFIED).
4. **Conflict:** Dangerous financial fields → **HQ Finance review**, bukan auto-overwrite. Status → Bukku wins.
5. **Idempotency:** deterministic key `source:entity:operation:version` + persistent registry.
6. **Loop prevention:** `sourceSystem` + `causationId` + echo suppression window.
7. **Security:** server-side vault (JANGAN localStorage production), HQ-only, least privilege.

### Tindakan segera (bukan implementation)
- ⚠️ **ROTATE Bukku API key** — key dah expose dalam chat 13 Ogos (noted dalam memory). Ini housekeeping security, bukan architecture change.
- ✅ Verify Bukku webhook support dengan Bukku docs/support (tandakan UNVERIFIED sekarang).

### JANGAN
- ❌ Jangan implement sekarang (architecture phase sahaja).
- ❌ Jangan ubah existing Bukku P4 Real API.
- ❌ Jangan bina payment gateway / FPX / card processing.
- ❌ Jangan auto-create Medini record dari unmatched Bukku transaction.
- ❌ Jangan start M1 Fasa 2 / backend berdasarkan dokumen ini tanpa approval.

---

## 🚦 ARCHITECTURE GATE

| Item | Status |
|---|---|
| Architecture documented (24 sections) | ✅ |
| Current state audited (REAL/SIMULATED/MISSING) | ✅ |
| Source-of-truth per field defined | ✅ |
| Identity mapping contract | ✅ |
| Idempotency strategy | ✅ |
| Loop prevention | ✅ |
| Conflict resolution | ✅ |
| Sync state machine | ✅ |
| Reconciliation | ✅ |
| Real-time/polling decision (Hybrid, polling primary) | ✅ |
| Security (server vault target) | ✅ |
| Implementation phases (0-6) | ✅ |
| Test plan (bk01-16) | ✅ |
| Existing Bukku P4 protected | ✅ |
| 768 tests untouched | ✅ |

**ARCHITECTURE STATUS = COMPLETE (DESIGN ONLY)**

**STOP.** Menunggu approval eksplisit sebelum:
- M1 Fasa 2 (Connection)
- Bukku sync implementation (Phase 1+)
- Backend

Tiada kod diubah dalam task ini. 768 tests kekal hijau.
