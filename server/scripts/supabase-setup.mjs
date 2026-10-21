/**
 * Supabase 一键部署助手（供部署时使用，也可作长期运维工具）
 *
 * 用法：
 *   node scripts/supabase-setup.mjs "<数据库密码>"
 *   node scripts/supabase-setup.mjs "<数据库密码>" --ref jdrbatffypobjinxpcK --region aws-0-ap-northeast-1
 *
 * 作用：
 *   1. 用项目 ref + 密码拼出连接串，直连 Supabase Postgres
 *   2. 列出已有表，检测与本系统 14 张表是否冲突
 *   3. 无冲突 → 自动执行 schema.pg.sql 建表（幂等）；有冲突 → 报告冲突表并中止
 *   4. 校验建表结果，输出给 Render 用的 DATABASE_URL
 *
 * 依赖：supabase 项目需在设置中开启「连接池 → Session 模式」(端口 5432)。
 *      本系统使用显式事务（BEGIN/COMMIT），不能使用 Transaction 模式(6543)。
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

// 本系统需要的 14 张表
const REQUIRED_TABLES = [
  'users', 'suppliers', 'locations', 'units', 'materials', 'operation_logs',
  'inbound_orders', 'batch_inventory', 'stock', 'products', 'bom',
  'production_lines', 'requisition_orders', 'requisition_items',
];

const args = process.argv.slice(2);
const password = args.find((a) => !a.startsWith('--') && !a.startsWith('-'));
if (!password) {
  console.error('用法: node scripts/supabase-setup.mjs "<数据库密码>" [--ref <项目ref>] [--region <region>]');
  process.exit(1);
}
const refIdx = args.indexOf('--ref');
const regIdx = args.indexOf('--region');
const REF = refIdx >= 0 ? args[refIdx + 1] : 'jdrbatffypobjinxpcK';
const REGION = regIdx >= 0 ? args[regIdx + 1] : 'aws-0-ap-northeast-1';

// Session 池化模式（5432）：与显式事务兼容
const host = `aws-0-${REGION.replace(/^aws-0-/, '')}.pool.supabase.com`;
const encPw = encodeURIComponent(password);
const DATABASE_URL = `postgresql://postgres.${REF}:${encPw}@${host}:5432/postgres`;

console.log('目标项目 ref :', REF);
console.log('连接方式     : Session 池化模式 (5432，兼容显式事务)');
console.log('');

const client = new Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});

try {
  await client.connect();
  console.log('✅ 已连接 Supabase 数据库');

  // 1) 现有表
  const { rows: existing } = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`
  );
  const names = existing.map((r) => r.table_name);
  console.log(`\n现有表 ${names.length} 张：${names.join(', ') || '（空）'}`);

  // 2) 冲突检测
  const conflicts = REQUIRED_TABLES.filter((t) => names.includes(t));
  const extra = names.filter((t) => !REQUIRED_TABLES.includes(t));
  if (extra.length) console.log(`非本系统的表（保留不动）：${extra.join(', ')}`);

  if (conflicts.length) {
    console.log(`\n❌ 检测到同名表冲突：${conflicts.join(', ')}`);
    console.log('这些表可能来自其它项目/其它任务，结构可能与本系统不同。');
    console.log('处理建议（选一种）：');
    console.log('  A. 保留本系统表：把这些表改名/删除后重跑本脚本');
    console.log('  B. 为本系统新建一个独立的 Supabase 项目（免费额度允许 2 个项目），最干净');
    await client.end();
    process.exit(2);
  }
  console.log('✅ 无表名冲突，可安全建表');

  // 3) 建表
  const sql = readFileSync(join(__dirname, '..', 'schema.pg.sql'), 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✅ schema.pg.sql 执行成功');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }

  // 4) 校验
  const { rows: after } = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`
  );
  const afterNames = after.map((r) => r.table_name);
  const missing = REQUIRED_TABLES.filter((t) => !afterNames.includes(t));
  console.log(`\n建表结果：${afterNames.length} 张表` + (missing.length ? `，❌ 缺少 ${missing.join(', ')}` : '，✅ 14 张表齐全'));
  const { rows: idx } = await client.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' ORDER BY indexname`
  );
  console.log(`索引：${idx.length} 个`);

  await client.end();

  console.log('\n========== 复制下面这行到 Render 的 DATABASE_URL ==========');
  console.log(DATABASE_URL);
  console.log('==========================================================');
  console.log('\n下一步：Render → New → Blueprint → 选仓库 → Environment 填 DATABASE_URL 与 JWT_SECRET');
} catch (e) {
  console.error('\n❌ 失败：', e.message);
  if (/password|auth/i.test(e.message)) {
    console.error('提示：密码不对，或该密码含特殊字符未做 URL 编码（本脚本已自动编码）。');
  }
  if (/ENOTFOUND|EAI_AGAIN|timeout/i.test(e.message)) {
    console.error('提示：连不上数据库，请检查项目 ref / region 是否正确（region 可在 Supabase 控制台 Project Settings → Database 查看）。');
  }
  try { await client.end(); } catch { /* ignore */ }
  process.exit(1);
}
