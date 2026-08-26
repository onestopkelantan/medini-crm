/* Phase 7.1 visual verification — screenshot + structure dump */
import { spawn } from "child_process";
import { writeFileSync } from "fs";

const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--disable-gpu", "--remote-debugging-port=9231",
  "--window-size=1440,900", "--no-first-run", "--user-data-dir=C:/Users/User/.chrome-shot71",
  "--allow-file-access-from-files", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let ws;
  for (let i = 0; i < 30; i++) {
    try {
      const tabs = await (await fetch("http://localhost:9231/json/list")).json();
      const page = tabs.find((t) => t.type === "page");
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch {}
    await sleep(500);
  }
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;

  await send("Page.enable");
  await send("Page.navigate", { url: "file:///C:/Users/User/Desktop/Medini%20terbaru/app/reviews/CURRENT-MEDINI-REVIEW.html" });
  await sleep(2500);
  await evalJs(`document.getElementById('login-username').value='hq'; document.getElementById('login-password').value='medini123'; document.querySelector('#page-login form button[type="submit"]').click(); true`);
  await sleep(2200);

  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync("smoke-shots/phase71-hq-dashboard.png", Buffer.from(shot.data, "base64"));

  const structure = await evalJs(`(() => {
    const d = document.getElementById('page-dashboard');
    return [...d.children].map(c => ((c.id||'(no-id)') + ' :: ' + (c.innerText||'').split('\\n').filter(Boolean).slice(0,2).join(' | ')).slice(0,90));
  })()`);
  console.log("STRUCTURE::" + JSON.stringify(structure, null, 1));

  const checks = await evalJs(`(() => {
    const d = document.getElementById('page-dashboard');
    const kids = [...d.children].map(c => c.id || '');
    return {
      order: kids,
      execSummaryInSummary: document.getElementById('p4-summary')?.innerText.includes('Executive Summary'),
      attentionInAttention: document.getElementById('p4-attention')?.innerText.includes('What Needs Your Attention'),
      kpiCount: document.getElementById('wgt-kpis')?.querySelectorAll(':scope > div').length,
      tooth: !!document.getElementById('tooth3d'),
      threeJs: !!document.querySelector('script[src*="three"]'),
      p4IntelExists: !!document.getElementById('p4-intel'),
    };
  })()`);
  console.log("CHECKS::" + JSON.stringify(checks, null, 1));

  chrome.kill();
  process.exit(0);
})();
