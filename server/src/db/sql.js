/**
 * SQL 方言适配层：把 SQLite 语法翻译为 PostgreSQL 语法。
 *
 * 业务代码统一使用 SQLite 风格的 `?` 占位符与少量 SQLite 函数；
 * 部署到 Supabase/Postgres 时由本模块翻译，业务代码零改动。
 *
 * 翻译规则：
 *  1) 占位符 `?` → `$1,$2,...`（跳过单引号字符串与双引号标识符内部的 ?）
 *  2) `datetime('now')` → `to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')`
 *     （与 SQLite 的 datetime('now') 输出格式完全一致：UTC、秒级精度）
 *  3) `date('now')`      → `to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD')`
 */

/** 占位符转换：? → $n，字符串字面量与双引号标识符内的问号原样保留 */
export function toPgPlaceholders(sql) {
  let out = '';
  let i = 0;
  let n = 1;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      // 单引号字符串：'' 为转义的单引号
      out += ch;
      i += 1;
      while (i < sql.length) {
        out += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            out += sql[i + 1];
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '"') {
      // 双引号标识符
      out += ch;
      i += 1;
      while (i < sql.length) {
        out += sql[i];
        if (sql[i] === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '?') {
      out += `$${n}`;
      n += 1;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** 完整方言翻译 */
export function toPgSql(sql) {
  let s = toPgPlaceholders(sql);
  s = s.replace(/datetime\('now'\)/gi, "to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')");
  s = s.replace(/date\('now'\)/gi, "to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD')");
  return s;
}

/** 是否为 INSERT 语句（Postgres 需要显式 RETURNING 才能拿到自增主键） */
export function isInsertStatement(sql) {
  return /^\s*insert\s/i.test(sql);
}

/** 是否已带 RETURNING */
export function hasReturning(sql) {
  return /\breturning\b/i.test(sql);
}
