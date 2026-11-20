import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { WebhookService } from './providers/webhook.service';

@Module({
  imports: [ApplicationsModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, WebhookService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
