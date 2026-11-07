import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hireflow/shared';
import { CurrentUser, type JwtUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CandidatesService } from './candidates.service';

@ApiTags('candidates')
@ApiBearerAuth()
@Controller('resumes')
export class ResumesController {
  constructor(private readonly candidatesService: CandidatesService) {}

  @Post(':id/parse')
  @RequirePermissions(PERMISSIONS.CANDIDATE_UPDATE)
  @ApiOperation({ summary: 'AI 解析简历（结构化 + 技能标签 + 摘要）' })
  parse(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.candidatesService.parseResume(id, user);
  }

  @Get(':id/file-url')
  @RequirePermissions(PERMISSIONS.CANDIDATE_READ)
  @ApiOperation({ summary: '简历原件预签名下载链接（10 分钟有效）' })
  fileUrl(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.candidatesService.resumeFileUrl(id, user);
  }
}
