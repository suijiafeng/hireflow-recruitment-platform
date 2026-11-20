import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { ActivityLogModule } from './modules/activity-log/activity-log.module';
import { AiModule } from './modules/ai/ai.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AuthModule } from './modules/auth/auth.module';
import { CandidatesModule } from './modules/candidates/candidates.module';
import { CopilotModule } from './modules/copilot/copilot.module';
import { CompanyDocsModule } from './modules/company-docs/company-docs.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { HelpdeskModule } from './modules/helpdesk/helpdesk.module';
import { InterviewsModule } from './modules/interviews/interviews.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OffersModule } from './modules/offers/offers.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { StorageModule } from './modules/storage/storage.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    ActivityLogModule,
    NotificationsModule,
    StorageModule,
    AiModule,
    AnalyticsModule,
    AuthModule,
    UsersModule,
    RbacModule,
    DepartmentsModule,
    CompanyDocsModule,
    JobsModule,
    CandidatesModule,
    ApplicationsModule,
    InterviewsModule,
    OffersModule,
    OnboardingModule,
    HelpdeskModule,
    CopilotModule,
  ],
  controllers: [AppController],
  providers: [
    // 全局守卫：先认证（JWT），后鉴权（功能点权限）
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
