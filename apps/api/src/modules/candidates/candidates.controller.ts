import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hireflow/shared';
import { CurrentUser, type JwtUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { fileTypeFilter, RESUME_MIME_TYPES } from '../../common/upload';
import { CandidatesService } from './candidates.service';
import { AddResumeDto } from './dto/add-resume.dto';
import { CreateCandidateDto } from './dto/create-candidate.dto';
import { IntakeResumeDto } from './dto/intake-resume.dto';
import { CandidateFilterDto, QueryCandidatesDto } from './dto/query-candidates.dto';
import { ResumeIntakeService } from './resume-intake.service';
import { AiRateLimit } from '../../common/guards/ai-throttle.guard';
import { UpdateCandidateDto } from './dto/update-candidate.dto';

@ApiTags('candidates')
@ApiBearerAuth()
@Controller('candidates')
export class CandidatesController {
  constructor(
    private readonly candidatesService: CandidatesService,
    private readonly intakeService: ResumeIntakeService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CANDIDATE_READ)
  @ApiOperation({ summary: '候选人分页列表（面试官视角联系方式脱敏）' })
  list(@Query() query: QueryCandidatesDto, @CurrentUser() user: JwtUser) {
    return this.candidatesService.list(query, user);
  }

  @Get('export')
  @RequirePermissions(PERMISSIONS.CANDIDATE_READ)
  @ApiOperation({ summary: '按当前筛选导出 Excel（最多 5000 人，脱敏口径同列表）' })
  async export(@Query() query: CandidateFilterDto, @CurrentUser() user: JwtUser, @Res() res: Response) {
    const { buffer, fileName, rows } = await this.candidatesService.exportXlsx(query, user);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="candidates.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
      'X-Export-Rows': String(rows),
    });
    res.end(buffer);
  }

  @Get('sources')
  @RequirePermissions(PERMISSIONS.CANDIDATE_READ)
  @ApiOperation({ summary: '已有的来源渠道（筛选下拉）' })
  sources(@CurrentUser() user: JwtUser) {
    return this.candidatesService.sources(user);
  }

  @Post('intake')
  @AiRateLimit()
  @RequirePermissions(PERMISSIONS.CANDIDATE_CREATE, PERMISSIONS.APPLICATION_CREATE)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: fileTypeFilter(RESUME_MIME_TYPES),
    }),
  )
  @ApiOperation({ summary: '上传简历自动建档：抽取文字 → 邮箱/手机号去重 → AI 解析回填 → 投递所选职位 → AI 评分' })
  intake(@UploadedFile() file: Express.Multer.File, @Body() dto: IntakeResumeDto, @CurrentUser() user: JwtUser) {
    if (!file) throw new BadRequestException('请选择要上传的简历文件');
    return this.intakeService.intake(file, dto, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CANDIDATE_CREATE)
  @ApiOperation({ summary: '新增候选人（手工录入/导入）' })
  create(@Body() dto: CreateCandidateDto, @CurrentUser() user: JwtUser) {
    return this.candidatesService.create(dto, user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CANDIDATE_READ)
  @ApiOperation({ summary: '360° 候选人详情（含应聘/面评/时间轴）' })
  findOne(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.candidatesService.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CANDIDATE_UPDATE)
  @ApiOperation({ summary: '更新候选人（局部字段）' })
  update(@Param('id') id: string, @Body() dto: UpdateCandidateDto, @CurrentUser() user: JwtUser) {
    return this.candidatesService.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CANDIDATE_DELETE)
  @ApiOperation({ summary: '删除候选人（仅无应聘记录的候选人）' })
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.candidatesService.remove(id, user);
  }

  @Post(':id/resumes')
  @RequirePermissions(PERMISSIONS.CANDIDATE_UPDATE)
  @ApiOperation({ summary: '文本导入简历' })
  addResume(@Param('id') id: string, @Body() dto: AddResumeDto, @CurrentUser() user: JwtUser) {
    return this.candidatesService.addResume(id, dto, user);
  }

  @Post(':id/resumes/file')
  @RequirePermissions(PERMISSIONS.CANDIDATE_UPDATE)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: fileTypeFilter(RESUME_MIME_TYPES),
    }),
  )
  @ApiOperation({ summary: '上传简历原件（PDF/文本自动抽取文字进入解析链路，原件入对象存储）' })
  addResumeFile(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtUser,
  ) {
    if (!file) throw new BadRequestException('请选择要上传的简历文件');
    return this.candidatesService.addResumeFile(id, file, user);
  }
}
