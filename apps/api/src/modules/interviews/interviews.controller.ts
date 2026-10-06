import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hireflow/shared';
import { CurrentUser, type JwtUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreateInterviewDto } from './dto/create-interview.dto';
import { ScheduleInterviewDto } from './dto/schedule-interview.dto';
import { DraftEvaluationDto } from './dto/draft-evaluation.dto';
import { SubmitEvaluationDto } from './dto/submit-evaluation.dto';
import { InterviewsService } from './interviews.service';

@ApiTags('interviews')
@ApiBearerAuth()
@Controller('interviews')
export class InterviewsController {
  constructor(private readonly interviewsService: InterviewsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.INTERVIEW_SCHEDULE)
  @ApiOperation({ summary: '安排面试并指派面试官' })
  create(@Body() dto: CreateInterviewDto, @CurrentUser() user: JwtUser) {
    return this.interviewsService.create(dto, user);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.EVALUATION_READ)
  @ApiOperation({ summary: '面试列表（?applicationId= 过滤；缺省返回近期总览）' })
  list(@Query('applicationId') applicationId: string | undefined, @CurrentUser() user: JwtUser) {
    return this.interviewsService.list(applicationId, user);
  }

  @Post(':id/schedule')
  @RequirePermissions(PERMISSIONS.INTERVIEW_SCHEDULE)
  @ApiOperation({ summary: '直接敲定/改期面试时间（无需候选人自助选时）' })
  schedule(@Param('id') id: string, @Body() dto: ScheduleInterviewDto, @CurrentUser() user: JwtUser) {
    return this.interviewsService.schedule(id, dto, user);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.INTERVIEW_SCHEDULE)
  @ApiOperation({ summary: '取消面试（仅未开始场次，通知面试官）' })
  cancel(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.interviewsService.cancel(id, user);
  }

  @Post(':id/evaluation-draft')
  @RequirePermissions(PERMISSIONS.EVALUATION_SUBMIT)
  @ApiOperation({ summary: 'AI 生成面评草稿（不落库，供表单预填后人工确认）' })
  draftEvaluation(@Param('id') id: string, @Body() dto: DraftEvaluationDto, @CurrentUser() user: JwtUser) {
    return this.interviewsService.draftEvaluation(id, dto.notes, user);
  }

  @Post(':id/evaluations')
  @RequirePermissions(PERMISSIONS.EVALUATION_SUBMIT)
  @ApiOperation({ summary: '提交面试评价（结构化评分卡）' })
  submitEvaluation(
    @Param('id') id: string,
    @Body() dto: SubmitEvaluationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.interviewsService.submitEvaluation(id, dto, user);
  }

  @Post(':id/self-schedule-link')
  @RequirePermissions(PERMISSIONS.EVALUATION_READ)
  @ApiOperation({ summary: '生成候选人自助选时链接（未定时间的面试；本场面试官也可发）' })
  selfScheduleLink(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.interviewsService.selfScheduleLink(id, user);
  }
}

/** 面试官可约时段自维护（无外部日历时的空闲档来源） */
@ApiTags('interviews')
@ApiBearerAuth()
@Controller('interviewer-slots')
@RequirePermissions(PERMISSIONS.EVALUATION_SUBMIT)
export class InterviewerSlotsController {
  constructor(private readonly interviewsService: InterviewsService) {}

  @Get('mine')
  @ApiOperation({ summary: '我的可约时段' })
  mine(@CurrentUser() user: JwtUser) {
    return this.interviewsService.mySlots(user);
  }

  @Post()
  @ApiOperation({ summary: '添加可约时段（重叠校验）' })
  add(@Body() body: { startAt: string; endAt: string }, @CurrentUser() user: JwtUser) {
    return this.interviewsService.addSlot(body.startAt, body.endAt, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除自己的空闲时段（被占用的不可删）' })
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.interviewsService.removeSlot(id, user);
  }
}
