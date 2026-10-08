/* 像素街机 Service Worker —— 离线可用
   策略：
     · 页面导航  → 网络优先，失败回落缓存里的 index.html（离线也能打开）
     · 静态资源  → stale-while-revalidate（先给缓存，后台静默更新）
   全部使用相对路径 + self.registration.scope，因此部署在子目录
   （例如 https://user.github.io/pixel-arcade/）也能正常工作。 */
const VERSION = "pixel-arcade-v3";
const CORE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.ico",
  "./icon-192.png",
  "./icon-512.png"
];

/* 离线兜底页：首次访问就断网时给一个能看懂的最小页面，而不是浏览器错误页 */
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>像素街机 · 离线</title>
<style>
  html,body{height:100%;margin:0;background:#0b0b14;color:#e8e8f0;
    font-family:"Courier New",monospace;display:flex;align-items:center;
    justify-content:center;text-align:center}
  .box{padding:24px;max-width:320px}
  h1{font-size:22px;margin:0 0 12px;color:#ff4d6d}
  p{font-size:13px;line-height:1.7;color:#7a7a94;margin:0}
  button{margin-top:20px;padding:12px 22px;font:inherit;font-size:14px;
    background:#20203a;color:#e8e8f0;border:2px solid #4dd2ff;
    border-radius:0;cursor:pointer}
</style></head><body><div class="box">
<h1>离线了</h1>
<p>还没缓存到本地内容。<br>连上网络后再打开一次，之后就能离线玩。</p>
<button onclick="location.reload()">重新加载</button>
</div></body></html>`;

/* ---- 安装：逐个缓存，单个失败不影响整体 ---- */
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(CORE.map(async (url) => {
      try { await cache.add(new Request(url, { cache: "reload" })); }
      catch (err) { /* 缺一个资源不该让整个安装失败 */ }
    }));
    await self.skipWaiting();
  })());
});

/* ---- 激活：清理旧版本缓存 ---- */
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (err) {}
    }
    await self.clients.claim();
  })());
});

/* ---- 缓存未命中且离线时的兜底响应 ---- */
function offlineResponse(){
  return new Response(OFFLINE_HTML, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  /* 只管同源，别碰第三方资源 */
  if (url.origin !== self.location.origin) return;

  /* 页面导航：网络优先 → 缓存 → 离线兜底页 */
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(VERSION);
          cache.put(new URL("./index.html", self.registration.scope).href, res.clone()).catch(() => {});
        }
        return res;
      } catch (err) {
        const scope = self.registration.scope;
        const cached =
          (await caches.match(new URL("./index.html", scope).href)) ||
          (await caches.match(new URL("./", scope).href)) ||
          (await caches.match(req));
        return cached || offlineResponse();
      }
    })());
    return;
  }

  /* 其它资源：stale-while-revalidate */
  e.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === "basic") {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => null);

    if (cached) { network.catch(() => {}); return cached; }
    const res = await network;
    return res || new Response("", { status: 504, statusText: "offline" });
  })());
});
