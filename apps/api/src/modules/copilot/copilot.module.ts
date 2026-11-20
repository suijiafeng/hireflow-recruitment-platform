import { Module } from '@nestjs/common';
import { HelpdeskModule } from '../helpdesk/helpdesk.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ApplicationsModule } from '../applications/applications.module';
import { CandidatesModule } from '../candidates/candidates.module';
import { InterviewsModule } from '../interviews/interviews.module';
import { JobsModule } from '../jobs/jobs.module';
import { OffersModule } from '../offers/offers.module';
import { CopilotActionsService } from './copilot-actions.service';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { CopilotToolsService } from './tools/copilot-tools.service';

@Module({
  imports: [CandidatesModule, ApplicationsModule, JobsModule, InterviewsModule, OffersModule, AnalyticsModule, HelpdeskModule],
  controllers: [CopilotController],
  providers: [CopilotService, CopilotActionsService, CopilotToolsService],
})
export class CopilotModule {}
