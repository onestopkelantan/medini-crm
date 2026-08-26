# SPRINT 6 — FINAL LOCK RECORD

Status: 🔒 **FORMALLY LOCKED** — 2026-08-17 (CI green, HEAD `542e5b8`)

---

## PART 1 — GOVERNANCE DECISION

Bos + ChatGPT telah mengkaji:

1. Sprint 6 implementation report dari Neo;
2. Keputusan S6-T1 hingga S6-T5;
3. Independent GLM 5.3 forensic audit;
4. Repository state;
5. Test results;
6. CI result;
7. Migration replay;
8. Security/RBAC/RLS evidence.

Keputusan governance muktamad:

> 🟢 **SPRINT 6 APPROVED**
> 🔒 **SPRINT 6 LOCKED**

Ini ialah status release/lock rasmi Sprint 6.

---

## PART 2 — SPRINT 6 OBJECTIVE & SCOPE (DELIVERED)

**Sprint 6 = WhatsApp Hub Production Foundation** — backend production untuk
channels, conversations, messages, assignments, templates, safety engine,
device health, AI response queue state, human handoff. WAHA simulated only.

### S6-T1 — WhatsApp Domain Foundation
- Module `backend/src/modules/whatsapp/` (application/domain/infrastructure/presentation)
- Migration `0013_whatsapp_foundation.sql`
- 6 tables + 8 enums + RLS ENABLE+FORCE + 6 policies + 16 grants
- CI migration loop updated

### S6-T2 — Channels + Conversations + Messages
- REST APIs, ambiguity-safe patient phone matching (`PatientsReadPort.findByPhone`)
- Mandatory message idempotency (service + DB unique backstop + replay detection)
- Bounded pagination (max 100)

### S6-T3 — Assignment + Templates + Human Handoff
- Append-only assignment history
- Lifecycle actions with `SELECT … FOR UPDATE` row locking
- Deterministic AI↔HUMAN transitions

### S6-T4 — Safety Engine + Device Health + AI Queue State
- Six locked gates (M2 verbatim): channel availability, health ≥ 70, daily cap 50,
  sending window 09:00–18:00 MYT, 60s cooldown, auto-pause every 25
- Blocked decisions persisted out-of-transaction (compliance record survives rollback)
- Device health score + band (healthy/ready/warming/critical)
- AI response queue state machine (state foundation only)

### S6-T5 — Verification & Hardening
- Full regression, RLS live probes, concurrency tests, clean PG16 replay,
  typecheck/lint/build, secrets scan, frontend untouched

---

## PART 3 — FINAL REPOSITORY BASELINE

| Item | Value |
|---|---|
| Sprint 6 start | `2e30252c3fe6c4c5215d7c178e5285aad82dab5a` |
| **Sprint 6 final implementation** | **`542e5b8ee636d350c460b79fc624a83b2ba733f4`** |
| Lock record commit | (this commit) |
| Branch | `main` |
| HEAD == origin/main | ✅ |
| Working tree | ✅ clean |

---

## PART 4 — FINAL TEST BASELINE

> **380/380 tests PASS** (54 files, 0 skipped, env-loaded, 3× consecutive)

| Check | Result |
|---|---|
| Typecheck | ✅ PASS |
| Lint | ✅ PASS |
| Build | ✅ PASS |
| Secrets scan | ✅ PASS |
| Clean PostgreSQL replay 0000→0013 | ✅ PASS (55 tables, 119 FKs, 226 indexes) |
| CI GitHub | ✅ GREEN (`542e5b8`) |

---

## PART 5 — API SURFACE

**24 REST endpoints** under `/api/v1/whatsapp/…` (verified count):

- Channels: create, list, status transition, health read, health update (5)
- Conversations: create, list, get, list messages, create message, assign,
  unassign, handoff, return-to-ai, resolve, reopen, archive, ai-queue start,
  ai-queue transition (14)
- Messages: status transition (1)
- Templates: list, create, update (3)
- Safety decisions: list (1)

---

## PART 6 — RBAC DECISION D1 (FINAL)

| Role | WhatsApp |
|---|---|
| HQ | Full (all branches) |
| Branch Manager | Branch |
| Branch Admin / Receptionist | Branch |
| **Doctor** | **NONE** |

Implemented via canonical `ROLE_DOMAIN_MATRIX` minimal amendment
(`architecture.contract.ts`) + RLS policy absence (doctor not in any wa_*
policy) + contract test. No parallel permission system, no frontend reliance.

**Branch isolation evidence:** BM foreign-branch list returns empty (RLS);
cross-branch get/reply denied at DB layer; HQ cross-branch visibility verified;
direct-DB doctor probe returns 0 rows.

---

## PART 7 — SECURITY / BOUNDARY EVIDENCE

- **Finance boundary:** no finance/payment/invoice/bukku references in S6 module ✅
- **Frontend:** `CURRENT-MEDINI-REVIEW.html` MD5 `84f3993af955af666d263f364cb37eb6` unchanged ✅
- **WAHA transport:** intentionally deferred to Sprint 8 (simulated state only) ✅
- **AI decision logic:** deferred to Sprint 7 ✅
- **Outbox/worker/queue:** deferred to Sprint 8 ✅
- **RLS:** ENABLE+FORCE on all 6 wa tables; no DELETE grants ✅
- **1 branch = 1 WhatsApp channel:** `wa_channels_branch_active_uq` partial unique ✅
- **Archived conversations:** terminal (governance §10) ✅
- **Message idempotency:** mandatory key + DB unique backstop ✅

---

## PART 8 — INDEPENDENT GLM 5.3 AUDIT

| Item | Value |
|---|---|
| Auditor | GLM 5.3 |
| Mode | READ-ONLY forensic audit |
| Score | 9/10 |
| Verdict | 🟢 APPROVE FOR CHATGPT/BOS GOVERNANCE REVIEW |
| P0 | 0 |
| P1 | 0 |

### Carry-forward debt (documented, NOT fixed in S6)

- **N6-1 / N5-1** — Drizzle migration journal tracking (manual-apply CI pattern)
- **N6-2 / N5-6** — RLS org_id predicate hardening
- **N6-3** — Safety auto-pause resume mechanism — **P3, MANDATORY remediation before Sprint 8**
- **N6-4** — transitionMessage row lock
- **N6-5** — enum filter validation
- **N6-6** — safety_decisions.message_id FK / actor_id
- **N6-8** — assignment history GET endpoint

These remain documented deferred items; no silent fixes were made.

---

## PART 9 — FINAL STATUS

> 🔒 **SPRINT 6 — FORMALLY LOCKED**
> 🛑 **SPRINT 7 — NOT STARTED**

Next: Sprint 7 (AI Manager / AI decision) awaits Bos + ChatGPT governance
instruction. N6-3 must be remediated before Sprint 8 (WAHA/worker).
