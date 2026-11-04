// 仅供 jobs.stages.spec 使用：内存数据库、随机本地端口、父进程退出即清理。
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');
const { readdirSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

async function main() {
  const db = await PGlite.create();
  const migrations = resolve(__dirname, '../prisma/migrations');
  for (const folder of readdirSync(migrations)
    .filter((name) => /^\d/.test(name))
    .sort()) {
    await db.exec(readFileSync(resolve(migrations, folder, 'migration.sql'), 'utf8'));
  }
  const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 });
  await socket.start();
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    await socket.stop();
    await db.close();
    process.exit(0);
  }
  process.on('message', () => void stop());
  process.on('disconnect', () => void stop());
  process.send({ connection: socket.getServerConn() });
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
