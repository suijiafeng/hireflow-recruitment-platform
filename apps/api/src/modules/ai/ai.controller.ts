import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hireflow/shared';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AiRateLimit } from '../../common/guards/ai-throttle.guard';
import { AiService } from './ai.service';
import { GenerateJdDto } from './dto/generate-jd.dto';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('generate-jd')
  @RequirePermissions(PERMISSIONS.JOB_CREATE)
  @AiRateLimit()
  @ApiOperation({ summary: 'AI 生成职位描述' })
  async generateJd(@Body() dto: GenerateJdDto) {
    const { data, meta } = await this.aiService.generateJd(dto);
    return { ...data, aiMeta: meta };
  }

  @Get('status')
  @ApiOperation({ summary: '当前 AI 引擎（供应商 / 模型档位 / 超时预算），任何登录用户可读，不含密钥' })
  status() {
    return this.aiService.status();
  }

  @Get('usage')
  @RequirePermissions(PERMISSIONS.CONFIG_MANAGE)
  @ApiOperation({ summary: 'AI 用量面板：调用数、token、估算成本、P95 延迟、缓存命中率、降级率' })
  usage(@Query('days') days?: string) {
    const n = Math.min(90, Math.max(1, Math.floor(Number(days) || 7)));
    return this.aiService.usage(n);
  }
}
