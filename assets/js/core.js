/* =====================================================================
 * PhysicsLab 共用核心 — assets/js/core.js
 * =====================================================================
 * 檔案用途：
 *   全站唯一全域命名空間 window.PhysLab 的建立點，並提供：
 *     - PhysLab.root：專案根目錄的絕對 URL 前綴（由本檔 <script src> 推算）
 *     - PhysLab.ui  ：共用 UI 小工具（DOM 快捷、滑桿 / 長按步進 / 面板
 *                     開關綁定、全螢幕遮罩、橫向提示、主頁按鈕注入、
 *                     卡片收合事件委派）
 *
 * 載入順序契約（重要）：
 *   1. core.js  ← 必須「最先」載入，且必須用一般 <script> 標籤
 *                 （不可 defer / async — 本檔依賴 document.currentScript）
 *   2. i18n.js
 *   3. quiz.js
 *   4. sim3d.js 或 canvas2d.js
 *
 * 相容性：
 *   傳統腳本（非 ES module；不使用 fetch / XHR）。
 *   以 file:// 直接開啟與部署到 GitHub Pages 子路徑皆可運作。
 *
 * 公開 API 摘要：
 *   PhysLab.root                                — 根目錄絕對 URL 前綴（含尾斜線）
 *   PhysLab.ui.el(id)                           — getElementById 快捷
 *   PhysLab.ui.setText(id, text)                — 設定 textContent（缺元素時靜默）
 *   PhysLab.ui.clamp(v, a, b)                   — 把數值夾在 [a, b] 內
 *   PhysLab.ui.injectHome(mode)                 — 注入「🏠 主頁」按鈕（冪等）
 *   PhysLab.ui.bindSlider(sliderId, valueId, onInput)     — 綁定滑桿與數值顯示
 *   PhysLab.ui.bindSteppers(root)               — 綁定 .step-btn 長按步進按鈕
 *   PhysLab.ui.bindPanelToggle(btnId, panelId, onChange)  — 面板顯示切換
 *   PhysLab.ui.showBlocker(html) / hideBlocker()          — 全螢幕遮罩
 *   PhysLab.ui.orientationGuard(minWidth)       — 窄螢幕直向時顯示轉向提示
 *
 * DOMContentLoaded 自動行為：
 *   (1) .card-header 點擊收合卡片（事件委派）
 *   (2) PhysLab.ui.injectHome('auto')
 *
 * 過渡用全域函式（凍結清單 — 過渡用勿新增；舊頁遷移完成後移除）：
 *   window.setText / window.toggleCard / window.guideStep / window.nextQuiz
 * ===================================================================== */

window.PhysLab = window.PhysLab || {};

(function () {
    'use strict';

    /* ==================================================================
     * PhysLab.root — 專案根目錄推算
     * ------------------------------------------------------------------
     * 由 core.js 自身的 <script src> 絕對 URL 減去 "assets/js/core.js"
     * 得到根目錄前綴，例如：
     *   https://user.github.io/PhysicsLab/assets/js/core.js
     *     → "https://user.github.io/PhysicsLab/"
     *   file:///C:/Users/xxx/Desktop/PhysicsLab/assets/js/core.js
     *     → "file:///C:/Users/xxx/Desktop/PhysicsLab/"
     * URL 編碼字元（如空格的 %20）原樣保留 — 它只作字串前綴使用。
     * ================================================================== */

    var ROOT_MARKER = 'assets/js/core.js';

    var scriptSrc = (document.currentScript && document.currentScript.src) || '';
    if (!scriptSrc) {
        // 後備：currentScript 不可用時（例如被動態插入），掃描既有 <script> 標籤。
        var scriptTags = document.getElementsByTagName('script');
        for (var si = scriptTags.length - 1; si >= 0; si--) {
            if (scriptTags[si].src && scriptTags[si].src.lastIndexOf(ROOT_MARKER) !== -1) {
                scriptSrc = scriptTags[si].src;
                break;
            }
        }
    }

    var markerAt = scriptSrc.lastIndexOf(ROOT_MARKER);

    /**
     * 專案根目錄的絕對 URL 前綴（含結尾斜線）；推算失敗時為空字串。
     * @type {string}
     */
    PhysLab.root = markerAt >= 0 ? scriptSrc.slice(0, markerAt) : '';

    if (!PhysLab.root) {
        console.warn('[PhysLab] 無法由 core.js 的 <script src> 推算專案根目錄；' +
            '請確認 core.js 以一般 <script> 標籤（非 defer/async）載入，' +
            '且路徑以 assets/js/core.js 結尾。主頁按鈕連結可能不正確。');
    }

    /* ==================================================================
     * PhysLab.ui — 共用 UI 小工具
     * ================================================================== */

    /**
     * document.getElementById 快捷。
     * @param {string} id 元素 id
     * @returns {HTMLElement|null} 對應元素；不存在時回傳 null
     */
    function el(id) {
        return document.getElementById(id);
    }

    /**
     * 設定指定元素的 textContent；元素不存在時靜默略過。
     * @param {string} id 元素 id
     * @param {string|number} text 要顯示的文字
     * @returns {void}
     */
    function setText(id, text) {
        var node = document.getElementById(id);
        if (node) node.textContent = text;
    }

    /**
     * 把數值夾在 [a, b] 範圍內。
     * @param {number} v 輸入值
     * @param {number} a 下限
     * @param {number} b 上限
     * @returns {number} 夾住後的值
     */
    function clamp(v, a, b) {
        return Math.min(b, Math.max(a, v));
    }

    /**
     * 注入「🏠 主頁」按鈕（連往 PhysLab.root + 'index.html'）。
     * 冪等：頁面已有 #home-btn 時不做任何事；
     * 若 <body data-no-home> 存在則完全略過。
     * @param {'topbar'|'floating'|'auto'} [mode='auto']
     *   'topbar'   — 附加到 '#topbar .tb-actions'（容器不存在則退回 floating）
     *   'floating' — 以 class="pl-floating" 附加到 <body>
     *   'auto'     — 頁面有 #topbar 用 topbar，否則 floating
     * @returns {void}
     */
    function injectHome(mode) {
        if (document.getElementById('home-btn')) return;
        if (document.body && document.body.hasAttribute('data-no-home')) return;

        var m = mode || 'auto';
        if (m === 'auto') {
            m = document.getElementById('topbar') ? 'topbar' : 'floating';
        }

        var actions = document.querySelector('#topbar .tb-actions');
        if (m === 'topbar' && !actions) m = 'floating';

        var a = document.createElement('a');
        a.id = 'home-btn';
        a.href = PhysLab.root + 'index.html';
        // 整個標籤包成單一 flex item：emoji 與文字之間用普通空格，
        // 避免被 #home-btn 的 flex gap 撐開（標準頁像素保真要求）
        a.innerHTML = '<span>🏠 <span data-i18n="nav.home">主頁</span></span>';

        if (m === 'topbar') {
            actions.appendChild(a);
        } else {
            a.className = 'pl-floating';
            document.body.appendChild(a);
        }
    }

    /**
     * 綁定滑桿與其數值顯示元素。
     * 於 'input' 事件呼叫 onInput(parseFloat(slider.value))：
     *   - 回傳字串 → 寫入數值元素的 textContent
     *   - 回傳 undefined → 不動數值元素（由呼叫端自行更新顯示）
     * 綁定後立即觸發一次以同步初始顯示。
     * @param {string} sliderId 滑桿（input[type=range]）的 id
     * @param {string} valueId 數值顯示元素的 id
     * @param {function(number): (string|undefined)} onInput 數值處理回呼
     * @returns {HTMLInputElement|null} 滑桿元素；任一 id 找不到時回傳 null 並 console.warn
     */
    function bindSlider(sliderId, valueId, onInput) {
        var slider = document.getElementById(sliderId);
        var valueEl = document.getElementById(valueId);
        if (!slider || !valueEl) {
            console.warn('[PhysLab.ui.bindSlider] 找不到元素：#' + sliderId + ' / #' + valueId);
            return null;
        }
        var fn = (typeof onInput === 'function') ? onInput : function (v) { return String(v); };

        function handle() {
            var out = fn(parseFloat(slider.value));
            if (out !== undefined) valueEl.textContent = out;
        }

        slider.addEventListener('input', handle);
        handle();
        return slider;
    }

    /* ---- 長按步進（.step-btn）---------------------------------------- */

    var STEP_HOLD_DELAY = 350;    // 按住多久後開始自動重複 (ms)
    var STEP_REPEAT_START = 120;  // 自動重複的起始間隔 (ms)
    var STEP_REPEAT_FLOOR = 60;   // 自動重複的最快間隔 (ms)
    var STEP_REPEAT_ACCEL = 10;   // 每次重複縮短多少間隔 (ms)

    /**
     * 取得數字字串的小數位數（用來修正浮點累加誤差）。
     * @param {string|number} numLike 例如 '0.02' → 2
     * @returns {number} 小數位數
     */
    function decimalsOf(numLike) {
        var s = String(numLike);
        var dot = s.indexOf('.');
        return dot < 0 ? 0 : s.length - dot - 1;
    }

    /**
     * 把目標輸入元素依 step * dir 推一格（尊重 min / max），
     * 並派發 bubbling 的 'input' 事件讓既有監聽器更新。
     * @param {HTMLInputElement} input 目標輸入元素（range / number）
     * @param {number} dir 方向（+1 / -1；可為任意倍率）
     * @returns {void}
     */
    function nudgeInput(input, dir) {
        var step = parseFloat(input.step);
        if (isNaN(step) || step <= 0) step = 1; // step 未設或 "any" 時視為 1
        var val = parseFloat(input.value);
        if (isNaN(val)) val = 0;
        val += step * dir;
        var min = parseFloat(input.min);
        var max = parseFloat(input.max);
        if (!isNaN(min)) val = Math.max(min, val);
        if (!isNaN(max)) val = Math.min(max, val);
        input.value = val.toFixed(decimalsOf(input.step !== '' ? input.step : step));
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /**
     * 綁定 root 底下所有 .step-btn[data-target][data-dir] 步進按鈕：
     *   - 單擊：目標輸入元素依 step * data-dir 推一格
     *   - 按住（mousedown / touchstart）350ms 後自動重複，
     *     間隔由 120ms 逐次加速至 60ms 下限
     *   - mouseup / mouseleave / touchend / touchcancel 取消重複
     * 以 data-pl-stepper 旗標防止重複綁定，可於動態插入按鈕後安全重呼。
     * @param {ParentNode} [root=document] 掃描範圍
     * @returns {void}
     */
    function bindSteppers(root) {
        var scope = root || document;
        var btns = scope.querySelectorAll('.step-btn[data-target][data-dir]');
        Array.prototype.forEach.call(btns, function (btn) {
            if (btn.getAttribute('data-pl-stepper')) return; // 已綁定過
            btn.setAttribute('data-pl-stepper', '1');

            var holdTimer = 0;
            var repeatTimer = 0;
            var delay = STEP_REPEAT_START;

            function fire() {
                var target = document.getElementById(btn.getAttribute('data-target'));
                var dir = parseFloat(btn.getAttribute('data-dir'));
                if (!target || isNaN(dir)) return;
                nudgeInput(target, dir);
            }

            function repeat() {
                fire();
                delay = Math.max(STEP_REPEAT_FLOOR, delay - STEP_REPEAT_ACCEL);
                repeatTimer = window.setTimeout(repeat, delay);
            }

            function press(ev) {
                ev.preventDefault(); // 阻止選字與 touch 之後的幽靈 mousedown
                cancel();
                fire();
                delay = STEP_REPEAT_START;
                holdTimer = window.setTimeout(repeat, STEP_HOLD_DELAY);
            }

            function cancel() {
                window.clearTimeout(holdTimer);
                window.clearTimeout(repeatTimer);
            }

            btn.addEventListener('mousedown', press);
            btn.addEventListener('touchstart', press, { passive: false });
            btn.addEventListener('mouseup', cancel);
            btn.addEventListener('mouseleave', cancel);
            btn.addEventListener('touchend', cancel);
            btn.addEventListener('touchcancel', cancel);
        });
    }

    /**
     * 綁定面板開關按鈕：點擊時切換面板的 .panel-hidden 與按鈕的 .inactive，
     * 然後呼叫 onChange()（如提供，常用於重算 canvas 尺寸）。
     * @param {string} btnId 開關按鈕的 id
     * @param {string} panelId 面板元素的 id
     * @param {function(): void} [onChange] 切換後回呼
     * @returns {function(): void} 切換函式（可供頁面程式直接呼叫）
     */
    function bindPanelToggle(btnId, panelId, onChange) {
        var btn = document.getElementById(btnId);
        var panel = document.getElementById(panelId);
        if (!btn || !panel) {
            console.warn('[PhysLab.ui.bindPanelToggle] 找不到元素：#' + btnId + ' / #' + panelId);
        }

        function toggle() {
            if (panel) panel.classList.toggle('panel-hidden');
            if (btn) btn.classList.toggle('inactive');
            if (typeof onChange === 'function') onChange();
        }

        if (btn) btn.addEventListener('click', toggle);
        return toggle;
    }

    /* ---- 全螢幕遮罩 --------------------------------------------------- */

    /**
     * 顯示全螢幕遮罩 #pl-blocker（首次呼叫時建立並附加到 <body>），
     * 設定其 innerHTML 後顯示。
     * @param {string} html 遮罩內容（HTML 字串）
     * @returns {void}
     */
    function showBlocker(html) {
        var blocker = document.getElementById('pl-blocker');
        if (!blocker) {
            blocker = document.createElement('div');
            blocker.id = 'pl-blocker';
            blocker.style.cssText = 'position:fixed;inset:0;z-index:99998;display:flex;' +
                'align-items:center;justify-content:center;text-align:center;padding:24px;' +
                'background:rgba(15,23,42,0.96);color:#fff;' +
                'font-family:system-ui,sans-serif;font-size:18px;line-height:1.7';
            document.body.appendChild(blocker);
        }
        blocker.innerHTML = html;
        blocker.style.display = 'flex';
    }

    /**
     * 隱藏全螢幕遮罩 #pl-blocker（不存在時靜默）。
     * @returns {void}
     */
    function hideBlocker() {
        var blocker = document.getElementById('pl-blocker');
        if (blocker) blocker.style.display = 'none';
    }

    /* ---- 橫向提示 ------------------------------------------------------ */

    var guardInstalled = false;  // 是否已掛上事件監聽
    var guardShown = false;      // 目前遮罩是否由本 guard 顯示（避免蓋掉頁面自己的遮罩）
    var guardMinWidth = 520;

    /**
     * 檢查目前視窗是否過窄且為直向；是則顯示轉向提示，否則收回
     * （只收回由本 guard 顯示的遮罩）。
     * @returns {void}
     */
    function checkOrientation() {
        var portrait = window.matchMedia ?
            window.matchMedia('(orientation: portrait)').matches : false;
        if (window.innerWidth < guardMinWidth && portrait) {
            var msg = (PhysLab.i18n && typeof PhysLab.i18n.t === 'function') ?
                PhysLab.i18n.t('common.rotateDevice') :
                '請將裝置轉為橫向以獲得最佳體驗';
            showBlocker(msg);
            guardShown = true;
        } else if (guardShown) {
            hideBlocker();
            guardShown = false;
        }
    }

    /**
     * 啟用橫向提示：在 load / resize / orientationchange 時檢查，
     * 視窗寬度 < minWidth 且為直向（portrait）→ 顯示
     * 'common.rotateDevice' 轉向提示遮罩；條件解除時自動收回。
     * 可重複呼叫（只會掛一次監聽；minWidth 以最後一次為準）。
     * @param {number} [minWidth=520] 觸發提示的視窗寬度下限 (px)
     * @returns {void}
     */
    function orientationGuard(minWidth) {
        if (typeof minWidth === 'number' && minWidth > 0) guardMinWidth = minWidth;
        if (!guardInstalled) {
            guardInstalled = true;
            window.addEventListener('load', checkOrientation);
            window.addEventListener('resize', checkOrientation);
            window.addEventListener('orientationchange', checkOrientation);
        }
        checkOrientation();
    }

    /* ---- 公開 API ------------------------------------------------------ */

    PhysLab.ui = {
        el: el,
        setText: setText,
        clamp: clamp,
        injectHome: injectHome,
        bindSlider: bindSlider,
        bindSteppers: bindSteppers,
        bindPanelToggle: bindPanelToggle,
        showBlocker: showBlocker,
        hideBlocker: hideBlocker,
        orientationGuard: orientationGuard
    };

    /* ==================================================================
     * DOMContentLoaded 自動行為
     * ================================================================== */

    document.addEventListener('DOMContentLoaded', function () {
        // (1) 卡片收合 — 事件委派：點擊 .card-header 切換最近 .card 的 collapsed。
        //     點擊目標位於 button / input / select / a 內時不觸發；
        //     過渡期相容：標題若仍掛著舊式 inline onclick（toggleCard shim），
        //     則交由 shim 處理，避免同一下點擊切換兩次而互相抵銷。
        document.addEventListener('click', function (ev) {
            var t = ev.target;
            if (!t || !t.closest) return;
            if (t.closest('button, input, select, a')) return;
            var header = t.closest('.card-header');
            if (!header || header.hasAttribute('onclick')) return;
            var card = header.closest('.card');
            if (card) card.classList.toggle('collapsed');
        });

        // (2) 自動注入主頁按鈕
        injectHome('auto');
    });

    /* ==================================================================
     * 過渡用全域函式（凍結清單 — 過渡用勿新增！）
     * 僅供尚未完成遷移的舊頁 inline onclick 使用；全部遷移後刪除本區。
     * ================================================================== */

    /**
     * （過渡用）同 PhysLab.ui.setText。
     * @type {function(string, (string|number)): void}
     */
    window.setText = setText;

    /**
     * （過渡用）卡片收合 — 相容舊頁 onclick="toggleCard(this)"。
     * @param {Element} headerEl 卡片標題（或其內部）元素
     * @returns {void}
     */
    window.toggleCard = function (headerEl) {
        var card = (headerEl && headerEl.closest) ? headerEl.closest('.card') : null;
        if (card) card.classList.toggle('collapsed');
    };

    /**
     * （過渡用）逐步引導換頁 — 相容舊頁 onclick="guideStep(-1)"。
     * @param {number} d 步進方向（+1 / -1）
     * @returns {void}
     */
    window.guideStep = function (d) {
        if (PhysLab.guide) PhysLab.guide.go(d);
    };

    /**
     * （過渡用）下一題 — 相容舊頁 onclick="nextQuiz()"。
     * @returns {void}
     */
    window.nextQuiz = function () {
        if (PhysLab.quiz) PhysLab.quiz.next();
    };
})();
