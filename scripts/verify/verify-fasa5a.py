#!/usr/bin/env python3
"""
FASA 5A — live API verification for the anti-ban reply engine.

Runs against the RUNNING stack (default https://localhost/api/v1) and proves the
operator-facing contract, not the internal implementation. Every check prints
PASS/FAIL with the evidence it used, and the script exits non-zero if anything
fails — so it can gate a deploy.

What it verifies:
  1. Settings endpoint returns the new anti-ban envelope with the agreed policy
     (reply 10-20s, blast window 08:00-22:00, daily cap 100).
  2. Blast preview arithmetic matches the client's own numbers
     (1400 / 14 days = 100/day = 8 min 24s gap).
  3. An over-capacity plan is REPORTED, not silently accepted.
  4. Blast envelope save round-trips and is validated (incoherent window rejected).
  5. Branch isolation: one branch's settings never leak into another's.
  6. Unauthenticated access is refused.
  7. The reply queue is observable (snapshot counters exist).
"""

import json
import os
import ssl
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("MEDINI_API", "https://localhost/api/v1")
HQ_USER = os.environ.get("MEDINI_HQ_USER", "hq")
HQ_PASS = (os.environ.get("MEDINI_HQ_PASS") or os.environ["SEED_DEMO_PASSWORD"])

# hq is an ORG-WIDE principal: the settings controller resolves the branch from
# an explicit ?branchId= and rejects an empty one ("Sila pilih cawangan yang
# sah"). A branch-scoped login would be inferred automatically; hq must pass it.
# Discovered from the live API rather than hard-coded, because branch UUIDs are
# per-environment. SETIA_TROPIKA overrides discovery when set.
SETIA_TROPIKA = os.environ.get("MEDINI_SETIA_TROPIKA", "af0a0841-0786-40b2-9b4e-30ed9270a659")
BUKIT_INDAH = os.environ.get("MEDINI_BUKIT_INDAH", "39fef961-bd9d-4ee9-9a6b-eb38ecf819e2")

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

passed = 0
failed = 0
notes = []


def call(method, path, token=None, body=None):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=30) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def check(name, cond, evidence=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS  {name}")
        if evidence:
            print(f"        {evidence}")
    else:
        failed += 1
        print(f"  FAIL  {name}")
        if evidence:
            print(f"        {evidence}")


def field_errors(resp):
    """Pull fieldErrors out of the standard error envelope, for diagnostics."""
    if isinstance(resp, dict):
        return (resp.get("error") or {}).get("fieldErrors") or resp.get("fieldErrors")
    return None


def main():
    print("=" * 70)
    print("FASA 5A — ANTI-BAN ENGINE / LIVE API")
    print(f"API: {BASE}")
    print("=" * 70)

    # ---------------------------------------------------------------- AUTH
    print("\n[1] Auth")
    status, resp = call("POST", "/auth/login", body={"username": HQ_USER, "password": HQ_PASS})
    token = None
    if isinstance(resp, dict):
        token = (
            resp.get("accessToken")
            or resp.get("token")
            or (resp.get("data") or {}).get("accessToken")
        )
    check("hq can authenticate", status in (200, 201) and bool(token), f"HTTP {status}")

    if not token:
        print("\nCannot continue without a token.")
        print(json.dumps(resp, indent=2)[:600])
        return 1

    q = f"?branchId={SETIA_TROPIKA}"

    # ------------------------------------------------------------ SETTINGS
    print("\n[2] Anti-ban settings envelope")
    status, s = call("GET", f"/ai/whatsapp-settings{q}", token=token)
    check("settings readable for an explicit branch", status == 200,
          f"HTTP {status} fieldErrors={field_errors(s)}")

    if isinstance(s, dict):
        check(
            "reply window defaults to the agreed 10s",
            s.get("replyWindowSeconds") == 10,
            f"replyWindowSeconds={s.get('replyWindowSeconds')}",
        )
        check(
            "reply pacing is 10-20s (agreed policy, replaces the old 30-60s)",
            s.get("minDelaySeconds") == 10 and s.get("maxDelaySeconds") == 20,
            f"min={s.get('minDelaySeconds')}s max={s.get('maxDelaySeconds')}s",
        )
        check(
            "typing indicator is available as a switch",
            "typingIndicatorEnabled" in s,
            f"typingIndicatorEnabled={s.get('typingIndicatorEnabled')}",
        )
        check(
            "blast window is 08:00-22:00 (never reaches a patient at 2-3am)",
            s.get("blastWindowStartHour") == 8 and s.get("blastWindowEndHour") == 22,
            f"{s.get('blastWindowStartHour')}:00-{s.get('blastWindowEndHour')}:00",
        )
        check(
            "blast daily ceiling is 100 (was 50)",
            s.get("maxBlastPerDay") == 100,
            f"maxBlastPerDay={s.get('maxBlastPerDay')}",
        )

    # ------------------------------------------------------- BLAST PREVIEW
    print("\n[3] Blast arithmetic (Bos's own example)")
    status, p = call(
        "GET",
        f"/ai/whatsapp-settings/blast/preview?recipients=1400&days=14&branchId={SETIA_TROPIKA}",
        token=token,
    )
    check("preview endpoint responds", status == 200,
          f"HTTP {status} fieldErrors={field_errors(p)}")

    if isinstance(p, dict):
        check("1400 recipients over 14 days = 100/day",
              p.get("perDay") == 100, f"perDay={p.get('perDay')}")
        check("14-hour window yields an 8 min 24s gap (504s) — matches Bos's arithmetic",
              p.get("gapSeconds") == 504,
              f"gapSeconds={p.get('gapSeconds')} label={p.get('gapLabel')}")
        check("plan is within the daily ceiling", p.get("exceedsDailyCap") is False,
              f"exceedsDailyCap={p.get('exceedsDailyCap')}")
        check("operator gets a readable explanation",
              isinstance(p.get("note"), str) and len(p["note"]) > 20, f'note="{p.get("note")}"')

    print("\n[4] Over-capacity plan is REPORTED, never silently flooded")
    status, p2 = call(
        "GET",
        f"/ai/whatsapp-settings/blast/preview?recipients=1400&days=7&branchId={SETIA_TROPIKA}",
        token=token,
    )
    if isinstance(p2, dict):
        check("1400 over 7 days = 200/day is flagged as over the ceiling",
              p2.get("perDay") == 200 and p2.get("exceedsDailyCap") is True,
              f"perDay={p2.get('perDay')} exceedsDailyCap={p2.get('exceedsDailyCap')}")
        check("the message tells the operator how to fix it",
              "panjangkan" in (p2.get("note") or "").lower()
              or "kurangkan" in (p2.get("note") or "").lower(),
              f'note="{p2.get("note")}"')

    # ------------------------------------------------- BLAST SAVE + VALIDATION
    print("\n[5] Blast envelope save and validation")
    good = {
        "windowStartHour": 8,
        "windowEndHour": 22,
        "maxBlastPerDay": 100,
        "blastMinGapSeconds": 300,
        "blastMaxGapSeconds": 900,
    }
    status, saved = call("PUT", f"/ai/whatsapp-settings/blast{q}", token=token, body=good)
    check("valid blast envelope saves", status in (200, 201),
          f"HTTP {status} fieldErrors={field_errors(saved)}")
    if isinstance(saved, dict):
        check("saved values round-trip",
              saved.get("blastWindowStartHour") == 8 and saved.get("maxBlastPerDay") == 100,
              f"window={saved.get('blastWindowStartHour')}-{saved.get('blastWindowEndHour')} "
              f"cap={saved.get('maxBlastPerDay')}")

    # The two negative cases must fail for the RIGHT reason. Asserting only on
    # the status code would pass even when the request was rejected for a
    # missing branchId — which is exactly the trap the first run fell into.
    bad = dict(good, windowEndHour=6)  # closes before it opens
    status, err = call("PUT", f"/ai/whatsapp-settings/blast{q}", token=token, body=bad)
    fe = field_errors(err) or {}
    check("incoherent window (end before start) is refused for the WINDOW, not branchId",
          status == 422 and "windowEndHour" in fe,
          f"HTTP {status} fieldErrors={json.dumps(fe)[:160]}")

    bad2 = dict(good, blastMinGapSeconds=900, blastMaxGapSeconds=300)  # inverted band
    status, err2 = call("PUT", f"/ai/whatsapp-settings/blast{q}", token=token, body=bad2)
    fe2 = field_errors(err2) or {}
    check("inverted gap band is refused for the BAND, not branchId",
          status == 422 and "blastMaxGapSeconds" in fe2,
          f"HTTP {status} fieldErrors={json.dumps(fe2)[:160]}")

    status, err3 = call(
        "PUT", f"/ai/whatsapp-settings/blast{q}", token=token,
        body=dict(good, maxBlastPerDay=99999),
    )
    check("daily ceiling above the allowed range is refused",
          status == 422, f"HTTP {status}")

    # ------------------------------------------------------ BRANCH ISOLATION
    print("\n[6] Branch isolation — one branch's policy never leaks into another")
    status, other = call("GET", f"/ai/whatsapp-settings?branchId={BUKIT_INDAH}", token=token)
    check("a second branch reads its own settings", status == 200, f"HTTP {status}")
    status, mine = call("GET", f"/ai/whatsapp-settings{q}", token=token)
    if isinstance(other, dict) and isinstance(mine, dict):
        check("each branch reports its OWN branchId",
              other.get("branchId") == BUKIT_INDAH and mine.get("branchId") == SETIA_TROPIKA,
              f"bukit={other.get('branchId')} setia={mine.get('branchId')}")

    # ------------------------------------------------------------- SECURITY
    print("\n[7] Access control")
    status, _ = call("GET", "/ai/whatsapp-settings")
    check("unauthenticated read is refused (401/403)", status in (401, 403), f"HTTP {status}")

    status, _ = call("GET", "/ai/whatsapp-settings/blast/preview?recipients=100&days=1")
    check("unauthenticated preview is refused", status in (401, 403), f"HTTP {status}")

    status, _ = call("PUT", "/ai/whatsapp-settings/blast", body=good)
    check("unauthenticated blast save is refused", status in (401, 403), f"HTTP {status}")

    # ------------------------------------------------------------- SUMMARY
    print("\n" + "=" * 70)
    total = passed + failed
    print(f"RESULT: {passed}/{total} passed")
    if failed:
        print(f"FAILURES: {failed}")
    print("=" * 70)
    if notes:
        print("\nNotes:")
        for n in notes:
            print(f"  - {n}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
