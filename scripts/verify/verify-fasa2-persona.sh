#!/usr/bin/env bash
# verify-fasa2-persona.sh — who may open which patient, per role.
#
# THE RULE (Boss decision, Seksyen 1 Fasa 2):
#
#   hq             — every patient, every branch, full detail
#   branch_manager — every patient, every branch, full detail  (oversight role)
#   branch_admin   — every patient in the clinic               (counter/admin)
#   doctor         — ONLY patients they treat, at ANY branch
#
# Two things this locks in that were wrong before:
#   1. A branch manager must open a patient from another branch. He used to get
#      404 "Patient not found" for the one role that supervises the whole clinic.
#   2. A doctor must open a patient they treated at ANOTHER branch, and must be
#      DENIED a patient they never treated — even one sitting in his own branch.
#      Branch is not the doctor's boundary; the patient link is.
#
# The script is data-driven: it reads each role's own patient list and compares,
# so it survives re-seeding and does not hardcode which doctor treats whom.
#
# Usage:  BASE_URL="https://localhost/api/v1" bash verify-fasa2-persona.sh
# Needs:  demo patients seeded, and at least 2 doctors with different patients.

set -uo pipefail
cd "$(dirname "$0")"

BASE_URL="${BASE_URL:-https://localhost/api/v1}"
PW="${PW:-${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}}"
PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }

# ---------------------------------------------------------------------------
# Login. Rate limit is 5/min per IP, so logins are spaced out. curl is used
# (fresh connection per call) rather than a keep-alive client for the same
# reason.
# ---------------------------------------------------------------------------
login() { # login USER -> token (empty on failure)
  local out
  out=$(curl -sk -X POST "$BASE_URL/auth/login" -H 'Content-Type: application/json' \
        -d "$(LOGIN_PASSWORD="$PW" python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["LOGIN_PASSWORD"]}))' "$1")")
  printf '%s' "$out" | python -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print(d.get('accessToken') or d.get('token') or '')
except Exception:
    print('')
" 2>/dev/null | tr -d '\r'
}

# ids_user TOKEN -> newline-separated patient ids visible to that user
# /patients returns a BARE ARRAY (not {items:[]}) — handled both ways.
ids_user() {
  curl -sk "$BASE_URL/patients?limit=200" -H "Authorization: Bearer $1" | python -c "
import sys,json
try:
    d=json.load(sys.stdin)
except Exception:
    sys.exit(0)
rows = d if isinstance(d, list) else (d.get('items') or d.get('data') or [])
for r in rows:
    pid = r.get('id') if isinstance(r, dict) else None
    if pid: print(pid)
" 2>/dev/null | tr -d '\r'
}

# code TOKEN PATH -> HTTP status
code() { curl -sk -o /dev/null -w '%{http_code}' "$BASE_URL$2" -H "Authorization: Bearer $1"; }

echo "== login =="
TOK_HQ=$(login hq);                     sleep 13
TOK_MGR=$(login DEMO-manager);          sleep 13
TOK_DOC=$(login dr.faizal);             sleep 13
TOK_DOC2=$(login dr.aina);              sleep 13
TOK_KTR=$(login DEMO-kaunter)

for pair in "hq:$TOK_HQ" "DEMO-manager:$TOK_MGR" "dr.faizal:$TOK_DOC" "dr.aina:$TOK_DOC2" "DEMO-kaunter:$TOK_KTR"; do
  who="${pair%%:*}"; tok="${pair#*:}"
  [ -n "$tok" ] && pass "login $who" || fail "login $who"
done

ALL_IDS=$(ids_user "$TOK_HQ")
N_ALL=$(printf '%s\n' "$ALL_IDS" | grep -c . || true)
echo
echo "pesakit dalam sistem: $N_ALL"
[ "$N_ALL" -gt 0 ] || { echo "TIADA pesakit demo — ujian tidak bermakna, berhenti"; exit 1; }

# ---------------------------------------------------------------------------
# Oversight + counter roles: must open EVERY patient, including other branches.
# This is the exact call that used to 404 for the manager.
# ---------------------------------------------------------------------------
echo
echo "== pengawasan (HQ, pengurus) + kaunter: semua pesakit =="
for pair in "hq:$TOK_HQ" "pengurus:$TOK_MGR" "kaunter:$TOK_KTR"; do
  role="${pair%%:*}"; tok="${pair#*:}"
  [ -z "$tok" ] && continue
  ok=0; bad=0; worst=""
  for pid in $ALL_IDS; do
    c=$(code "$tok" "/patients/$pid")
    if [ "$c" = "200" ]; then ok=$((ok+1)); else bad=$((bad+1)); worst="$c"; fi
  done
  if [ "$bad" -eq 0 ]; then
    pass "$role boleh buka SEMUA $ok pesakit (200)"
  else
    fail "$role gagal buka $bad/$N_ALL pesakit (cth $worst) — pengawasan bukan cawangan"
  fi
done

# ---------------------------------------------------------------------------
# Doctor: own patients open, everyone else's closed.
# ---------------------------------------------------------------------------
echo
echo "== doktor: pesakit sendiri sahaja =="
for pair in "dr.faizal:$TOK_DOC" "dr.aina:$TOK_DOC2"; do
  who="${pair%%:*}"; tok="${pair#*:}"
  [ -z "$tok" ] && continue

  MINE=$(ids_user "$tok")
  N_MINE=$(printf '%s\n' "$MINE" | grep -c . || true)
  [ "$N_MINE" = "0" ] && { echo "  ($who tiada pesakit berpaut — langkau)"; continue; }

  ok=0; bad=0
  for pid in $MINE; do
    c=$(code "$tok" "/patients/$pid")
    if [ "$c" = "200" ]; then ok=$((ok+1)); else bad=$((bad+1)); fi
  done
  [ "$bad" -eq 0 ] && pass "$who boleh buka semua $ok pesakit dia rawat" \
                   || fail "$who gagal buka $bad pesakit dia sendiri"

  # Negative: every patient NOT in his list must be denied. Without this the
  # suite would still pass if the doctor guard were removed entirely.
  n_den=0; n_leak=0
  for pid in $ALL_IDS; do
    printf '%s\n' "$MINE" | grep -qx "$pid" && continue
    c=$(code "$tok" "/patients/$pid")
    if [ "$c" = "403" ] || [ "$c" = "404" ]; then n_den=$((n_den+1)); else n_leak=$((n_leak+1)); fi
  done
  [ "$n_leak" -eq 0 ] && pass "$who DITOLAK utk $n_den pesakit bukan pesakitnya" \
                      || fail "$who boleh buka $n_leak pesakit yg dia TAK rawat"
done

# ---------------------------------------------------------------------------
# Marketing stays HQ + manager. Doctors and counter have no business here.
# ---------------------------------------------------------------------------
echo
echo "== marketing: HQ + pengurus sahaja =="
for pair in "hq:$TOK_HQ:200" "pengurus:$TOK_MGR:200" "dr.faizal:$TOK_DOC:403" "kaunter:$TOK_KTR:403"; do
  role="${pair%%:*}"; rest="${pair#*:}"; tok="${rest%%:*}"; want="${rest##*:}"
  [ -z "$tok" ] && continue
  c=$(code "$tok" "/marketing/leads?limit=5")
  [ "$c" = "$want" ] && pass "$role marketing -> $c" || fail "$role marketing -> $c (jangka $want)"
done

echo
echo "================================"
echo "PASS: $PASS   FAIL: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
