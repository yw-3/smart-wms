import axios from 'axios';

/**
 * 接口地址配置（部署时通过环境变量指定，不写死任何地址）：
 *   VITE_API_BASE=https://your-api.onrender.com/api
 *
 * 未设置时回退为同源的 '/api'：
 *   - 本地开发：Vite 代理 /api → http://localhost:3001
 *   - 单机部署：后端同时托管前端 dist（同源，无需配置）
 *   - 前后端分离部署：设置 VITE_API_BASE 指向后端服务的 /api
 */
const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');

export const api = axios.create({
  baseURL: API_BASE,
  timeout: Number(import.meta.env.VITE_API_TIMEOUT || 30000),
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('wms_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('wms_token');
      localStorage.removeItem('wms_user');
      if (location.pathname !== '/login') location.href = '/login';
      return Promise.reject(err);
    }
    // 网络不可达 / 后端冷启动：给出可读提示，而不是英文原文
    if (!err.response) {
      const msg = err.code === 'ECONNABORTED'
        ? '请求超时，请稍后重试'
        : '无法连接服务器，请检查网络或后端服务状态';
      return Promise.reject(new Error(msg));
    }
    return Promise.reject(err);
  }
);

export default api;
