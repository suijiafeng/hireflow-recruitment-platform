import { Injectable, Logger } from '@nestjs/common';
import { PERMISSIONS, RoleCode } from '@hireflow/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 站内通知（通知矩阵的站内信渠道）。
 * 推送失败不抛错、不阻断主流程；邮件/IM 渠道后续在此扩展。
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 给指定用户推送站内信 */
  async push(userIds: string[], title: string, body?: string, link?: string) {
    const unique = [...new Set(userIds)].filter(Boolean);
    if (unique.length === 0) return;
    try {
      await this.prisma.notification.createMany({
        data: unique.map((userId) => ({ userId, title, body, link })),
      });
    } catch (error) {
      this.logger.warn(`站内信推送失败：${error instanceof Error ? error.message : error}`);
    }
  }

  /** 按角色推送（如：通知所有 HR）。业务状态多在此调用前已落库，查询失败同样不阻断主流程 */
  async pushToRole(role: RoleCode, title: string, body?: string, link?: string) {
    try {
      const users = await this.prisma.user.findMany({
        where: { status: 'ACTIVE', roles: { some: { role: { code: role } } } },
        select: { id: true },
      });
      await this.push(
        users.map((u) => u.id),
        title,
        body,
        link,
      );
    } catch (error) {
      this.logger.warn(`按角色推送失败（${role}）：${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * 职位的「负责人」——审批 Offer、接收满编/入职等职位级通知的人：
   * 1. 职位指定了用人经理 → 只发给他；
   * 2. 未指定 → 本部门及上级部门里有「审批 Offer」权限的在职成员（技术部总监能审前端组的 Offer）；
   * 3. 仍无人 → 有该权限且数据范围为全局的成员（管理员），保证不会无人知晓。
   */
  async jobManagerIds(jobId: string): Promise<string[]> {
    try {
      const row = await this.prisma.job.findUnique({
        where: { id: jobId },
        select: { hiringManagerId: true, departmentId: true },
      });
      if (!row) return [];
      if (row.hiringManagerId) {
        // 用人经理已停用（离职）时不能把通知发进一个没人看的账号：按下面的兜底规则另找人
        const manager = await this.prisma.user.findUnique({ where: { id: row.hiringManagerId }, select: { status: true } });
        if (manager?.status === 'ACTIVE') return [row.hiringManagerId];
      }

      const chain = await this.departmentChain(row.departmentId);
      const approve = { permissions: { some: { permission: { code: PERMISSIONS.OFFER_APPROVE } } } };
      const inDept = await this.prisma.user.findMany({
        where: { status: 'ACTIVE', departmentId: { in: chain }, roles: { some: { role: approve } } },
        select: { id: true },
      });
      if (inDept.length) return inDept.map((u) => u.id);
      const global = await this.prisma.user.findMany({
        where: { status: 'ACTIVE', roles: { some: { role: { dataScope: 'ALL', ...approve } } } },
        select: { id: true },
      });
      return global.map((u) => u.id);
    } catch (error) {
      this.logger.warn(`职位负责人解析失败：${error instanceof Error ? error.message : error}`);
      return [];
    }
  }

  /** 某部门及其全部上级部门的 id（含自身） */
  private async departmentChain(departmentId: string | null): Promise<string[]> {
    const departments = await this.prisma.department.findMany({ select: { id: true, parentId: true } });
    const parentOf = new Map(departments.map((d) => [d.id, d.parentId]));
    const chain: string[] = [];
    for (let id: string | null | undefined = departmentId; id && !chain.includes(id); id = parentOf.get(id)) {
      chain.push(id);
    }
    return chain;
  }

  /**
   * 按「能做这件事」找收件人，而不是按角色名：管理员自建的招聘类角色也能收到提醒。
   * 范围按角色的数据范围收口：
   * - ALL：全部收到；
   * - DEPARTMENT：只有职位所在部门（或其上级部门）的成员收到；
   * - ASSIGNED / OWN：不是「负责一类事」的角色，不按权限广播（他们的通知走指派 / 职位负责人）。
   */
  async recipientsByPermission(permission: string, departmentId: string | null): Promise<string[]> {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          status: 'ACTIVE',
          roles: { some: { role: { permissions: { some: { permission: { code: permission } } } } } },
        },
        select: {
          id: true,
          departmentId: true,
          roles: { select: { role: { select: { dataScope: true, permissions: { select: { permission: { select: { code: true } } } } } } } },
        },
      });
      const chain = new Set(await this.departmentChain(departmentId));
      return users
        .filter((u) => {
          // 只看真正带这个权限的角色的数据范围：面试官 + 自建 HR 角色的人，按 HR 角色的范围算
          const scopes = u.roles
            .filter((r) => r.role.permissions.some((rp) => rp.permission.code === permission))
            .map((r) => r.role.dataScope);
          if (scopes.includes('ALL')) return true;
          if (scopes.includes('DEPARTMENT')) return !departmentId || (u.departmentId != null && chain.has(u.departmentId));
          return false;
        })
        .map((u) => u.id);
    } catch (error) {
      this.logger.warn(`按权限找收件人失败（${permission}）：${error instanceof Error ? error.message : error}`);
      return [];
    }
  }

  async pushByPermission(permission: string, departmentId: string | null, title: string, body?: string, link?: string) {
    await this.push(await this.recipientsByPermission(permission, departmentId), title, body, link);
  }

  async list(userId: string, unreadOnly = false) {
    const [items, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: { userId, ...(unreadOnly ? { read: false } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.prisma.notification.count({ where: { userId, read: false } }),
    ]);
    return { items, unread };
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId }, data: { read: true } });
    return this.list(userId);
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
    return this.list(userId);
  }
}
