import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { AiRateLimit } from '../../common/guards/ai-throttle.guard';
import { AskDto } from '../helpdesk/dto/ask.dto';
import { OnboardingInfoDto, SignContractDto } from '../onboarding/dto/onboarding.dto';
import { RespondDto } from '../offers/dto/create-offer.dto';
import { PortalPickDto } from './portal.dto';
import { PortalService } from './portal.service';

/** 候选人页（免登录，链接即凭证）：选面试时间、答复 Offer、填写入职信息、确认合同、入职问答 */
@ApiTags('portal')
@Public()
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get(':token')
  @ApiOperation({ summary: '候选人页：按进度返回面试、Offer、入职三部分' })
  view(@Param('token') token: string) {
    return this.portal.view(token);
  }

  @Post(':token/interviews/:interviewId/pick')
  @HttpCode(200)
  @ApiOperation({ summary: '选择面试时间（并发抢占返回 409 重选）' })
  pick(@Param('token') token: string, @Param('interviewId') interviewId: string, @Body() dto: PortalPickDto) {
    return this.portal.pick(token, interviewId, dto.slotId, dto.startAt);
  }

  @Post(':token/offer/respond')
  @HttpCode(200)
  @ApiOperation({ summary: '接受 / 拒绝 Offer（拒绝必选原因码）' })
  respond(@Param('token') token: string, @Body() dto: RespondDto) {
    return this.portal.respondOffer(token, dto);
  }

  @Put(':token/onboarding/info')
  @ApiOperation({ summary: '提交 / 修改入职信息' })
  saveInfo(@Param('token') token: string, @Body() dto: OnboardingInfoDto) {
    return this.portal.saveInfo(token, dto);
  }

  @Post(':token/onboarding/contract/sign')
  @HttpCode(200)
  @ApiOperation({ summary: '确认劳动合同（输入本人姓名）' })
  sign(@Param('token') token: string, @Body() dto: SignContractDto) {
    return this.portal.signContract(token, dto);
  }

  @Post(':token/onboarding/ask')
  @HttpCode(200)
  @AiRateLimit()
  @ApiOperation({ summary: '入职问答（基于公司制度文档，带出处）' })
  ask(@Param('token') token: string, @Body() dto: AskDto) {
    return this.portal.ask(token, dto.question);
  }
}
