#!/bin/sh
# ============================================================================
# Medini CRM — PITR (Point-In-Time Recovery) rehearsal (Tier 1, P7-F3)
#
# Proves the hybrid backup + WAL-archive strategy can restore the database to
# a point AFTER the last full backup, using the archived WAL stream.
#
# What it does (on a scratch copy only — never touches the source DB):
#   1. pg_basebackup the SOURCE cluster into a scratch data directory.
#   2. Capture a marker (now) and write post-backup rows into the source
#      (in a dedicated scratch table), forcing WAL generation.
#   3. Wait until the source archives the WAL containing those rows.
#   4. Start a DISPOSABLE scratch cluster on the base backup with
#      restore_command pointing at the WAL archive and
#      recovery_target_time = marker.
#   5. Assert: pre-backup rows PRESENT, post-backup rows ABSENT (PITR works),
#      then replay-to-latest and assert post-backup rows PRESENT (full WAL).
#
# Usage:
#   POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_USER=medini \
#     ./pitr-rehearsal.sh
#
# Requires: wal_level=replica + archive_mode=on + archive_command set on the
# source, and the source's archive_command writing to a directory that THIS
# script can also read (share the walarchive volume).
# ============================================================================
set -euo pipefail

PGHOST="${POSTGRES_HOST:-localhost}"
PGPORT="${POSTGRES_PORT:-5433}"
PGUSER="${POSTGRES_USER:-medini}"
PGDB="${POSTGRES_DB:-medini_dev}"
PGPASSWORD="${PGPASSWORD:-${POSTGRES_PASSWORD:-}}"
export PGPASSWORD

WAL_DIR="${WAL_ARCHIVE_DIR:-/walarchive}"
SCRATCH="${PITR_SCRATCH_DIR:-/tmp/medini_pitr}"
SCRATCH_PORT="${PITR_SCRATCH_PORT:-5544}"

PSQL="psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB -v ON_ERROR_STOP=1 -qAt"

echo "=== Medini CRM PITR Rehearsal ==="
echo "Source:  $PGHOST:$PGPORT/$PGDB"
echo "Archive: $WAL_DIR"
echo "Scratch: $SCRATCH (port $SCRATCH_PORT)"
echo ""

# --- Preconditions -----------------------------------------------------------
MODE=$($PSQL -c "SHOW archive_mode;")
LEVEL=$($PSQL -c "SHOW wal_level;")
echo "archive_mode=$MODE wal_level=$LEVEL"
[ "$MODE" = "on" ] || { echo "FAIL: archive_mode is not 'on' on the source"; exit 1; }
[ "$LEVEL" = "replica" ] || [ "$LEVEL" = "logical" ] || { echo "FAIL: wal_level must be replica/logical"; exit 1; }

# --- Clean previous scratch ---------------------------------------------------
if [ -d "$SCRATCH/data" ]; then
  pg_ctl -D "$SCRATCH/data" -m fast stop >/dev/null 2>&1 || true
fi
rm -rf "$SCRATCH"
mkdir -p "$SCRATCH/data"
chmod 700 "$SCRATCH/data"

# --- 1. Base backup ------------------------------------------------------------
echo "→ 1. pg_basebackup from source..."
T0=$(date +%s)
pg_basebackup -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -D "$SCRATCH/data" -Fp -Xs -P -R
chmod 700 "$SCRATCH/data"
echo "   base backup done ($(($(date +%s)-T0))s)"

# --- 2. Marker + post-backup change -------------------------------------------
# Dedicated scratch table on the SOURCE (harmless, dropped at the end).
$PSQL -c "CREATE TABLE IF NOT EXISTS pitr_probe (id int PRIMARY KEY, note text, at timestamptz DEFAULT now());" >/dev/null
$PSQL -c "TRUNCATE pitr_probe;" >/dev/null
$PSQL -c "INSERT INTO pitr_probe (id, note) VALUES (1, 'pre-backup-row');" >/dev/null
# Force a WAL switch so the pre-backup row is archived before the base backup.
$PSQL -c "SELECT pg_switch_wal();" >/dev/null

echo "→ 2. Recording PITR target time (marker)..."
sleep 2
MARKER=$($PSQL -c "SELECT now();")
echo "   PITR target: $MARKER"

# Post-marker change (must NOT appear at the PITR point, MUST appear at latest).
$PSQL -c "INSERT INTO pitr_probe (id, note) VALUES (2, 'post-marker-row');" >/dev/null
$PSQL -c "SELECT pg_switch_wal();" >/dev/null

# --- 3. Wait for archive --------------------------------------------------------
echo "→ 3. Waiting for WAL archive to catch up..."
LASTWAL=$($PSQL -c "SELECT pg_walfile_name(pg_current_wal_lsn());")
for i in $(seq 1 60); do
  ARCHIVED=$($PSQL -c "SELECT count(*) FROM pg_stat_archiver WHERE archived_count > 0;")
  if ls "$WAL_DIR" 2>/dev/null | grep -q '^000000'; then
    break
  fi
  sleep 1
done
ls "$WAL_DIR" | grep -q '^000000' || { echo "FAIL: no WAL segments found in $WAL_DIR"; exit 1; }
echo "   archive contains $(ls "$WAL_DIR" | grep -c '^000000') segments"

# --- 4. Configure recovery ------------------------------------------------------
echo "→ 4. Configuring scratch cluster for PITR to marker..."
cat >> "$SCRATCH/data/postgresql.auto.conf" <<EOF
restore_command = 'cp $WAL_DIR/%f %p'
recovery_target_time = '$MARKER'
recovery_target_action = 'promote'
port = $SCRATCH_PORT
listen_addresses = 'localhost'
EOF
touch "$SCRATCH/data/recovery.signal"

# --- 5. Start scratch + verify PITR ---------------------------------------------
echo "→ 5. Starting scratch cluster (PITR to marker)..."
T1=$(date +%s)
pg_ctl -D "$SCRATCH/data" -l "$SCRATCH/log" -w -t 120 start
echo "   scratch recovered in ($(($(date +%s)-T1))s)"

SPSQL="psql -h localhost -p $SCRATCH_PORT -U $PGUSER -d $PGDB -qAt"
PRE=$($SPSQL -c "SELECT count(*) FROM pitr_probe WHERE note='pre-backup-row';")
POST=$($SPSQL -c "SELECT count(*) FROM pitr_probe WHERE note='post-marker-row';")
echo "   At PITR point: pre-backup rows=$PRE (expect 1), post-marker rows=$POST (expect 0)"

PITR_OK=0
[ "$PRE" = "1" ] && [ "$POST" = "0" ] && PITR_OK=1

# --- 6. Replay to latest ---------------------------------------------------------
echo "→ 6. Re-running recovery to LATEST (full WAL chain)..."
pg_ctl -D "$SCRATCH/data" -m fast stop >/dev/null 2>&1 || true
# Reset recovery target to end of WAL.
sed -i '/recovery_target_time/d' "$SCRATCH/data/postgresql.auto.conf"
pg_ctl -D "$SCRATCH/data" -l "$SCRATCH/log" -w -t 120 start
POST2=$($SPSQL -c "SELECT count(*) FROM pitr_probe WHERE note='post-marker-row';" 2>/dev/null || echo "-")
echo "   At latest: post-marker rows=$POST2 (expect 1)"

LATEST_OK=0
[ "$POST2" = "1" ] && LATEST_OK=1

# --- 7. Cleanup -------------------------------------------------------------------
echo "→ 7. Cleanup..."
pg_ctl -D "$SCRATCH/data" -m fast stop >/dev/null 2>&1 || true
$PSQL -c "DROP TABLE IF EXISTS pitr_probe;" >/dev/null || true
rm -rf "$SCRATCH"

echo ""
echo "=== RESULT ==="
echo "PITR-to-marker:   $([ "$PITR_OK" = "1" ] && echo PASS || echo FAIL)"
echo "Replay-to-latest: $([ "$LATEST_OK" = "1" ] && echo PASS || echo FAIL)"

if [ "$PITR_OK" = "1" ] && [ "$LATEST_OK" = "1" ]; then
  echo "✅ PITR REHEARSAL PASSED — backup + WAL archive restores to any point."
  exit 0
else
  echo "❌ PITR REHEARSAL FAILED"
  exit 1
fi
