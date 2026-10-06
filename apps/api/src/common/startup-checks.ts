/** 文档与示例里出现过的占位密钥：生产环境用它们签发的令牌，任何读过仓库的人都能伪造 */
const PLACEHOLDER_JWT_SECRETS = new Set(['change-me-in-production', 'your-secret-key-here', 'secret', 'changeme']);
const MIN_JWT_SECRET_LENGTH = 32;

/** 生产环境启动前的配置自检：不安全就拒绝启动，而不是带着可伪造的令牌上线 */
export function assertProductionSecrets(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV !== 'production') return;
  const secret = env.JWT_SECRET ?? '';
  if (PLACEHOLDER_JWT_SECRETS.has(secret) || secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET 不安全：生产环境必须使用至少 ${MIN_JWT_SECRET_LENGTH} 位的随机值（例如 \`openssl rand -base64 48\`），不能沿用示例占位符。`,
    );
  }
}
