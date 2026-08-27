// Capture real Brick Book screens for the landing page.
//
// Drives a headless Chrome over the DevTools Protocol with no npm deps (Node 24
// has a global WebSocket). The app is seeded with INVENTED data first — no real
// figure, dealer or contractor name ever reaches these images.
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const APP = "http://localhost:5173/";
const OUT = process.argv[2] || "/tmp/brickbook-shots";
const SHOT = process.argv[3] || "all";

mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  "--headless=new",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=${OUT}/profile`,
  "--window-size=390,844",
  "--force-device-scale-factor=3",
  "about:blank",
], { stdio: "ignore" });

const cleanup = () => { try { chrome.kill(); } catch {} };
process.on("exit", cleanup);

// Wait for the debugging endpoint.
let target;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const list = await r.json();
    target = list.find((t) => t.type === "page");
    if (target) break;
  } catch {}
  await sleep(250);
}
if (!target) throw new Error("Chrome never came up");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params }));
  });

const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate", {
    expression: expr, awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
  return r.result.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
});

const goto = async (url) => {
  await send("Page.navigate", { url });
  await sleep(2200);
};

const shoot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, "base64"));
  console.log("shot", name);
};

// ---------------------------------------------------------------- seed
const SEED = `(async () => {
  localStorage.setItem('hl-app-mode','builder');
  localStorage.setItem('hl-theme','dark');
  let s = 20260827;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const PLAN = [
    ['Contractor', 1840000, 46, ['Labour payment','Slab work','Brickwork','RCC column','Plaster work','Curing & finishing'], ['Contractor']],
    ['Marble',      615000,  9, ['Marble slabs','Marble polishing','Kota stone','Staircase marble'], ['Verma Traders','Marble Dealer']],
    ['Wood',        520000, 14, ['Door frames','Teak wood','Carpenter labour','Window shutters'], ['Carpenter','Timber Dealer']],
    ['Plumbing',    412500, 31, ['CPVC fittings','Bathroom fittings','Water tank','Plumber labour','Overhead pipe'], ['Plumber','Sharma Hardware']],
    ['Electrical',  368000, 27, ['Wiring','Switch boards','MCB box','Electrician labour','Ceiling fan points'], ['Electrician','Sharma Hardware']],
    ['Tiles',       310000, 16, ['Floor tiles','Wall tiles','Tile labour'], ['Tile Dealer','Mistri']],
    ['Site Prep',   240000, 11, ['Excavation','Levelling','Boundary wall','Site clearing'], ['Contractor','JCB Operator']],
    ['Govt Fee/Chalan', 195000, 7, ['Map approval','Water connection','Electricity connection'], ['']],
    ['Paint',       181900, 15, ['Primer','Emulsion','Painter labour','Putty work'], ['Painter','Paint Dealer']],
    ['Architect',   180000,  6, ['Design fee','Site visit','Drawings revision'], ['Architect']],
  ];
  const MODES = ['Cash','UPI 1','UPI 2','Bank Transfer 1','Cheque'];
  const PAYERS = ['Owner 1','Owner 2','Owner 3'];
  const rows = []; let n = 0;
  for (const [cat, total, count, events, details] of PLAN) {
    const weights = Array.from({length: count}, () => 0.5 + rnd());
    const sum = weights.reduce((a,b)=>a+b,0);
    let placed = 0;
    for (let i = 0; i < count; i++) {
      const last = i === count - 1;
      const amt = last ? total - placed : Math.max(500, Math.round(total * weights[i] / sum / 500) * 500);
      placed += amt;
      const d = new Date(2024, 5, 1);
      d.setDate(d.getDate() + Math.floor(rnd() * 800));
      const created = d.getTime() + Math.floor(rnd()*8.64e7);
      rows.push({ id:'seed-e-'+(n++), date:d.toISOString().slice(0,10), category:cat,
        event:pick(events), detail:pick(details), amount:amt, mode:pick(MODES),
        paidBy:pick(PAYERS), notes:'', createdAt:created, updatedAt:created, billAllocations:null });
    }
  }
  const mk = (id,billId,date,vendor,inv,invTotal,item,qty,unit,rate,cat) => ({
    id, billId, date, category:cat, vendor, invoiceNo:inv, invoiceTotal:invTotal,
    item, hsn:null, gstPct:18, basis:'count', length:null, width:null,
    thickness:null, pieces:null, writtenQty:qty, qty, unit, rate,
    discPct:null, amount: qty*rate, amountPaid:null, clubbed:false });
  const boq = [
    mk('bq1','bill-A','2026-08-02','Sharma Hardware','A-2214',48200,'Brass Tee 1\\"',24,'pcs',180,'Plumbing'),
    mk('bq2','bill-A','2026-08-02','Sharma Hardware','A-2214',48200,'Brass Elbow 3/4\\"',40,'pcs',140,'Plumbing'),
    mk('bq3','bill-A','2026-08-02','Sharma Hardware','A-2214',48200,'CPVC Pipe 1\\"',60,'ft',95,'Plumbing'),
    mk('bq4','bill-A','2026-08-02','Sharma Hardware','A-2214',48200,'Freight',1,'',450,'Plumbing'),
    mk('bq5','bill-B','2026-08-19','Verma Traders','V-771',36400,'Brass Tee 1\\"',12,'pcs',195,'Plumbing'),
    mk('bq6','bill-B','2026-08-19','Verma Traders','V-771',36400,'Bib Cock 1/2\\"',18,'pcs',320,'Plumbing'),
    mk('bq7','bill-C','2026-07-11','Tile Dealer','T-88',92500,'Floor Tile 2x2',180,'sqft',68,'Tiles'),
    mk('bq8','bill-D','2026-06-24','Sharma Hardware','A-1908',21750,'Brass Tee 1\\"',16,'pcs',172,'Plumbing'),
    mk('bq9','bill-D','2026-06-24','Sharma Hardware','A-1908',21750,'Union 1\\"',10,'pcs',210,'Plumbing'),
    mk('bq10','bill-E','2026-05-09','Kisan Traders','K-402',18900,'Brass Tee 1\\"',20,'pcs',165,'Plumbing'),
  ];
  const stock = [['Brass Tee 1\\"','Plumbing','pcs'],['Brass Elbow 3/4\\"','Plumbing','pcs'],
    ['CPVC Pipe 1\\"','Plumbing','ft'],['T 1.5 inch','Plumbing','pcs'],['Cement OPC 53','Misc','bag']]
    .map((it,i)=>({id:'seed-s-'+i,name:it[0],category:it[1],unit:it[2],done:false,createdAt:1787000000000-i*1000}));

  const req = indexedDB.open('house-ledger');
  const idb = await new Promise(r=>{req.onsuccess=()=>r(req.result)});
  const tx = idb.transaction(['entries','settings','boqItems','stockItems','stockMoves'],'readwrite');
  const es = tx.objectStore('entries'); es.clear(); rows.forEach(r=>es.put(r));
  const bs = tx.objectStore('boqItems'); bs.clear(); boq.forEach(b=>bs.put(b));
  const ss = tx.objectStore('stockItems'); ss.clear(); stock.forEach(x=>ss.put(x));
  tx.objectStore('stockMoves').clear();
  tx.objectStore('settings').put({id:'app',lastBackupDate:null,budget:6000000,
    homeAddress:'Plot 12, Green Valley Phase 2',state:'',city:''});
  await new Promise(r=>{tx.oncomplete=r});
  idb.close();
  return rows.length;
})()`;

await goto(APP);
const seeded = await evaluate(SEED);
console.log("seeded entries:", seeded);
await goto(APP);

const tapTab = (label) =>
  evaluate(`(async()=>{
    const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});
    if(!b) return 'missing';
    b.click(); await new Promise(r=>setTimeout(r,900)); return 'ok';
  })()`);

if (SHOT === "all" || SHOT === "dash") {
  await sleep(800);
  await shoot("dash");
}

if (SHOT === "all" || SHOT === "boq") {
  await tapTab("BOQ");
  await evaluate(`(async()=>{
    const i=[...document.querySelectorAll('input')].find(x=>/Search item, dealer/.test(x.placeholder||''));
    const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    set.call(i,'tee 1'); i.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,700));
    // Bring the matched LINES to the top of the shot, not the coverage table.
    const h=[...document.querySelectorAll('*')].find(e=>/^ITEMS ·/i.test(e.textContent.trim()) && e.children.length===0);
    if(h) h.scrollIntoView({block:'start',behavior:'instant'});
    window.scrollBy(0,-120);
    await new Promise(r=>setTimeout(r,500));
    return 'ok';
  })()`);
  await shoot("boq");
}

if (SHOT === "all" || SHOT === "voice") {
  await goto(APP + "?shot=voice");
  await tapTab("Entry");
  await sleep(900);
  await evaluate(`(async()=>{
    const el=[...document.querySelectorAll('*')].find(e=>/^Heard$/i.test(e.textContent.trim()) && e.children.length===0);
    if(el) { el.scrollIntoView({block:'center',behavior:'instant'}); window.scrollBy(0,-160); }
    await new Promise(r=>setTimeout(r,500));
    return el ? 'found' : 'no-heard-panel';
  })()`).then((v) => console.log("voice panel:", v));
  await shoot("voice");
}

if (SHOT === "all" || SHOT === "ledger") {
  await tapTab("Ledger");
  await sleep(1200);
  await shoot("ledger");
}

ws.close();
chrome.kill();
console.log("done ->", OUT);
