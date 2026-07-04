#!/usr/bin/env node
// checklinks.mjs — 相對連結存在性 + 大小寫稽核
// GitHub Pages 區分大小寫、Windows 不分；因此逐段用 readdirSync 驗證磁碟上的「實際大小寫」。
// 用法：node checklinks.mjs [rootDir]（預設 = 本腳本 tools/ 目錄的上一層）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] || path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SKIP_DIRS = new Set(['.git', 'node_modules', 'tools']);
const REF_RE = /(?:href|src)\s*=\s*(["'])(.*?)\1/gi;

// 遞迴列出所有 .html
function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) yield* walk(path.join(dir, ent.name));
    } else if (ent.name.toLowerCase().endsWith('.html')) {
      yield path.join(dir, ent.name);
    }
  }
}

// 外部網址、特殊協定、純 fragment、JS 模板字串 → 不檢查
function skippable(ref) {
  return !ref || ref.startsWith('#') || ref.startsWith('//') || ref.includes('${') ||
    /^[a-z][a-z0-9+.-]*:/i.test(ref); // http:, https:, data:, mailto:, javascript:, tel: …
}

const dirCache = new Map(); // 目錄 → 項目清單（避免重複 readdir）
function listDir(dir) {
  if (!dirCache.has(dir)) {
    try { dirCache.set(dir, fs.readdirSync(dir)); } catch { dirCache.set(dir, null); }
  }
  return dirCache.get(dir);
}

// 從 root 逐段比對，要求每一段（含中間目錄）的大小寫都與磁碟完全一致
function verify(absPath) {
  const rel = path.relative(root, absPath);
  if (rel === '') return { status: 'OK' };
  if (rel.startsWith('..')) return { status: 'MISSING' }; // 跳出網站根目錄，部署後必壞
  let cur = root;
  for (const seg of rel.split(path.sep)) {
    const entries = listDir(cur);
    if (!entries) return { status: 'MISSING' };
    if (!entries.includes(seg)) {
      const actual = entries.find((e) => e.toLowerCase() === seg.toLowerCase());
      return actual ? { status: 'CASE', actual } : { status: 'MISSING' };
    }
    cur = path.join(cur, seg);
  }
  return { status: 'OK' };
}

let problems = 0, refCount = 0, fileCount = 0;
for (const file of walk(root)) {
  fileCount++;
  const relFile = path.relative(root, file).replace(/\\/g, '/');
  for (const m of fs.readFileSync(file, 'utf8').matchAll(REF_RE)) {
    const ref = m[2].trim();
    if (skippable(ref)) continue;
    let clean = ref.split('#')[0].split('?')[0]; // 去掉 ?query 與 #fragment
    if (!clean) continue;
    try { clean = decodeURIComponent(clean); } catch { /* 保留原字串 */ }
    refCount++;
    const abs = clean.startsWith('/') ? path.join(root, clean) : path.resolve(path.dirname(file), clean);
    const r = verify(abs);
    if (r.status === 'MISSING') { problems++; console.log(`${relFile} -> ${ref} (MISSING)`); }
    else if (r.status === 'CASE') { problems++; console.log(`${relFile} -> ${ref} (CASE MISMATCH: actual "${r.actual}")`); }
  }
}

if (problems > 0) {
  console.log(`\n${problems} problem(s) found in ${refCount} refs across ${fileCount} HTML files.`);
  process.exit(1);
}
console.log(`OK: ${refCount} refs checked across ${fileCount} files`);
