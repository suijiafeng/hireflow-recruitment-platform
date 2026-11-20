import { ConfigService } from '@nestjs/config';
import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 测试专用临时数据库：独立进程里起一个内存 PGlite（Postgres WASM），按顺序执行全部迁移，监听随机本地端口。
 * 不碰开发 / 生产数据库；stop() 或父进程退出即销毁。
 */
export async function startTestDatabase(): Promise<{ url: string; stop: () => Promise<void> }> {
  const child: ChildProcess = fork(resolve(__dirname, '../../scripts/test-stages-db.cjs'), {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const connection = await new Promise<string>((done, reject) => {
    child.once('message', (message: { connection: string }) => done(message.connection));
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`测试数据库提前退出：${code}`)));
  });
  return {
    url: `postgresql://postgres:postgres@${connection}/postgres`,
    stop: async () => {
      if (child.exitCode !== null) return;
      const exited = new Promise<void>((done) => child.once('exit', () => done()));
      child.send('stop');
      await exited;
    },
  };
}

export function testPrisma(url: string): PrismaService {
  return new PrismaService(new ConfigService({ DATABASE_URL: url, DATABASE_POOL_MAX: '1' }));
}
