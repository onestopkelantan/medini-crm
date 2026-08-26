/**
 * PHASE 3.1 — UI SMOKE TEST (4 roles)
 * Drive the real built app in a headless browser via Chrome DevTools Protocol.
 * No new npm deps — raw WebSocket over CDP.
 */
import { spawn } from "child_process";
import { writeFileSync, mkdirSync } from "fs";

const APP = "http://localhost:3000";
const SHOTS = "smoke-shots";
mkdirSync(SHOTS, { recursive: true });

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--remote-debugging-port=9222",
  "--window-size=1440,900", "--no-first-run", "--user-data-dir=C:/Users/User/.chrome-smoke",
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch("http://localhost:9222/json/list");
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
  if (r.exceptionDetails) throw new Error("JS exception: " + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 500));
  return r.result?.value;
}

async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, "base64"));
}

const consoleErrors = [];

async function nav(url) {
  await send("Page.navigate", { url });
  await sleep(2500);
}

async function login(username) {
  await evaluate(`(() => {
    const u = document.querySelector('input[autocomplete="username"], input[name="username"], input[type="text"]');
    const p = document.querySelector('input[type="password"]');
    const setV = (el, v) => { const proto = Object.getPrototypeOf(el); const desc = Object.getOwnPropertyDescriptor(proto, 'value'); desc.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    setV(u, ${JSON.stringify(username)}); setV(p, "medini123");
    return true;
  })()`);
  await sleep(300);
  await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find(x => /sign in|log in|masuk/i.test(x.textContent));
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(3000);
}

const results = [];
function rec(role, check, pass, note = "") {
  results.push([role, check, pass, note]);
  console.log(`${pass ? "PASS" : "FAIL"} | ${role} | ${check}${note ? " | " + note : ""}`);
}

async function main() {
  const wsUrl = await getWsUrl();
  ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const fn = pending.get(m.id); fn(m.result ?? m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") consoleErrors.push(m.params.exceptionDetails?.exception?.description?.slice(0, 200) ?? "exception");
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") consoleErrors.push(m.params.args?.[0]?.value?.slice?.(0, 200) ?? "console.error");
  };
  await send("Runtime.enable");
  await send("Page.enable");

  // navigate to app origin first — localStorage is inaccessible on about:blank
  await nav(`${APP}/login`);

  const roles = [
    { user: "hq", name: "HQ", expectNav: ["Finance", "Reports", "Marketing", "Administration"], forbidNav: [], expectKpi: ["Revenue", "What Needs Your Attention", "Operational Signals", "Branch Pulse"], forbidText: [] },
    { user: "manager", name: "Manager", expectNav: ["Finance", "Reports"], forbidNav: ["Administration", "Marketing"], expectKpi: ["Revenue", "What Needs Your Attention", "Operational Signals"], forbidText: [] },
    { user: "reception", name: "Receptionist", expectNav: ["Patients", "Appointments", "WhatsApp"], forbidNav: ["Finance", "Reports", "Administration", "Marketing"], expectKpi: ["Appointments", "What Needs Your Attention"], forbidText: ["Revenue", "RM "] },
    { user: "doctor", name: "Doctor", expectNav: ["Clinical", "Patient"], forbidNav: ["Finance", "Reports", "Administration", "Marketing"], expectKpi: ["Schedule", "What Needs Your Attention"], forbidText: ["Revenue"] },
  ];

  for (const role of roles) {
    consoleErrors.length = 0;
    // fresh session
    await evaluate(`localStorage.clear(); sessionStorage.clear(); true`);
    await nav(`${APP}/login`);
    await login(role.user);
    const url = await evaluate(`location.pathname`);
    rec(role.name, "A. login → /dashboard", url === "/dashboard", `url=${url}`);

    const me = await evaluate(`document.body.innerText.slice(0, 400)`);
    rec(role.name, "A. greeting/identity renders", /Good (Morning|Afternoon|Evening)/.test(me), "");

    const navText = await evaluate(`[...document.querySelectorAll('aside a, nav a')].map(a => a.textContent.trim()).join(' | ')`);
    for (const n of role.expectNav) rec(role.name, `C. nav shows '${n}'`, navText.includes(n));
    for (const n of role.forbidNav) rec(role.name, `C. nav hides '${n}'`, !navText.includes(n));

    const dashText = await evaluate(`document.body.innerText`);
    for (const k of role.expectKpi) rec(role.name, `B. dashboard contains '${k}'`, dashText.includes(k));
    for (const f of role.forbidText) rec(role.name, `B. dashboard excludes '${f}'`, !dashText.includes(f));

    rec(role.name, "B. no React/runtime console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" ;; "));
    await shot(`role-${role.user}`);

    // D. direct route attack
    await nav(`${APP}/finance`);
    await sleep(500);
    const finUrl = await evaluate(`location.pathname`);
    const finBlocked = finUrl !== "/finance" || (await evaluate(`document.body.innerText`)).includes("Unable") || !(await evaluate(`document.body.innerText`)).includes("INV-");
    if (role.user === "reception" || role.user === "doctor") {
      rec(role.name, "D. direct /finance blocked (redirected)", finUrl !== "/finance", `landed=${finUrl}`);
      await nav(`${APP}/reports`);
      await sleep(500);
      const repUrl = await evaluate(`location.pathname`);
      rec(role.name, "D. direct /reports blocked (redirected)", repUrl !== "/reports", `landed=${repUrl}`);
    } else {
      rec(role.name, "D. /finance accessible (permitted)", finUrl === "/finance", `landed=${finUrl}`);
    }
    await shot(`role-${role.user}-finance-attempt`);
  }

  // F. session isolation: HQ logout → reception login
  await evaluate(`localStorage.clear(); true`);
  await nav(`${APP}/login`);
  await login("hq");
  await sleep(1000);
  await evaluate(`localStorage.removeItem('medini_token'); true`);
  await nav(`${APP}/login`);
  await login("reception");
  const t = await evaluate(`document.body.innerText`);
  rec("Session", "F. HQ→Receptionist switch: no financial leak", !t.includes("Revenue"), "");

  console.log("\n================ SUMMARY ================");
  const fails = results.filter((r) => !r[2]);
  console.log(`TOTAL ${results.length} | PASS ${results.length - fails.length} | FAIL ${fails.length}`);
  for (const f of fails) console.log(`FAIL: ${f[0]} — ${f[1]} — ${f[3]}`);
}

main().catch((e) => { console.error("SMOKE ERROR:", e.message); process.exitCode = 1; })
  .finally(() => { chrome.kill(); process.exit(); });
