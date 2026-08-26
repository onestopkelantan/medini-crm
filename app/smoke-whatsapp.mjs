/* Focused WhatsApp Hub smoke test — W-01..W-25 only */
import { spawn } from "child_process";
import { writeFileSync, mkdirSync } from "fs";

const FILE = "file:///C:/Users/User/Desktop/Medini%20terbaru/app/reviews/CURRENT-MEDINI-REVIEW.html";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync("smoke-shots", { recursive: true });
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--remote-debugging-port=9235",
  "--window-size=1440,900", "--no-first-run", "--user-data-dir=C:/Users/User/.chrome-wahub",
  "--allow-file-access-from-files", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getWsUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const tabs = await (await fetch("http://localhost:9235/json/list")).json();
      const page = tabs.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { await sleep(500); }
  }
  throw new Error("CDP unreachable");
}
let msgId = 0;
const pending = new Map();
let ws;
const jsErrors = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("timeout " + method)); } }, 20000);
  });
}
async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("JS: " + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 400));
  return r.result?.value;
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`smoke-shots/${name}.png`, Buffer.from(r.data, "base64"));
}
const results = [];
function rec(check, pass, note = "") { results.push([check, pass, note]); console.log(`${pass ? "PASS" : "FAIL"} | ${check}${note ? " | " + note : ""}`); }
async function loginAs(username, pw = "medini123") {
  await evaluate(`(() => {
    document.getElementById('login-username').value = ${JSON.stringify(username)};
    document.getElementById('login-password').value = ${JSON.stringify(pw)};
    return true;
  })()`);
  await evaluate(`document.querySelector('#page-login form button[type="submit"]').click(); true`);
  await sleep(1200);
}

try {
  const wsUrl = await getWsUrl();
  ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const fn = pending.get(m.id); fn(m.result ?? m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") jsErrors.push(m.params.exceptionDetails?.exception?.description?.slice(0, 300) ?? "exception");
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: FILE });
  await sleep(3000);

  await loginAs("hq");
  await evaluate(`showPage('whatsapp'); true`); await sleep(600);

  const w01 = await evaluate(`(() => { return !!document.getElementById('page-whatsapp') && document.getElementById('page-whatsapp').innerText.includes('WhatsApp Hub'); })()`);
  rec("W-01. WhatsApp Hub page renders", w01 === true);
  const w02 = await evaluate(`(() => { return document.getElementById('waChannelBar').innerText.includes('Connected') || document.getElementById('waChannelBar').innerText.includes('Need QR'); })()`);
  rec("W-02. Channel status bar renders", w02 === true);
  const w03 = await evaluate(`(() => { return WAH.channels.length >= 3 && WAH.channels.every(c => c.session && c.phone && c.status); })()`);
  rec("W-03. Channels have session, phone, status", w03 === true);
  const w04 = await evaluate(`(() => { return document.querySelectorAll('#waList > div').length > 0; })()`);
  rec("W-04. Conversation list renders", w04 === true);
  const w05 = await evaluate(`(() => { const before = waChats[waActive].msgs.length; document.getElementById('waInput').value = 'Test human reply'; waSend(); return waChats[waActive].msgs.length === before + 1 && waChats[waActive].msgs[before][0] === 'me'; })()`);
  rec("W-05. Human reply functional", w05 === true);
  const w06 = await evaluate(`(() => { return WAH.audit.some(a => a.action === 'message_sent' && a.detail.includes('Test human reply')); })()`);
  rec("W-06. Message sent audited", w06 === true);
  const w07 = await evaluate(`(() => { waAiSuggest(); return document.getElementById('waInput').value.length > 10; })()`);
  rec("W-07. AI suggest inserts draft", w07 === true);
  const w08 = await evaluate(`(() => { document.getElementById('waInput').value = ''; waApplyTemplate('TP-1'); return document.getElementById('waInput').value.includes('disahkan'); })()`);
  rec("W-08. Template picker inserts merged body", w08 === true);
  const w09 = await evaluate(`(() => { waAssign(0); document.getElementById('waAssignee').value = ADM.staff.find(s => s.role === 'branch_manager').name; waDoAssign(0); return !!WAH.assignments[0]; })()`);
  rec("W-09. Assign conversation works (HQ)", w09 === true);
  const w10 = await evaluate(`(() => { return WAH.audit.some(a => a.action === 'conversation_assigned'); })()`);
  rec("W-10. Assignment audited", w10 === true);
  const w11 = await evaluate(`(() => { waUnassign(0); return !WAH.assignments[0]; })()`);
  rec("W-11. Unassign works", w11 === true);
  const w12 = await evaluate(`(() => { waResolve(0); return WAH.resolved[0] === true; })()`);
  rec("W-12. Resolve conversation works", w12 === true);
  const w13 = await evaluate(`(() => { waReopen(0); return !WAH.resolved[0]; })()`);
  rec("W-13. Reopen conversation works", w13 === true);
  const w14 = await evaluate(`(() => { const before = WAH.audit.length; waEscalate(); return WAH.audit.length > before && WAH.audit.some(a => a.action === 'escalated'); })()`);
  rec("W-14. Escalation functional + audited", w14 === true);
  await evaluate(`finCloseDrawer(); true`); await sleep(500);
  const w15 = await evaluate(`(() => { document.getElementById('finDrawerTitle').innerText = ''; waInsertTemplate(); return document.getElementById('finDrawerTitle').innerText.includes('Insert Template'); })()`);
  rec("W-15. Template picker renders", w15 === true);
  await evaluate(`finCloseDrawer(); true`); await sleep(500);
  const w16 = await evaluate(`(() => { return !document.getElementById('page-whatsapp').innerHTML.includes('Campaign Queue') && !document.getElementById('page-whatsapp').innerHTML.includes('campaignQueue'); })()`);
  rec("W-16. Campaign queue removed from WhatsApp Hub", w16 === true);
  const w17 = await evaluate(`(() => { return WAH.templates.every(t => t.name && t.body); })()`);
  rec("W-17. Quick reply templates valid", w17 === true);
  const w18 = await evaluate(`(() => { const orig = currentUser; currentUser = { ...DEMO_USERS.find(u => u.role === 'doctor') }; document.getElementById('finDrawerTitle').innerText = ''; waInsertTemplate(); const hasTemplate = document.getElementById('finDrawerTitle').innerText.includes('Insert Template'); currentUser = orig; return hasTemplate; })()`);
  rec("W-18. Doctor can view templates (read-only)", w18 === true);
  const w19 = await evaluate(`(() => { const orig = currentUser; currentUser = { ...DEMO_USERS.find(u => u.role === 'doctor') }; waAssign(0); const blocked = !WAH.assignments[0]; currentUser = orig; return blocked; })()`);
  rec("W-19. Doctor cannot assign conversation", w19 === true);
  const w20 = await evaluate(`(() => { const orig = currentUser; currentUser = { ...DEMO_USERS.find(u => u.role === 'receptionist'), branchId: 'gelang-patah' }; waRenderChannelBar(); const hasChannels = WAH.channels.filter(c => c.branch === 'gelang-patah').length === 1; currentUser = orig; waRenderChannelBar(); return hasChannels; })()`);
  rec("W-20. Branch channel scoped", w20 === true);
  const w21 = await evaluate(`(() => { const c = waChats[waActive]; return document.getElementById('waContext').innerText.includes(c.phone.slice(0, 6)); })()`);
  rec("W-21. Patient context panel shows phone", w21 === true);
  const w22 = await evaluate(`(() => { return document.getElementById('waHeader').innerText.includes('View 360'); })()`);
  rec("W-22. View 360 link present", w22 === true);
  const w23 = await evaluate(`(() => { return typeof waRenderChannelBar === 'function' && typeof wahAudit === 'function'; })()`);
  rec("W-23. WAH engine functions exist", w23 === true);
  const w24 = await evaluate(`(() => { const names = ['message_sent','conversation_assigned','escalated','conversation_resolved','conversation_reopened']; return names.every(n => WAH.audit.some(a => a.action === n)); })()`);
  rec("W-24. All audit action types recorded", w24 === true);
  rec("W-25. Zero JS errors after WhatsApp Hub", jsErrors.length === 0, jsErrors.slice(0, 2).join(";;"));
  await shot("whatsapp-hub-focused");

  const fails = results.filter((r) => !r[1]);
  console.log(`\n=========== WHATSAPP HUB FOCUSED ===========`);
  console.log(`TOTAL ${results.length} | PASS ${results.length - fails.length} | FAIL ${fails.length}`);
  for (const f of fails) console.log(`FAIL: ${f[0]} — ${f[2]}`);
} catch (e) {
  console.error("ERROR:", e.message);
} finally {
  chrome.kill();
  process.exit();
}
