/**
 * 环境变量文件加载（零依赖，用 Node 内置 process.loadEnvFile）。
 *
 * 用途：本地开发与部分部署沙箱（如 WorkBuddy 应用发布）不提供环境变量注入机制，
 * 此时把配置写进 .env 文件即可。已存在的 process.env 变量优先级更高，不会被覆盖。
 *
 * 查找顺序（自上而下，命中即停）：
 *   1. <当前工作目录>/.env      （发布沙箱：工作目录即发布根，含 .env）
 *   2. <项目根>/.env            （一体化部署：server/src/../..）
 *   3. <server 目录>/.env       （仅后端部署）
 *   4. <项目根>/.env.production （生产环境专用文件）
 */
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const candidates = [
  join(process.cwd(), '.env'),
  join(ROOT, '.env'),
  join(ROOT, 'server', '.env'),
  join(ROOT, '.env.production'),
];

for (const file of candidates) {
  if (!existsSync(file)) continue;
  try {
    // Node 20.12+ 内置；已存在的 env 不会被覆盖
    process.loadEnvFile(file);
    console.log('[env] 已加载环境变量文件:', file);
  } catch (e) {
    console.warn('[env] 加载失败:', file, e.message);
  }
}
