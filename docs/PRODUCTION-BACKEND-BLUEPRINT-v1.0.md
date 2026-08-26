# MEDINI CRM — PRODUCTION BACKEND BLUEPRINT v1.0

**Date:** 15 August 2026 · **Author:** Neo (Senior Enterprise Architect) · **Status:** BLUEPRINT ONLY — implementation NOT started.
**Source of Truth:** `MEDINI_ARCHITECTURE` (locked, in `CURRENT-MEDINI-REVIEW.html`) + P9 Final QA & Lock (`docs/P9-FINAL-QA-LOCK.md`).
**Regression baseline:** 966/966 PASS · 0 FAIL · EXIT=0. **Artifact MD5:** `84f3993af955af666d263f364cb37eb6`.

> ⚠️ **This document is an architecture/blueprint deliverable only.** No production code, migration, API implementation, worker, deployment script, or real integration code is created. No credentials rotated. No locked frontend functionality modified. WAHA real transport and Bukku production credentials remain out of source.

---

## 1. Executive Summary

Medini CRM is an **AI-first dental operating system** for Medini Dental Group (14 branches, Malaysia). The frontend single-HTML artifact is a **fully-locked, fully-tested behavioral specification** (966/966). This blueprint translates that locked behavior into a **production-ready backend architecture** that a future implementation agent can build **without making major architectural decisions independently**.

**Headline decisions:**
- **Modular monolith** (NestJS + PostgreSQL + Redis/BullMQ) — NOT microservices. 13 canonical domains map to 13 backend modules in one deployable unit. Justification: team size, KISS principle, transaction integrity across domains, and the absence of independent scaling pressure per domain. Microservices would add operational cost with zero current benefit.
- **Contract-first:** the locked `MEDINI_ARCHITECTURE` (DOMAIN_REGISTRY, ROLE_DOMAIN_MATRIX, DATA_OWNERSHIP, CROSS_DOMAIN_EVENTS, PERMISSION_MATRIX) is ported verbatim into a backend `architecture.contract.ts` and enforced by tests. The backend may not invent behavior the frontend does not already exercise.
- **Server-side authorization is the only security.** Frontend checks are UX. Every request re-derives scope from the authenticated principal.
- **Payment model v1.1 (non-negotiable):** Medini CRM is a **payment STATUS layer** (PENDING/PAID/OVERDUE). Payments happen externally (FPX/Card). The backend never becomes a payment gateway, invoice engine, or receipt engine.
- **Single-tenant, multi-branch.** One organization (Medini Dental Group), 14 canonical branches. Tenant isolation is a schema column (`org_id`) reserved for future SaaS, defaulting to one org.

---

## 2. Current Locked State

| Layer | State |
|---|---|
| Frontend artifact | `CURRENT-MEDINI-REVIEW.html` (V9-based, 13,084 lines) — LOCKED |
| Regression | 966/966 PASS, 0 FAIL, EXIT=0 |
| Contract layer | `MEDINI_ARCHITECTURE` — 13 domains, ROLE_DOMAIN_MATRIX (4 roles × 13 domains), DATA_OWNERSHIP, CROSS_DOMAIN_EVENTS (13), PERMISSION_MATRIX `can()` |
| Branch registry | `MEDINI_MAIN_BRANCHES` — 14 canonical (10 Medini Dental Clinics + 4 affiliated) |
| Roles | `hq`, `branch_manager`, `branch_admin` (≡ `receptionist`), `doctor` |
| Payment model | v1.1 — status layer only (PENDING/PAID/OVERDUE), external processing |
| Bukku | REAL API connector live (pull live, push confirmation-gated); key in localStorage — **ROTATE before production** |
| WAHA | Simulated in blueprint; real transport = production phase |
| HOLD | P3 X-Ray & Documents (client decision) |
| P9 | PASS — `docs/P9-FINAL-QA-LOCK.md` |

---

## 3. Architecture Principles (B0)

1. **Contract is law.** The locked `MEDINI_ARCHITECTURE` is the spec. Backend implements it; it does not reinterpret it. Any contradiction is resolved in favor of the locked artifact or flagged as an Open Decision.
2. **KISS over clever.** Prefer boring, well-understood patterns. No microservices, no service mesh, no event-sourcing unless a requirement forces it.
3. **Modular monolith.** One deployable, 13 domain modules, strict module boundaries enforced by lint (no cross-module imports except via defined ports/events).
4. **Server-side authorization only.** Frontend permission checks are never trusted. Scope is re-derived per request from the DB-backed principal.
5. **Derive, don't duplicate.** Reports/Dashboard never own data; they aggregate from owner modules via read repositories.
6. **Audit everything state-changing.** Immutable audit log with before/after state, actor, role, tenant, branch, correlation ID.
7. **Idempotency everywhere.** All mutations accept an idempotency key; all event consumers are idempotent.
8. **No orphan entities, no circular ownership.** One authoritative owner per record type (DATA_OWNERSHIP).
9. **Graceful degradation.** External integrations (WAHA/Bukku/AI/OCR) are adapters behind ports; core CRM works when they are down.
10. **Explicit over implicit.** Every architectural decision is recorded as an ADR with rationale.

### Production engineering principles
- **Fail fast, log rich, recover safe.** Errors carry a correlation ID; retries are bounded with exponential backoff + DLQ.
- **Config via environment**, never in code. **Secrets via a vault/manager**, never in env files committed to git, never in source.
- **Backward-compatible migrations** (expand → migrate → contract) so deploys are zero-downtime.
- **Observable by default** (structured logs, metrics, traces, health checks).

---

## 4. Technology Stack (B0)

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | **Node.js 20 LTS** | Matches existing prototype tooling (Node 20.20.2 already on VPS), huge ecosystem |
| Framework | **NestJS 10 (TypeScript)** | Modular DI matches 13-domain modular monolith; guards/interceptors map cleanly to PERMISSION_MATRIX; OpenAPI generation |
| Language | **TypeScript 5 (strict)** | Type safety for contracts; `strict: true`, `noUncheckedIndexedAccess` |
| Database | **PostgreSQL 16** | Relational integrity, JSONB for flexible payloads, RLS for scope enforcement |
| ORM | **Drizzle ORM** (already used in prototype `app/api/queries/connection.ts`) | Lightweight, SQL-first, type-safe migrations; aligns with existing prototype direction |
| Queue | **Redis 7 + BullMQ** | Durable jobs, retries, backoff, DLQ, rate limiting for WhatsApp anti-ban |
| Cache | **Redis 7** (shared instance) | Session store, rate-limit counters, analytics cache |
| Auth | **Argon2id** password hashing + **JWT (short-lived) + refresh token (rotating, httpOnly cookie)** | See §10 |
| Validation | **Zod** | Request/response DTO schemas shared with OpenAPI |
| Logging | **Pino** (structured JSON) | Fast, structured, redaction support |
| Metrics/Tracing | **Prometheus + OpenTelemetry** | RED metrics, traces, dashboards |
| Error tracking | **Sentry** | Exception aggregation with correlation IDs |
| Object storage | **S3-compatible (MinIO self-hosted on VPS, or AWS S3)** | X-Ray/Documents/imaging/attachments |
| Container | **Docker + Docker Compose** | Matches VPS (Docker 29.5.3 already present) |
| Reverse proxy | **Nginx** (already serving on VPS) | TLS termination, static, rate-limit, WAF-lite |
| CI/CD | **GitHub Actions** | Build → test → image → deploy to VPS |
| API docs | **OpenAPI 3.1 (from NestJS + Zod)** | Single contract reference for frontend |

**Package strategy:** pinned versions via lockfile; Renovate for controlled updates; no wildcard deps; security audit (`npm audit`, `osv-scanner`) in CI.

---

## 5. Backend Domain Architecture (B1)

Each canonical domain → one NestJS module under `src/modules/<domain>/`. Standard internal layout per module:

```
modules/<domain>/
  <domain>.module.ts
  domain/            # entities, value objects, domain services (pure)
  application/       # use-cases / application services, DTOs (zod), policies
  infrastructure/    # drizzle repositories, mappers, external adapters
  presentation/      # controllers (REST), guards wiring
  <domain>.events.ts # produced/consumed event contracts
```

### Domain → Module map (13 canonical domains)

| # | Domain (canonical) | Module | Owns (DATA_OWNERSHIP) | Read-only? |
|---|---|---|---|---|
| 1 | Dashboard | `dashboard` | dashboardView (aggregation only) | ✅ derive |
| 2 | Patient Management | `patients` | patientMaster | — |
| 3 | Appointment Management | `appointments` | appointmentMaster | — |
| 4 | Clinical | `clinical` | clinicalRecords | — |
| 5 | Documents | `documents` | documentRecords | — |
| 6 | Finance | `finance` | financialRecords | — |
| 7 | Reports & Analytics | `reports` | reports (READ_ONLY) | ✅ derive |
| 8 | Marketing | `marketing` | marketingRecords | — |
| 9 | Operations | `operations` | operationalRecords | — |
| 10 | WhatsApp Hub | `whatsapp` | whatsappRecords | — |
| 11 | AI | `ai` | aiRecords | — |
| 12 | Administration | `admin` | adminRecords | — |
| 13 | Settings | `settings` | settingsRecords | — |

### Per-domain service boundaries (condensed; full per-domain sheets in §27 dependency graph)

- **patients** — entities: `Patient`, `PatientRelationship`, `PatientConsent`, `PatientTimelineEvent`. Services: `PatientService`, `DuplicateDetectionService` (IC/phone match), `RelationshipService`, `RecallEligibilityService` (reads marketing recall rules). Policies: branch-scope read/write; doctor = own-patients (relationship). Events: produces `PATIENT_CREATED/UPDATED`.
- **appointments** — entities: `Appointment`, `AppointmentStatusHistory`, `Chair`, `ScheduleSlot`. Services: `AppointmentService`, `AvailabilityService` (conflict detection: doctor + chair double-book), `QueueService` (day queue). Invariants: status flow `booked→confirmed→checked-in→waiting→called→in-progress→completed|cancelled|no-show` (locked from frontend `APPT_STATUS_FLOW`). Events: `APPOINTMENT_CREATED/COMPLETED`.
- **clinical** — entities: `Encounter`, `Assessment`, `Diagnosis`, `TreatmentPlan`, `TreatmentSession`, `ToothRecord` (FDI), `ClinicalNote` (SOAP), `ConsentRecord`, `ConsentTemplate`, `ClinicalDocument`, `ImagingRecord`, `Prescription`, `AdverseEvent`, `Referral`, `ClinicalTimelineEvent`. Services: `EncounterService`, `TreatmentPlanService` (lifecycle draft→proposed→accepted→active→completed|cancelled), `SafetyGateService` (severe-allergy block), `ConsentGateService`. Governance: signed notes/documents immutable (amendment-only). Events: `TREATMENT_STARTED/COMPLETED`.
- **documents** — entities: `Document`, `DocumentVersion`, `Attachment`, `StorageObject`. Services: `DocumentService`, `StorageService` (S3 port). Versioned, immutable signed docs; access audited.
- **finance** — entities: `Invoice`, `Payment` (STATUS only), `Expense`, `Payable`, `RecurringCommitment`, `CommissionLedger`, `CommissionPayout`, `TreatmentCost`, `LabPayable`, `FinanceAlert`, `FinancialRadarItem`, `BukkuSyncRecord`, `ReconciliationRecord`. Services: `InvoiceService`, `PaymentStatusService` (PENDING/PAID/OVERDUE — confirm only), `CommissionEngine` (Base = Revenue − DirectCosts; Commission = Base × Rate — LOCKED formula), `LabPayableService` (lifecycle DRAFT→OUTSTANDING→PARTIALLY_PAID→PAID|VOID, overpayment blocked), `RadarService`, `BukkuAdapter` (port). Events: `PAYMENT_STATUS_UPDATED`, `BILL_*`.
- **reports** — read repositories aggregating from owner modules; canonical `RPT_KPIS` registry; no writes. Read-only.
- **marketing** — entities: `Lead`, `Campaign`, `CampaignTemplate`, `RecallRule`, `FollowUp`, `AudienceSegment`. Services: `AudienceService` (validation: dedupe/invalid/opt-out — LOCKED), `RecallService` (RecallDate = LastVisit + Interval — LOCKED), `CampaignIntentService` (creates intent; hands delivery to whatsapp). Events: `RECALL_DUE`.
- **operations** — entities: `DoctorStatus`, `ChecklistItem`, `Task`, `Incident`, `LabCase`, `OpsAlert`. Services: `DoctorStatusService` (auto from appointments + manual override w/ mandatory reason + audit), `IncidentService` (resolve requires resolutionNote).
- **whatsapp** — entities: `WaChannel`, `WaConversation`, `WaMessage`, `WaAssignment`, `WaTemplate` (quick replies), `WaSafetyConfig`, `WaSendLog`, `WaBlockedLog`, `ConversationQueueItem`. Services: `ConversationService`, `AntiBanSafetyEngine` (5 gates: health≥70, daily cap, window 9–18, interval, auto-pause — LOCKED), `DeviceHealthService` (0–100 score), `HumanHandoffService`, `WahaAdapter` (port, real impl = production). Events: `WHATSAPP_MESSAGE_RECEIVED`.
- **ai** — entities: `AiAgent`, `CapabilityMatrix`, `KnowledgeItem`, `Automation`, `Guardrail`, `ApprovalRule`, `AiAuditLog`. Services: `AgentGovernanceService` (enable/pause gates domain features), `ApprovalService` (AP-3 campaign send HIGH risk = human), `AiProviderAdapter` (port). Governance only; AI experience stays in domains. Events: `AI_ESCALATED`.
- **admin** — entities: `Staff`, `RoleAssignment` (versioned), `Branch`, `GovernanceAudit`. Services: `StaffService` (HQ-only, last-HQ guard, no self-deactivate/self-role-change, username immutable, deactivate≠delete).
- **settings** — entities: `ConfigEntry`, `ConfigVersion`, `BranchOverride`, `IntegrationConfig`. Services: `ConfigService` (5-level hierarchy System→Org→Branch→Role→Feature; branch override wins; locked configs flagged). Secrets masked (write-only), stored encrypted.
- **dashboard / reports** — read-only aggregation services + cache; never own data.

### Cross-domain communication rule
Modules never import each other's repositories. They communicate via (a) **read ports** for queries (e.g. finance reads clinical treatment cases via `ClinicalReadPort`), and (b) **domain events** for reactions. `DATA_OWNERSHIP` forbids any module mutating another's tables.

---

## 6. Service/Module Architecture (B1)

- **Ports & Adapters (hexagonal-lite).** External systems (WAHA, Bukku, AI, OCR, storage) sit behind interfaces in `application/ports/`, implemented in `infrastructure/adapters/`. Core domain logic is adapter-agnostic.
- **Shared kernel (`src/shared/`):** `architecture.contract.ts` (ported MEDINI_ARCHITECTURE), `ScopeService` (branch/role/doctor scope resolution), `AuditService`, `IdempotencyService`, `DomainEventBus` (in-process emitter → outbox), `Guard base classes`, `pagination/filter/sort` helpers.
- **No God-services.** A service owns one aggregate's lifecycle.
- **Module boundary lint:** `eslint-plugin-boundaries` blocks `modules/a` importing `modules/b/infrastructure`. Only `application/ports` + events are cross-module.

---

## 7. Database Architecture (B2)

### Strategy
- **One PostgreSQL 16 database**, schema `public` for shared + per-domain table naming (`patients.*` via table prefix, not separate DBs — KISS).
- **Tenant isolation:** every business table carries `org_id` (default single org `medini-dental-group`) + `branch_id` where scoped. Reserved for future multi-tenant.
- **Branch isolation:** enforced twice — (1) application `ScopeService` injects `branch_id` filters, (2) **Postgres Row-Level Security (RLS)** as defense-in-depth on scoped tables using a session GUC (`app.branch_ids`, `app.role`).
- **Soft delete:** `deleted_at` timestamptz on mutable business records. Clinical signed notes/documents/imaging/consents are **hard-immutable** (no delete; amendment creates new version).
- **Audit fields on every table:** `created_at`, `created_by`, `updated_at`, `updated_by`, plus `org_id`, `branch_id`.
- **IDs:** `uuid` PKs (`gen_random_uuid()`), plus human codes (MRN `MDN-####`, `INV-2026-####`, `APT-####`) as unique natural keys.

### Canonical entity/data model (representative — full DDL in migration phase)

Core:
- `branches(id, org_id, code, short_name, full_name, location, type, status)` — seeded from `MEDINI_MAIN_BRANCHES` (14).
- `staff(id, org_id, branch_id, name, username UNIQUE, email, role, status, specialization)` — username immutable.
- `role_assignments(id, staff_id, role, branch_id, effective_from, status ACTIVE|SUPERSEDED, assigned_by)` — versioned.
- `patients(id, org_id, branch_id, mrn UNIQUE, name, ic UNIQUE, dob, gender, nationality, phone, whatsapp, patient_type, contact_type, guardian_id, registration_reason, preferred_contact, last_visit_at, status, balance_cache)`.
- `patient_relationships(id, org_id, patient_id, related_patient_id, type, reciprocal_type)`.
- `appointments(id, org_id, branch_id, code UNIQUE, patient_id, doctor_id, chair_id, treatment_id, scheduled_date, scheduled_time, duration_min, status, notes)` + `appointment_status_history(id, appointment_id, from_status, to_status, changed_by, changed_at)`.
  - **Invariant checks:** `CHECK (status IN (...9 statuses))`; exclusion constraint preventing double-book of `(doctor_id, scheduled_date, scheduled_time)` and `(chair_id, scheduled_date, scheduled_time)` where status not in (cancelled,no-show).
- `treatment_catalog(id, code, name, category, source builtin|custom, price, xray_required, specialist_required)`.
- Clinical: `encounters`, `assessments`, `diagnoses`, `treatment_plans`, `treatment_sessions`, `tooth_records(patient_id, fdi, condition, surfaces[])`, `clinical_notes(immutable)`, `consent_templates(versioned)`, `consent_records`, `clinical_documents`, `imaging_records`, `prescriptions`, `adverse_events`, `referrals`.
- Finance: `invoices`, `payment_status(patient_id, status PENDING|PAID|OVERDUE, paid_date, updated_by, payment_reference)`, `expenses`, `payables`, `recurring_commitments`, `commission_ledger`, `commission_payouts`, `treatment_costs`, `lab_payables`, `finance_alerts`, `financial_radar_items`, `bukku_sync_records`, `reconciliation_records`.
- Marketing: `leads`, `campaigns`, `campaign_templates`, `recall_rules`, `follow_ups`, `audience_segments`.
- Operations: `doctor_statuses`, `checklist_items`, `tasks`, `incidents`, `lab_cases`.
- WhatsApp: `wa_channels`, `wa_conversations`, `wa_messages`, `wa_assignments`, `wa_templates`, `wa_safety_configs`, `wa_send_logs`, `wa_blocked_logs`, `conversation_queue_items`.
- AI: `ai_agents`, `ai_capability_matrix`, `ai_knowledge`, `ai_automations`, `ai_guardrails`, `ai_approval_rules`.
- Settings: `config_entries`, `config_versions`, `branch_overrides`, `integration_configs` (secrets encrypted via pgcrypto / external vault).
- Cross-cutting: `audit_log(id, org_id, branch_id, actor_id, actor_role, action, entity, entity_id, before_jsonb, after_jsonb, source, correlation_id, created_at)` — append-only; `domain_events(id, type, payload_jsonb, occurred_at)` (outbox); `processed_events(consumer, event_id, processed_at)` (idempotency).

### Integrity
- **FKs** on all relationships; `ON DELETE RESTRICT` for master data; `ON DELETE CASCADE` only for owned children (e.g. status history).
- **Unique constraints:** MRN, IC, invoice code, appointment code, username, Bukku idempotency key.
- **Check constraints:** status enums, non-negative amounts, commission rate `0–1`, health score `0–100`, due-date chronology.
- **Indexes:** `(org_id, branch_id)` on every scoped table; `(patient_id)`, `(doctor_id, scheduled_date)`, `(status)`, `(due_date)`, GIN on `audit_log.before_jsonb/after_jsonb`, FTS index on `patients(name)`, `wa_messages(body)`.
- **No orphan entities:** every record traces to an owner per DATA_OWNERSHIP; referential integrity enforced.

### Transactions & concurrency
- **Unit of Work per use-case**; multi-write operations wrapped in `SERIALIZABLE` or `REPEATABLE READ` transactions as needed.
- **Optimistic locking** via `version` column on high-contention rows (appointments, conversations, commission ledger).
- **Idempotency keys** stored with unique index to make retries safe.

### Migration / backup / retention
- **Migrations:** Drizzle Kit, expand→migrate→contract; every migration reversible; run in CI before deploy.
- **Backup:** nightly `pg_dump` (or WAL-G base backups) to off-box storage; PITR via WAL archiving. **Restore drill** quarterly.
- **Retention:** audit_log + domain_events retained per WhatsApp retention config (3/6/12/36mo/Forever, default 12) + clinical records per Malaysian medical-record retention (≥7 years); documented per-entity retention table.

---

## 8. Canonical Data Model

Delivered as the entity list in §7 + a generated **ERD (dbdiagram.io/DBML)** artifact at implementation time. The **canonical registry of record types → owner module** mirrors `DATA_OWNERSHIP` exactly:

```
patientMaster→patients · appointmentMaster→appointments · clinicalRecords→clinical
documentRecords→documents · financialRecords→finance · marketingRecords→marketing
operationalRecords→operations · whatsappRecords→whatsapp · aiRecords→ai
adminRecords→admin · settingsRecords→settings · dashboardView→dashboard(derive) · reports→READ_ONLY(derive)
```

**Relationship spine:** `branches 1—N staff`, `branches 1—N patients`, `patients 1—N appointments`, `patients 1—N encounters`, `encounters 1—N treatment_plans 1—N treatment_sessions`, `plans 1—N treatment_costs → lab_payables → finance`, `patients 1—1 payment_status`, `wa_channels 1—N wa_conversations 1—N wa_messages`. No circular FK.

---

## 9. API Architecture (B3)

- **Style:** REST, versioned `/api/v1`. JSON:API-lite conventions. OpenAPI 3.1 generated from NestJS + Zod DTOs.
- **Conventions:** plural nouns, kebab-case paths; `GET` read, `POST` create/action, `PATCH` update, no destructive `DELETE` (soft-delete via `PATCH {deletedAt}` or action endpoint).
- **Standard envelope:** `{ data, meta }` / errors `{ error: { code, message, fieldErrors?, correlationId } }`.
- **Pagination:** cursor-based (`?cursor=&limit=`, default 25, max 100). **Filtering/sorting/search:** allow-listed per resource (`?branchId=&status=&q=&sort=-scheduledDate`).
- **Idempotency:** `Idempotency-Key` header required on all mutating endpoints; server returns first result on replay.
- **Rate limiting:** per-IP + per-user (Redis token bucket); stricter on auth + WhatsApp send.
- **Authn:** `Authorization: Bearer <jwt>`. **Authz:** server-side guard per endpoint (§10/§11).

### Endpoint contract map (representative per domain; full OpenAPI at implementation)

| Domain | Endpoint (v1) | Method | Scope guard | Notes |
|---|---|---|---|---|
| auth | `/auth/login` `/auth/refresh` `/auth/logout` `/auth/password` | POST | public/self | Argon2id verify; JWT+refresh |
| patients | `/patients` | GET/POST | hq=all; bm/rc=branch; dr=own | duplicate-detect on create |
| patients | `/patients/:mrn` `/patients/:mrn/360` `/patients/:mrn/relationships` `/patients/:mrn/payment-status` | GET | scope | 360 aggregates owner modules |
| patients | `/patients/:mrn/payment-status/confirm` | POST | hq/rc only | PENDING→PAID (external payment) |
| appointments | `/appointments` `/appointments/:id/status` `/appointments/availability` | GET/POST | scope + doctor double-book guard | status flow enforced |
| clinical | `/encounters` `/plans` `/notes` `/consents` `/imaging` `/prescriptions` `/referrals` | GET/POST/PATCH | doctor=own; safety/consent gates | signed=immutable |
| documents | `/documents` `/documents/:id/versions` | GET/POST | scope | S3 presigned upload |
| finance | `/invoices` `/payment-status` `/expenses` `/payables` `/commissions` `/lab-payables` `/radar` `/reconciliation` | GET/POST/PATCH | hq/bm; rc/dr status-only | no gateway; commission engine locked |
| marketing | `/leads` `/campaigns` `/templates` `/recall-rules` `/follow-ups` `/segments` | GET/POST/PATCH | hq/bm; AP-3 gate on send | intent→whatsapp handoff |
| operations | `/doctor-status` `/checklist` `/tasks` `/incidents` `/lab-cases` | GET/POST/PATCH | scope; override needs reason | — |
| whatsapp | `/channels` `/conversations` `/conversations/:id/messages` `/conversations/:id/handoff` `/campaigns/:id/send` | GET/POST | hq/bm/rc; dr=none(channel) | anti-ban 5 gates; manual send=channel-only |
| ai | `/agents` `/capabilities` `/guardrails` `/approvals` `/automations` | GET/PATCH | hq/bm view; hq govern | governance plane |
| admin | `/staff` `/staff/:id/role` `/staff/:id/status` | GET/POST/PATCH | hq only; last-HQ guard | deactivate≠delete |
| settings | `/config` `/config/effective` `/integrations` | GET/PATCH | hq; bm branch-override | secrets write-only |
| dashboard | `/dashboard/context` `/dashboard/kpis` | GET | scope | derived, cached |
| reports | `/reports/kpis` `/reports/revenue` `/reports/appointments` | GET | scope, read-only | canonical RPT_KPIS |

**Frontend-parity rule:** every endpoint above already corresponds to a capability the locked frontend exercises (drawers, wizards, gates). No invented behavior. Where the frontend is read-only (Reports/Dashboard), the API exposes only `GET`.

---

## 10. Authentication Architecture (B4)

- **Credential auth:** username + password (Argon2id, memory-hard). Demo logins map to seed users.
- **Token strategy:** short-lived **JWT access token (15 min)** carrying `sub`, `role`, `branchId`, `doctorId`, `orgId` + **rotating refresh token** in `httpOnly; Secure; SameSite=Strict` cookie (7-day TTL, reuse-detection → revoke family).
- **Session:** Redis-backed session registry for revocation/listing; logout invalidates refresh family.
- **Password policy:** min 8 chars (matches Settings), lockout after 3 failed attempts → alert HQ (matches Settings policy), breach-list check optional.
- **MFA readiness:** `staff.mfa_secret`, `mfa_enabled` columns + TOTP enrollment endpoint stubbed behind feature flag (not enforced v1).
- **No credentials in source.** Seed passwords only for local dev, overridden by env in staging/prod.

---

## 11. RBAC Architecture (B4)

The locked `ROLE_DOMAIN_MATRIX` + `PERMISSION_MATRIX.can()` are ported to the backend as the **authorization source of truth**:

- `src/shared/security/role-domain-matrix.ts` — verbatim 4-role × 13-domain × {view,create,edit,submit,approve,delete} + scope(all|branch|own).
- **Guard chain per request:** `AuthGuard` (JWT) → `ScopeGuard` (loads principal: role, branchId, doctorId, orgId) → `DomainGuard(domain, action)` → `ScopeEnforcementPolicy` (row-level branch/own filtering).
- **Server-side enforcement points:**
  - Direct-route protection: requesting a resource outside role matrix → `403`.
  - Cross-branch protection: non-HQ requesting another branch's record → `404` (don't leak existence) or `403`.
  - Cross-doctor protection: doctor requesting another doctor's records → denied (relationship check: patient has appointment/treatment with actor's `doctorId`).
  - Invalid-branch protection: unknown `branchId` → `400`.
  - Privilege-escalation prevention: role/branch changes only via `admin` module HQ endpoints with last-HQ + self-change guards.
- **RLS defense-in-depth:** Postgres policies mirror the matrix so even a buggy query can't leak cross-branch rows.
- **`receptionist` ≡ `branch_admin`** alias preserved server-side.

---

## 12. Tenant/Branch Scope Architecture (B5)

Hierarchy: **Tenant(org) → Organization → Branch → Workspace → User → Data Scope.**

Single org (`medini-dental-group`), 14 branches (canonical registry), users bound to role+branch(+doctor). Resolution order per request: `orgId` (constant) → `branchId` (from principal; HQ may override via explicit `X-Branch-Context` header that is itself permission-checked) → `doctorId` (doctor role) → row-level filters.

### Per-domain scope enforcement (read/write/update/delete)

| Domain | HQ | Branch Manager | Receptionist (branch_admin) | Doctor |
|---|---|---|---|---|
| Patients | all | branch | branch | own (relationship) |
| Appointments | all | branch | branch | own doctor+branch |
| Clinical (Care Delivery) | all (read) | branch (read) | none | own (write) |
| Documents | all | branch | none | own |
| Finance | all | branch (read/submit) | payment-status only | own-patient status only |
| Reports/Analytics | all | branch | none | own |
| Marketing (Sales) | all | branch | none | none |
| WhatsApp (Communication) | all | branch | branch | none (channel) / contextual |
| AI | all (govern) | branch (view) | none | none |
| Operations | all | branch | checklist/break only | none |
| Administration (Platform) | all | none | none | none |
| Settings | all | branch override (overridable) | view effective | view effective |

Enforcement: **application `ScopeService`** (always) + **RLS** (scoped tables) + **DomainGuard** (per endpoint). All four CRUD verbs carry scope checks; deletes are soft + scoped.

---

## 13. Workflow Architecture (B6)

Each workflow = explicit **state machine** + invariants + transaction boundary.

- **Patient:** `draft → validate (required fields) → duplicate-detect(IC hard-block / phone soft-warn) → create → relationship-link → timeline-append`. Invariants: MRN/IC unique; child requires guardian; cross-branch create blocked. Tx: patient + relationship + timeline in one transaction.
- **Appointment:** `create → availability-check(doctor+chair) → confirm → checked-in → waiting → called → in-progress → completed | cancelled | no-show`. Locked transitions per `APPT_STATUS_FLOW`. Invariants: no double-book (exclusion constraint); illegal transition rejected. Tx: status change + history + timeline atomic.
- **Treatment:** `treatment → clinical case (encounter) → treatment cost → finance`. Safety gate: severe-allergy must be acknowledged before encounter completion; consent-required plans block finalization until accepted. Signed notes immutable.
- **Finance:** `treatment cost → invoice → payment status → finance record → Bukku`. Payment = status only. Lab payable lifecycle `DRAFT→OUTSTANDING→PARTIALLY_PAID→PAID|VOID`, **overpayment blocked**, overpay → error. Commission engine `Base=Revenue−DirectCosts; Commission=Base×Rate` (locked formula; config = rate/basis/payout only, versioned).
- **Communication:** `channel → conversation → message → assignment → human/AI handling → timeline`. Anti-ban 5 gates for automated sends; manual reply = channel-availability only; human handoff pauses AI; conversation lock prevents duplicate processing.
- **Referral:** `referral → patient → source → attribution → reporting`. Draft→sent→received→in-progress→completed; links Patient 360 referral network (no duplicate network).

### Transaction & concurrency rules
- **Atomicity:** each workflow step that mutates multiple aggregates runs in one DB transaction.
- **Rollback:** on any failure, full rollback + audit of the attempt.
- **Race conditions:** optimistic `version` checks on appointment status, conversation queue lock, commission ledger; unique constraints catch double-create.
- **Idempotency:** create/confirm/send endpoints keyed; retries safe.

---

## 14. Transaction Architecture (B6)

- **Unit of Work:** NestJS interceptor wraps each mutating use-case in a Drizzle transaction; repositories receive the tx handle.
- **Isolation:** default `READ COMMITTED`; `SERIALIZABLE` for payment-status confirm, commission payout, appointment booking (conflict-prone).
- **Outbox pattern:** domain events written to `domain_events` table **in the same transaction** as the state change → async worker publishes (no dual-write inconsistency).
- **Saga (only where cross-system):** Bukku sync + WhatsApp send use compensating actions (mark failed, retry, DLQ) rather than distributed transactions.

---

## 15. Event Architecture (B7)

- **Naming:** `DomainEntityAction` past-tense (e.g. `AppointmentCreated`, `PaymentStatusUpdated`). Matches locked `CROSS_DOMAIN_EVENTS`.
- **Payload contract:** `{ eventId, eventType, occurredAt, orgId, branchId, correlationId, data, version }`. Zod-validated.
- **Transport:** transactional **outbox → BullMQ** (`domain-events` queue) → consumer workers. In-process emitter for same-transaction reactions where latency matters.
- **Ownership:** each event has exactly one producer (owner module) and declared consumers.

### Event → consumer map (from locked CROSS_DOMAIN_EVENTS)

| Event | Producer | Consumers |
|---|---|---|
| PatientCreated / PatientUpdated | patients | appointments, marketing, reports, timeline, analytics |
| AppointmentCreated / AppointmentCompleted | appointments | patients, clinical, finance, reports, notification |
| TreatmentStarted / TreatmentCompleted | clinical | appointments, finance, reports |
| PaymentStatusUpdated | finance | patients, reports, dashboard, Bukku sync |
| BillSubmitted / BillApproved / BillRejected / BillPaid | operations/finance | finance, operations, dashboard, reports |
| RecallDue | marketing | patients, whatsapp, dashboard |
| WhatsappMessageReceived | whatsapp | patients, ai |
| AiEscalated | ai | whatsapp, operations |

---

## 16. Queue/Worker Architecture (B7)

- **Queues (BullMQ on Redis):** `domain-events`, `whatsapp-send` (rate-limited per anti-ban), `bukku-sync`, `ai-jobs`, `notifications`, `reports-refresh`.
- **Workers:** one worker process per queue (horizontally scalable). Concurrency tuned per queue.
- **Retry:** exponential backoff (`attempts: 5`, `backoff: {type:'exponential', delay: 2000}`); WhatsApp send honors sending-window/interval gates (requeue, not fail).
- **DLQ:** `<queue>-dlq` after max attempts; surfaced in observability + alert.
- **Idempotency:** consumers check `processed_events(consumer, event_id)` before acting; safe re-delivery.
- **Ordering:** per-aggregate ordering via BullMQ job `groupId` (e.g. per `conversationId`).
- **Duplicate handling:** unique `eventId` + consumer idempotency table → at-least-once delivery, effectively-once processing.
- **Failure recovery:** stalled-job detection, graceful shutdown drains, resume from DLQ with operator action.

---

## 17. Integration Architecture (B8)

All integrations = **port in `application/ports/` + adapter in `infrastructure/adapters/`**. Credentials from secrets manager / env (never source). **WAHA real transport NOT built now; Bukku key NOT hardcoded.**

| Integration | Adapter | Auth/Secrets | Inbound | Outbound | Timeout/Retry | Rate limit | External ID / Sync | Failure/Recovery |
|---|---|---|---|---|---|---|---|---|
| **WAHA (WhatsApp)** | `WahaAdapter` implements `WhatsAppPort` (sendText, session QR, webhook) | WAHA base URL + API key from secrets | webhook → `WHATSAPP_MESSAGE_RECEIVED` | send message (via `whatsapp-send` queue, anti-ban gated) | 5s timeout, 3 retries backoff | WAHA 136-endpoint map; per-channel anti-ban caps | `waChannel.session` ↔ WAHA session; `external_message_id` | channel down → conversations locked, banner; DLQ + reconnect |
| **Bukku** | `BukkuAdapter` implements `AccountingPort` (invoices, payments, bills, reconciliation pull) | Bearer token + `Company-Subdomain` from secrets (**rotate exposed key first**) | poll (primary) + optional webhook (UNVERIFIED) | push invoices/payments/bills (confirmation-gated) | 10s, 3 retries, circuit breaker | Bukku 600 req/min | idempotency key `source:entity:op:version`; `bukku_sync_records` | API error → sync record `ERROR`, conflict→HQ review, reconcile read-only |
| **AI providers** | `AiProviderAdapter` implements `AiPort` (suggest, summarise, campaign draft) | provider key from secrets | — | prompt → draft response | 15s timeout, 2 retries | provider limits | request ID; AI governance gate before send | provider down → AI Suggest disabled gracefully (governance toast) |
| **OCR** | `OcrAdapter` implements `OcrPort` (document/imaging text extract) | key from secrets | — | document → text | 30s, 2 retries | provider limits | `document_id ↔ ocr_job_id` | failure → document stays `unprocessed`, retryable |
| **External lab/cost** | `LabCostAdapter` (statement import) | per-lab creds | lab statement import | treatment cost → lab payable | 10s, 3 retries | — | `case_ref`, `invoice` | unmatched → `Pending Finance Review` |

---

## 18. Audit Architecture (B9)

**`audit_log`** (append-only, RLS read-restricted) captures every state-changing action:
`actor_id, actor_role, action, entity, entity_id, before_jsonb, after_jsonb, org_id, branch_id, source(api|worker|integration), correlation_id, created_at`.
- **Written in the same transaction** as the change (no lost audit).
- **View-only actions do NOT write audit** (per locked behavior).
- Governance audit (admin), config history (settings), finance audit, commission audit, WhatsApp send/blocked log, AI audit — all write into the unified `audit_log` with `entity` discriminator.
- Negative-path rule: blocked/rejected actions that must be provable (e.g. `send_blocked`, suspend-without-reason) write an audit entry but no state change.

---

## 19. Observability Architecture (B9)

- **Logging (Pino, JSON):** levels per category — `app` (info/debug), `security` (authn/authz failures, lockouts), `audit` (stream of audit_log writes), `api` (request/response w/ latency, correlation ID), `integration` (WAHA/Bukku/AI/OCR calls), `worker` (job lifecycle). PII/secret redaction via Pino redact paths.
- **Metrics (Prometheus):** RED per route (rate/errors/duration), queue depth + age, worker success/failure, DB pool/connections/slow queries, integration health (per-adapter success %, latency), anti-ban blocked-send counters, auth failures.
- **Tracing (OpenTelemetry):** trace per request → DB → queue → integration; correlation ID propagated.
- **Dashboards:** Grafana — service overview, per-domain, integrations, WhatsApp safety, Bukku sync.
- **Alerting:** error-rate spike, DLQ growth, integration down, DB unhealthy, queue backlog.

---

## 20. Reliability Architecture (B9)

- **Retry:** bounded, exponential backoff + jitter on transient failures (DB, integrations).
- **Timeout:** every external call has an explicit timeout (see §17).
- **Circuit breaker:** per-integration (e.g. Bukku) — open after N consecutive failures, half-open probe, fallback to cached/queued state.
- **Idempotency:** mutations + event consumers (above).
- **Graceful degradation:** if WAHA/Bukku/AI down, core CRM (patients/appointments/clinical/finance status) keeps working; affected surfaces show honest degraded state (matching prototype "not connected" banner behavior).
- **Health checks:** `/health/live` (process), `/health/ready` (DB + Redis + migrations current), per-integration `/health/integrations`.
- **Recovery:** PITR restore, queue replay from DLQ, reconciliation re-run (read-only).

---

## 21. Infrastructure Architecture (B10)

**Topology (justified minimal, single VPS initially — matches existing Fariq VPS pattern):**

```
Internet → Nginx (TLS, rate-limit, static) → API (Node/NestJS container)
API → PostgreSQL 16 (container or managed)
API → Redis 7 (queue+cache container)
Redis → Worker containers (domain-events, whatsapp-send, bukku-sync, ai-jobs, notifications)
API/Workers → S3-compatible object storage (MinIO container or AWS S3)
Observability: Prometheus + Grafana + Loki (logs) + Sentry
Secrets: Doppler / Vault / Docker secrets (not .env in git)
```

- **Runtime:** Docker 29.5.3 (present on VPS). `docker-compose` for staging/prod; one service per container (api, worker-*, postgres, redis, minio, nginx, prometheus, grafana, loki).
- **Reverse proxy:** Nginx (already present) — TLS (Let's Encrypt), HTTP/2, gzip, security headers, request size limits, `/api` → api service.
- **Networking:** internal docker network; only Nginx exposes 80/443; DB/Redis not public.
- **PostgreSQL:** container w/ named volume + WAL archiving, or managed PG if budget allows. Connection via PgBouncer optional.
- **Redis/queue:** single Redis (persist AOF) for cache + BullMQ.
- **Workers:** separate containers consuming queues; scale by replica count.
- **Secrets:** injected at runtime; never baked into images; rotation runbook documented.
- **Environments:** `development` (local compose) → `staging` (VPS, prod-like, synthetic data) → `production` (VPS).
- **Backup/restore:** nightly `pg_dump`+WAL to off-box (S3/Backblaze); MinIO versioning; restore runbook + quarterly drill.
- **Monitoring/health:** Prometheus scrapes `/metrics`; Grafana dashboards; uptime probe on `/health/ready`.
- **Deployment/rollback:** GH Actions builds image → push to registry → SSH deploy `docker compose pull && up -d`; rollback = redeploy previous image tag + reversible migration down.

> **Not over-engineered:** no Kubernetes, no multi-region, no service mesh. Justification: single-tenant, single-region, small team; modular monolith keeps deploys simple. Scale path documented (split workers, managed PG, read replica) if load demands.

---

## 22. Deployment Architecture (B10)

- **CI (GitHub Actions):** lint → typecheck → unit → integration (testcontainers PG/Redis) → build image → push (GHCR) → `docker scan`/osv.
- **CD:** on tag → deploy to staging → run smoke (mirrors 966-test intent via API) → manual approval → deploy production.
- **Zero-downtime:** expand→migrate→contract migrations; rolling container replace; health-gated.
- **Config per env:** env vars via secrets manager; `NODE_ENV`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `S3_*`, `WAHA_*`, `BUKKU_*`, `AI_*` (all from secrets).

---

## 23. Migration Architecture (B11)

**Path:** Current prototype/locked artifact → Production DB → Validation → Staging → Production.

1. **Schema-first:** build schema from §7 canonical model.
2. **Reference/seed data:** branches (14 canonical), treatment catalog, roles, demo users, config defaults, recall rules, AI agents/guardrails/approvals, WhatsApp safety presets.
3. **Data mapping:** map prototype seed/demo shapes (patients, appointments, encounters, plans, finance, campaigns, conversations) → canonical tables. Field-level mapping doc per entity.
4. **Validation:** reconciliation queries (counts, FK integrity, scope checks) + the contract test-suite.
5. **Order:** reference → org/branch/staff → patients → relationships → appointments → clinical → finance → marketing → operations → whatsapp → ai → settings → audit backfill.
6. **Rollback:** pre-migration snapshot; reversible migrations; abort switches per step.
7. **Reconciliation:** post-migration read-only reconciliation report (mirrors Bukku reconciliation pattern).

---

## 24. Testing Architecture (B11)

- **Unit:** domain rules (commission formula, recall calc, anti-ban gates, status machines, scope policies, validators). Target: every locked formula/invariant has a unit test.
- **Integration:** API + DB (testcontainers), queue + workers, external adapters (mocked WAHA/Bukku/AI/OCR servers).
- **Security:** RBAC matrix exhaustively (4 roles × 13 domains × actions), tenant/branch isolation, cross-doctor, privilege-escalation, direct API access without UI, RLS negative tests.
- **E2E:** critical journeys — Patient create→duplicate→360; Appointment book→conflict→complete; Treatment→cost→finance; Finance status confirm→Bukku sync; WhatsApp inbound→AI buffer→handoff→send; Referral→attribution→report.
- **Performance:** targets — p95 read <200ms, p95 write <500ms, dashboard aggregate <800ms; throughput 200 rps baseline; load test via k6; bottleneck detection via tracing + slow-query log.
- **Contract parity:** a test suite ports the 966 frontend assertions to API level so backend behavior == locked frontend behavior.
- **Migration/recovery tests:** restore-from-backup drill, DLQ replay, migration rollback.

---

## 25. Security Architecture (B4 + cross-cutting)

- **Server-side authz everywhere** (§11). Frontend checks are UX only.
- **Transport:** TLS 1.2+ everywhere; HSTS; secure cookies.
- **Input validation:** Zod on every DTO; parameterized queries (Drizzle) — no SQL injection; output encoding on client.
- **Secrets:** vault/manager; never in source/logs; masked in responses (write-only fields).
- **PHI handling:** clinical notes/imaging flagged sensitive; access audited; no PHI in external AI prompts (locked guardrail GR-5).
- **OWASP ASVS alignment:** authn, session, access control, injection, XSS, CSRF (SameSite + token), rate limiting, security headers (CSP, X-Frame-Options, etc.).
- **Audit & monitoring:** security log + alerting on lockouts/escalation attempts.
- **Dependency security:** lockfile, `npm audit`/osv in CI, Renovate controlled updates.

---

## 26. Failure/Recovery Architecture

| Failure | Detection | Response | Recovery |
|---|---|---|---|
| API crash | process exit / health fail | container restart (restart policy) | stateless → immediate |
| DB down | `/health/ready` fail, pool errors | circuit → 503 + alert | failover/PITR restore; replay outbox |
| Redis down | queue ping fail | degrade (no async), alert | AOF restore; requeue stalled |
| WAHA down | integration health | lock conversations (banner), pause sends | reconnect; DLQ replay |
| Bukku down | circuit open | queue sync records, alert | retry w/ backoff; reconcile read-only |
| AI down | provider health | AI Suggest disabled gracefully | resume on recovery |
| Worker stall | stalled-job detector | requeue + alert | DLQ after max attempts |
| Data corruption | reconciliation mismatch | HQ review | restore + reconcile |

---

## 27. Implementation Dependency Graph

```
B0 Foundation (contract, config, security, logging, errors)
 └─ B2 Database (schema, RLS, migrations, seed)
     └─ B4/B11 Auth+RBAC (principal, matrix, guards)
         └─ B1 Domain modules (patients, appointments, clinical, finance, marketing,
                               operations, whatsapp, ai, admin, settings)
             ├─ B3 API (controllers, DTOs, OpenAPI)
             ├─ B6 Workflows/Transactions (state machines, outbox)
             └─ B7 Events/Queues (domain-events, workers)
                 └─ B8 Integrations (WAHA, Bukku, AI, OCR, lab)
                     └─ B9 Audit/Observability/Reliability
                         └─ B10 Infra/Deploy (docker, nginx, CI/CD)
                             └─ B11 Testing/Migration/Rollout
```

Critical path: **Foundation → DB → Auth/RBAC → Domain modules → API → Workflows → Events → Integrations → Observability → Infra → Testing/Rollout.** Dashboard & Reports build last (read-only consumers of all owner modules).

---

## 28. Production Implementation Sequence (recommended — NOT started)

1. **Sprint 0 — Foundation:** repo scaffold, `architecture.contract.ts` (port MEDINI_ARCHITECTURE), config/secrets, logging/error/audit base, CI.
2. **Sprint 1 — DB + Auth/RBAC:** schema + migrations + RLS + seed (14 branches, roles); auth (Argon2id + JWT/refresh); ScopeService + guards; security tests.
3. **Sprint 2 — Core clinical-crm:** patients (+duplicate/relationship/timeline), appointments (+availability/status flow), dashboard context (read).
4. **Sprint 3 — Clinical:** encounters, plans, notes(SOAP, immutable), consents, imaging, safety gates.
5. **Sprint 4 — Finance core:** invoices, payment-status (confirm), expenses, payables, recurring, radar, treatment costs, lab payables, commission engine.
6. **Sprint 5 — Marketing + Operations:** leads/campaigns/recall/follow-ups; doctor status/checklist/tasks/incidents/lab cases.
7. **Sprint 6 — WhatsApp Hub:** channels/conversations/messages/assignment, anti-ban engine, device health, AI response queue, human handoff (WAHA simulated first).
8. **Sprint 7 — AI Manager + Settings + Admin:** governance plane, config hierarchy, staff/role lifecycle.
9. **Sprint 8 — Events/Workers + Integrations:** outbox, queues, workers; Bukku adapter (real, gated), WAHA real transport, AI/OCR adapters.
10. **Sprint 9 — Reports/Analytics + Observability:** RPT_KPIS, dashboards, metrics/tracing/alerting.
11. **Sprint 10 — Migration + Hardening + Rollout:** data migration, security/perf/E2E, staging pilot, phased rollout, go-live.

---

## 29. Risk Register

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Bukku API key exposed in chat (13 Aug) | High | **Rotate before any production push**; store in secrets manager |
| R2 | Scope leak (cross-branch/doctor) | High | Server guards + RLS + exhaustive security tests |
| R3 | Contract drift (backend ≠ locked frontend) | Medium | Port MEDINI_ARCHITECTURE verbatim + parity test suite |
| R4 | WhatsApp ban despite anti-ban | Medium | Anti-ban = mitigation not guarantee; conservative caps; warming |
| R5 | Payment scope creep (becoming a gateway) | High | Hard rule: status-layer only; no invoice/receipt engine |
| R6 | WAHA webhook unverified | Medium | Polling-primary (Option C Hybrid); webhook behind verification task |
| R7 | Over-engineering infra | Low | Modular monolith; no K8s; documented scale path |
| R8 | PHI leakage to AI | High | GR-5 hard block; no PHI in external prompts; audit |
| R9 | Single-VPS SPOF | Medium | Nightly off-box backup + PITR + documented restore; managed-PG upgrade path |
| R10 | P3 X-Ray HOLD ambiguity | Low | Kept out of scope; flagged as Open Decision |

---

## 30. Architecture Decision Records (ADR summary)

- **ADR-001 Modular monolith over microservices** — team size, transaction integrity, KISS. *Status: accepted.*
- **ADR-002 NestJS + Drizzle + PostgreSQL + BullMQ/Redis** — aligns with prototype, type-safe, simple ops. *Accepted.*
- **ADR-003 Server-side authorization + RLS defense-in-depth** — frontend is not security. *Accepted.*
- **ADR-004 Payment status layer only (no gateway)** — v1.1 non-negotiable. *Accepted.*
- **ADR-005 Single-tenant with org_id reserved** — one org now; SaaS-ready column. *Accepted.*
- **ADR-006 Transactional outbox for events** — no dual-write inconsistency. *Accepted.*
- **ADR-007 Bukku polling-primary (Option C Hybrid)** — webhook unverified. *Accepted.*
- **ADR-008 Single VPS + Docker Compose initially** — cost/simplicity; documented scale path. *Accepted.*
- **ADR-009 Signed clinical records immutable (amendment-only)** — governance. *Accepted.*
- **ADR-010 Anti-ban as safety mechanism, not guarantee** — honest framing. *Accepted.*

---

## 31. Production Readiness Checklist

- [x] 13 canonical domains mapped to modules
- [x] Contract layer ported verbatim (source of truth)
- [x] DB canonical model + integrity + RLS defined
- [x] API contract aligned to locked frontend (no invented behavior)
- [x] AuthN (Argon2id + JWT/refresh) + MFA-ready
- [x] RBAC server-side + matrix + scope + RLS
- [x] Tenant/branch/record scope per domain (R/W/U/D)
- [x] Workflows = state machines + invariants + tx boundaries
- [x] Events + outbox + queues + DLQ + idempotency
- [x] Integrations via ports/adapters; secrets externalized; WAHA real deferred; Bukku key not hardcoded
- [x] Audit/observability/reliability defined
- [x] Infra/deploy/backup/rollback defined (not over-engineered)
- [x] Testing (unit/integration/security/E2E/perf/migration/recovery) defined
- [ ] **Bukku key rotation** — before production
- [ ] **Real WAHA transport** — production phase
- [ ] **Backend implementation** — NOT started (awaits approval)

---

## 32. Final Architecture Consistency Audit

| Dimension | Result |
|---|---|
| **Domains** | ✅ all 13 canonical represented; ownership preserved (DATA_OWNERSHIP) |
| **Branches** | ✅ 14 canonical (MEDINI_MAIN_BRANCHES) seeded; registry preserved |
| **RBAC** | ✅ ROLE_DOMAIN_MATRIX + PERMISSION_MATRIX ported verbatim; server-side authz defined |
| **Scope** | ✅ tenant/branch/record scope per domain; cross-branch + cross-doctor protection defined |
| **Data** | ✅ every major entity mapped to an owner; relationships valid; indexes + constraints defined; no orphans, no circular FK |
| **APIs** | ✅ every locked frontend capability has a backend contract; read-only domains expose only GET; no mismatch |
| **Events** | ✅ cross-domain events mapped to producer/consumers; retries + idempotency defined |
| **Integrations** | ✅ WAHA, Bukku, AI, OCR, external lab/cost all mapped via ports/adapters |
| **Security** | ✅ secrets never hardcoded; authz server-side; audit trail defined |
| **Infrastructure** | ✅ production + staging topology; backup/restore; rollback defined |
| **Testing** | ✅ unit, integration, security, E2E, performance, migration, recovery all defined |

**Unresolved / explicitly-marked decisions (not guessed):**
1. **Bukku webhook verification** — pending Bukku docs confirmation; default polling-primary.
2. **P3 X-Ray & Documents** — client HOLD; kept out of scope.
3. **Managed PG vs self-hosted container** — cost decision for Zul (recommend managed at scale; self-host fine initially).
4. **Multi-region / HA** — deferred (single region now).

---

# ✅ PRODUCTION BACKEND BLUEPRINT: COMPLETE

- **Phases completed:** B0, B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11 (all 12).
- **Documents created:** `docs/PRODUCTION-BACKEND-BLUEPRINT-v1.0.md` (this file).
- **Architecture decisions:** 10 ADRs (§30) — modular monolith, NestJS/Drizzle/PG/BullMQ, server-side authz+RLS, payment status-layer, single-tenant org_id, outbox events, Bukku polling-primary, single-VPS compose, immutable clinical records, anti-ban-as-mitigation.
- **Unresolved decisions:** 4 (§32) — Bukku webhook verify, P3 X-Ray hold, managed-vs-selfhost PG, multi-region defer.
- **Risks:** 10 (§29) — top: Bukku key rotation, scope leak, payment scope creep, PHI-to-AI.
- **Dependencies:** §27 dependency graph; critical path Foundation→DB→Auth/RBAC→Domains→API→Workflows→Events→Integrations→Observability→Infra→Testing.
- **Recommended implementation sequence:** §28 (Sprints 0–10).
- **Final consistency audit:** §32 — ALL dimensions mapped & verified.

**No production code, migrations, API code, deployments, or credential rotation were performed. Locked frontend (966/966) untouched.**

---

## ⛔ WAITING FOR EXPLICIT APPROVAL

Next phase (only on approval): **PRODUCTION BACKEND IMPLEMENTATION** — starting at Sprint 0 (Foundation). Not part of this task.
