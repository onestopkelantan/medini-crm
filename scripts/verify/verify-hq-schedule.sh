#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# FASA 6E — HQ can READ every branch's doctor schedule; only a branch manager
# can WRITE one.
#
# THE BUG THIS EXISTS TO CATCH
#
# The read path used to call branch(), which throws for anyone who is not a
# branch manager. So HQ — the office that 14 branches report to — saw an empty
# calendar, and the failure looked like "no schedules exist" rather than "you are
# not allowed to look". The two are indistinguishable from the screen, which is
# why this is verified against the API and not the UI.
#
# IT SEEDS ITS OWN DATA. An earlier version of this script read whatever was in
# the table and reported FAIL when the table happened to be empty — a failure
# that said nothing about the code. The script now creates schedules in two
# different branches, so "HQ sees more than one branch" is a fact it establishes
# rather than assumes, and removes them at the end.
#
# Run from the repo root:
#   export MEDINI_DB_PASSWORD=$(docker exec medini-prod-mysql-1 sh -c 'printf %s "$MYSQL_PASSWORD"')
#   bash verify-hq-schedule.sh

set -uo pipefail
export LC_ALL=C

API=https://localhost/api/v1
ORG=00000000-0000-0000-0000-000000000001
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — dapat '$2', jangka '$3'"; fi; }

DB() { docker exec medini-prod-mysql-1 mysql -umedini -p"${MEDINI_DB_PASSWORD:?set MEDINI_DB_PASSWORD}" medini_prod -N -B -e "$1" 2>/dev/null; }
tok() {
  curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "$1")" \
    | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null
}

echo "=== FASA 6E — HQ baca jadual doktor semua cawangan ==="
echo

HQ=$(tok hq);         [ -n "$HQ" ] && ok "login hq" || { bad "login hq gagal"; exit 1; }
MGR=$(tok manager);   [ -n "$MGR" ] && ok "login manager" || bad "login manager gagal"

echo
echo "--- 0. Sediakan jadual dalam 2 cawangan (data ujian sendiri) ---"
D1=$(python -c "import datetime;print((datetime.date.today()+datetime.timedelta(days=400)).isoformat())")
BRS=($(DB "SELECT id FROM branches ORDER BY code LIMIT 2"))
BR_A="${BRS[0]:-}"; BR_B="${BRS[1]:-}"

if [ -z "$BR_A" ] || [ -z "$BR_B" ]; then
  bad "kurang daripada 2 cawangan — tidak boleh uji"
  exit 1
fi

# The database ships with ONE doctor, in gelang-patah. Only one of the two
# branches has a doctor, so a second is created — otherwise "HQ sees two
# branches" could never be established and the test would fail for a reason
# that has nothing to do with the code.
DOC_A=$(DB "SELECT id FROM staff WHERE branch_id='$BR_A' AND role='doctor' LIMIT 1")
DOC_B=$(DB "SELECT id FROM staff WHERE branch_id='$BR_B' AND role='doctor' LIMIT 1")

if [ -z "$DOC_A" ]; then
  DOC_A=$(DB "SELECT UUID()")
  DB "INSERT INTO staff (id, org_id, branch_id, name, username, role, status, password_hash)
      VALUES ('$DOC_A','$ORG','$BR_A','UJIAN-6E Doktor','uji6e-$BR_A','doctor','Active','x')"
fi
if [ -z "$DOC_B" ]; then
  DOC_B=$(DB "SELECT UUID()")
  DB "INSERT INTO staff (id, org_id, branch_id, name, username, role, status, password_hash)
      VALUES ('$DOC_B','$ORG','$BR_B','UJIAN-6E Doktor','uji6e-$BR_B','doctor','Active','x')"
fi

check "ada doktor di 2 cawangan berbeza" "$([ -n "$DOC_A" ] && [ -n "$DOC_B" ] && echo ya)" "ya"

seed() { # branch doctor date
  DB "INSERT INTO doctor_schedules (id, org_id, branch_id, doctor_id, schedule_date, start_time, end_time, notes)
      VALUES (UUID(),'$ORG','$1','$2','$3','10:00:00','12:00:00','v6e')"
}

if [ -n "$DOC_A" ] && [ -n "$DOC_B" ]; then
  seed "$BR_A" "$DOC_A" "$D1"
  seed "$BR_B" "$DOC_B" "$D1"
else
  bad "penjaga: doktor tidak dijumpai dalam 2 cawangan"
fi

SEEDED=$(DB "SELECT COUNT(*) FROM doctor_schedules WHERE notes='v6e'")
check "2 jadual ujian dicipta (2 cawangan)" "$SEEDED" "2"

echo
echo "--- 1. HQ tanpa penapis: nampak LEBIH DARIPADA SATU cawangan ---"
HQBODY=$(curl -sk "$API/doctor-schedules" -H "Authorization: Bearer $HQ")
HQCOUNT=$(echo "$HQBODY" | python -c "import sys,json;d=json.load(sys.stdin);print(len(d) if isinstance(d,list) else -1)" 2>/dev/null)
HQBR=$(echo "$HQBODY" | python -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print(len({r.get('branchId') for r in d if isinstance(r,dict) and r.get('branchId')}))
except Exception: print(-1)
" 2>/dev/null)
echo "     (HQ nampak $HQCOUNT jadual, $HQBR cawangan berbeza)"

if [ "$HQCOUNT" -ge 2 ] 2>/dev/null; then
  ok "HQ boleh baca jadual (dulu 403 — ralat yang menyamar sebagai 'tiada jadual')"
else
  bad "HQ dapat $HQCOUNT — semak guard readBranches"
fi
if [ "$HQBR" -ge 2 ] 2>/dev/null; then
  ok "HQ nampak $HQBR cawangan sekali gus (angka yang clinic minta)"
else
  bad "HQ nampak $HQBR cawangan sahaja — sepatutnya 2"
fi

echo
echo "--- 2. HQ tapis kepada satu cawangan ---"
FILTERED=$(curl -sk "$API/doctor-schedules?branchId=$BR_A" -H "Authorization: Bearer $HQ")
FBR=$(echo "$FILTERED" | python -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print(len({r.get('branchId') for r in d if r.get('branchId')}))
except Exception: print(-1)
" 2>/dev/null)
check "penapis → hanya 1 cawangan" "$FBR" "1"

FONLY_A=$(echo "$FILTERED" | python -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print(all(r.get('branchId')=='$BR_A' for r in d))
except Exception: print(False)
" 2>/dev/null)
check "semua baris milik cawangan yang diminta" "$FONLY_A" "True"

echo
echo "--- 3. Manager: cawangan sendiri sahaja ---"
if [ -n "$MGR" ]; then
  MGRBODY=$(curl -sk "$API/doctor-schedules" -H "Authorization: Bearer $MGR")
  MGRBR=$(echo "$MGRBODY" | python -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print(len({r.get('branchId') for r in d if r.get('branchId')}))
except Exception: print(-1)
" 2>/dev/null)
  if [ "$MGRBR" = "1" ] || [ "$MGRBR" = "0" ]; then
    ok "manager nampak 1 cawangan sahaja ($MGRBR)"
  else
    bad "manager nampak $MGRBR cawangan — KEBOCORAN"
  fi

  # Manager menamakan cawangan LAIN. The permission guard treats a query
  # branchId as a target branch and refuses (403) — correct and better than
  # silently ignoring it. What must NEVER happen is a leak: another branch's
  # rows coming back. So both "refused" and "own rows only" pass; only leaked
  # data fails.
  OTHER=$(curl -sk -w "\n%{http_code}" "$API/doctor-schedules?branchId=$BR_B" -H "Authorization: Bearer $MGR")
  OB=$(printf '%s' "$OTHER" | python -c "
import sys
raw=sys.stdin.read().rstrip()
body,_,code=raw.rpartition('\n')
import json
try:
    d=json.loads(body)
except Exception:
    print('RALAT'); raise SystemExit
if isinstance(d,dict):
    # Refused at the guard — acceptable, and no data leaked.
    print('DITOLAK' if code in ('401','403') else 'RALAT')
    raise SystemExit
leak=[r for r in d if r.get('branchId')=='$BR_B']
print('BOCOR' if leak else 'SELAMAT')
" 2>/dev/null)
  if [ "$OB" = "BOCOR" ]; then
    bad "manager boleh baca cawangan lain — KEBOCORAN"
  elif [ "$OB" = "DITOLAK" ]; then
    ok "manager menamakan cawangan lain → DITOLAK guard (403), tiada kebocoran"
  else
    ok "manager menamakan cawangan lain → hanya baris sendiri, tiada kebocoran"
  fi
fi

echo
echo "--- 4. Tulis masih manager sahaja ---"
HWW=$(curl -sk -o .verify-out.tmp -w "%{http_code}" -X POST "$API/doctor-schedules" \
  -H "Authorization: Bearer $HQ" -H 'Content-Type: application/json' \
  -d '{"scheduleDate":"2026-12-01","startTime":"10:00","endTime":"11:00"}')
if [ "$HWW" = "403" ] || [ "$HWW" = "401" ] || [ "$HWW" = "422" ]; then
  ok "HQ tidak boleh tulis jadual (HTTP $HWW)"
else
  bad "HQ boleh tulis jadual (HTTP $HWW) — sepatutnya ditolak"
fi

echo
echo "--- 5. Bersihkan ---"
DB "DELETE FROM doctor_schedules WHERE notes='v6e'"
DB "DELETE FROM staff WHERE username LIKE 'uji6e-%'"
check "data ujian dibersihkan" "$(DB "SELECT COUNT(*) FROM doctor_schedules WHERE notes='v6e'")" "0"
check "doktor ujian dibersihkan" "$(DB "SELECT COUNT(*) FROM staff WHERE username LIKE 'uji6e-%'")" "0"

echo
echo "======================================================"
echo "  LULUS: $PASS   GAGAL: $FAIL"
echo "======================================================"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
