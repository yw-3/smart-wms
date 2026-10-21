import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { db } from '../db.js';
import { requireAuth, requireModule } from '../auth.js';
import { logOperation, wrap, readSheetRows } from '../helpers.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = Router();
router.use(requireAuth, requireModule('master'));

/* ---------------- 成品档案（与物料档案分离） ---------------- */
router.get('/', wrap(async (req, res) => {
  const kw = (req.query.q || '').trim();
  const rows = kw
    ? await db.prepare("SELECT * FROM products WHERE code LIKE ? OR name LIKE ? OR spec LIKE ? ORDER BY code")
        .all(`%${kw}%`, `%${kw}%`, `%${kw}%`)
    : await db.prepare('SELECT * FROM products ORDER BY code').all();
  res.json(rows);
}));

router.post('/', wrap(async (req, res) => {
  const b = req.body || {};
  const code = String(b.code || '').trim();
  const name = String(b.name || '').trim();
  if (!code || !name) return res.status(400).json({ error: '成品料号与成品品名为必填项' });
  if (await db.prepare('SELECT id FROM products WHERE code=?').get(code)) {
    return res.status(409).json({ error: '成品料号已存在（一物一码，禁止重复）' });
  }
  await db.prepare('INSERT INTO products (code,name,spec,unit_main,remark) VALUES (?,?,?,?,?)')
    .run(code, name, b.spec || null, b.unitMain || null, b.remark || null);
  await logOperation(req, '新增成品', 'master', `成品 ${code} / ${name}`);
  res.status(201).json({ ok: true });
}));

router.patch('/:id', wrap(async (req, res) => {
  const id = +req.params.id;
  const b = req.body || {};
  const cur = await db.prepare('SELECT * FROM products WHERE id=?').get(id);
  if (!cur) return res.status(404).json({ error: '成品不存在' });
  await db.prepare("UPDATE products SET name=?,spec=?,unit_main=?,remark=?,status=?,updated_at=datetime('now') WHERE id=?")
    .run(b.name ?? cur.name, b.spec ?? cur.spec, b.unitMain ?? cur.unit_main,
         b.remark ?? cur.remark, b.status ?? cur.status, id);
  await logOperation(req, '修改成品', 'master', `成品 ${cur.code}`);
  res.json({ ok: true });
}));

router.delete('/:id', wrap(async (req, res) => {
  const id = +req.params.id;
  const cur = await db.prepare('SELECT * FROM products WHERE id=?').get(id);
  if (!cur) return res.status(404).json({ error: '成品不存在' });
  const used = (await db.prepare('SELECT COUNT(*) c FROM bom WHERE product_code=?').get(cur.code)).c;
  if (used) return res.status(400).json({ error: `该成品已被 ${used} 条 BOM 引用，无法删除` });
  await db.prepare('DELETE FROM products WHERE id=?').run(id);
  await logOperation(req, '删除成品', 'master', `成品 ${cur.code}`);
  res.json({ ok: true });
}));

// Excel 导入成品：列 成品料号 / 成品品名 / 规格 / 单位 / 备注
router.post('/import', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  let rows;
  try {
    rows = readSheetRows(req.file);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  let imported = 0, skipped = 0;
  const errors = [];
  const ins = db.prepare('INSERT OR IGNORE INTO products (code,name,spec,unit_main,remark) VALUES (?,?,?,?,?)');
  for (const r of rows) {
    const code = String(r['成品料号'] || r['产品料号'] || r['code'] || '').trim();
    const name = String(r['成品品名'] || r['成品名称'] || r['产品名称'] || r['name'] || '').trim();
    if (!code || !name) { skipped++; errors.push('跳过：成品料号或成品品名为空'); continue; }
    if (await db.prepare('SELECT id FROM products WHERE code=?').get(code)) { skipped++; continue; }
    await ins.run(code, name, String(r['规格'] || '').trim() || null,
            String(r['单位'] || '').trim() || null, String(r['备注'] || '').trim() || null);
    imported++;
  }
  await logOperation(req, '批量导入成品', 'master', `导入 ${imported} 条，跳过 ${skipped} 条`);
  res.json({ imported, skipped, errors });
}));

export default router;
