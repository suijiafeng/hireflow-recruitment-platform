/**
 * 生成 Prisma Client。
 *
 * generate 不连数据库，但 prisma.config.ts 在加载时就会读取 DATABASE_URL。
 * 全新 clone 往往还没有 .env，这里补一个占位串，只为了让配置文件能加载。
 *
 * Docker 的 deps 层只拷了 package.json、还没有 schema，postinstall 发现脚本不在就跳过；
 * 本脚本若被提前调用且 schema 不在，同样直接退出。build 层拷齐源码后再生成。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = dirname(dirname(fileURLToPath(import.meta.url)));

if (!existsSync(join(apiRoot, 'prisma/schema.prisma'))) {
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://prisma:prisma@127.0.0.1:5432/prisma?schema=public';
}

const require = createRequire(import.meta.url);
let prismaCli;
try {
  prismaCli = require.resolve('prisma/build/index.js');
} catch {
  // 生产安装会裁掉 devDependencies。镜像在 build 阶段生成 client，这里不能把 npm ci 跑挂。
  if (process.env.npm_lifecycle_event === 'postinstall') {
    console.log('[hireflow] prisma CLI 不在依赖里，跳过 client 生成');
    process.exit(0);
  }
  console.error('找不到 prisma CLI。请安装 apps/api 的 devDependencies 后再生成 client。');
  process.exit(1);
}

const result = spawnSync(process.execPath, [prismaCli, 'generate'], {
  cwd: apiRoot,
  stdio: 'inherit',
  env: process.env,
});

if (result.status === null) {
  console.error(result.error?.message ?? 'prisma generate 未能启动');
  process.exit(1);
}
process.exit(result.status);
