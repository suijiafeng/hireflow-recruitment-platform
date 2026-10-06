/** 登录后回跳：只接受站内相对路径，防止 ?redirect=https://evil 之类的开放重定向 */
export function loginUrlFor(path: string): string {
  return path && path !== '/' && !path.startsWith('/login') ? `/login?redirect=${encodeURIComponent(path)}` : '/login';
}

export function safeRedirect(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/login')) return null;
  return raw;
}
