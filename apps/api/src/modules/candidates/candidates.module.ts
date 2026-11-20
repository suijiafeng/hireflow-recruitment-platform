import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { CandidatesController } from './candidates.controller';
import { CandidatesService } from './candidates.service';
import { ResumeIntakeService } from './resume-intake.service';
import { ResumesController } from './resumes.controller';

@Module({
  imports: [ApplicationsModule],
  controllers: [CandidatesController, ResumesController],
  providers: [CandidatesService, ResumeIntakeService],
  exports: [CandidatesService],
})
export class CandidatesModule {}
