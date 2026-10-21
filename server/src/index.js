import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

// 必须最先加载：后续所有模块读取 process.env 时才能拿到 .env 里的值
import './env.js';

import { initDb, db } from './db.js';
import { seed } from './seed.js';
import authRoutes from './routes/auth.js';
import masterRoutes from './routes/master.js';
import dashboardRoutes from './routes/dashboard.js';
import logsRoutes from './routes/logs.js';
import inboundRoutes from './routes/inbound.js';
import requisitionRoutes from './routes/requisition.js';
import bomRoutes from './routes/bom.js';
import productRoutes from './routes/products.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// ===== 环境变量（全部可配置，代码内不写死任何地址） =====
// PORT            平台注入（Render/Railway）或默认 3001
// DATABASE_URL    Postgres 连接串（Supabase 等）；不设则使用本地 SQLite
// DB_DRIVER       sqlite | postgres（不设时按 DATABASE_URL 自动判定）
// DB_FILE         SQLite 数据文件路径（默认 server/data/wms.db；单机部署可挂卷）
// JWT_SECRET      登录令牌密钥（生产必须设置为随机长字符串）
// CORS_ORIGIN     允许的前端来源，逗号分隔；如 https://wms.vercel.app；不设则放行全部
// SERVE_WEB       是否由本服务同时托管前端静态文件（true/false，默认 false）
const PORT = Number(process.env.PORT || 3001);
const CORS_ORIGINS = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = CORS_ORIGINS.length
  ? { origin: (origin, cb) => cb(null, !origin || CORS_ORIGINS.includes(origin)), credentials: false }
  : { origin: true };

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// Postgres 模式下为每个请求绑定独占连接（保证事务隔离；SQLite 模式为空实现）
app.use((req, res, next) => {
  db.withRequestScope(() => next());
});

app.get('/api/health', (req, res) =>
  res.json({ ok: true, driver: db.driver, time: new Date().toISOString() })
);

app.use('/api/auth', authRoutes);
app.use('/api/master', masterRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/inbound', inboundRoutes);
app.use('/api/requisition', requisitionRoutes);
app.use('/api/bom', bomRoutes);
app.use('/api/products', productRoutes);

// 可选：同时托管已构建的前端（单机部署时一个服务搞定前后端）
// 静态目录查找顺序：
//   1. WEB_DIST_DIR 环境变量指定的绝对路径
//   2. 发布构建目录 <root>/public        （.publish 布局：src/ + public/）
//   3. 仓库布局 <root>/web/dist           （本地一体化部署）
if (String(process.env.SERVE_WEB || '').toLowerCase() === 'true') {
  const candidates = [
    process.env.WEB_DIST_DIR,
    join(__dirname, '..', 'public'),
    join(__dirname, '..', '..', 'web', 'dist'),
  ].filter(Boolean);
  const dist = candidates.find((p) => existsSync(p));
  if (dist) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(join(dist, 'index.html')));
    console.log('[WMS] 已启用前端静态托管:', dist);
  }
}

app.use((req, res) => res.status(404).json({ error: '接口不存在' }));

// ===== 启动：先建库/初始化，再监听端口 =====
await initDb();
await seed();

const server = app.listen(PORT, () => {
  console.log(`[WMS] API 服务已启动: port=${PORT} driver=${db.driver}`);
  if (!process.env.JWT_SECRET) {
    console.warn('[WMS] 警告：未设置 JWT_SECRET 环境变量，生产环境请务必设置');
  }
});

// 优雅退出：平台重启/缩容时释放数据库连接
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    console.log(`[WMS] 收到 ${sig}，正在关闭…`);
    server.close(async () => {
      try { await db.close(); } catch { /* 忽略关闭异常 */ }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 8000).unref();
  });
}

export default app;
