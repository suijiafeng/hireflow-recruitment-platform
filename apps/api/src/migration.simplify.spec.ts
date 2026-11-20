import { ConfigService } from '@nestjs/config';
import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaService } from './prisma/prisma.service';

/**
 * 迁移回归：20261122000000_simplify 把旧的 6 阶段看板并成 4 个系统阶段，并迁移 Offer / 入职数据。
 * 先建到上一版表结构、写入旧数据，再执行这次迁移，检查结果。
 */
describe('迁移：流程简化', () => {
  let child: ChildProcess;
  let prisma: PrismaService;

  beforeAll(async () => {
    child = fork(resolve(__dirname, '../scripts/test-stages-db.cjs'), {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, MIGRATE_UNTIL: '20261122000000_simplify' },
    });
    const connection = await new Promise<string>((done, reject) => {
      child.once('message', (m: { connection: string }) => done(m.connection));
      child.once('exit', (code) => reject(new Error(`测试数据库提前退出：${code}`)));
    });
    prisma = new PrismaService(new ConfigService({ DATABASE_URL: `postgresql://postgres:postgres@${connection}/postgres`, DATABASE_POOL_MAX: '1' }));
    await prisma.$connect();

    const sql = (q: string) => prisma.$executeRawUnsafe(q);
    await sql(`INSERT INTO "Department" (id, name) VALUES ('d1', '研发')`);
    await sql(`INSERT INTO "User" (id, email, name, "passwordHash", "updatedAt") VALUES ('u1', 'hr@t.test', 'HR', 'x', now())`);
    await sql(`INSERT INTO "Role" (id, code, name, "dataScope") VALUES ('r1', 'CANDIDATE', '候选人', 'OWN'), ('r2', 'HIRING_MANAGER', '用人经理', 'DEPARTMENT')`);
    await sql(`INSERT INTO "Permission" (id, code, name, "group") VALUES ('p1', 'offer:approve', '审批 Offer', 'offer'), ('p2', 'onboarding:upload', '上传', 'onboarding')`);
    await sql(`INSERT INTO "RolePermission" ("roleId", "permissionId") VALUES ('r2', 'p1')`);
    // 旧 6 阶段职位 + 只有 3 个阶段且夹了自定义阶段的职位 + 待审批职位
    await sql(`INSERT INTO "Job" (id, title, "departmentId", "createdById", status, "updatedAt") VALUES
      ('j1', '后端', 'd1', 'u1', 'OPEN', now()), ('j2', '设计', 'd1', 'u1', 'PENDING_APPROVAL', now())`);
    await sql(`INSERT INTO "PipelineStage" (id, "jobId", name, "order") VALUES
      ('a0', 'j1', '简历初筛', 0), ('a1', 'j1', '一面', 1), ('a2', 'j1', '二面', 2), ('a3', 'j1', 'Offer', 3), ('a4', 'j1', '待入职', 4), ('a5', 'j1', '已入职', 5),
      ('b0', 'j2', '简历初筛', 0), ('b1', 'j2', '作品集评审', 1), ('b2', 'j2', '一面', 2)`);
    await sql(`INSERT INTO "Candidate" (id, name, tags, "updatedAt") VALUES ('c1', '甲', '{}', now()), ('c2', '乙', '{}', now()), ('c3', '丙', '{}', now()), ('c4', '丁', '{}', now())`);
    await sql(`INSERT INTO "Application" (id, "candidateId", "jobId", "stageId", status, "updatedAt") VALUES
      ('x1', 'c1', 'j1', 'a2', 'ACTIVE', now()), ('x2', 'c2', 'j1', 'a5', 'HIRED', now()), ('x3', 'c3', 'j2', 'b1', 'ACTIVE', now()), ('x4', 'c4', 'j1', 'a3', 'ACTIVE', now())`);
    await sql(`INSERT INTO "Offer" (id, "applicationId", salary, "approvalStatus", "updatedAt") VALUES ('o1', 'x4', '{"base":1}', 'PENDING', now())`);

    // 迁移会重建枚举类型：先断开，迁移后重新连接，避免连接里缓存的旧类型 / 执行计划
    await prisma.$disconnect();
    const migrated = await new Promise<{ migrated: boolean; error?: string }>((done) => {
      child.once('message', (m: { migrated: boolean; error?: string }) => done(m));
      child.send('migrate-rest');
    });
    if (!migrated.migrated) throw new Error(migrated.error);
    prisma = new PrismaService(new ConfigService({ DATABASE_URL: `postgresql://postgres:postgres@${connection}/postgres`, DATABASE_POOL_MAX: '1' }));
    await prisma.$connect();
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((done) => child.once('exit', () => done()));
      child.send('stop');
      await exited;
    }
  });

  it('6 阶段并成 4 个系统阶段，应聘落到对应阶段', async () => {
    const j1 = await prisma.pipelineStage.findMany({ where: { jobId: 'j1' }, orderBy: { order: 'asc' } });
    expect(j1.map((s) => [s.name, s.kind, s.order])).toEqual([
      ['筛选', 'SCREENING', 0],
      ['面试', 'INTERVIEW', 1],
      ['录用', 'OFFER', 2],
      ['入职', 'ONBOARDING', 3],
    ]);
    const stageKind = async (id: string) =>
      (await prisma.application.findUniqueOrThrow({ where: { id }, include: { stage: true } })).stage.kind;
    expect(await stageKind('x1')).toBe('INTERVIEW');
    expect(await stageKind('x2')).toBe('ONBOARDING');
    expect(await stageKind('x4')).toBe('OFFER');
  });

  it('缺的系统阶段补齐，自定义阶段保留在原位置', async () => {
    const j2 = await prisma.pipelineStage.findMany({ where: { jobId: 'j2' }, orderBy: { order: 'asc' } });
    expect(j2.map((s) => [s.name, s.kind])).toEqual([
      ['筛选', 'SCREENING'],
      ['作品集评审', 'CUSTOM'],
      ['面试', 'INTERVIEW'],
      ['录用', 'OFFER'],
      ['入职', 'ONBOARDING'],
    ]);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: 'x3' } })).stageId).toBe('b1');
  });

  it('待审批职位变草稿；审批中的 Offer 变草稿；废弃角色 / 权限清理，用人经理保留查看 Offer', async () => {
    expect((await prisma.job.findUniqueOrThrow({ where: { id: 'j2' } })).status).toBe('DRAFT');
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: 'o1' } })).status).toBe('DRAFT');
    expect(await prisma.role.findUnique({ where: { code: 'CANDIDATE' } })).toBeNull();
    expect(await prisma.permission.findUnique({ where: { code: 'onboarding:upload' } })).toBeNull();
    const kept = await prisma.rolePermission.findMany({ where: { roleId: 'r2' }, include: { permission: true } });
    expect(kept.map((k) => k.permission.code)).toEqual(['offer:read']);
  });
});
