/**
 * PostgreSQL 驱动（pg 连接池），用于 Supabase / Railway / Render 等托管 Postgres。
 *
 * 关键设计：
 *  - 每个 HTTP 请求独占一个连接（withClient + AsyncLocalStorage），
 *    这样 BEGIN/COMMIT 事务在请求内天然隔离，并发请求不会互相串用连接。
 *  - INSERT 自动补 RETURNING id，以兼容 SQLite 的 lastInsertRowid 语义。
 *  - SQL 语法差异统一交给 sql.js 翻译，业务代码零改动。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { toPgSql, isInsertStatement, hasReturning } from './sql.js';

const { Pool } = pg;

// 请求级连接作用域：withClient() 内可见
const requestScope = new AsyncLocalStorage();

export function createPostgresDriver({ connectionString, ssl = true, max = 10 }) {
  const pool = new Pool({
    connectionString,
    ssl: ssl === false || ssl === 'false' ? false : { rejectUnauthorized: false },
    max,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  });

  // 连接池错误（网络抖动/休眠唤醒）不应导致进程崩溃
  pool.on('error', (err) => {
    console.error('[db] Postgres 连接池错误:', err.message);
  });

  /** 取当前请求作用域内的连接（无则回落到连接池） */
  const scoped = () => requestScope.getStore()?.client || null;

  const query = async (sql, args = []) => {
    const client = scoped();
    if (client) return client.query(sql, args);
    return pool.query(sql, args);
  };

  const driver = {
    name: 'postgres',
    pool,

    async exec(sql) {
      const client = scoped() || (await pool.connect());
      try {
        return await client.query(sql);
      } finally {
        if (!scoped()) client.release();
      }
    },

    async all(sql, args = []) {
      const res = await query(toPgSql(sql), args);
      return res.rows;
    },

    async get(sql, args = []) {
      const res = await query(toPgSql(sql), args);
      return res.rows[0];
    },

    async run(sql, args = []) {
      let s = toPgSql(sql);
      let needReturning = false;
      if (isInsertStatement(s) && !hasReturning(s)) {
        s += ' RETURNING id';
        needReturning = true;
      }
      const res = await query(s, args);
      return {
        changes: res.rowCount ?? 0,
        lastInsertRowid: needReturning ? res.rows[0]?.id : undefined,
      };
    },

    async begin() {
      const client = scoped();
      if (!client) throw new Error('事务必须在请求作用域内开启');
      await client.query('BEGIN');
      client.__inTx = true;
    },

    async commit() {
      const client = scoped();
      if (!client || !client.__inTx) return;
      try {
        await client.query('COMMIT');
      } finally {
        client.__inTx = false;
      }
    },

    async rollback() {
      const client = scoped();
      if (!client || !client.__inTx) return;
      try {
        await client.query('ROLLBACK');
      } catch (e) {
        console.error('[db] ROLLBACK 失败:', e.message);
      } finally {
        client.__inTx = false;
      }
    },

    /**
     * 在独占连接的作用域内执行 fn（供 HTTP 中间件使用）
     */
    async withClient(fn) {
      const client = await pool.connect();
      try {
        return await requestScope.run({ client }, fn);
      } finally {
        if (client.__inTx) {
          try { await client.query('ROLLBACK'); } catch { /* 连接已断开 */ }
          client.__inTx = false;
        }
        client.release();
      }
    },

    async close() {
      await pool.end();
    },
  };

  return driver;
}
