/**
 * 发布构建脚本：把「前端静态产物 + 后端服务」打包成可发布的单目录。
 *
 * 产物：.publish/
 *   ├── package.json      启动入口（node src/index.js）
 *   ├── src/              后端源码（含 .env 加载能力）
 *   ├── public/           前端 dist 产物
 *   └── .env              运行时环境变量（发布沙箱不提供环境变量注入）
 *
 * 用法：node server/scripts/build-publish.mjs
 * 注意：需先设置 DATABASE_URL / JWT_SECRET 环境变量，否则 .env 中写入空值。
 */
import { existsSync } from 'fs';
import { cp, mkdir, rm, writeFile, readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const OUT = join(ROOT, '.publish');

console.log('[publish] 开始构建发布目录…');

// 1. 清空旧产物
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// 2. 后端源码
await cp(join(ROOT, 'server', 'src'), join(OUT, 'src'), { recursive: true });

// 3. 前端静态产物
const DIST = join(ROOT, 'web', 'dist');
if (!existsSync(DIST)) {
  console.error('[publish] 错误：未找到 web/dist，请先执行 npm run build');
  process.exit(1);
}
await cp(DIST, join(OUT, 'public'), { recursive: true });

// 4. package.json —— 依赖与 server 保持一致
const serverPkg = JSON.parse(await readFile(join(ROOT, 'server', 'package.json'), 'utf8'));
await writeFile(
  join(OUT, 'package.json'),
  JSON.stringify(
    {
      name: 'wms-publish',
      version: '1.0.0',
      private: true,
      type: 'module',
      description: '智能物料仓储系统 — 发布构建',
      scripts: { start: 'node src/index.js' },
      dependencies: serverPkg.dependencies,
    },
    null,
    2
  )
);

// 5. .env —— 从环境读取真实值后落盘（沙箱无环境变量注入能力）
const envLines = [
  '# 由 server/scripts/build-publish.mjs 生成：发布沙箱不提供环境变量注入',
  `DATABASE_URL=${process.env.DATABASE_URL || ''}`,
  `JWT_SECRET=${process.env.JWT_SECRET || ''}`,
  'DB_DRIVER=postgres',
  'SERVE_WEB=true',
  'NODE_ENV=production',
  'CORS_ORIGIN=',
];
await writeFile(join(OUT, '.env'), envLines.join('\n') + '\n');

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
  console.warn('[publish] 警告：DATABASE_URL / JWT_SECRET 未设置，.env 中将写入空值');
}

console.log('[publish] 完成 →', OUT);
console.log('[publish] 目录内容：package.json / src/ / public/ / .env');
