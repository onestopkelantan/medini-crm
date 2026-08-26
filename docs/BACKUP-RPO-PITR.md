# Medini CRM — Backup, RPO & Point-In-Time Recovery (Tier 1, P7-F3)

**Status:** IMPLEMENTED · **Finding:** P7-F3 (MEDIUM — RPO 24h) · **Tier:** 1 (Pre-Production)

---

## 1. Decision — Option C (Hybrid: periodic full backup + WAL archiving / PITR)

Three options were evaluated:

| Option | RPO | RTO | Storage | Complexity | Verdict |
|---|---|---|---|---|---|
| **A. More frequent pg_dump** (e.g. hourly) | 1h | fast (single file) | High (24 full dumps/day, each full DB) | Low | ❌ Rejected as sole mechanism — still up to 1h data loss; heavy I/O every hour on a clinical DB |
| **B. WAL archiving / PITR only** | seconds | slow (base backup + replay) | Low (incremental WAL) | Medium | ❌ Rejected as sole mechanism — a WAL chain without a recent full backup has a long, fragile replay; restore reliability depends on one base backup |
| **C. Hybrid: 6-hourly full backup + continuous WAL archive** | **seconds (WAL) / 6h (floor)** | minutes (latest dump) → tens of min (PITR) | Moderate (4 dumps/day + incremental WAL) | Medium | ✅ **CHOSEN** |

**Why C for Medini CRM** (clinical + finance + appointment + WhatsApp data):

- **Clinical & finance data cannot tolerate 24h loss.** A single lost day of
  patient records / payment statuses is clinically and legally unacceptable.
  WAL archiving reduces worst-case loss from 24h to the WAL flush interval
  (archive_timeout = 300s → **RPO ≤ 5 minutes**, typically seconds).
- **Restore reliability:** the 6-hourly `pg_dump` provides a fast, simple,
  independently-verified restore path (proven byte-identical in rehearsal).
  The WAL archive adds fine-grained PITR on top — you are never dependent on a
  single mechanism.
- **Storage cost is modest:** 4 compressed full dumps/day (30-day retention) +
  WAL segments (16MB each, pruned at 30 days). Far cheaper than hourly dumps.
- **Operational complexity stays low:** one sidecar, one cron, no external
  backup server required. pgBackRest/wal-g were considered but rejected as
  over-engineering for a single-clinic deployment (KISS, ADR-008 precedent).

## 2. Architecture

```
PostgreSQL (prod container)
  ├─ wal_level=replica, archive_mode=on, archive_timeout=300
  └─ archive_command = /wal-archive.sh %p %f ──► walarchive volume (separate from pgdata)

backup sidecar (postgres:16-alpine)
  ├─ cron 17 */6 * * *  → backup.sh       (full pg_dump → backupdata, every 6h)
  ├─ cron 43 * * * *    → wal-retain.sh   (prune WAL > 30d, hourly)
  └─ heartbeat          → /backups/.heartbeat (healthcheck + BackupStale metric)

Volumes:
  pgdata      — live database
  walarchive  — archived WAL segments (PITR chain)
  backupdata  — full dumps + .sha256 + backup.log + metrics/
```

### WAL archiver durability (`backup/wal-archive.sh`)
- copy to `.tmp` → `sync -f` → atomic `mv` → directory `sync`. A partial
  archive file is never visible; a crash mid-copy leaves a cleanable `.tmp`.
- exit non-zero on any failure → PostgreSQL **retries** (WAL not recycled).

### Retention coherence
WAL and full backups share the **same 30-day window** (`BACKUP_RETENTION_DAYS`),
so every retained full backup always has a continuous WAL chain from its start
to now. Pruning older segments can never orphan a retained backup.

## 3. Schedule, retention, verification

| Item | Value |
|---|---|
| Full backup | every 6 hours (`17 */6 * * *`) |
| WAL archive | continuous (`archive_timeout=300`) |
| WAL retention prune | hourly (`43 * * * *`) |
| Retention | 30 days (both dumps + WAL) |
| Integrity | `pg_dump` non-zero exit + `set -euo pipefail` (no partial artifact) + `sha256` fingerprint per artifact |
| Verification | `restore-rehearsal.sh` (full) + `pitr-rehearsal.sh` (PITR) |
| Failure signal | backup sidecar healthcheck (heartbeat <26h) + postgres healthcheck (WAL archiver stalled) + Prometheus alerts |

## 4. Restore procedures

### 4a. Standard restore (latest full backup) — fast path
```bash
./backup/restore-rehearsal.sh /path/to/medini_YYYYMMDD_HHMMSS.sql.gz medini_restore
```
Verifies sha256 → restores → checks tables ≥ 69, branches ≥ 14, enums = 6.

### 4b. Point-in-time recovery (any moment since the base backup)
```bash
POSTGRES_HOST=… POSTGRES_PORT=… POSTGRES_USER=medini ./backup/pitr-rehearsal.sh
```
Rehearsal proves: base backup → recover to a marker **excluding** post-marker
rows, then replay to latest **including** them. This is the exact procedure
used for a real PITR (restore to just-before an incident).

## 5. Failure handling

| Failure | Detection | Behaviour |
|---|---|---|
| pg_dump error | non-zero exit + `set -euo pipefail` | no valid artifact written; backup.log records failure; BackupStale alert fires at >26h |
| WAL archive copy fails | archiver exit non-zero | PostgreSQL retries; `pg_stat_archiver.failed_count` rises; postgres container goes **unhealthy**; WalArchiveStale alert |
| Interrupted archive copy | `.tmp` leftover | wal-retain.sh cleans `.tmp.*` >1h |
| Disk full | node-exporter | DiskPressure alert at >85% |
| Backup sidecar dead | heartbeat file | healthcheck unhealthy + BackupStale alert |

## 6. RPO / RTO statement (final)

| Metric | Value | Basis |
|---|---|---|
| **RPO (typical)** | **seconds** | WAL archive flushed every ≤300s (archive_timeout) |
| **RPO (worst case)** | **≤ 5 minutes** (WAL) / **6h** (full-backup floor if WAL chain is lost) | archive_timeout / backup schedule |
| **RTO (full dump, dev-scale)** | ~37s | live rehearsal |
| **RTO (PITR, dev-scale)** | minutes (base backup + WAL replay) | `pitr-rehearsal.sh` measured |
| **RTO (prod-scale)** | 5–30 min depending on dataset & replay length | estimate — prod-scale dataset not available; see Tier 1 report UNVERIFIED |

> Previous RPO was **24 hours** (P7-F3). It is now **≤ 5 minutes** (WAL) with a
> **6-hour** guaranteed floor. This closes P7-F3's clinical-risk concern.
