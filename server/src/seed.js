import { db } from './db.js';
import { hashPassword } from './auth.js';

// 仅在表为空时写入基础配置（账号/供应商/单位/产线）；
// 业务数据（物料/成品/BOM/入库/库存/领料）与库位档案均不自动生成，全部由用户录入。
async function tableEmpty(name) {
  return (await db.prepare(`SELECT COUNT(*) c FROM ${name}`).get()).c === 0;
}

export async function seedUsers() {
  if (!(await tableEmpty('users'))) return;
  const users = [
    ['admin', '系统管理员', 'Admin@123', 'admin'],
    ['manager', '仓库物管', 'Manager@123', 'manager'],
    ['leader', '产线班长', 'Leader@123', 'leader'],
    ['picker', '车间领料员', 'Picker@123', 'picker'],
    ['preparer', '备料员', 'Preparer@123', 'preparer'],
    ['supervisor', '生产组长', 'Supervisor@123', 'supervisor'],
  ];
  const ins = db.prepare(
    `INSERT INTO users (username, real_name, password_hash, role, must_change_pwd)
     VALUES (?, ?, ?, ?, 0)`
  );
  for (const [username, realName, pwd, role] of users) {
    await ins.run(username, realName, hashPassword(pwd), role);
  }
  console.log('已写入 6 个角色账号');
}

export async function seedSuppliers() {
  if (!(await tableEmpty('suppliers'))) return;
  const rows = [
    ['S001', '广州永旺包材有限公司', '王经理', '13800000001', '广州市番禺区'],
    ['S002', '东莞华薄膜业', '李工', '13800000002', '东莞市松山湖'],
    ['S003', '佛山封达胶带', '张主管', '13800000003', '佛山市南海区'],
  ];
  const ins = db.prepare('INSERT INTO suppliers (code,name,contact,phone,address) VALUES (?,?,?,?,?)');
  for (const r of rows) await ins.run(...r);
  console.log('已写入供应商档案');
}

export async function seedUnits() {
  if (!(await tableEmpty('units'))) return;
  const rows = [
    ['卷', '米', 50, '1卷=50米'],
    ['扎', '个', 10, '1扎=10个'],
    ['个', null, null, '无副单位，标准核算单位'],
    ['箱', '个', 24, '1箱=24个'],
  ];
  const ins = db.prepare('INSERT INTO units (main_unit,sub_unit,factor,note) VALUES (?,?,?,?)');
  for (const r of rows) await ins.run(...r);
  console.log('已写入单位换算');
}

// 产线：系统基础配置，幂等补齐；line_location_code 不再预绑库位（由领料时动态绑定用户自建的线边仓）
export async function ensureProductionLines() {
  const insLine = db.prepare('INSERT INTO production_lines (line_no, name, line_location_code) VALUES (?,?,NULL) ON CONFLICT(line_no) DO NOTHING');
  for (let i = 1; i <= 6; i++) await insLine.run(i, `${i} 号线`);
}

/** 启动时执行：写入缺失的基础配置（幂等） */
export async function seed() {
  await seedUsers();
  await seedSuppliers();
  await seedUnits();
  await ensureProductionLines();
}
