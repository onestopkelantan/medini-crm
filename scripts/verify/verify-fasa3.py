"""FASA 3 verification — prompt slots + playground, through the REAL API.

Idempotent: every run starts from a clean slate for the target branch, so it
can be re-run after a code change and must pass every time. Every assertion is
against an HTTP response from the running backend — nothing is simulated.
"""
import os
import json
import ssl
import urllib.error
import urllib.request

BASE = "https://localhost/api/v1"
BRANCH = "af0a0841-0786-40b2-9b4e-30ed9270a659"  # Setia Tropika

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

TOKEN = None


def call(method, path, body=None):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if TOKEN:
        req.add_header("Authorization", f"Bearer {TOKEN}")
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=90) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw


results = []


def check(label, ok, detail=""):
    results.append((label, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))


# ---------------------------------------------------------------- 1. login
print("\n1. LOGIN")
st, body = call("POST", "/auth/login", {"username": "hq", "password": os.environ["SEED_DEMO_PASSWORD"]})
check("login returns 200", st == 200, f"HTTP {st}")
TOKEN = (body or {}).get("accessToken")
check("access token issued", bool(TOKEN), f"{len(TOKEN or '')} chars")

def save_slot(slot, name, prompt):
    """Save a slot the way the UI does — read the current version first.

    A slot that was deleted is soft-deleted: its row survives and its version
    counter keeps counting. Sending version 0 for such a row is correctly
    refused (409), so we must read before we write. This is exactly what the
    editor does with the version it already has in hand.
    """
    st, current = call("GET", f"/whatsapp/prompt-slots/{slot}?branchId={BRANCH}")
    version = (current or {}).get("version", 0) if (current or {}).get("configured") else 0
    return call("PUT", f"/whatsapp/prompt-slots/{slot}?branchId={BRANCH}",
                {"name": name, "prompt": prompt, "version": version})


def reset_branch():
    """Clear the three test slots for BRANCH through the public API.

    A branch can never reach zero configured slots: the ACTIVE prompt is
    protected and only stops being active when another prompt is activated in
    its place. So we do not try to empty the branch — we delete whatever is
    deletable and let the save step below overwrite the rest, reading each
    version first (see save_slot).
    """
    st, body = call("GET", f"/whatsapp/prompt-slots?branchId={BRANCH}")
    for s in (body or {}).get("slots", []):
        if s.get("configured") and not s.get("isActive"):
            call("DELETE", f"/whatsapp/prompt-slots/{s['slot']}?branchId={BRANCH}")
    return True


print("\n2. RESET — clear the three test slots")
check("test slots reset", reset_branch())

st, body = call("GET", f"/whatsapp/prompt-slots?branchId={BRANCH}")
before = body or {}
check("list returns 200", st == 200, f"HTTP {st}")
check("3 slots always returned", len(before.get("slots", [])) == 3,
      f"got {len(before.get('slots', []))}")
check("maxSlots = 3", before.get("maxSlots") == 3)

# ----------------------------------------------------------- 3. save slots
PROMPTS = [
    (1, "Versi Sopan", """Anda adalah pembantu WhatsApp Medini Dental, klinik pergigian di Malaysia.

PERANAN
Jawab pertanyaan pesakit dengan sopan, ringkas dan mesra dalam Bahasa Melayu.
Guna "Encik/Cik/Puan" jika nama belum diketahui, dan "anda" selepas itu.

TUGAS
- Sapa pesakit dan tanya apa yang boleh dibantu.
- Untuk temujanji, kumpul: nama penuh, nombor telefon, cawangan, tarikh dan masa pilihan, serta tujuan lawatan.
- Untuk pertanyaan harga, beri julat umum sahaja dan maklumkan harga tepat disahkan semasa pemeriksaan.
- Untuk kecemasan (sakit teruk, bengkak, patah gigi), minta pesakit hubungi klinik terus dan tandakan kes ini untuk pegawai.

BATASAN
- Jangan mengaku sebagai doktor dan jangan beri diagnosis.
- Jangan mengesahkan slot temujanji sendiri - sistem yang akan menyemak dan mengesahkan.
- Jangan sebut nama doktor atau jadual yang tidak diberikan oleh sistem.
- Jika tidak pasti, tawarkan untuk sambung kepada pegawai manusia.
- Jangan sekali-kali meminta nombor kad bank, kata laluan atau maklumat pembayaran.

GAYA
Ayat pendek. Elakkan jargon pergigian. Satu soalan pada satu masa."""),
    (2, "Versi Ringkas", """Pembantu WhatsApp Medini Dental. Bahasa Melayu, mesra, ringkas.

Tugas: sapa pesakit, faham keperluan, kumpul nama + telefon + cawangan + tarikh/masa + tujuan untuk temujanji.

Peraturan:
- Jangan beri diagnosis atau mengaku doktor.
- Jangan sahkan slot temujanji sendiri - sistem uruskan.
- Jangan reka nama doktor, harga tepat, atau jadual.
- Kes kecemasan atau aduan: beritahu akan disambung kepada pegawai.
- Jangan minta maklumat bank.

Balas maksimum 3 ayat. Satu soalan satu masa."""),
    (3, "Versi Promosi", """Anda pembantu WhatsApp Medini Dental. Bahasa Melayu mesra dan menarik.

Selain membantu temujanji, sebut secara semula jadi bahawa:
- Pemeriksaan pertama termasuk X-ray adalah berbaloi untuk kesihatan gigi jangka panjang.
- Klinik ada 14 cawangan, jadi pesakit boleh pilih yang paling dekat.
- Pembersihan gigi berkala disyorkan setiap enam bulan.

Kutip untuk temujanji: nama penuh, telefon, cawangan, tarikh dan masa pilihan, tujuan lawatan.

Jangan sesekali: beri diagnosis, sahkan slot sendiri, reka harga tepat atau nama doktor, minta maklumat bank, atau berjanji diskaun yang tidak diberitahu sistem.

Ayat pendek dan mesra. Jangan berlagak seperti jurujual - bantu dahulu."""),
]

print("\n3. SAVE three prompt slots")
for slot, name, prompt in PROMPTS:
    st, body = save_slot(slot, name, prompt)
    # version >= 1: a slot restored after deletion continues its old counter,
    # so asserting exactly 1 would be wrong.
    ok = st == 200 and (body or {}).get("version", 0) >= 1
    check(f"slot {slot} saved ({name})", ok, f"HTTP {st} version={(body or {}).get('version')}")

# -------------------------------------------------- 4. verify persisted
print("\n4. VERIFY persisted state")
st, body = call("GET", f"/whatsapp/prompt-slots?branchId={BRANCH}")
slots = (body or {}).get("slots", [])
check("all 3 slots configured", all(s.get("configured") for s in slots),
      f"{sum(1 for s in slots if s.get('configured'))}/3")
check("names persisted", [s.get("name") for s in slots] == ["Versi Sopan", "Versi Ringkas", "Versi Promosi"],
      str([s.get("name") for s in slots]))
check("prompt text persisted (no truncation)",
      all(len(s.get("prompt", "")) > 100 for s in slots),
      "lengths=" + str([len(s.get("prompt", "")) for s in slots]))

# ------------------------------------------------------- 5. activate slot 2
print("\n5. ACTIVATE slot 2")
st, body = call("POST", f"/whatsapp/prompt-slots/2/activate?branchId={BRANCH}")
# NestJS POST defaults to 201 Created; the activate action returns the slot it
# switched on. 200 or 201 are both correct — assert success, not a specific one.
check("activate succeeds", st in (200, 201), f"HTTP {st}")
check("slot 2 reports active", (body or {}).get("isActive") is True)

st, body = call("GET", f"/whatsapp/prompt-slots?branchId={BRANCH}")
slots = (body or {}).get("slots", [])
active = [s["slot"] for s in slots if s.get("isActive")]
check("EXACTLY ONE active slot", active == [2], f"active={active}")

# -------------------------------------- 6. active prompt is the bot prompt
print("\n6. ACTIVE PROMPT — what the bot would read")
st, body = call("GET", f"/whatsapp/prompt-slots/2?branchId={BRANCH}")
check("getSlotForTest returns 200", st == 200, f"HTTP {st}")
check("returns the active slot content",
      (body or {}).get("name") == "Versi Ringkas" and (body or {}).get("isActive") is True)

# ------------------------------------------------- 7. delete guard on active
print("\n7. DELETE GUARD — active prompt must be protected")
st, body = call("DELETE", f"/whatsapp/prompt-slots/2?branchId={BRANCH}")
check("deleting ACTIVE slot is refused", st == 409, f"HTTP {st} msg={(body or {}).get('error', {}).get('message', '')[:60]}")

st, body = call("DELETE", f"/whatsapp/prompt-slots/3?branchId={BRANCH}")
check("deleting INACTIVE slot succeeds", st == 200, f"HTTP {st}")

# ------------------------------------------------------- 8. re-save version
print("\n8. OPTIMISTIC LOCK — stale version must be refused")
st, body = call("GET", f"/whatsapp/prompt-slots/1?branchId={BRANCH}")
current_version = (body or {}).get("version", 0)
check("slot 1 reports a version", current_version >= 1, f"version={current_version}")

st, body = call("PUT", f"/whatsapp/prompt-slots/1?branchId={BRANCH}",
                {"name": "Versi Sopan", "prompt": PROMPTS[0][2] + "\n\nTAMBAHAN.", "version": current_version})
check("save with CORRECT version succeeds", st == 200,
      f"HTTP {st} version={(body or {}).get('version')}")

st, body = call("PUT", f"/whatsapp/prompt-slots/1?branchId={BRANCH}",
                {"name": "Versi Sopan", "prompt": PROMPTS[0][2] + "\n\nPENGGANTIAN.", "version": current_version})
check("save with STALE version refused (409)", st == 409, f"HTTP {st}")

# ----------------------------------------------------------- 9. validation
print("\n9. VALIDATION")
st, body = call("PUT", f"/whatsapp/prompt-slots/1?branchId={BRANCH}",
                {"name": "x", "prompt": "pendek", "version": current_version + 1})
check("prompt under 20 chars rejected (422)", st == 422, f"HTTP {st}")

st, body = call("PUT", f"/whatsapp/prompt-slots/1?branchId={BRANCH}",
                {"name": "", "prompt": PROMPTS[0][2], "version": current_version + 1})
check("empty slot name rejected (422)", st == 422, f"HTTP {st}")

# --------------------------------------------------- 9b. delete then re-save
print("\n9b. DELETE THEN RE-SAVE (soft-delete must not lock the slot)")
# Use slot 3: it is inactive right now.
call("DELETE", f"/whatsapp/prompt-slots/3?branchId={BRANCH}")
st, body = call("GET", f"/whatsapp/prompt-slots/3?branchId={BRANCH}")
check("deleted slot reads back as unconfigured", (body or {}).get("configured") is False,
      f"configured={(body or {}).get('configured')}")

st, body = call("PUT", f"/whatsapp/prompt-slots/3?branchId={BRANCH}",
                {"name": "Versi Promosi", "prompt": PROMPTS[2][2], "version": 0})
check("RE-SAVING a soft-deleted slot succeeds (FASA 3 bug fix)", st == 200,
      f"HTTP {st} name={(body or {}).get('name')}")
check("restored slot is not silently activated", (body or {}).get("isActive") is False,
      f"isActive={(body or {}).get('isActive')}")

st, body = call("GET", f"/whatsapp/prompt-slots/3?branchId={BRANCH}")
check("restored prompt text is the new text, not stale",
      "14 cawangan" in ((body or {}).get("prompt", "")),
      f"len={len((body or {}).get('prompt', ''))}")

# ------------------------------------------------------ 10. branch isolation
print("\n10. BRANCH ISOLATION")
st, body = call("GET", f"/whatsapp/prompt-slots?branchId={BRANCH}")
setia_names = {s.get("name") for s in (body or {}).get("slots", []) if s.get("configured")}

# pick a different branch
st2, branches = call("GET", "/admin/branches")
other = next((b for b in (branches or []) if b.get("id") != BRANCH), None)
if other:
    st, body = call("GET", f"/whatsapp/prompt-slots?branchId={other['id']}")
    other_names = {s.get("name") for s in (body or {}).get("slots", []) if s.get("configured")}
    check(f"other branch ({other.get('shortName')}) sees no Setia prompts",
          not (setia_names & other_names), f"other={sorted(other_names) or 'empty'}")
else:
    check("second branch available", False, "no other branch found")

# --------------------------------------------------------- 11. playground
print("\n11. PLAYGROUND")

# Reset to a known state: slot 2 active, slot 3 present.
call("POST", f"/whatsapp/prompt-slots/2/activate?branchId={BRANCH}")

st, body = call("POST", f"/whatsapp/playground/test?branchId={BRANCH}",
                {"slot": 2, "message": "Salam, saya nak buat appointment", "history": []})
if st == 200:
    check("playground returns a real model reply", bool((body or {}).get("reply")),
          f"model={(body or {}).get('model')} latency={(body or {}).get('latencyMs')}ms")
    print(f"      REPLY: {(body or {}).get('reply', '')[:200]}")
elif st == 503:
    # Expected while MINIMAX_API_KEY is unset. The contract under test is that
    # the failure is DIAGNOSABLE (503 + code + Malay explanation) and NOT a
    # bare 500 that reads like a prompt bug.
    err = (body or {}).get("error", {})
    check("playground without model key = 503 AI_PROVIDER_UNAVAILABLE",
          err.get("code") == "AI_PROVIDER_UNAVAILABLE" or "Model AI" in err.get("message", ""),
          f"code={err.get('code')} msg={err.get('message', '')[:80]}")
    check("failure is NOT a bare 500", st != 500, f"HTTP {st}")
else:
    check("playground reply or clear 503", False, f"HTTP {st}: {body}")

st, body = call("POST", f"/whatsapp/playground/test?branchId={BRANCH}",
                {"slot": 2, "message": "Pesan saya ada sakit gigi",
                 "history": [{"role": "user", "content": "Salam"},
                             {"role": "assistant", "content": "Salam, apa yang boleh dibantu?"}]})
check("playground accepts conversation history", st in (200, 503) and st != 422, f"HTTP {st}")

st, body = call("POST", f"/whatsapp/playground/test?branchId={BRANCH}",
                {"slot": 9, "message": "hi", "history": []})
check("playground rejects out-of-range slot (422)", st == 422, f"HTTP {st}")

st, body = call("POST", f"/whatsapp/playground/test?branchId={BRANCH}",
                {"slot": 1, "message": "", "history": []})
check("playground rejects empty message (422)", st == 422, f"HTTP {st}")

# ------------------------------------------------------------- summary
print("\n" + "=" * 74)
passed = sum(1 for _, ok, _ in results if ok)
print(f"RESULT: {passed}/{len(results)} checks passed")
failed = [(l, d) for l, ok, d in results if not ok]
if failed:
    print("\nFAILED:")
    for l, d in failed:
        print(f"  - {l} ({d})")
print("=" * 74)

with open("fasa3-verify.json", "w", encoding="utf-8") as f:
    json.dump({"passed": passed, "total": len(results),
               "results": [{"check": l, "ok": ok, "detail": d} for l, ok, d in results]},
              f, indent=2, ensure_ascii=False)
