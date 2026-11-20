import { Injectable } from '@nestjs/common';
import { companyName } from '../../common/company';
import { assertPortalLive, candidateActor, portalLinkInvalid } from '../../common/portal';
import { PrismaService } from '../../prisma/prisma.service';
import { HelpdeskService } from '../helpdesk/helpdesk.service';
import { InterviewsService } from '../interviews/interviews.service';
import type { OnboardingInfoDto, SignContractDto } from '../onboarding/dto/onboarding.dto';
import { OnboardingService } from '../onboarding/onboarding.service';
import type { RespondDto } from '../offers/dto/create-offer.dto';
import { OffersService } from '../offers/offers.service';

/**
 * 候选人页（/portal/:token）：一条应聘一个链接，按进度展示面试选时、Offer、入职三部分。
 * 令牌只能定位到它自己的应聘；每个动作都以候选人身份留痕。
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly interviews: InterviewsService,
    private readonly offers: OffersService,
    private readonly onboarding: OnboardingService,
    private readonly helpdesk: HelpdeskService,
  ) {}

  private async resolve(token: string) {
    const application = await this.prisma.application.findUnique({
      where: { portalToken: token },
      select: {
        id: true,
        status: true,
        portalExpiresAt: true,
        candidate: { select: { name: true } },
        job: { select: { title: true, department: { select: { name: true } } } },
      },
    });
    if (!application) throw portalLinkInvalid();
    assertPortalLive(application.portalExpiresAt);
    return application;
  }

  async view(token: string) {
    const app = await this.resolve(token);
    const closed = app.status === 'REJECTED' || app.status === 'WITHDRAWN';
    const base = {
      company: companyName(),
      candidateName: app.candidate.name,
      jobTitle: app.job.title,
      department: app.job.department.name,
      status: app.status,
      expiresAt: app.portalExpiresAt,
      hrContact: await this.offers.hrContactFor(app.id),
    };
    // 流程已结束：只告诉候选人结果，不再展示薪资和证件信息
    if (closed) return { ...base, step: 'closed' as const, interviews: [], offer: null, onboarding: null };
    const [interviews, offer, onboarding] = await Promise.all([
      this.interviews.portalSection(app.id, app.status === 'ACTIVE'),
      this.offers.portalSection(app.id),
      this.onboarding.portalSection(app.id),
    ]);
    const step = app.status === 'HIRED' || onboarding?.status === 'COMPLETED'
      ? ('hired' as const)
      : onboarding
        ? ('onboarding' as const)
        : offer && !offer.preparing
          ? ('offer' as const)
          : ('interview' as const);
    return { ...base, step, interviews, offer, onboarding };
  }

  async pick(token: string, interviewId: string, slotId: string, startAt?: string) {
    const app = await this.resolve(token);
    await this.interviews.portalPick(app.id, interviewId, slotId, startAt);
    return this.view(token);
  }

  async respondOffer(token: string, dto: RespondDto) {
    const app = await this.resolve(token);
    await this.offers.portalRespond(app.id, app.candidate.name, dto);
    return this.view(token);
  }

  async saveInfo(token: string, dto: OnboardingInfoDto) {
    const app = await this.resolve(token);
    await this.onboarding.portalSaveInfo(app.id, dto, candidateActor(app.candidate.name));
    return this.view(token);
  }

  async signContract(token: string, dto: SignContractDto) {
    const app = await this.resolve(token);
    await this.onboarding.portalSignContract(app.id, dto, candidateActor(app.candidate.name));
    return this.view(token);
  }

  /** 入职问答：只对已经接受 Offer 的人开放（知识库是公司内部制度） */
  async ask(token: string, question: string) {
    const app = await this.resolve(token);
    const onboarding = await this.prisma.onboarding.findUnique({ where: { applicationId: app.id }, select: { id: true } });
    if (!onboarding) throw portalLinkInvalid();
    return this.helpdesk.ask(question);
  }
}
