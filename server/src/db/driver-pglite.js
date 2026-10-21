/**
 * PGlite 驱动（仅用于本地验证，非生产依赖）。
 *
 * PGlite 是编译为 WASM 的真实 PostgreSQL（Postgres 15+），因此可以在本机
 * 用与生产完全相同的 SQL 方言与参数绑定规则跑通全流程，
 * 无需连接外部 Supabase 即可验证 Postgres 路径的正确性。
 *
 * 启用方式：DB_DRIVER=pglite（动态按需加载，生产构建不会引入该依赖）
 */
import { toPgSql, isInsertStatement, hasReturning } from './sql.js';

export async function createPgliteDriver({ dataDir } = {}) {
  const { PGlite } = await import('@electric-sql/pglite');
  const raw = dataDir ? new PGlite(dataDir) : new PGlite();
  await raw.waitReady;

  const q = async (sql, args = []) => raw.query(sql, args);

  return {
    name: 'pglite',
    raw,
    async exec(sql) {
      return raw.exec(sql);
    },
    async all(sql, args = []) {
      const res = await q(toPgSql(sql), args);
      return res.rows;
    },
    async get(sql, args = []) {
      const res = await q(toPgSql(sql), args);
      return res.rows[0];
    },
    async run(sql, args = []) {
      let s = toPgSql(sql);
      let needReturning = false;
      if (isInsertStatement(s) && !hasReturning(s)) {
        s += ' RETURNING id';
        needReturning = true;
      }
      const res = await q(s, args);
      return {
        changes: res.affectedRows ?? res.rows?.length ?? 0,
        lastInsertRowid: needReturning ? res.rows[0]?.id : undefined,
      };
    },
    async begin() {
      await raw.query('BEGIN');
    },
    async commit() {
      await raw.query('COMMIT');
    },
    async rollback() {
      try { await raw.query('ROLLBACK'); } catch { /* 忽略 */ }
    },
    async withClient(fn) {
      return fn();
    },
    async close() {
      await raw.close();
    },
  };
}
