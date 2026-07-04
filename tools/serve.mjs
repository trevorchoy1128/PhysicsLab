#!/usr/bin/env node
// serve.mjs — 零相依靜態檔案伺服器（PhysicsLab 重構驗證用）
// 用法：node serve.mjs [port] [rootDir]
//   port    預設 8123
//   rootDir 預設為本腳本 tools/ 目錄的上一層（即腳本所在的 checkout）；
//           也可明確指定另一個 checkout 的路徑來服務「重構前」版本
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] || 8123);
const defaultRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = path.resolve(process.argv[3] || defaultRoot);

// 文字類型一律加 charset=utf-8
const MIME = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  ico: 'image/x-icon',
  wasm: 'application/wasm',
  woff2: 'font/woff2',
};

http.createServer(async (req, res) => {
  const send = (status, body, type = 'text/plain; charset=utf-8') => {
    // Cache-Control: no-store — 重構迭代時每次重新整理都拿到最新檔案
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
    console.log(`${req.method} ${status} ${req.url}`);
  };
  let urlPath;
  try {
    // 去掉 query string，並解碼 %20 等（如 "Formula List" 目錄）
    urlPath = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  } catch {
    return send(400, '400 Bad Request');
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html'; // 「/」→ index.html
  const filePath = path.resolve(root, '.' + urlPath);
  // 防路徑跳脫：resolve 後必須仍在 root 底下
  if (!filePath.startsWith(root + path.sep)) return send(403, '403 Forbidden');
  try {
    const data = await fs.readFile(filePath);
    send(200, data, MIME[path.extname(filePath).slice(1).toLowerCase()] || 'application/octet-stream');
  } catch {
    send(404, `404 Not Found: ${urlPath}`);
  }
}).listen(port, () => console.log(`serving ${root} -> http://127.0.0.1:${port}/`));
