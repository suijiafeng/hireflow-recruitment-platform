import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { InterviewerSlotsController, InterviewsController } from './interviews.controller';
import { InterviewsService } from './interviews.service';

@Module({
  imports: [ApplicationsModule],
  controllers: [InterviewsController, InterviewerSlotsController],
  providers: [InterviewsService],
  exports: [InterviewsService],
})
export class InterviewsModule {}
