/**
 * PHASE 3.1 — Branch context smoke test (HQ switch + non-HQ lock)
 */
import { spawn } from "child_process";

const APP = "http://localhost:3000";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--remote-debugging-port=9223",
  "--window-size=1440,900", "--no-first-run", "--user-data-dir=C:/Users/User/.chrome-smoke2",
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch("http://localhost:9223/json/list");
      const tabs = await r.json();
      const page = tabs.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* retry */ }
    await sleep(500);
  }
  throw new Error("Chrome CDP not reachable");
}

let msgId = 0;
const pending = new Map();
let ws;

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, 15000);
  });
}

async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("JS exception: " + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 400));
  return r.result?.value;
}

async function nav(url) { await send("Page.navigate", { url }); await sleep(2500); }

async function login(username) {
  await evaluate(`(() => {
    const u = document.querySelector('input[autocomplete="username"], input[name="username"], input[type="text"]');
    const p = document.querySelector('input[type="password"]');
    const setV = (el, v) => { const proto = Object.getPrototypeOf(el); const desc = Object.getOwnPropertyDescriptor(proto, 'value'); desc.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    setV(u, ${JSON.stringify(username)}); setV(p, "medini123");
    return true;
  })()`);
  await sleep(300);
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => /sign in|log in|masuk/i.test(x.textContent)); if (b) b.click(); return !!b; })()`);
  await sleep(3000);
}

const results = [];
function rec(check, pass, note = "") {
  results.push([check, pass, note]);
  console.log(`${pass ? "PASS" : "FAIL"} | ${check}${note ? " | " + note : ""}`);
}

async function main() {
  const wsUrl = await getWsUrl();
  ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const fn = pending.get(m.id); fn(m.result ?? m); pending.delete(m.id); }
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await nav(`${APP}/login`);

  // --- HQ branch switch ---
  await evaluate(`localStorage.clear(); true`);
  await login("hq");
  const selText = await evaluate(`document.querySelector('button[role="combobox"]')?.innerText ?? "NO-SELECT"`);
  rec("HQ branch selector present (All Branches)", /All Branches/i.test(selText), selText.trim());

  // count options in dropdown by opening it
  await evaluate(`document.querySelector('button[role="combobox"]')?.click(); true`);
  await sleep(600);
  const optCount = await evaluate(`document.querySelectorAll('[role="option"]').length`);
  const optAll = await evaluate(`[...document.querySelectorAll('[role="option"]')].map(o => o.textContent).join('|')`);
  rec("HQ dropdown shows All Branches (14) + 14 branches = 15 options", optCount === 15, `count=${optCount}`);
  rec("HQ dropdown label contains 'All Branches (14)'", optAll.includes("All Branches (14)"));
  await evaluate(`document.body.click(); true`);
  await sleep(400);

  // pick a specific branch (Mount Austin = branch id 6 in seed)
  await evaluate(`document.querySelector('button[role="combobox"]')?.click(); true`);
  await sleep(500);
  await evaluate(`(() => { const o = [...document.querySelectorAll('[role="option"]')].find(x => /Mount Austin/.test(x.textContent)); if (o) o.click(); return !!o; })()`);
  await sleep(2500);
  const afterSwitch = await evaluate(`document.querySelector('button[role="combobox"]')?.innerText ?? "?"`);
  rec("HQ switched to Mount Austin", /Mount Austin/i.test(afterSwitch), afterSwitch.trim());

  // E. stale state: logout HQ → login manager (branch 6) — selector must NOT exist, branch = manager's own
  await evaluate(`localStorage.clear(); true`);
  await nav(`${APP}/login`);
  await login("manager");
  const mgrSel = await evaluate(`document.querySelector('button[role="combobox"]')?.innerText ?? "NO-SELECT"`);
  rec("Manager: no branch selector (locked)", mgrSel === "NO-SELECT", mgrSel.trim());
  const mgrBranch = await evaluate(`document.body.innerText.match(/Medini Dental [A-Za-z ]+/)?.[0] ?? "?"`);
  rec("Manager: own branch displayed", /Mount Austin/.test(mgrBranch), mgrBranch);

  console.log("\n=========== BRANCH SUMMARY ===========");
  const fails = results.filter((r) => !r[1]);
  console.log(`TOTAL ${results.length} | PASS ${results.length - fails.length} | FAIL ${fails.length}`);
  for (const f of fails) console.log(`FAIL: ${f[0]} — ${f[2]}`);
}

main().catch((e) => { console.error("SMOKE ERROR:", e.message); process.exitCode = 1; })
  .finally(() => { chrome.kill(); process.exit(); });
