import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { InterviewsService } from './interviews.service';
import { PickInterviewSlotDto } from './dto/pick-interview-slot.dto';

/**
 * 候选人自助选时门户：
 * 面试官系统内维护空闲档 → 候选人从共同空闲时段中选择 → 落定瞬间二次校验防冲突。
 */
@ApiTags('portal')
@Public()
@Controller('portal/interviews')
export class InterviewPortalController {
  constructor(private readonly interviewsService: InterviewsService) {}

  @Get(':token')
  @ApiOperation({ summary: '候选人查看可选时段（已确定时间则显示确认页）' })
  view(@Param('token') token: string) {
    return this.interviewsService.portalView(token);
  }

  @Post(':token/pick')
  @ApiOperation({ summary: '候选人确认时段（并发抢占返回 409 重选）' })
  pick(@Param('token') token: string, @Body() body: PickInterviewSlotDto) {
    return this.interviewsService.portalPick(token, body.slotId, body.startAt);
  }
}
