/**
 * 本地开发数据库：PGlite（Postgres 18.3 编译成 WASM）+ pglite-socket 暴露成标准 Postgres
 * 线协议服务。不装 Docker、不装 Postgres，`npm i` 就把整个数据库带下来了（约 8MB）。
 *
 * 对上层完全透明：Prisma 还是用 PrismaPg 走 TCP 连 localhost，schema 一行没改，
 * 11 个迁移原样跑通，枚举和 String[] 都正常——因为它就是真的 Postgres，只是编译到了 wasm32。
 *
 * 几个必须知道的约束：
 *  1. PGlite 单进程独占数据目录。serve 在跑的时候不能再跑 setup，反之亦然。
 *  2. pglite-socket 背后只有一个会话：多条连接并发发扩展协议消息会互相穿插，
 *     查询串台（随机 500，甚至返回别的查询的结果）。API 的 Prisma 连接池必须收成 1 条
 *     （.env 里 DATABASE_POOL_MAX=1）。
 *  3. 不要用 pg_restore 走这个 socket 灌数据：多路复用器扛不住那种带超级用户 DDL 的会话，
 *     会把服务卡僵到必须重启。要导数据用 `import` 子命令，它是进程内直接 exec，绕开 socket。
 *
 * 用法：tsx scripts/db.ts <serve|setup|reset|import <file.sql>>
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const API_ROOT = resolve(__dirname, '..');
const DATA_DIR = join(API_ROOT, '.pgdata');

/** 端口从 DATABASE_URL 反推，避免 .env 和脚本各写一份、日后对不上。 */
function dbPort(): number {
  const raw = process.env.DATABASE_URL;
  if (!raw) fail('缺少 DATABASE_URL。把 apps/api/.env.example 复制成 apps/api/.env 后重试。');
  const port = Number(new URL(raw).port);
  if (!port) fail(`DATABASE_URL 里没有端口：${raw}`);
  return port;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function portInUse(port: number): Promise<boolean> {
  return new Promise((res) => {
    const s = connect(port, '127.0.0.1');
    s.once('connect', () => (s.end(), res(true)));
    s.once('error', () => (s.destroy(), res(false)));
  });
}

/**
 * 必须在 PGlite.create() 之前调用。
 *
 * PGlite 对数据目录没有任何跨进程锁——第二个进程可以照常打开同一个 .pgdata，不报错。
 * 两个进程同时写会直接把 WAL 写坏，再打开就是
 *   PANIC: could not locate a valid checkpoint record
 * 而且不可恢复，只能 db:reset 重来。（这个我们真踩过：两个 npm run dev 撞在一起，
 * 第二个打开了目录、绑端口失败退出，库就废了。）
 *
 * 端口是唯一可靠的「已有实例在跑」信号，所以先探端口，端口占着就一步都别往下走。
 */
async function assertNotRunning(port: number) {
  if (await portInUse(port)) {
    fail(
      `端口 ${port} 已被占用，说明已经有一个本地数据库在跑了。\n` +
        `同一个 .pgdata 被两个进程同时打开会写坏 WAL，所以这里直接停下。\n` +
        `查是谁占着：lsof -nP -iTCP:${port} -sTCP:LISTEN`,
    );
  }
}

async function open() {
  try {
    return await PGlite.create({ dataDir: DATA_DIR });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Aborted|PANIC|checkpoint/i.test(msg)) {
      fail(
        `本地数据库损坏，打不开：${DATA_DIR}\n` +
          `通常是曾经有两个进程同时打开过它。数据目录没法修，重建即可：\n\n` +
          `  npm run db:reset\n\n` +
          `（重建会重新灌演示数据；如果之前导过自己的数据，重建后再 npm run db:import <file.sql>）`,
      );
    }
    throw err;
  }
}

async function listen(db: PGlite, port: number) {
  const server = new PGLiteSocketServer({
    db,
    port,
    host: '127.0.0.1',
    // 允许多条连接接入（API + prisma studio + 迁移脚本同时连），但它们共享同一个单会话后端，
    // 并发的扩展协议消息会互相穿插。API 侧靠 DATABASE_POOL_MAX=1 保证同一时刻只有一条在用。
    maxConnections: 20,
  });
  // 是 EventTarget 不是 EventEmitter，用 addEventListener（README 里写的 .on() 是错的）
  server.addEventListener('error', (e: Event) =>
    console.error('[pglite]', (e as CustomEvent).detail ?? e),
  );
  try {
    await server.start();
  } catch (err) {
    // assertNotRunning 已经在打开目录前拦过一道，这里只剩「探测到绑定之间」的竞态窗口。
    // 关键是必须先 close()：数据目录此刻已经打开着，带着它退出正是写坏 WAL 的那条路径。
    await db.close().catch(() => {});
    if ((err as NodeJS.ErrnoException)?.code === 'EADDRINUSE') {
      fail(`端口 ${port} 刚好被别的进程抢先占用了，请重试。`);
    }
    throw err;
  }
  return server;
}

/**
 * 必须用异步 spawn，不能用 spawnSync。
 * socket 服务是同一个进程里的 net.Server，靠事件循环 accept 连接；spawnSync 会把事件循环
 * 整个卡住，于是 prisma 子进程连过来时根本没人应答，报 P1001 连不上——数据库明明就在本进程里。
 */
function prisma(args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn('npx', ['prisma', ...args], {
      stdio: 'inherit',
      cwd: API_ROOT,
      env: process.env,
    });
    child.on('error', rej);
    child.on('close', (code) =>
      code === 0 ? res() : rej(new Error(`prisma ${args.join(' ')} 失败（exit ${code}）`)),
    );
  });
}

/** 建表 + 首次灌演示数据。跑完就退出，不常驻。 */
async function setup() {
  const port = dbPort();
  await assertNotRunning(port);
  // 生成的 client 不进仓库：全新 clone 后 seed 会因缺 src/generated/prisma 直接失败；
  // 拉了新 schema 的人也需要重新生成。不放 postinstall——Docker 的 deps 层装依赖时还没有 schema。
  await prisma(['generate']);
  const firstRun = !existsSync(DATA_DIR);
  const db = await open();
  const server = await listen(db, port);
  try {
    if (firstRun) console.log('首次启动，创建本地数据库 apps/api/.pgdata …\n');
    // migrate deploy 本身幂等，每次都跑，这样拉了新迁移的人不用记得手动执行
    await prisma(['migrate', 'deploy']);

    const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM "User"');
    if (rows[0].n === 0) {
      console.log('\n数据库是空的，灌入演示数据 …\n');
      await prisma(['db', 'seed']);
    }
  } finally {
    await server.stop();
    await db.close();
  }
  console.log(`\n✓ 本地数据库就绪（apps/api/.pgdata）`);
}

/** 常驻：npm run dev 期间由 concurrently 拉起，Ctrl-C 一起退出。 */
async function serve() {
  const port = dbPort();
  await assertNotRunning(port);
  const db = await open();
  const server = await listen(db, port);
  console.log(`✓ PGlite 监听 127.0.0.1:${port}`);

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await server.stop().catch(() => {});
    await db.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * 阻塞到数据库端口可连为止。
 * npm run dev 用 concurrently 并行拉起各进程，不保证顺序；而 Nest 在 onModuleInit 里就
 * $connect()，连不上会直接启动失败。所以 api 那一路先跑这个再 nest start。
 * 建表和 seed 由 dev 脚本里先行的 db:setup 保证，这里只需等端口。
 */
async function wait() {
  const port = dbPort();
  const { connect } = await import('node:net');
  const deadline = Date.now() + 60_000;
  for (;;) {
    const ok = await new Promise<boolean>((res) => {
      const s = connect(port, '127.0.0.1');
      s.once('connect', () => (s.end(), res(true)));
      s.once('error', () => (s.destroy(), res(false)));
    });
    if (ok) return;
    if (Date.now() > deadline) fail(`等了 60 秒，127.0.0.1:${port} 上的数据库还没起来`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** 删库重来。 */
async function reset() {
  await assertNotRunning(dbPort());
  await rm(DATA_DIR, { recursive: true, force: true });
  console.log('已清空 apps/api/.pgdata\n');
  await setup();
}

/**
 * 导入 pg_dump 生成的纯文本 SQL（`pg_dump --data-only --inserts`）。
 * 走进程内 exec，不经过 socket——pg_restore 走 socket 会把多路复用器卡僵。
 */
async function importSql(file?: string) {
  if (!file) fail('用法：tsx scripts/db.ts import <file.sql>');
  // 经 npm run -w 调用时 cwd 会被切到 apps/api，相对路径按用户敲命令的目录解才对；
  // INIT_CWD 是 npm 记下来的原始目录，直接跑 tsx 时没有这个变量，退回 cwd。
  const path = resolve(process.env.INIT_CWD || process.cwd(), file);
  if (!existsSync(path)) fail(`找不到文件：${path}`);
  await assertNotRunning(dbPort());

  // pg_dump 18 会在文件头尾插 \restrict / \unrestrict —— 那是 psql 的元命令不是 SQL，
  // 直接喂给引擎会报 syntax error at or near "\"
  const sql = readFileSync(path, 'utf-8')
    .split('\n')
    .filter((line) => !/^\\/.test(line))
    .join('\n');

  const db = await open();
  try {
    // 导入是「整库替换」语义：dump 里带着自己的主键，不先清空必然撞冲突。
    // _prisma_migrations 要留着，那是迁移状态不是业务数据。
    console.log('清空现有业务数据 …');
    await db.exec(`
      DO $$ DECLARE t text; BEGIN
        FOR t IN SELECT tablename FROM pg_tables
                 WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
        LOOP EXECUTE format('TRUNCATE TABLE %I CASCADE', t); END LOOP;
      END $$;`);

    // 表之间存在环形外键，逐条插入必然撞顺序问题；整段包进一个事务并把约束延迟到提交时检查
    await db.exec('BEGIN; SET CONSTRAINTS ALL DEFERRED;');
    try {
      await db.exec(sql);
      await db.exec('COMMIT;');
    } catch (err) {
      await db.exec('ROLLBACK;').catch(() => {});
      throw err;
    }
    const { rows } = await db.query<{ t: string; n: number }>(`
      SELECT tablename AS t,
             (xpath('/row/c/text()', query_to_xml(
               format('select count(*) as c from public.%I', tablename), false, true, '')))[1]::text::int AS n
      FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
      ORDER BY tablename`);
    console.log('✓ 导入完成');
    for (const r of rows.filter((r) => r.n > 0)) console.log(`  ${r.t} = ${r.n}`);
  } finally {
    await db.close();
  }
}

const [command, ...rest] = process.argv.slice(2);
const actions: Record<string, () => Promise<void>> = {
  serve,
  setup,
  wait,
  reset,
  import: () => importSql(rest[0]),
};
const action = actions[command ?? ''];
if (!action) {
  console.error(`用法：tsx scripts/db.ts <${Object.keys(actions).join('|')}>`);
  process.exit(1);
}
action().catch((err) => fail(err instanceof Error ? (err.stack ?? err.message) : String(err)));
