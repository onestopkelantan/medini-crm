#!/bin/sh
# ============================================================================
# Medini CRM — WAL archive retainer (Tier 1, P7-F3 remediation)
#
# Runs hourly in the backup sidecar. Deletes archived WAL segments older than
# RETENTION_DAYS and removes any stale .tmp files left by an interrupted
# archive_command (crash between cp and mv).
#
# Why it is safe to prune: WAL is only useful together with a base backup.
# We keep WAL for the SAME window we keep full backups (default 30 days),
# so every retained full backup always has a complete, continuous WAL chain
# from its start time to now. Pruning older segments cannot orphan any
# retained backup.
# ============================================================================
set -euo pipefail

WAL_DIR="${WAL_ARCHIVE_DIR:-/walarchive}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
LOG="${BACKUP_LOG:-/backups/backup.log}"

[ -d "$WAL_DIR" ] || { echo "[$(date -Iseconds)] wal-retain: $WAL_DIR missing, skip" >> "$LOG"; exit 0; }

# Remove interrupted-copy leftovers older than 1 hour.
find "$WAL_DIR" -name '*.tmp.*' -mmin +60 -delete 2>/dev/null || true

# Prune WAL segments older than the backup retention window.
find "$WAL_DIR" -type f -mtime +"$RETENTION_DAYS" -delete

COUNT=$(find "$WAL_DIR" -type f ! -name '*.tmp.*' | wc -l | tr -d ' ')
echo "[$(date -Iseconds)] wal-retain: pruned WAL older than ${RETENTION_DAYS}d; ${COUNT} segments retained" >> "$LOG"

# Tier 1: WAL-archive freshness metric for the WalArchiveStale alert. Uses the
# NEWEST segment's mtime (not "now") so a genuinely idle-but-healthy archive
# is not false-flagged, while a stalled archive ages out.
METRICS_DIR="${NODE_TEXTFILE_DIR:-/backups/metrics}"
mkdir -p "$METRICS_DIR"
NEWEST=$(find "$WAL_DIR" -type f -name '000000*' -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)
[ -n "$NEWEST" ] && echo "medini_wal_last_archive_timestamp_seconds $NEWEST" > "${METRICS_DIR}/wal.prom.tmp.$$" \
  && mv -f "${METRICS_DIR}/wal.prom.tmp.$$" "${METRICS_DIR}/wal.prom" || true
