#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# ============================================================================
# verify-fasa1-charge.sh — end-to-end proof of the Clinical -> Finance seam.
#
# WHY THIS SCRIPT EXISTS
#
# `POST /finance/treatment-costs` has always worked and had **no caller** in the
# product. `treatment_plans` carried what would be done; `treatment_costs` stayed
# empty; every revenue figure read RM0.00. The arithmetic was never wrong — nothing
# ever put a number in.
#
# `TreatmentPlanPanel` can pass every test it has while this seam is broken, because
# the panel only ever touched `/clinical/*`. That is the gap: each half is tested,
# the JOIN is not. This script tests the join.
#
# NAMING WARNING (learned the hard way)
#
# The letters `1a`…`1g` are ALREADY TAKEN by product sub-phases in this repo:
#   1a migration · 1b tooth chart · 1c allergy · 1d plan · 1e consent · 1g forms
# `1f` is unused. Do NOT name this `verify-fasa1c-*` — that is the allergy suite.
# This file is named for the SEAM it proves, not a letter.
#
# WHAT ONLY HTTP CAN PROVE
#
#   1. The PERMISSION split is real: a doctor records the treatment and is then
#      REFUSED the charge (403); a branch manager in the same branch is allowed.
#      Same plan, same payload, ONE variable changed — that is the only shape of
#      test a hardcoded `throw` cannot pass.
#   2. BRANCH SCOPE holds on money: a manager charging another branch is refused.
#   3. The amount SURVIVES the round trip. `unit_cost` is numeric(19,4), not integer
#      sen like `treatment_catalog.price`. Two conventions meet at this seam, so a
#      value that lands wrong is exactly what this script is looking for.
#   4. What was written is what the Finance screen READS BACK.
#
# Run from the repo root:  bash verify-fasa1-charge.sh
# ============================================================================
set -uo pipefail

API=https://localhost/api/v1
DB=medini-prod-mysql-1
DIR="${LOCALAPPDATA:-/tmp}/Temp"
mkdir -p "$DIR"

PASS=0; FAIL=0
ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
step() { echo; echo "== $1 =="; }
check(){ if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (dapat '$1', patut '$2')"; fi }

RP=$(docker exec "$DB" sh -c 'printf %s "$MYSQL_ROOT_PASSWORD"')
q() { docker exec -i "$DB" mysql -uroot -p"$RP" medini_prod -N -B -e "$1" 2>/dev/null | tr -d '\r'; }
jget() { python -c "import json,sys;d=json.load(open(sys.argv[1]));print(eval(sys.argv[2]))" "$1" "$2" 2>/dev/null; }
code() { curl -sk -o "$DIR/v1ch.json" -w '%{http_code}' "$@"; }

login() {
  curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "$1")" \
    | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null
}

TITLE='ZZTEST Ujian caj (seam 1)'

# ---------------------------------------------------------------------------
# CLEANUP — and it runs on the way OUT, including on failure.
#
# `verify-fasa1d-plan.sh` leaves its plans behind and relies on a separate
# `padam-data-fasa1d.sh` being remembered. Nobody remembers, so orphans
# accumulate, and a later run's "should be zero" assertion fails for a reason
# that has nothing to do with the code. A test must take its rubbish with it.
# ---------------------------------------------------------------------------
cleanup() {
  docker exec -i "$DB" mysql -uroot -p"$RP" medini_prod -e "
    DELETE FROM treatment_costs WHERE plan_id IN (SELECT id FROM treatment_plans WHERE title LIKE 'ZZTEST Ujian caj%');
    DELETE FROM treatment_plan_items WHERE plan_id IN (SELECT id FROM treatment_plans WHERE title LIKE 'ZZTEST Ujian caj%');
    DELETE FROM treatment_sessions WHERE plan_id IN (SELECT id FROM treatment_plans WHERE title LIKE 'ZZTEST Ujian caj%');
    DELETE FROM consent_records WHERE plan_id IN (SELECT id FROM treatment_plans WHERE title LIKE 'ZZTEST Ujian caj%');
    DELETE FROM treatment_plans WHERE title LIKE 'ZZTEST Ujian caj%';" 2>/dev/null
}
trap cleanup EXIT

# ------------------------------------------------- 0. reset, then preflight
step "0 · reset keadaan + preflight"
cleanup
LEFT=$(q "SELECT COUNT(*) FROM treatment_plans WHERE title LIKE 'ZZTEST Ujian caj%'")
check "${LEFT:-1}" "0" "keadaan direset (0 pelan ujian lama)"

# The seam needs a PRICED catalogue to be meaningful: charging from a plan whose
# treatment has no price is the "no catalogue price" path, not the happy path.
PRICED=$(q "SELECT COUNT(*) FROM treatment_catalog WHERE price IS NOT NULL AND deleted_at IS NULL")
if [ "${PRICED:-0}" -gt 0 ]; then ok "katalog ada $PRICED rawatan berharga (Fasa 1b siap)"
else bad "katalog tiada harga — prefill mustahil; siapkan Fasa 1b dahulu"; fi

HQ=$(login hq)
DOC=$(login dr.faizal)      # doctor, branch 39fef961
MGR=$(login DEMO-manager)   # branch_manager, branch 39fef961  (SAME branch)
[ ${#DOC} -gt 50 ] && ok "login dr.faizal" || { bad "login dr.faizal"; exit 1; }
[ ${#MGR} -gt 50 ] && ok "login DEMO-manager" || { bad "login DEMO-manager"; exit 1; }

DOCBR=$(q "SELECT branch_id FROM staff WHERE username='dr.faizal'")
MGRBR=$(q "SELECT branch_id FROM staff WHERE username='DEMO-manager'")
[ "$DOCBR" = "$MGRBR" ] && ok "doktor & pengurus dalam cawangan SAMA (ujian boleh diasingkan)" \
  || bad "cawangan berbeza: doktor=$DOCBR pengurus=$MGRBR"

# Patient + doctor in the manager's branch.
PAT=$(q "SELECT id FROM patients WHERE branch_id='$MGRBR' AND deleted_at IS NULL LIMIT 1")
DOCID=$(q "SELECT id FROM staff WHERE username='dr.faizal'")
[ -n "$PAT" ] && ok "pesakit dalam cawangan pengurus dijumpai" || { bad "tiada pesakit dalam cawangan pengurus"; exit 1; }

SCOPE=",\"branchId\":\"$DOCBR\",\"doctorId\":\"$DOCID\""

# ------------------------------------------------- 1. doctor creates the plan
step "1 · doktor cipta pelan + item (WHAT will be done)"
C=$(code -X POST "$API/clinical/plans" -H "Authorization: Bearer $DOC" -H 'Content-Type: application/json' \
  -d "{\"patientId\":\"$PAT\",\"title\":\"$TITLE\",\"consentRequired\":false,\"items\":[{\"description\":\"Scaling ujian caj\"},{\"description\":\"Tampalan ujian caj\"}]$SCOPE}")
check "$C" "201" "doktor cipta pelan → 201"
PLAN=$(jget "$DIR/v1ch.json" "(d.get('plan') or {}).get('id','')")
[ -n "$PLAN" ] && ok "plan id diterima (${PLAN:0:8}…)" || { bad "tiada plan id"; exit 1; }

# `GET /clinical/plans/:id` returns `{ plan, items, sessions }` - items is a SIBLING of
# the plan, not nested inside it, and the LIST endpoint omits items entirely. Reading
# `plan.items` is what made every plan render with zero items in the UI while this API
# returned them correctly. The shape is asserted here so it cannot regress.
DETAIL=$(curl -sk "$API/clinical/plans/$PLAN" -H "Authorization: Bearer $DOC")
ITEMS=$(echo "$DETAIL" | python -c "import sys,json;d=json.load(sys.stdin);print(len(d.get('items') or []))" 2>/dev/null)
[ "${ITEMS:-0}" -ge 2 ] && ok "butiran pelan membawa $ITEMS item di peringkat atas" || bad "item hilang: '$ITEMS'"
DBITEMS=$(q "SELECT COUNT(*) FROM treatment_plan_items WHERE plan_id='$PLAN'")
check "${ITEMS:-0}" "${DBITEMS:-X}" "bilangan item API sepadan dengan DB"
NESTED=$(echo "$DETAIL" | python -c "import sys,json;d=json.load(sys.stdin);print('YA' if 'items' in (d.get('plan') or {}) else 'TIDAK')" 2>/dev/null)
check "$NESTED" "TIDAK" "bentuk kekal: items ialah adik-beradik plan (UI bergantung padanya)"

# ------------------------------------------------- 2. doctor is REFUSED the charge
step "2 · doktor DITOLAK mencaj (matriks: finance:create=false)"
PAYLOAD="{\"branchId\":\"$MGRBR\",\"patientId\":\"$PAT\",\"planId\":\"$PLAN\",\"encounterId\":null,\"treatmentId\":null,\"description\":\"Scaling ujian caj\",\"quantity\":1,\"unitCost\":\"120.50\",\"costDate\":\"2026-09-28\"}"
C=$(code -X POST "$API/finance/treatment-costs" -H "Authorization: Bearer $DOC" -H 'Content-Type: application/json' -d "$PAYLOAD")
check "$C" "403" "doktor mencatat rawatan TAPI tidak boleh mencaj → 403"

# ------------------------------------------------- 3. manager is ALSO refused
step "3 · pengurus DITOLAK juga — matriks: branch_manager finance create=false"
# This is NOT a bug. `branch_manager finance = R(true, false, false, true, ...)`,
# i.e. (view, create, edit, submit, approve, del) = view + submit only. Charging
# needs `finance:create`, which only HQ holds. The consequence is worth stating
# plainly: NO BRANCH CAN BILL ITSELF — every line item of every bill in a
# 14-branch group passes through HQ. That is a THROUGHPUT decision, not an
# implementation detail, and it belongs to the owner.
C=$(code -X POST "$API/finance/treatment-costs" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "$PAYLOAD")
check "$C" "403" "pengurus (cawangan betul) mencaj → 403 — mengikut matriks, bukan pepijat"

# ------------------------------------------------- 3b. HQ charges — the only way
step "3b · HQ mencaj (satu-satunya peranan dengan finance:create)"
C=$(code -X POST "$API/finance/treatment-costs" -H "Authorization: Bearer $HQ" -H 'Content-Type: application/json' -d "$PAYLOAD")
check "$C" "201" "HQ mencaj → 201"
COST=$(jget "$DIR/v1ch.json" "d.get('id','')")
[ -n "$COST" ] && ok "caj diterima (${COST:0:8}…)" || bad "tiada id caj"

# ------------------------------------------------- 4. THE AMOUNT SURVIVES
step "4 · jumlah bertahan perjalanan penuh (numeric(19,4), bukan sen)"
UNIT=$(q "SELECT unit_cost FROM treatment_costs WHERE id='$COST'")
TOTAL=$(q "SELECT total_cost FROM treatment_costs WHERE id='$COST'")
case "$UNIT" in 120.5*|120.50*) ok "unit_cost kekal tepat ('$UNIT')";; *) bad "unit_cost berubah: '$UNIT'";; esac
case "$TOTAL" in 120.5*|120.50*) ok "total_cost = unit x kuantiti ('$TOTAL')";; *) bad "total_cost salah: '$TOTAL'";; esac

# Quantity multiplies, and the result is not float-truncated.
C=$(code -X POST "$API/finance/treatment-costs" -H "Authorization: Bearer $HQ" -H 'Content-Type: application/json' \
  -d "{\"branchId\":\"$MGRBR\",\"patientId\":\"$PAT\",\"planId\":\"$PLAN\",\"encounterId\":null,\"treatmentId\":null,\"description\":\"Tampalan ujian caj\",\"quantity\":3,\"unitCost\":\"33.33\",\"costDate\":\"2026-09-28\"}")
check "$C" "201" "caj kedua (kuantiti 3) → 201"
TOT2=$(q "SELECT total_cost FROM treatment_costs WHERE plan_id='$PLAN' AND description='Tampalan ujian caj'")
case "$TOT2" in 99.99*) ok "3 x 33.33 = 99.99 tepat (tiada hanyut float)";; *) bad "pendaraban salah: '$TOT2'";; esac

# ------------------------------------------------- 5. BRANCH SCOPE holds on money
step "5 · skop cawangan mengikat wang"
OTHER=$(q "SELECT id FROM branches WHERE id<>'$MGRBR' LIMIT 1")
C=$(code -X POST "$API/finance/treatment-costs" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' \
  -d "{\"branchId\":\"$OTHER\",\"patientId\":\"$PAT\",\"planId\":\"$PLAN\",\"encounterId\":null,\"treatmentId\":null,\"description\":\"Cuba cawangan lain\",\"quantity\":1,\"unitCost\":\"1.00\",\"costDate\":\"2026-09-28\"}")
check "$C" "403" "pengurus mencaj cawangan LAIN → 403"

# HQ's scope is 'all', so HQ MAY charge another branch — that is the escape hatch
# that keeps the group operable while the matrix stays centralised.
C=$(code -X POST "$API/finance/treatment-costs" -H "Authorization: Bearer $HQ" -H 'Content-Type: application/json' \
  -d "{\"branchId\":\"$OTHER\",\"patientId\":\"$PAT\",\"planId\":\"$PLAN\",\"encounterId\":null,\"treatmentId\":null,\"description\":\"HQ cawangan lain\",\"quantity\":1,\"unitCost\":\"1.00\",\"costDate\":\"2026-09-28\"}")
check "$C" "201" "HQ mencaj cawangan lain → 201 (skop 'all')"

# ------------------------------------------------- 6. invalid money is refused
step "6 · wang tidak sah DITOLAK (jangan rekod angka yang bukan angka)"
for BADV in '""' '"abc"' '"-5"'; do
  C=$(code -X POST "$API/finance/treatment-costs" -H "Authorization: Bearer $HQ" -H 'Content-Type: application/json' \
    -d "{\"branchId\":\"$MGRBR\",\"patientId\":\"$PAT\",\"planId\":\"$PLAN\",\"encounterId\":null,\"treatmentId\":null,\"description\":\"Nilai rosak\",\"quantity\":1,\"unitCost\":$BADV,\"costDate\":\"2026-09-28\"}")
  # 422 is Nest schema-validation (400 is the service layer for domain errors).
  # Either is a refusal; asserting the exact code keeps the test honest.
  check "$C" "422" "unitCost=$BADV ditolak → 422"
done

# ------------------------------------------------- 7. what Finance READS BACK
step "7 · apa yang skrin Finance baca semula"
C=$(code "$API/finance/treatment-costs?planId=$PLAN" -H "Authorization: Bearer $MGR")
check "$C" "200" "GET /finance/treatment-costs?planId= → 200"
# THE SEAM ASSERTION: what the database holds must equal what the API hands the screen.
# The comparison must be LIKE-FOR-LIKE: the manager reads their own branch only, so the
# DB side is filtered to the same branch. Comparing an unfiltered DB count against a
# branch-scoped API count fails on CORRECT code — which is what happened on this script's
# first run, and why the filter is here rather than an `= ALL` shortcut.
DBCOSTS=$(q "SELECT COUNT(*) FROM treatment_costs WHERE plan_id='$PLAN' AND branch_id='$MGRBR'")
N=$(python -c "import json;d=json.load(open(r'$DIR/v1ch.json'));r=d if isinstance(d,list) else (d.get('treatmentCosts') or d.get('data') or []);print(len(r))" 2>/dev/null)
check "${N:-0}" "${DBCOSTS:-X}" "bilangan caj API sepadan dengan DB cawangan sama ($DBCOSTS baris)"

# Nothing from another branch may leak into a branch reader — the negative case.
STRAY=$(python -c "import json;d=json.load(open(r'$DIR/v1ch.json'));r=d if isinstance(d,list) else (d.get('treatmentCosts') or d.get('data') or []);print(len([c for c in r if str(c.get('branchId','')) != '$MGRBR']))" 2>/dev/null)
check "${STRAY:-X}" "0" "tiada caj cawangan LAIN bocor ke pembaca cawangan"

# This branch's bill total: 120.50 + 99.99.
SUMB=$(q "SELECT SUM(total_cost) FROM treatment_costs WHERE plan_id='$PLAN' AND branch_id='$MGRBR'")
case "$SUMB" in 220.4*) ok "jumlah cawangan = 120.50 + 99.99 ('$SUMB')";; *) bad "jumlah cawangan pelik: '$SUMB'";; esac

# The GROUP total must DIFFER — proof the branch filter acted rather than being ignored,
# which would let the assertion above pass by accident.
SUMALL=$(q "SELECT SUM(total_cost) FROM treatment_costs WHERE plan_id='$PLAN'")
[ "$SUMALL" != "$SUMB" ] && ok "jumlah semua cawangan berbeza ('$SUMALL') — penapis cawangan benar-benar bertindak" \
  || bad "jumlah semua cawangan sama — penapis mungkin diabaikan"

# ------------------------------------------------- 8. the contract the UI mirrors
step "8 · kontrak kebenaran yang UI cermin (canWriteFinance = finance:create)"
# `app/src/lib/permissions.ts` decides what the UI OFFERS. Three separate screens had
# written the same rule inline, and one of them (Record Expense) offered a form that
# could only 403. This section pins the contract those helpers mirror, so a future
# change to the matrix shows up as a FAIL here rather than as a dead button in the UI.
#
# Money-writing needs `finance:create`; ONLY HQ holds it. Reading is wider.

C=$(code "$API/finance/expenses" -H "Authorization: Bearer $HQ")
check "$C" "200" "HQ boleh BACA kewangan → 200"
C=$(code "$API/finance/expenses" -H "Authorization: Bearer $MGR")
check "$C" "200" "pengurus boleh BACA kewangan → 200 (cawangannya)"
C=$(code "$API/finance/expenses" -H "Authorization: Bearer $DOC")
check "$C" "403" "doktor TIADA halaman kewangan → 403"

C=$(code -X POST "$API/finance/expenses" -H "Authorization: Bearer $HQ" -H 'Content-Type: application/json' \
  -d "{\"branchId\":\"$MGRBR\",\"category\":\"Supplies\",\"payee\":\"ZZTEST kedai ujian\",\"amount\":\"1.00\",\"expenseDate\":\"2026-09-28\"}")
check "$C" "201" "HQ boleh TULIS kewangan → 201"

C=$(code -X POST "$API/finance/expenses" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' \
  -d "{\"branchId\":\"$MGRBR\",\"category\":\"Supplies\",\"payee\":\"ZZTEST cuba pengurus\",\"amount\":\"1.00\",\"expenseDate\":\"2026-09-28\"}")
check "$C" "403" "pengurus DITOLAK menulis kewangan → 403 (baca sahaja)"

# The branch must be named. HQ with "All Branches" selected sends null — the default
# state of the switcher, and the reason the commonest HQ path used to fail.
C=$(code -X POST "$API/finance/expenses" -H "Authorization: Bearer $HQ" -H 'Content-Type: application/json' \
  -d "{\"branchId\":null,\"category\":\"Supplies\",\"payee\":\"ZZTEST tanpa cawangan\",\"amount\":\"1.00\",\"expenseDate\":\"2026-09-28\"}")
check "$C" "422" "perbelanjaan TANPA cawangan ditolak → 422 (UI kini sekatan sebelum hantar)"

# THE FORM CONTRACT. The Record Expense form previously sent `category: "supplies"`
# (lowercase, from a list that shared not one value with the server) and
# `amount: 12.5` (a number against a decimal-string field). TWO independent reasons
# it could never succeed, and nothing failed until a person tried it.
#
# These assertions pin the wire contract so the form cannot drift from the server again.
C=$(code -X POST "$API/finance/expenses" -H "Authorization: Bearer $HQ" -H 'Content-Type: application/json' \
  -d "{\"branchId\":\"$MGRBR\",\"category\":\"supplies\",\"payee\":\"ZZTEST huruf kecil\",\"amount\":\"1.00\",\"expenseDate\":\"2026-09-28\"}")
check "$C" "422" "kategori huruf kecil DITOLAK → 422 (senarai mesti padan huruf demi huruf)"

C=$(code -X POST "$API/finance/expenses" -H "Authorization: Bearer $HQ" -H 'Content-Type: application/json' \
  -d "{\"branchId\":\"$MGRBR\",\"category\":\"Supplies\",\"payee\":\"ZZTEST amount nombor\",\"amount\":1.00,\"expenseDate\":\"2026-09-28\"}")
check "$C" "422" "amount sebagai NOMBOR ditolak → 422 (mesti rentetan perpuluhan)"

# And the UI's own list must equal the server's, element for element. A shared list
# cannot drift; two lists will.
UI_CATS=$(grep -o '"[A-Z][A-Za-z &]*"' app/src/pages/Finance.tsx | sort -u | tr '\n' '|')
DRIFT=0
for CAT in "Utilities" "Payroll" "Doctor Commission" "Insurance" "Taxes & Government" \
           "Premises" "Maintenance" "Supplies" "Professional Services" "Lab Fees" "Operations"; do
  case "$UI_CATS" in *"\"$CAT\""*) ;; *) DRIFT=$((DRIFT+1));; esac
done
check "$DRIFT" "0" "senarai kategori UI mengandungi SEMUA nilai pelayan (0 hilang)"

# THE DEFAULT IS A CATEGORY TOO. Fixing the option list was not enough: the form STARTED
# with the old lowercase `"supplies"`, and a Radix Select whose value is absent from its
# items renders blank — so the screen looked fine while the state held a rejected string.
# Only pressing the button exposed it. This greps the SOURCE for a lowercase category
# literal in code (comments excluded) so the stale default cannot come back.
LOWER=$(grep -nE 'category: "[a-z]' app/src/pages/Finance.tsx | grep -v '^\s*\*' | grep -vE ':\s*\*' | wc -l | tr -d ' ')
check "${LOWER:-X}" "0" "tiada literal kategori huruf kecil dlm kod Finance (lalai mesti sah)"

# Clean the probe rows the same way the rest of the script does.
docker exec -i "$DB" mysql -uroot -p"$RP" medini_prod -e "DELETE FROM expenses WHERE payee LIKE 'ZZTEST%';" 2>/dev/null

echo
echo "======================================================"
echo "  PASS: $PASS    FAIL: $FAIL"
echo "======================================================"
echo
echo "NOTA: skrip ini membersihkan pelan/caj ujiannya sendiri (trap EXIT)."
[ "$FAIL" -eq 0 ] || exit 1
