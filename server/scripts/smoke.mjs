/**
 * 端到端冒烟测试：对 SQLite 与 Postgres 两种驱动跑同一套业务流程。
 *
 * 用法：node scripts/smoke.mjs <baseUrl> [driverLabel]
 * 前置：服务已启动（SQLite 用临时库副本，Postgres 用 PGlite 内存库），不污染生产数据。
 */
const BASE = process.argv[2] || 'http://127.0.0.1:3101';
const LABEL = process.argv[3] || BASE;

let pass = 0;
const fails = [];
const ok = (cond, name, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${name}`); }
  else { fails.push(`${name} ${extra}`); console.log(`  ❌ ${name} ${extra}`); }
};

async function api(path, { method = 'GET', token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !raw) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? (raw ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, body: json, text };
}

const MAT = 'SMOKE-TEST-01';
const MAIN = 'SMOKE-MAIN-01';
const LINE = 'SMOKE-LINE-01';
const BATCH = 'SMOKE-B1';
const FUTURE = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);

console.log(`\n===== 冒烟测试 [${LABEL}] ${BASE} =====`);

// 0. 预清理：删除上次运行可能残留的测试数据（保证可重复运行）
async function purgeTestData() {
  const mats = await api('/api/master/materials?q=SMOKE-TEST', { token });
  for (const m of mats.body || []) {
    await api(`/api/master/materials/${m.id}`, { method: 'DELETE', token });
  }
  const locs = await api('/api/master/locations', { token });
  for (const l of locs.body || []) {
    if (String(l.code).startsWith('SMOKE-')) {
      await api(`/api/master/locations/${l.id}`, { method: 'DELETE', token });
    }
  }
}

// 1. 健康检查
{
  const r = await api('/api/health');
  ok(r.status === 200 && r.body?.ok === true, '健康检查', JSON.stringify(r.body));
  console.log(`     驱动 = ${r.body?.driver}`);
}

// 2. 登录
let token = '';
{
  const r = await api('/api/auth/login', { method: 'POST', body: { username: 'manager', password: 'Manager@123' } });
  ok(r.status === 200 && !!r.body?.token, '登录 manager', r.text.slice(0, 120));
  token = r.body?.token || '';
}

await purgeTestData();

// 3. 仪表盘
let initialMaterialCount = -1;
{
  const r = await api('/api/dashboard', { token });
  ok(r.status === 200 && typeof r.body?.stats?.materials === 'number', '仪表盘统计', r.text.slice(0, 120));
  initialMaterialCount = Number(r.body?.stats?.materials ?? -1);
  ok(initialMaterialCount >= 0, '仪表盘物料计数可用', `实际 ${initialMaterialCount}`);
}

// 4. 主数据 CRUD
{
  const r = await api('/api/master/materials', {
    method: 'POST', token,
    body: { code: MAT, name: '冒烟测试物料', category: '测试类', unitMain: '个' },
  });
  ok(r.status === 200 || r.status === 201, '新增物料', r.text.slice(0, 120));
}
{
  const d = await api('/api/dashboard', { token });
  ok(Number(d.body?.stats?.materials) === initialMaterialCount + 1, '新增后物料计数 +1',
    `${initialMaterialCount} → ${d.body?.stats?.materials}`);
}
{
  const r = await api('/api/master/locations', {
    method: 'POST', token,
    body: { code: MAIN, name: '冒烟主仓', type: '主仓', description: '临时' },
  });
  ok(r.status === 200 || r.status === 201, '新增主仓库位', r.text.slice(0, 120));
}
{
  const r = await api('/api/master/locations', {
    method: 'POST', token,
    body: { code: LINE, name: '冒烟线边仓', type: '线边仓', description: '临时' },
  });
  ok(r.status === 200 || r.status === 201, '新增线边仓库位', r.text.slice(0, 120));
}
{
  const r = await api('/api/master/materials?q=SMOKE-TEST', { token });
  ok(r.status === 200 && r.body?.length === 1, '物料检索', r.text.slice(0, 120));
  ok(r.body?.[0]?.category === '测试类', '类别字段写入', JSON.stringify(r.body?.[0]?.category));
}

// 5. 备料入库
let inboundOrderNo = '';
{
  const r = await api('/api/inbound', {
    method: 'POST', token,
    body: {
      materialCode: MAT, qty: 100, batchNo: BATCH, supplierCode: 'S001',
      qualityStatus: '合格', locationCode: MAIN, prodDate: '2026-01-01', expiryDate: FUTURE,
    },
  });
  ok(r.status === 201, '备料入库', r.text.slice(0, 160));
  inboundOrderNo = r.body?.orderNo || '';
}
{
  const r = await api('/api/inbound', { token });
  ok(r.status === 200 && Array.isArray(r.body), '入库记录列表', r.text.slice(0, 120));
  ok(r.body?.some((o) => o.order_no === inboundOrderNo), '入库单已入库', inboundOrderNo);
}
{
  const r = await api('/api/inbound/stock', { token });
  ok(r.status === 200, '批次库存查询', r.text.slice(0, 160));
  const row = Array.isArray(r.body) ? r.body.find((x) => x.material_code === MAT && x.location_code === MAIN) : null;
  ok(row && Number(row.qty_total) === 100, '库存数量=100', JSON.stringify(row?.qty_total));
}

// 6. 领料（FIFO + 主仓→线边仓调拨）
{
  const r = await api('/api/requisition/main-batches', { token });
  ok(r.status === 200, '主仓可用批次', r.text.slice(0, 160));
  const b = Array.isArray(r.body) ? r.body.find((x) => x.batch_no === BATCH) : null;
  ok(!!b, 'FIFO 批次可领', JSON.stringify(b)?.slice(0, 120));
  ok(b?.eligible === true, '批次可领标记 eligible=true', JSON.stringify(b?.eligible));
}
let reqOrderNo = '';
{
  const r = await api('/api/requisition', {
    method: 'POST', token,
    body: {
      lineNo: 1, toLoc: LINE, sourceType: '手动', remark: '冒烟测试',
      items: [{ materialCode: MAT, qty: 30, batchNo: BATCH, fromLocationCode: MAIN }],
    },
  });
  ok(r.status === 201, '产线领料调拨', r.text.slice(0, 200));
  reqOrderNo = r.body?.orderNo || '';
}
{
  const r = await api('/api/inbound/stock', { token });
  const main = Array.isArray(r.body) ? r.body.find((x) => x.material_code === MAT && x.location_code === MAIN) : null;
  const line = Array.isArray(r.body) ? r.body.find((x) => x.material_code === MAT && x.location_code === LINE) : null;
  ok(Number(main?.qty_total) === 70, '主仓扣减 100→70', JSON.stringify(main?.qty_total));
  ok(Number(line?.qty_total) === 30, '线边仓增加 0→30', JSON.stringify(line?.qty_total));
}
{
  const r = await api('/api/requisition/line-ledger', { token });
  ok(r.status === 200, '产线台账', r.text.slice(0, 160));
  const l1 = Array.isArray(r.body) ? r.body.find((x) => x.lineNo === 1) : null;
  ok(l1 && l1.locationCode === LINE, '产线自动绑定线边仓', JSON.stringify(l1?.locationCode));
}
{
  const r = await api('/api/requisition', { token });
  ok(r.status === 200 && r.body?.some((o) => o.order_no === reqOrderNo), '领料单记录', reqOrderNo);
}

// 7. 作废冲销
{
  const list = await api('/api/requisition', { token });
  const ord = list.body?.find((o) => o.order_no === reqOrderNo);
  const r = await api(`/api/requisition/${ord.id}/void`, { method: 'POST', token });
  ok(r.status === 200, '领料单作废', r.text.slice(0, 160));
}
{
  const r = await api('/api/inbound/stock', { token });
  const main = Array.isArray(r.body) ? r.body.find((x) => x.material_code === MAT && x.location_code === MAIN) : null;
  const line = Array.isArray(r.body) ? r.body.find((x) => x.material_code === MAT && x.location_code === LINE) : null;
  ok(Number(main?.qty_total) === 100, '作废后主仓回补 70→100', JSON.stringify(main?.qty_total));
  ok(!line || Number(line.qty_total) === 0, '作废后线边仓清零', JSON.stringify(line?.qty_total));
}
{
  const list = await api('/api/inbound', { token });
  const ord = list.body?.find((o) => o.order_no === inboundOrderNo);
  const r = await api(`/api/inbound/${ord.id}/void`, { method: 'POST', token });
  ok(r.status === 200, '入库单作废', r.text.slice(0, 160));
}
{
  const r = await api('/api/inbound/stock', { token });
  const main = Array.isArray(r.body) ? r.body.find((x) => x.material_code === MAT && x.location_code === MAIN) : null;
  ok(!main || Number(main.qty_total) === 0, '作废后库存归零', JSON.stringify(main?.qty_total));
}

// 8. 其它模块
{
  const r = await api('/api/bom', { token });
  ok(r.status === 200 && Array.isArray(r.body), 'BOM 列表', r.text.slice(0, 120));
  const p = await api('/api/products', { token });
  ok(p.status === 200 && Array.isArray(p.body), '成品档案列表', p.text.slice(0, 120));
  const f = await api('/api/requisition/form-data', { token });
  ok(f.status === 200 && Array.isArray(f.body?.lineSideLocations), '领料 form-data 线边仓列表', f.text.slice(0, 160));
  ok(f.body?.lineSideLocations?.some((l) => l.code === LINE), 'form-data 包含新建线边仓');
  const l = await api('/api/logs?limit=5', { token });
  ok(l.status === 200 && Array.isArray(l.body), '操作日志', l.text.slice(0, 120));
}

// 9. 权限校验
{
  const r = await api('/api/auth/login', { method: 'POST', body: { username: 'picker', password: 'Picker@123' } });
  const ptoken = r.body?.token;
  const m = await api('/api/master/materials', { token: ptoken });
  ok(m.status === 403, '领料员访问主数据被拒', `实际 ${m.status}`);
}

// 10. 清理测试数据
await purgeTestData();
// 10.1 通过 DB 直连彻底清理入库单/领料单/批次/库存/日志（API 只能作废，不能物理删除）
try {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { fileURLToPath } = await import('node:url');
  const run = promisify(execFile);
  const scriptPath = fileURLToPath(new URL('./purge-test-data.mjs', import.meta.url));
  await run(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    env: process.env,
  });
  console.log('  ✅ 测试单据/库存/日志已物理清理');
} catch (e) {
  console.log('  ⚠️  DB 级清理未执行：' + String(e.message).slice(0, 120));
}
{
  const mats = await api('/api/master/materials?q=SMOKE-TEST', { token });
  const locs = await api('/api/master/locations', { token });
  const leftM = (mats.body || []).length;
  const leftL = (locs.body || []).filter((l) => String(l.code).startsWith('SMOKE-')).length;
  ok(leftM === 0 && leftL === 0, '测试数据已清理', `残留物料${leftM}/库位${leftL}`);
}

console.log(`\n===== 结果 [${LABEL}] 通过 ${pass} / 失败 ${fails.length} =====`);
if (fails.length) {
  console.log('失败项：');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
process.exit(0);
