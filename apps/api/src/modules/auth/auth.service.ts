import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { ACTIVITY_ACTIONS } from '@hireflow/shared';
import { loadAccess } from '../../common/access';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { LoginThrottleService, type LoginSource } from './login-throttle.service';

/**
 * 账号不存在时也跑一次同成本的 bcrypt 比较：否则「不存在」比「密码错」快几十毫秒，
 * 响应时间本身就能用来枚举邮箱。该哈希对应的明文不是任何账号的密码。
 */
const TIMING_EQUALIZER_HASH = '$2b$10$TGAxbmieEnvb3pGeaKEmeuo82LV/98Zliiew0U8j1zFFY6iyI1bzC';
/** 所有登录失败统一一句话：区分「不存在/已停用」与「密码错」会泄露账号是否存在 */
const LOGIN_FAILED = '邮箱或密码错误';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly throttle: LoginThrottleService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /** @param source 客户端来源；IP 不可信（未配 TRUST_PROXY）时限流退化为按账号、退避上限 60 秒 */
  async login(email: string, password: string, source: LoginSource = { ip: null, trusted: false }) {
    this.throttle.assertAllowed(email, source);
    const loaded = await loadAccess(this.prisma, { email });
    const user = loaded?.user;
    const passwordOk = await compare(password, user?.passwordHash ?? TIMING_EQUALIZER_HASH);
    if (!loaded || !user || !passwordOk || user.status !== 'ACTIVE') {
      this.throttle.recordFailure(email, source);
      throw new UnauthorizedException(LOGIN_FAILED);
    }
    this.throttle.recordSuccess(email, source);
    const payload = loaded.access;
    const { roles, permissions } = payload;

    return {
      accessToken: await this.sign(payload, user.tokenVersion),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles,
        permissions,
        department: user.department ? { id: user.department.id, name: user.department.name } : null,
      },
    };
  }

  /**
   * 签发令牌：tv = 账号当前 tokenVersion。改密 / 重置 / 停用会把 tokenVersion +1，
   * JwtAuthGuard 比对不一致即拒绝——此前签发的所有令牌（包括被盗的）立即作废，不必等 12 小时过期。
   */
  private sign(access: JwtUser, tokenVersion: number) {
    return this.jwtService.signAsync({ ...access, tv: tokenVersion });
  }

  /**
   * 修改自己的密码：校验当前密码 → 写新哈希 → tokenVersion+1（其他设备上的登录全部失效）→
   * 给当前会话签一张新令牌，用户不用重新登录。当前密码校验也走登录限流，防止拿到一个会话后在线猜原密码。
   */
  async changePassword(user: JwtUser, currentPassword: string, newPassword: string, source?: LoginSource) {
    this.throttle.assertAllowed(user.email, source);
    const row = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!row) throw new UnauthorizedException('账号不存在');
    if (!(await compare(currentPassword, row.passwordHash))) {
      this.throttle.recordFailure(user.email, source);
      throw new BadRequestException('当前密码不正确');
    }
    if (await compare(newPassword, row.passwordHash)) throw new BadRequestException('新密码不能与当前密码相同');
    const passwordHash = await hash(newPassword, 10);
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: row.id },
        data: { passwordHash, passwordChangedAt: new Date(), tokenVersion: { increment: 1 } },
      });
      await this.activityLog.record(user, ACTIVITY_ACTIONS.USER_PASSWORD_CHANGED, 'User', row.id, { userName: row.name }, tx);
      return u;
    });
    this.throttle.recordSuccess(user.email, source);
    const loaded = await loadAccess(this.prisma, { id: row.id });
    if (!loaded) throw new UnauthorizedException('账号不存在');
    return { accessToken: await this.sign(loaded.access, updated.tokenVersion) };
  }

  /** 退出所有设备：tokenVersion+1，返回当前会话的新令牌 */
  async revokeOtherSessions(user: JwtUser) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id: user.sub }, data: { tokenVersion: { increment: 1 } } });
      await this.activityLog.record(user, ACTIVITY_ACTIONS.USER_SESSIONS_REVOKED, 'User', user.sub, { userName: user.name }, tx);
      return u;
    });
    const loaded = await loadAccess(this.prisma, { id: user.sub });
    if (!loaded) throw new UnauthorizedException('账号不存在');
    return { accessToken: await this.sign(loaded.access, updated.tokenVersion) };
  }

  async profile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        department: true,
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      department: user.department ? { id: user.department.id, name: user.department.name } : null,
      roles: user.roles.map((ur) => ({
        code: ur.role.code,
        name: ur.role.name,
        dataScope: ur.role.dataScope,
      })),
      permissions: this.flattenPermissions(user.roles),
    };
  }

  private flattenPermissions(
    roles: Array<{ role: { permissions: Array<{ permission: { code: string } }> } }>,
  ): string[] {
    return [...new Set(roles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.code)))];
  }
}
