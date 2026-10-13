#!/bin/sh
# Public, unauthenticated smoke check for a deployed Medini CRM edge.
# Usage: ./scripts/ops/smoke.sh [base-url]
set -eu

BASE_URL="${1:-${BASE_URL:-http://localhost:8080}}"
BASE_URL="${BASE_URL%/}"
TMP_DIR="${SMOKE_TMP_DIR:-./.smoke-tmp.$$}"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM
mkdir -p "$TMP_DIR"

request() {
  name="$1"
  path="$2"
  out="$TMP_DIR/$name"
  code=$(curl --silent --show-error --location \
    --connect-timeout "${SMOKE_CONNECT_TIMEOUT:-5}" \
    --max-time "${SMOKE_MAX_TIME:-15}" \
    --output "$out" --write-out '%{http_code}' \
    "$BASE_URL$path") || {
      echo "FAIL $name: request failed ($BASE_URL$path)" >&2
      exit 1
    }
  [ "$code" = "200" ] || {
    echo "FAIL $name: expected HTTP 200, got $code ($BASE_URL$path)" >&2
    exit 1
  }
  echo "PASS $name ($path)"
}

request live /health/live
grep -Eq '"status"[[:space:]]*:[[:space:]]*"alive"' "$TMP_DIR/live" || {
  echo "FAIL live: response did not report status=alive" >&2
  exit 1
}

request ready /health/ready
grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"' "$TMP_DIR/ready" || {
  echo "FAIL ready: response did not report status=ready" >&2
  exit 1
}

request frontend /
grep -Eiq '<!doctype html|<html' "$TMP_DIR/frontend" || {
  echo "FAIL frontend: response was not HTML" >&2
  exit 1
}

echo "Smoke check passed: $BASE_URL"
