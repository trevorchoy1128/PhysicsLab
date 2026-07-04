/* ============================================================================
 * PhysLab — sim3d.js（three.js 3D 模擬器共用底座）
 * ----------------------------------------------------------------------------
 * 用途：
 *   取代各 3D 模擬器頁面複製貼上的 initSim 樣板（場景／相機／渲染器／
 *   OrbitControls／燈光／網格）、three.js 載入防護（load-guard）、視角預設
 *   （VIEWS/setView）、onResize、主迴圈（rAF + clock），以及三種文字精靈
 *   （plain／badge／pill）與 disposeGroup 資源釋放。所有繪製常數
 *   （畫布尺寸、字型、座標、燈光強度、網格參數）均逐字取自原頁實作。
 *
 * 載入順序（classic script，非 ES module）：
 *   core.js → i18n.js → quiz.js → sim3d.js
 *   （頁面須先以 <script> 載入 three.min.js 與 OrbitControls.js）
 *
 * API 摘要：
 *   PhysLab.sim3d.ready(fn)                DOMContentLoaded + THREE 載入防護
 *   PhysLab.sim3d.create(container, opts)  建立場景底座 → ctx
 *     ctx = { scene, camera, renderer, controls, clock, wrap,
 *             setView(name), onResize(cb), resize(), start(tick), stop() }
 *   PhysLab.sim3d.addLabLights(scene, opts?)  標準三燈組（faraday-lenz 系列值）
 *   PhysLab.sim3d.addLabGrid(scene, opts?)    標準地面網格（AC-DC 系列值）
 *   PhysLab.sim3d.makeSprite(text, opts)      文字精靈（kind:'plain'|'badge'|'pill'）
 *   PhysLab.sim3d.makeLabel(text, color, scale)          → plain（純文字）
 *   PhysLab.sim3d.makeBadge(text, bg, border, fg, scale) → badge（圓形徽章）
 *   PhysLab.sim3d.makePill(text, fg, scale)              → pill（圓角膠囊）
 *   PhysLab.sim3d.disposeGroup(group)         釋放整個 group 的幾何與材質
 *   PhysLab.sim3d.makeLabeledArrow(dir, origin, len, colorHex, labelText, labelOpts?)
 *
 * 相依 API（由 core.js / i18n.js 提供）：
 *   PhysLab.ui.showBlocker(html)、PhysLab.i18n.t(key)
 *   內建字串鍵：'sim3d.loadError'
 * ========================================================================== */

window.PhysLab = window.PhysLab || {};

/**
 * 視角預設定義。pos / tgt 可用 [x,y,z] 陣列或 THREE.Vector3。
 * @typedef {{pos:(number[]|THREE.Vector3), tgt:(number[]|THREE.Vector3)}} ViewDef
 */

PhysLab.sim3d = (function () {
    'use strict';

    /**
     * 將 [x,y,z] 陣列或 THREE.Vector3 統一轉為 THREE.Vector3。
     * @param {number[]|THREE.Vector3} v 來源向量
     * @returns {THREE.Vector3}
     */
    function toV3(v) {
        return (v && v.isVector3) ? v : new THREE.Vector3(v[0], v[1], v[2]);
    }

    /**
     * 數值色碼（0xRRGGBB）轉 CSS 色字串；字串則原樣傳回。
     * @param {number|string} c 色碼
     * @returns {string} CSS 顏色
     */
    function cssColor(c) {
        if (typeof c === 'number') return '#' + ('000000' + c.toString(16)).slice(-6);
        return c;
    }

    /**
     * three.js 載入防護：於 DOMContentLoaded（或文件已就緒時立即）檢查
     * THREE 與 THREE.OrbitControls 是否存在。缺件時以
     * PhysLab.ui.showBlocker(PhysLab.i18n.t('sim3d.loadError')) 顯示全頁提示
     * 且「不」呼叫 fn；正常時呼叫 fn()。
     * @param {function():void} fn 場景初始化函式
     */
    function ready(fn) {
        function boot() {
            if (typeof THREE === 'undefined' || typeof THREE.OrbitControls === 'undefined') {
                PhysLab.ui.showBlocker(PhysLab.i18n.t('sim3d.loadError'));
                return;
            }
            fn();
        }
        if (document.readyState === 'loading') {
            window.addEventListener('DOMContentLoaded', boot);
        } else {
            boot();
        }
    }

    /**
     * 加入標準實驗室三燈組（faraday-lenz 系列標準值）：
     * AmbientLight(0xffffff, 0.82)、主光 DirectionalLight(0xffffff, 0.55) 於 (6,12,8)、
     * 補光 DirectionalLight(0xffffff, 0.25) 於 (-8,4,-6)。
     * @param {THREE.Scene} scene 目標場景
     * @param {{ambient?:number|false, key?:number|false, fill?:number|false,
     *          keyPos?:number[], fillPos?:number[]}} [opts] 強度／位置覆寫；
     *          任一項傳 false 則完全略過該燈（不建立零強度燈物件）
     * @returns {{ambient:?THREE.AmbientLight, key:?THREE.DirectionalLight,
     *            fill:?THREE.DirectionalLight}} 建立之燈光（略過者為 null）
     */
    function addLabLights(scene, opts) {
        var o = opts || {};
        var ambient = null, key = null, fill = null;
        if (o.ambient !== false) {
            ambient = new THREE.AmbientLight(0xffffff, (o.ambient !== undefined) ? o.ambient : 0.82);
            scene.add(ambient);
        }
        if (o.key !== false) {
            key = new THREE.DirectionalLight(0xffffff, (o.key !== undefined) ? o.key : 0.55);
            var kp = o.keyPos || [6, 12, 8];
            key.position.set(kp[0], kp[1], kp[2]);
            scene.add(key);
        }
        if (o.fill !== false) {
            fill = new THREE.DirectionalLight(0xffffff, (o.fill !== undefined) ? o.fill : 0.25);
            var fp = o.fillPos || [-8, 4, -6];
            fill.position.set(fp[0], fp[1], fp[2]);
            scene.add(fill);
        }
        return { ambient: ambient, key: key, fill: fill };
    }

    /**
     * 加入標準地面網格（AC-DC 系列標準值）：
     * GridHelper(30, 30, 0xc0c8d2, 0xd4dae2)，position.y = -3.4。
     * @param {THREE.Scene} scene 目標場景
     * @param {{size?:number, div?:number, y?:number, c1?:number, c2?:number}} [opts] 覆寫
     * @returns {THREE.GridHelper} 建立之網格
     */
    function addLabGrid(scene, opts) {
        var o = opts || {};
        var grid = new THREE.GridHelper(
            (o.size !== undefined) ? o.size : 30,
            (o.div !== undefined) ? o.div : 30,
            (o.c1 !== undefined) ? o.c1 : 0xc0c8d2,
            (o.c2 !== undefined) ? o.c2 : 0xd4dae2
        );
        grid.position.y = (o.y !== undefined) ? o.y : -3.4;
        scene.add(grid);
        return grid;
    }

    /**
     * 建立 3D 場景底座（對應原頁 initSim 樣板）：
     * Scene + 背景 0xe2e6eb、PerspectiveCamera(42, w/h, 0.1, 200)、
     * WebGLRenderer({antialias:true}) + setPixelRatio(Math.min(devicePixelRatio, 2))、
     * OrbitControls（enableDamping、dampingFactor 0.07、enablePan）、
     * 標準燈光、標準網格；自動掛 window resize、並套用 'default' 視角。
     *
     * 注意：預設會加入標準網格（AC-DC 值）；原頁若無網格（如 faraday-lenz、
     * AC-DC 以外的自訂網格頁）請傳 grid:false 後自行 addLabGrid 覆寫參數。
     *
     * @param {HTMLElement} container 3D 視圖容器（原頁的 #view3d wrap）
     * @param {Object}  opts                     設定
     * @param {number}  [opts.background=0xe2e6eb] 場景背景色
     * @param {number}  [opts.fov=42]             相機視角
     * @param {number}  [opts.near=0.1]           近裁切面
     * @param {number}  [opts.far=200]            遠裁切面
     * @param {Object.<string, ViewDef>} opts.views 視角預設表（必須含 'default'）
     * @param {{damping?:number}|false} [opts.controls] OrbitControls 設定；false 停用
     * @param {'lab'|false} [opts.lights='lab']   標準燈光；false 停用（自行加燈）
     * @param {{size?:number,div?:number,y?:number,c1?:number,c2?:number}|false}
     *        [opts.grid] 標準網格參數；false 停用
     * @returns {{scene:THREE.Scene, camera:THREE.PerspectiveCamera,
     *            renderer:THREE.WebGLRenderer, controls:(THREE.OrbitControls|null),
     *            clock:THREE.Clock, wrap:HTMLElement,
     *            setView:function(string):void, onResize:function(function():void):void,
     *            resize:function():void, start:function(function(number):void):void,
     *            stop:function():void}} ctx 場景上下文
     */
    function create(container, opts) {
        var o = opts || {};
        if (!o.views || !o.views.default) {
            throw new Error('PhysLab.sim3d.create: opts.views.default 為必要參數');
        }
        var views = o.views;

        var scene = new THREE.Scene();
        scene.background = new THREE.Color((o.background !== undefined) ? o.background : 0xe2e6eb);

        var W = container.clientWidth, H = container.clientHeight;
        var camera = new THREE.PerspectiveCamera(
            (o.fov !== undefined) ? o.fov : 42,
            W / H,
            (o.near !== undefined) ? o.near : 0.1,
            (o.far !== undefined) ? o.far : 200
        );

        var renderer = new THREE.WebGLRenderer({ antialias: true });
        // opts.pixelRatio 可覆寫預設的 min(dpr,2)（少數舊頁不設上限）
        renderer.setPixelRatio((o.pixelRatio !== undefined) ? o.pixelRatio : Math.min(window.devicePixelRatio, 2));
        renderer.setSize(W, H);
        container.appendChild(renderer.domElement);

        var controls = null;
        if (o.controls !== false) {
            controls = new THREE.OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = (o.controls && o.controls.damping !== undefined) ? o.controls.damping : 0.07;
            controls.enablePan = true;
        }

        if (o.lights !== false) addLabLights(scene);
        if (o.grid !== false) addLabGrid(scene, (typeof o.grid === 'object') ? o.grid : undefined);

        var extraResize = [];   // 頁面追加的 resize 回呼（例：重繪 2D 波形視窗）
        var rafId = 0;
        var running = false;

        var ctx = {
            scene: scene,
            camera: camera,
            renderer: renderer,
            controls: controls,
            clock: new THREE.Clock(),
            wrap: container,

            /**
             * 套用視角預設（原版 setView 語意）：
             * camera.position ← views[name].pos、controls.target ← views[name].tgt、
             * controls.update()。查無名稱時回退 views.default。
             * @param {string} name 視角名稱
             */
            setView: function (name) {
                var v = views[name] || views.default;
                camera.position.copy(toV3(v.pos));
                if (controls) {
                    controls.target.copy(toV3(v.tgt));
                    controls.update();
                } else {
                    camera.lookAt(toV3(v.tgt));
                }
            },

            /**
             * 註冊額外的 resize 回呼（於 ctx.resize() 尾端依序執行）。
             * @param {function():void} cb 回呼
             */
            onResize: function (cb) { extraResize.push(cb); },

            /**
             * 依容器尺寸更新相機長寬比與渲染器大小（原版 onResize 語意，
             * 含 faraday-lenz 的 w && h 防呆），再執行所有額外回呼。
             */
            resize: function () {
                if (!renderer) return;
                var w = container.clientWidth, h = container.clientHeight;
                if (w && h) {
                    camera.aspect = w / h;
                    camera.updateProjectionMatrix();
                    renderer.setSize(w, h);
                }
                for (var i = 0; i < extraResize.length; i++) extraResize[i]();
            },

            /**
             * 啟動主迴圈（原版 loop 語意）：每幀 dt = clock.getDelta() →
             * tick(dt) → controls.update() → renderer.render(scene, camera)。
             * 注意：dt 未夾限；原第七冊各頁於自身 tick 內做
             * dt = Math.min(dt, 0.05)，搬遷時請保留於頁面端。
             * @param {function(number):void} tick 每幀回呼（參數為經過秒數）
             */
            start: function (tick) {
                ctx.stop();
                running = true;
                var frame = function () {
                    if (!running) return;
                    rafId = requestAnimationFrame(frame);
                    var dt = ctx.clock.getDelta();
                    if (tick) tick(dt);
                    if (controls) controls.update();
                    renderer.render(scene, camera);
                };
                rafId = requestAnimationFrame(frame);
            },

            /** 停止主迴圈（取消已排程的 requestAnimationFrame）。 */
            stop: function () {
                running = false;
                if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
            }
        };

        window.addEventListener('resize', ctx.resize);
        ctx.setView('default');
        ctx.resize();
        return ctx;
    }

    /* ────────────────────────────────────────────
     * 文字精靈：三種原版變體（繪製常數逐字照抄）
     * ──────────────────────────────────────────── */

    /**
     * plain 變體畫布（parallel-wires / flemings-left 的 makeLabel）：
     * 128×128、'bold 80px Segoe UI, Arial'、fillText(text, 64, 70)。
     * @param {string} text 標籤文字
     * @param {{color?:string}} o 繪製參數
     * @returns {HTMLCanvasElement}
     */
    function drawPlain(text, o) {
        var c = document.createElement('canvas');
        c.width = 128; c.height = 128;
        var ctx = c.getContext('2d');
        ctx.fillStyle = o.color || '#334155';
        ctx.font = 'bold 80px Segoe UI, Arial';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 64, 70);
        return c;
    }

    /**
     * badge 變體畫布（faraday-lenz / eddy-current 的 makeLabelSprite）：
     * 256×256、圓 arc(128,128,110) 填 bg、邊框 lineWidth 12 描 border、
     * 'bold 150px Arial'、fillText(text, 128, 138)。
     * @param {string} text 徽章文字（如 'N'、'S'）
     * @param {{bg?:string, border?:string, color?:string}} o 繪製參數
     * @returns {HTMLCanvasElement}
     */
    function drawBadge(text, o) {
        var cv = document.createElement('canvas');
        cv.width = 256; cv.height = 256;
        var ctx = cv.getContext('2d');
        ctx.fillStyle = o.bg || '#ffffff';
        ctx.beginPath(); ctx.arc(128, 128, 110, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 12; ctx.strokeStyle = o.border || '#94a3b8'; ctx.stroke();
        ctx.fillStyle = o.color || '#334155'; ctx.font = 'bold 150px Arial';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 128, 138);
        return cv;
    }

    /**
     * 圓角矩形路徑（eddy-current 的 roundRect，逐字照抄）。
     * @param {CanvasRenderingContext2D} ctx 2D 繪圖環境
     * @param {number} x 左上 x
     * @param {number} y 左上 y
     * @param {number} w 寬
     * @param {number} h 高
     * @param {number} r 圓角半徑
     */
    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }

    /**
     * pill 變體畫布（eddy-current 的 makeTextSprite）：
     * 512×128、圓角矩形 (6,20,500,88,r20) 填 rgba(255,255,255,0.9)、
     * 邊框 #cbd5e1 lineWidth 3、'bold 56px "Microsoft JhengHei",Arial'、
     * 文字寬 >470 時自動縮字級、fillText(text, 256, 66)。
     * @param {string} text 標籤文字
     * @param {{color?:string}} o 繪製參數（color 即原版 fg）
     * @returns {HTMLCanvasElement}
     */
    function drawPill(text, o) {
        var cv = document.createElement('canvas');
        cv.width = 512; cv.height = 128;
        var ctx = cv.getContext('2d');
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        roundRect(ctx, 6, 20, 500, 88, 20); ctx.fill();
        ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 3; roundRect(ctx, 6, 20, 500, 88, 20); ctx.stroke();
        ctx.fillStyle = o.color || '#334155'; ctx.font = 'bold 56px "Microsoft JhengHei",Arial';
        // 長文字自動縮小字級以塞進畫布，避免被裁切
        var tw = ctx.measureText(text).width;
        if (tw > 470) ctx.font = 'bold ' + Math.floor(56 * 470 / tw) + 'px "Microsoft JhengHei",Arial';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 256, 66);
        return cv;
    }

    /**
     * 建立文字精靈。三種 kind 的畫布尺寸、字型、座標、縮放與 renderOrder
     * 均與原頁實作一致：
     *  - 'plain'：SpriteMaterial{transparent, depthTest:false}，scale.set(s,s,s)，
     *             不設 renderOrder（原版未設）。
     *  - 'badge'：同上材質，scale.set(s,s,1)，renderOrder = 999。
     *  - 'pill' ：同上材質，scale.set(s*2.6, s*0.65, 1)，renderOrder = 998，
     *             並設 userData.isLabel = true（原版標記）。
     * 所有精靈附 userData.setText(newText)：以原參數重繪新畫布、
     * dispose 舊貼圖、換上新 CanvasTexture（供語言切換就地改字）。
     * @param {string} text 標籤文字
     * @param {{kind?:('plain'|'badge'|'pill'), color?:string, bg?:string,
     *          border?:string, scale?:number}} [opts] 精靈參數
     * @returns {THREE.Sprite}
     */
    function makeSprite(text, opts) {
        var o = opts || {};
        var kind = o.kind || 'plain';
        var draw = (kind === 'badge') ? drawBadge : (kind === 'pill') ? drawPill : drawPlain;
        var sp = new THREE.Sprite(new THREE.SpriteMaterial({
            map: new THREE.CanvasTexture(draw(text, o)),
            transparent: true,
            depthTest: false
        }));
        var s = o.scale || 1;
        if (kind === 'badge') {
            sp.scale.set(s, s, 1); sp.renderOrder = 999;
        } else if (kind === 'pill') {
            sp.scale.set(s * 2.6, s * 0.65, 1); sp.renderOrder = 998;
            sp.userData.isLabel = true;
        } else {
            sp.scale.set(s, s, s);
        }
        sp.userData.setText = function (newText) {
            if (sp.material.map) sp.material.map.dispose();
            sp.material.map = new THREE.CanvasTexture(draw(newText, o));
            sp.material.needsUpdate = true;
        };
        return sp;
    }

    /**
     * plain 精靈捷徑（與原 makeLabel(text, color, scale) 呼叫介面相容）。
     * @param {string} text  標籤文字
     * @param {string} color 文字顏色（CSS 色字串）
     * @param {number} [scale=1] 縮放
     * @returns {THREE.Sprite}
     */
    function makeLabel(text, color, scale) {
        return makeSprite(text, { kind: 'plain', color: color, scale: scale });
    }

    /**
     * badge 精靈捷徑（與原 makeLabelSprite(text, bg, border, fg, scale) 相容）。
     * @param {string} text   徽章文字
     * @param {string} bg     底色
     * @param {string} border 邊框色
     * @param {string} fg     文字色
     * @param {number} [scale=1] 縮放
     * @returns {THREE.Sprite}
     */
    function makeBadge(text, bg, border, fg, scale) {
        return makeSprite(text, { kind: 'badge', bg: bg, border: border, color: fg, scale: scale });
    }

    /**
     * pill 精靈捷徑（與原 makeTextSprite(text, fg, scale) 相容）。
     * @param {string} text 標籤文字
     * @param {string} fg   文字色
     * @param {number} [scale=1] 縮放
     * @returns {THREE.Sprite}
     */
    function makePill(text, fg, scale) {
        return makeSprite(text, { kind: 'pill', color: fg, scale: scale });
    }

    /**
     * 釋放整個 group 的幾何與材質（AC-DC 版語意逐字照抄）：
     * 逐一取出子物件，子物件含孫層時遞迴處理，geometry.dispose()、
     * material.map.dispose()（若有貼圖）、material.dispose()，最後自 group 移除。
     * @param {THREE.Group|THREE.Object3D} g 目標群組（可為 null）
     */
    function disposeGroup(g) {
        if (!g) return;
        while (g.children.length) {
            var c = g.children[0];
            if (c.children && c.children.length) disposeGroup(c);
            if (c.geometry) c.geometry.dispose();
            if (c.material) { if (c.material.map) c.material.map.dispose(); if (c.material.dispose) c.material.dispose(); }
            g.remove(c);
        }
    }

    /**
     * 建立「箭頭 + 文字標籤」群組：THREE.ArrowHelper 加上箭尖外側的
     * plain 文字精靈（標籤顏色預設取箭頭色）。
     * @param {number[]|THREE.Vector3} dir    箭頭方向（內部會正規化）
     * @param {number[]|THREE.Vector3} origin 箭頭起點
     * @param {number} len       箭頭長度
     * @param {number} colorHex  箭頭顏色（0xRRGGBB）
     * @param {string} [labelText] 標籤文字（省略則只有箭頭）
     * @param {{kind?:string, color?:string, bg?:string, border?:string,
     *          scale?:number, offset?:number}} [labelOpts]
     *        標籤精靈參數；offset 為標籤沿方向超出箭尖的距離（預設 0.6）
     * @returns {THREE.Group}
     */
    function makeLabeledArrow(dir, origin, len, colorHex, labelText, labelOpts) {
        var lo = labelOpts || {};
        var d = toV3(dir).clone().normalize();
        var org = toV3(origin);
        var g = new THREE.Group();
        g.add(new THREE.ArrowHelper(d, org, len, colorHex));
        if (labelText) {
            var sp = makeSprite(labelText, {
                kind: lo.kind || 'plain',
                color: lo.color || cssColor(colorHex),
                bg: lo.bg,
                border: lo.border,
                scale: lo.scale
            });
            sp.position.copy(org).addScaledVector(d, len + ((lo.offset !== undefined) ? lo.offset : 0.6));
            g.add(sp);
        }
        return g;
    }

    return {
        ready: ready,
        create: create,
        addLabLights: addLabLights,
        addLabGrid: addLabGrid,
        makeSprite: makeSprite,
        makeLabel: makeLabel,
        makeBadge: makeBadge,
        makePill: makePill,
        disposeGroup: disposeGroup,
        makeLabeledArrow: makeLabeledArrow
    };
})();
