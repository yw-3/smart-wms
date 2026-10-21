import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { wrap } from '../helpers.js';

const router = Router();
router.use(requireAuth);

// 概览仪表盘：所有登录角色可见
router.get('/', wrap(async (req, res) => {
  const c = async (sql, args = []) => (await db.prepare(sql).get(...args)).c;
  const abc = await db.prepare('SELECT abc_class, COUNT(*) c FROM materials GROUP BY abc_class').all();
  const abcMap = { A: 0, B: 0, C: 0 };
  for (const r of abc) abcMap[r.abc_class] = r.c;

  // 今日入库：按 UTC 日期字符串比较（SQLite / Postgres 通用，substring 两端一致）
  const today = new Date().toISOString().slice(0, 10);

  const stats = {
    materials: await c('SELECT COUNT(*) c FROM materials'),
    suppliers: await c("SELECT COUNT(*) c FROM suppliers WHERE status='active'"),
    locations: await c('SELECT COUNT(*) c FROM locations'),
    units: await c('SELECT COUNT(*) c FROM units'),
    abc: abcMap,
    inboundToday: await c('SELECT COUNT(*) c FROM inbound_orders WHERE substring(created_at,1,10)=?', [today]),
    inboundTotal: await c("SELECT COUNT(*) c FROM inbound_orders WHERE status<>'已作废'"),
    pendingQc: await c("SELECT COUNT(*) c FROM batch_inventory WHERE quality_status<>'合格'"),
    lowStock: await db.prepare(
      'SELECT code,name,safety_stock FROM materials WHERE safety_stock>0 LIMIT 5'
    ).all(),
  };
  const recentOps = await db.prepare(
    'SELECT real_name,action,module,detail,created_at FROM operation_logs ORDER BY id DESC LIMIT 8'
  ).all();
  res.json({ stats, recentOps });
}));

export default router;
