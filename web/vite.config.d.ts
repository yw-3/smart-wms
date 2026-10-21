/**
 * 前端构建配置（部署到 Vercel / Netlify / GitHub Pages）
 *
 * 环境变量（构建时注入）：
 *   VITE_BASE         站点基路径。GitHub Pages 放在子目录时设为 '/仓库名/'，默认 '/'
 *   VITE_API_BASE     后端接口地址（前后端分离部署时填后端的 /api 地址）
 *   VITE_PROXY_TARGET 本地开发时的后端地址，默认 http://localhost:3001
 *
 * 说明：loadEnv(mode, '.', '') 会同时读取 .env 文件与进程环境变量，
 *      因此 Docker/平台的运行时环境变量（ARG/ENV）同样生效。
 */
declare const _default: import("vite").UserConfigFnObject;
export default _default;
