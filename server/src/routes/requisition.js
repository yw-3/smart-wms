import { Router } from 'express';
import * as XLSX from 'xlsx';
import { db } from '../db.js';
import { requireAuth, requireModule } from '../auth.js';
import { logOperation, wrap } from '../helpers.js';
import { transferBatch, fifoAllocate } from '../inventory.js';

const router = Router();
router.use(requireAuth, requireModule('requisition'));

// 临期阈值（天）：效期距今天数小于该值视为临期，禁止领用
const NEAR_DAYS = 30;

// 改单/作废权限：领料员本人 / 物管 / 生产组长 / 管理员
function canModify(req, order) {
  const role = req.user.role;
  if (['manager', 'supervisor', 'admin'].includes(role)) return true;
  if (role === 'picker' && order.operator_id === req.user.sub) return true;
  return false;
}

async function genReqNo(dateStr) {
  const prefix = 'LL' + dateStr.replace(/-/g, '');
  const cnt = (await db.prepare('SELECT COUNT(*) c FROM requisition_orders WHERE order_no LIKE ?').get(prefix + '%')).c;
  return prefix + '-' + String(cnt + 1).padStart(3, '0');
}

// 计算 limit = today + NEAR_DAYS（与 SQL date() 一致，使用 UTC 基准）
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// 批次是否合格可领（合格 + 有保质期则未过期/非临期；未记录保质期不做过期校验）
function isEligible(expiry, quality) {
  if (quality !== '合格') return false;
  if (!expiry) return true;
  const today = new Date().toISOString().slice(0, 10);
  const limit = addDays(today, NEAR_DAYS);
  // 'YYYY-MM-DD' 字符串字典序即日期序
  return expiry > limit;
}

// 物料编码 → 名称 映射（缓存一次）
async function materialNameMap() {
  return (await db.prepare('SELECT code,name FROM materials').all()).reduce((m, x) => { m[x.code] = x.name; return m; }, {});
}

// 冲销领料单下的所有调拨（线边仓 → 主仓）
async function reverseRequisitionItems(orderId) {
  const items = await db.prepare('SELECT * FROM requisition_items WHERE order_id=?').all(orderId);
  for (const it of items) {
    await transferBatch(it.material_code, it.batch_no, it.to_location_code, it.from_location_code, it.qty);
  }
}

// 校验并写入领料明细，同时执行 主仓 → 线边仓 调拨
async function applyRequisitionItems(orderId, items, toLoc, matNames) {
  const insItem = db.prepare(
    `INSERT INTO requisition_items (order_id, material_code, material_name, qty, batch_no, prod_date, expiry_date, from_location_code, to_location_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const it of items) {
    const materialCode = String(it.materialCode || '').trim();
    const batchNo = String(it.batchNo || '').trim();
    const fromLoc = String(it.fromLocationCode || '').trim();
    const qty = Number(it.qty);
    if (!materialCode) throw new Error('存在物料料号为空');
    if (!(qty > 0)) throw new Error(`物料 ${materialCode} 领料数量必须为正数`);
    if (!batchNo) throw new Error(`物料 ${materialCode} 未指定批次`);
    if (!fromLoc) throw new Error(`物料 ${materialCode} 未指定来源库位`);

    const bat = await db.prepare(
      'SELECT * FROM batch_inventory WHERE material_code=? AND location_code=? AND batch_no=?'
    ).get(materialCode, fromLoc, batchNo);
    if (!bat) throw new Error(`批次 ${batchNo}（${materialCode}）在主仓 ${fromLoc} 不存在`);
    if (bat.quality_status !== '合格') throw new Error(`批次 ${batchNo} 质量状态为「${bat.quality_status}」，禁止领用`);
    if (bat.qty < qty) throw new Error(`批次 ${batchNo} 库存不足（现有 ${bat.qty}）`);
    if (!isEligible(bat.expiry_date, bat.quality_status)) throw new Error(`批次 ${batchNo} 已过期或临期，禁止领用`);

    await insItem.run(orderId, materialCode, matNames[materialCode] || '', qty, batchNo, bat.prod_date, bat.expiry_date, fromLoc, toLoc);
    await transferBatch(materialCode, batchNo, fromLoc, toLoc, qty);
  }
}

// 录入页基础数据：物料、产线、成品、BOM 映射
router.get('/form-data', wrap(async (req, res) => {
  const materials = await db.prepare('SELECT code, name, abc_class FROM materials ORDER BY code').all();
  const lines = await db.prepare('SELECT line_no, name, line_location_code FROM production_lines ORDER BY line_no').all();
  const lineSideLocations = await db.prepare("SELECT code, name, type FROM locations WHERE type='线边仓' ORDER BY code").all();
  const products = await db.prepare("SELECT code, name, spec FROM products WHERE status='active' ORDER BY code").all();
  const bomRows = await db.prepare(
    `SELECT b.product_code, b.component_code, b.qty_per_unit, m.name AS component_name
       FROM bom b LEFT JOIN materials m ON b.component_code=m.code
      ORDER BY b.product_code, b.component_code`
  ).all();
  const bomMap = {};
  for (const r of bomRows) {
    (bomMap[r.product_code] ||= []).push({ componentCode: r.component_code, name: r.component_name, qtyPerUnit: r.qty_per_unit });
  }
  res.json({ materials, lines, products, bomMap, lineSideLocations });
}));

// BOM 一键领料：按成品料号 + 计划产量展开各组件需求，并用 FIFO 推荐批次
router.get('/bom-plan', wrap(async (req, res) => {
  const productCode = String(req.query.productCode || '').trim();
  const planQty = Number(req.query.qty);
  if (!productCode) return res.status(400).json({ error: '请提供成品料号' });
  if (!(planQty > 0)) return res.status(400).json({ error: '计划产量必须为正数' });
  const bom = await db.prepare('SELECT component_code, qty_per_unit FROM bom WHERE product_code=?').all(productCode);
  if (!bom.length) return res.status(404).json({ error: '该成品未配置 BOM' });

  const matNames = await materialNameMap();
  const plan = [];
  for (const b of bom) {
    const need = b.qty_per_unit * planQty;
    const r = await fifoAllocate(b.component_code, need);
    plan.push({
      componentCode: b.component_code,
      name: matNames[b.component_code] || '',
      qtyPerUnit: b.qty_per_unit,
      need,
      allocated: r.allocated,
      shortage: r.shortage,
      batches: r.plan.map((p) => ({
        batchNo: p.batchNo, fromLocationCode: p.fromLocationCode, qty: p.qty, expiryDate: p.expiryDate,
      })),
    });
  }
  res.json({ productCode, planQty, plan });
}));

// 手动增补：主仓某物料的可用批次（合格/未过期/非临期 才可领）
router.get('/main-batches', wrap(async (req, res) => {
  const materialCode = String(req.query.materialCode || '').trim();
  const rows = await db.prepare(
    `SELECT b.material_code, b.batch_no, b.location_code, b.qty, b.expiry_date, b.prod_date, b.quality_status, m.name AS material_name
       FROM batch_inventory b
       LEFT JOIN materials m ON b.material_code=m.code
       LEFT JOIN locations l ON b.location_code=l.code
      WHERE b.qty>0 AND COALESCE(l.type,'主仓')='主仓'
        ${materialCode ? 'AND b.material_code=?' : ''}
      ORDER BY b.material_code, b.expiry_date ASC, b.batch_no ASC`
  ).all(...(materialCode ? [materialCode] : []));
  const out = rows.map((r) => ({ ...r, eligible: isEligible(r.expiry_date, r.quality_status) }));
  res.json(out);
}));

// 产线台账：各线边仓当前在库（按线聚合）
router.get('/line-ledger', wrap(async (req, res) => {
  const { lineNo } = req.query;
  let lines = await db.prepare('SELECT * FROM production_lines ORDER BY line_no').all();
  if (lineNo) lines = lines.filter((l) => l.line_no === Number(lineNo));
  const out = [];
  for (const l of lines) {
    const rows = await db.prepare(
      `SELECT b.material_code, b.batch_no, b.qty, b.expiry_date, b.prod_date, b.quality_status, m.name AS material_name
         FROM batch_inventory b LEFT JOIN materials m ON b.material_code=m.code
        WHERE b.location_code=? AND b.qty>0
        ORDER BY b.material_code, b.batch_no`
    ).all(l.line_location_code);
    out.push({ lineNo: l.line_no, lineName: l.name, locationCode: l.line_location_code, batches: rows });
  }
  res.json(out);
}));

// 领料记录列表（支持过滤）
router.get('/', wrap(async (req, res) => {
  const { q, lineNo, status, from, to, operator } = req.query;
  const where = [];
  const params = [];
  if (q) { where.push('(o.order_no LIKE ? OR o.remark LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (lineNo) { where.push('o.line_no=?'); params.push(Number(lineNo)); }
  if (status) { where.push('o.status=?'); params.push(status); }
  if (from) { where.push('o.created_at >= ?'); params.push(from); }
  if (to) { where.push("o.created_at <= ?"); params.push(to + ' 23:59:59'); }
  if (operator) { where.push('o.operator_name LIKE ?'); params.push(`%${operator}%`); }
  const sql = `SELECT o.*, (SELECT COUNT(*) FROM requisition_items WHERE order_id=o.id) AS item_count
    FROM requisition_orders o
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY o.id DESC LIMIT 500`;
  res.json(await db.prepare(sql).all(...params));
}));

// Excel 导出（务必在 /:id 之前注册）
router.get('/export', wrap(async (req, res) => {
  const { q, lineNo, status } = req.query;
  const where = [];
  const params = [];
  if (q) { where.push('(o.order_no LIKE ? OR o.remark LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (lineNo) { where.push('o.line_no=?'); params.push(Number(lineNo)); }
  if (status) { where.push('o.status=?'); params.push(status); }
  const rows = await db.prepare(
    `SELECT o.order_no, o.line_no, o.source_type, i.material_code, i.material_name, i.qty, i.batch_no, i.from_location_code, i.to_location_code, o.operator_name, o.status, o.created_at
       FROM requisition_orders o
       LEFT JOIN requisition_items i ON i.order_id=o.id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY o.id DESC, i.id ASC`
  ).all(...params);

  const header = ['领料单号', '线别', '来源', '物料编码', '物料名称', '数量', '批次号', '来源库位', '目标库位', '领料人', '状态', '创建时间'];
  const aoa = [header];
  for (const r of rows) {
    aoa.push([r.order_no, r.line_no + '号线', r.source_type, r.material_code, r.material_name, r.qty, r.batch_no,
      r.from_location_code, r.to_location_code, r.operator_name, r.status, r.created_at]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '领料记录');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const stamp = new Date().toISOString().slice(0, 10);
  const fname = `领料记录_${stamp}.xlsx`;
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="requisition_${stamp}.xlsx"; filename*=UTF-8''${encodeURIComponent(fname)}`
  );
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
}));

// 详情（静态段 /export、/form-data 等已在其上注册）
router.get('/:id', wrap(async (req, res) => {
  const o = await db.prepare('SELECT * FROM requisition_orders WHERE id=?').get(+req.params.id);
  if (!o) return res.status(404).json({ error: '领料单不存在' });
  const items = await db.prepare('SELECT * FROM requisition_items WHERE order_id=? ORDER BY id').all(o.id);
  res.json({ ...o, items });
}));

// 新建领料单（实时调拨 主仓 → 线边仓）
router.post('/', wrap(async (req, res) => {
  const b = req.body || {};
  const lineNo = Number(b.lineNo);
  const items = Array.isArray(b.items) ? b.items : [];
  const sourceType = b.sourceType === '手动' ? '手动' : 'BOM';

  if (!(lineNo >= 1 && lineNo <= 6)) return res.status(400).json({ error: '请选择 1-6 号线' });
  if (!items.length) return res.status(400).json({ error: '领料明细不能为空' });
  const line = await db.prepare('SELECT * FROM production_lines WHERE line_no=?').get(lineNo);
  if (!line) return res.status(400).json({ error: '产线不存在' });
  // 目标线边仓：优先取前端所选；未选时回退产线已绑定库位
  const toLoc = String(b.toLoc || '').trim() || String(line.line_location_code || '').trim();
  const loc = toLoc ? await db.prepare('SELECT * FROM locations WHERE code=?').get(toLoc) : null;
  if (!toLoc || !loc) return res.status(400).json({ error: '请选择目标线边仓库位（需先在库位档案创建「线边仓」类型库位）' });
  if (loc.type !== '线边仓') return res.status(400).json({ error: `库位 ${toLoc} 不是「线边仓」类型，不能作为调拨目标` });

  const today = new Date().toISOString().slice(0, 10);
  const orderNo = await genReqNo(today);
  const matNames = await materialNameMap();

  await db.begin();
  try {
    // 绑定/刷新产线 → 线边仓 关系（以本次领料所选为准）
    await db.prepare('UPDATE production_lines SET line_location_code=? WHERE line_no=?').run(toLoc, lineNo);
    const r = await db.prepare(
      `INSERT INTO requisition_orders (order_no, line_no, operator_id, operator_name, source_type, status, remark, created_at)
       VALUES (?, ?, ?, ?, ?, '已提交', ?, datetime('now'))`
    ).run(orderNo, lineNo, req.user.sub, req.user.realName || req.user.username, sourceType, b.remark || null);
    await applyRequisitionItems(Number(r.lastInsertRowid), items, toLoc, matNames);
    await db.commit();
  } catch (e) {
    await db.rollback();
    return res.status(400).json({ error: e.message || '创建失败' });
  }
  await logOperation(req, '产线领料', 'requisition', `单号 ${orderNo} / ${lineNo}号线 / ${sourceType} / ${items.length} 项`);
  res.status(201).json({ ok: true, orderNo });
}));

// 修改领料单（仅本人/物管/组长；先冲销原调拨再按新明细重做）
router.patch('/:id', wrap(async (req, res) => {
  const id = +req.params.id;
  const order = await db.prepare('SELECT * FROM requisition_orders WHERE id=?').get(id);
  if (!order) return res.status(404).json({ error: '领料单不存在' });
  if (order.status === '已作废') return res.status(400).json({ error: '已作废单据不可修改' });
  if (!canModify(req, order)) return res.status(403).json({ error: '仅领料员本人、物管或生产组长可修改该单据' });

  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return res.status(400).json({ error: '领料明细不能为空' });
  // 目标线边仓：优先取本次所选；未选时沿用该产线已绑定库位
  const boundLine = await db.prepare('SELECT * FROM production_lines WHERE line_no=?').get(order.line_no);
  const toLoc = String(b.toLoc || '').trim() || String(boundLine?.line_location_code || '').trim();
  const loc = toLoc ? await db.prepare('SELECT * FROM locations WHERE code=?').get(toLoc) : null;
  if (!toLoc || !loc) return res.status(400).json({ error: '请选择目标线边仓库位（需先在库位档案创建「线边仓」类型库位）' });
  if (loc.type !== '线边仓') return res.status(400).json({ error: `库位 ${toLoc} 不是「线边仓」类型，不能作为调拨目标` });
  const matNames = await materialNameMap();

  await db.begin();
  try {
    await db.prepare('UPDATE production_lines SET line_location_code=? WHERE line_no=?').run(toLoc, order.line_no);
    await reverseRequisitionItems(id);
    await db.prepare('DELETE FROM requisition_items WHERE order_id=?').run(id);
    await applyRequisitionItems(id, items, toLoc, matNames);
    await db.prepare("UPDATE requisition_orders SET source_type=?, remark=?, updated_at=datetime('now') WHERE id=?")
      .run(b.sourceType === '手动' ? '手动' : 'BOM', b.remark ?? order.remark, id);
    await db.commit();
  } catch (e) {
    await db.rollback();
    return res.status(400).json({ error: e.message || '修改失败' });
  }
  await logOperation(req, '修改领料单', 'requisition', `单号 ${order.order_no} / ${items.length} 项`);
  res.json({ ok: true });
}));

// 作废领料单（冲销线边仓全部调拨）
router.post('/:id/void', wrap(async (req, res) => {
  const id = +req.params.id;
  const order = await db.prepare('SELECT * FROM requisition_orders WHERE id=?').get(id);
  if (!order) return res.status(404).json({ error: '领料单不存在' });
  if (order.status === '已作废') return res.status(400).json({ error: '该单据已作废' });
  if (!canModify(req, order)) return res.status(403).json({ error: '仅领料员本人、物管或生产组长可作废该单据' });

  await db.begin();
  try {
    await reverseRequisitionItems(id);
    await db.prepare("UPDATE requisition_orders SET status='已作废', updated_at=datetime('now') WHERE id=?").run(id);
    await db.commit();
  } catch (e) {
    await db.rollback();
    throw e;
  }
  await logOperation(req, '作废领料单', 'requisition', `单号 ${order.order_no} / 冲销线边仓`);
  res.json({ ok: true });
}));

export default router;
