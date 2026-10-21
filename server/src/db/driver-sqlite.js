/**
 * SQLite 驱动（node:sqlite，Node 22 内置，零编译依赖）。
 * 用于本地开发与单机部署；接口为同步，调用方统一用 await 兼容两种驱动。
 */
import { DatabaseSync } from 'node:sqlite';

export function createSqliteDriver({ file }) {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = ON;');

  return {
    name: 'sqlite',
    raw,
    exec(sql) {
      raw.exec(sql);
    },
    all(sql, args = []) {
      return raw.prepare(sql).all(...args);
    },
    get(sql, args = []) {
      return raw.prepare(sql).get(...args);
    },
    run(sql, args = []) {
      const r = raw.prepare(sql).run(...args);
      return { changes: Number(r.changes || 0), lastInsertRowid: r.lastInsertRowid };
    },
    begin() {
      raw.exec('BEGIN');
    },
    commit() {
      raw.exec('COMMIT');
    },
    rollback() {
      raw.exec('ROLLBACK');
    },
    async close() {
      raw.close();
    },
  };
}
