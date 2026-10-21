import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { db } from '../db.js';
import { requireAuth, requireModule } from '../auth.js';
import { logOperation, wrap, readSheetRows } from '../helpers.js';

const router = Router();
router.use(requireAuth, requireModule('master'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// 下拉选项（供应商/库位）
router.get('/options', wrap(async (req, res) => {
  const suppliers = await db.prepare("SELECT id,code,name FROM suppliers WHERE status='active'").all();
  const locations = await db.prepare('SELECT id,code,name,type FROM locations').all();
  const units = (await db.prepare('SELECT DISTINCT main_unit FROM units').all()).map(u => u.main_unit);
  res.json({ suppliers, locations, units });
}));

/* ---------------- 物料主数据 ---------------- */
const MATERIAL_COLS = 'm.id,m.code,m.name,m.category,m.remark,m.barcode,m.unit_main,m.unit_sub,m.unit_factor,m.abc_class,m.safety_stock,m.status,m.created_at,m.updated_at,s.code AS supplier_code,s.name AS supplier_name,l.code AS location_code,l.name AS location_name';

function toMaterial(row) {
  if (!row) return null;
  return {
    id: row.id, code: row.code, name: row.name, category: row.category, remark: row.remark, barcode: row.barcode,
    unitMain: row.unit_main, unitSub: row.unit_sub, unitFactor: row.unit_factor,
    abcClass: row.abc_class, safetyStock: row.safety_stock, status: row.status,
    supplierCode: row.supplier_code, supplierName: row.supplier_name,
    locationCode: row.location_code, locationName: row.location_name,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

router.get('/materials', wrap(async (req, res) => {
  const kw = (req.query.q || '').trim();
  let rows;
  if (kw) {
    rows = await db.prepare(
      `SELECT ${MATERIAL_COLS} FROM materials m
       LEFT JOIN suppliers s ON m.supplier_id=s.id
       LEFT JOIN locations l ON m.location_id=l.id
       WHERE m.code LIKE ? OR m.name LIKE ?
       ORDER BY m.code`
    ).all(`%${kw}%`, `%${kw}%`);
  } else {
    rows = await db.prepare(
      `SELECT ${MATERIAL_COLS} FROM materials m
       LEFT JOIN suppliers s ON m.supplier_id=s.id
       LEFT JOIN locations l ON m.location_id=l.id
       ORDER BY m.code`
    ).all();
  }
  res.json(rows.map(toMaterial));
}));

router.post('/materials', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.code || !b.name) return res.status(400).json({ error: '物料编码与名称为必填项' });
  const exist = await db.prepare('SELECT id FROM materials WHERE code=?').get(b.code);
  if (exist) return res.status(409).json({ error: '物料编码已存在（一物一码，禁止重复）' });
  const supplierId = b.supplierCode ? await db.prepare('SELECT id FROM suppliers WHERE code=?').get(b.supplierCode)?.id ?? null : null;
  const locationId = b.locationCode ? await db.prepare('SELECT id FROM locations WHERE code=?').get(b.locationCode)?.id ?? null : null;
  // 物料主数据不再单列「规格」：规格一律并入名称（兼容旧客户端传入的 spec 字段）
  let mName = String(b.name || '').trim();
  const specIn = String(b.spec || '').trim();
  if (specIn && !mName.endsWith(specIn)) mName += specIn;
  await db.prepare(
    `INSERT INTO materials (code,name,category,remark,barcode,unit_main,unit_sub,unit_factor,abc_class,supplier_id,location_id,safety_stock)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(b.code, mName, b.category || null, b.remark || null, b.barcode || null, b.unitMain || null, b.unitSub || null,
        b.unitFactor ?? null, b.abcClass || 'C', supplierId, locationId, b.safetyStock || 0);
  await logOperation(req, '新增物料', 'master', `物料编码 ${b.code} / ${b.name}`);
  res.status(201).json({ ok: true });
}));

router.patch('/materials/:id', wrap(async (req, res) => {
  const id = +req.params.id;
  const b = req.body || {};
  const cur = await db.prepare('SELECT * FROM materials WHERE id=?').get(id);
  if (!cur) return res.status(404).json({ error: '物料不存在' });
  const supplierId = b.supplierCode !== undefined
    ? (b.supplierCode ? await db.prepare('SELECT id FROM suppliers WHERE code=?').get(b.supplierCode)?.id ?? null : null)
    : cur.supplier_id;
  const locationId = b.locationCode !== undefined
    ? (b.locationCode ? await db.prepare('SELECT id FROM locations WHERE code=?').get(b.locationCode)?.id ?? null : null)
    : cur.location_id;
  // 规格已废弃：若传入 spec 则并入名称，UPDATE 不再写 spec 列
  let name = b.name ?? cur.name;
  const specIn = String(b.spec ?? '').trim();
  if (specIn && !name.endsWith(specIn)) name += specIn;
  await db.prepare(
    `UPDATE materials SET name=?,category=?,remark=?,barcode=?,unit_main=?,unit_sub=?,unit_factor=?,abc_class=?,supplier_id=?,location_id=?,safety_stock=?,status=?,updated_at=datetime('now') WHERE id=?`
  ).run(name, b.category ?? cur.category, b.remark ?? cur.remark, b.barcode ?? cur.barcode, b.unitMain ?? cur.unit_main,
        b.unitSub ?? cur.unit_sub, b.unitFactor ?? cur.unit_factor, b.abcClass ?? cur.abc_class,
        supplierId, locationId, b.safetyStock ?? cur.safety_stock, b.status ?? cur.status, id);
  await logOperation(req, '修改物料', 'master', `物料 ${cur.code} 字段更新`);
  res.json({ ok: true });
}));

router.delete('/materials/:id', wrap(async (req, res) => {
  const id = +req.params.id;
  const cur = await db.prepare('SELECT code FROM materials WHERE id=?').get(id);
  if (!cur) return res.status(404).json({ error: '物料不存在' });
  await db.prepare('DELETE FROM materials WHERE id=?').run(id);
  await logOperation(req, '删除物料', 'master', `物料 ${cur.code} 已删除`);
  res.json({ ok: true });
}));

// Excel 批量导入（按真实表格式）：类别 | 料号 | 品名 | 备注
// 类别按行读取；若某行类别为空，自动沿用上一条类别（兼容合并单元格导出的表格）
// 同时兼容旧版完整列（规格/主单位/副单位/换算系数/供应商编码/库位编码/ABC分类/安全库存）
router.post('/materials/import', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  let rows;
  try {
    rows = readSheetRows(req.file);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  let imported = 0, skipped = 0, duplicated = 0;
  const errors = [];
  const categorySet = new Set();
  let lastCategory = '';
  if (!rows.length) return res.status(400).json({ error: '表格内容为空：请确认表头为「类别｜料号｜品名｜备注」且至少有一行数据' });
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const lineNo = i + 2; // 数据从第 2 行开始（第 1 行为表头）
    let category = String(r['类别'] || r['分类'] || r['品类'] || r['物料类别'] || r['category'] || '').trim();
    if (category) { lastCategory = category; categorySet.add(category); } else { category = lastCategory; }
    const code = String(r['料号'] || r['物料编码'] || r['编码'] || r['code'] || '').trim();
    const name = String(r['品名'] || r['物料名称'] || r['名称'] || r['name'] || '').trim();
    const remark = String(r['备注'] || r['remark'] || '').trim() || null;
    if (!code || !name) { skipped++; errors.push(`第 ${lineNo} 行：料号或品名为空，已跳过`); continue; }
    if (await db.prepare('SELECT id FROM materials WHERE code=?').get(code)) { skipped++; duplicated++; continue; }
    // 规格不再单列：若表格带「规格」列，值并入名称
    let mName = name;
    const specCol = String(r['规格'] || r['spec'] || '').trim();
    if (specCol && !mName.endsWith(specCol)) mName += specCol;
    const supCode = String(r['供应商编码'] || '').trim();
    const locCode = String(r['库位编码'] || '').trim();
    const supplierId = supCode ? await db.prepare('SELECT id FROM suppliers WHERE code=?').get(supCode)?.id ?? null : null;
    const locationId = locCode ? await db.prepare('SELECT id FROM locations WHERE code=?').get(locCode)?.id ?? null : null;
    await db.prepare(
      `INSERT INTO materials (code,name,category,remark,unit_main,unit_sub,unit_factor,abc_class,supplier_id,location_id,safety_stock,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(code, mName, category || null, remark,
          String(r['主单位'] || '').trim() || null, String(r['副单位'] || '').trim() || null,
          Number(r['换算系数']) || null, String(r['ABC分类'] || '').trim() || 'C',
          supplierId, locationId, Number(r['安全库存']) || 0, 'active');
    imported++;
  }
  await logOperation(req, '批量导入物料', 'master', `导入 ${imported} 条，跳过 ${skipped} 条`);
  res.json({ imported, skipped, duplicated, categories: [...categorySet], errors });
}));

/* ---------------- 供应商 ---------------- */
router.get('/suppliers', wrap(async (req, res) => {
  const rows = await db.prepare('SELECT id,code,name,contact,phone,address,status FROM suppliers ORDER BY code').all();
  res.json(rows);
}));
router.post('/suppliers', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.code || !b.name) return res.status(400).json({ error: '供应商编码与名称为必填' });
  if (await db.prepare('SELECT id FROM suppliers WHERE code=?').get(b.code)) return res.status(409).json({ error: '供应商编码已存在' });
  await db.prepare('INSERT INTO suppliers (code,name,contact,phone,address) VALUES (?,?,?,?,?)')
    .run(b.code, b.name, b.contact || null, b.phone || null, b.address || null);
  await logOperation(req, '新增供应商', 'master', `供应商 ${b.code} / ${b.name}`);
  res.status(201).json({ ok: true });
}));
router.patch('/suppliers/:id', wrap(async (req, res) => {
  const id = +req.params.id, b = req.body || {};
  const cur = await db.prepare('SELECT * FROM suppliers WHERE id=?').get(id);
  if (!cur) return res.status(404).json({ error: '供应商不存在' });
  await db.prepare('UPDATE suppliers SET name=?,contact=?,phone=?,address=?,status=? WHERE id=?')
    .run(b.name ?? cur.name, b.contact ?? cur.contact, b.phone ?? cur.phone, b.address ?? cur.address, b.status ?? cur.status, id);
  await logOperation(req, '修改供应商', 'master', `供应商 ${cur.code}`);
  res.json({ ok: true });
}));
router.delete('/suppliers/:id', wrap(async (req, res) => {
  const id = +req.params.id, cur = await db.prepare('SELECT code FROM suppliers WHERE id=?').get(id);
  if (!cur) return res.status(404).json({ error: '供应商不存在' });
  await db.prepare('DELETE FROM suppliers WHERE id=?').run(id);
  await logOperation(req, '删除供应商', 'master', `供应商 ${cur.code}`);
  res.json({ ok: true });
}));

/* ---------------- 库位 ---------------- */
router.get('/locations', wrap(async (req, res) => {
  const rows = await db.prepare('SELECT id,code,name,type,description FROM locations ORDER BY code').all();
  res.json(rows);
}));
router.post('/locations', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.code || !b.name) return res.status(400).json({ error: '库位编码与名称为必填' });
  if (await db.prepare('SELECT id FROM locations WHERE code=?').get(b.code)) return res.status(409).json({ error: '库位编码已存在' });
  await db.prepare('INSERT INTO locations (code,name,type,description) VALUES (?,?,?,?)')
    .run(b.code, b.name, b.type || '主仓', b.description || null);
  await logOperation(req, '新增库位', 'master', `库位 ${b.code}`);
  res.status(201).json({ ok: true });
}));
router.patch('/locations/:id', wrap(async (req, res) => {
  const id = +req.params.id, b = req.body || {};
  const cur = await db.prepare('SELECT * FROM locations WHERE id=?').get(id);
  if (!cur) return res.status(404).json({ error: '库位不存在' });
  await db.prepare('UPDATE locations SET name=?,type=?,description=? WHERE id=?')
    .run(b.name ?? cur.name, b.type ?? cur.type, b.description ?? cur.description, id);
  await logOperation(req, '修改库位', 'master', `库位 ${cur.code}`);
  res.json({ ok: true });
}));
router.delete('/locations/:id', wrap(async (req, res) => {
  const id = +req.params.id, cur = await db.prepare('SELECT code FROM locations WHERE id=?').get(id);
  if (!cur) return res.status(404).json({ error: '库位不存在' });
  await db.prepare('DELETE FROM locations WHERE id=?').run(id);
  await logOperation(req, '删除库位', 'master', `库位 ${cur.code}`);
  res.json({ ok: true });
}));

/* ---------------- 单位换算 ---------------- */
router.get('/units', wrap(async (req, res) => {
  const rows = await db.prepare('SELECT id,main_unit,sub_unit,factor,note FROM units ORDER BY id').all();
  res.json(rows);
}));
router.post('/units', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.mainUnit) return res.status(400).json({ error: '主单位为必填' });
  await db.prepare('INSERT INTO units (main_unit,sub_unit,factor,note) VALUES (?,?,?,?)')
    .run(b.mainUnit, b.subUnit || null, b.factor ?? null, b.note || null);
  await logOperation(req, '新增单位换算', 'master', `${b.mainUnit}/${b.subUnit}`);
  res.status(201).json({ ok: true });
}));
router.patch('/units/:id', wrap(async (req, res) => {
  const id = +req.params.id, b = req.body || {};
  const cur = await db.prepare('SELECT * FROM units WHERE id=?').get(id);
  if (!cur) return res.status(404).json({ error: '记录不存在' });
  await db.prepare('UPDATE units SET main_unit=?,sub_unit=?,factor=?,note=? WHERE id=?')
    .run(b.mainUnit ?? cur.main_unit, b.subUnit ?? cur.sub_unit, b.factor ?? cur.factor, b.note ?? cur.note, id);
  await logOperation(req, '修改单位换算', 'master', `单位 ${cur.main_unit}`);
  res.json({ ok: true });
}));
router.delete('/units/:id', wrap(async (req, res) => {
  const id = +req.params.id;
  await db.prepare('DELETE FROM units WHERE id=?').run(id);
  await logOperation(req, '删除单位换算', 'master', `单位 id ${id}`);
  res.json({ ok: true });
}));

export default router;
