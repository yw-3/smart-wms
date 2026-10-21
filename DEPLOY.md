# 部署手册：从零代码到永久公开链接

> 目标：把本系统部署成**任何人都能打开的公开网站**，链接永久有效、不使用任何平台的临时预览模式。
> 全程约 20~40 分钟，无需本地服务器。

---

## 0. 先看架构：两条路线任选其一

| | **路线 A：一体化（推荐，最省事）** | **路线 B：前后端分离** |
|---|---|---|
| 组成 | 一个 Docker 镜像：前端静态页 + 后端 API + 同源 `/api` | 前端静态站（Vercel/Netlify/GH Pages）+ 后端 API（Render/Railway） |
| 公开链接 | `https://xxx.onrender.com`（一个链接全搞定） | `https://xxx.vercel.app` + `https://xxx.onrender.com` |
| 配置量 | 只填 2 个环境变量 | 需分别配置前端 `VITE_API_BASE` 与后端 CORS |
| 跨域 | 无（同源） | 需在 CORS_ORIGIN 填前端域名 |
| 适合 | 绝大多数人（推荐） | 前端要频繁改版/CDN 加速时 |

**数据库**：两条路线都用 Supabase 的 **PostgreSQL**（免费版永久可用、不休眠、数据持久）。
应用同时支持 SQLite（`DB_FILE` 指定文件）与 PostgreSQL（`DATABASE_URL`），业务代码同一套。

> 关键：**不选任何"预览"入口**。Render/Railway 部署完给的是正式服务域名，Vercel/Netlify 给的是正式静态站域名，链接永久有效。

---

## 0.5 路线 A 速查卡（10 分钟版，回来照着做即可）

> 已选路线 A = 一体化单服务。下面 4 步做完就拿到永久公开链接。

**第 1 步 · 建库（3 分钟）**
1. <https://supabase.com> → New project → 设数据库密码 → 记牢
2. SQL Editor → New query → 粘贴 `server/schema.pg.sql` 全文 → **Run**（14 张表建好即可，重复执行安全）
3. Project Settings → Database → Connection string → **URI** → 复制（形如 `postgresql://postgres.xxx:密码@aws-0-xxx.pool.supabase.com:5432/postgres`）

> ⚠️ **连接串务必用 "Connection pooler" 下的 Session 模式（端口 5432），不要用 Transaction 模式(6543)**：
> 本系统使用显式事务（BEGIN/COMMIT），Transaction 模式会把事务语句分散到不同后端连接导致事务失效。
> 直接点数据库密码附近的「URI」标签复制即可，host 不用自己拼。
> 直连地址（`db.xxx.supabase.co`）仅 IPv6，Render 部署请用 pooler 地址。

**第 2 步 · 传代码（2 分钟）**
```bash
git init && git add . && git commit -m "feat: 可独立部署版本"
git remote add origin https://github.com/<你的用户名>/wms.git
git push -u origin main
```
（仓库根已有 `render.yaml`，Render 会自动识别，无需手填构建命令）

**第 3 步 · 部署（4 分钟）**
1. <https://render.com> → 登录 → **New → Blueprint** → 选 `wms` 仓库
2. Environment 填两个值：
   - `DATABASE_URL` = 第 1 步复制的连接串
   - `JWT_SECRET` = 点 **Generate**（或自己填随机 48 字节 hex）
3. `CORS_ORIGIN` 留空（前后端同源，用不到）
4. **Apply** → 等 3~6 分钟构建 → 右上角出现 `https://wms-api-xxxx.onrender.com` ← **这就是永久公开链接**

**第 4 步 · 验收（1 分钟）**
1. 打开 `https://wms-api-xxxx.onrender.com/api/health` → 应返回 `{"ok":true,"driver":"postgres",...}`
   （**driver 必须是 postgres**；若是 sqlite 说明 DATABASE_URL 没生效，回第 3 步）
2. 打开 `https://wms-api-xxxx.onrender.com` → 登录页正常 → `manager / Manager@123` 登录
3. **立刻改掉 6 个演示账号的默认密码**
4. 新建一个库位 → 刷新页面仍在 → 证明已写入 Supabase 并持久化

> **想用 Railway（永不休眠）**：<https://railway.app> → New Project → Deploy from GitHub → 选仓库 → Variables 加 `DATABASE_URL`/`JWT_SECRET`/`SERVE_WEB=true` → Settings → Networking → Generate Domain。
> **想自己服务器**：`docker build -f server/Dockerfile -t wms .` + `docker run -p 80:3000 -e DATABASE_URL=... -e JWT_SECRET=... wms`（见第 3.3 节）。

---

## 1. 准备：把代码上传到 GitHub

1. 在 GitHub 新建一个仓库（如 `wms`），**Public 或 Private 均可**（Private 需要给部署平台授权仓库）。
2. 在本地把代码推上去：

```bash
cd 智能物料仓储系统
git init
git add .
git commit -m "feat: 可独立部署版本（双数据库驱动 + 部署配置）"
git remote add origin https://github.com/<你的用户名>/wms.git
git push -u origin main
```

> `.gitignore` 已排除 `node_modules/`、`server/data/`（含本地数据库）、`.env`（含密钥），可直接提交。
> **不要提交 `server/data/wms.db`**：那是本地开发数据，生产请在 Supabase 里重新录入或按第 7 节迁移。

---

## 2. 创建数据库（Supabase，免费永久）

1. 打开 <https://supabase.com> → 注册（GitHub 账号登录最快）→ **New project**。
   - Project name：随意（如 `wms`）
   - Database password：**设一个强密码并记牢**（后面连接串要用）
   - Region：选离你近的（Singapore / Tokyo）
2. 等约 1 分钟建好，进入 **SQL Editor → New query**。
3. 把仓库里的 `server/schema.pg.sql` **全文复制粘贴**进去 → 点 **Run**。
   - 看到 14 张表创建成功即成功（重复执行也安全，全部 `IF NOT EXISTS`）。
4. 取连接串：**Project Settings → Database → Connection string → 选 URI**，形如：

```
postgresql://postgres.xxxxxxxxxxxxxx:你的密码@aws-0-ap-northeast-1.pool.supabase.com:5432/postgres
```

5. 复制下来备用（这就是要填进后端的 `DATABASE_URL`）。

> 免费额度：500MB 数据库、够本系统用很久；数据库 7×24 在线，**不会休眠、不会丢数据**。

---

## 3. 路线 A：一体化部署（推荐）

### 3.1 Render（免费额度最省心）

1. <https://render.com> 注册（GitHub 登录）→  Dashboard。
2. **New → Blueprint** → 连接你的 `wms` 仓库 → 选该仓库。
3. Render 会自动读到仓库根目录的 `render.yaml`，创建 Web Service：
   - Dockerfile：`./server/Dockerfile`（构建上下文为仓库根）
   - Build context：`Dockerfile` 自动识别
4. 在 Environment 标签页填两个变量：
   - `DATABASE_URL` = 第 2 节复制的连接串
   - `JWT_SECRET` = 点 **Generate** 自动生成（也可自己填随机串）
   - `CORS_ORIGIN` 留空（同源部署用不到）
5. 点 **Apply Blueprint / Create** → 开始构建（约 3~6 分钟，日志可见）。
6. 构建成功后右上角出现 **`https://wms-api-xxxx.onrender.com`** —— 这就是你的永久公开链接。
7. 打开链接 → 用 `manager / Manager@123` 登录 → 立刻改密码（个人设置/修改密码页）。

> **免费版休眠说明**：免费实例空闲 15 分钟会进入休眠，**网址永久有效**（不会过期），但休眠后首次访问需等约 30~60 秒唤醒。
> 若要求"任何时候秒开"，在 Render 把实例改成 **Starter（约 $7/月）** 常驻，或用第 3.2 节的 Railway 常驻实例。
> **数据不会因休眠丢失**——数据在 Supabase，与 Render 实例无关。

### 3.2 Railway（常驻不休眠）

1. <https://railway.app> 注册（GitHub 登录）→ **New Project → Deploy from GitHub Repo** → 选 `wms`。
2. Railway 检测到 `railway.json` + `server/Dockerfile`，自动构建。
3. 点 **Variables** 标签页添加：
   - `DATABASE_URL` = Supabase 连接串
   - `JWT_SECRET` = 随机长字符串
   - `SERVE_WEB` = `true`
4. 部署完成后：**Settings → Networking → Generate Domain** → 得到 `https://xxx.up.railway.app`（永久有效）。

> 💡 **免绑卡说明**：Railway 注册**不需要信用卡**，GitHub 登录即可开用，赠送 $5 试用额度（30 天）。
> 与 Render 不同，Railway 免费额度内服务**不休眠**（无 30~60 秒冷启动）。
> 额度规则：试用期 $5 → 之后每月赠送 $1 额度 + 超出按量计费；单服务上限 1 vCPU / 0.5 GB RAM。
> 512 MB 常驻的小型 Node 服务约 $4~5/月，因此"每月 $1 免费额度"仅够低频使用；
> 若要长期 7×24 在线，需保持账户有余额（可绑卡或充值）。
> 另：Koyeb 同样支持 Dockerfile + 免绑卡（$29 预授权验证，随即撤销），
> 免费版 512 MB / 0.1 vCPU、闲置 1 小时缩容到零。

### 3.2.1 容量测算（2026-10 实测，真实 schema 灌入合成数据）

用本项目真实 DDL 建库并灌入合成数据，测得**每行实际占用**（SQLite，含索引）：

| 表 | 每行 | 一年典型行数 | 年增量 |
|---|---|---|---|
| operation_logs | 139 B | ~7.3 万 | **10.0 MB** |
| requisition_items | 128 B | ~1.8 万 | 2.3 MB |
| inbound_orders | 203 B | ~1.1 万 | 2.2 MB |
| requisition_orders | 103 B | ~1.8 万 | 1.8 MB |
| batch_inventory | 110 B | 滚动 | ~2.0 MB |
| materials | 160 B | 静态 | 0.3 MB |
| locations | 96 B | 静态 | 0.03 MB |

**结论**
- 基准灌入 4.6 万行 → 整库 **8.0 MB**
- 按 6 条产线实际节拍（每天 30 单入库 + 50 单领料）→ **约 20 MB/年**
- Supabase 免费版 500 MB → **可用 20 年以上**，容量完全不是瓶颈
- 唯一持续增长较快的是 `operation_logs`（占约一半体积）；如需长期运行 5 年以上，
  建议在报表模块做「导出后归档」：按 `created_at` 导出年度日志并清理
  （`DELETE FROM operation_logs WHERE created_at < '2026-01-01'`）

### 3.3 自有服务器（VPS / 云主机，Docker 一条命令）

```bash
git clone https://github.com/<你的用户名>/wms.git && cd wms
docker build -f server/Dockerfile -t wms .
docker run -d --name wms -p 80:3000 \
  -e DATABASE_URL="postgresql://..." \
  -e JWT_SECRET="换成随机长字符串" \
  -e SERVE_WEB=true \
  --restart unless-stopped \
  wms
```
再用 Nginx / Caddy 反代 80 端口并配 HTTPS 域名即可。

---

## 4. 路线 B：前后端分离

### 4.1 后端（Render / Railway）—— 与第 3 节相同，但关掉前端托管

在 Render 环境变量里把 `SERVE_WEB` 设为 `false`，其余不变。部署完成拿到后端地址，例如 `https://wms-api-xxxx.onrender.com`。

### 4.2 前端 → Vercel（推荐，免费永久）

1. <https://vercel.com> 注册（GitHub 登录）→ **Add New → Project** → 导入 `wms` 仓库。
2. **Root Directory** 填 `web`（**关键**），Framework Preset 选 **Vite**。
3. **Environment Variables** 添加：
   - `VITE_API_BASE` = `https://wms-api-xxxx.onrender.com/api`
   - `VITE_BASE` = `/`
4. Deploy → 完成，拿到 `https://wms-xxxx.vercel.app`（**永久有效**）。
5. 回到 Render，把 `CORS_ORIGIN` 设为 `https://wms-xxxx.vercel.app` 并重新部署（否则浏览器会拦跨域）。

### 4.3 前端 → Netlify

1. <https://netlify.com> 注册 → **Add new site → Import an existing project** → 选仓库。
2. Build settings：**Base directory** = `web`，**Build command** = `npm run build`，**Publish directory** = `dist`。
3. Environment variables 加 `VITE_API_BASE`（同 4.2）。
4. Deploy → 得到 `https://xxx.netlify.app`。仓库根的 `netlify.toml` 已内置等价配置。

### 4.4 前端 → GitHub Pages（免费永久）

1. 仓库 **Settings → Pages → Source** 选 `Deploy from a branch`，分支 `main`、目录 `/web/dist`。
   > 需先让 GitHub Actions 构建前端：在仓库加 `.github/workflows/deploy-pages.yml`：
   > ```yaml
   > name: Deploy Pages
   > on:
   >   push: { branches: [main] }
   >   workflow_dispatch:
   > jobs:
   >   build:
   >     runs-on: ubuntu-latest
   >     steps:
   >       - uses: actions/checkout@v4
   >       - uses: actions/setup-node@v4
   >         with: { node-version: 22 }
   >       - run: npm ci
   >         working-directory: web
   >       - run: npm run build
   >         working-directory: web
   >         env:
   >           VITE_API_BASE: ${{ vars.VITE_API_BASE }}
   >           VITE_BASE: /${{ github.event.repository.name }}/
   >       - uses: actions/upload-pages-artifact@v3
   >         with: { path: web/dist }
   >   deploy:
   >     needs: build
   >     runs-on: ubuntu-latest
   >     environment:
   >       name: github-pages
   >       url: ${{ steps.deployment.outputs.page_url }}
   >     steps:
   >       - uses: actions/deploy-pages@v4
   > ```
2. 在仓库 **Settings → Secrets and variables → Actions** 添加变量 `VITE_API_BASE`。
3. 访问 `https://<用户名>.github.io/<仓库名>/`。
   > GitHub Pages 无服务端重定向，已内置 `web/public/404.html` 做 SPA 回退；子目录部署需设 `VITE_BASE=/<仓库名>/`（上面的 workflow 已设）。

---

## 5. 环境变量速查表

### 后端（Render / Railway / Docker）

| 变量 | 必填 | 说明 | 示例 |
|---|---|---|---|
| `DATABASE_URL` | ✅（用 Postgres 时） | Supabase 连接串；填了即自动切 Postgres 驱动 | `postgresql://postgres.xxx:pass@aws-0-xxx.pool.supabase.com:5432/postgres` |
| `JWT_SECRET` | ✅ | 登录令牌密钥，生产必须改 | 随机 48 字节 hex |
| `PORT` | ❌ | 平台自动注入 | `3001` |
| `SERVE_WEB` | 路线 A 必填 `true` | 是否由 API 托管前端 | `true` |
| `CORS_ORIGIN` | 路线 B 必填 | 允许的前端域名，逗号分隔 | `https://wms-xxx.vercel.app` |
| `DB_DRIVER` | ❌ | `sqlite`/`postgres`，留空按 DATABASE_URL 自动判定 | `postgres` |
| `DB_FILE` | ❌ | SQLite 文件路径（单机部署可挂持久卷） | `/app/data/wms.db` |
| `PGSSL` | ❌ | Postgres 是否 SSL（Supabase 需 `true`） | `true` |

### 前端（Vercel / Netlify / GitHub Pages，构建时注入）

| 变量 | 必填 | 说明 | 示例 |
|---|---|---|---|
| `VITE_API_BASE` | 路线 B 必填 | 后端接口地址（含 `/api`） | `https://wms-api-xxx.onrender.com/api` |
| `VITE_BASE` | ❌ | 站点基路径，GH Pages 子目录才需要 | `/` |

> 代码里**没有任何写死的域名或本地地址**：接口地址来自 `VITE_API_BASE`，后端端口来自 `PORT`，数据库来自 `DATABASE_URL`。

---

## 6. 部署后验证清单

按顺序做，每步都应通过：

1. `https://你的域名/api/health` → 返回 `{"ok":true,"driver":"postgres",...}`（**driver 必须是 postgres**）
2. 打开首页 → 显示登录页（视频背景正常播放）
3. 用 `manager / Manager@123` 登录 → 进入仪表盘
4. 仪表盘各统计数字正常（非 0/空）
5. **新建一个库位**（主仓 + 线边仓）→ 刷新后仍在（证明写库成功且持久）
6. 物料主数据 → Excel 导入模板下载 + 导入 → 列表出现新数据
7. 备料入库 → 提交一条 → 批次库存页能看到数量
8. 产线领料 → 选产线 + 选线边仓 → 提交 → 产线台账能看到，主仓扣减/线边仓增加
9. 装一条生产任务 → 领料单的物料自动带出

> 6 个演示账号：`admin/Admin@123`、`manager/Manager@123`、`leader/Leader@123`、`picker/Picker@123`、`preparer/Preparer@123`、`supervisor/Supervisor@123`。**上线后请立刻改掉这些默认密码。**

---

## 7. 常见问题排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 页面能开但登录报"无法连接服务器" | 前端 `VITE_API_BASE` 未设/设错 | 路线 B 必设；改完**重新构建**前端 |
| 浏览器控制台报 CORS 错误 | 后端 `CORS_ORIGIN` 未含前端域名 | 填完整前端域名后重新部署后端 |
| 登录成功但页面空白（控制台 404） | 前端 SPA 未配置回退 | Vercel 用 `web/vercel.json`、Netlify 用根 `netlify.toml`、GH Pages 用 `404.html` |
| `/api/health` 返回 driver=sqlite | `DATABASE_URL` 没生效 | 检查变量名拼写、是否重新部署、连接串是否完整 |
| 首次访问很慢（30~60 秒） | Render 免费实例休眠后冷启动 | 属正常；用 Starter/常驻实例解决 |
| 提示 "必须使用 DATABASE_URL" | `DB_DRIVER=postgres` 但没给 `DATABASE_URL` | 二者配套填写 |
| GitHub Pages 打开 404 | 子目录部署缺 `VITE_BASE` | 设为 `/<仓库名>/` 并重新构建 |
| 修改代码后线上没变 | 平台未重新构建 | Render：Manual Deploy → Deploy latest commit；Vercel：重新 Deploy |

---

## 8. 数据备份与迁移

- **备份（Supabase）**：Project Settings → Database → Backups → 免费版可手动下载 SQL 备份。
- **把本地 SQLite 数据搬到线上 Postgres**：
  1. 本地导出：`node -e "..."`（用 `sqlite3` 客户端执行 `.dump` 也可）；
  2. 在 Supabase SQL Editor 里执行导出的 INSERT 语句（表名与 `schema.pg.sql` 一致）。
  3. 简单做法：本地页面导出 Excel → 线上页面重新导入（本系统的物料/成品/BOM 都支持 Excel 导入）。

---

## 9. 自定义域名（可选）

- **Vercel / Netlify**：Settings → Domains → 填域名 → 按提示在域名商加 CNAME。
- **Render / Railway**：Settings → Custom Domain → 填域名 → 平台给出验证记录。
- 配好后在平台自动签发 HTTPS 证书，链接即 `https://你的域名`。

---

## 10. 本地开发（部署后仍可继续开发）

```bash
# 后端（默认 SQLite，文件在 server/data/wms.db）
cd server && npm install && npm start        # http://localhost:3001

# 前端（另开一个终端）
cd web && npm install && npm run dev         # http://localhost:5173
```

想本地也用 Postgres：`DATABASE_URL=postgresql://... DB_DRIVER=postgres npm start`。
想本地跑一遍 Postgres 兼容性的自动化验证（无需装 Postgres）：

```bash
cd server
DB_DRIVER=pglite PORT=3102 node src/index.js      # 终端 A：PGlite（真 Postgres 引擎）
node scripts/smoke.mjs http://127.0.0.1:3102 "PGlite"  # 终端 B：全流程冒烟
```
