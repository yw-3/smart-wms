/**
 * 数据库门面层：业务代码只认这一个 `db` 对象，内部按环境变量切换驱动。
 *
 * 驱动选择（DRIVER=sqlite|postgres，或按 DATABASE_URL 自动判定）：
 *   - sqlite   本地开发 / 单机部署（node:sqlite，零编译，DB_FILE 指定文件位置）
 *   - postgres 生产部署（Supabase / Railway / Render 的托管 Postgres，DATABASE_URL 连接）
 *
 * 调用约定：所有查询统一 `await db.prepare(sql).all(...)`。
 *   - SQLite 驱动返回同步值，await 后仍是原值 → 同一套代码两驱动通用
 *   - Postgres 驱动返回 Promise，await 后为结果
 */
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createSqliteDriver } from './db/driver-sqlite.js';
import { createPostgresDriver } from './db/driver-postgres.js';
import { SCHEMA_SQLITE, SCHEMA_POSTGRES } from './db/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let drv = null;

/** 业务侧统一入口 */
export const db = {
  driver: 'sqlite',

  prepare(sql) {
    return {
      all: (...args) => drv.all(sql, args),
      get: (...args) => drv.get(sql, args),
      run: (...args) => drv.run(sql, args),
    };
  },
  all: (sql, ...args) => drv.all(sql, args),
  get: (sql, ...args) => drv.get(sql, args),
  run: (sql, ...args) => drv.run(sql, args),
  exec: (sql) => drv.exec(sql),
  begin: () => drv.begin(),
  commit: () => drv.commit(),
  rollback: () => drv.rollback(),
  close: () => drv.close(),

  /** Postgres 下为每个 HTTP 请求绑定独占连接（SQLite 下为空实现） */
  withRequestScope: (fn) => (drv.withClient ? drv.withClient(fn) : fn()),
};

/**
 * 初始化数据库：选定驱动 → 建表 → 执行仅 SQLite 需要的历史迁移
 * 必须在服务监听端口之前 await 完成。
 */
export async function initDb() {
  if (drv) return db;

  const url = process.env.DATABASE_URL || '';
  const driverName = String(process.env.DB_DRIVER || (url ? 'postgres' : 'sqlite')).toLowerCase();

  if (driverName === 'postgres') {
    if (!url) throw new Error('DB_DRIVER=postgres 时必须提供 DATABASE_URL');
    drv = createPostgresDriver({
      connectionString: url,
      ssl: process.env.PGSSL === 'false' ? false : true,
      max: Number(process.env.PG_POOL_MAX || 10),
    });
    await drv.exec(SCHEMA_POSTGRES);
    console.log('[db] 已连接 PostgreSQL:', url.replace(/\/\/([^@]*)@/, '//***@'));
  } else if (driverName === 'pglite') {
    // 仅本地验证用：WASM 版真实 Postgres，跑的是与生产一致的 SQL 方言
    const { createPgliteDriver } = await import('./db/driver-pglite.js');
    drv = await createPgliteDriver({ dataDir: process.env.PGLITE_DIR || undefined });
    await drv.exec(SCHEMA_POSTGRES);
    console.log('[db] 已连接 PGlite（本地验证用，Postgres 兼容）');
  } else {
    const file = process.env.DB_FILE || join(__dirname, '..', 'data', 'wms.db');
    mkdirSync(dirname(file), { recursive: true });
    drv = createSqliteDriver({ file });
    await drv.exec(SCHEMA_SQLITE);
    await runSqliteLegacyMigrations();
    console.log('[db] 已连接 SQLite:', file);
  }

  db.driver = drv.name;
  return db;
}

/**
 * 仅 SQLite 需要的历史数据迁移（Postgres 全新建库时无需处理）：
 *  1) materials 补列 category / remark
 *  2) 物料规格并入名称
 *  3) bom 补列 usage_unit
 *  4) 成品从 materials 剥离到 products
 *  5) bom 表结构对齐（老库含 factory_code / line_no 时重建）
 */
async function runSqliteLegacyMigrations() {
  for (const stmt of [
    'ALTER TABLE materials ADD COLUMN category TEXT',
    'ALTER TABLE materials ADD COLUMN remark TEXT',
    'ALTER TABLE bom ADD COLUMN usage_unit TEXT',
  ]) {
    try { await db.exec(stmt); } catch { /* 列已存在 */ }
  }

  // 规格并入名称
  {
    const withSpec = await db.prepare("SELECT id, name, spec FROM materials WHERE spec IS NOT NULL AND TRIM(spec)<>''").all();
    for (const r of withSpec) {
      const name = r.name.endsWith(r.spec) ? r.name : r.name + r.spec;
      await db.prepare('UPDATE materials SET name=?, spec=NULL WHERE id=?').run(name, r.id);
    }
    if (withSpec.length) console.log(`[迁移] ${withSpec.length} 条物料规格已合并到名称`);
  }

  // 成品从物料档案剥离
  {
    const productCodes = new Set((await db.prepare('SELECT DISTINCT product_code FROM bom').all()).map((r) => r.product_code));
    const all = await db.prepare('SELECT id, code, name, spec, unit_main FROM materials').all();
    for (const m of all) {
      if (!productCodes.has(m.code)) continue;
      await db.prepare('INSERT INTO products (code,name,spec,unit_main) VALUES (?,?,?,?) ON CONFLICT(code) DO NOTHING').run(m.code, m.name, m.spec, m.unit_main);
      await db.prepare('DELETE FROM materials WHERE id=?').run(m.id);
    }
  }

  // 老 bom 表结构重建
  {
    const cols = await db.prepare('PRAGMA table_info(bom)').all();
    const names = cols.map((c) => c.name);
    if (names.includes('factory_code') || names.includes('line_no')) {
      await db.exec(`
        CREATE TABLE bom_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_code TEXT NOT NULL,
          component_code TEXT NOT NULL,
          qty_per_unit REAL NOT NULL,
          usage_unit TEXT,
          remark TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(product_code, component_code)
        );
        INSERT INTO bom_new (id, product_code, component_code, qty_per_unit, usage_unit, remark, created_at)
          SELECT id, product_code, component_code, qty_per_unit, usage_unit, remark, created_at FROM bom;
        DROP TABLE bom;
        ALTER TABLE bom_new RENAME TO bom;
      `);
    }
  }
}

// 六角色 → 可访问模块映射（菜单与接口权限的统一来源）
export const ROLE_PERMISSIONS = {
  admin: ['dashboard', 'master', 'logs', 'system', 'inbound', 'requisition'],
  manager: ['dashboard', 'master', 'logs', 'inbound', 'requisition'],
  leader: ['dashboard'],
  picker: ['dashboard', 'requisition'],
  preparer: ['dashboard', 'inbound'],
  supervisor: ['dashboard', 'inbound', 'requisition'],
};

export const ROLE_LABELS = {
  admin: '系统管理员',
  manager: '仓库物管',
  leader: '产线班长',
  picker: '车间领料员',
  preparer: '备料员',
  supervisor: '生产组长',
};
