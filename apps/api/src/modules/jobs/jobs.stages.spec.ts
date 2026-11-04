import { PERMISSIONS } from '@hireflow/shared';
import { ValidationPipe, type INestApplication, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

/** 真 HTTP + ValidationPipe + 权限守卫 + Prisma + 临时 Postgres WASM。
 * 只注入测试身份，不模拟阶段服务、数据库或事务，不访问开发/生产数据库。 */
describe('职位阶段 HTTP / 数据库联调', () => {
  let database: ChildProcess;
  let prisma: PrismaService;
  let app: INestApplication;
  let base: string;
  const actor: JwtUser = {
    sub: 'stage-test-user',
    email: 'stages@example.test',
    name: '流程测试',
    roles: [],
    permissions: [PERMISSIONS.JOB_READ, PERMISSIONS.JOB_STAGES_MANAGE],
    departmentId: 'dept1',
    dataScope: 'ALL',
  };
  let currentUser: JwtUser;

  beforeAll(async () => {
    // PGlite 使用原生动态 import，在独立 Node 进程中启动，避免依赖 Jest VM 实验开关。
    database = fork(resolve(__dirname, '../../../scripts/test-stages-db.cjs'), {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const connection = await new Promise<string>((done, reject) => {
      database.once('message', (message: { connection: string }) => done(message.connection));
      database.once('error', reject);
      database.once('exit', (code) => reject(new Error(`测试数据库提前退出：${code}`)));
    });
    prisma = new PrismaService(
      new ConfigService({
        DATABASE_URL: `postgresql://postgres:postgres@${connection}/postgres`,
        DATABASE_POOL_MAX: '1',
      }),
    );
    await prisma.$connect();
    const module = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        ActivityLogService,
        {
          provide: JobsService,
          useFactory: (log: ActivityLogService) =>
            new JobsService(prisma, log, {} as never, {} as never),
          inject: [ActivityLogService],
        },
        {
          provide: APP_GUARD,
          useValue: {
            canActivate(context: ExecutionContext) {
              context.switchToHttp().getRequest().user = currentUser;
              return true;
            },
          },
        },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api/jobs/j1/stages`;
    await prisma.department.createMany({
      data: [
        { id: 'dept1', name: '研发' },
        { id: 'dept2', name: '其他' },
      ],
    });
    await prisma.user.create({
      data: {
        id: actor.sub,
        email: actor.email,
        name: actor.name,
        passwordHash: 'test-only',
        departmentId: 'dept1',
      },
    });
  }, 30_000);

  beforeEach(async () => {
    currentUser = structuredClone(actor);
    await prisma.application.deleteMany();
    await prisma.candidate.deleteMany();
    await prisma.activityLog.deleteMany();
    await prisma.pipelineStage.deleteMany();
    await prisma.job.deleteMany();
    await prisma.job.create({
      data: {
        id: 'j1',
        title: '工程师',
        departmentId: 'dept1',
        createdById: actor.sub,
        stages: {
          create: [
            { id: 's1', name: '筛选', order: 0 },
            { id: 's2', name: '面试', order: 1 },
            { id: 's3', name: '终面', order: 2 },
          ],
        },
      },
    });
    await prisma.job.create({
      data: {
        id: 'j2',
        title: '其他职位',
        departmentId: 'dept2',
        createdById: actor.sub,
        stages: { create: { id: 'foreign', name: '其他阶段', order: 0 } },
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    if (database && database.exitCode === null) {
      const exited = new Promise<void>((done) => database.once('exit', () => done()));
      database.send('stop');
      await exited;
    }
  });

  const put = (stages: unknown[]) =>
    fetch(base, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stages }),
    });
  const read = () =>
    prisma.pipelineStage.findMany({ where: { jobId: 'j1' }, orderBy: { order: 'asc' } });

  it('GET 按顺序返回阶段及关联应聘数；PUT 保留 ID、增加、改名、排序、删除并留痕', async () => {
    const before = await fetch(base);
    expect(before.status).toBe(200);
    expect(
      (await before.json()).map((stage: { id: string; _count: unknown }) => [
        stage.id,
        stage._count,
      ]),
    ).toEqual([
      ['s1', { applications: 0 }],
      ['s2', { applications: 0 }],
      ['s3', { applications: 0 }],
    ]);
    const response = await put([
      { id: 's2', name: ' 技术面试 ' },
      { name: '复试' },
      { id: 's1', name: '初筛' },
    ]);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(
      result.map((stage: { name: string; order: number }) => [stage.name, stage.order]),
    ).toEqual([
      ['技术面试', 0],
      ['复试', 1],
      ['初筛', 2],
    ]);
    expect(result[0].id).toBe('s2');
    expect(result[2].id).toBe('s1');
    expect(result[1].id).toBeTruthy();
    expect(await prisma.pipelineStage.findUnique({ where: { id: 's3' } })).toBeNull();
    expect(
      await prisma.activityLog.count({
        where: { action: 'job.stages_updated', entityId: 'j1', actorId: actor.sub },
      }),
    ).toBe(1);
  });

  it.each([
    { label: '空列表', stages: [] },
    { label: '空白名称', stages: [{ id: 's1', name: '   ' }] },
    {
      label: '重复 ID',
      stages: [
        { id: 's1', name: 'a' },
        { id: 's1', name: 'b' },
      ],
    },
    { label: '跨职位 ID', stages: [{ id: 'foreign', name: '跨职位' }] },
  ])('拒绝 $label，数据库不变', async ({ stages }) => {
    const before = await read();
    expect((await put(stages)).status).toBe(400);
    expect(await read()).toEqual(before);
  });

  it('阶段仍有候选人时拒绝删除，整份改名/新增草稿不落库', async () => {
    await prisma.candidate.create({ data: { id: 'c1', name: '测试候选人', tags: [] } });
    await prisma.application.create({
      data: { id: 'a1', candidateId: 'c1', jobId: 'j1', stageId: 's2' },
    });
    const before = await read();
    const response = await put([{ id: 's1', name: '修改不应生效' }, { name: '新增不应生效' }]);
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain('仍有候选人');
    expect(await read()).toEqual(before);
    expect(await prisma.activityLog.count()).toBe(0);
  });

  it('权限缺失或被收回后 PUT 返回 403，读权限仍可 GET', async () => {
    currentUser.permissions = [PERMISSIONS.JOB_READ];
    expect((await fetch(base)).status).toBe(200);
    expect((await put([{ id: 's1', name: '越权' }])).status).toBe(403);
    expect((await read()).map((stage) => stage.name)).toEqual(['筛选', '面试', '终面']);
  });

  it('部门范围之外 GET 和 PUT 都返回 403；职位不存在返回 404', async () => {
    currentUser = { ...actor, dataScope: 'DEPARTMENT', departmentId: 'dept2' };
    expect((await fetch(base)).status).toBe(403);
    expect((await put([{ id: 's1', name: '越权' }])).status).toBe(403);
    currentUser = actor;
    expect((await fetch(base.replace('j1', 'missing'))).status).toBe(404);
  });

  it('数据库写入中途失败时事务回滚删除、改名和新增', async () => {
    const before = await read();
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "PipelineStage" ADD CONSTRAINT stage_test_failure CHECK (name <> 'FAIL')`,
    );
    try {
      expect((await put([{ id: 's1', name: '不能部分保存' }, { name: 'FAIL' }])).status).toBe(500);
      expect(await read()).toEqual(before);
      expect(await prisma.activityLog.count()).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "PipelineStage" DROP CONSTRAINT stage_test_failure',
      );
    }
  });
});
