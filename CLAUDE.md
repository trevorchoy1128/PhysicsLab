# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概要

香港 DSE 物理科的互動模擬教材網站（繁體中文介面）。**零建置**靜態站：沒有 package.json、沒有 lint、沒有測試框架。每個頁面都是一個自包含的 HTML 檔（CSS/JS 內嵌），第三方庫全部走 CDN。部署到 GitHub Pages，同時必須支援直接以 `file://` 開啟。

## 開發與驗證

- 沒有 build 步驟：直接用瀏覽器開 HTML 檔即可驗證。改動後務必同時確認 `file://` 開啟仍正常（因此共用 JS 一律用 classic `<script>`，禁用 ES module 與 `fetch` 載入本地資源；唯一例外見下方「特例頁面」）。
- 本機環境：有 Node 24（原生 fetch/WebSocket）、Edge headless 可用（截圖/煙霧測試；WebGL 需 `--use-angle=swiftshader`）；**沒有** Python、gh CLI、ImageMagick。
- 新增/改名模擬器時，必須同步更新 `index.html` 的對應卡片連結。
- Commit 訊息使用繁體中文，前綴沿用 conventional style（`feat:`、`chore:` 等）。

## 版權資源鐵律（resource/）

- `resource/`（教科書 PDF、教育局詞彙表 `PhyGlossary_2020.pdf` 等）**只限本機存取，絕不 commit、絕不上 GitHub**。禁止 `git add -f` 加入任何 PDF。
- 雙重防護已就位：`.gitignore` ignore 成個 `resource/`；`tools/git-hooks/pre-commit` 連強制加都會擋。新 clone 後要重新啟用 hook：`git config core.hooksPath tools/git-hooks`。
- 教科書內容只可以概念形式引用（撮寫、轉述），不可將大段原文貼入任何會 commit 嘅檔案（模擬器頁、Learning Key Point 頁、spec 等）。
- 讀 PDF 用 `pdf-reader` MCP（`@sylphx/pdf-reader-mcp`），三個工具、成本指引如下：
  - **文字先行**：`read_pdf`，參數 `{ sources:[{path, pages:"2-15"}], auto:false, include_full_text:true }`。**必須指定 `pages` 範圍 + `auto:false`**；**唔好用 `auto`/`auto_detail`**——嗰啲會 render 頁面圖，4 頁就爆到 60 萬字元。
  - **搵概念/詞在邊頁**：`search_pdf`（`query` → 頁碼 + snippet），精準跳段，唔使成章讀。
  - **睇 figure（貴）**：`pdf_evidence`（`operation:"render_page"`）逐頁 render。
  - 教科書檔名含空格甚至雙空格（如 `Book 3B  Ch4 (E).pdf`），用前先 Glob 攞準確檔名。

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

## 教學 agent 團隊

| Agent | 角色 | 幾時用 |
|---|---|---|
| `physics-teacher` | 資深 DSE 物理教師（醒） | 讀章節出 simulator 提案；按 prompt/相片設計 experiment spec |
| `physics-student` | 扮演中游中學生（醒 model 扮蠢） | 讀章節搵「學生唔明位」；試讀教材評易明度 |
| `html-specialist` | HTML 專家 | 按 experiment spec 寫模擬器 + Edge headless 自查 |
| `physics-verifier` | 物理+深度+外觀審查 | 模擬器物理改動後把關 |
| `convention-reviewer` | 規範+代碼品質+3D 渲染審查 | 任何 HTML 頁面改動後把關 |

## 跨 agent workflow（由 main agent 統籌；subagent 不能自行開 subagent 或問使用者）

**整 simulator 流程**（觸發語例：「幫我整個 XX simulator」「照呢個 spec 起頁面」）：
1. 冇 spec 就先 spawn `physics-teacher` 出 experiment spec（教學目標、物理模型+公式、控件、視覺呈現、驗收標準）
2. spawn `html-specialist`（spec）→ 佢寫 code + Edge headless 自查到 console 零錯誤
3. **並行** spawn `physics-verifier` + `convention-reviewer`（單一 message 兩個 tool call）
4. 任一 verifier 報問題 → 用 SendMessage 將問題清單送返**同一個** html-specialist（保留 context）→ 修完自查 → 回到步驟 3。循環上限 3 輪，到上限就將未解決問題如實交使用者
5. 兩個 verifier 通過 → 總結交使用者查收

**學生痛點分析流程**（觸發語例：「睇下 Book X ChY 學生會唔明啲乜」「針對學生難點提議 simulator」）：
1. spawn `physics-student` 讀指定章節 → 輸出「唔明位清單」（概念+頁碼+學生嘅錯誤理解）
2. 將清單連章節交 `physics-teacher`（模式一變體）→ 出針對痛點嘅 simulator 提案
3. 整理畀使用者：難明概念排行 + FAQ/誤解庫條目（可餵 `keypoint-quiz-writer`）+ 提案清單
（Teacher 毋須解答 Student 嘅問題；冇問答循環）

**通用規則**：
- Teacher 回報「待釐清問題清單」→ main agent 用 AskUserQuestion 問使用者 → SendMessage 送答案返去
- Teacher 喺 prompt 設計模式（模式二a）唔准主動讀 textbook PDF；佢回報「申請閱讀 XX」時要先問使用者批准

## 特例頁面（改動前先了解其特殊性）

- `Simulator/book4/chapter1/parallel-plate-3D-sim.html` — 唯一使用 ES module + importmap 的頁面，保留不降級。
- `Simulator/book4/chapter2/series-parallel-connection-sim.html` — 內建 MNA（修正節點分析）電路引擎與自由式電路編輯器，邏輯複雜。
- `Simulator/book4/chapter6/DC-motor-3D-sim.html` — CSS 3D 實作（非 Three.js）。
- `Simulator/book3/chapter2/glassblock-prism-2D-sim.html` — SVG 實作。
