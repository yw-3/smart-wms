const BASE = 'http://localhost:3001/api';

async function login(username, password) {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const j = await r.json();
  if (!j.token) throw new Error('登录失败 ' + username + ': ' + JSON.stringify(j));
  return j.token;
}
async function call(token, method, path, body) {
  const opt = { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } };
  if (body) opt.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opt);
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

const out = {};
const picker = await login('picker', 'Picker@123');

out.formData = await call(picker, 'GET', '/requisition/form-data');
out.bomPlan = await call(picker, 'GET', '/requisition/bom-plan?productCode=P0001&qty=50');
out.allMain = await call(picker, 'GET', '/requisition/main-batches');

// 取主仓任意「合格且未临期」批次用于手动建单（避免选到演示已调拨空的物料）
const eligible = out.allMain.data.filter((b) => b.eligible);
if (!eligible.length) throw new Error('主仓无可用批次，seed 异常');
const pick = eligible[0];
const useQty = Math.min(pick.qty, 5);

out.create = await call(picker, 'POST', '/requisition', {
  lineNo: 3, sourceType: '手动', remark: '端到端测试',
  items: [{ materialCode: pick.material_code, qty: useQty, batchNo: pick.batch_no, fromLocationCode: pick.location_code }],
});
const newOrderNo = out.create.data?.orderNo;

out.ledgerBefore = await call(picker, 'GET', '/requisition/line-ledger?lineNo=3');
out.list = await call(picker, 'GET', '/requisition');

if (newOrderNo) {
  const ord = out.list.data.find((o) => o.order_no === newOrderNo);
  if (ord) {
    out.void = await call(picker, 'POST', '/requisition/' + ord.id + '/void');
    out.ledgerAfter = await call(picker, 'GET', '/requisition/line-ledger?lineNo=3');
  }
}

// 越权：leader 访问 requisition 应 403
const leader = await login('leader', 'Leader@123');
out.leaderForbidden = await call(leader, 'GET', '/requisition/form-data');

// 校验：过期/临期批次被禁选 —— 制造一个临期批次验证 isEligible 逻辑（已通过 main-batches eligible 字段体现）
const nearExp = out.allMain.data.filter((b) => !b.eligible);

console.log(JSON.stringify({
  lines: out.formData.data?.lines?.length,
  products: out.formData.data?.products?.length,
  bomPlan_components: out.bomPlan.data?.plan?.length,
  bomPlan_firstShortage: out.bomPlan.data?.plan?.[0]?.shortage,
  mainEligibleBatches: eligible.length,
  mainIneligibleBatches: nearExp.length,
  create_status: out.create.status,
  create_orderNo: newOrderNo,
  ledgerBefore_line3_total: out.ledgerBefore.data?.[0]?.batches?.reduce((s, b) => s + b.qty, 0),
  list_count: out.list.data?.length,
  void_status: out.void?.status,
  ledgerAfter_line3_total: out.ledgerAfter?.data?.[0]?.batches?.reduce((s, b) => s + b.qty, 0),
  leader_status_expect403: out.leaderForbidden.status,
}, null, 2));
