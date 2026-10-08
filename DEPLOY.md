# 部署指南

这是一个**纯静态网站**：没有构建步骤、没有后端、零外部依赖。
把整个文件夹原样传上去就能跑（约 82 KB）。

- `index.html` — 全部代码
- `manifest.webmanifest` + `sw.js` + 两张图标 — 让手机上能「添加到主屏幕」并离线游玩
- `_check/` — 开发用脚本，部署时可以删掉，也可以一起传（不影响运行）
- `.nojekyll` — 给 GitHub Pages 用的，别的平台会忽略

**两个硬性要求**（已满足，改代码时别破坏）：

1. 所有路径必须是**相对路径**。子目录部署（`user.github.io/repo/`）全靠这个。
2. Service Worker 只在 **HTTPS 或 localhost** 下生效。用 `file://` 打开时游戏能玩，但离线缓存和「添加到主屏幕」不可用。

上线前先自检：

```powershell
node _check\preflight.js
```

---

## 方案一：GitHub Pages（免费，最通用）

仓库已经初始化好了，就差推到 GitHub。

**1. 在 GitHub 上建一个空仓库**

打开 https://github.com/new ，仓库名填 `pixel-arcade`，
**不要**勾选 Add README / .gitignore / license（本地已有提交），点 Create。

**2. 推送**

```powershell
cd "C:\Users\62989\Desktop\Deepseek工作文件夹\pixel-arcade"
git remote add origin https://github.com/<你的用户名>/pixel-arcade.git
git push -u origin main
```

推送时会要求登录。密码处**不能填账号密码**，要填 Personal Access Token
（GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens，
勾选该仓库的 `Contents: Read and write`）。

**3. 开启 Pages**

仓库 → Settings → Pages → Source 选 `Deploy from a branch`，
Branch 选 `main`、目录选 `/ (root)`，Save。

等 1–2 分钟，访问：

```
https://<你的用户名>.github.io/pixel-arcade/
```

> 注意这是**子目录**地址。项目已经实测过子目录部署（Service Worker scope、
> 缓存键、图标路径全部正常），可以放心。

**以后更新**

```powershell
git add -A
git commit -m "调整难度"
git push
```

> **国内访问提示**：`github.io` 在部分网络下不稳定。手机打不开就换方案二。

---

## 方案二：Cloudflare Pages（国内速度通常更好）

1. 把仓库推到 GitHub（同上第 1、2 步）
2. 打开 https://dash.cloudflare.com/ → Workers & Pages → Create → Pages → Connect to Git
3. 选中 `pixel-arcade` 仓库
4. 构建配置**全部留空**：
   - Framework preset: `None`
   - Build command: **留空**
   - Build output directory: `/`
5. Save and Deploy

会给你一个 `xxx.pages.dev` 的域名，自带 HTTPS。
也可以在 Pages 里绑定自己的域名。

---

## 方案三：拖拽上传（不用 git，最快）

适合只想赶紧拿到一个链接的情况。

| 平台 | 操作 | 备注 |
|---|---|---|
| **Netlify Drop** | 打开 https://app.netlify.com/drop ，把 `pixel-arcade` 文件夹**拖进去** | 几秒出链接，可绑定域名 |
| **Vercel** | https://vercel.com/new → 拖文件夹 | 同上 |
| **腾讯云 EdgeOne Pages** | 国内平台，支持直接上传静态文件 | 国内访问快，需实名 |
| **阿里云 OSS / 腾讯云 COS** | 建 Bucket → 上传 → 开启「静态网站托管」 | 需要备案才能绑自己的域名 |

> 拖拽时如果平台问「要传哪个目录」，选 `pixel-arcade` 本身，
> 保证 `index.html` 在**根目录**。若多套了一层文件夹，
> 访问时要带上那层路径，否则会 404。

---

## 部署后怎么确认真的成了

用 `?debug=1` 打开首页，屏幕底部会显示诊断读数：

```
PWA: 离线已就绪 | controller:有 | scope /pixel-arcade/
viewport 360x781 | css 492x1067 | dpr 1 | https:
scope path: /pixel-arcade/
```

逐项对照：

| 读数 | 正常表现 | 不正常说明 |
|---|---|---|
| `PWA` | `离线已就绪` | `注册失败` → 多半是没走 https；`需 http/https` → 你用的是 `file://`；`浏览器不支持` → 换浏览器 |
| `controller` | 第二次访问后应为 `有` | 一直是 `无` → SW 没接管，检查 `sw.js` 是否 200 |
| `scope` | 应与你的访问路径一致 | 对不上 → 部署层级多了/少了一层目录 |
| `viewport` | 高度随手机不同而变、宽度恒为 `360` | 宽度不是 360 → 缩放逻辑被改坏了 |

**手机上验证「添加到主屏幕」**：iOS 用 Safari（微信内置浏览器不支持），
安卓用 Chrome，菜单里找「添加到主屏幕」。装完打开是全屏无地址栏。

---

## 常见问题

**Q：手机上玩不了 / 画面被裁**
用 `?debug=1` 看 `viewport` 那行。宽度必须是 360；若是别的值，
说明 `resize()` 里的逻辑被动过。

**Q：改了代码但手机上还是旧版**
Service Worker 会缓存。改完 `index.html` 后，把 `sw.js` 里的
`VERSION = "pixel-arcade-v2"` 改成 `v3`，旧缓存才会被清掉。

**Q：微信里打开没有声音**
微信内部浏览器对 WebAudio 有限制，点一下屏幕（首次交互）才会解锁音频。
首页的 🔊 按钮可以切换静音。

**Q：想要一个不带 `?debug=1` 的干净链接给别人**
直接把根地址发出去就行，诊断读数只在带 `?debug=1` 时才绘制。

**Q：想直接用 IP 在电脑上给手机测**
```powershell
node _check\server.js
# 手机访问 http://<电脑局域网IP>:8123/
```
注意：用 IP 访问时不是安全上下文，Service Worker 不会启用，
但游戏本身完全正常。要测离线得用上面的正式部署。
