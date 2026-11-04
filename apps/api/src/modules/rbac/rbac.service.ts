import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ACTIVITY_ACTIONS, RoleCode } from '@hireflow/shared';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateRoleDto } from './dto/create-role.dto';

const ROLE_INCLUDE = {
  permissions: { include: { permission: true } },
  _count: { select: { users: true } },
} as const;

@Injectable()
export class RbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /**
   * 新建自定义角色。
   *
   * 业务约束：
   * - 角色码是权限判定的依据且创建后不可改，因此格式与唯一性都在这里卡死；
   * - 不允许新建 ADMIN——该角色码由 seed 独占并强制全量权限，重名会让权限判定产生歧义；
   * - 门户角色（CANDIDATE / NEW_HIRE）同理保留，它们不是后台角色；
   * - dataScope 缺省取最小的 ASSIGNED，避免手滑建出一个能看全公司数据的角色。
   */
  async createRole(dto: CreateRoleDto, actor: JwtUser) {
    const code = dto.code.trim().toUpperCase();
    const reserved: string[] = [RoleCode.ADMIN, RoleCode.CANDIDATE, RoleCode.NEW_HIRE];
    if (reserved.includes(code)) {
      throw new ForbiddenException(`「${code}」是系统保留角色码，不可新建`);
    }
    const exists = await this.prisma.role.findUnique({ where: { code } });
    if (exists) throw new BadRequestException(`角色码「${code}」已存在（${exists.name}）`);

    const unique = [...new Set(dto.permissions ?? [])];
    const permissions = unique.length
      ? await this.prisma.permission.findMany({ where: { code: { in: unique } } })
      : [];
    if (permissions.length !== unique.length) {
      const known = new Set(permissions.map((p) => p.code));
      throw new BadRequestException(`未知权限码：${unique.filter((c) => !known.has(c)).join('、')}`);
    }

    const roleId = await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: { code, name: dto.name.trim(), dataScope: dto.dataScope ?? 'ASSIGNED' },
      });
      if (permissions.length) {
        await tx.rolePermission.createMany({
          data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
        });
      }
      await this.activityLog.record(
        actor,
        ACTIVITY_ACTIONS.ROLE_CREATED,
        'Role',
        role.id,
        { roleCode: code, roleName: role.name, dataScope: role.dataScope, permissions: [...unique].sort() },
        tx,
      );
      return role.id;
    });

    return this.prisma.role.findUnique({ where: { id: roleId }, include: ROLE_INCLUDE });
  }

  /**
   * 全量替换角色的功能点权限。
   * 下次请求即按库里的新权限鉴权，不必重新登录。
   */
  async updateRolePermissions(roleId: string, codes: string[], actor: JwtUser) {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw new NotFoundException('角色不存在');
    // 管理员角色锁定全量权限：防止误操作把唯一能改权限的角色改瘸，重启后 seed 也会强制对齐
    if (role.code === RoleCode.ADMIN) {
      throw new ForbiddenException('系统管理员角色始终拥有全部权限，不可编辑');
    }

    const unique = [...new Set(codes)];
    const permissions = await this.prisma.permission.findMany({ where: { code: { in: unique } } });
    if (permissions.length !== unique.length) {
      const known = new Set(permissions.map((p) => p.code));
      throw new BadRequestException(`未知权限码：${unique.filter((c) => !known.has(c)).join('、')}`);
    }

    const before = role.permissions.map((rp) => rp.permission.code).sort();
    const after = [...unique].sort();

    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (permissions.length) {
        await tx.rolePermission.createMany({
          data: permissions.map((p) => ({ roleId, permissionId: p.id })),
        });
      }
      await this.activityLog.record(
        actor,
        ACTIVITY_ACTIONS.ROLE_PERMISSIONS_UPDATED,
        'Role',
        roleId,
        { roleCode: role.code, roleName: role.name, before, after },
        tx,
      );
    });

    return this.prisma.role.findUnique({ where: { id: roleId }, include: ROLE_INCLUDE });
  }
}
