import axios from 'axios';
import { useAuthStore } from '../stores/auth';
import { loginUrlFor } from '../utils/redirect';

export const http = axios.create({ baseURL: '/api', timeout: 15_000 });

/** 被动登出原因（令牌被吊销等），登录页读取一次后清除 */
export const LOGOUT_REASON_KEY = 'hireflow-logout-reason';

/**
 * AI 接口单独的超时：后端单次 AI 调用（含排队）最长 AI_DEADLINE_MS（默认 40s）后一定返回（超时即降级），
 * 前端必须比它长，否则会出现「前端报失败、后端其实成功」。人才库唤醒是批量调用，后端整体预算约 85s。
 */
export const AI_TIMEOUT_MS = 60_000;
export const AI_BATCH_TIMEOUT_MS = 100_000;
export const aiRequest = { timeout: AI_TIMEOUT_MS } as const;

http.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // 已登录状态下被拒（令牌被吊销 / 过期）：把原因带到登录页，而不是无声地踢回去
      if (useAuthStore.getState().token) {
        const reason = extractErrorMessage(error, '登录已失效，请重新登录');
        try {
          sessionStorage.setItem(LOGOUT_REASON_KEY, reason);
        } catch {
          /* 隐私模式等不可写时忽略 */
        }
      }
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

/** 前端等待超时（不是后端报错）：后端可能还在处理 */
export function isTimeoutError(error: unknown): boolean {
  return axios.isAxiosError(error) && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') && !error.response;
}

export const TIMEOUT_MESSAGE = '等待超时：后台可能仍在处理，请稍后刷新查看结果，不要重复提交';

/** 从 axios 错误中提取后端返回的 message，供 message.error 展示 */
export function extractErrorMessage(error: unknown, fallback = '请求失败，请稍后重试'): string {
  if (isTimeoutError(error)) return TIMEOUT_MESSAGE;
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] } | undefined;
    if (Array.isArray(data?.message)) return data.message.join('；');
    if (typeof data?.message === 'string') return data.message;
  }
  return fallback;
}
