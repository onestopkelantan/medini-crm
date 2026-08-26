# REMEDIATION TIER 4 — EVIDENCE RECONCILIATION

**Date:** Tier 4 Workstream A · **HEAD:** `1c949ef` · **Baseline:** `5eb40fd` (immutable, recoverable)

## 1. Purpose

Cross-check all audit + remediation reports against current repository truth,
without dishonestly rewriting historical evidence.

## 2. Commit Reference Verification

All 19 commit hashes referenced across Tier 1/2/3 final reports **resolve and
subjects match**. Chain verified: `5eb40fd` → 7 Tier 1 commits → 7 Tier 2
commits → 5 Tier 3 commits (HEAD `1c949ef`). Working tree CLEAN.

## 3. Count Truth

| Metric | Historical (baseline `5eb40fd`) | Current (Tier 4) |
|---|---|---|
| Migrations | 0000–0028 (29) | 0000–0030 (30, additive 0029/0030 Tier 2) |
| Tables | 70 | 70 |
| RLS policies | 294 | 296 (+2 Tier 2 T2-A) |
| Backend test files | 85 | 89 |
| Backend tests | 565 | 585 (+20: 18 Tier 2 + 2 Tier 3-era) |
| Backend lint | 7e/17w | 0/0 (Tier 3) |
| Frontend lint | 14e | 0 (Tier 3) |
| Backend prod vulns | 12/4 HIGH | 0 (Tier 1) |
| Backend dev vulns | — | 4 moderate (Tier 3, dev-only) |
| Backend tsc | 0 | 0 |
| Frontend tsc | partial (F-04) | 0 (Tier 3) |

## 4. Historical Report Integrity

- **Phase 0–9 forensic audits** (refs 294/565/85): describe baseline `5eb40fd`
  **accurately at that checkpoint** — preserved, no rewrite.
- **Tier 1 final** (refs 294/565): accurate at its checkpoint (pre-0029/0030).
  WAL/PITR/backup rehearsal evidence still valid; counts advanced in Tier 2.
- **Tier 2 final** (refs 296/585/0029/0030): accurate.
- **Tier 3 final** (refs 296/585/0 lint): accurate.

## 5. Finding Status Reconciliation (F-01→F-09 + N-01)

| Finding | Status at `5eb40fd` | Status now (Tier 4) | Consistent? |
|---|---|---|---|
| F-01 | CLOSED (verified) | CLOSED | ✅ |
| F-02 | S11 backlog | S11 backlog | ✅ |
| F-03 | CLOSED (verified live) | CLOSED | ✅ |
| F-04 | partial (tsc seed) | **RESOLVED** (tsc 0/0, Tier 3) | ✅ — Phase audit correctly said "partial"; Tier 3 closed it. No false claim. |
| F-05 | non-exploitable (S11) | non-exploitable (CREATE denied) | ✅ |
| F-06 | (per audit) | unchanged | ✅ |
| F-07 | FIXED | FIXED | ✅ |
| F-08 | informational | unchanged | ✅ |
| F-09 | (rate-limit test design) | addressed Tier 3 (lint) + Workstream C | ⏳ |
| N-01 | cosmetic | see §6 | ⏳ |

## 6. Finding A-1 (NEW, Tier 4 Workstream A) — staging.env "committed" claim

**Location:** `docs/S10-FINAL-PREPRODUCTION-READINESS.md` lines 69, 97, 101, 113.

**Claim:** "staging.env committed with dev-grade placeholders".

**Truth:** `staging.env` exists on disk only (13 lines, dev-grade placeholders
including `${VAR}` style + `staging_jwt_secret_...` placeholder). It is
**.gitignored** (line 24) and **never appears in git history**
(`git log --all -- staging.env` = empty). `STAGING-PARITY.md` correctly states
"staging.env exists, dev-grade" (not committed).

**Classification:** Documentation inconsistency (cosmetic, like N-01). The file
is correctly handled (gitignored, never committed) — the *claim* in the
readiness doc is inaccurate but caused no security exposure. No code change
needed; recommend a one-line correction in that doc (deferred to Workstream B
if touched, else noted as accepted doc-debt).

**Risk:** None (no secret leaked; file never tracked).

## 7. No Other Inconsistencies Found

- No report claims a closed finding as still open.
- No report claims a finding fixed when only partially fixed (F-04 progression
  is correctly staged across Phase → Tier 3).
- Accepted risks (F-02, F-05, F-08, drizzle-kit dev vuln) clearly identified.
- Operational/unverified items (TLS live, monitoring live, RPO decision,
  staging domain, real secrets) remain marked UNVERIFIED / CONFIG-VERIFIED.
- Production readiness is NOT falsely claimed anywhere.
