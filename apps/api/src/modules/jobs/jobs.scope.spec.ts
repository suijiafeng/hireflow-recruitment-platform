import { PERMISSIONS } from '@hireflow/shared';
import {
  BadRequestException,
  ValidationPipe,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ApplicationsController } from '../applications/applications.controller';
import { ApplicationsService } from '../applications/applications.service';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

/** 真实 HTTP / DTO / 权限守卫 / Prisma / 内存 Postgres；只替换身份与外部 AI。 */
describe('职位与应聘数据范围及对比参数回归', () => {
  let database: ChildProcess;
  let prisma: PrismaService;
  let app: INestApplication;
  let applications: ApplicationsService;
  let base: string;
  const actor: JwtUser = {
    sub: 'scope-user',
    email: 'scope@example.test',
    name: '范围测试',
    roles: [],
    permissions: [
      PERMISSIONS.JOB_CREATE,
      PERMISSIONS.JOB_UPDATE,
      PERMISSIONS.JOB_READ,
      PERMISSIONS.APPLICATION_CREATE,
      PERMISSIONS.CANDIDATE_READ,
    ],
    departmentId: 'dept-root',
    departmentIds: ['dept-root', 'dept-child'],
    dataScope: 'DEPARTMENT',
  };
  let currentUser: JwtUser;
  const ai = {
    scoreMatch: jest.fn().mockResolvedValue({
      data: { score: 80, hits: [], highlights: '测试推荐' },
      meta: { provider: 'test' },
    }),
    compareCandidates: jest
      .fn()
      .mockResolvedValue({ data: { summary: '测试对比' }, meta: { provider: 'test' } }),
  };

  beforeAll(async () => {
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
    const log = new ActivityLogService(prisma);
    applications = new ApplicationsService(prisma, log, ai as never, {} as never);
    const jobs = new JobsService(prisma, log, ai as never, applications);
    const module = await Test.createTestingModule({
      controllers: [JobsController, ApplicationsController],
      providers: [
        { provide: JobsService, useValue: jobs },
        { provide: ApplicationsService, useValue: applications },
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
    base = `${await app.getUrl()}/api`;
    await prisma.department.createMany({
      data: [
        { id: 'dept-root', name: '研发' },
        { id: 'dept-other', name: '其他' },
      ],
    });
    await prisma.department.create({
      data: { id: 'dept-child', name: '研发子部门', parentId: 'dept-root' },
    });
    await prisma.user.create({
      data: {
        id: actor.sub,
        email: actor.email,
        name: actor.name,
        passwordHash: 'test-only',
        departmentId: 'dept-root',
      },
    });
  }, 30_000);

  beforeEach(async () => {
    currentUser = structuredClone(actor);
    jest.clearAllMocks();
    await prisma.interviewInterviewer.deleteMany();
    await prisma.interview.deleteMany();
    await prisma.application.deleteMany();
    await prisma.candidate.deleteMany();
    await prisma.activityLog.deleteMany();
    await prisma.pipelineStage.deleteMany();
    await prisma.job.deleteMany();
    for (const [id, departmentId] of [
      ['local', 'dept-root'],
      ['child', 'dept-child'],
      ['foreign', 'dept-other'],
    ]) {
      await prisma.job.create({
        data: {
          id,
          title: `${id}职位`,
          departmentId,
          createdById: actor.sub,
          stages: { create: { id: `stage-${id}`, name: '初筛', order: 0 } },
        },
      });
    }
    await prisma.candidate.createMany({
      data: ['root', 'peer', 'child', 'foreign', 'new', 'new2'].map((id) => ({
        id,
        name: id,
        tags: ['测试技能'],
      })),
    });
    for (const [id, jobId] of [
      ['root', 'local'],
      ['peer', 'local'],
      ['child', 'child'],
      ['foreign', 'foreign'],
    ]) {
      await prisma.application.create({
        data: {
          id: `application-${id}`,
          candidateId: id,
          jobId,
          stageId: `stage-${jobId}`,
          status: 'REJECTED',
        },
      });
    }
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

  const request = (path: string, body: unknown = {}, method = 'POST') =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('拒绝范围外职位修改、范围外建岗及把本部门职位迁到范围外，且不写入', async () => {
    const before = await prisma.job.findMany({ orderBy: { id: 'asc' } });
    expect(
      (await request('/jobs/foreign', { title: '越权修改', departmentId: 'dept-root' }, 'PATCH'))
        .status,
    ).toBe(403);
    expect((await request('/jobs', { title: '越权新建', departmentId: 'dept-other' })).status).toBe(
      403,
    );
    expect((await request('/jobs/local', { departmentId: 'dept-other' }, 'PATCH')).status).toBe(
      403,
    );
    expect(await prisma.job.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    expect(await prisma.activityLog.count()).toBe(0);
  });

  it('本部门含子部门可建岗/更新；ALL 可以操作外部门', async () => {
    expect(
      (await request('/jobs', { title: '子部门新职位', departmentId: 'dept-child' })).status,
    ).toBe(201);
    expect((await request('/jobs/child', { title: '子部门更新' }, 'PATCH')).status).toBe(200);
    expect((await request('/jobs/local', { departmentId: 'dept-child' }, 'PATCH')).status).toBe(
      200,
    );
    currentUser.dataScope = 'ALL';
    expect((await request('/jobs/foreign', { title: '全局可更新' }, 'PATCH')).status).toBe(200);
  });

  it('更新到不存在/空部门返回明确 400，原职位不变', async () => {
    for (const departmentId of ['missing', '', null]) {
      const response = await request('/jobs/local', { departmentId }, 'PATCH');
      expect(response.status).toBe(400);
      expect((await response.json()).message).toContain('所属部门');
    }
    expect((await prisma.job.findUniqueOrThrow({ where: { id: 'local' } })).departmentId).toBe(
      'dept-root',
    );
    expect(await prisma.activityLog.count()).toBe(0);
  });

  it('外部门应聘新增和人才激活都被拒绝，既有淘汰记录不能借此复活', async () => {
    expect((await request('/applications', { jobId: 'foreign', candidateId: 'new' })).status).toBe(
      403,
    );
    expect(
      (await request('/jobs/foreign/talent-pool/activate', { candidateId: 'foreign' })).status,
    ).toBe(403);
    expect(await prisma.application.count()).toBe(4);
    expect(
      (await prisma.application.findUniqueOrThrow({ where: { id: 'application-foreign' } })).status,
    ).toBe('REJECTED');
    expect(await prisma.activityLog.count()).toBe(0);
  });

  it('首次投递可进入本部门/子部门；本部门激活和 ALL 外部门投递仍有效', async () => {
    expect((await request('/applications', { jobId: 'local', candidateId: 'new' })).status).toBe(
      201,
    );
    expect((await request('/applications', { jobId: 'child', candidateId: 'new2' })).status).toBe(
      201,
    );
    expect(
      (await request('/jobs/local/talent-pool/activate', { candidateId: 'root' })).status,
    ).toBe(201);
    expect(
      (await prisma.application.findUniqueOrThrow({ where: { id: 'application-root' } })).status,
    ).toBe('ACTIVE');
    currentUser.dataScope = 'ALL';
    expect((await request('/applications', { jobId: 'foreign', candidateId: 'new' })).status).toBe(
      201,
    );
  });

  it('扫描外部门职位先拒绝；本部门扫描只把可见候选人送入 AI', async () => {
    expect((await request('/jobs/foreign/talent-pool/scan')).status).toBe(403);
    expect(ai.scoreMatch).not.toHaveBeenCalled();
    const response = await request('/jobs/local/talent-pool/scan');
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.scanned).toBe(3);
    expect(
      body.recommendations.map((item: { candidate: { id: string } }) => item.candidate.id).sort(),
    ).toEqual(['child', 'peer', 'root']);
    expect(ai.scoreMatch).toHaveBeenCalledTimes(3);
  });

  it('ASSIGNED 扫描只包含本人被指派的候选人；ALL 扫描保留全局范围', async () => {
    await prisma.interview.create({
      data: {
        applicationId: 'application-root',
        round: 1,
        interviewers: { create: { userId: actor.sub } },
      },
    });
    currentUser.dataScope = 'ASSIGNED';
    const assigned = await request('/jobs/foreign/talent-pool/scan');
    expect(assigned.status).toBe(201);
    expect(
      (await assigned.json()).recommendations.map(
        (item: { candidate: { id: string } }) => item.candidate.id,
      ),
    ).toEqual(['root']);
    currentUser.dataScope = 'ALL';
    expect((await (await request('/jobs/local/talent-pool/scan')).json()).scanned).toBe(4);
  });

  it.each([
    ['缺少 ids', {}],
    ['字符串', { ids: 'ab' }],
    ['数字', { ids: 12 }],
    ['对象', { ids: {} }],
    ['null', { ids: null }],
    ['非字符串元素', { ids: [1, 2] }],
    ['空白元素', { ids: [' ', 'b'] }],
    ['数量不足', { ids: ['a'] }],
    ['数量超限', { ids: ['a', 'b', 'c', 'd', 'e'] }],
    ['重复元素', { ids: ['a', 'a'] }],
  ])('对比拒绝%s并返回 400，不调用 AI', async (_label, body) => {
    const response = await request('/applications/compare', body);
    expect(response.status).toBe(400);
    expect((await response.json()).message.length).toBeGreaterThan(0);
    expect(ai.compareCandidates).not.toHaveBeenCalled();
    expect(await prisma.activityLog.count()).toBe(0);
  });

  it('合法同职位对比正常返回；服务层直接收到错误类型也返回参数异常', async () => {
    const response = await request('/applications/compare', {
      ids: ['application-root', 'application-peer'],
    });
    expect(response.status).toBe(201);
    expect((await response.json()).candidates).toHaveLength(2);
    expect(ai.compareCandidates).toHaveBeenCalledTimes(1);
    await expect(applications.compare({} as never, currentUser)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(applications.compare([1, 2] as never, currentUser)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
