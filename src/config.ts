/** H5 独立测试 / 生产部署时的 API 根路径，构建时由 VITE_API_BASE 注入 */
export const API_BASE = import.meta.env.VITE_API_BASE || '/api';

/** 用于拼接 /uploads 等静态资源 */
export const API_ORIGIN = API_BASE.replace(/\/api\/?$/, '') || '';

/** 对外访问域名（如 https://znzy.lhyun.net） */
export const PUBLIC_ORIGIN = import.meta.env.VITE_PUBLIC_ORIGIN || '';
