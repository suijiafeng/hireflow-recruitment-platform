import { DataScope, PERMISSIONS } from '@hireflow/shared';
import { ValidationPipe, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { CandidatesController } from './candidates.controller';
import { CandidatesService } from './candidates.service';
import { ResumesController } from './resumes.controller';

/** HTTP + 全局校验/权限守卫 + 临时数据库；AI/对象存储用桩核对拒绝请求没有外部副作用。 */
describe('候选人写入范围与简历输入安全', () => {
  let database: ChildProcess;
  let prisma: PrismaService;
  let app: INestApplication;
  let base: string;
  const actor: JwtUser = {
    sub: 'resume-user', email: 'resume@example.test', name: '简历测试', roles: [],
    permissions: [PERMISSIONS.CANDIDATE_READ, PERMISSIONS.CANDIDATE_UPDATE],
    departmentId: 'd1', departmentIds: ['d1', 'child'], dataScope: DataScope.DEPARTMENT,
  };
  let currentUser: JwtUser;
  const ai = {
    parseResume: jest.fn().mockResolvedValue({ data: { skills: ['TypeScript'] }, meta: { provider: 'mock' } }),
  };
  const storage = {
    objectKey: jest.fn((prefix: string) => `${prefix}/test-file`),
    put: jest.fn().mockResolvedValue(undefined),
    presignedGetUrl: jest.fn().mockResolvedValue('https://storage.example.test/download'),
  };
  const text = '具有多年软件开发经验，熟悉团队协作与项目交付，擅长 TypeScript。';

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
    await prisma.department.createMany({ data: [
      { id: 'd1', name: '研发' }, { id: 'child', name: '子部门', parentId: 'd1' }, { id: 'd2', name: '其他' },
    ] });
    await prisma.user.create({ data: {
      id: actor.sub, email: actor.email, name: actor.name, passwordHash: 'test-only', departmentId: 'd1',
    } });
    for (const departmentId of ['d1', 'child', 'd2']) {
      await prisma.job.create({ data: {
        id: `j-${departmentId}`, title: departmentId, departmentId, createdById: actor.sub,
        stages: { create: { id: `s-${departmentId}`, name: '初筛', order: 0 } },
      } });
    }
    const module = await Test.createTestingModule({
      controllers: [CandidatesController, ResumesController],
      providers: [
        { provide: PrismaService, useValue: prisma }, ActivityLogService,
        { provide: CandidatesService, useFactory: (log: ActivityLogService) =>
          new CandidatesService(prisma, log, ai as never, storage as never), inject: [ActivityLogService] },
        { provide: APP_GUARD, useValue: { canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest().user = currentUser;
          return true;
        } } },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true,
      transformOptions: { enableImplicitConversion: true } }));
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api`;
  }, 30_000);

  beforeEach(async () => {
    currentUser = structuredClone(actor);
    jest.clearAllMocks();
    await prisma.interview.deleteMany();
    await prisma.application.deleteMany();
    await prisma.candidate.deleteMany();
    await prisma.activityLog.deleteMany();
    for (const departmentId of ['d1', 'child', 'd2']) {
      await prisma.candidate.create({ data: {
        id: `c-${departmentId}`, name: departmentId, tags: ['原标签'],
        applications: { create: { id: `a-${departmentId}`, jobId: `j-${departmentId}`, stageId: `s-${departmentId}` } },
        resumes: { create: { id: `r-${departmentId}`, rawText: text, fileKey: 'original', fileName: 'resume.pdf' } },
      } });
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

  const request = (path: string, body: unknown = {}, method = 'POST') => fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const upload = (candidate: string, buffer: Buffer, type = 'text/plain', name = 'resume.txt') => {
    const body = new FormData();
    body.append('file', new Blob([new Uint8Array(buffer)], { type }), name);
    return fetch(`${base}/candidates/${candidate}/resumes/file`, { method: 'POST', body });
  };

  it('范围外的读取、资料修改、文本导入、文件上传、解析均403，数据库和外部服务无副作用', async () => {
    expect((await fetch(`${base}/candidates/c-d2`)).status).toBe(403);
    expect((await request('/candidates/c-d2', { name: '越权' }, 'PATCH')).status).toBe(403);
    expect((await request('/candidates/c-d2/resumes', { rawText: text })).status).toBe(403);
    expect((await upload('c-d2', Buffer.from(text))).status).toBe(403);
    expect((await request('/resumes/r-d2/parse')).status).toBe(403);
    expect(await prisma.resume.count()).toBe(3);
    expect(await prisma.activityLog.count()).toBe(0);
    expect(await prisma.candidate.findUnique({ where: { id: 'c-d2' } })).toMatchObject({ name: 'd2', tags: ['原标签'] });
    expect(ai.parseResume).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
    expect(storage.objectKey).not.toHaveBeenCalled();
  });

  it('本部门与子部门允许更新和导入；共享候选人遵守已有的至少一条本部门应聘规则', async () => {
    for (const id of ['c-d1', 'c-child']) {
      expect((await request(`/candidates/${id}`, { name: '允许更新' }, 'PATCH')).status).toBe(200);
      expect((await request(`/candidates/${id}/resumes`, { rawText: text })).status).toBe(201);
    }
    await prisma.application.create({ data: { candidateId: 'c-d2', jobId: 'j-d1', stageId: 's-d1' } });
    expect((await request('/candidates/c-d2/resumes', { rawText: text })).status).toBe(201);
  });

  it('仅被指派范围只允许本人指派的候选人；ALL范围允许跨部门', async () => {
    currentUser.dataScope = DataScope.ASSIGNED;
    await prisma.interview.create({ data: {
      applicationId: 'a-d1', round: 1, interviewers: { create: { userId: actor.sub } },
    } });
    expect((await request('/candidates/c-d1/resumes', { rawText: text })).status).toBe(201);
    expect((await request('/candidates/c-d2/resumes', { rawText: text })).status).toBe(403);
    currentUser.dataScope = DataScope.ALL;
    expect((await request('/candidates/c-d2/resumes', { rawText: text })).status).toBe(201);
  });

  it('空格文本400且不写库；正文去除首尾空白后保存', async () => {
    expect((await request('/candidates/c-d1/resumes', { rawText: ' '.repeat(30) })).status).toBe(400);
    expect(await prisma.resume.count()).toBe(3);
    const response = await request('/candidates/c-d1/resumes', { rawText: ` \n ${text} \n ` });
    expect(response.status).toBe(201);
    expect((await response.json()).rawText).toBe(text);
  });

  it('空文件400、伪装PNG的HTML415，均不上传到存储、不新增简历', async () => {
    expect((await upload('c-d1', Buffer.alloc(0))).status).toBe(400);
    expect((await upload('c-d1', Buffer.from('<html><script>alert(1)</script></html>'), 'image/png', 'fake.png')).status).toBe(415);
    expect(storage.put).not.toHaveBeenCalled();
    expect(await prisma.resume.count()).toBe(3);
    expect(await prisma.activityLog.count()).toBe(0);
  });

  it('真实文本可抽取、真实PNG保持人工处理留档流程', async () => {
    const plain = await upload('c-d1', Buffer.from(text));
    expect(plain.status).toBe(201);
    expect(await plain.json()).toMatchObject({ rawText: text, textExtracted: true });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZgAAAABJRU5ErkJggg==', 'base64');
    const image = await upload('c-d1', png, 'image/png', 'scan.png');
    expect(image.status).toBe(201);
    expect(await image.json()).toMatchObject({ rawText: null, textExtracted: false, parseStatus: 'PENDING' });
    expect(storage.put).toHaveBeenCalledTimes(2);
  });

  it('合法解析更新标签；历史空白简历不调用AI；原件链接强制下载', async () => {
    expect((await request('/resumes/r-d1/parse')).status).toBe(201);
    expect(await prisma.candidate.findUnique({ where: { id: 'c-d1' } })).toMatchObject({ tags: ['原标签', 'TypeScript'] });
    await prisma.resume.update({ where: { id: 'r-d1' }, data: { rawText: '  ', parseStatus: 'PENDING' } });
    ai.parseResume.mockClear();
    expect((await request('/resumes/r-d1/parse')).status).toBe(400);
    expect(ai.parseResume).not.toHaveBeenCalled();
    expect((await fetch(`${base}/resumes/r-d1/file-url`)).status).toBe(200);
    expect(storage.presignedGetUrl).toHaveBeenCalledWith('original', 'resume.pdf', 600, 'attachment');
  });
});
