#!/bin/sh
# ============================================================================
# Medini CRM — PostgreSQL WAL archiver (Tier 1, P7-F3 remediation)
#
# Runs as the postgres `archive_command`. For every completed WAL segment
# PostgreSQL invokes:  wal-archive.sh %p %f
#   %p = path of the segment relative to the data dir (e.g. pg_wal/0000000100000001000000A3)
#   %f = segment filename
#
# Durability contract:
#   - Copy to a NEW .tmp name, then atomic rename → a partial archive file is
#     never visible as a valid segment.
#   - fsync the file data before rename so the segment survives a crash.
#   - Exit 0 ONLY on success. On any failure exit non-zero so PostgreSQL
#     RETRIES the segment (WAL is not recycled until archived).
#
# Safety: set -euo pipefail; the archive directory is on a SEPARATE Docker
# volume (walarchive) from pgdata, so a pgdata loss does not take the WAL
# archive with it.
# ============================================================================
set -euo pipefail

SRC="$1"          # %p — relative path from the data directory
SEG="$2"          # %f — WAL segment file name
DEST_DIR="${WAL_ARCHIVE_DIR:-/walarchive}"
DEST="${DEST_DIR}/${SEG}"
TMP="${DEST}.tmp.$$"

# 1. Copy to temp name in the SAME filesystem (required for atomic rename).
cp "$SRC" "$TMP"

# 2. Durability: flush file data to disk before the rename.
sync -f "$TMP" 2>/dev/null || sync

# 3. Atomic publish.
mv -f "$TMP" "$DEST"

# 4. Flush the directory entry.
sync -f "$DEST_DIR" 2>/dev/null || sync

exit 0
