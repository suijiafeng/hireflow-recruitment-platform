import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hireflow/shared';
import { CurrentUser, type JwtUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CompleteOnboardingDto } from './dto/onboarding.dto';
import { OnboardingService } from './onboarding.service';

@ApiTags('onboarding')
@ApiBearerAuth()
@Controller('onboardings')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ONBOARDING_READ)
  @ApiOperation({ summary: '入职单列表（证件号按 onboarding:manage 脱敏，合同薪资按 salary:view 脱敏）' })
  list(@CurrentUser() user: JwtUser) {
    return this.onboardingService.list(user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ONBOARDING_READ)
  @ApiOperation({ summary: '入职单详情（入职信息 + 合同）' })
  get(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.onboardingService.get(id, user);
  }

  @Post(':id/complete')
  @RequirePermissions(PERMISSIONS.ONBOARDING_MANAGE)
  @ApiOperation({ summary: '确认入职（入职信息已提交且合同已确认）：应聘标记为已入职' })
  complete(@Param('id') id: string, @Body() dto: CompleteOnboardingDto, @CurrentUser() user: JwtUser) {
    return this.onboardingService.complete(id, dto, user);
  }
}
