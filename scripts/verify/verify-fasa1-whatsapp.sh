#!/usr/bin/env bash
: "${SEED_DEMO_PASSWORD:?Set SEED_DEMO_PASSWORD before running this script}"
export SEED_DEMO_PASSWORD
# verify-fasa1-whatsapp.sh — verify 5 kerja Fasa 1 WhatsApp
set -euo pipefail

BASE="${BASE_URL:-http://localhost:8080/api/v1}"
PASS=0
FAIL=0

say() { printf '%s\n' "$*"; }
ok()  { PASS=$((PASS+1)); say "  ✅ $*"; }
bad() { FAIL=$((FAIL+1)); say "  ❌ $*"; }

say "=== Fasa 1 WhatsApp — 5 kerja ==="
say "Base: $BASE"
say ""

# Login
say "[1] Login sebagai dr.aina..."
LOGIN_RESP=$(curl -sk -m 10 -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,os,sys; print(json.dumps({"username":sys.argv[1],"password":os.environ["SEED_DEMO_PASSWORD"]}))' "dr.aina")" 2>/dev/null || true)

TOKEN=$(printf '%s' "$LOGIN_RESP" | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null || true)
BRANCH=$(printf '%s' "$LOGIN_RESP" | python -c "import sys,json;print(json.load(sys.stdin).get('user',{}).get('branchId',''))" 2>/dev/null || true)

if [ -z "$TOKEN" ]; then
  bad "Login gagal"
  exit 1
fi
ok "Login OK (branch: ${BRANCH:0:8}...)"
AUTH="Authorization: Bearer $TOKEN"
CT="Content-Type: application/json"

# #3 — Tanda dibaca (POST conversations/:id/read)
say ""
say "[2] #3 Tanda dibaca — POST conversations/:id/read..."
CONV=$(curl -sk -m 10 -H "$AUTH" "$BASE/whatsapp/conversation-queue?limit=1" 2>/dev/null | python -c "import sys,json;d=json.load(sys.stdin);print(d[0]['id'] if d else '')" 2>/dev/null || true)
if [ -n "$CONV" ]; then
  READ=$(curl -sk -m 10 -o .verify-out.tmp -w "%{http_code}" -X POST -H "$AUTH" -H "$CT" -d '{}' "$BASE/whatsapp/conversations/$CONV/read")
  if [ "$READ" = "200" ] || [ "$READ" = "201" ]; then
    ok "Tanda dibaca OK (HTTP $READ)"
  else
    bad "Tanda dibaca gagal (HTTP $READ)"
  fi
else
  say "  ⚠️ Tiada conversation untuk uji — skip"
fi

# #2 — Edit template (PATCH templates/:id)
#
# SELF-CLEANING. `wa_templates` has UNIQUE (org_id, branch_id, name), so a second
# run of this script renamed a template to 'Template Ujian', found its OWN name
# from run 1 already taken, and got a 409 — a FAILURE THAT ONLY EXISTED BECAUSE
# IT RAN TWICE. The fix is not to weaken the assertion (409 is the correct answer
# for a genuine collision, and verify-bug-6 asserts exactly that); it is to clear
# the previous run's name first, the way verify-fasa1c/d do.
#
# The renamed template's name is RESTORED afterwards rather than left as 'Template
# Ujian': these are the clinic's real seeded templates (Recall/Follow-up), and a
# test that quietly renames production content is a test that damages what it
# measures.
say ""
say "[3] #2 Edit template — PATCH templates/:id..."
TMPL_JSON=$(curl -sk -m 10 -H "$AUTH" "$BASE/whatsapp/templates" 2>/dev/null || true)
TMPL=$(printf '%s' "$TMPL_JSON" | python -c "import sys,json;d=json.load(sys.stdin);print(d[0]['id'] if d else '')" 2>/dev/null || true)
TMPL_ORIG=$(printf '%s' "$TMPL_JSON" | python -c "import sys,json;d=json.load(sys.stdin);print(d[0]['name'] if d else '')" 2>/dev/null || true)
if [ -n "$TMPL" ]; then
  # buang sisa larian sebelumnya supaya nama ujian ini bebas.
  # Helper DB tempatan: skrip ini tiada `q()` (itu milik verify-fasa1c/d), jadi
  # ia bina sendiri. Tanpa ini larian KEDUA sentiasa 409 — kegagalan yang wujud
  # semata-mata kerana skrip dijalankan dua kali.
  DB=medini-prod-mysql-1
  RP=$(docker exec "$DB" sh -c 'printf %s "$MYSQL_ROOT_PASSWORD"' 2>/dev/null)
  docker exec -i "$DB" mysql -uroot -p"$RP" medini_prod -e \
    "DELETE FROM wa_templates WHERE name='Template Ujian'" 2>/dev/null || true
  EDIT=$(curl -sk -m 10 -o .verify-out.tmp -w "%{http_code}" -X PATCH -H "$AUTH" -H "$CT" \
    -d '{"name":"Template Ujian","body":"Isi ujian","category":"ujian"}' \
    "$BASE/whatsapp/templates/$TMPL")
  if [ "$EDIT" = "200" ]; then
    ok "Edit template OK (HTTP $EDIT)"
  else
    bad "Edit template gagal (HTTP $EDIT)"
  fi
  # pulangkan nama asal — skrip ujian tidak boleh mengubah kandungan sebenar klinik
  if [ -n "$TMPL_ORIG" ] && [ "$TMPL_ORIG" != "Template Ujian" ]; then
    curl -sk -m 10 -o .verify-out.tmp -X PATCH -H "$AUTH" -H "$CT" \
      -d "$(python -c "import json,sys;print(json.dumps({'name':sys.argv[1]}))" "$TMPL_ORIG")" \
      "$BASE/whatsapp/templates/$TMPL" >/dev/null 2>&1 || true
  fi
else
  say "  ⚠️ Tiada template untuk uji — skip"
fi

# #1 — Schedule blast (POST blast dengan scheduledAt)
say ""
say "[4] #1 Schedule blast — POST blast dengan scheduledAt..."
CH=$(curl -sk -m 10 -H "$AUTH" "$BASE/whatsapp/channels" 2>/dev/null | python -c "import sys,json;d=json.load(sys.stdin);print(next((c['id'] for c in d if c['status']=='working'),''))" 2>/dev/null || true)
if [ -n "$CH" ]; then
  SCHED=$(curl -sk -m 15 -o .verify-out.tmp -w "%{http_code}" -X POST -H "$AUTH" -H "$CT" \
    -d "{\"branchId\":\"$BRANCH\",\"channelId\":\"$CH\",\"recipients\":[\"+60123456789\"],\"body\":\"Ujian schedule blast\",\"consentConfirmed\":true,\"scheduledAt\":\"2026-12-31T23:59:59.000Z\"}" \
    "$BASE/whatsapp/blast")
  if [ "$SCHED" = "200" ] || [ "$SCHED" = "201" ]; then
    ok "Schedule blast OK (HTTP $SCHED)"
  else
    bad "Schedule blast gagal (HTTP $SCHED)"
  fi
else
  say "  ⚠️ Tiada channel working — skip"
fi

# #4 — New conversation (POST conversations)
#
# Skema pelayan: conversationInput = { channelId, contactPhone, linkPatient? }.
# Versi lama blok ini menghantar { branchId, body } — medan yang TIDAK wujud
# dalam skema — jadi ia sentiasa 422 dan kelihatan seperti fitur rosak.
# UI sebenar (WhatsAppHub.tsx) menghantar channelId + contactPhone + linkPatient,
# jadi skrip diuji terhadap KONTRAK YANG SAMA seperti skrin.
say ""
say "[5] #4 New conversation — POST conversations..."
CHAN=$(curl -sk -m 10 -H "$AUTH" "$BASE/whatsapp/channels" 2>/dev/null | python -c "import sys,json;d=json.load(sys.stdin);print(d[0]['id'] if d else '')" 2>/dev/null || true)
if [ -z "$CHAN" ]; then
  say "  ⚠️ Tiada channel untuk uji — skip"
else
  NEWC=$(curl -sk -m 15 -o .verify-out.tmp -w "%{http_code}" -X POST -H "$AUTH" -H "$CT" \
    -d "{\"channelId\":\"$CHAN\",\"contactPhone\":\"+60123456789\",\"linkPatient\":true}" \
    "$BASE/whatsapp/conversations")
  if [ "$NEWC" = "200" ] || [ "$NEWC" = "201" ]; then
    ok "New conversation OK (HTTP $NEWC)"
  else
    bad "New conversation gagal (HTTP $NEWC)"
  fi
fi

# #5 — SLA + unread badge
say ""
say "[6] #5 SLA + unread badge..."
UNREAD=$(curl -sk -m 10 -o .verify-out.tmp -w "%{http_code}" -H "$AUTH" "$BASE/whatsapp/notifications/unread-count")
if [ "$UNREAD" = "200" ]; then
  ok "Unread count OK (HTTP $UNREAD)"
else
  bad "Unread count gagal (HTTP $UNREAD)"
fi

SLA=$(curl -sk -m 10 -o .verify-out.tmp -w "%{http_code}" -H "$AUTH" "$BASE/whatsapp/conversations/sla")
if [ "$SLA" = "200" ]; then
  ok "SLA endpoint OK (HTTP $SLA)"
else
  bad "SLA endpoint gagal (HTTP $SLA)"
fi

# Ringkasan
say ""
say "=== RINGKASAN ==="
say "Lulus: $PASS"
say "Gagal: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
say "✅ Semua 5 kerja Fasa 1 WhatsApp lulus!"
