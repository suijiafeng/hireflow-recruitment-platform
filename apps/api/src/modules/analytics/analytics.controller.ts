import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hireflow/shared';
import { CurrentUser, type JwtUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AnalyticsService } from './analytics.service';
import { QueryInsightsDto } from './dto/query-insights.dto';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @RequirePermissions(PERMISSIONS.DASHBOARD_VIEW)
  @ApiOperation({ summary: '大盘总览指标' })
  overview(@CurrentUser() user: JwtUser) {
    return this.analyticsService.overview(user);
  }

  @Get('todos')
  @ApiOperation({ summary: '我的待办聚合（To-Do Center）' })
  todos(@CurrentUser() user: JwtUser) {
    return this.analyticsService.todos(user);
  }

  @Get('funnel/:jobId')
  @RequirePermissions(PERMISSIONS.DASHBOARD_VIEW)
  @ApiOperation({ summary: '职位招聘漏斗（人数与转化率）' })
  funnel(@Param('jobId') jobId: string, @CurrentUser() user: JwtUser) {
    return this.analyticsService.funnel(jobId, user);
  }

  @Get('trend')
  @RequirePermissions(PERMISSIONS.DASHBOARD_VIEW)
  @ApiOperation({ summary: '近 8 周投递/入职趋势（大盘折线图）' })
  trend(@CurrentUser() user: JwtUser) {
    return this.analyticsService.trend(user);
  }

  @Get('insights')
  @RequirePermissions(PERMISSIONS.DASHBOARD_VIEW)
  @ApiOperation({
    summary: '数据洞察（TTH/渠道/面试官/毁约/阶段停留回放）',
    description:
      'range 与 deptId 按「应聘创建时间」划同期群，五组指标共用同一 scope；响应 scope 字段回显实际生效口径与样本量。',
  })
  insights(@Query() query: QueryInsightsDto, @CurrentUser() user: JwtUser) {
    return this.analyticsService.insights(query, user);
  }
}
