import axios from 'axios';
import { useAuthStore } from '../stores/auth';
import { loginUrlFor } from '../utils/redirect';

export const http = axios.create({ baseURL: '/api', timeout: 15_000 });

http.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
      // 令牌过期：带上当前页面，重新登录后回到原处，而不是被扔回首页
      if (window.location.pathname !== '/login') {
        window.location.href = loginUrlFor(window.location.pathname + window.location.search);
      }
    }
    return Promise.reject(error);
  },
);

/** 409：后端把「可覆盖的冲突」与「非法请求」分开，前端据此决定是提示还是二次确认 */
export function isConflictError(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 409;
}

/** 从 axios 错误中提取后端返回的 message，供 message.error 展示 */
export function extractErrorMessage(error: unknown, fallback = '请求失败，请稍后重试'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] } | undefined;
    if (Array.isArray(data?.message)) return data.message.join('；');
    if (typeof data?.message === 'string') return data.message;
  }
  return fallback;
}
