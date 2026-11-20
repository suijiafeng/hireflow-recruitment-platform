import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_DEFS, RoleCode } from '@hireflow/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import helmet from 'helmet';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { startTestDatabase } from './pglite';

export interface Res {
  status: number;
  headers: Headers;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  /** 以当前登录身份调用 /api/*；auth=false 时匿名（门户） */
  call: (method: string, path: string, body?: unknown, auth?: boolean) => Promise<Res>;
  login: (email?: string, password?: string) => Promise<void>;
  /** 带当前登录身份的原始请求（multipart 上传、二进制下载） */
  fetchRaw: (path: string, init?: RequestInit) => Promise<Response>;
  stop: () => Promise<void>;
}

/** 2xx 即可（POST 有的回 200 有的回 201）；失败时把响应体带进报错，方便定位 */
export function expectOk<R extends { status: number; body: unknown }>(res: R): R {
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return res;
}

export const TEST_HR = { id: 'hr-e2e', email: 'hr@e2e.test', password: 'Passw0rd!', name: '何欣', departmentId: 'dept-e2e' };

/**
 * 整个 AppModule + 真 HTTP + 临时 Postgres WASM（AI 用规则引擎、文件存本地临时目录）。
 * 预置：全量权限点、ADMIN 角色、一个部门、一个管理员 HR 账号。
 */
export async function bootTestApp(): Promise<TestApp> {
  const db = await startTestDatabase();
  Object.assign(process.env, {
    DATABASE_URL: db.url,
    DATABASE_POOL_MAX: '1',
    JWT_SECRET: 'e2e-test-secret-that-is-long-enough-123456',
    AI_PROVIDER: 'mock',
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'hf-e2e-')),
    COMPANY_NAME: '测试科技有限公司',
  });
  // 环境变量必须在加载 AppModule 之前就位（ConfigModule / 各服务在构造时读取），所以这里延迟 require
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { AppModule } = require('../app.module') as typeof import('../app.module');
  const { createValidationPipe } = require('../common/validation') as typeof import('../common/validation');
  const { AllExceptionsFilter } = require('../common/filters/all-exceptions.filter') as typeof import('../common/filters/all-exceptions.filter');
  const { requestContext } = require('../common/request-context') as typeof import('../common/request-context');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.use(helmet());
  app.use(requestContext);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0, '127.0.0.1');
  const api = `${await app.getUrl()}/api`;

  // PGlite 是单会话后端，只能有一条连接：直接复用应用自己的 PrismaService 准备数据
  const prisma = app.get(PrismaService);
  await prisma.permission.createMany({ data: PERMISSION_DEFS.map((p) => ({ ...p })) });
  const admin = DEFAULT_ROLE_PERMISSIONS[RoleCode.ADMIN];
  const role = await prisma.role.create({ data: { code: RoleCode.ADMIN, name: admin.name, dataScope: admin.dataScope } });
  const perms = await prisma.permission.findMany();
  await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
  await prisma.department.create({ data: { id: TEST_HR.departmentId, name: '研发部' } });
  await prisma.user.create({
    data: {
      id: TEST_HR.id,
      email: TEST_HR.email,
      name: TEST_HR.name,
      passwordHash: hashSync(TEST_HR.password, 4),
      departmentId: TEST_HR.departmentId,
      roles: { create: { roleId: role.id } },
    },
  });

  let token = '';
  const call = async (method: string, path: string, body?: unknown, auth = true): Promise<Res> => {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(auth && token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, headers: res.headers, body: parsed };
  };
  const login = async (email = TEST_HR.email, password = TEST_HR.password) => {
    const res = expectOk(await call('POST', '/auth/login', { email, password }, false));
    token = (res.body as { accessToken: string }).accessToken;
  };
  const fetchRaw = (path: string, init: RequestInit = {}) =>
    fetch(`${api}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  return {
    app,
    prisma,
    call,
    login,
    fetchRaw,
    stop: async () => {
      await app.close();
      await db.stop();
    },
  };
}

/** 建职位 + 候选人 + 投递，返回 applicationId 与各系统阶段 */
export async function createApplication(t: TestApp, name = '沈知夏', email?: string) {
  const job = expectOk(await t.call('POST', '/jobs', { title: `职位-${name}`, departmentId: TEST_HR.departmentId, headcount: 2, status: 'OPEN' }));
  const candidate = expectOk(await t.call('POST', '/candidates', { name, email: email ?? `${encodeURIComponent(name)}-${Date.now()}@example.com` }));
  const application = expectOk(await t.call('POST', '/applications', { candidateId: candidate.body.id, jobId: job.body.id }));
  const stages = await t.prisma.pipelineStage.findMany({ where: { jobId: job.body.id }, orderBy: { order: 'asc' } });
  return { jobId: job.body.id as string, candidateId: candidate.body.id as string, applicationId: application.body.id as string, stages };
}
