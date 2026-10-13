"""Senarai SEMUA route yang backend benar-benar daftarkan, kemudian uji setiap satu.

Sumber kebenaran: log Nest sendiri ("Mapped {path, METHOD} route").
Jalankan: python audit-semua-route.py
"""
import os
import json
import re
import ssl
import subprocess
import urllib.error
import urllib.request

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

BASE = "https://localhost"
API = BASE + "/api/v1"

# --- 1. Ambil senarai route dari log Nest -------------------------------
logs = subprocess.run(
    ["docker", "logs", "medini-prod-backend-1"],
    capture_output=True, text=True, encoding="utf-8", errors="replace",
).stdout

routes = []
seen = set()
# The log line ends with `(version: Neutral) route` or `(version: 1) route`, so the
# capture must not require the closing brace to be followed immediately by "route".
for m in re.finditer(r'"msg":"Mapped \{([^,]+), (GET|POST|PATCH|PUT|DELETE)\}', logs):
    path, method = m.group(1).strip(), m.group(2)
    key = (method, path)
    if key in seen:
        continue
    seen.add(key)
    routes.append(key)

routes.sort()


def url_for(path: str) -> str:
    """Resolve a logged route to a URL.

    Controllers declare their own version: most use `version: '1'` (served at
    /api/v1/...), but some use `version: ''` or `Neutral` and are served at
    /api/... with no version segment. The log records the controller-relative
    path either way, so the version segment cannot be assumed — it has to be
    tried. Assuming /v1 made working endpoints look like 404s.
    """
    if path.startswith("/api/v1"):
        return BASE + path
    if path.startswith("/api/"):
        return BASE + "/api/v1" + path[len("/api"):]
    return BASE + path


def login():
    req = urllib.request.Request(
        API + "/auth/login",
        data=json.dumps({"username": "hq", "password": os.environ["SEED_DEMO_PASSWORD"]}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, context=ctx, timeout=20) as r:
        return json.loads(r.read().decode())["accessToken"]


TOK = login()


def call(method, path, body=None):
    """Try the versioned URL first, then the unversioned one.

    Both forms exist in this app, and which one a controller uses is not knowable
    from the logged path alone. A 404 on the first is not evidence of a broken
    endpoint, so the second is tried before recording a failure.
    """
    candidates = []
    if path.startswith("/api/"):
        candidates.append(BASE + "/api/v1" + path[len("/api"):])
        candidates.append(BASE + path)
    else:
        candidates.append(BASE + path)

    last = 0
    for url in candidates:
        headers = {"Authorization": "Bearer " + TOK, "Content-Type": "application/json"}
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=15) as r:
                return r.status
        except urllib.error.HTTPError as e:
            last = e.code
            if e.code != 404:
                return e.code
        except Exception:  # noqa: BLE001
            last = 0
    return last


# Only GET routes can be safely probed without creating data.
gets = [p for m, p in routes if m == "GET"]
print(f"Jumlah route didaftarkan: {len(routes)}  (GET: {len(gets)})")
print()

results = {"ok": [], "guard": [], "missing": [], "broken": []}
for path in gets:
    code = call("GET", path)
    if code == 200:
        results["ok"].append(path)
    elif code in (401, 403):
        results["guard"].append((path, code))   # wujud, tetapi ada kawalan akses
    elif code == 404:
        results["missing"].append(path)
    elif code in (400, 422):
        results["guard"].append((path, code))   # wujud, perlu parameter
    else:
        results["broken"].append((path, code))

print("=" * 78)
print(f"  BERFUNGSI (200)        : {len(results['ok'])}")
print(f"  ADA + BERKAWAL (401/403/422): {len(results['guard'])}")
print(f"  TIDAK DIJUMPAI (404)   : {len(results['missing'])}")
print(f"  ROSAK (5xx/lain)       : {len(results['broken'])}")
print("=" * 78)

if results["ok"]:
    print("\n✅ BERFUNGSI:")
    for p in sorted(results["ok"]):
        print("   ", p)

if results["guard"]:
    print("\n🔒 ADA TETAPI BERKAWAL (perlu peranan/parameter berbeza):")
    for p, c in sorted(results["guard"]):
        print(f"    {c}  {p}")

if results["missing"]:
    print("\n❓ 404 (route didaftar tetapi tiada padanan — siasat):")
    for p in sorted(results["missing"]):
        print("   ", p)

if results["broken"]:
    print("\n🔴 ROSAK:")
    for p, c in sorted(results["broken"]):
        print(f"    {c}  {p}")
