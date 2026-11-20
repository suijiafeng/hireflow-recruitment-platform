import { Module } from '@nestjs/common';
import { HelpdeskService } from './helpdesk.service';

/** 入职问答：知识库是公司制度文档；入口在候选人页的入职部分，Copilot 也用它查制度 */
@Module({
  providers: [HelpdeskService],
  exports: [HelpdeskService],
})
export class HelpdeskModule {}
