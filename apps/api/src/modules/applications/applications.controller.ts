import { PortalLinkDto } from '../../common/dto/portal-link.dto';
import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hireflow/shared';
import { CurrentUser, type JwtUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { BatchMoveDto, BatchRejectDto, MoveStageDto, RejectApplicationDto } from './dto/move-stage.dto';
import { AiRateLimit } from '../../common/guards/ai-throttle.guard';

@ApiTags('applications')
@ApiBearerAuth()
@Controller()
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Post('applications')
  @RequirePermissions(PERMISSIONS.APPLICATION_CREATE)
  @ApiOperation({ summary: '创建应聘记录（投递/导入）' })
  create(@Body() dto: CreateApplicationDto, @CurrentUser() user: JwtUser) {
    return this.applicationsService.create(dto, user);
  }

  @Get('jobs/:jobId/board')
  @RequirePermissions(PERMISSIONS.CANDIDATE_READ)
  @ApiOperation({ summary: '职位看板数据（按阶段分组）' })
  board(@Param('jobId') jobId: string, @CurrentUser() user: JwtUser) {
    return this.applicationsService.board(jobId, user);
  }

  @Patch('applications/:id/stage')
  @RequirePermissions(PERMISSIONS.APPLICATION_MOVE)
  @ApiOperation({ summary: '移动卡片到目标阶段（写入留痕）' })
  moveStage(@Param('id') id: string, @Body() dto: MoveStageDto, @CurrentUser() user: JwtUser) {
    return this.applicationsService.moveStage(id, dto, user);
  }

  @Post('applications/:id/score')
  @AiRateLimit()
  @RequirePermissions(PERMISSIONS.APPLICATION_MOVE)
  @ApiOperation({ summary: 'AI 岗位匹配度评分（可解释报告回写）' })
  score(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.applicationsService.score(id, user);
  }

  @Post('applications/:id/portal-link')
  @RequireAnyPermission(PERMISSIONS.INTERVIEW_SCHEDULE, PERMISSIONS.OFFER_INITIATE, PERMISSIONS.ONBOARDING_MANAGE)
  @ApiOperation({ summary: '获取候选人页链接（选面试时间 / 答复 Offer / 填写入职信息共用一个链接；rotate 让旧链接失效）' })
  portalLink(@Param('id') id: string, @Body() dto: PortalLinkDto, @CurrentUser() user: JwtUser) {
    return this.applicationsService.portalLink(id, user, dto?.rotate === true);
  }

  // 批量路由必须声明在 :id 参数路由之前（Nest 按声明顺序匹配，否则 "batch" 会被当作 :id）
  @Post('applications/batch/reject')
  @HttpCode(200) // 逐条成败明细，不创建资源；全部失败也是一次成功的处理
  @RequirePermissions(PERMISSIONS.APPLICATION_MOVE)
  @ApiOperation({ summary: '批量淘汰（≤100 条，返回成败明细）' })
  batchReject(@Body() dto: BatchRejectDto, @CurrentUser() user: JwtUser) {
    return this.applicationsService.batchReject(dto, user);
  }

  @Post('applications/batch/move')
  @HttpCode(200) // 逐条成败明细，不创建资源；全部失败也是一次成功的处理
  @RequirePermissions(PERMISSIONS.APPLICATION_MOVE)
  @ApiOperation({ summary: '批量移动阶段（≤100 条，返回成败明细）' })
  batchMove(@Body() dto: BatchMoveDto, @CurrentUser() user: JwtUser) {
    return this.applicationsService.batchMove(dto, user);
  }

  @Post('applications/:id/reject')
  @RequirePermissions(PERMISSIONS.APPLICATION_MOVE)
  @ApiOperation({ summary: '淘汰候选人（原因码强制，终态不可逆）' })
  reject(@Param('id') id: string, @Body() dto: RejectApplicationDto, @CurrentUser() user: JwtUser) {
    return this.applicationsService.reject(id, dto, user);
  }
}
