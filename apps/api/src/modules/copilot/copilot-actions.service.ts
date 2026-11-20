import { ConflictException, GoneException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { ACTIVITY_ACTIONS, type CopilotWriteTool } from '@hireflow/shared';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { CopilotService } from './copilot.service';
import { CopilotToolsService, toolErrorMessage } from './tools/copilot-tools.service';

/**
 * 待确认操作的确认 / 取消。
 * 确认时：只能本人 → 必须仍是 PENDING 且未过期 → 原子抢占（PENDING→EXECUTING，防双击 / 并发重复执行）→
 * 以「此刻」的权限和数据范围重新走业务服务（含乐观锁）→ 记审计日志。
 */
@Injectable()
export class CopilotActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tools: CopilotToolsService,
    private readonly copilot: CopilotService,
    private readonly activityLog: ActivityLogService,
  ) {}

  private async load(id: string, user: JwtUser) {
    const action = await this.prisma.copilotAction.findUnique({ where: { id } });
    if (!action || action.userId !== user.sub) throw new NotFoundException('操作不存在');
    return action;
  }

  private async ensurePending(action: { id: string; status: string; expiresAt: Date }) {
    if (action.status !== 'PENDING') throw new ConflictException('该操作已处理过，不能重复确认');
    if (action.expiresAt.getTime() < Date.now()) {
      await this.prisma.copilotAction.updateMany({ where: { id: action.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
      throw new GoneException('该操作已过期，请让 Copilot 重新生成');
    }
  }

  async confirm(id: string, user: JwtUser) {
    const action = await this.load(id, user);
    await this.ensurePending(action);
    const claimed = await this.prisma.copilotAction.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'EXECUTING', decidedAt: new Date() },
    });
    if (claimed.count !== 1) throw new ConflictException('该操作已处理过，不能重复确认');

    const audit = { actionId: id, tool: action.tool, summary: action.summary, conversationId: action.conversationId };
    try {
      const result = await this.tools.execute(action.tool as CopilotWriteTool, action.args as Record<string, unknown>, user);
      const updated = await this.prisma.copilotAction.update({
        where: { id },
        data: { status: 'EXECUTED', result: result as never, error: null },
      });
      await this.activityLog.record(user, ACTIVITY_ACTIONS.COPILOT_ACTION_EXECUTED, 'CopilotAction', id, audit);
      return this.copilot.actionView(updated);
    } catch (error) {
      const message = toolErrorMessage(error);
      await this.prisma.copilotAction.update({ where: { id }, data: { status: 'FAILED', error: message } });
      await this.activityLog.record(user, ACTIVITY_ACTIONS.COPILOT_ACTION_FAILED, 'CopilotAction', id, { ...audit, error: message });
      if (error instanceof HttpException) throw error;
      throw new ConflictException(message);
    }
  }

  async reject(id: string, user: JwtUser) {
    const action = await this.load(id, user);
    await this.ensurePending(action);
    const claimed = await this.prisma.copilotAction.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', decidedAt: new Date() },
    });
    if (claimed.count !== 1) throw new ConflictException('该操作已处理过');
    await this.activityLog.record(user, ACTIVITY_ACTIONS.COPILOT_ACTION_REJECTED, 'CopilotAction', id, {
      actionId: id,
      tool: action.tool,
      summary: action.summary,
      conversationId: action.conversationId,
    });
    const updated = await this.prisma.copilotAction.findUniqueOrThrow({ where: { id } });
    return this.copilot.actionView(updated);
  }
}
