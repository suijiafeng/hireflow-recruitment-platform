/**
 * 开发服务器把 /api 转到 API 实际监听的端口。
 * 与 Nest 一致：进程环境变量 PORT 优先，否则读 apps/api/.env，都没有则 3000。
 * 只改 .env 里的 PORT 时，前端不用再手改代理。
 */
export function resolveApiProxyTarget(options: {
  envPort: string | undefined;
  apiEnvText: string | null;
}): string {
  const fromProcess = options.envPort?.trim();
  const port =
    fromProcess && /^\d+$/.test(fromProcess) ? fromProcess : portFromEnvFile(options.apiEnvText) ?? '3000';
  return `http://localhost:${port}`;
}

function portFromEnvFile(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/^\s*PORT\s*=\s*["']?(\d+)["']?\s*(?:#.*)?$/m);
  return match?.[1] ?? null;
}
