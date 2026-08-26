# FINAL REMEDIATION EVIDENCE INDEX — GLM 5.3 INDEPENDENT RE-AUDIT

**Purpose:** single index of all remediation evidence for the final independent
forensic re-audit. **Not a production-readiness claim.**

## 1. Original Forensic Checkpoint
- Immutable baseline: `5eb40fd7707345b83e0fb5d0987a2f6f9cf1f169` (recoverable, verified)
- GLM 5.3 final re-audit at that checkpoint: 🟢 APPROVE — `docs/S10-GLM53-FINAL-RE-AUDIT.md`
- S0–S10 forensic audit (Phase 0–9): `docs/S0-S10-PHASE0-BASELINE-AUDIT.md` … `docs/S0-S10-PHASE9-FINAL-FORENSIC-RECONCILIATION.md`

## 2–5. Remediation Commits (all LOCAL, none pushed)
| Tier | Commits (above baseline) |
|---|---|
| Tier 1 (ops/RPO/monitoring/deps) | `8b22308` `edbd8fd` `2ea3e8a` `bdd9a5c` `a2de88a` `9e59197` `6c131dd` |
| Tier 2 (security hardening) | `eb03781` `d2603d1` `d7ecbde` `10b09ce` `7c5b53f` `9451fb8` `e3bb2da` |
| Tier 3 (quality/deps/test-env) | `e2770ef` `d182357` `39c64ce` `d7cdd79` `1c949ef` |
| Tier 4 (final cleanup/evidence) | `9f62cab` `278b428` (+ this evidence package) |

## 6. Migration Range
- 0000→0030 (30 migrations, journal idx 0–29 contiguous, tags == files)
- 0029/0030 additive (Tier 2); 0000–0028 untouched since baseline

## 7. Current Schema Counts (replay 0000→0030 on fresh DB == dev, zero drift)
- 70 tables · 296 RLS policies · 269 indexes · 6 functions (public) · 56 enums

## 8. Current Test Counts
- Backend: 89 spec files / **585 tests / 585 PASS ×2 consecutive** (vitest, forks, globalSetup env loading)
- Frontend: lint 0 / tsc 0 / build PASS (browser E2E: 13 tests, storageState-authenticated, manual/optional — servers not in CI)

## 9. Security Controls (all verified Tier 4 Workstream D)
- RLS: 0 tables without RLS; developer deny (staff=0, role_assignments=0); worker sees staff but excluded from human surfaces; branch/org scoping foreign=0 rows
- Org isolation (T2-A): non-canonical org → own-org rows only
- RBAC: PERMISSION_MATRIX `developer: {}`; system-admin = developer-only inline gate
- JWT: env-validated secrets (weak/default rejected); refresh rotation + reuse detection
- Registration: invite-token single-use (E2E on clean replay)
- Rate limiting: login 5/min, refresh 10/min, register 3/min per IP; NOT weakened anywhere
- Trust proxy: TRUSTED_PROXIES CIDR model, rightmost-XFF, fail-closed
- SECURITY DEFINER: all DEFINER fns have pinned search_path; PUBLIC EXECUTE only on 5 harmless GUC getters
- Escalation: medini_app CREATE/ALTER denied (permission denied for schema public)
- Audit logging: append-only audit trail (atomicity proven Tier 2)
- WAHA: compose disabled; lifecycle caps (50/day, 30–60s cooldown) in code

## 10. Remaining Accepted Risks
- F-02 doctor→HQ DB-layer gap (API blocks; S11 backlog)
- F-05 SECURITY DEFINER (non-exploitable, CREATE denied; S11 watch)
- drizzle-kit→esbuild 4+4 moderate dev-only transitive advisories (prod image `--omit=dev`; fix = unsafe downgrade → rejected)
- A-1 doc inaccuracy: "staging.env committed" claim (file is gitignored/never tracked; zero exposure)
- Windows resource flakiness of vitest worker forks (~1 in 3 local full-suite runs loses a worker; 0 test failures; CI unaffected)

## 11. Remaining Operational Prerequisites (pre-production)
- Real staging/production domain + DNS
- Production secrets via secret manager (JWT_SECRET, JWT_REFRESH_SECRET, DATABASE_URL, DATABASE_RUNTIME_URL, REDIS_PASSWORD, POSTGRES_*, WAHA key if enabled)
- TLS live verification (runbook §B) · monitoring live verification · RPO/RTO prod-scale rehearsal
- Boss final sign-off after governance review

## 12. Unverified Items (explicitly marked)
- TLS live: CONFIG-VERIFIED only (`docs/STAGING-TLS-VERIFICATION-RUNBOOK.md`)
- Monitoring live: config + scripts verified; live alerting UNVERIFIED (no domain)
- WAHA production: hardened in code/compose-disabled; LIVE UNVERIFIED
- Production backup/RPO: rehearsal verified at dev scale only (`docs/BACKUP-RPO-PITR.md`)

## 13. Files Changed (Tier 4)
- `app/e2e/auth-setup.ts` (NEW), `app/playwright.config.ts`, `app/e2e/journeys-b-h.spec.ts`, `app/e2e/journey-a-login-patients.spec.ts`, `app/.gitignore`
- `backend/test/integration/_replay-fixture.ts`, `s10-registration-replay.spec.ts`, `s10-developer-systemadmin.spec.ts`
- `docs/REMEDIATION-TIER4-EVIDENCE-RECONCILIATION.md` (NEW), `docs/FINAL-REMEDIATION-EVIDENCE-INDEX.md` (NEW), `docs/REMEDIATION-TIER4-FINAL.md` (NEW)

## 14. Validation Commands
```
cd backend && npm run lint && npx tsc --noEmit && npm run build && npm test   # ×2
cd app && npm run lint && npx tsc --noEmit && npm run build
docker compose -f docker-compose.prod.yml config --quiet
# replay: psql-apply backend/drizzle/0*.sql in order to a fresh DB; compare counts vs dev
```

## 15. Evidence Locations
- Tier reports: `docs/REMEDIATION-TIER{1,2,3,4}-FINAL.md`
- Reconciliation: `docs/REMEDIATION-TIER4-EVIDENCE-RECONCILIATION.md`
- Runbooks: `docs/BACKUP-RPO-PITR.md`, `MONITORING.md`, `S10-T2-DEPLOYMENT-RUNBOOK.md`, `STAGING-TLS-VERIFICATION-RUNBOOK.md`, `STAGING-PARITY.md`, `WAHA-PRODUCTION-READINESS.md`
- Backup/PITR: `backup/*.sh`; Monitoring configs: `monitoring/*.yml`
- Tests: `backend/test/**` (89 files), `app/e2e/**`

## 16–18. Git / Push / Deploy State
- Git: branch `main`, HEAD = Tier 4 final commit, working tree CLEAN (all committed locally)
- Push: **NOT DONE** · Deploy (staging+production): **NOT DONE**
- Baseline `5eb40fd` immutable & recoverable throughout
