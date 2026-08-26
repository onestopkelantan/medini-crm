#!/bin/sh
# ============================================================================
# Medini CRM — PostgreSQL restore rehearsal script (S10 T2)
# CRITICAL: This restores a backup into a FRESH scratch database to prove
# the backup is restorable. NEVER run against a live production database.
#
# Usage: ./restore-rehearsal.sh <backup-file.sql.gz> [scratch-db-name]
# ============================================================================
set -euo pipefail

BACKUP_FILE="${1:?Usage: $0 <backup-file.sql.gz> [scratch-db-name]}"
SCRATCH_DB="${2:-medini_restore_rehearsal}"
PGHOST="${POSTGRES_HOST:-localhost}"
PGUSER="${POSTGRES_USER:-medini}"
PGPORT="${POSTGRES_PORT:-5433}"

echo "=== Medini CRM Restore Rehearsal ==="
echo "Backup:  $BACKUP_FILE"
echo "Scratch: $SCRATCH_DB"
echo "Host:    $PGHOST:$PGPORT"
echo ""

# Safety: never restore into a database that looks like production
if echo "$SCRATCH_DB" | grep -qiE "prod|production|live|main"; then
  echo "ABORT: scratch database name looks like production ($SCRATCH_DB)"
  exit 1
fi

# 1. Drop + recreate scratch database
echo "→ Dropping scratch database if exists..."
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH_DB;" -q

echo "→ Creating fresh scratch database..."
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -c "CREATE DATABASE $SCRATCH_DB;" -q

# 2. Verify integrity fingerprint if present (Tier 1: backup.sh writes .sha256)
if [ -f "${BACKUP_FILE}.sha256" ]; then
  echo "→ Verifying SHA256 integrity..."
  ( cd "$(dirname "$BACKUP_FILE")" && sha256sum -c "$(basename "${BACKUP_FILE}.sha256")" )
fi

# 3. Restore
echo "→ Restoring backup..."
gunzip -c "$BACKUP_FILE" | psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$SCRATCH_DB" -v ON_ERROR_STOP=1 -q

# 3. Verify
echo "→ Verifying restore..."
TABLES=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$SCRATCH_DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
STAFF=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$SCRATCH_DB" -tAc "SELECT count(*) FROM staff;")
BRANCHES=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$SCRATCH_DB" -tAc "SELECT count(*) FROM branches;")
ENUMS=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$SCRATCH_DB" -tAc "SELECT count(*) FROM pg_enum WHERE enumtypid='staff_status'::regtype;")

echo ""
echo "=== Verification ==="
echo "Tables:      $TABLES (expect >= 69)"
echo "Staff rows:  $STAFF"
echo "Branches:    $BRANCHES (expect >= 14)"
echo "staff_status enum values: $ENUMS (expect 6)"

# 4. Pass/fail
FAIL=0
[ "$TABLES" -lt 69 ] && { echo "FAIL: too few tables"; FAIL=1; }
[ "$BRANCHES" -lt 14 ] && { echo "FAIL: too few branches"; FAIL=1; }
[ "$ENUMS" -ne 6 ] && { echo "FAIL: staff_status enum count != 6"; FAIL=1; }

if [ "$FAIL" -eq 0 ]; then
  echo ""
  echo "✅ RESTORE REHEARSAL PASSED"
  echo "   Backup is restorable. Scratch DB '$SCRATCH_DB' preserved for inspection."
  echo "   Drop when done: psql -c \"DROP DATABASE $SCRATCH_DB;\""
else
  echo ""
  echo "❌ RESTORE REHEARSAL FAILED"
  exit 1
fi
