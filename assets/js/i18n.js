/* =====================================================================
 * PhysicsLab 多語系 — assets/js/i18n.js
 * =====================================================================
 * 檔案用途：
 *   輕量字典式多語系（繁中 zh / 英文 en / 偽語系 xx），提供：
 *     - data-i18n / data-i18n-html 屬性自動套用
 *     - t() 查詢（支援 {name} 參數內插；en 缺字自動回退 zh）
 *     - 語言切換按鈕自動接線（[data-i18n-toggle] 或自動注入 #lang-btn）
 *     - 舊「公式頁」span 雙語模式相容（body.en-mode 類別）
 *
 * 載入順序契約（重要）：
 *   core.js → 「i18n.js（本檔）」 → quiz.js → sim3d.js（或 canvas2d.js）。
 *   一般 <script> 標籤載入（不可 defer / async）。
 *   quiz.js / sim3d.js 依賴本檔的 PhysLab.i18n API。
 *
 * 相容性：
 *   傳統腳本（非 ES module；不使用 fetch / XHR），
 *   file:// 與 GitHub Pages 子路徑皆可運作；localStorage 全程 try/catch。
 *
 * 語言決定順序（載入時）：
 *   URL ?lang=zh|en|xx  >  localStorage 'physlab.lang'（僅 zh|en）  >  'zh'
 *   'xx' 為漏翻測試用偽語系：查詢行為同 zh，但 t() 回傳的所有字串
 *   （含陣列 / 物件內層字串，深層包裹、不改動原字典）都包成 ⟪字串⟫，
 *   方便肉眼找出未經 i18n 的寫死文字；xx 永不寫入 localStorage。
 *
 * 公開 API 摘要：
 *   PhysLab.i18n.lang             — 目前語言 'zh' | 'en' | 'xx'
 *   PhysLab.i18n.register(dicts)  — 註冊字典 {zh:{...}, en:{...}}（後註冊覆蓋同名 key）
 *   PhysLab.i18n.t(key, params)   — 查值：dict[lang][key] → dict.zh[key] → key；絕不拋錯
 *   PhysLab.i18n.setLang(lang)    — 切換語言並套用到整頁（含持久化與回呼）
 *   PhysLab.i18n.toggle()         — zh ↔ en
 *   PhysLab.i18n.onChange(fn)     — 註冊語言切換回呼（DOM 已套用後才呼叫）
 *   PhysLab.i18n.applyTo(root)    — 套用 [data-i18n] / [data-i18n-html]
 * ===================================================================== */

window.PhysLab = window.PhysLab || {};

(function () {
    'use strict';

    if (PhysLab.i18n) return; // 防止重複載入清空已註冊字典

    var STORAGE_KEY = 'physlab.lang';

    /**
     * 單一語言的字典：key → 字串 | 陣列 | 純物件
     * （測驗題庫、引導步驟等以陣列 / 物件整包註冊）。
     * @typedef {Object.<string, (string|Array|Object)>} I18nDict
     */

    /** @type {{zh: I18nDict, en: I18nDict}} 內部字典存放區 */
    var store = { zh: {}, en: {} };

    /** @type {Array.<function(string): void>} 語言切換回呼 */
    var callbacks = [];

    /** @type {HTMLElement|null} 語言切換按鈕（自動注入或頁面自備） */
    var toggleBtn = null;

    /* ==================================================================
     * 內建共用字典（頁面字典可覆蓋同名 key）
     * ================================================================== */

    /** @type {I18nDict} */
    var COMMON_ZH = {
        'nav.home': '主頁',
        'quiz.qPrefix': '第 {n} 題：',
        'quiz.correctPrefix': '✅ 正確！',
        'quiz.wrongPrefix': '❌ 再想想。',
        'guide.stepNo': '第 {n} / {total} 步',
        'common.rotateDevice': '請將裝置轉為橫向以獲得最佳體驗',
        'sim3d.loadError': '⚠️ 無法載入 3D 元件（three.js）<br>請檢查網路連線後重新整理頁面。'
    };

    /** @type {I18nDict} */
    var COMMON_EN = {
        'nav.home': 'Home',
        'quiz.qPrefix': 'Q{n}: ',
        'quiz.correctPrefix': '✅ Correct! ',
        'quiz.wrongPrefix': '❌ Not quite — ',
        'guide.stepNo': 'Step {n} of {total}',
        'common.rotateDevice': 'Please rotate your device to landscape for the best experience',
        'sim3d.loadError': '⚠️ Failed to load the 3D component (three.js).<br>Please check your network connection and refresh the page.'
    };

    /* ==================================================================
     * 內部工具
     * ================================================================== */

    /**
     * 安全的自有屬性檢查。
     * @param {Object} obj 目標物件
     * @param {string} key 屬性名
     * @returns {boolean} obj 是否自有 key
     */
    function has(obj, key) {
        return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
    }

    /**
     * 解析初始語言：URL ?lang= > localStorage > 'zh'。
     * @returns {'zh'|'en'|'xx'} 初始語言
     */
    function resolveLang() {
        var fromUrl = null;
        try {
            var m = /[?&]lang=([^&#]*)/.exec(window.location.search);
            if (m) fromUrl = decodeURIComponent(m[1]);
        } catch (e) { /* 忽略異常 URL */ }
        if (fromUrl === 'zh' || fromUrl === 'en' || fromUrl === 'xx') return fromUrl;

        try {
            var saved = window.localStorage.getItem(STORAGE_KEY);
            if (saved === 'zh' || saved === 'en') return saved;
        } catch (e) { /* localStorage 可能被停用（隱私模式 / file://） */ }

        return 'zh';
    }

    /**
     * 偽語系深層包裹：字串 → ⟪字串⟫；陣列 / 物件遞迴複製後逐層包裹
     * （回傳新副本，絕不改動內部字典）；其他型別原樣回傳。
     * @param {*} value 要包裹的值
     * @returns {*} 包裹後的新值
     */
    function xxWrap(value) {
        if (typeof value === 'string') return '⟪' + value + '⟫'; // ⟪ ⟫
        if (Array.isArray(value)) {
            var arr = [];
            for (var i = 0; i < value.length; i++) arr.push(xxWrap(value[i]));
            return arr;
        }
        if (value && typeof value === 'object') {
            var obj = {};
            for (var k in value) {
                if (Object.prototype.hasOwnProperty.call(value, k)) obj[k] = xxWrap(value[k]);
            }
            return obj;
        }
        return value;
    }

    /**
     * 字串參數內插：把 {name} 換成 String(params[name])；
     * 參數缺漏（undefined / null）時保留原樣的 {name} 標記。
     * @param {string} str 含 {name} 標記的字串
     * @param {Object.<string, *>} params 參數表
     * @returns {string} 內插後字串
     */
    function interpolate(str, params) {
        return str.replace(/\{(\w+)\}/g, function (token, name) {
            var v = params[name];
            return (v === undefined || v === null) ? token : String(v);
        });
    }

    /* ==================================================================
     * 公開 API
     * ================================================================== */

    /**
     * 註冊字典：Object.assign 合併進內部各語言存放區；
     * 後註冊者覆蓋同名 key。值可為字串、陣列或純物件
     * （測驗題庫 / 引導步驟整包註冊）。
     * @param {{zh: (I18nDict|undefined), en: (I18nDict|undefined)}} dicts 各語言字典
     * @returns {void}
     */
    function register(dicts) {
        if (!dicts) return;
        if (dicts.zh) Object.assign(store.zh, dicts.zh);
        if (dicts.en) Object.assign(store.en, dicts.en);
    }

    /**
     * 查詢翻譯值。查找順序：dict[目前語言][key] →（en 缺字）dict.zh[key] → key 本身。
     * 字串會做 {name} 參數內插（缺參數保留標記）；陣列 / 物件原樣回傳
     * （xx 模式除外：所有層級字串包成 ⟪…⟫ 的新副本）。絕不拋出例外。
     * @param {string} key 字典鍵
     * @param {Object.<string, *>} [params] 內插參數表
     * @returns {*} 翻譯值（字串 / 陣列 / 物件），查無時回傳 key 本身
     */
    function t(key, params) {
        try {
            if (typeof key !== 'string') return key;
            var lang = api.lang;
            var primary = (lang === 'xx') ? 'zh' : lang; // xx 表現同 zh
            var value;
            if (has(store[primary], key)) {
                value = store[primary][key];
            } else if (has(store.zh, key)) {
                value = store.zh[key]; // en 缺字回退 zh
            } else {
                value = key; // 完全查無 → 回傳 key 本身
            }
            if (typeof value === 'string' && params) {
                value = interpolate(value, params);
            }
            if (lang === 'xx') value = xxWrap(value);
            return value;
        } catch (e) {
            return key;
        }
    }

    /**
     * 把翻譯套用到 root 底下所有 [data-i18n]（textContent）、
     * [data-i18n-html]（innerHTML）與 [data-i18n-title]（title 屬性）節點。
     * zh 模式下若 key 查無（t 回傳 key 本身）則跳過，保留頁面原作內容；
     * 字典值不是字串的節點一律跳過。
     * @param {ParentNode} [root=document] 套用範圍
     * @returns {void}
     */
    function applyTo(root) {
        var scope = root || document;
        if (!scope.querySelectorAll) return;
        var i, node, key, val;

        var textNodes = scope.querySelectorAll('[data-i18n]');
        for (i = 0; i < textNodes.length; i++) {
            node = textNodes[i];
            key = node.getAttribute('data-i18n');
            val = t(key);
            if (typeof val !== 'string') continue;
            if (val === key && api.lang === 'zh') continue; // zh 缺字 → 保留原作內容
            node.textContent = val;
        }

        var htmlNodes = scope.querySelectorAll('[data-i18n-html]');
        for (i = 0; i < htmlNodes.length; i++) {
            node = htmlNodes[i];
            key = node.getAttribute('data-i18n-html');
            val = t(key);
            if (typeof val !== 'string') continue;
            if (val === key && api.lang === 'zh') continue;
            node.innerHTML = val;
        }

        var titleNodes = scope.querySelectorAll('[data-i18n-title]');
        for (i = 0; i < titleNodes.length; i++) {
            node = titleNodes[i];
            key = node.getAttribute('data-i18n-title');
            val = t(key);
            if (typeof val !== 'string') continue;
            if (val === key && api.lang === 'zh') continue;
            node.setAttribute('title', val);
        }
    }

    /**
     * 更新語言切換按鈕標籤（顯示「目標」語言）：
     * zh 模式 → 'EN'；en 模式 → '中文'；xx 模式 → 'XX'。
     * @returns {void}
     */
    function updateToggleLabel() {
        if (!toggleBtn) return;
        var label;
        if (api.lang === 'en') label = '中文';
        else if (api.lang === 'xx') label = 'XX';
        else label = 'EN';
        toggleBtn.textContent = label;
    }

    /**
     * 切換語言並套用到整頁：
     *   1) documentElement.lang = 'en' 或 'zh-Hant'
     *   2) body.classList.toggle('en-mode', 是否英文)  — 舊公式頁 span 雙語相容
     *   3) applyTo(document)
     *   4) zh / en 持久化到 localStorage（xx 不持久化）；更新切換按鈕標籤
     *   5) 逐一呼叫 onChange 回呼（各自 try/catch，互不影響）
     * @param {'zh'|'en'|'xx'} lang 目標語言（非法值一律視為 'zh'）
     * @returns {void}
     */
    function setLang(lang) {
        if (lang !== 'zh' && lang !== 'en' && lang !== 'xx') lang = 'zh';
        api.lang = lang;

        document.documentElement.lang = (lang === 'en') ? 'en' : 'zh-Hant';
        if (document.body) document.body.classList.toggle('en-mode', lang === 'en');
        applyTo(document);

        if (lang !== 'xx') {
            try {
                window.localStorage.setItem(STORAGE_KEY, lang);
            } catch (e) { /* 無法持久化時靜默 */ }
        }
        updateToggleLabel();

        for (var i = 0; i < callbacks.length; i++) {
            try {
                callbacks[i](lang);
            } catch (e) {
                console.error('[PhysLab.i18n] onChange 回呼發生錯誤：', e);
            }
        }
    }

    /**
     * 在 zh 與 en 之間切換（目前為 xx 時切到 en）。
     * @returns {void}
     */
    function toggle() {
        setLang(api.lang === 'en' ? 'zh' : 'en');
    }

    /**
     * 註冊語言切換回呼；於 setLang 完成 DOM 套用後呼叫，
     * 參數為新語言代碼。適合重建 canvas sprite 文字等。
     * @param {function(('zh'|'en'|'xx')): void} fn 回呼
     * @returns {void}
     */
    function onChange(fn) {
        if (typeof fn === 'function') callbacks.push(fn);
    }

    /** 公開 API 物件（PhysLab.i18n） */
    var api = {
        /** @type {'zh'|'en'|'xx'} 目前語言 */
        lang: resolveLang(),
        register: register,
        t: t,
        setLang: setLang,
        toggle: toggle,
        onChange: onChange,
        applyTo: applyTo
    };

    PhysLab.i18n = api;

    // 內建共用字典先註冊，頁面字典後註冊即可覆蓋同名 key
    register({ zh: COMMON_ZH, en: COMMON_EN });

    /* ==================================================================
     * DOMContentLoaded — 切換按鈕接線與初始語言套用
     * ================================================================== */

    document.addEventListener('DOMContentLoaded', function () {
        // (1) 切換按鈕：優先採用頁面自備的 [data-i18n-toggle]；
        //     否則若有 '#topbar .tb-actions'，自動注入 #lang-btn 作為第一個子元素。
        var custom = document.querySelector('[data-i18n-toggle]');
        if (custom) {
            toggleBtn = custom;
            toggleBtn.addEventListener('click', toggle);
        } else {
            var actions = document.querySelector('#topbar .tb-actions');
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'lang-btn';
            btn.addEventListener('click', toggle);
            if (actions) {
                btn.className = 'panel-toggle-btn';
                actions.insertBefore(btn, actions.firstChild);
                toggleBtn = btn;
            } else if (document.body && !document.body.hasAttribute('data-no-lang')) {
                // 無 topbar 的頁面（懸浮面板型）→ 右下角浮動切換鈕
                btn.className = 'pl-floating-lang';
                document.body.appendChild(btn);
                toggleBtn = btn;
            }
        }
        updateToggleLabel();

        // (2) 初始語言非 zh 時套用初始狀態（html lang / en-mode / applyTo）；
        //     不持久化、不觸發 onChange（頁面腳本屆時可能尚未註冊完成）。
        if (api.lang !== 'zh') {
            document.documentElement.lang = (api.lang === 'en') ? 'en' : 'zh-Hant';
            if (document.body) document.body.classList.toggle('en-mode', api.lang === 'en');
            applyTo(document);
        }
    });
})();
