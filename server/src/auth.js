import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { ROLE_PERMISSIONS } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'wms-dev-secret-change-in-prod';
const TOKEN_TTL = '12h';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export function hashPassword(pwd) {
  return bcrypt.hashSync(pwd, 10);
}

export function verifyPassword(pwd, hash) {
  return bcrypt.compareSync(pwd, hash);
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, realName: user.real_name },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// 认证中间件：解析并校验 JWT
export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ error: '未登录或登录已过期' });
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

// 模块权限中间件：基于角色的可访问模块表做拦截
export function requireModule(module) {
  return (req, res, next) => {
    const role = req.user?.role;
    const allowed = ROLE_PERMISSIONS[role] || [];
    if (!allowed.includes(module)) {
      return res.status(403).json({ error: '当前账号无权访问该模块（需：' + module + '）' });
    }
    next();
  };
}

export const SECURITY = { MAX_FAILED, LOCK_MINUTES };
