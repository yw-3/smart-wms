import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { db } from '../db.js';
import { requireAuth, requireModule } from '../auth.js';
import { logOperation, wrap, readSheetRows } from '../helpers.js';

const upload = multer({ storage: multer.memoryStorage() });

const router = Router();
router.use(requireAuth, requireModule('master'));

// 列表：成品/组件/单层标准用量/用量单位
router.get('/', wrap(async (req, res) => {
  const rows = await db.prepare(
    `SELECT b.id,
            b.product_code, b.component_code, b.qty_per_unit, b.usage_unit, b.remark,
            p.name AS product_name,
            m.name AS component_name, m.unit_main AS component_unit
       FROM bom b
       LEFT JOIN products p ON b.product_code = p.code
       LEFT JOIN materials m ON b.component_code = m.code
      ORDER BY b.product_code, b.component_code`
  ).all();
  res.json(rows);
}));

// 下拉选项：成品=成品档案，组件=物料档案
router.get('/options', wrap(async (req, res) => {
  const products = await db.prepare("SELECT code, name, spec FROM products WHERE status='active' ORDER BY code").all();
  const materials = await db.prepare('SELECT code, name, unit_main FROM materials ORDER BY code').all();
  res.json({ products, materials });
}));

// 批量新增：一个成品 + 多个组件
router.post('/', wrap(async (req, res) => {
  const { product_code, product_name, items } = req.body;
  if (!product_code) return res.status(400).json({ error: '成品料号为必填' });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: '请至少添加一个组件' });

  // 成品须在成品档案中；不存在则按传入的成品品名自动建档
  if (!await db.prepare('SELECT id FROM products WHERE code=?').get(product_code)) {
    const pname = String(product_name || '').trim();
    if (!pname) return res.status(400).json({ error: `成品 ${product_code} 不在成品档案中，请填写成品品名或先在「成品档案」中新增` });
    await db.prepare("INSERT INTO products (code,name,status) VALUES (?,?,'active')").run(product_code, pname);
  }

  const ins = db.prepare('INSERT INTO bom (product_code, component_code, qty_per_unit, usage_unit, remark) VALUES (?,?,?,?,?)');
  let added = 0, skipped = 0;
  for (const it of items) {
    if (!it.component_code) return res.status(400).json({ error: '存在未选择组件的行' });
    const qty = Number(it.qty_per_unit);
    if (!(qty > 0)) return res.status(400).json({ error: `组件 ${it.component_code} 的单层标准用量须为正数` });
    if (it.component_code === product_code) return res.status(400).json({ error: '成品不能与组件相同' });
    const exist = await db.prepare('SELECT id FROM bom WHERE product_code=? AND component_code=?').get(product_code, it.component_code);
    if (exist) { skipped++; continue; }
    await ins.run(product_code, it.component_code, qty, it.usage_unit || null, it.remark || null);
    added++;
  }
  await logOperation(req, '新增BOM', 'master', `${product_code} 批量${added}条(跳过重复${skipped})`);
  res.status(201).json({ added, skipped });
}));

// Excel 导入 BOM
// 支持列：成品料号 / 成品名称 / 组件料号 / 组件名称 / 单层标准用量 / 用量单位 / 备注
router.post('/import', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  let rows;
  try {
    rows = readSheetRows(req.file);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (!rows.length) return res.status(400).json({ error: '表格内容为空' });

  const pick = (r, keys) => {
    for (const k of keys) {
      if (r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== '') return String(r[k]).trim();
    }
    return '';
  };

  const existBom = db.prepare('SELECT id FROM bom WHERE product_code=? AND component_code=?');
  const insBom = db.prepare('INSERT INTO bom (product_code, component_code, qty_per_unit, usage_unit, remark) VALUES (?,?,?,?,?)');
  const findMat = db.prepare('SELECT id, name FROM materials WHERE code=?');
  const insMat = db.prepare("INSERT INTO materials (code, name, unit_main, status) VALUES (?,?,?,'active')");
  const findProd = db.prepare('SELECT id FROM products WHERE code=?');
  const insProd = db.prepare("INSERT INTO products (code, name, spec, status) VALUES (?,?,?,'active')");

  let imported = 0, skipped = 0, createdMaterials = 0, createdProducts = 0;
  const errors = [];
  const newMats = [];
  const newProds = [];

  // 组件物料：不存在则建档（名称=组件名称，规格一律并入名称，不单独存规格列）
  const ensureMaterial = async (code, matName, spec, unit) => {
    if (!code) return;
    const found = await findMat.get(code);
    if (found) {
      if (!found.name && matName) await db.prepare('UPDATE materials SET name=? WHERE id=?').run(matName, found.id);
      return;
    }
    let fullName = matName || code;
    if (spec && !fullName.endsWith(spec)) fullName += spec;
    await insMat.run(code, fullName, unit || null);
    createdMaterials++;
    newMats.push(code);
  };
  // 成品：不存在则在成品档案建档（不进入物料档案）
  const ensureProduct = async (code, prodName, spec) => {
    if (!code) return;
    if (await findProd.get(code)) return;
    await insProd.run(code, prodName || code, spec || null);
    createdProducts++;
    newProds.push(code);
  };

  await db.begin();
  try {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const productCode = pick(r, ['成品料号', '成品编码', '产品料号', '产品编码', 'product_code', 'ProductCode']);
      const productName = pick(r, ['成品品名', '成品名称', '产品名称', 'product_name', 'ProductName']);
      const compCode = pick(r, ['组件料号', '组件编码', '物料编码', '组件物料编码', 'component_code', 'ComponentCode']);
      const compName = pick(r, ['组件名称', '物料名称', 'component_name', 'ComponentName']);
      const compSpec = pick(r, ['组件规格', '规格', 'component_spec', 'ComponentSpec']);
      const qtyRaw = pick(r, ['单层标准用量', '标准用量', '单耗', '用量', 'qty_per_unit', 'QtyPerUnit']);
      const unit = pick(r, ['用量单位', '单位', 'usage_unit', 'UsageUnit']);
      const remark = pick(r, ['备注', 'remark', 'Remark']);

      if (!productCode || !compCode) { skipped++; errors.push(`第 ${i + 2} 行：成品料号或组件料号为空，已跳过`); continue; }
      if (productCode === compCode) { skipped++; errors.push(`第 ${i + 2} 行：成品与组件料号相同（${productCode}），已跳过`); continue; }
      const qty = Number(qtyRaw);
      if (!(qty > 0)) { skipped++; errors.push(`第 ${i + 2} 行：${productCode}→${compCode} 单层标准用量无效（${qtyRaw || '空'}），已跳过`); continue; }

      if (await existBom.get(productCode, compCode)) { skipped++; continue; }

      // 成品 → 成品档案；组件 → 物料档案（两者互不混用）
      await ensureProduct(productCode, productName, '');
      await ensureMaterial(compCode, compName, compSpec, unit);

      await insBom.run(productCode, compCode, qty, unit || null, remark || null);
      imported++;
    }
    await db.commit();
  } catch (e) {
    await db.rollback();
    return res.status(500).json({ error: '导入失败已回滚：' + e.message });
  }

  await logOperation(req, '导入BOM', 'master', `导入 ${imported} 条，跳过 ${skipped} 条，新建成品 ${createdProducts} 条，新建物料 ${createdMaterials} 条`);
  res.json({ imported, skipped, createdMaterials, createdProducts, newMats, newProds, errors });
}));

// 导入模板（Excel）
router.get('/import-template', wrap(async (req, res) => {
  const aoa = [
    ['成品料号', '成品品名', '组件料号', '组件名称', '组件规格', '单层标准用量', '用量单位', '备注'],
    ['20105040000012', '礼包用旺旺仙贝单包_52g', '20105030000001', '仙贝内膜', '000-150813', 1.5, '米', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'BOM导入模板');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', "attachment; filename=\"BOM_import_template.xlsx\"; filename*=UTF-8''" + encodeURIComponent('BOM导入模板.xlsx'));
  res.send(buf);
}));

// 编辑单条
router.put('/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT * FROM bom WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'BOM 记录不存在' });
  const { qty_per_unit, usage_unit, remark } = req.body;
  const qty = qty_per_unit !== undefined ? Number(qty_per_unit) : row.qty_per_unit;
  if (!(qty > 0)) return res.status(400).json({ error: '单层标准用量须为正数' });
  await db.prepare('UPDATE bom SET qty_per_unit=?, usage_unit=?, remark=? WHERE id=?')
    .run(qty, usage_unit ?? row.usage_unit, remark ?? row.remark, id);
  await logOperation(req, '编辑BOM', 'master', `#${id} 用量→${qty}`);
  res.json({ ok: true });
}));

// 删除单条
router.delete('/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT * FROM bom WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'BOM 记录不存在' });
  await db.prepare('DELETE FROM bom WHERE id=?').run(id);
  await logOperation(req, '删除BOM', 'master', `#${id} ${row.product_code}→${row.component_code}`);
  res.json({ ok: true });
}));

export default router;
