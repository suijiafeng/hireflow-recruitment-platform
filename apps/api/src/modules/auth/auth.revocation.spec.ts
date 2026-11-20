import { PERMISSIONS } from '@hireflow/shared';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginThrottleService } from './login-throttle.service';

/**
 * 真 HTTP + 真 JwtAuthGuard + 临时 PGlite：改密 / 重置 / 停用后，旧 JWT 必须立即失效。
 */
describe('JWT 吊销（tokenVersion）HTTP / 数据库回归', () => {
  let database: ChildProcess;
  let prisma: PrismaService;
  let app: INestApplication;
  let base: string;
  const PW = 'Passw0rd-old';

  beforeAll(async () => {
    database = fork(resolve(__dirname, '../../../scripts/test-stages-db.cjs'), {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const connection = await new Promise<string>((done, reject) => {
      database.once('message', (message: { connection: string }) => done(message.connection));
      database.once('error', reject);
      database.once('exit', (code) => reject(new Error(`测试数据库提前退出：${code}`)));
    });
    const env = {
      DATABASE_URL: `postgresql://postgres:postgres@${connection}/postgres`,
      DATABASE_POOL_MAX: '1',
      JWT_SECRET: 'test-secret-for-revocation-spec',
    };
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => env], isGlobal: true }),
        JwtModule.register({ global: true, secret: env.JWT_SECRET, signOptions: { expiresIn: '1h' } }),
      ],
      controllers: [AuthController, UsersController],
      providers: [
        PrismaService,
        ActivityLogService,
        AuthService,
        LoginThrottleService,
        UsersService,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();
    prisma = module.get(PrismaService);
    await prisma.$connect();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api`;

    const perm = await prisma.permission.create({ data: { code: PERMISSIONS.USER_MANAGE, name: '用户管理', group: '系统' } });
    const adminRole = await prisma.role.create({ data: { code: 'ADMIN', name: '管理员', dataScope: 'ALL' } });
    const staffRole = await prisma.role.create({ data: { code: 'HR', name: 'HR', dataScope: 'ALL' } });
    await prisma.rolePermission.create({ data: { roleId: adminRole.id, permissionId: perm.id } });
    const hash = hashSync(PW, 4);
    await prisma.user.createMany({ data: [
      { id: 'admin', email: 'admin@example.test', name: '管理员', passwordHash: hash },
      { id: 'u1', email: 'u1@example.test', name: '员工一', passwordHash: hash },
    ] });
    await prisma.userRole.createMany({ data: [
      { userId: 'admin', roleId: adminRole.id },
      { userId: 'u1', roleId: staffRole.id },
    ] });
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    if (database && database.exitCode === null) {
      const exited = new Promise<void>((done) => database.once('exit', () => done()));
      database.send('stop');
      await exited;
    }
  });

  const call = (path: string, token?: string, body?: unknown, method = body ? 'POST' : 'GET') =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  const login = async (email: string, password: string) => {
    const res = await call('/auth/login', undefined, { email, password });
    expect(res.status).toBe(200);
    return (await res.json()).accessToken as string;
  };
  const profileStatus = async (token: string) => (await call('/auth/profile', token)).status;

  it('修改密码后：旧令牌 401，当前会话拿到的新令牌可用，旧密码不能再登录', async () => {
    const laptop = await login('u1@example.test', PW);
    const phone = await login('u1@example.test', PW);
    const res = await call('/auth/password', phone, { currentPassword: PW, newPassword: 'NewPassw0rd' });
    expect(res.status).toBe(200);
    const { accessToken } = await res.json();
    expect(await profileStatus(laptop)).toBe(401);
    expect(await profileStatus(phone)).toBe(401);
    expect(await profileStatus(accessToken)).toBe(200);
    expect((await call('/auth/login', undefined, { email: 'u1@example.test', password: PW })).status).toBe(401);
    await login('u1@example.test', 'NewPassw0rd');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } });
    expect(user.tokenVersion).toBe(1);
    expect(user.passwordChangedAt).toBeInstanceOf(Date);
  });

  it('当前密码错误 / 新密码太弱时拒绝，且不吊销会话', async () => {
    const token = await login('u1@example.test', 'NewPassw0rd');
    expect((await call('/auth/password', token, { currentPassword: 'wrong-one', newPassword: 'Another1x' })).status).toBe(400);
    expect((await call('/auth/password', token, { currentPassword: 'NewPassw0rd', newPassword: 'short' })).status).toBe(400);
    expect((await call('/auth/password', token, { currentPassword: 'NewPassw0rd', newPassword: 'onlyletters' })).status).toBe(400);
    expect(await profileStatus(token)).toBe(200);
  });

  it('管理员重置密码：返回一次性临时密码，该成员所有会话立即失效；不能重置自己', async () => {
    const admin = await login('admin@example.test', PW);
    const victim = await login('u1@example.test', 'NewPassw0rd');
    const res = await call('/users/u1/reset-password', admin, {});
    expect(res.status).toBe(201);
    const { temporaryPassword } = await res.json();
    expect(temporaryPassword).toMatch(/^(?=.*[A-Za-z])(?=.*\d).{12}$/);
    expect(await profileStatus(victim)).toBe(401);
    await login('u1@example.test', temporaryPassword);
    expect((await call('/users/admin/reset-password', admin, {})).status).toBe(400);
    // 审计里不留临时密码
    const log = await prisma.activityLog.findFirst({ where: { action: 'user.password_reset' } });
    expect(JSON.stringify(log?.payload)).not.toContain(temporaryPassword);
  });

  it('停用后旧令牌 401；重新启用后，停用前签发的令牌也不会复活', async () => {
    const admin = await login('admin@example.test', PW);
    const current = (await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } })).tokenVersion;
    await prisma.user.update({ where: { id: 'u1' }, data: { passwordHash: hashSync(PW, 4) } });
    const before = await login('u1@example.test', PW);
    expect((await call('/users/u1/status', admin, { status: 'DISABLED' }, 'PATCH')).status).toBe(200);
    expect(await profileStatus(before)).toBe(401);
    expect((await call('/users/u1/status', admin, { status: 'ACTIVE' }, 'PATCH')).status).toBe(200);
    expect(await profileStatus(before)).toBe(401);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } })).tokenVersion).toBe(current + 1);
    expect(await profileStatus(await login('u1@example.test', PW))).toBe(200);
  });

  it('退出其他设备：其他令牌失效，当前会话换新令牌', async () => {
    const a = await login('u1@example.test', PW);
    const b = await login('u1@example.test', PW);
    const res = await call('/auth/sessions/revoke', a, {});
    expect(res.status).toBe(200);
    expect(await profileStatus(b)).toBe(401);
    expect(await profileStatus((await res.json()).accessToken)).toBe(200);
  });

  it('上线前签发、没有 tv 字段的旧令牌：账号从未改过密码时仍有效', async () => {
    const svc = app.get(JwtService);
    const legacy = await svc.signAsync({ sub: 'admin', email: 'admin@example.test' });
    expect(await profileStatus(legacy)).toBe(200);
    const stale = await svc.signAsync({ sub: 'u1', email: 'u1@example.test' });
    expect(await profileStatus(stale)).toBe(401);
  });
});
