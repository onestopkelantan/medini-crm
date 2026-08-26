# Medini CRM — Production Backend (Sprint 0: Foundation)

Modular monolith backend for Medini CRM. **Source of truth:** `MEDINI_ARCHITECTURE`
(ported verbatim into `src/shared/architecture/architecture.contract.ts`).

## Stack
NestJS 10 · TypeScript (strict) · Drizzle + PostgreSQL 16 (Sprint 1) · Redis/BullMQ (queue phase) · Pino · Zod · Vitest.

## Sprint 0 scope
Foundation only — no domain modules, no production DB schema, no domain endpoints,
no real WAHA/Bukku. See `../docs/BACKEND-IMPLEMENTATION-STATUS.md`.

## Commands
```bash
npm install
npm run start:dev     # dev server
npm run lint          # eslint + module-boundary rules
npm run typecheck     # tsc --noEmit (strict)
npm test              # vitest (unit + contract + architecture)
npm run build         # nest build
```

## Conventions
- `/api/v1` URI versioning; standard error envelope `{ error: { code, message, fieldErrors?, correlationId } }`.
- Correlation ID per request (`x-correlation-id`).
- Secrets via env/secrets manager — never in source. See `.env.example`.
- Module boundaries enforced by `eslint-plugin-boundaries` + architecture tests.

## Health
- `GET /health/live` — process liveness.
- `GET /health/ready` — honest dependency readiness (deps report `pending_sprint` until wired).
