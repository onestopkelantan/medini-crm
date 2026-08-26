# SPRINT 5 — FINAL LOCK RECORD

Status: 🔒 **LOCKED** — 2026-08-17 (CI green, HEAD `7c3df7e`)

---

## PART 1 — GOVERNANCE DECISION

Bos + ChatGPT telah mengkaji:

1. Sprint 5 implementation report dari Neo;
2. Keputusan S5-T1 hingga S5-T5;
3. Independent GLM 5.3 forensic audit;
4. Repository state;
5. Test results;
6. CI result;
7. Migration replay;
8. Security/RBAC/RLS evidence.

Keputusan governance muktamad:

> 🟢 **SPRINT 5 APPROVED**
> 🔒 **SPRINT 5 LOCKED**

Ini ialah status release/lock rasmi Sprint 5.

---

## PART 2 — SPRINT 5 SCOPE (DELIVERED)

### S5-T1 — Marketing Domain Foundation

- Lead
- Campaign
- Recall Rule
- Recall Case
- Follow-up Case
- Lifecycle/state machines (deterministic)
- RBAC (locked conservative policy)
- RLS (ENABLE+FORCE)
- Audit (same-transaction)
- Idempotency (recall case)
- REST API v1
- Migration `0011_marketing_foundation.sql`

### S5-T2 — Operations Domain Foundation

- Doctor Status (append-only history)
- Checklist
- Task
- Incident
- Lifecycle/state machines (deterministic)
- RBAC
- RLS
- Audit
- Idempotency (task, incident)
- Migration `0012_operations_foundation.sql`

### S5-T3 — LabCase / Finance Boundary

- Operations-owned `lab_cases`
- LabCase lifecycle: `open → in_progress → ready_for_billing → billing_submitted → completed`
- Billing submission state (actor + timestamp stamped)
- Finance boundary protection

**Explicit boundary:**

> Operations does NOT create, approve, modify or pay Finance `lab_payables`.

Finance remains the authoritative owner of: lab payable, approval, payment.

No payment processing was added. Sprint 5 contains no Finance write path from Operations (verified via method-surface test).

### S5-T4 — Cross-Domain Read Contracts

- PatientsReadPort usage
- ClinicalReadPort usage
- Appointment/reference validation (appointment belongs to patient)
- Patient ownership validation
- Encounter ownership validation
- Read-only cross-domain consumption
- No source-of-truth duplication

### S5-T5 — Verification & Hardening

- Full regression
- RLS tests (live DB-layer probes)
- RBAC tests
- Audit tests
- Idempotency tests
- Concurrency/live probes
- Migration replay (clean PG16)
- Typecheck / Lint / Build
- Secrets scan
- CI migration-loop verification

---

## PART 3 — FINAL REPOSITORY BASELINE

| Item | Value |
|---|---|
| Sprint 5 start | `dbf41a2c080b62a965afca7d64093b0d69eaea9f` |
| S5-T1 | `8e0d908516dc35ec6fa852f2abc72254b91bfdcd` |
| **Sprint 5 final** | **`7c3df7e396957ae430c372d92c532c75582de8a7`** |
| Branch | `main` |
| HEAD == origin/main | ✅ |
| Working tree | ✅ clean, no uncommitted changes |

---

## PART 4 — FINAL TEST BASELINE

> **352/352 tests PASS**

- 52 test files
- 0 skipped (env-loaded full run)
- PostgreSQL-backed integration tests executed
- S5 live integration tests passed
- RLS tests passed (cross-branch denial verified at DB layer)
- RBAC tests passed
- Idempotency tests passed
- Lifecycle tests passed
- Audit tests passed

| Check | Result |
|---|---|
| Typecheck | ✅ PASS |
| Lint | ✅ PASS |
| Build | ✅ PASS |
| Secrets scan | ✅ PASS |
| Clean PostgreSQL replay | ✅ PASS |
| CI | ✅ GREEN (`7c3df7e`) |

---

## PART 5 — DATABASE BASELINE

Migration range: `0000 → 0012`

Final verified state:

- 49 tables
- 49 RLS-enabled tables
- 103 foreign keys
- 203 indexes
- 141 grants
- S5 migrations 0011 and 0012 replayed cleanly
- Clean database replay passed (fresh PG16 container)
- No migration residue
- No test residue

Schema is not altered by this record.

---

## PART 6 — SECURITY BASELINE

Sprint 5 preserved the locked RBAC contract.

| Domain | HQ | Branch Manager | Branch Admin / Receptionist | Doctor |
|---|---|---|---|---|
| Marketing | Full | Branch | NONE | NONE |
| Operations | Full | Branch | NONE | NONE |

> `architecture.contract.ts` was NOT amended for Sprint 5.

- PermissionGuard unchanged
- ScopeService unchanged
- No parallel permission system
- No assigned-record bypass
- Frontend is not used as a security boundary

RLS: ENABLED, FORCED, live-tested, cross-branch isolation verified.

---

## PART 7 — INDEPENDENT GLM 5.3 AUDIT

| Item | Value |
|---|---|
| Auditor | GLM 5.3 |
| Mode | READ-ONLY forensic audit |
| Result | 🟢 APPROVE FOR CHATGPT/BOS GOVERNANCE REVIEW |
| P0 | **0** |
| P1 | **0** |

### P2 findings (deferred — post-lock debt)

- **N5-1** — Drizzle migration journal does not contain 0011/0012; migrations currently applied through CI psql loop (manual-apply pattern, consistent with S3/S4 CI design).
- **N5-6** — S5 RLS policies do not directly predicate `org_id`; organisation isolation is currently compensated by service-layer enforcement (org derived from authenticated principal, never from client input).

### P3 findings (deferred technical debt)

- N5-2 — `lab_cases_billing_once_uq` is effectively a no-op uniqueness index.
- N5-3 — Task/Incident/LabCase idempotency keys are optional.
- N5-4 — Unbounded list endpoints.
- N5-5 — Direct appointments table import in Marketing follow-up validation instead of AppointmentsReadPort.
- N5-7 — Recall Rule active/effective_from validation and missing GET recall-rules endpoint.
- Checklist JSONB/per-item completion limitation.
- Concurrent doctor-status history interleaving note.

---

## PART 8 — DEBT GOVERNANCE

These findings are **NOT Sprint 5 blockers**.

They are classified as:

> **POST-LOCK DEBT / FUTURE HARDENING**

N5-1 and N5-6 remain visible in the debt register. They are NOT silently closed, NOT claimed fixed, and Sprint 5 is NOT reopened for them.

Any future fix = new remediation / future sprint scope, subject to governance approval.

---

## PART 9 — SPRINT 5 BOUNDARIES CONFIRMED

Sprint 5 did NOT implement:

- WhatsApp sending / WAHA transport
- AI workers / AI automation
- Queue / worker / transactional outbox / Redis worker / BullMQ
- Bukku real adapter
- Payment gateway / payment processing / POS / invoice issuer / receipt engine
- Finance P2 remediation
- Reports read models
- Frontend wiring / `CURRENT-MEDINI-REVIEW.html` modification
- X-Ray imaging / Documents storage
- Automatic recall scheduler

These remain future scope.

---

## PART 10 — FRONTEND LOCK

`CURRENT-MEDINI-REVIEW.html` remains unchanged.

MD5 baseline: `84f3993af955af666d263f364cb37eb6` (verified at lock time).

Frontend wiring remains a separate governance item (M-5).

---

## PART 11 — FINANCE BOUNDARY LOCK

> Sprint 5 did not modify the locked Finance ownership boundary established in Sprint 4.

- Operations owns: `lab_cases`
- Finance owns: `lab_payables`, approval, payment lifecycle
- Sprint 5 contains no Finance write path from Operations

---

## PART 12 — DEFERRED BUSINESS DECISIONS

| Decision | Status |
|---|---|
| Lead → Patient conversion | Not implemented — requires future governance decision |
| Automatic Recall Generation | Not implemented — requires future scheduler/worker architecture |
| Frontend Integration (React/tRPC/Nest REST topology) | Not implemented — requires separate governance decision |
| Finance P2 debt | Not absorbed into Sprint 5 |

---

## PART 13 — FORMAL LOCK STATEMENT

> Sprint 5 — Marketing + Operations Production Foundation has completed S5-T1 through S5-T5. Implementation verification, clean database replay, full regression, CI verification and independent GLM 5.3 forensic audit have completed successfully. No P0 or P1 defects were identified. Remaining P2/P3 findings are documented as post-lock technical debt and do not block release. Sprint 5 is therefore formally APPROVED and LOCKED by Bos + ChatGPT governance.

---

## PART 14 — NO REOPENING RULE

Once this Lock Record is created:

- Do NOT reopen Sprint 5
- Do NOT modify Sprint 5 code
- Do NOT add undocumented fixes
- Do NOT alter migrations
- Do NOT change RBAC / RLS / CI
- Do NOT amend locked application commits

Any future modification is new remediation / future sprint scope unless governance explicitly reopens Sprint 5.

---

## PART 15 — NEXT SPRINT BOUNDARY

> **Sprint 6 has NOT started.**

No Sprint 6 implementation is authorised by this Lock Record.

Next phase: **Sprint 6 — Discovery & Architecture Review** (READ-ONLY mode). No coding until Sprint 6 discovery has been reviewed and approved by Bos + ChatGPT.
