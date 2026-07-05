/* ============================================================================
 * PhysLab — quiz.js（共用「概念測驗」與「逐步引導」引擎）
 * ----------------------------------------------------------------------------
 * 用途：
 *   取代各模擬器頁面複製貼上的 renderQuiz / answerQuiz / nextQuiz 與
 *   initGuide / renderGuide / guideStep。輸出之 DOM 結構、class 與可見文字
 *   （.quiz-opt、.correct、.wrong、「第 n 題：」「第 n / m 步」、✅/❌ 回饋）
 *   與原各頁實作完全一致；題庫與步驟文字可經 i18n 鍵解析，語言切換時
 *   自動重新渲染。
 *
 * 載入順序（classic script，非 ES module）：
 *   core.js → i18n.js → quiz.js →（sim3d.js 或 canvas2d.js）
 *
 * API 摘要：
 *   PhysLab.quiz.init(opts)   初始化測驗 { bankKey?|bank?, els?, shuffle? }
 *   PhysLab.quiz.answer(i)    作答第 i 個選項（選項點擊時自動呼叫）
 *   PhysLab.quiz.next()       下一題（循環）；window.nextQuiz 為相容墊片，
 *                             供既有 <button onclick="nextQuiz()"> 標記使用
 *   PhysLab.guide.init(opts)  初始化逐步引導 { stepsKey?|steps?, els?, onStep? }
 *   PhysLab.guide.go(delta)   前進／後退 delta 步（雙向循環）
 *
 * 相依 API（由 core.js / i18n.js 提供）：
 *   PhysLab.ui.el(id)、PhysLab.ui.setText(id, text)
 *   PhysLab.i18n.t(key, params?)、PhysLab.i18n.onChange(fn)
 *   內建字串鍵：'quiz.qPrefix'（'第 {n} 題：'）、'quiz.correctPrefix'、
 *               'quiz.wrongPrefix'、'guide.stepNo'（'第 {n} / {total} 步'）
 * ========================================================================== */

window.PhysLab = window.PhysLab || {};

/**
 * 測驗題目資料。
 * @typedef {{q:string, opts:string[], ans:number, exp:string}} QuizItem
 * @property {string}   q    題目 HTML（可含 <b>、HTML 實體等）
 * @property {string[]} opts 選項 HTML 陣列
 * @property {number}   ans  正確選項索引（0 起算）
 * @property {string}   exp  解說 HTML（接在回饋前綴之後顯示）
 */

/* ────────────────────────────────────────────────────────────
 * PhysLab.quiz — 概念測驗
 * ──────────────────────────────────────────────────────────── */
PhysLab.quiz = (function () {
    'use strict';

    /** 預設元素 id（對應 Lab Gray 版面標記）。 */
    var DEFAULT_ELS = { q: 'quiz-q', options: 'quiz-options', feedback: 'quiz-feedback', next: 'quiz-next' };

    var cfg = null;          // init() 傳入之設定
    var els = DEFAULT_ELS;   // 元素 id 對照表
    var idx = 0;             // 目前題號（0 起算）
    var answered = false;    // 已作答旗標（原版 answered / quizLock 的鎖定機制）
    var order = null;        // shuffle 模式下的題序索引
    var subscribed = false;  // 是否已訂閱 i18n.onChange

    /**
     * 解析題庫（每次渲染時重新解析：bankKey 優先，隨語言即時更新）。
     * @returns {QuizItem[]} 目前語言的題庫
     */
    function resolveBank() {
        return cfg.bankKey ? PhysLab.i18n.t(cfg.bankKey) : cfg.bank;
    }

    /**
     * 取得目前題目；shuffle 模式下維護（必要時重建）洗牌題序。
     * @param {QuizItem[]} bank 題庫
     * @returns {QuizItem} 目前題目
     */
    function currentItem(bank) {
        var i0 = idx % bank.length;
        if (cfg.shuffle) {
            if (!order || order.length !== bank.length) {
                order = [];
                for (var i = 0; i < bank.length; i++) order.push(i);
                for (var j = order.length - 1; j > 0; j--) {
                    var k = Math.floor(Math.random() * (j + 1));
                    var tmp = order[j]; order[j] = order[k]; order[k] = tmp;
                }
            }
            return bank[order[i0]];
        }
        return bank[i0];
    }

    /**
     * 渲染目前題目：題號前綴 + 題目（innerHTML）、選項 <div class="quiz-opt">、
     * 清空回饋（textContent = ''）、隱藏下一題按鈕（display:'none'）——
     * 與原版 renderQuiz 逐項對應；同時重設作答鎖定旗標。
     * 選項附 role="button" + tabindex + Enter/Space 鍵盤處理
     * （部分舊頁原以 <button> 實作，統一 <div> 後補回鍵盤可達性）。
     */
    function render() {
        answered = false;
        var bank = resolveBank();
        var item = currentItem(bank);
        PhysLab.ui.el(els.q).innerHTML =
            PhysLab.i18n.t('quiz.qPrefix', { n: (idx % bank.length) + 1 }) + item.q;
        var box = PhysLab.ui.el(els.options);
        box.innerHTML = '';
        item.opts.forEach(function (opt, i) {
            var d = document.createElement('div');
            d.className = 'quiz-opt';
            d.innerHTML = opt;
            d.setAttribute('role', 'button');
            d.setAttribute('tabindex', '0');
            d.onclick = function () { answer(i); };
            d.onkeydown = function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); answer(i); }
            };
            box.appendChild(d);
        });
        PhysLab.ui.el(els.feedback).textContent = '';
        PhysLab.ui.el(els.next).style.display = 'none';
    }

    /**
     * 作答第 i 個選項（原版 answerQuiz 語意）：
     * 以旗標鎖定重複點擊；答錯→選中項加 'wrong' 且正解項加 'correct'，
     * 答對→選中項加 'correct'；回饋 = t('quiz.correctPrefix'|'quiz.wrongPrefix') + exp；
     * 顯示下一題按鈕（display:'block'）。
     * @param {number} i 選項索引（0 起算）
     */
    function answer(i) {
        if (answered) return;
        answered = true;
        var bank = resolveBank();
        var item = currentItem(bank);
        var opts = PhysLab.ui.el(els.options).children;
        var correct = (i === item.ans);
        if (correct) {
            opts[i].classList.add('correct');
        } else {
            opts[i].classList.add('wrong');
            opts[item.ans].classList.add('correct');
        }
        // 標準欄位為 exp；容忍尚未搬遷的舊題庫 fb 欄位（AC-DC 版）
        var exp = (item.exp != null) ? item.exp : (item.fb != null ? item.fb : '');
        PhysLab.ui.el(els.feedback).innerHTML =
            (correct ? PhysLab.i18n.t('quiz.correctPrefix') : PhysLab.i18n.t('quiz.wrongPrefix')) + exp;
        PhysLab.ui.el(els.next).style.display = 'block';
    }

    /**
     * 下一題：題號循環遞增（(idx+1) % 題庫長度）並重新渲染
     * （渲染即清空回饋、隱藏下一題按鈕、解除鎖定）。
     */
    function next() {
        if (!cfg) return;
        var bank = resolveBank();
        idx = (idx + 1) % bank.length;
        render();
    }

    /**
     * 初始化測驗並渲染第 1 題。
     * @param {Object}   opts               設定
     * @param {string}   [opts.bankKey]     i18n 題庫鍵（優先；每次渲染重新解析）
     * @param {QuizItem[]} [opts.bank]      直接提供題庫（無 bankKey 時使用）
     * @param {{q?:string,options?:string,feedback?:string,next?:string}} [opts.els]
     *        自訂元素 id；預設 'quiz-q' / 'quiz-options' / 'quiz-feedback' / 'quiz-next'
     * @param {boolean}  [opts.shuffle=false] 是否洗牌題目順序（不洗選項）
     */
    function init(opts) {
        cfg = opts || {};
        els = {
            q: (cfg.els && cfg.els.q) || DEFAULT_ELS.q,
            options: (cfg.els && cfg.els.options) || DEFAULT_ELS.options,
            feedback: (cfg.els && cfg.els.feedback) || DEFAULT_ELS.feedback,
            next: (cfg.els && cfg.els.next) || DEFAULT_ELS.next
        };
        idx = 0;
        order = null;
        if (!subscribed) {
            // 語言切換 → 以新語言重渲染目前題目（作答狀態一併重設）
            PhysLab.i18n.onChange(function () { if (cfg) render(); });
            subscribed = true;
        }
        render();
    }

    return { init: init, answer: answer, next: next };
})();

/**
 * 相容墊片：沿用原頁 <button id="quiz-next" onclick="nextQuiz()"> 標記。
 * @returns {void}
 */
window.nextQuiz = function () { PhysLab.quiz.next(); };

/* ────────────────────────────────────────────────────────────
 * PhysLab.guide — 逐步引導（stepper）
 * ──────────────────────────────────────────────────────────── */
PhysLab.guide = (function () {
    'use strict';

    /** 預設元素 id（對應 Lab Gray 版面標記）。 */
    var DEFAULT_ELS = { text: 'guide-text', stepNo: 'guide-step-no' };

    var cfg = null;          // init() 傳入之設定
    var els = DEFAULT_ELS;   // 元素 id 對照表
    var idx = 0;             // 目前步驟（0 起算）
    var subscribed = false;  // 是否已訂閱 i18n.onChange

    /**
     * 解析步驟文字（每次渲染時重新解析：stepsKey 優先，隨語言即時更新）。
     * @returns {string[]} 目前語言的步驟 HTML 陣列
     */
    function resolveSteps() {
        return cfg.stepsKey ? PhysLab.i18n.t(cfg.stepsKey) : cfg.steps;
    }

    /**
     * 渲染目前步驟：els.text.innerHTML = 步驟 HTML；
     * els.stepNo.textContent = t('guide.stepNo', {n, total})（即「第 n / m 步」，
     * 與原版 renderGuide 的組字方式一致）。
     */
    function render() {
        var steps = resolveSteps();
        var i0 = idx % steps.length;
        PhysLab.ui.el(els.text).innerHTML = steps[i0];
        PhysLab.ui.setText(els.stepNo,
            PhysLab.i18n.t('guide.stepNo', { n: i0 + 1, total: steps.length }));
    }

    /**
     * 前進／後退 delta 步；步序雙向循環（(idx+delta+len) % len，
     * 同原版 guideStep）。渲染完成後呼叫 opts.onStep(idx)。
     * @param {number} delta 位移量（例：+1 下一步、-1 上一步）
     */
    function go(delta) {
        if (!cfg) return;
        var steps = resolveSteps();
        idx = (idx + delta + steps.length) % steps.length;
        render();
        if (cfg.onStep) cfg.onStep(idx);
    }

    /**
     * 初始化逐步引導並渲染第 1 步（初始化僅渲染，不呼叫 onStep，
     * 同原版 initGuide 語意）。
     * @param {Object}   opts                 設定
     * @param {string}   [opts.stepsKey]      i18n 步驟鍵（優先；每次渲染重新解析）
     * @param {string[]} [opts.steps]         直接提供步驟 HTML 陣列
     * @param {{text?:string,stepNo?:string}} [opts.els]
     *        自訂元素 id；預設 'guide-text' / 'guide-step-no'
     * @param {function(number):void} [opts.onStep] 每次 go() 換步後的回呼（傳入新步序）
     */
    function init(opts) {
        cfg = opts || {};
        els = {
            text: (cfg.els && cfg.els.text) || DEFAULT_ELS.text,
            stepNo: (cfg.els && cfg.els.stepNo) || DEFAULT_ELS.stepNo
        };
        idx = 0;
        if (!subscribed) {
            // 語言切換 → 以新語言重渲染目前步驟
            PhysLab.i18n.onChange(function () { if (cfg) render(); });
            subscribed = true;
        }
        render();
    }

    return { init: init, go: go };
})();
