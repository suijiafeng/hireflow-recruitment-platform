import { Body, Controller, Get, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { PortalLinkDto } from '../../common/dto/portal-link.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hireflow/shared';
import { CurrentUser, type JwtUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { fileTypeFilter, ONBOARDING_DOCUMENT_MIME_TYPES } from '../../common/upload';
import { AddDocumentDto, ToggleChecklistDto } from './dto/onboarding.dto';
import { OnboardingService } from './onboarding.service';

@ApiTags('onboarding')
@ApiBearerAuth()
@Controller()
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get('onboardings')
  @RequirePermissions(PERMISSIONS.ONBOARDING_READ)
  @ApiOperation({ summary: '入职单列表（含清单进度；合同薪资按 salary:view 脱敏）' })
  list(@CurrentUser() user: JwtUser) {
    return this.onboardingService.list(user);
  }

  @Get('onboardings/:id')
  @RequirePermissions(PERMISSIONS.ONBOARDING_READ)
  @ApiOperation({ summary: '入职单详情（清单/材料/合同；合同薪资按 salary:view 脱敏）' })
  get(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.onboardingService.get(id, user);
  }

  @Patch('onboardings/:id/checklist/:key')
  @RequirePermissions(PERMISSIONS.ONBOARDING_READ)
  @ApiOperation({ summary: '勾选/取消三方待办项（服务层按角色约束勾选范围）' })
  toggle(
    @Param('id') id: string,
    @Param('key') key: string,
    @Body() dto: ToggleChecklistDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.onboardingService.toggleItem(id, key, dto.done, user);
  }

  @Post('onboardings/:id/documents')
  @RequirePermissions(PERMISSIONS.ONBOARDING_UPLOAD)
  @ApiOperation({ summary: '提交入职材料（文本 OCR 抽取字段并入档）' })
  addDocument(@Param('id') id: string, @Body() dto: AddDocumentDto, @CurrentUser() user: JwtUser) {
    return this.onboardingService.addDocument(id, dto, user);
  }

  @Post('onboardings/:id/documents/file')
  @RequirePermissions(PERMISSIONS.ONBOARDING_UPLOAD)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: fileTypeFilter(ONBOARDING_DOCUMENT_MIME_TYPES),
    }),
  )
  @ApiOperation({ summary: '提交入职材料（图片原件入对象存储；可附文字层走 OCR）' })
  addDocumentFile(
    @Param('id') id: string,
    @Body() dto: AddDocumentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.onboardingService.addDocument(id, dto, user, file);
  }

  @Post('onboardings/:id/portal-link')
  @RequirePermissions(PERMISSIONS.ONBOARDING_MANAGE)
  @ApiOperation({ summary: '获取/补发新员工门户令牌（前端拼 /portal/onboarding/:token）' })
  async portalLink(@Param('id') id: string, @Body() dto: PortalLinkDto, @CurrentUser() user: JwtUser) {
    return { token: await this.onboardingService.ensurePortalToken(id, user, dto.rotate === true) };
  }

  @Post('onboardings/:id/contract')
  @RequirePermissions(PERMISSIONS.ONBOARDING_MANAGE)
  @ApiOperation({ summary: '生成劳动合同（模板变量自动填充）' })
  createContract(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.onboardingService.createContract(id, user);
  }

  @Post('contracts/:id/send')
  @RequirePermissions(PERMISSIONS.ONBOARDING_MANAGE)
  @ApiOperation({ summary: '发送合同至电子签' })
  sendContract(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.onboardingService.sendContract(id, user);
  }

  @Post('contracts/:id/sign')
  @RequirePermissions(PERMISSIONS.ONBOARDING_MANAGE)
  @ApiOperation({ summary: '完成签署（模拟电子签回调，生产默认关闭；新员工自签走门户）' })
  signContract(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.onboardingService.signContractByStaff(id, user);
  }
}
