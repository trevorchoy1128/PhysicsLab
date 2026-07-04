/* ============================================================================
 * PhysLab — canvas2d.js（2D Canvas 模擬器共用工具）
 * ----------------------------------------------------------------------------
 * 用途：
 *   取代各 2D 模擬器頁面複製貼上的 HiDPI（devicePixelRatio）背景緩衝設定、
 *   指標座標換算與箭頭／網格／虛線繪製小工具。setup() 之後所有繪圖座標
 *   一律為「CSS 像素」（ctx 已以 setTransform(dpr,0,0,dpr,0,0) 換算），
 *   pointerPos() 亦回傳 CSS 像素座標，兩者可直接互用。
 *
 * 載入順序（classic script，非 ES module）：
 *   core.js → i18n.js → quiz.js → canvas2d.js
 *
 * API 摘要：
 *   PhysLab.c2d.setup(canvas, opts?) → view {canvas, ctx, w, h, dpr, resize()}
 *   PhysLab.c2d.pointerPos(canvas, evt) → {x, y}（CSS 像素；支援觸控）
 *   PhysLab.c2d.drawArrow(ctx, x1, y1, x2, y2, opts?)  直線 + 實心三角箭頭
 *   PhysLab.c2d.drawGrid(ctx, w, h, opts?)             背景格線（可強調座標軸）
 *   PhysLab.c2d.withDash(ctx, dash, fn)                套用虛線執行 fn 後還原
 * ========================================================================== */

window.PhysLab = window.PhysLab || {};

PhysLab.c2d = (function () {
    'use strict';

    /**
     * 初始化 HiDPI 畫布（對應原頁 update() 開頭的 DPR 樣板）：
     * dpr = Math.min(window.devicePixelRatio || 1, 2)（上限 2，與 3D 渲染器
     * setPixelRatio 一致；原 2D 頁未設上限），背景緩衝 = getBoundingClientRect
     * × dpr（尺寸相同時不重設，沿原版「僅在改變時 resize」），
     * ctx.setTransform(dpr, 0, 0, dpr, 0, 0) 使繪圖座標為 CSS 像素。
     * view.w / view.h 為 CSS 像素尺寸，resize() 時刷新。
     * @param {HTMLCanvasElement} canvas 目標畫布
     * @param {Object}  [opts]                 設定
     * @param {boolean} [opts.autoResize=true] 監聽 window resize 與
     *        ResizeObserver(canvas)，自動呼叫 resize()
     * @param {function(Object):void} [opts.onResize] 自動 resize 後回呼（傳入 view；
     *        頁面通常在此重繪）
     * @returns {{canvas:HTMLCanvasElement, ctx:CanvasRenderingContext2D,
     *            w:number, h:number, dpr:number, resize:function():void}} view
     */
    function setup(canvas, opts) {
        var o = opts || {};
        var ctx = canvas.getContext('2d');

        var view = {
            canvas: canvas,
            ctx: ctx,
            w: 0,
            h: 0,
            dpr: 1,
            resize: resize
        };

        /**
         * 依 CSS 尺寸重建背景緩衝（僅在尺寸改變時），並重設 dpr 變換。
         */
        function resize() {
            var rect = canvas.getBoundingClientRect();
            var dpr = Math.min(window.devicePixelRatio || 1, 2);
            var bw = Math.round(rect.width * dpr), bh = Math.round(rect.height * dpr);
            if (canvas.width !== bw || canvas.height !== bh) {
                canvas.width = bw;
                canvas.height = bh;
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            view.dpr = dpr;
            view.w = rect.width;
            view.h = rect.height;
        }

        resize();

        if (o.autoResize !== false) {
            var onAuto = function () {
                resize();
                if (o.onResize) o.onResize(view);
            };
            window.addEventListener('resize', onAuto);
            if (window.ResizeObserver) new ResizeObserver(onAuto).observe(canvas);
        }

        return view;
    }

    /**
     * 取得滑鼠／觸控事件在畫布上的座標，回傳「CSS 像素」：
     * {x: clientX - rect.left, y: clientY - rect.top}。
     * 觸控事件依 evt.touches[0] || evt.changedTouches[0] || evt 取點。
     * 注意：原頁以 (logicalWidth / rect.width) 換算至固定邏輯座標；改用
     * setup() 後繪圖空間即 CSS 像素（換算係數為 1），故此處直接回傳
     * CSS 像素，可與 setup() 的繪圖座標直接互用。
     * @param {HTMLCanvasElement} canvas 目標畫布
     * @param {MouseEvent|TouchEvent|PointerEvent} evt 指標事件
     * @returns {{x:number, y:number}} CSS 像素座標
     */
    function pointerPos(canvas, evt) {
        var rect = canvas.getBoundingClientRect();
        var p = (evt.touches && evt.touches[0]) || (evt.changedTouches && evt.changedTouches[0]) || evt;
        return { x: p.clientX - rect.left, y: p.clientY - rect.top };
    }

    /**
     * 繪製單一箭頭尖（basic-refraction 版三角形：(0,0)、(-size, ±size/2.5)，
     * translate/rotate 後填滿）。
     * @param {CanvasRenderingContext2D} ctx 2D 繪圖環境
     * @param {number}  x      箭尖 x
     * @param {number}  y      箭尖 y
     * @param {number}  ang    箭頭朝向（弧度）
     * @param {number}  size   箭頭尖長度
     * @param {boolean} filled true 填滿（原版）；false 只描邊
     */
    function drawHead(ctx, x, y, ang, size, filled) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-size, size / 2.5);
        ctx.lineTo(-size, -size / 2.5);
        ctx.closePath();
        if (filled) ctx.fill(); else ctx.stroke();
        ctx.restore();
    }

    /**
     * 繪製箭頭：直線（可虛線）+ atan2 定向的實心三角箭尖
     * （箭尖幾何取自 basic-refraction 的 drawArrow 填滿路徑）。
     * setLineDash(opts.dash) 只作用於線段，繪畢即還原為 []。
     * @param {CanvasRenderingContext2D} ctx 2D 繪圖環境
     * @param {number} x1 起點 x
     * @param {number} y1 起點 y
     * @param {number} x2 終點 x（箭尖）
     * @param {number} y2 終點 y（箭尖）
     * @param {Object}   [opts]                   繪製參數
     * @param {string}   [opts.color='#334155']   線與箭尖顏色
     * @param {number}   [opts.width=2]           線寬
     * @param {number}   [opts.head=12]           箭尖長度
     * @param {number[]} [opts.dash=[]]           線段虛線樣式（空陣列 = 實線）
     * @param {boolean}  [opts.both=false]        兩端都畫箭尖
     * @param {boolean}  [opts.filled=true]       箭尖填滿（false 只描邊）
     */
    function drawArrow(ctx, x1, y1, x2, y2, opts) {
        var o = opts || {};
        var color = o.color || '#334155';
        var width = (o.width !== undefined) ? o.width : 2;
        var head = (o.head !== undefined) ? o.head : 12;
        var dash = o.dash || [];
        var filled = (o.filled !== false);

        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = width;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);

        var ang = Math.atan2(y2 - y1, x2 - x1);
        drawHead(ctx, x2, y2, ang, head, filled);
        if (o.both) drawHead(ctx, x1, y1, ang + Math.PI, head, filled);
    }

    /**
     * 繪製背景格線（垂直 + 水平），可另以 axis 強調座標軸。
     * @param {CanvasRenderingContext2D} ctx 2D 繪圖環境
     * @param {number} w 繪製寬度（CSS 像素）
     * @param {number} h 繪製高度（CSS 像素）
     * @param {Object} [opts]                  繪製參數
     * @param {number} [opts.step=20]          格距
     * @param {string} [opts.color='#e2e8f0']  格線顏色
     * @param {number} [opts.lineWidth=1]      格線寬
     * @param {{x?:number, y?:number, color?:string, width?:number}} [opts.axis]
     *        強調軸：x 為垂直軸的 x 座標、y 為水平軸的 y 座標，
     *        color 預設 '#94a3b8'、width 預設同格線寬
     */
    function drawGrid(ctx, w, h, opts) {
        var o = opts || {};
        var step = (o.step !== undefined) ? o.step : 20;
        var color = o.color || '#e2e8f0';
        var lineWidth = (o.lineWidth !== undefined) ? o.lineWidth : 1;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        for (var x = 0; x <= w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
        for (var y = 0; y <= h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
        ctx.stroke();

        if (o.axis) {
            ctx.strokeStyle = o.axis.color || '#94a3b8';
            ctx.lineWidth = (o.axis.width !== undefined) ? o.axis.width : lineWidth;
            ctx.beginPath();
            if (o.axis.x !== undefined && o.axis.x !== null) { ctx.moveTo(o.axis.x, 0); ctx.lineTo(o.axis.x, h); }
            if (o.axis.y !== undefined && o.axis.y !== null) { ctx.moveTo(0, o.axis.y); ctx.lineTo(w, o.axis.y); }
            ctx.stroke();
        }
        ctx.restore();
    }

    /**
     * 以指定虛線樣式執行 fn，結束後將虛線還原為 []（實線）——
     * 對應原頁 setLineDash([4,4]) … setLineDash([]) 的成對寫法。
     * @param {CanvasRenderingContext2D} ctx 2D 繪圖環境
     * @param {number[]} dash 虛線樣式（如 [4,4]）
     * @param {function():void} fn 於虛線狀態下執行的繪製函式
     */
    function withDash(ctx, dash, fn) {
        ctx.setLineDash(dash);
        try {
            fn();
        } finally {
            ctx.setLineDash([]);
        }
    }

    return {
        setup: setup,
        pointerPos: pointerPos,
        drawArrow: drawArrow,
        drawGrid: drawGrid,
        withDash: withDash
    };
})();
