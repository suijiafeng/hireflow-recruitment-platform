import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { OfferPortalController } from './offer-portal.controller';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

@Module({
  imports: [OnboardingModule, ApplicationsModule],
  controllers: [OffersController, OfferPortalController],
  providers: [OffersService],
  exports: [OffersService],
})
export class OffersModule {}
