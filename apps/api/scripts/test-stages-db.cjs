// 测试专用临时数据库：内存 PGlite、随机本地端口、父进程退出即清理。
// MIGRATE_UNTIL=<迁移目录名>：只执行到它之前（不含），父进程发 'migrate-rest' 再执行剩余迁移（迁移回归测试用）。
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');
const { readdirSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

async function main() {
  const db = await PGlite.create();
  const migrations = resolve(__dirname, '../prisma/migrations');
  const folders = readdirSync(migrations)
    .filter((name) => /^\d/.test(name))
    .sort();
  const until = process.env.MIGRATE_UNTIL;
  const cut = until ? folders.indexOf(until) : -1;
  if (until && cut < 0) throw new Error(`找不到迁移 ${until}`);
  const first = cut >= 0 ? folders.slice(0, cut) : folders;
  const rest = cut >= 0 ? folders.slice(cut) : [];
  const apply = async (list) => {
    for (const folder of list) await db.exec(readFileSync(resolve(migrations, folder, 'migration.sql'), 'utf8'));
  };
  await apply(first);
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
  process.on('message', (message) => {
    if (message === 'migrate-rest') {
      apply(rest)
        .then(() => process.send({ migrated: true }))
        .catch((error) => process.send({ migrated: false, error: String(error && error.message ? error.message : error) }));
      return;
    }
    void stop();
  });
  process.on('disconnect', () => void stop());
  process.send({ connection: socket.getServerConn() });
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
