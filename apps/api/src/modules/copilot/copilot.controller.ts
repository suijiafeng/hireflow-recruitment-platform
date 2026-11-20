import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, type JwtUser } from '../../common/decorators/current-user.decorator';
import { CopilotActionsService } from './copilot-actions.service';
import { CopilotService } from './copilot.service';
import { CreateConversationDto, RenameConversationDto, SendMessageDto } from './dto/copilot.dto';
import { SseWriter } from './sse';

/**
 * 任何已登录的内部用户都能打开 Copilot；能查什么、能提议什么由工具按权限点过滤，
 * 数据范围由各业务服务按当前用户裁剪。
 */
@ApiTags('copilot')
@ApiBearerAuth()
@Controller('copilot')
export class CopilotController {
  constructor(
    private readonly copilot: CopilotService,
    private readonly actions: CopilotActionsService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Copilot 引擎 / 可用工具 / 推荐问题' })
  status(@CurrentUser() user: JwtUser) {
    return this.copilot.status(user);
  }

  @Get('conversations')
  list(@CurrentUser() user: JwtUser) {
    return this.copilot.listConversations(user);
  }

  @Post('conversations')
  create(@Body() dto: CreateConversationDto, @CurrentUser() user: JwtUser) {
    return this.copilot.createConversation(user, dto);
  }

  @Get('conversations/:id')
  detail(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.copilot.getConversation(id, user);
  }

  @Patch('conversations/:id')
  rename(@Param('id') id: string, @Body() dto: RenameConversationDto, @CurrentUser() user: JwtUser) {
    return this.copilot.renameConversation(id, dto.title, user);
  }

  @Delete('conversations/:id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.copilot.deleteConversation(id, user);
  }

  @Post('conversations/:id/messages')
  @ApiOperation({ summary: '发送消息，SSE 流式返回（meta / text / tool_start / tool_end / action / done / error）' })
  async send(@Param('id') id: string, @Body() dto: SendMessageDto, @CurrentUser() user: JwtUser, @Res() res: Response) {
    // 校验（会话归属、限流、预算、并发）在开流前抛出 → 正常的 4xx JSON
    const ticket = await this.copilot.prepareTurn(id, user, dto);
    const abort = new AbortController();
    const sse = new SseWriter(res, this.copilot.limits.heartbeatMs);
    // 客户端断开（点「停止」、关页面）→ 取消模型请求与后续工具调用
    res.on('close', () => {
      if (!res.writableFinished) abort.abort(new Error('client closed'));
    });
    try {
      await this.copilot.runTurn(ticket, sse, abort.signal);
    } catch (error) {
      sse.send('error', { message: '回复生成失败，请稍后重试', code: 'internal' });
      void error;
    } finally {
      this.copilot.release(ticket);
      sse.end();
    }
  }

  @Post('actions/:id/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: '确认执行 Copilot 提议的写操作（重新校验权限与乐观锁）' })
  confirm(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.actions.confirm(id, user);
  }

  @Post('actions/:id/reject')
  @HttpCode(200)
  reject(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.actions.reject(id, user);
  }
}
