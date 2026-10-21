import { Router } from 'express';
import { db } from '../db.js';
import { verifyPassword, signToken, hashPassword, SECURITY } from '../auth.js';
import { logOperation, wrap } from '../helpers.js';

const router = Router();

// 登录
router.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '请输入账号和密码' });

  const now = Date.now();
  const user = await db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user) return res.status(401).json({ error: '账号或密码错误' });
  if (user.status === 'disabled') return res.status(403).json({ error: '该账号已停用，请联系管理员' });
  if (user.locked_until && user.locked_until > now) {
    const min = Math.ceil((user.locked_until - now) / 60000);
    return res.status(423).json({ error: `账号已锁定，请 ${min} 分钟后再试` });
  }

  if (!verifyPassword(password, user.password_hash)) {
    const attempts = (user.failed_attempts || 0) + 1;
    if (attempts >= SECURITY.MAX_FAILED) {
      const lockedUntil = now + SECURITY.LOCK_MINUTES * 60000;
      await db.prepare('UPDATE users SET failed_attempts=?, locked_until=? WHERE id=?').run(attempts, lockedUntil, user.id);
      return res.status(423).json({ error: `密码错误次数过多，账号已锁定 ${SECURITY.LOCK_MINUTES} 分钟` });
    }
    await db.prepare('UPDATE users SET failed_attempts=? WHERE id=?').run(attempts, user.id);
    return res.status(401).json({ error: `账号或密码错误（还可尝试 ${SECURITY.MAX_FAILED - attempts} 次）` });
  }

  // 登录成功：重置失败计数
  await db.prepare('UPDATE users SET failed_attempts=0, locked_until=0 WHERE id=?').run(user.id);
  const token = signToken(user);
  await logOperation({ user: { sub: user.id, username: user.username, realName: user.real_name } }, '登录', 'system', '账号登录系统');

  res.json({
    token,
    user: {
      id: user.id, username: user.username, realName: user.real_name,
      role: user.role, mustChangePwd: !!user.must_change_pwd,
    },
  });
}));

// 当前用户信息
router.get('/me', wrap(async (req, res) => {
  // 由 requireAuth 注入 req.user
  const u = await db.prepare('SELECT id,username,real_name,role,status,must_change_pwd FROM users WHERE id=?').get(req.user.sub);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  res.json({ id: u.id, username: u.username, realName: u.real_name, role: u.role, mustChangePwd: !!u.must_change_pwd });
}));

// 修改密码（强制改密 / 主动修改）
router.post('/change-password', wrap(async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) return res.status(400).json({ error: '请填写原密码与新密码' });
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(newPassword)) {
    return res.status(400).json({ error: '新密码需至少8位，且含大小写字母与数字' });
  }
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.user.sub);
  if (!verifyPassword(oldPassword, user.password_hash)) return res.status(400).json({ error: '原密码不正确' });
  await db.prepare('UPDATE users SET password_hash=?, must_change_pwd=0 WHERE id=?').run(hashPassword(newPassword), user.id);
  await logOperation(req, '修改密码', 'system', '用户修改登录密码');
  res.json({ ok: true });
}));

export default router;
