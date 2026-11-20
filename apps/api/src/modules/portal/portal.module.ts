import { Module } from '@nestjs/common';
import { HelpdeskModule } from '../helpdesk/helpdesk.module';
import { InterviewsModule } from '../interviews/interviews.module';
import { OffersModule } from '../offers/offers.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

@Module({
  imports: [InterviewsModule, OffersModule, OnboardingModule, HelpdeskModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
