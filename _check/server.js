/* 本地静态服务器，用于验证 PWA 与真机访问。
   用法：
     node server.js              → http://127.0.0.1:8123/
     node server.js 9000         → 换端口
     node server.js 8123 /pixel-arcade  → 挂在子目录下（模拟 GitHub Pages 的 /repo/） */
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const PORT = parseInt(process.argv[2], 10) || 8123;
const MOUNT = (process.argv[3] || "").replace(/\/$/, "");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon"
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);

  /* 挂载点：/pixel-arcade/... → 去掉前缀后当作根目录下的相对路径 */
  if (MOUNT) {
    if (urlPath === MOUNT) {
      res.writeHead(302, { location: MOUNT + "/" });
      return res.end();
    }
    if (!urlPath.startsWith(MOUNT + "/")) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("not mounted here: " + urlPath);
    }
    urlPath = urlPath.slice(MOUNT.length);
  }

  if (urlPath === "/") urlPath = "/index.html";
  const file = path.join(root, urlPath);
  if (!file.startsWith(root)) {
    res.writeHead(403); return res.end("forbidden");
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("not found: " + urlPath);
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-cache",
      /* Service Worker 需要允许被当作脚本加载 */
      "service-worker-allowed": "/"
    });
    res.end(data);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("serving " + root);
  console.log("  http://127.0.0.1:" + PORT + (MOUNT || "") + "/");
});
