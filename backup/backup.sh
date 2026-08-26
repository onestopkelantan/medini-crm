#!/bin/sh
# ============================================================================
# Medini CRM — PostgreSQL backup script (S10 T2)
# Runs inside the backup sidecar container (postgres:16-alpine).
# pg_dump → compressed → /backups volume → retention pruning.
# ============================================================================
set -euo pipefail

BACKUP_DIR="/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/medini_${TIMESTAMP}.sql.gz"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
LOG="${BACKUP_DIR}/backup.log"

echo "[$(date -Iseconds)] Starting backup of ${POSTGRES_DB} from ${POSTGRES_HOST}" >> "$LOG"

# pg_dump → gzip. pg_dump exits non-zero on any dump error and
# `set -euo pipefail` propagates that through the pipe, so a failed dump
# aborts the script and a partial artifact is NOT treated as valid.
# (Note: --exit-on-error is a pg_restore flag, not supported by pg_dump 16.)
pg_dump -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --no-owner --no-privileges --clean --if-exists \
  | gzip > "$BACKUP_FILE"

# Integrity fingerprint (used by restore-rehearsal / verification).
sha256sum "$BACKUP_FILE" > "${BACKUP_FILE}.sha256"

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[$(date -Iseconds)] Backup complete: $BACKUP_FILE ($SIZE)" >> "$LOG"

# Tier 1: textfile metric for the BackupStale alert (scraped via node-exporter).
METRICS_DIR="${NODE_TEXTFILE_DIR:-/backups/metrics}"
mkdir -p "$METRICS_DIR"
echo "medini_backup_last_success_timestamp_seconds $(date +%s)" > "${METRICS_DIR}/backup.prom.tmp.$$"
mv -f "${METRICS_DIR}/backup.prom.tmp.$$" "${METRICS_DIR}/backup.prom"

# Retention: delete backups older than RETENTION_DAYS
find "$BACKUP_DIR" -name "medini_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete
echo "[$(date -Iseconds)] Pruned backups older than ${RETENTION_DAYS} days" >> "$LOG"

# Keep the log itself under 10MB
if [ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt 10485760 ]; then
  tail -c 5242880 "$LOG" > "${LOG}.tmp" && mv "${LOG}.tmp" "$LOG"
fi
