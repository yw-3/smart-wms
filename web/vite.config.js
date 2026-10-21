import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
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
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, '.', '');
    var apiBase = env.VITE_API_BASE || '/api';
    return {
        plugins: [react()],
        base: env.VITE_BASE || '/',
        server: {
            port: 5173,
            proxy: {
                '/api': {
                    target: env.VITE_PROXY_TARGET || 'http://localhost:3001',
                    changeOrigin: true,
                },
            },
        },
        build: {
            outDir: 'dist',
            sourcemap: false,
            chunkSizeWarningLimit: 1200,
        },
    };
});
