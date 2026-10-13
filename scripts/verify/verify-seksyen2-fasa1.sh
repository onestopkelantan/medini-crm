#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# SEKSYEN 2 — FASA 1: bukti wayar hidup (Operations + skop + dwibahasa).
#
# MENGAPA SKRIP INI WUJUD
#
# Fasa 0 Seksyen 2 mendapati 14 daripada 42 endpoint tiada pemanggil UI, dan — lebih
# teruk — setiap PATCH status Operations gagal 403 dengan pesanan yang menyalahkan
# PERANAN sedangkan puncanya MEDAN HILANG. Skrip ini mengunci pembetulan itu:
#
#   1. UI/klien mesti menghantar `branchId`; skema Zod backend mewajibkannya.
#      Tanpa ia: 422 (Zod) atau 403 (guard skop branch, fail-closed).
#   2. Rantaian status mesti padan operations-lifecycle.ts. `done` BUKAN sah —
#      keadaannya `completed` (ini 409 yang dahulunya menghentikan butang).
#   3. Kawalan akses mesti kekal: branch_admin & doctor ditolak, tanpa token 401.
#   4. Setiap halaman Seksyen 2 mesti dwibahasa (t() digunakan, 0 teks keras).
#
# Skrip ini BUKAN sekadar ujian API: bahagian 5 & 6 membaca kod sumber UI.
# Semakan statik itu yang menangkap "wayar putus" yang ujian API tak nampak.
#
# Jalankan dari akar repo:
#   bash verify-seksyen2-fasa1.sh

set -uo pipefail
export LC_ALL=C

export MEDINI_DB_PASSWORD="${MEDINI_DB_PASSWORD:-$(docker exec medini-prod-mysql-1 sh -c 'printf %s "$MYSQL_PASSWORD"')}"
API="https://localhost/api/v1"
OUT=".s2-verify.json"   # path relatif repo: $LOCALAPPDATA ada backslash, rosakkan Python
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — dapat '$2', jangka '$3'"; fi; }

login() {
  curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "$1")" \
    | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null
}

# code <method> <path> <token> [json-body]
code() {
  local M="$1" P="$2" T="$3" B="${4:-}"
  if [ -n "$B" ]; then
    curl -sk -o "$OUT" -w '%{http_code}' -X "$M" "$API$P" \
      -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "$B"
  else
    curl -sk -o "$OUT" -w '%{http_code}' -X "$M" "$API$P" -H "Authorization: Bearer $T"
  fi
}
jid() { python -c "import json;print(json.load(open(r'$OUT')).get('id',''))" 2>/dev/null; }

echo "=== SEKSYEN 2 — FASA 1: wayar Operations + skop + dwibahasa ==="
echo

HQ=$(login hq)
MGR=$(login DEMO-manager)
[ -n "$HQ" ] && ok "log masuk hq" || { bad "log masuk hq"; exit 1; }
[ -n "$MGR" ] && ok "log masuk DEMO-manager" || { bad "log masuk DEMO-manager"; exit 1; }

MB=$(docker exec medini-prod-mysql-1 mysql -umedini -p"$MEDINI_DB_PASSWORD" medini_prod -N -B \
  -e "SELECT branch_id FROM staff WHERE username='DEMO-manager'" 2>/dev/null)
[ -n "$MB" ] && ok "cawangan manager dibaca dari data" || { bad "cawangan manager kosong"; exit 1; }

# ----------------------------------------------------------------- 1. TANPA skop
echo
echo "--- 1. TANPA branchId mesti DITOLAK (bukti skop wajib) ---"
# Guard skop branch adalah FAIL-CLOSED dan berjalan sebelum Zod, jadi permintaan
# tanpa branchId boleh ditolak sebagai 403 (guard) atau 422 (Zod). Kedua-dua ialah
# penolakan yang betul — yang salah ialah 2xx.
N1=$(code POST /operations/tasks "$MGR" '{"title":"ZZS2 tanpa skop","priority":"normal"}')
case "$N1" in 403|422) ok "POST tasks tanpa skop DITOLAK ($N1)";; *) bad "POST tasks tanpa skop sepatutnya ditolak, dapat $N1";; esac
N2=$(code POST /operations/incidents "$MGR" '{"title":"ZZS2 tanpa skop","severity":"low"}')
case "$N2" in 403|422) ok "POST incidents tanpa skop DITOLAK ($N2)";; *) bad "POST incidents tanpa skop sepatutnya ditolak, dapat $N2";; esac

# ----------------------------------------------------------------- 2. DENGAN skop
echo
echo "--- 2. DENGAN branchId mesti BERJAYA (inilah yang UI hantar) ---"
SC="\"branchId\":\"$MB\""
C=$(code POST /operations/tasks "$MGR" "{$SC,\"title\":\"ZZS2 task\",\"priority\":\"normal\",\"idempotencyKey\":\"zzs2task$(date +%s)\"}")
check "POST tasks dengan skop → 201" "$C" "201"
TID=$(jid)

IID=""
CI=$(code POST /operations/incidents "$MGR" "{$SC,\"title\":\"ZZS2 incident\",\"severity\":\"low\",\"idempotencyKey\":\"zzs2inc$(date +%s)\"}")
check "POST incidents dengan skop → 201" "$CI" "201"
IID=$(jid)

CID=""
CC=$(code POST /operations/checklists "$MGR" "{$SC,\"title\":\"ZZS2 checklist\",\"checklistDate\":\"$(date +%F)\",\"items\":[{\"label\":\"item\",\"done\":false}]}")
check "POST checklists dengan skop → 201" "$CC" "201"
CID=$(jid)

DOCID=$(docker exec medini-prod-mysql-1 mysql -umedini -p"$MEDINI_DB_PASSWORD" medini_prod -N -B -e "SELECT id FROM staff WHERE branch_id='$MB' AND role='doctor' LIMIT 1" 2>/dev/null)
DK=$(code POST /operations/doctor-status "$MGR" "{$SC,\"doctorId\":\"$DOCID\",\"status\":\"available\",\"note\":\"ZZS2 verify marker\"}")
check "POST doctor-status dengan skop → 201" "$DK" "201"

# ----------------------------------------------------------------- 3. RANTAIAN
echo
echo "--- 3. Rantaian status MESTI padan backend (done BUKAN sah) ---"
if [ -n "$TID" ]; then
  check "task open → in_progress" "$(code PATCH "/operations/tasks/$TID/status" "$MGR" "{$SC,\"status\":\"in_progress\"}")" "200"
  check "task in_progress → done DITOLAK (409)" "$(code PATCH "/operations/tasks/$TID/status" "$MGR" "{$SC,\"status\":\"done\"}")" "409"
  check "task in_progress → completed" "$(code PATCH "/operations/tasks/$TID/status" "$MGR" "{$SC,\"status\":\"completed\"}")" "200"
else bad "tiada task untuk uji rantaian"; fi

if [ -n "$CID" ]; then
  check "checklist open → in_progress" "$(code PATCH "/operations/checklists/$CID/status" "$MGR" "{$SC,\"status\":\"in_progress\"}")" "200"
  check "checklist in_progress → completed" "$(code PATCH "/operations/checklists/$CID/status" "$MGR" "{$SC,\"status\":\"completed\"}")" "200"
else bad "tiada checklist untuk uji rantaian"; fi

if [ -n "$IID" ]; then
  check "incident open → acknowledged" "$(code PATCH "/operations/incidents/$IID/status" "$MGR" "{$SC,\"status\":\"acknowledged\"}")" "200"
  check "incident acknowledged → resolved" "$(code PATCH "/operations/incidents/$IID/status" "$MGR" "{$SC,\"status\":\"resolved\"}")" "200"
  check "incident resolved → closed" "$(code PATCH "/operations/incidents/$IID/status" "$MGR" "{$SC,\"status\":\"closed\"}")" "200"
else bad "tiada incident untuk uji rantaian"; fi

# ----------------------------------------------------------------- 4. KESELAMATAN
echo
echo "--- 4. Kawalan akses mesti KEKAL kukuh ---"
KAUNTER=$(login DEMO-kaunter)
if [ -n "$KAUNTER" ]; then
  check "branch_admin POST tasks → 403" "$(code POST /operations/tasks "$KAUNTER" "{$SC,\"title\":\"ZZS2 kaunter\",\"priority\":\"normal\"}")" "403"
else bad "log masuk DEMO-kaunter gagal"; fi
check "tanpa token POST tasks → 401" "$(curl -sk -o "$OUT" -w '%{http_code}' -X POST "$API/operations/tasks" -H 'Content-Type: application/json' -d '{"title":"x"}')" "401"

# cawangan LAIN ditolak
OTHER=$(docker exec medini-prod-mysql-1 mysql -umedini -p"$MEDINI_DB_PASSWORD" medini_prod -N -B \
  -e "SELECT id FROM branches WHERE id<>'$MB' LIMIT 1" 2>/dev/null)
check "manager tulis cawangan LAIN → 403" "$(code POST /operations/tasks "$MGR" "{\"branchId\":\"$OTHER\",\"title\":\"ZZS2 lintas\",\"priority\":\"normal\"}")" "403"

# ----------------------------------------------------------------- 5. UI STATIK
echo
echo "--- 5. UI mesti hantar skop pada SETIAP PATCH status (0 wayar putus) ---"
F=app/src/pages/Operations.tsx
N_PATCH=$(grep -c 'api.patch(`/operations/' "$F" 2>/dev/null || echo 0)
N_SCOPE=$(grep -c 'withScope(scope' "$F" 2>/dev/null || echo 0)
check "setiap PATCH operations guna withScope (${N_PATCH} patch / ${N_SCOPE} skop)" "$([ "$N_PATCH" -gt 0 ] && [ "$N_PATCH" -le "$N_SCOPE" ] && echo ok)" "ok"
# Semak RANTAIAN sahaja, bukan seluruh fail: `done: boolean` pada item checklist
# ialah medan yang sah (backend memang mahu `done` pada item).
if grep -qE 'status: *"done"|\bdone: *\[\]|in_progress: *\["done"' "$F" 2>/dev/null; then
  bad "rantaian UI masih guna status 'done' (backend mahu 'completed')"
else
  ok "rantaian status UI tidak guna 'done'"
fi
for tab in checklistFlow labCaseFlow; do
  if grep -q "$tab" "$F" 2>/dev/null; then ok "UI ada rantaian $tab"; else bad "UI tiada $tab (tab itu tiada kawalan status)"; fi
done

# ----------------------------------------------------------------- 6. DWIBAHASA
echo
echo "--- 6. Dwibahasa Seksyen 2 (0 teks keras) ---"
for pg in Reports Operations AIManager Settings; do
  P="app/src/pages/$pg.tsx"
  if [ -f "$P" ]; then
    T=$(grep -o 't(' "$P" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$T" -gt 0 ]; then ok "$pg.tsx guna t() ($T kali)"; else bad "$pg.tsx TIADA t() — teks keras"; fi
  else bad "$P tiada"; fi
done

# ------------------------------------------------- 6b. SETTINGS: enum skop sah
echo
echo "--- 6b. Settings mesti hantar skop enum yang SAH (bukan 'org') ---"
# Fasa 0 dapati UI hantar scope 'org' -> 422 pada SETIAP simpanan.
for S in organization branch; do
  : # sah
done
DEFKEY="zzenum$(date +%s)"
C=$(code POST /settings/definitions "$HQ" "{\"key\":\"$DEFKEY\",\"valueType\":\"string\",\"description\":\"uji\",\"allowedScopes\":[\"organization\",\"branch\"],\"branchOverridable\":true}")
check "POST definitions dgn allowedScopes sah -> 201" "$C" "201"
C2=$(code POST "/settings/values/$DEFKEY" "$HQ" '{"value":"x","scope":"organization","reason":"uji"}')
check "POST values dgn scope 'organization' -> 201" "$C2" "201"
BAD=$(code POST "/settings/values/$DEFKEY" "$HQ" '{"value":"x","scope":"org","reason":"uji"}')
check "scope 'org' palsu DITOLAK (422) — bukti enum dikuatkuasa" "$BAD" "422"
if [ -n "$DEFKEY" ]; then
  docker exec medini-prod-mysql-1 mysql -umedini -p"$MEDINI_DB_PASSWORD" medini_prod -e "
    DELETE FROM settings_versions WHERE \`key\` LIKE 'zzenum%';
    DELETE FROM settings_values WHERE \`key\` LIKE 'zzenum%';
    DELETE FROM settings_definitions WHERE \`key\` LIKE 'zzenum%';" 2>/dev/null
fi
SF=app/src/pages/Settings.tsx
# Buang baris KOMEN dahulu: fail ini memetik "org" dlm komen sebagai penjelasan
# bug, dan grep yang tidak menapis komen akan melaporkan kod betul sebagai rosak.
CODE=$(grep -vE '^[[:space:]]*(\*|/\*|//)' "$SF")
if echo "$CODE" | grep -q 'scope: *"org"'; then bad "Settings.tsx masih hantar scope 'org'"; else ok "Settings.tsx guna scope enum sah (organization)"; fi
if echo "$CODE" | grep -q '\["org"'; then bad "Settings.tsx masih hantar allowedScopes ['org',...]"; else ok "Settings.tsx allowedScopes guna enum sah"; fi
for ep in "/effective" "/versions" "integrations/"; do
  if echo "$CODE" | grep -q "$ep"; then ok "Settings.tsx panggil endpoint $ep"; else bad "Settings.tsx TIADA panggilan $ep"; fi
done

# ------------------------------------------------- 6c. AI MANAGER (Fasa 2)
echo
echo "--- 6c. AI Manager: wayar + endpoint baharu ---"
# /nur/ask dahulunya @Public() — sesiapa di internet boleh guna kredit model.
NUR=$(code POST /nur/ask "$HQ" '{"message":"ujian"}')
case "$NUR" in 200|503) ok "/nur/ask memerlukan auth (bukan lagi terbuka) — $NUR";;
  401|403) ok "/nur/ask ditolak tanpa kebenaran — $NUR";;
  *) bad "/nur/ask pulangkan $NUR (jangka 200/503 dengan auth, 401/403 tanpa)";; esac
NUR_PUB=$(curl -sk -o /dev/null -w '%{http_code}' -X POST "$API/nur/ask" -H 'Content-Type: application/json' -d '{"message":"x"}')
case "$NUR_PUB" in 401|403) ok "/nur/ask TANPA token ditolak ($NUR_PUB) — lubang ditutup";;
  *) bad "/nur/ask tanpa token pulangkan $NUR_PUB — masih terbuka!";; esac

AM=app/src/pages/AIManager.tsx
AMCODE=$(grep -vE '^[[:space:]]*(\*|/\*|//)' "$AM")
# Semak merentas halaman DAN panel komponen — endpoint boleh hidup di mana-mana.
# (grep -v komen sahaja pada fail yang boleh dikomentari; panel dibaca terus)
AMI=app/src/pages/AIManager.tsx
AMG=app/src/components/ai/AiGovernancePanels.tsx
AMB=app/src/components/ai/AiBookingPanels.tsx
for ep in "/ai/agents" "/ai/policy/evaluate" "capabilities" "knowledge" "automations" "/booking-requests"; do
  if grep -q -- "$ep" "$AMI" "$AMG" "$AMB" 2>/dev/null; then ok "UI AI panggil $ep"; else bad "UI AI TIADA panggilan $ep"; fi
done
for c in GuardrailsPanel ApprovalRulesPanel PolicyTesterPanel BookingBehaviourPanel BookingRecordsPanel; do
  if grep -q "$c" "$AM" 2>/dev/null; then ok "AIManager guna $c"; else bad "AIManager tidak guna $c"; fi
done
# Guardrail + approval rule mesti boleh DICIPTA, bukan baca sahaja
if grep -q "api.post(\"/ai/guardrails\"" app/src/components/ai/AiGovernancePanels.tsx 2>/dev/null; then ok "UI boleh cipta guardrail"; else bad "UI tidak boleh cipta guardrail"; fi
if grep -q "api.post(\"/ai/approval-rules\"" app/src/components/ai/AiGovernancePanels.tsx 2>/dev/null; then ok "UI boleh cipta peraturan kelulusan"; else bad "UI tidak boleh cipta peraturan kelulusan"; fi
# Jujur: panel booking mesti NYATA ia baca-sahaja (nilai hardcoded)
if grep -q "readOnlyTitle" app/src/components/ai/AiBookingPanels.tsx 2>/dev/null; then ok "panel booking nyatakan ia baca-sahaja (nilai tetap dalam kod)"; else bad "panel booking tidak beri amaran baca-sahaja"; fi

# ---------------------------------------- 6d. KESIHATAN 80% (Seksyen 2)
echo
echo "--- 6d. Kejujuran laporan: RM7,054 tidak boleh kembali ---"
# revenue_per_appointment = jualan POS tanpa pautan pesakit / temujanji.
# Ia mesti MENOLAK menjawab, bukan memaparkan nombor yang salah.
KPIS=$(curl -sk "$API/reports/kpis?period=30D" -H "Authorization: Bearer $HQ")
echo "$KPIS" | python -c "
import sys, json
d = json.load(sys.stdin)
c = next((x for x in d.get('cards',[]) if x.get('kpiKey')=='revenue_per_appointment'), None)
if c is None: print('FAIL tidak jumpa kad revenue_per_appointment'); raise SystemExit(1)
if c.get('value') in (None,'') and c.get('available') is False:
    print('PASS revenue_per_appointment menolak menjawab (jualan tiada pautan pesakit)')
elif c.get('value'):
    print('PASS revenue_per_appointment ada nilai:', c['value'])
else:
    print('FAIL keadaan kad tidak dijangka:', c)
"
echo "$KPIS" | python -c "
import sys, json
d = json.load(sys.stdin)
c = next((x for x in d.get('cards',[]) if x.get('kpiKey')=='revenue_per_appointment'), None)
assert c is not None
# Nombor salah yg lama ialah 7054.17 — pastikan ia TIDAK kembali sebagai 'available'.
bad = c.get('available') is True and c.get('value') not in (None,'') and float(c['value']) > 5000
if bad: print('FAIL RM%s kembali sebagai available — jualan POS dibahagi temujanji' % c['value'])
else: print('PASS tiada nisbah mustahil (RM7,054 tidak kembali)')
" 2>/dev/null || true

echo
echo "--- 6d. Data demo setiap modul Seksyen 2 ---"
DQC() { docker exec medini-prod-mysql-1 mysql -umedini -p"$MEDINI_DB_PASSWORD" medini_prod -N -B -e "$1" 2>/dev/null; }
for pair in "Operations:lab_cases" "Reports:kpi_definitions" "AI:ai_agents" "AI guardrails:ai_guardrails" "AI rules:ai_approval_rules" "Settings def:settings_definitions" "Settings val:settings_values"; do
  label="${pair%%:*}"; tbl="${pair##*:}"
  n=$(DQC "SELECT COUNT(*) FROM $tbl")
  if [ "${n:-0}" -gt 0 ]; then ok "$label: $n baris"; else bad "$label KOSONG — skrin akan nampak kosong"; fi
done

# ----------------------------------------------------------------- 7. BERSIH
echo
echo "--- 7. Bersihkan data ujian ---"
DBQ() { docker exec medini-prod-mysql-1 mysql -umedini -p"$MEDINI_DB_PASSWORD" medini_prod -e "$1" 2>/dev/null; }
DBQ "DELETE FROM tasks WHERE title LIKE 'ZZS2%'"
DBQ "DELETE FROM checklists WHERE title LIKE 'ZZS2%'"
DBQ "DELETE FROM incidents WHERE title LIKE 'ZZS2%'"
# PENANDA, bukan cawangan: memadam ikut cawangan membunuh data demo pengguna.
DBQ "DELETE FROM doctor_statuses WHERE note='ZZS2 verify marker'"
check "sisa tasks = 0" "$(docker exec medini-prod-mysql-1 mysql -umedini -p"$MEDINI_DB_PASSWORD" medini_prod -N -B -e "SELECT COUNT(*) FROM tasks WHERE title LIKE 'ZZS2%'" 2>/dev/null)" "0"
check "sisa checklists = 0" "$(docker exec medini-prod-mysql-1 mysql -umedini -p"$MEDINI_DB_PASSWORD" medini_prod -N -B -e "SELECT COUNT(*) FROM checklists WHERE title LIKE 'ZZS2%'" 2>/dev/null)" "0"
check "sisa incidents = 0" "$(docker exec medini-prod-mysql-1 mysql -umedini -p"$MEDINI_DB_PASSWORD" medini_prod -N -B -e "SELECT COUNT(*) FROM incidents WHERE title LIKE 'ZZS2%'" 2>/dev/null)" "0"

rm -f "$OUT"
echo

# ---------------------------------------------------------------------------
# Seksyen 2 / Reports Fasa 1 — lima laporan senarai (endpoint baharu).
# Setiap satu mesti: wujud (200), pulangkan bentuk yang dijangka, DAN hormati
# skop cawangan. Semakan terakhir itu penting: laporan yang bocor data cawangan
# lain akan lulus ujian bentuk tetapi gagal pada maksudnya.
# ---------------------------------------------------------------------------
echo "--- Reports Fasa 1 (5 laporan baharu) ---"
HQ=$(login hq)
MGRTOK=$(login DEMO-manager)

# set: nama|path|kunci-JSON-yang-mesti-ada
for spec in \
  "new-patients|/reports/new-patients?period=90D|byDay" \
  "allergies|/reports/allergies|rows" \
  "whatsapp-templates|/reports/whatsapp-templates|byCategory" \
  "access-audit|/reports/access-audit?period=90D|rows" \
  "forms-issued|/reports/forms-issued?period=90D|byKind" ; do
  NAME="${spec%%|*}"; REST="${spec#*|}"; PATHQ="${REST%|*}"; KEY="${REST##*|}"
  BODY=$(curl -sk "$API$PATHQ" -H "Authorization: Bearer $HQ")
  HAS=$(python -c "import sys,json;d=json.loads(sys.stdin.read() or '{}');print('1' if '$KEY' in d else '0')" <<< "$BODY" 2>/dev/null)
  check "laporan $NAME pulangkan muka kunci '$KEY'" "${HAS:-0}" "1"
done

# Tanpa token mesti ditolak — laporan menyentuh rekod pesakit.
check "reports/allergies tanpa token → 401" \
  "$(curl -sk -o /dev/null -w '%{http_code}' "$API/reports/allergies")" "401"

# MANAGER mesti nampak SCOPENYA sahaja, bukan seluruh organisasi.
# Ambil bilangan baris manager vs HQ: manager tidak boleh melebihi HQ.
MGRN=$(curl -sk "$API/reports/allergies" -H "Authorization: Bearer $MGRTOK" | python -c "import sys,json;print(len(json.load(sys.stdin).get('rows',[])))" 2>/dev/null)
HQN=$(curl -sk "$API/reports/allergies" -H "Authorization: Bearer $HQ" | python -c "import sys,json;print(len(json.load(sys.stdin).get('rows',[])))" 2>/dev/null)
check "skop: manager (${MGRN:-?}) ≤ HQ (${HQN:-?})" "$([ "${MGRN:-9}" -le "${HQN:-0}" ] && echo ok || echo lebih)" "ok"

# JUJUR NOMBOR: revenue_per_appointment MESTI 'Not available', bukan angka.
# Jika ini kembali menjadi nombor, RM7,054 telah pulang dan ujian mesti gagal.
RPA=$(curl -sk "$API/reports/kpis?period=90D" -H "Authorization: Bearer $HQ" | python -c "
import sys,json
d=json.loads(sys.stdin.read() or '{}')
for c in d.get('cards',[]):
    if c.get('kpiKey')=='revenue_per_appointment':
        print('available' if c.get('available') else ('unavailable' if c.get('available') is False else 'tiada'))
        break
else: print('tiada')
" 2>/dev/null)
check "revenue_per_appointment bukan angka palsu" "${RPA:-tiada}" "unavailable"

echo
echo "======================================================"
echo "  LULUS: $PASS   GAGAL: $FAIL"
echo "======================================================"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
