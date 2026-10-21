import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireModule } from '../auth.js';
import { wrap } from '../helpers.js';

const router = Router();
router.use(requireAuth, requireModule('logs'));

// 操作日志查询（追加式存储，仅查询，不提供修改/删除）
router.get('/', wrap(async (req, res) => {
  const limit = Math.min(+req.query.limit || 100, 500);
  const module = (req.query.module || '').trim();
  let rows;
  if (module) {
    rows = await db.prepare('SELECT * FROM operation_logs WHERE module=? ORDER BY id DESC LIMIT ?').all(module, limit);
  } else {
    rows = await db.prepare('SELECT * FROM operation_logs ORDER BY id DESC LIMIT ?').all(limit);
  }
  res.json(rows);
}));

export default router;
