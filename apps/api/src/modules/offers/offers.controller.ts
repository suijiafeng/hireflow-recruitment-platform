import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PortalLinkDto } from '../../common/dto/portal-link.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hireflow/shared';
import { CurrentUser, type JwtUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApprovalDto, CreateOfferDto, ResubmitOfferDto, RespondDto } from './dto/create-offer.dto';
import { OffersService } from './offers.service';

@ApiTags('offers')
@ApiBearerAuth()
@Controller('offers')
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  @Get()
  @ApiOperation({ summary: 'Offer 列表（薪资按 salary:view 权限脱敏；读取时懒过期扫描）' })
  list(@CurrentUser() user: JwtUser) {
    return this.offersService.list(user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.OFFER_INITIATE)
  @ApiOperation({ summary: '发起 Offer（进入审批）' })
  create(@Body() dto: CreateOfferDto, @CurrentUser() user: JwtUser) {
    return this.offersService.create(dto, user);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.OFFER_APPROVE)
  @ApiOperation({ summary: '审批通过' })
  approve(@Param('id') id: string, @Body() dto: ApprovalDto, @CurrentUser() user: JwtUser) {
    return this.offersService.approve(id, dto, true, user);
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.OFFER_APPROVE)
  @ApiOperation({ summary: '审批驳回（意见必填，退回 HR 修改重提）' })
  reject(@Param('id') id: string, @Body() dto: ApprovalDto, @CurrentUser() user: JwtUser) {
    return this.offersService.approve(id, dto, false, user);
  }

  @Post(':id/resubmit')
  @RequirePermissions(PERMISSIONS.OFFER_INITIATE)
  @ApiOperation({ summary: '驳回后修改重提（更新薪资包重新进入审批）' })
  resubmit(@Param('id') id: string, @Body() dto: ResubmitOfferDto, @CurrentUser() user: JwtUser) {
    return this.offersService.resubmit(id, dto, user);
  }

  @Post(':id/send')
  @RequirePermissions(PERMISSIONS.OFFER_INITIATE)
  @ApiOperation({ summary: '电子发送 Offer（生成候选人门户链接 + 5 个工作日答复期）' })
  send(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.offersService.send(id, user);
  }

  @Post(':id/extend')
  @RequirePermissions(PERMISSIONS.OFFER_INITIATE)
  @ApiOperation({ summary: '答复期续期一次（SENT/EXPIRED → SENT）' })
  extend(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.offersService.extend(id, user);
  }

  @Post(':id/portal-link')
  @RequirePermissions(PERMISSIONS.OFFER_INITIATE)
  @ApiOperation({ summary: '获取/补发候选人门户令牌（前端拼 /portal/offer/:token）' })
  portalLink(@Param('id') id: string, @Body() dto: PortalLinkDto, @CurrentUser() user: JwtUser) {
    return this.offersService.ensurePortalToken(id, user, dto.rotate === true);
  }

  @Post(':id/respond')
  @RequirePermissions(PERMISSIONS.OFFER_INITIATE)
  @ApiOperation({ summary: '录入候选人答复（HR 代录；拒绝必选原因码）' })
  respond(@Param('id') id: string, @Body() dto: RespondDto, @CurrentUser() user: JwtUser) {
    return this.offersService.respond(id, dto, user);
  }

  @Post(':id/retention')
  @ApiOperation({ summary: 'AI 留存预测（辅助参考）' })
  retention(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.offersService.retention(id, user);
  }
}
