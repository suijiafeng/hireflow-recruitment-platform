import { randomBytes } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { hashSync } from 'bcryptjs';
import { ACTIVITY_ACTIONS, RoleCode } from '@hireflow/shared';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { InviteUserDto } from './dto/invite-user.dto';

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  status: true,
  department: { select: { id: true, name: true } },
  roles: { select: { role: { select: { code: true, name: true } } } },
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /** 内部用户列表（设置页/面试官选择器用） */
  async list(role?: string) {
    return this.prisma.user.findMany({
      // 带角色过滤的是选择器（用人经理 / 面试官下拉）：已停用的人不该再被选中
      where: role ? { status: 'ACTIVE', roles: { some: { role: { code: role } } } } : undefined,
      select: USER_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 邀请内部成员。
   *
   * 业务约束：
   * - 邮箱即登录账号，必须全局唯一；
   * - 至少一个角色——没有角色的账号能登录却什么都看不到，是个死账号；
   * - 门户角色（CANDIDATE / NEW_HIRE）属于免登录 H5 身份，不可分配给内部成员；
   * - 部门可选，但给了就必须存在。
   *
   * 本项目未接邮件通道，因此生成初始密码并「仅此一次」随响应返回，由管理员转交。
   * 注意：初始密码不写入 ActivityLog——审计留痕是长期保存且可被更多人查看的，
   * 把凭据落进去等于永久泄露。留痕只记谁邀请了谁、给了什么角色。
   */
  async invite(dto: InviteUserDto, actor: JwtUser) {
    const email = dto.email.trim().toLowerCase();
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new BadRequestException(`邮箱「${email}」已被占用（${exists.name}）`);

    const unique = [...new Set(dto.roleCodes)];
    const portal: string[] = [RoleCode.CANDIDATE, RoleCode.NEW_HIRE];
    const portalPicked = unique.filter((c) => portal.includes(c));
    if (portalPicked.length) {
      throw new BadRequestException(`「${portalPicked.join('、')}」是候选人/新员工门户角色，不能分配给内部成员`);
    }
    const roles = await this.prisma.role.findMany({ where: { code: { in: unique } } });
    if (roles.length !== unique.length) {
      const known = new Set(roles.map((r) => r.code));
      throw new BadRequestException(`未知角色码：${unique.filter((c) => !known.has(c)).join('、')}`);
    }

    if (dto.departmentId) {
      const dept = await this.prisma.department.findUnique({ where: { id: dto.departmentId } });
      if (!dept) throw new BadRequestException('所选部门不存在');
    }

    // 12 位随机初始密码：去掉易混淆字符，方便口头/IM 转交
    const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#%';
    const initialPassword = Array.from(
      randomBytes(12),
      (b) => ALPHABET[b % ALPHABET.length],
    ).join('');

    const userId = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name: dto.name.trim(),
          passwordHash: hashSync(initialPassword, 10),
          departmentId: dto.departmentId ?? null,
        },
      });
      await tx.userRole.createMany({
        data: roles.map((r) => ({ userId: user.id, roleId: r.id })),
      });
      await this.activityLog.record(
        actor,
        ACTIVITY_ACTIONS.USER_INVITED,
        'User',
        user.id,
        // 不含密码：审计留痕长期保存，凭据不进日志
        { email, userName: user.name, roles: [...unique].sort(), departmentId: dto.departmentId ?? null },
        tx,
      );
      return user.id;
    });

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
    return { user, initialPassword };
  }

  /**
   * 停用 / 启用账号。停用即时生效（鉴权每次按库查状态），不删数据、不动历史留痕。
   * 不能停用自己；不能停掉最后一名在用的管理员。
   */
  async setStatus(userId: string, status: 'ACTIVE' | 'DISABLED', actor: JwtUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new NotFoundException('用户不存在');
    if (user.status === status) return this.prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
    if (status === 'DISABLED') {
      if (userId === actor.sub) throw new ForbiddenException('不能停用自己的账号');
      if (user.roles.some((ur) => ur.role.code === RoleCode.ADMIN)) {
        const otherAdmins = await this.prisma.user.count({
          where: { id: { not: userId }, status: 'ACTIVE', roles: { some: { role: { code: RoleCode.ADMIN } } } },
        });
        if (otherAdmins === 0) throw new ForbiddenException('系统需至少保留一名在用的系统管理员');
      }
    }
    // 停用的人手上还挂着多少职位：返回给前端提示管理员去换用人经理
    const openJobs = status === 'DISABLED'
      ? await this.prisma.job.findMany({
          where: { hiringManagerId: userId, status: { in: ['OPEN', 'PAUSED'] } },
          select: { id: true, title: true },
        })
      : [];
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status } });
      await this.activityLog.record(
        actor,
        ACTIVITY_ACTIONS.USER_STATUS_UPDATED,
        'User',
        userId,
        { userName: user.name, status, openJobs: openJobs.map((j) => j.title) },
        tx,
      );
    });
    const updated = await this.prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
    return { ...updated, openJobs };
  }

  /**
   * 全量替换用户的角色。
   * 鉴权每次按库重算角色与权限，调整后下一次请求即生效。
   */
  async updateRoles(userId: string, roleCodes: string[], actor: JwtUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new NotFoundException('用户不存在');

    const unique = [...new Set(roleCodes)];
    const roles = await this.prisma.role.findMany({ where: { code: { in: unique } } });
    if (roles.length !== unique.length) {
      const known = new Set(roles.map((r) => r.code));
      throw new BadRequestException(`未知角色码：${unique.filter((c) => !known.has(c)).join('、')}`);
    }

    // 防锁死：撤掉某人的 ADMIN 前，确认系统里还有其他在用的管理员
    const hadAdmin = user.roles.some((ur) => ur.role.code === RoleCode.ADMIN);
    const keepsAdmin = unique.includes(RoleCode.ADMIN);
    if (hadAdmin && !keepsAdmin) {
      const otherAdmins = await this.prisma.user.count({
        where: {
          id: { not: userId },
          status: 'ACTIVE',
          roles: { some: { role: { code: RoleCode.ADMIN } } },
        },
      });
      if (otherAdmins === 0) {
        throw new ForbiddenException('系统需至少保留一名系统管理员');
      }
    }

    const before = user.roles.map((ur) => ur.role.code).sort();
    const after = [...unique].sort();

    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId } });
      await tx.userRole.createMany({
        data: roles.map((r) => ({ userId, roleId: r.id })),
      });
      await this.activityLog.record(
        actor,
        ACTIVITY_ACTIONS.USER_ROLES_UPDATED,
        'User',
        userId,
        { userName: user.name, before, after },
        tx,
      );
    });

    return this.prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
  }
}
