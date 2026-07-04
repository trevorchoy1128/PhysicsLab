#!/usr/bin/env node
// snap.mjs — 無頭瀏覽器頁面探測器（原生 CDP over WebSocket，零相依、不用 puppeteer）
//
// 用法：
//   node snap.mjs --url <url> --out <basePath>
//   node snap.mjs --list <file> --outdir <dir>   （list 檔：每行一個 URL，# 開頭為註解）
// 選項：
//   --width N         視窗寬，預設 1600
//   --height N        視窗高，預設 900
//   --settle ms       load 事件後額外等待（讓 3D 場景/動畫穩定），預設 2500
//   --browser <exe>   瀏覽器路徑；預設 Edge，找不到則退回 Chrome
//   --no-swiftshader  停用軟體 WebGL 旗標（預設啟用，無頭模式才能渲染 WebGL）
//   --dom             另外輸出渲染後 DOM（<base>.dom.html）
//
// 每頁輸出：<base>.png、<base>.errors.txt、<base>.styles.json（+ 選配 <base>.dom.html）
// 結束碼：所有頁面完成擷取 → 0（即使頁面有 console 錯誤，錯誤記在檔案與摘要中）；
//         工具本身失敗（瀏覽器起不來、導航逾時）→ 非 0

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// 固定樣式探測選擇器清單（重構前後 diff 用；內容勿隨意改動，以免舊快照失去比較性）
const SELECTORS = ['body', '#topbar', '#topbar h1', '.panel-toggle-btn', '#left-panel', '#right-panel',
  '.card', '.card-header', '.dir-btn', '.dir-btn.active', 'input[type=range]', '.toggle-track.on',
  '.toggle-row', '.action-btn', '.quiz-opt', '.guide-box', '.formula-box', '#home-btn', '#status-badge', '#hint'];

// 對每個 selector 取「第一個」符合元素的全部 computed style；鍵排序後回傳，讓 JSON 可穩定 diff
const PROBE = `(() => {
  const out = {};
  for (const sel of ${JSON.stringify(SELECTORS)}) {
    const el = document.querySelector(sel);
    if (!el) { out[sel] = null; continue; }
    const cs = getComputedStyle(el);
    const flat = {};
    for (let i = 0; i < cs.length; i++) flat[cs[i]] = cs.getPropertyValue(cs[i]);
    const sorted = {};
    for (const k of Object.keys(flat).sort()) sorted[k] = flat[k];
    out[sel] = sorted;
  }
  return out;
})()`;

// ---------- 參數解析 ----------
const opts = { width: 1600, height: 900, settle: 2500, swiftshader: true, dom: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--url') opts.url = argv[++i];
  else if (a === '--out') opts.out = argv[++i];
  else if (a === '--list') opts.list = argv[++i];
  else if (a === '--outdir') opts.outdir = argv[++i];
  else if (a === '--width') opts.width = Number(argv[++i]);
  else if (a === '--height') opts.height = Number(argv[++i]);
  else if (a === '--settle') opts.settle = Number(argv[++i]);
  else if (a === '--browser') opts.browser = argv[++i];
  else if (a === '--no-swiftshader') opts.swiftshader = false;
  else if (a === '--dom') opts.dom = true;
  else { console.error(`未知參數: ${a}`); process.exit(2); }
}

// 組出 { url, base } 工作清單
const jobs = [];
if (opts.url && opts.out) {
  jobs.push({ url: opts.url, base: path.resolve(opts.out) });
} else if (opts.list && opts.outdir) {
  for (const line of fs.readFileSync(opts.list, 'utf8').split(/\r?\n/)) {
    const url = line.trim();
    if (!url || url.startsWith('#')) continue;
    // 由 URL 路徑推導檔名：去掉 .html，「/」與空白改為「_」
    const name = decodeURIComponent(new URL(url).pathname)
      .replace(/\.html$/i, '').replace(/^\//, '').replace(/[/ ]/g, '_') || 'index';
    jobs.push({ url, base: path.resolve(opts.outdir, name) });
  }
} else {
  console.error('用法: node snap.mjs --url <url> --out <basePath> | --list <file> --outdir <dir>');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, msg) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); }),
  ]);
}

// 自行挑一個空閒 port（Edge 的 --remote-debugging-port=0 從 stdout 探測不可靠）
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

// 開新分頁；新版 Chromium 要求 PUT，舊版只接受 GET
async function newTarget(port, url) {
  const ep = `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`;
  let res = await fetch(ep, { method: 'PUT' });
  if (!res.ok) res = await fetch(ep);
  if (!res.ok) throw new Error(`json/new 失敗: HTTP ${res.status}`);
  return res.json();
}

// ---------- 最小 CDP 客戶端 ----------
class CDP {
  constructor(ws) {
    this.ws = ws; this.seq = 0; this.pending = new Map(); this.handlers = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers) h(msg.method, msg.params);
      }
    });
  }
  static connect(wsUrl) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl); // Node 24 原生 WebSocket
      ws.addEventListener('open', () => resolve(new CDP(ws)), { once: true });
      ws.addEventListener('error', () => reject(new Error('WebSocket 連線失敗')), { once: true });
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(handler) { this.handlers.push(handler); }
  close() { try { this.ws.close(); } catch { /* 已關閉 */ } }
}

// ---------- 單頁擷取 ----------
async function capturePage(port, url, base) {
  const target = await newTarget(port, url);
  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  const errors = [];
  let loaded = false;
  try {
    cdp.on((method, p) => {
      if (method === 'Page.loadEventFired') loaded = true;
      else if (method === 'Runtime.consoleAPICalled' && p.type === 'error') {
        const text = p.args.map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(' ');
        const f = p.stackTrace && p.stackTrace.callFrames[0];
        errors.push(`[console] ${text}${f ? ` @ ${f.url}:${f.lineNumber + 1}` : ''}`);
      } else if (method === 'Runtime.exceptionThrown') {
        const d = p.exceptionDetails;
        const text = ((d.exception && d.exception.description) || d.text || '').split('\n')[0];
        errors.push(`[exception] ${text} @ ${d.url || ''}:${(d.lineNumber ?? 0) + 1}`);
      } else if (method === 'Log.entryAdded' && p.entry.level === 'error') {
        const e = p.entry;
        errors.push(`[${e.source}] ${e.text}${e.url ? ` @ ${e.url}:${e.lineNumber ?? 0}` : ''}`);
      }
    });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable'); // enable 時會補送先前緩衝的 console 訊息
    await cdp.send('Log.enable');
    // 等待 load 事件；若附掛前頁面已載入完成，改靠 readyState 輪詢補救
    const deadline = Date.now() + 20000;
    while (!loaded) {
      const r = await cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }).catch(() => null);
      if (r && r.result && r.result.value === 'complete') break;
      if (Date.now() > deadline) throw new Error(`導航逾時（20 秒）: ${url}`);
      await sleep(250);
    }
    await sleep(opts.settle); // 讓 3D 場景 / 字型 / 動畫穩定
    fs.mkdirSync(path.dirname(base), { recursive: true });
    const shot = await withTimeout(cdp.send('Page.captureScreenshot', { format: 'png' }), 30000, '截圖逾時');
    fs.writeFileSync(`${base}.png`, Buffer.from(shot.data, 'base64'));
    const styles = await cdp.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    fs.writeFileSync(`${base}.styles.json`, JSON.stringify(styles.result.value, null, 2) + '\n');
    if (opts.dom) {
      const dom = await cdp.send('Runtime.evaluate', { expression: 'document.documentElement.outerHTML', returnByValue: true });
      fs.writeFileSync(`${base}.dom.html`, String(dom.result.value));
    }
    fs.writeFileSync(`${base}.errors.txt`, errors.length ? errors.join('\n') + '\n' : '');
    return errors.length;
  } finally {
    cdp.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => { /* 瀏覽器可能已收掉 */ });
  }
}

// ---------- 主流程 ----------
async function main() {
  const browser = opts.browser || (fs.existsSync(EDGE) ? EDGE : CHROME);
  if (!fs.existsSync(browser)) { console.error(`找不到瀏覽器: ${browser}`); process.exit(1); }
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-profile-')); // 全新暫存 profile
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${opts.width},${opts.height}`,
    '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
  ];
  // 軟體算圖（SwiftShader）讓 WebGL 在無頭環境可用；新版 Chromium 另需 enable-unsafe-swiftshader
  if (opts.swiftshader) args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  console.log(`啟動 ${path.basename(browser)}（port ${port}, swiftshader=${opts.swiftshader}）`);
  const proc = spawn(browser, args, { stdio: 'ignore' });
  let failures = 0;
  try {
    // 輪詢 DevTools endpoint 直到就緒（最多 15 秒）
    const t0 = Date.now();
    for (;;) {
      try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { /* 還沒好 */ }
      if (proc.exitCode !== null) throw new Error(`瀏覽器啟動即結束（exit ${proc.exitCode}）`);
      if (Date.now() - t0 > 15000) throw new Error('DevTools endpoint 15 秒內未就緒');
      await sleep(250);
    }
    const results = [];
    for (const job of jobs) {
      console.log(`-> ${job.url}`);
      try {
        const n = await withTimeout(capturePage(port, job.url, job.base), 90000, '頁面處理逾時（90 秒）');
        results.push({ base: job.base, status: n ? `ERRORS(${n})` : 'OK' });
      } catch (err) {
        failures++;
        results.push({ base: job.base, status: 'FAIL', note: err.message });
      }
    }
    console.log('\n=== 摘要 ===');
    for (const r of results) console.log(`${r.status.padEnd(10)} ${r.base}${r.note ? `  (${r.note})` : ''}`);
  } finally {
    // 確實收掉瀏覽器與暫存 profile
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      else proc.kill('SIGKILL');
    } catch { /* 可能已結束 */ }
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* 殘檔無妨 */ }
  }
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(`工具失敗: ${err.message}`); process.exit(1); });
