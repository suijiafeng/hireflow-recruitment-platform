import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { loadAccess } from '../../common/access';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginThrottleService } from './login-throttle.service';

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
  ) {}

  /** @param ip 真实客户端 IP；拿不到可信 IP 时传 null，只做按账号限流 */
  async login(email: string, password: string, ip: string | null = null) {
    this.throttle.assertAllowed(email, ip);
    const loaded = await loadAccess(this.prisma, { email });
    const user = loaded?.user;
    const passwordOk = await compare(password, user?.passwordHash ?? TIMING_EQUALIZER_HASH);
    if (!loaded || !user || !passwordOk || user.status !== 'ACTIVE') {
      this.throttle.recordFailure(email, ip);
      throw new UnauthorizedException(LOGIN_FAILED);
    }
    this.throttle.recordSuccess(email);
    const payload = loaded.access;
    const { roles, permissions } = payload;

    return {
      accessToken: await this.jwtService.signAsync({ ...payload }),
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
