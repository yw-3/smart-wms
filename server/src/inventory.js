import { db } from './db.js';

// 重新计算某 (物料, 库位) 的总库存与可用库存（可用仅累计 合格 批次）
export async function recomputeStock(materialCode, locationCode) {
  const r = await db.prepare(
    `SELECT COALESCE(SUM(qty),0) total,
            COALESCE(SUM(CASE WHEN quality_status='合格' THEN qty ELSE 0 END),0) avail
       FROM batch_inventory WHERE material_code=? AND location_code=?`
  ).get(materialCode, locationCode);

  if (r.total <= 0) {
    await db.prepare('DELETE FROM stock WHERE material_code=? AND location_code=?').run(materialCode, locationCode);
    return;
  }
  await db.prepare(
    `INSERT INTO stock (material_code, location_code, qty_total, qty_available, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(material_code, location_code)
     DO UPDATE SET qty_total=excluded.qty_total, qty_available=excluded.qty_available, updated_at=datetime('now')`
  ).run(materialCode, locationCode, r.total, r.avail);
}

// 入库一条：对 (物料, 库位, 批次) 累加 qty，并刷新总库存
export async function applyInbound({ materialCode, locationCode, batchNo, qty, prodDate, expiryDate, supplierCode, qualityStatus }) {
  const ex = await db.prepare(
    'SELECT * FROM batch_inventory WHERE material_code=? AND location_code=? AND batch_no=?'
  ).get(materialCode, locationCode, batchNo);

  if (ex) {
    const nq = ex.qty + qty;
    if (nq <= 0) {
      await db.prepare('DELETE FROM batch_inventory WHERE id=?').run(ex.id);
    } else {
      await db.prepare(
        `UPDATE batch_inventory
            SET qty=?, quality_status=?,
                prod_date=COALESCE(?, prod_date),
                expiry_date=COALESCE(?, expiry_date),
                supplier_code=COALESCE(?, supplier_code)
          WHERE id=?`
      ).run(nq, qualityStatus, prodDate || null, expiryDate || null, supplierCode || null, ex.id);
    }
  } else if (qty > 0) {
    await db.prepare(
      `INSERT INTO batch_inventory (material_code, location_code, batch_no, qty, prod_date, expiry_date, supplier_code, quality_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(materialCode, locationCode, batchNo, qty, prodDate || null, expiryDate || null, supplierCode || null, qualityStatus);
  }
  await recomputeStock(materialCode, locationCode);
}

// 冲销一条（修改/作废时先减去原影响）：仅按原批次扣减数量，质量状态沿用原值
export async function reverseInbound(order) {
  const ex = await db.prepare(
    'SELECT * FROM batch_inventory WHERE material_code=? AND location_code=? AND batch_no=?'
  ).get(order.material_code, order.location_code, order.batch_no);
  if (!ex) return;
  const nq = ex.qty - order.qty;
  if (nq <= 0) {
    await db.prepare('DELETE FROM batch_inventory WHERE id=?').run(ex.id);
  } else {
    await db.prepare('UPDATE batch_inventory SET qty=? WHERE id=?').run(nq, ex.id);
  }
  await recomputeStock(order.material_code, order.location_code);
}

// 质检确认：修改批次质量状态并重算可用库存
export async function setBatchQuality(materialCode, locationCode, batchNo, qualityStatus) {
  await db.prepare(
    'UPDATE batch_inventory SET quality_status=? WHERE material_code=? AND location_code=? AND batch_no=?'
  ).run(qualityStatus, materialCode, locationCode, batchNo);
  await recomputeStock(materialCode, locationCode);
}

// 库位调拨：把某批次 qty 从 fromLoc 移到 toLoc（领料 = 主仓 → 线边仓）
export async function transferBatch(materialCode, batchNo, fromLoc, toLoc, qty) {
  const ex = await db.prepare(
    'SELECT * FROM batch_inventory WHERE material_code=? AND location_code=? AND batch_no=?'
  ).get(materialCode, fromLoc, batchNo);
  if (!ex || ex.qty < qty) {
    throw new Error(`批次 ${batchNo} 在库位 ${fromLoc} 库存不足（现有 ${ex ? ex.qty : 0}）`);
  }
  const nq = ex.qty - qty;
  if (nq <= 0) {
    await db.prepare('DELETE FROM batch_inventory WHERE id=?').run(ex.id);
  } else {
    await db.prepare('UPDATE batch_inventory SET qty=? WHERE id=?').run(nq, ex.id);
  }
  // 汇总表（stock）必须重算来源库位，否则调拨后主仓库存汇总仍是旧值
  await recomputeStock(materialCode, fromLoc);
  await applyInbound({
    materialCode, locationCode: toLoc, batchNo, qty,
    prodDate: ex.prod_date, expiryDate: ex.expiry_date,
    supplierCode: ex.supplier_code, qualityStatus: ex.quality_status,
  });
}

// FIFO 分配：按效期升序分配可用批次，跳过 非合格 / 已过期 / 临期
// 返回 [{ batchNo, fromLocationCode, qty, expiryDate, prodDate }]，不足以满足时返回 allocated 且 shortage>0
export async function fifoAllocate(materialCode, qty, opts = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const nearDays = opts.nearDays ?? 30;
  // 临期阈值在 JS 内计算（UTC 基准），避免使用 SQLite 专有的 date() 算术，SQLite/Postgres 通用
  const threshold = new Date(Date.parse(`${today}T00:00:00Z`) + nearDays * 86400000).toISOString().slice(0, 10);
  const rows = await db.prepare(
    `SELECT b.* FROM batch_inventory b
       LEFT JOIN locations l ON b.location_code=l.code
      WHERE b.material_code=? AND b.qty>0 AND b.quality_status='合格'
        AND b.expiry_date IS NOT NULL AND b.expiry_date > ?
        AND COALESCE(l.type,'主仓')='主仓'
      ORDER BY b.expiry_date ASC, b.batch_no ASC`
  ).all(materialCode, threshold);

  const plan = [];
  let need = qty;
  for (const r of rows) {
    if (need <= 0) break;
    const take = Math.min(need, r.qty);
    plan.push({
      batchNo: r.batch_no,
      fromLocationCode: r.location_code,
      qty: take,
      expiryDate: r.expiry_date,
      prodDate: r.prod_date,
    });
    need -= take;
  }
  return { plan, allocated: qty - need, requested: qty, shortage: Math.max(need, 0) };
}
