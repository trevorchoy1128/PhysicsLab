# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概要

香港 DSE 物理科的互動模擬教材網站（繁體中文介面）。**零建置**靜態站：沒有 package.json、沒有 lint、沒有測試框架。每個頁面都是一個自包含的 HTML 檔（CSS/JS 內嵌），第三方庫全部走 CDN。部署到 GitHub Pages，同時必須支援直接以 `file://` 開啟。

## 開發與驗證

- 沒有 build 步驟：直接用瀏覽器開 HTML 檔即可驗證。改動後務必同時確認 `file://` 開啟仍正常（因此共用 JS 一律用 classic `<script>`，禁用 ES module 與 `fetch` 載入本地資源；唯一例外見下方「特例頁面」）。
- 本機環境：有 Node 24（原生 fetch/WebSocket）、Edge headless 可用（截圖/煙霧測試；WebGL 需 `--use-angle=swiftshader`）；**沒有** Python、gh CLI、ImageMagick。
- 新增/改名模擬器時，必須同步更新 `index.html` 的對應卡片連結。
- Commit 訊息使用繁體中文，前綴沿用 conventional style（`feat:`、`chore:` 等）。

## 結構

- `index.html` — 首頁入口（Tailwind browser CDN + Font Awesome），以 tab 分「模擬器」與「公式列表」，按 Book/Chapter 卡片列出所有頁面。
- `Simulator/book{3,4}/chapterN/*-sim.html` — 約 35 個模擬器。命名慣例：`名稱-2D-sim.html` / `名稱-3D-sim.html`。Book 3 = 波動與光學；Book 4 = 電與磁。
- `Formula List/book4/chapterN-formula.html` — 公式頁（MathJax 3）。部分章節用 `lang-zh` / `lang-en` span-pair 做中英切換——保留此機制，勿改成其他 i18n 方案。
- `Learning Key Point/` — 尚在起步（目前只有空目錄骨架）。

## 技術棧（頁面內常見組合）

- 3D 模擬：Three.js **0.128**（jsdelivr CDN）+ `examples/js/controls/OrbitControls.js`（非 module 版）。新 3D 頁請沿用同版本，避免混版。
- 數學排版：MathJax 3 或 KaTeX 0.16（視頁面而定）。
- 2D 模擬：原生 Canvas 2D。

## 設計系統與進行中的重構

- 全站正在統一為單一設計風格（深色 topbar `#1e293b` + 淺灰底 `#e2e6eb`）。像素標準來源：`Simulator/book4/chapter7/AC-DC-generator-3D-sim.html` 與 `faraday-lenz-induction-3D-sim.html`。book4 ch5/6/7 已是此風格，改動這些頁面時須保持像素保真。
- 重構在獨立 worktree 進行：`Desktop\PhysicsLab-refactor`（分支 `refactor/lab-gray-unification`）；main 留在本目錄。**熱修規則：先修 main，再立即把 main merge 進重構分支；絕不在兩邊改同一個檔案。**
- 重構方向已由使用者拍板（勿重新提議）：維持 Vanilla + 共用資產（否決 React/TS 改寫）；模擬器文字抽成 per-page zh 字典（`PhysLab.i18n.register({zh, en:{}})`），命名空間 `window.PhysLab`，CSS token 前綴 `--pl-*`。

## 特例頁面（改動前先了解其特殊性）

- `Simulator/book4/chapter1/parallel-plate-3D-sim.html` — 唯一使用 ES module + importmap 的頁面，保留不降級。
- `Simulator/book4/chapter2/series-parallel-connection-sim.html` — 內建 MNA（修正節點分析）電路引擎與自由式電路編輯器，邏輯複雜。
- `Simulator/book4/chapter6/DC-motor-3D-sim.html` — CSS 3D 實作（非 Three.js）。
- `Simulator/book3/chapter2/glassblock-prism-2D-sim.html` — SVG 實作。
