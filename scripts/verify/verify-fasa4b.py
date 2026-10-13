"""FASA 4 KUMPULAN B — verify conversation controls against the LIVE API.

Exercises assign / unassign / handoff / return-to-ai / reopen / archive, the
new assignable-staff endpoint, and the state rules that matter (one active
handler at a time, archived is terminal).
"""
import os
import json
import ssl
import urllib.error
import urllib.request

BASE = "https://localhost/api/v1"
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

TOKEN = None
results = []


def call(method, path, body=None):
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
    )
    req.add_header("Content-Type", "application/json")
    if TOKEN:
        req.add_header("Authorization", f"Bearer {TOKEN}")
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=60) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw


def check(label, ok, detail=""):
    results.append((label, bool(ok), detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))


print("\n1. LOGIN")
st, body = call("POST", "/auth/login", {"username": "hq", "password": os.environ["SEED_DEMO_PASSWORD"]})
check("login 200", st == 200, f"HTTP {st}")
TOKEN = (body or {}).get("accessToken")
check("token issued", bool(TOKEN))

print("\n2. ASSIGNABLE STAFF (endpoint baru — dulu branch user tiada akses)")
st, staff = call("GET", "/whatsapp/assignable-staff")
check("endpoint wujud + 200", st == 200, f"HTTP {st}")
names = [s for s in (staff or []) if isinstance(s, dict)]
check("memulangkan senarai staff", len(names) > 0, f"{len(names)} staff")
roles = {s.get("role") for s in names}
check("hanya peranan yang sah (tiada doctor)", "doctor" not in roles, str(sorted(roles)))
check("setiap staff ada id + name",
      all(s.get("id") and s.get("name") for s in names))

# pick a target staff that is not the current user
me = None
st, prof = call("GET", "/auth/me")
if st == 200:
    me = (prof or {}).get("staffId") or (prof or {}).get("id")
target = next((s for s in names if s.get("id") != me), None)
check("ada staff untuk diagihkan", target is not None, (target or {}).get("name", "-"))

print("\n3. SETUP — cipta perbualan ujian")
st, chans = call("GET", "/whatsapp/channels")
chan = (chans or [{}])[0]
chId = chan.get("id")
st, conv = call("POST", "/whatsapp/conversations",
                {"channelId": chId, "contactPhone": "+60112223333", "linkPatient": False})
check("perbualan dicipta", st in (200, 201), f"HTTP {st}")
cid = ((conv or {}).get("conversation") or {}).get("id") or (conv or {}).get("id")
check("ada id perbualan", bool(cid), str(cid))

print("\n4. ASSIGN")
st, body = call("POST", f"/whatsapp/conversations/{cid}/assign", {"staffId": target["id"]})
check("assign berjaya", st in (200, 201), f"HTTP {st}")
assigned = (body or {}).get("assignedTo")
check("assignedTo = staff dipilih", assigned == target["id"], f"got {assigned}")
status_after_assign = (body or {}).get("status")
check("status 'new' -> 'open'", status_after_assign == "open", f"status={status_after_assign}")

print("\n5. UNASSIGN")
st, body = call("POST", f"/whatsapp/conversations/{cid}/unassign")
check("unassign berjaya", st in (200, 201), f"HTTP {st}")
check("assignedTo kosong semula", (body or {}).get("assignedTo") in (None, ""),
      f"got {(body or {}).get('assignedTo')}")

print("\n6. HANDOFF (AI -> manusia)")
st, body = call("POST", f"/whatsapp/conversations/{cid}/handoff")
check("handoff berjaya", st in (200, 201), f"HTTP {st}")
check("status escalated (manusia mengendalikan)", (body or {}).get("status") == "escalated",
      f"status={(body or {}).get('status')}")
check("diagihkan kepada pemanggil", bool((body or {}).get("assignedTo")))
# NOTA: aiQueueState kekal kosong pada perbualan yang belum pernah masuk
# baris gilir AI — itu betul. Handoff menukar 'handoff' hanya bila ada aktiviti
# AI dahulu (aiState !== null). Membuka 'Ambil alih' menjamin hanya satu
# pengendali aktif; ia tidak mencipta keadaan AI yang tidak wujud.

print("\n7. RETURN TO AI (manusia -> AI)")
st, body = call("POST", f"/whatsapp/conversations/{cid}/return-to-ai")
check("return-to-ai berjaya", st in (200, 201), f"HTTP {st}")
check("aiQueueState kosong", (body or {}).get("aiQueueState") in (None, ""),
      f"got {(body or {}).get('aiQueueState')}")
check("status kembali 'open'", (body or {}).get("status") == "open",
      f"status={(body or {}).get('status')}")
check("assignedTo dikosongkan (AI kendalikan)", (body or {}).get("assignedTo") in (None, ""),
      f"got {(body or {}).get('assignedTo')}")

print("\n8. RESOLVE + REOPEN")
st, body = call("POST", f"/whatsapp/conversations/{cid}/resolve")
check("resolve berjaya", st in (200, 201), f"HTTP {st}")
check("status = resolved", (body or {}).get("status") == "resolved",
      f"status={(body or {}).get('status')}")
st, body = call("POST", f"/whatsapp/conversations/{cid}/reopen")
check("reopen berjaya", st in (200, 201), f"HTTP {st}")
check("status = open selepas reopen", (body or {}).get("status") == "open",
      f"status={(body or {}).get('status')}")

print("\n9. ARCHIVE (terminal — hanya sah selepas resolve)")
# Resolve dulu: peraturan domain ialah resolved -> archived. Arkib pada
# perbualan terbuka ditolak (409) — betul, bukan bug.
call("POST", f"/whatsapp/conversations/{cid}/resolve")
st, body = call("POST", f"/whatsapp/conversations/{cid}/archive")
check("archive berjaya selepas resolve", st in (200, 201), f"HTTP {st}")
check("status = archived", (body or {}).get("status") == "archived",
      f"status={(body or {}).get('status')}")

st, body = call("POST", f"/whatsapp/conversations/{cid}/reopen")
check("reopen pada perbualan diarkib DITOLAK (409)", st == 409,
      f"HTTP {st} {(body or {}).get('error', {}).get('message', '')[:40]}")

print("\n10. ARCHIVED = TERMINAL (tindakan mesti ditolak)")
for path, label in [("assign", "assign"), ("handoff", "handoff"), ("reopen", "reopen")]:
    payload = {"staffId": target["id"]} if path == "assign" else None
    st, body = call("POST", f"/whatsapp/conversations/{cid}/{path}", payload)
    check(f"{label} pada perbualan diarkib DITOLAK", st == 409,
          f"HTTP {st} {(body or {}).get('error', {}).get('message', '')[:50]}")

print("\n11. SENARAI TIDAK LAGI tunjuk perbualan diarkib")
st, rows = call("GET", "/whatsapp/conversation-queue?filter=all&limit=50")
ids = [r.get("id") for r in (rows or []) if isinstance(r, dict)]
check("perbualan diarkib tiada dalam queue", cid not in ids)

print("\n" + "=" * 74)
passed = sum(1 for _, ok, _ in results if ok)
print(f"RESULT: {passed}/{len(results)} checks passed")
failed = [(l, d) for l, ok, d in results if not ok]
if failed:
    print("\nFAILED:")
    for l, d in failed:
        print(f"  - {l} ({d})")
print("=" * 74)

with open("fasa4b-verify.json", "w", encoding="utf-8") as f:
    json.dump({"passed": passed, "total": len(results),
               "results": [{"check": l, "ok": ok, "detail": d} for l, ok, d in results]},
              f, indent=2, ensure_ascii=False)
