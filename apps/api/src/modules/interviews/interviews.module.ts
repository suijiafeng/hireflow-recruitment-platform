import { Module } from '@nestjs/common';
import { InterviewPortalController } from './interview-portal.controller';
import { InterviewerSlotsController, InterviewsController } from './interviews.controller';
import { InterviewsService } from './interviews.service';

@Module({
  controllers: [InterviewsController, InterviewerSlotsController, InterviewPortalController],
  providers: [InterviewsService],
  exports: [InterviewsService],
})
export class InterviewsModule {}
