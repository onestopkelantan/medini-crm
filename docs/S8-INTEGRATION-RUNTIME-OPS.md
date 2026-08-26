# Sprint 8 — Integration Runtime Operations (F-14)

Production runbook for the S8 integration layer: queues, workers, recovery,
and dead-letter handling. Read this before enabling workers in any
environment.

## 1. Required environment

| Variable | Required | Purpose |
|---|---|---|
| `REDIS_URL` | Yes (workers) | BullMQ queue + worker connection. **Unset = queue disabled mode**: all durable rows are still written (wa_messages `queued`, domain_events unpublished, bukku_sync_records `queued`) and are picked up by the recovery sweep once Redis is configured. |
| `MEDINI_ORG_ID` | Yes (recovery) | Canonical org id used by the recovery scheduler to establish its trusted org scope. |
| `WAHA_BASE_URL` + `WAHA_API_KEY` | WhatsApp sends | WAHA instance. Unset = sends fail non-retryable (`WAHA adapter is not configured`); messages stay `queued`/reconciled later. |
| `BUKKU_API_KEY` + `BUKKU_COMPANY_SUBDOMAIN` | Bukku sync | Unset = adapter returns an honest `error` result; record stays retryable via sweep. |
| `RECOVERY_SWEEP_INTERVAL_MINUTES` | No (default 60) | Interval for the repeatable `recovery-tick` job. |
| `WA_SEND_DELAY_DISABLE` | **Tests only** | Skips the D18 randomized 30–60s send cooldown. Never set in production. |

## 2. Runtime topology

```
API request ──tx──▶ durable row (committed) ──post-commit──▶ BullMQ enqueue
                                                              │
                    recovery-tick (repeatable, hourly) ◀──────┘ (if Redis was
                    │                                              down, sweep
                    ▼                                              re-enqueues)
        ┌───────────┴────────────┬──────────────────┬─────────────────┐
        ▼                        ▼                  ▼                 ▼
 whatsapp-send worker     recall-due worker   bukku-sync worker  domain-events
 (D18 30–60s delay,       (scheduleDue →      (TX1 claim → HTTP   (outbox events +
  contact_phone→chatId,    process-recall)     outside TX → TX2)   recovery-tick)
  idempotent confirm)
```

All workers run under the `system_worker` RLS identity with an explicit
org+branch scope (migration 0017). There is no cross-org discovery anywhere.

## 3. Failure modes and what happens

| Failure | Behaviour | Recovery |
|---|---|---|
| Redis down at enqueue time | DB row committed; enqueue lost | Hourly `recovery-tick` sweep re-enqueues (`reconcileQueuedMessages`, `ScopedOutboxRecovery.reconcile`, `scheduleDue`, `reconcilePendingSyncs`). BullMQ `jobId` dedupes. |
| WAHA 429/5xx/timeout | `WahaError(retryable)` → BullMQ retries ×5, exponential backoff (2s start) | After 5 attempts → `markWorkerSendFailed` → message `failed` + `last_error`, job stays in Redis failed set |
| WAHA 4xx (client/auth) | Non-retryable → message marked `failed` immediately | Human fixes config; re-queue via `reconcileQueuedMessages` only covers `queued`, so re-send via API |
| Bukku error | record `error`, `retry_count++` | Sweep re-enqueues while `retry_count < 5` |
| Channel auto-paused (25 sends) | Worker refuses to send (throws) | Auto-resume after 15 min (`autoResumeExpiredChannels` in the sweep) or manual `POST /channels/:id/resume-auto-pause` |

## 4. Dead-letter (DLQ) policy

BullMQ jobs that exhaust 5 attempts are **retained** (`removeOnFail: false`)
in the Redis failed set — that set IS the DLQ.

- **Inspect:** Bull Board or `Queue.getFailed()` per queue
  (`whatsapp-send`, `bukku-sync`, `recall-due`, `domain-events`).
- **Durable fallback:** every failed job also leaves a queryable DB footprint —
  `wa_messages.status='failed'` (+`last_error`), `bukku_sync_records.sync_status='error'`,
  unpublished `domain_events`. The DB is the audit-grade DLQ; Redis is the
  operational one.
- **Re-drive:** fix root cause, then either retry the failed BullMQ job or
  wait for the hourly sweep (it re-enqueues `queued`/retryable records with
  the same `jobId`, so no duplicates).

## 5. Migration order

`0000 → 0021` (0017 worker RLS, 0018 WhatsApp transport lifecycle,
0019 recovery scheduler foundation, 0020 wa_conversations worker read-only,
0021 sale_records/patients worker read-only). Apply with
`psql ON_ERROR_STOP=1` exactly as `ci.yml` does; never skip 0017 (workers
would have no RLS grants).

### Worker least-privilege matrix (post-0021)

| Table | system_worker access |
|---|---|
| wa_channels, wa_messages, recall_cases, bukku_sync_records, domain_events, processed_events | read/write (scoped) |
| wa_conversations, sale_records, patients | **SELECT only**, org+branch scoped |
| all other domain tables | **DENY** (blanket `s8_worker_exclusion`) |

D18 cooldown governance: see `docs/S8-D18-GOVERNANCE.md`.
