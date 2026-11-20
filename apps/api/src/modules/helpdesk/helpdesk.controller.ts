import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AskDto } from './dto/ask.dto';
import { HelpdeskService } from './helpdesk.service';
import { AiRateLimit } from '../../common/guards/ai-throttle.guard';

@ApiTags('helpdesk')
@ApiBearerAuth()
@Controller('helpdesk')
export class HelpdeskController {
  constructor(private readonly helpdeskService: HelpdeskService) {}

  @Post('ask')
  @AiRateLimit()
  @ApiOperation({ summary: '入职问答（基于公司制度文档，带出处）' })
  ask(@Body() dto: AskDto) {
    return this.helpdeskService.ask(dto.question);
  }

  @Get('docs')
  @ApiOperation({ summary: '制度文档清单' })
  docs() {
    return this.helpdeskService.listDocs();
  }
}
