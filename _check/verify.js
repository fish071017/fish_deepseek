/* 关卡逻辑与流程验证（Node，无需浏览器）
   策略：只拦截 document/canvas/audio/震动 等真实平台依赖，
        其余（Input / Save / Sfx / 四款游戏）一律使用 index.html 里的真实实现。 */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const js = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));

/* 把真正需要浏览器的地方替换掉，其余保持原样 —— 这样测到的就是线上代码本身 */
let code = js;

function mustReplace(from, to, label){
  if(!code.includes(from)) throw new Error("未能定位待替换片段: " + label);
  code = code.replace(from, to);
}

/* 1) document.getElementById("stage") + 2D 上下文 → 无副作用替身 */
mustReplace(
  'const canvas = document.getElementById("stage");\nconst ctx = canvas.getContext("2d", { alpha: false });',
  `const canvas = (typeof __mkCanvas === "function") ? __mkCanvas() : document.getElementById("stage");
const ctx = canvas.getContext("2d", { alpha: false });`,
  "canvas 获取");

/* 2) 音频：Node 无 AudioContext，Sfx.init 已有 try/catch，无需改 */

/* 3) 主循环与启动：改为不自动跑，由测试显式驱动 */
mustReplace(
  `Save.load();
resize();`,
  `Save.load();
resize();
__hooked = true;`,
  "启动段");

mustReplace(
  `requestAnimationFrame(frame);`,
  `__frame = frame;`,
  "requestAnimationFrame");

/* 4) 事件注册：Node 无 window，补一套最小实现后保留真实注册逻辑 */
code = `var __frame = null, __hooked = false;
` + code;

const sandbox = {
  console,
  Math, Date, JSON, parseInt, parseFloat, isFinite, isNaN,
  Object, Array, String, Number, Boolean, Symbol, Error, RegExp, Map, Set, Promise,
  setTimeout: (fn) => { /* 定时器在测试中立即丢弃，避免悬挂 */ return 0; },
  clearTimeout: () => {},
  __mkCanvas: () => ({
    width: 360, height: 640, style: {},
    clientWidth: 360, clientHeight: 640,
    getContext: () => new Proxy({}, { get: () => () => {} }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 640, right: 360, bottom: 640 }),
    addEventListener: () => {}
  }),
  document: {
    getElementById: () => null,
    addEventListener: () => {},
    createElement: () => ({ style: {}, select(){}, value: "" }),
    body: { appendChild(){}, removeChild(){} },
    execCommand: () => true
  },
  window: {
    innerWidth: 360, innerHeight: 640, devicePixelRatio: 1,
    addEventListener: () => {}, removeEventListener: () => {}
  },
  requestAnimationFrame: () => 0,
  addEventListener: () => {},
  navigator: { vibrate: () => true },
  localStorage: (() => { const s = {}; return {
    getItem: (k) => (k in s ? s[k] : null),
    setItem: (k, v) => { s[k] = String(v); },
    removeItem: (k) => { delete s[k]; }
  }; })(),
  location: { hash: "", search: "", protocol: "file:", href: "file:///x/index.html" },
  performance: { now: () => Date.now() },
  addEventListener: () => {}
};
sandbox.globalThis = sandbox;

const vm = require("vm");
const ctxVm = vm.createContext(sandbox);
try {
  vm.runInContext(code, ctxVm, { filename: "index-inline.js" });
} catch(e){
  console.log("!! 脚本执行失败: " + e.message);
  console.log((e.stack || "").split("\n").slice(0, 5).join("\n"));
  process.exit(1);
}
const ev = (expr) => vm.runInContext(expr, ctxVm);

console.log("Node " + process.version + " 验证（使用 index.html 真实实现）");
console.log("脚本加载: OK   W=" + ev("W") + " H=" + ev("H"));

/* ================= 1. 试管：开局必须"未完成" + 贪心可解 ================= */
(function testSort(){
  console.log("\n=== 像素试管：开局状态 + 贪心求解通过率 ===");
  let bad = 0;
  for(let lv = 1; lv <= 14; lv++){
    const r = ev(`(function(){
      let solvedAtStart = 0, solvedByGreedy = 0, total = 0, tubes = 0, legalSum = 0;
      for(let trial = 0; trial < 60; trial++){
        const m = Games.sort.create();
        m.level = ${lv};
        /* 注意：先 buildLevel（它会调用 this.layout()），成功后再把 layout 置空。
           之前把顺序写反，等于绕过了真实路径，才漏掉了"开局即已完成"这个 bug。 */
        m.buildLevel();
        m.layout = function(){};
        m.app = { win(){}, end(){}, go(){}, scene: null };
        tubes = m.tubes.length;
        total++;

        /* 关键不变式：开局绝不能是已完成状态 */
        if(m.isSolved()) solvedAtStart++;

        /* 数一下开局有多少合法走法 */
        let legal = 0;
        const n = m.tubes.length;
        for(let f = 0; f < n; f++) for(let t = 0; t < n; t++){
          if(f === t) continue;
          const from = m.tubes[f], to = m.tubes[t];
          if(!from.blocks.length || to.blocks.length >= m.CAP || m.isDone(from)) continue;
          const cf = m.topColor(from), ct = m.topColor(to);
          if(to.blocks.length > 0 && cf !== ct) continue;
          legal++;
        }
        legalSum += legal;

        /* 贪心求解 */
        let guard = 0;
        while(guard++ < 6000){
          if(m.isSolved()){ solvedByGreedy++; break; }
          const cands = [];
          for(let f = 0; f < n; f++) for(let t = 0; t < n; t++){
            if(f === t) continue;
            const from = m.tubes[f], to = m.tubes[t];
            if(!from.blocks.length || to.blocks.length >= m.CAP || m.isDone(from)) continue;
            const cf = m.topColor(from), ct = m.topColor(to);
            if(to.blocks.length > 0 && cf !== ct) continue;
            if(to.blocks.length === 0 && m.topRun(from) === from.blocks.length) continue;
            cands.push([f, t]);
          }
          if(!cands.length) break;
          const f = cands[0][0], t = cands[0][1];
          const from = m.tubes[f], to = m.tubes[t];
          const cnt = Math.min(m.topRun(from), m.CAP - to.blocks.length);
          for(let i = 0; i < cnt; i++) to.blocks.push(from.blocks.pop());
        }
      }
      return { solvedAtStart, solvedByGreedy, total, tubes, avgLegal: legalSum / total };
    })()`);
    const okStart = r.solvedAtStart === 0;
    const okSolve = r.solvedByGreedy === r.total;
    if(!okStart || !okSolve) bad++;
    console.log("  第 " + String(lv).padStart(2) + " 关 | 试管 " + String(r.tubes).padStart(2) +
                " | 开局已完成 " + r.solvedAtStart + "/" + r.total + (okStart ? " [OK]" : " [FAIL]") +
                " | 开局均 " + r.avgLegal.toFixed(1) + " 种走法" +
                " | 解出 " + (r.solvedByGreedy / r.total * 100).toFixed(1) + "%" + (okSolve ? " [OK]" : " [FAIL]"));
  }
  console.log(bad === 0 ? "  >>> 开局都未完成，且全部可解" : "  >>> 有 " + bad + " 关存在问题");
})();

/* ================= 2. 箭头：零死局 ================= */
(function testArrow(){
  console.log("\n=== 箭头开路：任意顺序清空率（必须 100%） ===");
  let bad = 0;
  for(let lv = 1; lv <= 14; lv++){
    const r = ev(`(function(){
      let ok = 0, total = 0, arrows = 0, minFree = 1e9, freeSum = 0, samples = 0;
      for(let trial = 0; trial < 30; trial++){
        const m = Games.arrow.create();
        m.app = { win(){}, end(){}, go(){}, scene: null };
        m.level = ${lv};
        m.buildLevel();
        total++; arrows += m.arrowsLeft;
        minFree = Math.min(minFree, m.freeCount());
        let guard = 0, dead = false;
        while(m.arrowsLeft > 0 && guard++ < 5000){
          const fm = [];
          for(let rr = 0; rr < m.ROWS; rr++) for(let cc = 0; cc < m.COLS; cc++) if(m.isFree(cc, rr)) fm.push([cc, rr]);
          if(!fm.length){ dead = true; break; }
          freeSum += fm.length; samples++;
          const pickIdx = (Math.random() * fm.length) | 0;
          m.tryFire(fm[pickIdx][0], fm[pickIdx][1], m.app);
        }
        if(dead || m.arrowsLeft > 0) { /* 死局 */ } else ok++;
      }
      return { ok, total, arrows, minFree, avgFree: freeSum / Math.max(1, samples) };
    })()`);
    if(r.ok !== r.total) bad++;
    console.log("  第 " + String(lv).padStart(2) + " 关 | 箭头均 " + String(Math.round(r.arrows / r.total)).padStart(2) +
                " | 起手可选 " + String(r.minFree).padStart(2) +
                " | 平均可选 " + r.avgFree.toFixed(2) +
                " | 清空 " + (r.ok / r.total * 100).toFixed(1) + "%" + (r.ok === r.total ? "  [OK]" : "  [FAIL]"));
  }
  console.log(bad === 0 ? "  >>> 零死局，全部可清空" : "  >>> 有 " + bad + " 关存在死局");
})();

/* ================= 3. 过关续关 ================= */
(function testAdvance(){
  const a = ev(`(function(){
    const m = Games.arrow.create(); m.app = { win(){},end(){},go(){} }; m.level = 3; m.buildLevel();
    return [m.advance(), m.advance()];
  })()`);
  const s = ev(`(function(){
    const m = Games.sort.create(); m.layout = function(){}; m.app = { win(){},end(){},go(){} };
    m.level = 2; m.buildLevel();
    return [m.advance()];
  })()`);
  console.log("\n=== 过关续关 ===");
  console.log("  箭头: 3 -> " + a[0] + " -> " + a[1] + (a[0] === 4 && a[1] === 5 ? "  [OK]" : "  [FAIL]"));
  console.log("  试管: 2 -> " + s[0] + (s[0] === 3 ? "  [OK]" : "  [FAIL]"));
})();

/* ================= 4. 场景与四游戏渲染冒烟 ================= */
(function testScenes(){
  console.log("\n=== 场景与渲染冒烟 ===");
  void ev("__frame");
  for(const name of ["title", "home"]){
    try {
      ev(`App.go(${JSON.stringify(name)})`);
      ev("for(let i=0;i<5;i++){ App.scene.update(0.016); App.scene.draw(ctx); }");
      console.log("  场景 " + name + ": OK");
    } catch(e){ console.log("  场景 " + name + ": 失败 -> " + e.message); }
  }
  for(const id of ["sort", "arrow", "dash", "jump"]){
    try {
      ev(`App.go("game", { id: ${JSON.stringify(id)} })`);
      ev(`for(let i=0;i<180;i++){
        App.scene.update(0.016);
        App.scene.draw(ctx);
        if(i % 23 === 0){
          Input.taps.push({ x: 180, y: 400, dur: 0.05 });
          Input.released = true; Input.releasePos = { x: 180, y: 400 };
        }
        Input.endFrame();
      }`);
      console.log("  游戏 " + id + ": 180 帧无异常");
    } catch(e){
      console.log("  游戏 " + id + ": 异常 -> " + e.message);
      console.log("     " + (e.stack || "").split("\n")[1]);
    }
  }
})();

/* ================= 5. 结束面板 / 存档 / 分享 ================= */
(function testEndFlow(){
  console.log("\n=== 结算、存档、分享 ===");
  try {
    ev('App.go("game", { id: "dash" })');
    ev("App.scene.end(123)");
    ev("for(let i=0;i<30;i++) App.scene.update(0.016)");
    ev("App.scene.draw(ctx)");
    const over = ev("App.scene.over");
    const score = ev("App.scene.score");
    const btns = ev("Object.keys(App.scene.btnPos || {}).join(',')");
    console.log("  结算面板: over=" + over + " score=" + score + " 按钮=[" + btns + "]");
    const best = ev('Save.best("dash")');
    console.log("  存档写入: dash 最佳 = " + best + (best === 123 ? "  [OK]" : "  [FAIL]"));
  } catch(e){ console.log("  结算流程: 异常 -> " + e.message); }
  try {
    ev('App.go("game", { id: "arrow" })');
    ev("App.scene.end(7)");
    ev("App.scene.doShare()");
    console.log("  分享文案: OK（navigator.share 不可用时走 execCommand 兜底）");
  } catch(e){ console.log("  分享文案: 异常 -> " + e.message); }
})();

console.log("\n验证结束");
