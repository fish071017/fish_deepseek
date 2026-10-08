/* 真机验证：用 CDP 驱动 Edge，模拟触摸，验证四款游戏都可玩。
   关注的是"游戏状态是否变化"，而不是任何瞬时中间态。

   两个曾经把我带偏的坑，写在这里备查：
   1) 反算 client 坐标必须用应用自己的 layoutRect.dpr，不能用 window.devicePixelRatio
      —— 应用里 dpr 被 Math.min(dpr, 2.5) 钳制，3x 屏上两者不等。
   2) 不要把"应用回算出的逻辑坐标"和"我派发的 client 坐标"相比，量纲不同。
      基准统一为逻辑坐标。 */
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9260;
const APP = process.argv[2] || "http://127.0.0.1:8123/index.html";
const VIEWS = process.argv[3] ? [{ name: "低分屏", w: 360, h: 640, dpr: 1 }] : [
  { name: "iPhone 12/13", w: 390, h: 844, dpr: 3 },
  { name: "窄长屏",       w: 360, h: 800, dpr: 3 },
  { name: "宽屏",         w: 430, h: 932, dpr: 3 },
  { name: "低分屏",       w: 360, h: 640, dpr: 1 }
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (url) => new Promise((res, rej) => {
  http.get(url, (r) => { let d = ""; r.on("data", c => d += c); r.on("end", () => { try { res(JSON.parse(d)); } catch(e){ rej(e); } }); }).on("error", rej);
});

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log("    [OK]   " + m); };
const bad = (m) => { fail++; console.log("    [FAIL] " + m); };

(async () => {
  const profile = path.join(process.env.TEMP, "cdpfinal");
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  const child = spawn(EDGE, ["--headless=new","--disable-gpu","--no-sandbox",
    "--remote-debugging-port=" + PORT, "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" });

  let target = null;
  for(let i = 0; i < 60 && !target; i++){
    await sleep(250);
    try { const l = await getJSON("http://127.0.0.1:" + PORT + "/json/list"); target = l.find(t => t.type === "page"); } catch(e){}
  }
  if(!target){ console.log("连不上调试端口"); child.kill(); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(); const errs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if(m.id && pending.has(m.id)){ pending.get(m.id)(m); pending.delete(m.id); }
    else if(m.method === "Runtime.exceptionThrown") errs.push("异常: " + ((m.params.exceptionDetails.exception||{}).description||"").split("\n").slice(0,3).join(" | "));
    else if(m.method === "Log.entryAdded" && m.params.entry.level === "error" && !/favicon/.test(m.params.entry.text)) errs.push("错误: " + m.params.entry.text);
  };
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, m => res(m.result || m.error)); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if(r && r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r && r.result ? r.result.value : undefined;
  };
  await send("Runtime.enable"); await send("Page.enable"); await send("Log.enable");

  for(const V of VIEWS){
    console.log("\n########## " + V.name + "  " + V.w + "x" + V.h + " @" + V.dpr + "x ##########");
    await send("Emulation.setDeviceMetricsOverride", { width: V.w, height: V.h, deviceScaleFactor: V.dpr, mobile: true });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await send("Page.navigate", { url: APP });
    await sleep(2400);

    /* 记下应用"实际回算出的逻辑坐标"，作为唯一基准 */
    await ev(`
      window.__rx = [];
      document.getElementById('stage').addEventListener('touchstart', e => {
        const t = e.touches[0];
        try { const q = screenToLogical(t.clientX, t.clientY); window.__rx.push([+q.x.toFixed(1), +q.y.toFixed(1)]); }
        catch(err){ window.__rx.push(null); }
      }, { passive: true });
    `);

    const LR = JSON.parse(await ev("JSON.stringify({unit:layoutRect.unit,dpr:layoutRect.dpr,offY:offY,buf:[canvas.width,canvas.height],W:W,H:H,winDpr:devicePixelRatio})"));
    const toClient = (lx, ly) => ({ x: lx * LR.unit / LR.dpr, y: (ly * LR.unit + LR.offY) / LR.dpr });
    console.log("    逻辑 " + LR.W + "x" + LR.H + "  buf " + LR.buf.join("x") +
                "  unit=" + LR.unit.toFixed(4) + " dpr=" + LR.dpr + " (window.dpr=" + LR.winDpr + ")");

    Math.abs(LR.buf[0] / LR.dpr - V.w) < 2 ? ok("canvas 缓冲区匹配视口") : bad("缓冲区 " + LR.buf.join("x") + " vs 视口 " + V.w);
    LR.W === 360 ? ok("逻辑宽度恒为 360") : bad("逻辑宽度 " + LR.W);

    async function tap(lx, ly, settle){
      const q = toClient(lx, ly);
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: q.x, y: q.y, id: 1 }] });
      await sleep(60);
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(settle);
    }
    async function tapHold(lx, ly, holdMs, settle){
      const q = toClient(lx, ly);
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: q.x, y: q.y, id: 1 }] });
      await sleep(holdMs);
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(settle);
    }

    /* ---- 点击换算精度 ---- */
    const probe = [[100, 200], [180, 400], [300, 600]];
    await ev("window.__rx = []");
    for(const p of probe) await tap(p[0], p[1], 80);
    const rx = (await ev("window.__rx")) || [];
    let maxErr = 0;
    for(let i = 0; i < probe.length; i++){
      if(!rx[i]){ maxErr = 999; continue; }
      maxErr = Math.max(maxErr, Math.abs(rx[i][0] - probe[i][0]), Math.abs(rx[i][1] - probe[i][1]));
    }
    maxErr < 2.5 ? ok("点击换算精度 " + maxErr.toFixed(1) + "px")
                 : bad("点击换算误差 " + maxErr.toFixed(1) + "px 实收 " + JSON.stringify(rx));

    /* ---- 四款游戏：一律用 hash 直达，避免场景切换带来的时序干扰 ---- */
    async function gotoGame(gid){
      await ev(`location.hash = "#game/${gid}"`);
      await sleep(700);
      return await ev("App.sceneName");
    }

    /* 试管 */
    if(await gotoGame("sort") !== "game") bad("像素试管: 无法进入");
    else {
      const plan = await ev(`(() => {
        const m = App.scene.mod, n = m.tubes.length;
        for(let f = 0; f < n; f++) for(let t = 0; t < n; t++){
          if(f === t) continue;
          const from = m.tubes[f], to = m.tubes[t];
          if(!from.blocks.length || to.blocks.length >= m.CAP || m.isDone(from)) continue;
          const cf = m.topColor(from), ct = m.topColor(to);
          if(to.blocks.length > 0 && cf !== ct) continue;
          const rf = m.tubeRect(from), rt = m.tubeRect(to);
          return { f, t, fx: rf.x+rf.w/2, fy: rf.y+rf.h/2, tx: rt.x+rt.w/2, ty: rt.y+rt.h/2 };
        }
        return null;
      })()`);
      if(!plan || plan.__err || plan === null) bad("像素试管: 无可走走法");
      else {
        const before = await ev("JSON.stringify(App.scene.mod.tubes.map(t=>t.blocks.join('')))");
        await tap(plan.fx, plan.fy, 320);
        const sel = await ev("App.scene.mod.sel");
        await tap(plan.tx, plan.ty, 800);
        const after = await ev("JSON.stringify(App.scene.mod.tubes.map(t=>t.blocks.join('')))");
        (before !== after) ? ok("像素试管: 倒水成功 " + before + " -> " + after)
                           : bad("像素试管: 盘面未变（选中态 " + sel + "） " + before);
      }
    }

    /* 箭头 */
    if(await gotoGame("arrow") !== "game") bad("箭头开路: 无法进入");
    else {
      const tgt = await ev(`(() => { const m = App.scene.mod;
        for(let r=0;r<m.ROWS;r++) for(let c=0;c<m.COLS;c++) if(m.isFree(c,r))
          return { x: m.ox+c*m.CELL+m.CELL/2, y: m.oy+r*m.CELL+m.CELL/2, n: m.arrowsLeft };
        return null; })()`);
      if(!tgt || tgt.__err) bad("箭头开路: 无通畅箭头");
      else {
        await tap(tgt.x, tgt.y, 420);
        const after = await ev("App.scene.mod.arrowsLeft");
        (after === tgt.n - 1) ? ok("箭头开路: 消掉 1 个箭头 " + tgt.n + " -> " + after)
                              : bad("箭头开路: " + tgt.n + " -> " + after + "（应减 1）");
      }
    }

    /* 点色 */
    if(await gotoGame("dash") !== "game") bad("一指点色: 无法进入");
    else {
      await sleep(2000);
      const b = await ev("App.scene.mod.score");
      const lane = await ev("(() => { const m = App.scene.mod; for(let i=0;i<m.LANES;i++) if(m.lanes[i].length) return i; return -1; })()");
      if(lane < 0) bad("一指点色: 2s 内没有方块落下");
      else {
        await tap(lane * 90 + 45, 400, 420);
        const a = await ev("App.scene.mod.score");
        (a > b) ? ok("一指点色: 得分 " + b + " -> " + a) : bad("一指点色: 得分未变（" + b + "，轨道 " + lane + "）");
      }
    }

    /* 跳跃 */
    if(await gotoGame("jump") !== "game") bad("像素跳跃: 无法进入");
    else {
      const b = await ev("App.scene.mod.score");
      const ground = await ev("App.scene.mod.player.onGround");
      await tapHold(180, 420, 520, 1800);
      const a = await ev("App.scene.mod.score");
      (a > b) ? ok("像素跳跃: 蓄力起跳 " + b + " -> " + a)
              : bad("像素跳跃: 得分未变（" + b + "，起跳前 onGround=" + ground + "）");
    }
  }

  console.log("\n--- 控制台 ---");
  const uniq = [...new Set(errs)];
  if(!uniq.length) console.log("  无错误");
  else { uniq.slice(0, 8).forEach(e => console.log("  " + e)); fail += uniq.length; }

  console.log("\n" + "=".repeat(46));
  console.log("通过 " + pass + " 项 · 失败 " + fail + " 项");
  console.log("=".repeat(46));
  ws.close(); child.kill(); await sleep(300);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("脚本失败: " + e.message); process.exit(1); });

