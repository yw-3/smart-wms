/**
 * 冒烟/测试数据清理脚本（跨 SQLite / PostgreSQL 通用，走 db.js 门面）。
 *
 * 用途：冒烟测试会生成入库单、领料单、批次库存、库存、操作日志等业务数据，
 * 这些单据在业务上只能「作废」不能物理删除，测试跑完后必须显式清干净，
 * 避免测试残留污染用户的空仓库。
 *
 * 用法：
 *   node scripts/purge-test-data.mjs                # 默认清理 SMOKE- 前缀
 *   node scripts/purge-test-data.mjs --prefix TEST- # 自定义前缀
 *
 * 需设置 DATABASE_URL（Postgres）或 DB_FILE（SQLite）。
 */
import { db, initDb } from '../src/db.js';

const args = process.argv.slice(2);
const pIdx = args.indexOf('--prefix');
const PREFIX = pIdx >= 0 ? args[pIdx + 1] : 'SMOKE-';

await initDb();

console.log(`[purge] 清理前缀 = ${PREFIX}`);

// 步骤 1：先算出要删的领料单 id（单号带前缀，或其明细为测试数据）
// 必须在删明细之前取，因为明细上有 FK 指向单据
const targetOrders = await db.prepare(
  `SELECT id FROM requisition_orders
    WHERE order_no LIKE ?
       OR id IN (SELECT order_id FROM requisition_items
                  WHERE material_code LIKE ? OR batch_no LIKE ?
                     OR from_location_code LIKE ? OR to_location_code LIKE ?)`
).all(`${PREFIX}%`, `${PREFIX}%`, `${PREFIX}%`, `${PREFIX}%`, `${PREFIX}%`);
const orderIds = (targetOrders || []).map((r) => r.id);

// 同时取出要删的入库单/领料单单号，用于清理操作日志（日志 detail 里记的是单号，不含前缀）
const inbNos = (await db.prepare(
  `SELECT order_no FROM inbound_orders
    WHERE order_no LIKE ? OR material_code LIKE ? OR batch_no LIKE ? OR location_code LIKE ?`
).all(`${PREFIX}%`, `${PREFIX}%`, `${PREFIX}%`, `${PREFIX}%`) || []).map((r) => r.order_no);
const reqNos = (await db.prepare(
  `SELECT order_no FROM requisition_orders
    WHERE order_no LIKE ?
       OR id IN (SELECT order_id FROM requisition_items
                  WHERE material_code LIKE ? OR batch_no LIKE ?
                     OR from_location_code LIKE ? OR to_location_code LIKE ?)`
).all(`${PREFIX}%`, `${PREFIX}%`, `${PREFIX}%`, `${PREFIX}%`, `${PREFIX}%`) || []).map((r) => r.order_no);
const allNos = [...inbNos, ...reqNos];

// 步骤 2：先清操作日志（必须在删单据之前，日志里记的是单号）
//  - detail 含测试前缀（如 SMOKE-）
//  - detail 含本次要删的单号
//  - detail 含测试物料/库位/批次
{
  let logDeleted = 0;
  const r0 = await db.prepare(`DELETE FROM operation_logs WHERE detail LIKE ?`).run(`%${PREFIX}%`);
  logDeleted += r0.changes;
  for (const no of allNos) {
    const r = await db.prepare(`DELETE FROM operation_logs WHERE detail LIKE ?`).run(`%${no}%`);
    logDeleted += r.changes;
  }
  console.log(`  operation_logs: 删除 ${logDeleted} 行`);
}

// 步骤 3：按依赖顺序删除业务数据
const steps = [
  // 领料明细：按物料码/批次/库位判定
  ['requisition_items', `DELETE FROM requisition_items
     WHERE material_code LIKE ? OR batch_no LIKE ?
        OR from_location_code LIKE ? OR to_location_code LIKE ?`],
  // 批次库存 / 库存汇总
  ['batch_inventory', `DELETE FROM batch_inventory
     WHERE material_code LIKE ? OR batch_no LIKE ? OR location_code LIKE ?`],
  ['stock', `DELETE FROM stock
     WHERE material_code LIKE ? OR location_code LIKE ?`],
  // 入库单：单号无前缀时按物料/批次/库位判定
  ['inbound_orders', `DELETE FROM inbound_orders
     WHERE order_no LIKE ? OR material_code LIKE ? OR batch_no LIKE ? OR location_code LIKE ?`],
  // 主数据
  ['materials', `DELETE FROM materials WHERE code LIKE ?`],
  ['locations', `DELETE FROM locations WHERE code LIKE ?`],
];

for (const [table, sql] of steps) {
  const n = (sql.match(/\?/g) || []).length;
  const r = await db.prepare(sql).run(...new Array(n).fill(`${PREFIX}%`));
  console.log(`  ${table}: 删除 ${r.changes} 行`);
}

// 步骤 4：删除领料单（明细已清空，FK 不再阻塞）
if (orderIds.length) {
  const ph = orderIds.map(() => '?').join(',');
  const r = await db.prepare(`DELETE FROM requisition_orders WHERE id IN (${ph})`).run(...orderIds);
  console.log(`  requisition_orders: 删除 ${r.changes} 行`);
}

// 步骤 5：清理"孤儿日志"
// 上面的删除只覆盖本轮能查到的单号；历史跑测遗留的日志（其单据早已被删）
// 属于测试残留，需要按"日志里提到的单号在库中已不存在"来判定。
// 为保证跨 SQLite/Postgres 通用，这里在 JS 层做判定，不依赖方言函数。
{
  const logs = await db.prepare(`SELECT id, detail FROM operation_logs`).all();
  const liveNos = new Set([
    ...(await db.prepare(`SELECT order_no FROM inbound_orders`).all() || []).map((r) => r.order_no),
    ...(await db.prepare(`SELECT order_no FROM requisition_orders`).all() || []).map((r) => r.order_no),
  ]);
  const orphanIds = [];
  for (const l of logs || []) {
    const d = String(l.detail || '');
    if (d.includes(PREFIX)) { orphanIds.push(l.id); continue; }
    // 形如「单号 RK20261021-001 / ...」，抓取其中所有单号
    const nos = d.match(/(?:RK|LL|DB|CK)[\w-]+/g) || [];
    if (nos.length && nos.every((n) => !liveNos.has(n))) orphanIds.push(l.id);
  }
  if (orphanIds.length) {
    const ph = orphanIds.map(() => '?').join(',');
    const r = await db.prepare(`DELETE FROM operation_logs WHERE id IN (${ph})`).run(...orphanIds);
    console.log(`  operation_logs(孤儿): 删除 ${r.changes} 行`);
  }
}

console.log('[purge] 完成');
await db.close();
