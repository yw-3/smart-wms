// 与后端 ROLE_PERMISSIONS 保持一致的前端镜像（菜单与路由守卫的唯一来源）
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ['dashboard', 'master', 'logs', 'system', 'inbound', 'requisition'],
  manager: ['dashboard', 'master', 'logs', 'inbound', 'requisition'],
  leader: ['dashboard'],
  picker: ['dashboard', 'requisition'],
  preparer: ['dashboard', 'inbound'],
  supervisor: ['dashboard', 'inbound', 'requisition'],
};

export const ROLE_LABELS: Record<string, string> = {
  admin: '系统管理员',
  manager: '仓库物管',
  leader: '产线班长',
  picker: '车间领料员',
  preparer: '备料员',
  supervisor: '生产组长',
};

export function canAccess(role?: string, module?: string): boolean {
  if (!role || !module) return false;
  return (ROLE_PERMISSIONS[role] || []).includes(module);
}
