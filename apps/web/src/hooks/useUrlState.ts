import { useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

type Patch = Record<string, string | number | null | undefined>;

/**
 * 页面状态放进网址参数：刷新、后退、把链接发给同事都能回到同一个视图。
 * 默认 replace（筛选、翻页不应该把历史记录刷成一长串）；
 * 打开抽屉这类「进入一层」的操作用 push，浏览器后退即关闭。
 * 一次 update 可改多个参数（如改关键词同时把页码归 1），避免连续调用时后一次覆盖前一次。
 */
export function useUrlParams() {
  const [params, setParams] = useSearchParams();
  const update = useCallback(
    (patch: Patch, opts: { push?: boolean; state?: unknown } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === undefined || v === '') next.delete(k);
            else next.set(k, String(v));
          }
          return next;
        },
        { replace: !opts.push, state: opts.state },
      );
    },
    [setParams],
  );
  return [params, update] as const;
}

/** 单个字符串参数；值等于默认值时从网址里省略，保持链接干净 */
export function useUrlState<T extends string>(key: string, defaultValue: T) {
  const [params, update] = useUrlParams();
  const value = (params.get(key) as T | null) ?? defaultValue;
  const set = useCallback(
    (v: T | null | undefined, opts?: { push?: boolean }) => update({ [key]: v === defaultValue ? null : v }, opts),
    [key, defaultValue, update],
  );
  return [value, set] as const;
}

/**
 * 抽屉 / 详情层的开关放进网址（如 ?candidate=xxx）：
 * 打开时 push 一条历史，浏览器后退 = 关闭抽屉，而不是离开整个页面；
 * 关闭时若这条历史是本页打开的就回退一步，否则（直接打开的分享链接）原地去掉参数。
 */
export function useDrawerParam(key: string) {
  const [params, update] = useUrlParams();
  const location = useLocation();
  const navigate = useNavigate();
  const value = params.get(key);
  const open = useCallback(
    (id: string) => update({ [key]: id }, { push: true, state: { drawer: key } }),
    [key, update],
  );
  const close = useCallback(() => {
    if ((location.state as { drawer?: string } | null)?.drawer === key) navigate(-1);
    else update({ [key]: null });
  }, [key, location.state, navigate, update]);
  return [value, open, close] as const;
}
