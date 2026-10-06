import { Injectable } from '@nestjs/common';
import type { ActivityAction } from '@hireflow/shared';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ActivityLogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 记录一条操作留痕。
   * 与业务写库不在同一事务，失败不阻断主流程；需要强一致时传入 tx。
   */
  async record(
    actor: JwtUser | null,
    action: ActivityAction,
    entityType: string,
    entityId: string,
    payload?: Prisma.InputJsonValue,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    return client.activityLog.create({
      data: {
        actorId: actor?.sub ?? null,
        actorName: actor?.name ?? '系统',
        action,
        entityType,
        entityId,
        payload,
      },
    });
  }

  /**
   * 系统自动动作的留痕（自动移卡、满编暂停、入职闭环、Webhook 等）：操作人记为「系统」，
   * 触发它的人写进 payload.triggeredBy。否则时间轴上会出现「IT 把卡片移到了已入职」这种误导。
   */
  async recordAuto(
    trigger: JwtUser | null,
    action: ActivityAction,
    entityType: string,
    entityId: string,
    payload?: Record<string, unknown>,
  ) {
    return this.record(null, action, entityType, entityId, {
      ...payload,
      auto: true,
      triggeredBy: trigger?.name ?? null,
    } as Prisma.InputJsonValue);
  }

  /** 审计日志：全局最近操作 */
  async recent(page: number, pageSize: number) {
    const [total, items] = await this.prisma.$transaction([
      this.prisma.activityLog.count(),
      this.prisma.activityLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actor: { select: { id: true, name: true } } },
      }),
    ]);
    return { total, page, pageSize, items };
  }

  /** 查询某实体的时间轴（倒序） */
  async timeline(entityType: string, entityId: string, limit = 50) {
    return this.prisma.activityLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { actor: { select: { id: true, name: true } } },
    });
  }
}
