/* 静态部署就绪自检：上线前跑一遍，确认没有会踩坑的地方。
   用法: node _check/preflight.js */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const REQUIRED = ["index.html", "sw.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
const MUST_BE_RELATIVE = ["index.html", "sw.js", "manifest.webmanifest"];

let fail = 0, warn = 0;
const ok   = (m) => console.log("  [OK]   " + m);
const bad  = (m) => { fail++; console.log("  [FAIL] " + m); };
const soft = (m) => { warn++; console.log("  [WARN] " + m); };

console.log("像素街机 · 部署就绪自检");
console.log("目录: " + root + "\n");

/* ---- 1. 必需文件 ---- */
console.log("1) 必需文件");
for(const f of REQUIRED){
  const p = path.join(root, f);
  fs.existsSync(p) ? ok(f + "  (" + fs.statSync(p).size + " 字节)") : bad(f + " 缺失");
}

/* ---- 2. 不能有绝对路径（部署到 /repo/ 子目录会挂） ---- */
console.log("\n2) 绝对路径检查（子目录部署的常见死因）");
let absFound = 0;
for(const f of MUST_BE_RELATIVE){
  const p = path.join(root, f);
  if(!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, "utf8");
  const patterns = [
    { re: /(?:src|href)\s*=\s*["']\/(?!\/)/g, what: "HTML 属性绝对路径" },
    { re: /url\(\s*["']?\/(?!\/)/g,           what: "CSS url() 绝对路径" },
    { re: /register\(\s*["']\/(?!\/)/g,       what: "SW 注册绝对路径" },
    { re: /["']\/[a-zA-Z0-9_\-.]+\.[a-z]{2,4}["']/g, what: "资源字符串绝对路径" }
  ];
  for(const { re, what } of patterns){
    const hits = src.match(re);
    if(hits){ absFound++; bad(f + " 中发现 " + what + ": " + hits.slice(0, 3).join(", ")); }
  }
}
if(!absFound) ok("index.html / sw.js / manifest 中无绝对路径，可安全部署到任意子目录");

/* ---- 2b. BOM 检查 ----
   UTF-8 BOM 会让 manifest.webmanifest 解析失败（JSON 不允许开头有 BOM），
   也可能导致 sw.js 注册失败。用 PowerShell 改文件很容易带上，必须查。 */
{
  let bomFound = 0;
  for(const f of ["index.html", "sw.js", "manifest.webmanifest"]){
    const p = path.join(root, f);
    if(!fs.existsSync(p)) continue;
    const b = fs.readFileSync(p);
    if(b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF){
      bomFound++;
      bad(f + " 带 UTF-8 BOM —— manifest 会解析失败、SW 可能注册不上");
    }
  }
  if(!bomFound) ok("三个核心文件均无 BOM");
}

/* ---- 3. manifest 完整性 ---- */
console.log("\n3) PWA manifest");
try {
  const mf = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  mf.name ? ok("name: " + mf.name) : bad("缺少 name");
  mf.short_name ? ok("short_name: " + mf.short_name) : soft("建议补 short_name（桌面图标名）");
  (mf.display === "fullscreen" || mf.display === "standalone")
    ? ok("display: " + mf.display) : soft("display=" + mf.display + "，全屏体验建议 fullscreen/standalone");
  mf.orientation === "portrait" ? ok("orientation: portrait") : soft("未锁定竖屏");
  mf.start_url ? ok("start_url: " + mf.start_url) : bad("缺少 start_url");
  Array.isArray(mf.icons) && mf.icons.length ? ok("icons: " + mf.icons.length + " 个") : bad("缺少 icons");
  const has192 = (mf.icons || []).some(i => String(i.sizes).includes("192"));
  const has512 = (mf.icons || []).some(i => String(i.sizes).includes("512"));
  has192 ? ok("含 192x192 图标") : bad("缺少 192x192 图标");
  has512 ? ok("含 512x512 图标（安装到桌面必需）") : bad("缺少 512x512 图标");
  const hasMaskable = (mf.icons || []).some(i => String(i.purpose || "").includes("maskable"));
  hasMaskable ? ok("含 maskable 图标（安卓自适应图标）") : soft("建议补 purpose: maskable");
  for(const i of (mf.icons || [])){
    const ip = path.join(root, String(i.src).replace(/^\.\//, ""));
    fs.existsSync(ip) ? ok("图标存在: " + i.src) : bad("图标文件缺失: " + i.src);
  }
} catch(e){ bad("manifest 解析失败: " + e.message); }

/* ---- 4. index.html 关键标签 ---- */
console.log("\n4) HTML 关键标签");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const checks = [
  [/<meta\s+name=["']viewport["'][^>]*width=device-width/i, "viewport 含 width=device-width"],
  [/viewport-fit=cover/i, "viewport-fit=cover（刘海屏安全区）"],
  [/user-scalable=no/i, "禁用双指缩放"],
  [/rel=["']manifest["']/i, "关联 manifest"],
  [/name=["']theme-color["']/i, "theme-color（状态栏配色）"],
  [/apple-mobile-web-app-capable/i, "iOS 全屏 meta"],
  [/apple-touch-icon/i, "iOS 桌面图标"]
];
for(const [re, label] of checks){
  re.test(html) ? ok(label) : soft("缺少: " + label);
}

/* ---- 5. 体积与依赖 ---- */
console.log("\n5) 体积与依赖");
let total = 0;
for(const f of REQUIRED) if(fs.existsSync(path.join(root, f))) total += fs.statSync(path.join(root, f)).size;
ok("首屏资源合计 " + (total / 1024).toFixed(1) + " KB（" +
   (total < 200 * 1024 ? "很小，秒开" : "偏大") + "）");
const ext = html.match(/(?:src|href)\s*=\s*["'](https?:)?\/\//g);
ext ? soft("引用了外部资源: " + ext.length + " 处（离线会失败）") : ok("零外部依赖，可完全离线");

/* ---- 6. Service Worker 安全性 ---- */
console.log("\n6) Service Worker");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
/sw\.js/.test(html) ? ok("index.html 中已注册 sw.js") : bad("未注册 sw.js");
/self\.registration\.scope/.test(sw) ? ok("缓存键使用 registration.scope（子目录安全）") : soft("未使用 registration.scope，子目录部署可能缓存错位");
/serviceWorker/.test(sw) || /addEventListener\(["']fetch/.test(sw) ? ok("含 fetch 处理") : bad("缺少 fetch 处理");
/offline/i.test(sw) ? ok("含离线兜底") : soft("建议加离线兜底页");
console.log("  提示：Service Worker 只在 https 或 localhost 下生效；file:// 打开时离线功能不可用。");

/* ---- 结论 ---- */
console.log("\n" + "=".repeat(46));
if(fail) console.log("结果: 有 " + fail + " 项必须修复，先别部署");
else if(warn) console.log("结果: 可部署（" + warn + " 项建议优化）");
else console.log("结果: 完全就绪，可以直接部署");
console.log("=".repeat(46));
process.exit(fail ? 1 : 0);
