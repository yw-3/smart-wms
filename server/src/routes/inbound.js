import { Router } from 'express';
import * as XLSX from 'xlsx';
import { db } from '../db.js';
import { requireAuth, requireModule } from '../auth.js';
import { logOperation, wrap } from '../helpers.js';
import { applyInbound, reverseInbound, setBatchQuality } from '../inventory.js';

const router = Router();
router.use(requireAuth, requireModule('inbound'));

// 改单权限：备料员本人 / 物管 / 生产组长 / 管理员
function canModify(req, order) {
  const role = req.user.role;
  if (role === 'manager' || role === 'supervisor' || role === 'admin') return true;
  if (role === 'preparer' && order.operator_id === req.user.sub) return true;
  return false;
}
// 质检确认（待检/不合格 → 合格）仅物管/组长/管理员
function canQc(req) {
  return ['manager', 'supervisor', 'admin'].includes(req.user.role);
}

async function genOrderNo(dateStr) {
  const prefix = 'RK' + dateStr.replace(/-/g, '');
  const cnt = (await db.prepare('SELECT COUNT(*) c FROM inbound_orders WHERE order_no LIKE ?').get(prefix + '%')).c;
  return prefix + '-' + String(cnt + 1).padStart(3, '0');
}

// 录入页下拉与扫码解析所需的基础数据
router.get('/form-data', wrap(async (req, res) => {
  const materials = await db.prepare(
    `SELECT m.code, m.name, m.barcode, m.unit_main, m.unit_sub, m.unit_factor,
            s.code AS supplier_code, l.code AS location_code
       FROM materials m
       LEFT JOIN suppliers s ON m.supplier_id=s.id
       LEFT JOIN locations l ON m.location_id=l.id
      ORDER BY m.code`
  ).all();
  const suppliers = await db.prepare("SELECT code, name FROM suppliers WHERE status='active' ORDER BY code").all();
  const locations = await db.prepare('SELECT code, name, type FROM locations ORDER BY code').all();
  res.json({ materials, suppliers, locations });
}));

// PDA 扫码 / 料号解析：按 条码 或 物料编码 命中
router.get('/resolve', wrap(async (req, res) => {
  const q = String(req.query.code || '').trim();
  if (!q) return res.status(400).json({ error: '请提供条码或料号' });
  const m = await db.prepare(
    `SELECT m.code, m.name, m.barcode, m.unit_main, m.unit_sub, m.unit_factor,
            s.code AS supplier_code, l.code AS location_code
       FROM materials m
       LEFT JOIN suppliers s ON m.supplier_id=s.id
       LEFT JOIN locations l ON m.location_id=l.id
      WHERE m.barcode=? OR m.code=?`
  ).get(q, q);
  if (!m) return res.status(404).json({ error: '未匹配到物料，请检查条码或手动选择' });
  res.json(m);
}));

// 入库记录列表（支持过滤）
router.get('/', wrap(async (req, res) => {
  const { q, quality, status, from, to, operator } = req.query;
  const where = [];
  const params = [];
  if (q) { where.push('(o.material_code LIKE ? OR o.material_name LIKE ? OR o.batch_no LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (quality) { where.push('o.quality_status=?'); params.push(quality); }
  if (status) { where.push('o.status=?'); params.push(status); }
  if (from) { where.push('o.created_at >= ?'); params.push(from); }
  if (to) { where.push("o.created_at <= ?"); params.push(to + ' 23:59:59'); }
  if (operator) { where.push('o.operator_name LIKE ?'); params.push(`%${operator}%`); }
  const sql = `SELECT o.* FROM inbound_orders o
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY o.id DESC LIMIT 500`;
  res.json(await db.prepare(sql).all(...params));
}));

// 批次库存（库位 + 批次 维度，质量闸门核心）
router.get('/batches', wrap(async (req, res) => {
  const rows = await db.prepare(
    `SELECT b.*, m.name AS material_name
       FROM batch_inventory b LEFT JOIN materials m ON b.material_code=m.code
      ORDER BY b.material_code, b.location_code, b.batch_no`
  ).all();
  res.json(rows);
}));

// 总库存（物料 + 库位 维度）
router.get('/stock', wrap(async (req, res) => {
  const rows = await db.prepare(
    `SELECT s.*, m.name AS material_name
       FROM stock s LEFT JOIN materials m ON s.material_code=m.code
      ORDER BY s.material_code, s.location_code`
  ).all();
  res.json(rows);
}));

// Excel 导出（务必在 /:id 之前注册，避免被静态段抢匹配）
router.get('/export', wrap(async (req, res) => {
  const { q, status } = req.query;
  const where = [];
  const params = [];
  if (q) { where.push('(o.material_code LIKE ? OR o.material_name LIKE ? OR o.batch_no LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (status) { where.push('o.status=?'); params.push(status); }
  const rows = await db.prepare(
    `SELECT o.* FROM inbound_orders o ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.id DESC`
  ).all(...params);

  const header = ['单号', '物料编码', '物料名称', '数量', '批次号', '供应商', '库位', '操作员', '状态', '备注', '创建时间'];
  const aoa = [header];
  for (const r of rows) {
    aoa.push([r.order_no, r.material_code, r.material_name, r.qty, r.batch_no,
      r.supplier_code, r.location_code, r.operator_name, r.status, r.remark || '', r.created_at]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '入库记录');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const stamp = new Date().toISOString().slice(0, 10);
  const fname = `入库记录_${stamp}.xlsx`;
  // HTTP 头仅接受 Latin1，中文文件名需 RFC 5987 编码（同时给出 ASCII 回退名）
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="inbound_${stamp}.xlsx"; filename*=UTF-8''${encodeURIComponent(fname)}`
  );
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
}));

// 详情（静态段 /export 已在其上注册）
router.get('/:id', wrap(async (req, res) => {
  const o = await db.prepare('SELECT * FROM inbound_orders WHERE id=?').get(+req.params.id);
  if (!o) return res.status(404).json({ error: '入库单不存在' });
  res.json(o);
}));

// 新建入库单（实时同步库存）
router.post('/', wrap(async (req, res) => {
  const b = req.body || {};
  const materialCode = String(b.materialCode || '').trim();
  const qty = Number(b.qty);
  const batchNo = String(b.batchNo || '').trim();
  const prodDate = b.prodDate || null;
  const expiryDate = b.expiryDate || null;
  const supplierCode = String(b.supplierCode || '').trim();
  const qualityStatus = b.qualityStatus || '合格';
  const locationCode = String(b.locationCode || '').trim();

  if (!materialCode) return res.status(400).json({ error: '物料料号必填' });
  if (!(qty > 0)) return res.status(400).json({ error: '入库数量必须为正数' });
  if (!batchNo) return res.status(400).json({ error: '生产批次号必填' });
  if (!supplierCode) return res.status(400).json({ error: '供应商必填' });
  if (!['待检', '合格', '不合格'].includes(qualityStatus)) return res.status(400).json({ error: '质量状态非法' });
  if (!locationCode) return res.status(400).json({ error: '指定库位必填' });

  const mat = await db.prepare('SELECT name FROM materials WHERE code=?').get(materialCode);
  if (!mat) return res.status(404).json({ error: '物料料号不存在，请先在主数据维护' });
  const materialName = b.materialName || mat.name;

  const orderNo = await genOrderNo(new Date().toISOString().slice(0, 10));
  await db.prepare(
    `INSERT INTO inbound_orders (order_no, material_code, material_name, qty, batch_no, prod_date, expiry_date, supplier_code, quality_status, location_code, operator_id, operator_name, status, remark, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '已提交', ?, datetime('now'))`
  ).run(orderNo, materialCode, materialName, qty, batchNo, prodDate, expiryDate, supplierCode, qualityStatus, locationCode,
        req.user.sub, req.user.realName || req.user.username, b.remark || null);

  await applyInbound({ materialCode, locationCode, batchNo, qty, prodDate, expiryDate, supplierCode, qualityStatus });
  await logOperation(req, '备料入库', 'inbound', `单号 ${orderNo} / ${materialName} ×${qty} / 批 ${batchNo} / ${qualityStatus}`);
  res.status(201).json({ ok: true, orderNo });
}));

// 修改入库单（仅本人/物管/组长；先冲销原库存再按新值入库）
router.patch('/:id', wrap(async (req, res) => {
  const id = +req.params.id;
  const order = await db.prepare('SELECT * FROM inbound_orders WHERE id=?').get(id);
  if (!order) return res.status(404).json({ error: '入库单不存在' });
  if (order.status === '已作废') return res.status(400).json({ error: '已作废单据不可修改' });
  if (!canModify(req, order)) return res.status(403).json({ error: '仅备料员本人、物管或生产组长可修改该单据' });

  const b = req.body || {};
  const qty = b.qty !== undefined ? Number(b.qty) : order.qty;
  const batchNo = (b.batchNo ?? order.batch_no).toString().trim();
  const prodDate = b.prodDate ?? order.prod_date;
  const expiryDate = b.expiryDate ?? order.expiry_date;
  const supplierCode = (b.supplierCode ?? order.supplier_code).toString().trim();
  const qualityStatus = b.qualityStatus ?? order.quality_status;
  const locationCode = (b.locationCode ?? order.location_code).toString().trim();

  if (!(qty > 0)) return res.status(400).json({ error: '入库数量必须为正数' });
  if (!['待检', '合格', '不合格'].includes(qualityStatus)) return res.status(400).json({ error: '质量状态非法' });
  if (!locationCode) return res.status(400).json({ error: '指定库位必填' });
  const mat = await db.prepare('SELECT name FROM materials WHERE code=?').get(order.material_code);
  const materialName = b.materialName || mat?.name || order.material_name;

  await db.begin();
  try {
    await reverseInbound(order);
    await applyInbound({ materialCode: order.material_code, locationCode, batchNo, qty, prodDate, expiryDate, supplierCode, qualityStatus });
    await db.prepare(
      `UPDATE inbound_orders SET material_name=?, qty=?, batch_no=?, prod_date=?, expiry_date=?, supplier_code=?, quality_status=?, location_code=?, remark=?, updated_at=datetime('now') WHERE id=?`
    ).run(materialName, qty, batchNo, prodDate, expiryDate, supplierCode, qualityStatus, locationCode, b.remark ?? order.remark, id);
    await db.commit();
  } catch (e) {
    await db.rollback();
    throw e;
  }
  await logOperation(req, '修改入库单', 'inbound', `单号 ${order.order_no} / ${materialName} ×${qty}`);
  res.json({ ok: true });
}));

// 作废入库单（冲销库存）
router.post('/:id/void', wrap(async (req, res) => {
  const id = +req.params.id;
  const order = await db.prepare('SELECT * FROM inbound_orders WHERE id=?').get(id);
  if (!order) return res.status(404).json({ error: '入库单不存在' });
  if (order.status === '已作废') return res.status(400).json({ error: '该单据已作废' });
  if (!canModify(req, order)) return res.status(403).json({ error: '仅备料员本人、物管或生产组长可作废该单据' });

  await db.begin();
  try {
    await reverseInbound(order);
    await db.prepare("UPDATE inbound_orders SET status='已作废', updated_at=datetime('now') WHERE id=?").run(id);
    await db.commit();
  } catch (e) {
    await db.rollback();
    throw e;
  }
  await logOperation(req, '作废入库单', 'inbound', `单号 ${order.order_no} / 冲销库存`);
  res.json({ ok: true });
}));

// 质检确认（待检/不合格 → 合格/不合格）：仅物管/组长/管理员
router.post('/:id/quality', wrap(async (req, res) => {
  if (!canQc(req)) return res.status(403).json({ error: '质检确认仅物管、生产组长或管理员可执行' });
  const id = +req.params.id;
  const order = await db.prepare('SELECT * FROM inbound_orders WHERE id=?').get(id);
  if (!order) return res.status(404).json({ error: '入库单不存在' });
  if (order.status === '已作废') return res.status(400).json({ error: '已作废单据不可质检' });
  const qs = String(req.body?.qualityStatus || '').trim();
  if (!['合格', '不合格', '待检'].includes(qs)) return res.status(400).json({ error: '质量状态非法' });

  await setBatchQuality(order.material_code, order.location_code, order.batch_no, qs);
  await db.prepare("UPDATE inbound_orders SET quality_status=?, updated_at=datetime('now') WHERE id=?").run(qs, id);
  await logOperation(req, '质检确认', 'inbound', `单号 ${order.order_no} → ${qs}`);
  res.json({ ok: true });
}));

export default router;
