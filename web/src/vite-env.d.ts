/// <reference types="vite/client" />

// 让 import.meta.env.* 具备类型提示（VITE_API_BASE / VITE_BASE / VITE_API_TIMEOUT 等）
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_BASE?: string;
  readonly VITE_API_TIMEOUT?: string;
  readonly VITE_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
