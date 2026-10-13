#!/usr/bin/env python
"""Fasa 0.5 — probe semua route Seksyen 1. Cari 5xx. 400/403/422 = proof of life."""
import json, subprocess, sys, urllib.request, ssl, os

BASE = "https://localhost/api/v1"
ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE

def req(method, path, token=None, body=None, cap=4000):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    if token: r.add_header("Authorization", "Bearer "+token)
    r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, context=ctx, timeout=15) as resp:
            return resp.status, resp.read(cap).decode("utf-8","replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(cap).decode("utf-8","replace")
    except Exception as e:
        return -1, str(e)[:120]

# login
st, txt = req("POST", "/auth/login", body={"username":"DEMO-hq","password":os.environ["SEED_DEMO_PASSWORD"]})
tok = json.loads(txt).get("accessToken") if st==200 else None
print(f"login={st} token={'ok' if tok else 'GAGAL'}")
if not tok: sys.exit(1)

# real uuid dari data
st, txt = req("GET", "/patients?limit=1", tok, cap=200000)
pid = json.loads(txt)[0]["id"] if st==200 and txt.startswith("[") and json.loads(txt) else None
st, txt = req("GET", "/admin/branches", tok, cap=200000)
bid = None
if st==200:
    d = json.loads(txt)
    if isinstance(d, list) and d: bid = d[0].get("id")
    elif isinstance(d, dict) and d.get("data"): bid = d["data"][0].get("id")
print(f"patientId={pid}  branchId={bid}")

routes = json.load(open(os.path.join(os.path.dirname(__file__), ".probe-s1.json")))
real = {"{id}": pid, "{patientId}": pid, "{}": bid}
def fill(p):
    for k,v in real.items():
        if k in p and v: p = p.replace(k, v)
    return p

out = []
for mod, verb, path in routes:
    # ganti dynamic segmen dgn uuid sebenar; kalau tiada uuid, skip jadi 400 (masih bukti hidup)
    p = fill(path.replace("/api/v1",""))
    st, body = req(verb, p, tok, body={} if verb in ("POST","PATCH","PUT") else None)
    out.append((mod, verb, path, st, body[:90].replace("\n"," ")))

from collections import Counter
c = Counter(x[3] for x in out)
print("\n=== AGIHAN STATUS ===")
for k,v in sorted(c.items()): print(f"  {k}: {v}")
print(f"\n  5xx = {sum(v for k,v in c.items() if k>=500)}  <-- WAJIB 0")
json.dump(out, open(os.path.join(os.path.dirname(__file__), ".probe-s1-result.json"),"w"), indent=1)

print("\n=== 4xx / 5xx (perlu dilihat) ===")
for mod,verb,path,st,body in out:
    if st >= 400: print(f"  {st} {verb:<7}{path}\n      {body[:80]}")
