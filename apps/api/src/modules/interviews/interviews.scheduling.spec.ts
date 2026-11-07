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
import { InterviewPortalController } from './interview-portal.controller';
import { InterviewsController } from './interviews.controller';
import { InterviewsService } from './interviews.service';

/** 真 HTTP、DTO、服务及数据库事务；临时 PGlite 不访问开发库。
 * 通知通道不在本组范围内，面试、时段、留痕均使用真实 Prisma。 */
describe('面试排期 HTTP / 数据库回归', () => {
  let database: ChildProcess;
  let prisma: PrismaService;
  let app: INestApplication;
  let base: string;
  const actor: JwtUser = {
    sub: 'u1', email: 'interview1@example.test', name: '面试官一', roles: [],
    permissions: [PERMISSIONS.INTERVIEW_SCHEDULE, PERMISSIONS.EVALUATION_READ],
    departmentId: null, dataScope: 'ALL',
  };
  const day = new Date(Date.now() + 3 * 86_400_000);
  day.setUTCHours(0, 0, 0, 0);
  const at = (hours: number) => new Date(day.getTime() + hours * 3_600_000);

  beforeAll(async () => {
    database = fork(resolve(__dirname, '../../../scripts/test-stages-db.cjs'), {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const connection = await new Promise<string>((done, reject) => {
      database.once('message', (message: { connection: string }) => done(message.connection));
      database.once('error', reject);
      database.once('exit', (code) => reject(new Error(`测试数据库提前退出：${code}`)));
    });
    prisma = new PrismaService(new ConfigService({
      DATABASE_URL: `postgresql://postgres:postgres@${connection}/postgres`, DATABASE_POOL_MAX: '1',
    }));
    await prisma.$connect();
    const module = await Test.createTestingModule({
      controllers: [InterviewsController, InterviewPortalController],
      providers: [
        { provide: PrismaService, useValue: prisma }, ActivityLogService,
        {
          provide: InterviewsService,
          useFactory: (log: ActivityLogService) => new InterviewsService(prisma, log, {} as never, {
            push: jest.fn().mockResolvedValue(undefined),
            pushByPermission: jest.fn().mockResolvedValue(undefined),
          } as never),
          inject: [ActivityLogService],
        },
        { provide: APP_GUARD, useValue: {
          canActivate(context: ExecutionContext) {
            context.switchToHttp().getRequest().user = actor;
            return true;
          },
        } },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true,
      transformOptions: { enableImplicitConversion: true } }));
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api`;
    await prisma.department.create({ data: { id: 'dept1', name: '测试部门' } });
    await prisma.user.createMany({ data: [
      { id: 'u1', email: actor.email, name: actor.name, passwordHash: 'test-only' },
      { id: 'u2', email: 'interview2@example.test', name: '面试官二', passwordHash: 'test-only' },
    ] });
  }, 30_000);

  beforeEach(async () => {
    await prisma.activityLog.deleteMany();
    await prisma.interviewerSlot.deleteMany();
    await prisma.interview.deleteMany();
    await prisma.application.deleteMany();
    await prisma.candidate.deleteMany();
    await prisma.pipelineStage.deleteMany();
    await prisma.job.deleteMany();
    await prisma.job.create({ data: { id: 'j1', title: '工程师', createdById: 'u1', departmentId: 'dept1',
      stages: { create: { id: 's1', name: '面试', order: 0 } } } });
    await prisma.candidate.createMany({ data: [
      { id: 'c1', name: '候选人一', tags: [] }, { id: 'c2', name: '候选人二', tags: [] },
    ] });
    await prisma.application.createMany({ data: [
      { id: 'a1', candidateId: 'c1', jobId: 'j1', stageId: 's1' },
      { id: 'a2', candidateId: 'c2', jobId: 'j1', stageId: 's1' },
    ] });
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

  const post = (path: string, body: unknown = {}) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const interview = (id = 'i1', ids = ['u1'], applicationId = 'a1') => prisma.interview.create({
    data: { id, applicationId, round: 1, durationMins: 60, portalToken: id,
      interviewers: { create: ids.map((userId) => ({ userId })) } },
  });
  const slot = (id: string, userId: string, start: number, end: number, bookedBy?: string) =>
    prisma.interviewerSlot.create({ data: { id, userId, startAt: at(start), endAt: at(end), bookedBy } });
  const pick = (id: string, slotId: string, startAt?: string) =>
    post(`/portal/interviews/${id}/pick`, { slotId, startAt });
  const view = async (id = 'i1') => (await fetch(`${base}/portal/interviews/${id}`)).json();
  const bookings = () => prisma.interviewerSlot.findMany({ orderBy: { id: 'asc' } });

  it.each(['CANCELED', 'COMPLETED'] as const)('未选时的 %s 面试旧链接不能复活', async (status) => {
    await interview();
    await slot('t1', 'u1', 2, 3);
    if (status === 'CANCELED') expect((await post('/interviews/i1/cancel')).status).toBe(201);
    else await prisma.interview.update({ where: { id: 'i1' }, data: { status } });
    expect((await view()).slots).toEqual([]);
    expect((await pick('i1', 't1')).status).toBe(400);
    expect((await prisma.interview.findUniqueOrThrow({ where: { id: 'i1' } })).status).toBe(status);
    expect((await bookings())[0].bookedBy).toBeNull();
  });

  it.each(['REJECTED', 'WITHDRAWN', 'HIRED'] as const)('%s 应聘不能创建、改期或自助选时', async (status) => {
    await interview();
    await slot('t1', 'u1', 2, 3);
    await prisma.application.update({ where: { id: 'a1' }, data: { status } });
    expect((await view()).closed).toBe(true);
    expect((await pick('i1', 't1')).status).toBe(400);
    expect((await post('/interviews/i1/schedule', { scheduledAt: at(2).toISOString() })).status).toBe(400);
    expect((await post('/interviews', { applicationId: 'a1', round: 2, interviewerIds: ['u1'] })).status).toBe(400);
    expect((await bookings())[0].bookedBy).toBeNull();
  });

  it('拒绝短档、过去档与畸形选时输入，失败不占档', async () => {
    await interview();
    await slot('short', 'u1', 2, 2.25);
    await slot('past', 'u1', -100, -99);
    expect((await pick('i1', 'short')).status).toBe(409);
    expect((await pick('i1', 'past')).status).toBe(409);
    expect((await post('/portal/interviews/i1/pick', { slotId: {} })).status).toBe(400);
    expect((await pick('i1', 'short', 'invalid')).status).toBe(400);
    expect((await bookings()).every((s) => s.bookedBy === null)).toBe(true);
  });

  it.each([false, true])('其他面试官没有可用覆盖（已占档=%s）时整场拒绝', async (booked) => {
    await interview('i1', ['u1', 'u2']);
    await slot('t1', 'u1', 2, 4);
    if (booked) await slot('t2', 'u2', 2, 4, 'other-interview');
    const before = await bookings();
    expect((await pick('i1', 't1')).status).toBe(409);
    expect(await bookings()).toEqual(before);
    expect((await prisma.interview.findUniqueOrThrow({ where: { id: 'i1' } })).scheduledAt).toBeNull();
  });

  it('部分重叠返回真实交集，并在交集起点为全员占档', async () => {
    await interview('i1', ['u1', 'u2']);
    await slot('t1', 'u1', 2, 4);
    await slot('t2', 'u2', 3, 5);
    expect((await view()).slots).toEqual([{ id: 't1', startAt: at(3).toISOString(), endAt: at(4).toISOString() }]);
    expect((await pick('i1', 't1', at(3).toISOString())).status).toBe(201);
    expect((await bookings()).map((s) => s.bookedBy)).toEqual(['i1', 'i1']);
    expect((await prisma.interview.findUniqueOrThrow({ where: { id: 'i1' } })).scheduledAt).toEqual(at(3));
  });

  it('一份主档的多个交集可分别选择，兼容旧版仅 slotId 请求', async () => {
    await interview('i1', ['u1', 'u2']);
    await slot('t1', 'u1', 2, 6);
    await slot('t2', 'u2', 3, 4);
    await slot('t3', 'u2', 5, 6);
    expect((await view()).slots).toHaveLength(2);
    expect((await pick('i1', 't1', at(5).toISOString())).status).toBe(201);
    expect((await bookings()).map((s) => s.bookedBy)).toEqual(['i1', null, 'i1']);
    await interview('i2', ['u2'], 'a2');
    expect((await pick('i2', 't2')).status).toBe(201);
  });

  it('创建直接带时间也检查撞期并占档；没有预维护空闲档仍可人工排期', async () => {
    await slot('t1', 'u1', 2, 3);
    const created = await post('/interviews', { applicationId: 'a1', round: 1,
      interviewerIds: ['u1'], scheduledAt: at(2).toISOString(), durationMins: 60 });
    expect(created.status).toBe(201);
    const first = await created.json();
    expect((await bookings())[0].bookedBy).toBe(first.id);
    expect((await post('/interviews', { applicationId: 'a2', round: 1,
      interviewerIds: ['u1'], scheduledAt: at(2.5).toISOString() })).status).toBe(409);
    expect(await prisma.interview.count()).toBe(1);
    expect((await post('/interviews', { applicationId: 'a2', round: 1,
      interviewerIds: ['u1'], scheduledAt: at(5).toISOString() })).status).toBe(201);
  });

  it('改期检查撞期，HR ignoreConflict 允许显式覆盖且不抢走他人的档', async () => {
    await interview('i1');
    await interview('i2', ['u1'], 'a2');
    await slot('t1', 'u1', 2, 3);
    expect((await post('/interviews/i1/schedule', { scheduledAt: at(2).toISOString() })).status).toBe(201);
    expect((await post('/interviews/i2/schedule', { scheduledAt: at(2).toISOString() })).status).toBe(409);
    expect((await post('/interviews/i2/schedule', { scheduledAt: at(2).toISOString(), ignoreConflict: true })).status).toBe(201);
    expect((await bookings())[0].bookedBy).toBe('i1');
  });

  it('同一面试并发选择不同档：仅一个成功，另一请求409，且只有胜出档被占用', async () => {
    await interview();
    await slot('t1', 'u1', 2, 3);
    await slot('t2', 'u1', 4, 5);
    const results = await Promise.all([pick('i1', 't1'), pick('i1', 't2')]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const winner = results.findIndex((r) => r.status === 201);
    const slots = await bookings();
    expect(slots[winner].bookedBy).toBe('i1');
    expect(slots[1 - winner].bookedBy).toBeNull();
    expect((await prisma.interview.findUniqueOrThrow({ where: { id: 'i1' } })).scheduledAt).toEqual(at(winner === 0 ? 2 : 4));
    expect(await prisma.activityLog.count({ where: { action: 'interview.self_scheduled' } })).toBe(1);
  });

  it('不同应聘并发创建撞期面试也只有一个成功', async () => {
    const results = await Promise.all(['a1', 'a2'].map((applicationId) => post('/interviews', {
      applicationId, round: 1, interviewerIds: ['u1'], scheduledAt: at(2).toISOString(),
    })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.interview.count()).toBe(1);
  });

  it('选时与取消并发后保持已取消且不遗留占档', async () => {
    await interview();
    await slot('t1', 'u1', 2, 3);
    const [picked, canceled] = await Promise.all([pick('i1', 't1'), post('/interviews/i1/cancel')]);
    expect([201, 400]).toContain(picked.status);
    expect(canceled.status).toBe(201);
    expect((await prisma.interview.findUniqueOrThrow({ where: { id: 'i1' } })).status).toBe('CANCELED');
    expect((await bookings())[0].bookedBy).toBeNull();
  });

  it('选时与人工改期并发后，只保留最终排期的占档', async () => {
    await interview();
    await slot('t1', 'u1', 2, 3);
    await slot('t2', 'u1', 4, 5);
    const [picked, scheduled] = await Promise.all([pick('i1', 't1'),
      post('/interviews/i1/schedule', { scheduledAt: at(4).toISOString() })]);
    expect([201, 409]).toContain(picked.status);
    expect(scheduled.status).toBe(201);
    expect((await bookings()).map((s) => s.bookedBy)).toEqual([null, 'i1']);
    expect((await prisma.interview.findUniqueOrThrow({ where: { id: 'i1' } })).scheduledAt).toEqual(at(4));
  });

  it('最终写面试失败时事务回滚已占用的所有时段', async () => {
    await interview('i1', ['u1', 'u2']);
    await slot('t1', 'u1', 2, 3);
    await slot('t2', 'u2', 2, 3);
    await prisma.$executeRawUnsafe('ALTER TABLE "Interview" ADD CONSTRAINT interview_test_failure CHECK ("scheduledAt" IS NULL)');
    try {
      expect((await pick('i1', 't1')).status).toBe(500);
      expect((await bookings()).every((s) => s.bookedBy === null)).toBe(true);
      expect((await prisma.interview.findUniqueOrThrow({ where: { id: 'i1' } })).scheduledAt).toBeNull();
      expect(await prisma.activityLog.count()).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "Interview" DROP CONSTRAINT interview_test_failure');
    }
  });
});
