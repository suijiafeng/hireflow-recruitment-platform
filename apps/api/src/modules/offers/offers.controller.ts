import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hireflow/shared';
import { CurrentUser, type JwtUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreateOfferDto, RespondDto } from './dto/create-offer.dto';
import { OffersService } from './offers.service';

@ApiTags('offers')
@ApiBearerAuth()
@Controller('offers')
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  @Get()
  @ApiOperation({ summary: 'Offer 列表（薪资按 salary:view 权限脱敏）' })
  list(@CurrentUser() user: JwtUser) {
    return this.offersService.list(user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.OFFER_INITIATE)
  @ApiOperation({ summary: '发出 Offer（不经审批，直接进入 5 个工作日答复期）' })
  create(@Body() dto: CreateOfferDto, @CurrentUser() user: JwtUser) {
    return this.offersService.create(dto, user);
  }

  @Post(':id/send')
  @RequirePermissions(PERMISSIONS.OFFER_INITIATE)
  @ApiOperation({ summary: '发送遗留的未发出 Offer' })
  send(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.offersService.send(id, user);
  }

  @Post(':id/extend')
  @RequirePermissions(PERMISSIONS.OFFER_INITIATE)
  @ApiOperation({ summary: '答复期续期一次（SENT/EXPIRED → SENT）' })
  extend(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.offersService.extend(id, user);
  }

  @Post(':id/respond')
  @RequirePermissions(PERMISSIONS.OFFER_INITIATE)
  @ApiOperation({ summary: '录入候选人答复（HR 代录；拒绝必选原因码）' })
  respond(@Param('id') id: string, @Body() dto: RespondDto, @CurrentUser() user: JwtUser) {
    return this.offersService.respond(id, dto, user);
  }
}
