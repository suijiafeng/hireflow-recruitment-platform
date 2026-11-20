import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hireflow/shared';
import { CurrentUser, type JwtUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreateJobDto } from './dto/create-job.dto';
import { QueryJobsDto } from './dto/query-jobs.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { UpdateStagesDto } from './dto/update-stages.dto';
import { JobsService } from './jobs.service';
import { AiRateLimit } from '../../common/guards/ai-throttle.guard';

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.JOB_READ)
  @ApiOperation({ summary: '职位分页列表' })
  list(@Query() query: QueryJobsDto, @CurrentUser() user: JwtUser) {
    return this.jobsService.list(query, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.JOB_CREATE)
  @ApiOperation({ summary: '创建职位（自动生成默认 Pipeline 阶段）' })
  create(@Body() dto: CreateJobDto, @CurrentUser() user: JwtUser) {
    return this.jobsService.create(dto, user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.JOB_READ)
  @ApiOperation({ summary: '职位详情（含阶段）' })
  findOne(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.jobsService.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.JOB_UPDATE)
  @ApiOperation({ summary: '更新职位' })
  update(@Param('id') id: string, @Body() dto: UpdateJobDto, @CurrentUser() user: JwtUser) {
    return this.jobsService.update(id, dto, user);
  }

  @Get(':id/stages')
  @RequirePermissions(PERMISSIONS.JOB_READ)
  @ApiOperation({ summary: '职位的 Pipeline 阶段列表' })
  getStages(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.jobsService.getStages(id, user);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.JOB_DELETE)
  @ApiOperation({ summary: '删除职位（仅无应聘记录的职位）' })
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.jobsService.remove(id, user);
  }

  @Put(':id/stages')
  @RequirePermissions(PERMISSIONS.JOB_STAGES_MANAGE)
  @ApiOperation({ summary: '全量更新 Pipeline 阶段（增删改排序）' })
  updateStages(@Param('id') id: string, @Body() dto: UpdateStagesDto, @CurrentUser() user: JwtUser) {
    return this.jobsService.updateStages(id, dto, user);
  }

  @Post(':id/talent-pool/scan')
  @AiRateLimit()
  @RequirePermissions(PERMISSIONS.APPLICATION_CREATE)
  @ApiOperation({ summary: '人才库唤醒：历史候选人按本职位 AI 打分推荐 Top 10' })
  talentPoolScan(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.jobsService.talentPoolScan(id, user);
  }

  @Post(':id/talent-pool/activate')
  @RequirePermissions(PERMISSIONS.APPLICATION_CREATE)
  @ApiOperation({ summary: '唤醒激活：为候选人生成新应聘进入首列' })
  talentPoolActivate(
    @Param('id') id: string,
    @Body() body: { candidateId: string },
    @CurrentUser() user: JwtUser,
  ) {
    return this.jobsService.talentPoolActivate(id, body.candidateId, user);
  }
}
