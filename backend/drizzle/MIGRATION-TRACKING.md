# MIGRATION TRACKING MECHANISM — Medini CRM Backend (Sprint 7, N7-6)

## Official mechanism

Migrations are applied via a **manual-psql loop**, NOT `drizzle-kit migrate`.
This is the established, verified mechanism since Sprint 5/6:

1. Author a new SQL file `drizzle/NNNN_descriptive_name.sql` (sequential).
2. Append the file to the **CI migration loop** in `.github/workflows/ci.yml`
   (the `for f in drizzle/…` list) — CI replays every file in order against a
   clean PostgreSQL 16 with `ON_ERROR_STOP=1` after stripping
   `--> statement-breakpoint` markers.
3. Register the file in **`drizzle/meta/_journal.json`** (one entry per file,
   sequential `idx`, monotonic `when`) so the migration chain is internally
   coherent for tooling/auditors.
4. Prove a **fresh replay** `0000 → latest` locally before claiming done.

## Journal state (post N7-6 remediation)

The journal is **backfilled and complete**: 0000–0016 all registered in order.
Earlier debt (N5-1/N6-1): 0011–0013 were applied to the DB and CI loop but had
not been journalized. They are now registered — **historical SQL files were NOT
modified**; only the tracking metadata was completed. Replay is verified clean.

| Range | State |
|---|---|
| 0000–0010 | journalized (original) |
| 0011–0013 | journalized (N7-6 backfill — SQL untouched) |
| 0014–0016 | journalized (S7) |

## Rule going forward

A migration is NOT production-ready until ALL FOUR hold: file exists, CI loop
includes it, journal entry exists, and a fresh `0000 → latest` replay passes.
