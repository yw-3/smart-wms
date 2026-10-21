# 智能物料出入库管理系统

广州永旺食品有限公司 · 车间物料全流程数字化管控平台
后台管理风格 · 中文界面 · 六角色分级权限 · **可独立部署为永久公开站点**

> 📖 **部署到公网请看 [DEPLOY.md](./DEPLOY.md)**（从上传代码到拿到永久公开链接的完整步骤）

## 技术栈
- 前端：React 18 + TypeScript + Vite + Ant Design 5（专业后台风格）
- 后端：Node.js 22 + Express（JWT + bcrypt + RBAC）
- 数据库：**SQLite（本地/单机）与 PostgreSQL（Supabase 等托管库）双驱动**，同一套业务代码
- 报表导入：`xlsx`（.xlsx / .xls / .csv）

## 目录结构（前后端分离）
```
智能物料仓储系统/
├── web/                     # ===== 前端：静态 SPA（部署到 Vercel / Netlify / GitHub Pages）=====
│   ├── src/
│   │   ├── api.ts           # 接口地址：环境变量 VITE_API_BASE 配置，不写死域名
│   │   ├── App.tsx          # 路由（含六角色守卫）
│   │   ├── layout/          # 侧边栏(按角色渲染) + 顶栏
│   │   ├── pages/           # 登录/仪表盘/日志/主数据/备料入库/产线领料
│   │   └── permissions.ts
│   ├── public/              # 静态资源（login-bg.mp4 等）+ 404.html(GH Pages 回退)
│   ├── vercel.json          # Vercel 部署配置（SPA 回退）
│   ├── .env.example         # VITE_API_BASE / VITE_BASE 说明
│   └── dist/                # 构建产物
│
├── server/                  # ===== 后端：REST API（部署到 Render / Railway / Docker）=====
│   ├── src/
│   │   ├── index.js         # 入口：环境变量化（PORT/CORS/JWT/DB），优雅退出
│   │   ├── db.js            # 数据库门面：按环境变量切换驱动
│   │   ├── db/
│   │   │   ├── driver-sqlite.js     # node:sqlite 驱动（同步）
│   │   │   ├── driver-postgres.js   # pg 驱动（异步 + 请求级独占连接 + 事务隔离）
│   │   │   ├── driver-pglite.js     # PGlite 驱动（仅本地验证，WASM 版真 Postgres）
│   │   │   ├── schema.js            # 双驱动建表 DDL
│   │   │   └── sql.js               # SQLite→PostgreSQL 方言翻译（?→$n / datetime 等）
│   │   ├── auth.js          # JWT / bcrypt / 认证与模块权限中间件
│   │   ├── helpers.js       # 操作日志（追加式留痕）+ 统一异常处理
│   │   ├── inventory.js     # 库存引擎：入库/冲销/调拨/FIFO
│   │   ├── seed.js          # 幂等写入基础配置（6 角色账号、供应商、单位、产线）
│   │   └── routes/          # auth / master / dashboard / logs / inbound / requisition / bom / products
│   ├── scripts/smoke.mjs    # 端到端冒烟测试（对 SQLite 与 Postgres 跑同一套流程）
│   ├── schema.pg.sql       # PostgreSQL 建表脚本（Supabase SQL Editor 直接执行）
│   ├── Dockerfile          # 多阶段构建：前端产物 + 后端 API（一体化部署）
│   └── .env.example
│
├── netlify.toml             # Netlify 部署配置（base = web/）
├── render.yaml              # Render Blueprint 部署配置
├── railway.json             # Railway 部署配置
├── DEPLOY.md                # ⭐ 完整部署教程（拿到永久公开链接）
└── package.json             # 一键脚本
```

## 快速启动（本地开发）
```bash
npm run install:all     # 安装前后端依赖
npm run dev             # 前端 5173（代理 /api → 3001），后端 3001
```
访问 http://localhost:5173

> 本地默认使用 SQLite（`server/data/wms.db`）。删除该文件后重启可重置。
> 想本地跑 Postgres 兼容验证：`DB_DRIVER=pglite PORT=3102 node server/src/index.js`

## 演示账号
| 账号 | 密码 | 角色 | 可访问 |
|------|------|------|--------|
| admin | Admin@123 | 系统管理员 | 全部模块 / 操作日志 |
| manager | Manager@123 | 仓库物管 | 主数据 / 入库 / 领料 / 日志 |
| leader | Leader@123 | 产线班长 | 仪表盘 |
| picker | Picker@123 | 车间领料员 | 仪表盘 / 产线领料 |
| preparer | Preparer@123 | 备料员 | 仪表盘 / 备料入库 |
| supervisor | Supervisor@123 | 生产组长 | 仪表盘 / 入库 / 领料 |

> **上线后请立即修改默认密码。** 登录页内置「演示账号一键填充」。

## 已实现功能
- ✅ 登录 + JWT，六角色菜单/接口双重权限拦截；密码复杂度校验、错误 5 次锁定 15 分钟、强制改密
- ✅ 操作日志永久追加式留痕，管理员/物管可审计
- ✅ **主数据管理**：物料（类别/备注/规格并入名称）、Excel 批量导入、供应商、库位、单位换算、ABC、成品档案、BOM 配方（Excel 导入 + 模板下载）
- ✅ **概览仪表盘**：物料/供应商/库位统计 + ABC 分布 + 今日入库 + 最近操作动态
- ✅ **备料入库**：扫码/手输料号自动识别、数量/批次/供应商/库位录入、批次库存、记录查询、编辑与作废冲销
- ✅ **产线领料**：BOM 一键领料（单耗展开 + FIFO 推荐批次）、手动增补、超领确认、主仓→线边仓实时调拨、产线台账、记录改单与作废
- ✅ 库存引擎：可用库存仅累计「合格」批次，批次明细实时重算汇总防漂移

## 待开发模块
库存查询（效期/FIFO）、报表中心、效期预警、盘点闭环、审批流。

## 部署要点
- **不写死任何地址**：前端接口地址来自 `VITE_API_BASE`，后端来自 `PORT`/`DATABASE_URL`/`JWT_SECRET`/`CORS_ORIGIN`
- **永久链接**：Render / Railway / Vercel / Netlify / GitHub Pages 均为正式托管域名，非临时预览
- **数据持久**：数据库用 Supabase（PostgreSQL）免费版，7×24 在线不休眠
- 详见 [DEPLOY.md](./DEPLOY.md)
