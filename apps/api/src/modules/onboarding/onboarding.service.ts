import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ACTIVITY_ACTIONS, ONBOARDING_INFO_FIELDS, PERMISSIONS, type OnboardingInfoKey } from '@hireflow/shared';
import { companyName } from '../../common/company';
import { departmentScopeOf, inDepartmentScope } from '../../common/data-scope';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { CN_TZ_OFFSET_MS, PORTAL_TTL, PortalLinkExpiredException } from '../../common/portal';
import { maskTail } from '../../common/mask';
import type { Prisma } from '../../generated/prisma/client';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CompleteOnboardingDto, OnboardingInfoDto, SignContractDto } from './dto/onboarding.dto';
import { WebhookService } from './providers/webhook.service';

export type OnboardingInfo = Partial<Record<OnboardingInfoKey, string>>;

const SENSITIVE_KEYS = new Set<string>(ONBOARDING_INFO_FIELDS.filter((f) => f.sensitive).map((f) => f.key));

const ONBOARDING_INCLUDE = {
  application: {
    select: {
      id: true,
      status: true,
      candidate: { select: { id: true, name: true, phone: true, email: true } },
      job: { select: { id: true, title: true, departmentId: true, department: { select: { name: true } } } },
      offer: { select: { startDate: true } },
    },
  },
  contract: true,
} satisfies Prisma.OnboardingInclude;

type OnboardingWithRelations = Prisma.OnboardingGetPayload<{ include: typeof ONBOARDING_INCLUDE }>;

/**
 * 入职：只做两件事——新员工在候选人页填写入职信息、阅读并确认劳动合同。
 * 两样都齐了，HR 点「确认入职」，应聘标记为已入职（HIRED）。
 * 合同在接受 Offer 时自动生成（和接受答复在同一个事务里），HR 不用再「生成 / 发送」。
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly webhook: WebhookService,
    private readonly notifications: NotificationsService,
  ) {}

  /** 接受 Offer 时调用：创建入职单 + 劳动合同（必须传入事务客户端，与答复一起提交） */
  async createForApplication(applicationId: string, actor: JwtUser, tx: Prisma.TransactionClient) {
    const existing = await tx.onboarding.findUnique({ where: { applicationId } });
    if (existing) return existing;
    const application = await tx.application.findUniqueOrThrow({
      where: { id: applicationId },
      include: { candidate: true, job: { include: { department: true } }, offer: true },
    });
    const salary = application.offer?.salary as { base?: number; bonusMonths?: number } | null;
    const variables = {
      companyName: companyName(),
      candidateName: application.candidate.name,
      jobTitle: application.job.title,
      department: application.job.department.name,
      grade: application.offer?.grade ?? '-',
      salaryBase: salary?.base ?? null,
      bonusMonths: salary?.bonusMonths ?? 0,
      probationMonths: 3,
      startDate: application.offer?.startDate?.toISOString().slice(0, 10) ?? null,
      // 容器默认 UTC，直接切 toISOString 在北京时间 00:00-08:00 会错算成前一天
      signDate: new Date(Date.now() + CN_TZ_OFFSET_MS).toISOString().slice(0, 10),
    };
    const onboarding = await tx.onboarding.create({
      data: {
        applicationId,
        status: 'IN_PROGRESS',
        contract: {
          create: {
            templateName: '标准劳动合同 v1',
            variables: variables as Prisma.InputJsonValue,
            signStatus: 'PENDING',
          },
        },
      },
    });
    await this.activityLog.recordAuto(
      actor,
      ACTIVITY_ACTIONS.ONBOARDING_CREATED,
      'Application',
      applicationId,
      { candidate: application.candidate.name, contract: '标准劳动合同 v1' },
      tx,
    );
    return onboarding;
  }

  /**
   * 后台视图统一脱敏：
   * - 证件号、卡号、地址、紧急联系人电话：没有 onboarding:manage 的人（用人经理）只看尾号；
   * - 合同变量里的薪资：没有 salary:view 的人看不到。
   */
  private present(onboarding: OnboardingWithRelations, user: JwtUser) {
    const info = (onboarding.info as OnboardingInfo | null) ?? null;
    const canManage = user.permissions.includes(PERMISSIONS.ONBOARDING_MANAGE);
    const maskedInfo =
      info && !canManage
        ? Object.fromEntries(Object.entries(info).map(([k, v]) => [k, SENSITIVE_KEYS.has(k) && v ? maskTail(v) : v]))
        : info;
    let contract = onboarding.contract;
    if (contract && !user.permissions.includes(PERMISSIONS.SALARY_VIEW) && contract.variables && typeof contract.variables === 'object') {
      const vars = { ...(contract.variables as Record<string, unknown>) };
      delete vars.salaryBase;
      delete vars.bonusMonths;
      contract = { ...contract, variables: { ...vars, salaryMasked: true } as Prisma.JsonValue };
    }
    const { offer, ...application } = onboarding.application;
    return {
      ...onboarding,
      application,
      startDate: offer?.startDate ? offer.startDate.toISOString().slice(0, 10) : null,
      info: maskedInfo,
      infoMasked: Boolean(info && !canManage),
      contract,
      ready: this.isReady(onboarding),
    };
  }

  private isReady(onboarding: { infoSubmittedAt: Date | null; contract: { signStatus: string } | null }) {
    return Boolean(onboarding.infoSubmittedAt) && onboarding.contract?.signStatus === 'SIGNED';
  }

  async list(user: JwtUser) {
    const deptScope = departmentScopeOf(user);
    const items = await this.prisma.onboarding.findMany({
      where: deptScope ? { application: { job: { departmentId: { in: deptScope } } } } : undefined,
      include: ONBOARDING_INCLUDE,
      orderBy: { updatedAt: 'desc' },
    });
    return items.map((o) => this.present(o, user));
  }

  async get(id: string, user: JwtUser) {
    const onboarding = await this.findOrThrow(id);
    this.assertDepartment(user, onboarding.application.job.departmentId);
    return this.present(onboarding, user);
  }

  /** HR 确认入职：信息已提交 + 合同已确认 → 入职单完成、应聘 HIRED（同一事务） */
  async complete(id: string, dto: CompleteOnboardingDto, user: JwtUser) {
    const onboarding = await this.findOrThrow(id);
    this.assertDepartment(user, onboarding.application.job.departmentId);
    if (onboarding.status === 'COMPLETED') throw new BadRequestException('该候选人已确认入职');
    if (!onboarding.infoSubmittedAt) throw new BadRequestException('新员工还没有提交入职信息');
    if (onboarding.contract?.signStatus !== 'SIGNED') throw new BadRequestException('新员工还没有确认劳动合同');
    const { candidate, job } = onboarding.application;
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.onboarding.updateMany({
        where: { id, status: { not: 'COMPLETED' } },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      if (result.count === 0) throw new ConflictException('该入职单刚被他人处理，请刷新');
      await tx.application.update({
        where: { id: onboarding.applicationId },
        data: { status: 'HIRED', version: { increment: 1 } },
      });
      await this.activityLog.record(
        user,
        ACTIVITY_ACTIONS.ONBOARDING_COMPLETED,
        'Application',
        onboarding.applicationId,
        { candidate: candidate.name, job: job.title, note: dto.note ?? null },
        tx,
      );
    });
    // 事件给外部系统（开账号、配设备）；失败只记录不阻断
    await this.webhook.fire('onboarding.completed', onboarding.applicationId, { candidate: candidate.name, job: job.title }, user);
    await this.notifications.push(
      (await this.notifications.jobManagerIds(job.id)).filter((uid) => uid !== user.sub),
      `已入职：${candidate.name}`,
      `${job.title} · ${user.name} 已确认入职`,
      `/onboarding?onboarding=${id}`,
    );
    return this.get(id, user);
  }

  // ---------- 候选人页 ----------

  /** 候选人页上的入职部分：本人看自己的信息不脱敏 */
  async portalSection(applicationId: string) {
    const onboarding = await this.prisma.onboarding.findUnique({ where: { applicationId }, include: ONBOARDING_INCLUDE });
    if (!onboarding) return null;
    // 入职完成后链接只留一段宽限期：页面上有未脱敏的证件号和薪资
    if (
      onboarding.status === 'COMPLETED' &&
      onboarding.completedAt &&
      Date.now() - onboarding.completedAt.getTime() > PORTAL_TTL.AFTER_COMPLETION_MS
    ) {
      throw new PortalLinkExpiredException('入职已完成，链接已失效。如需合同副本请联系 HR');
    }
    return {
      status: onboarding.status,
      fields: ONBOARDING_INFO_FIELDS,
      info: (onboarding.info as OnboardingInfo | null) ?? null,
      infoSubmittedAt: onboarding.infoSubmittedAt,
      contract: onboarding.contract
        ? {
            templateName: onboarding.contract.templateName,
            signStatus: onboarding.contract.signStatus,
            variables: onboarding.contract.variables,
            signedAt: onboarding.contract.signedAt,
            signerName: onboarding.contract.signerName,
          }
        : null,
      completedAt: onboarding.completedAt,
    };
  }

  /** 新员工提交 / 修改入职信息（确认入职前都可以改） */
  async portalSaveInfo(applicationId: string, dto: OnboardingInfoDto, actor: JwtUser) {
    const onboarding = await this.prisma.onboarding.findUnique({ where: { applicationId }, include: ONBOARDING_INCLUDE });
    if (!onboarding) throw new BadRequestException('接受 Offer 后才能填写入职信息');
    if (onboarding.status === 'COMPLETED') throw new BadRequestException('入职已完成，信息如需更正请联系 HR');
    const info: OnboardingInfo = Object.fromEntries(
      ONBOARDING_INFO_FIELDS.map((f) => [f.key, String(dto[f.key] ?? '').trim()]),
    );
    const first = !onboarding.infoSubmittedAt;
    await this.prisma.onboarding.update({
      where: { id: onboarding.id },
      data: { info: info as Prisma.InputJsonValue, infoSubmittedAt: new Date() },
    });
    // 留痕只记字段名，不记证件号本身
    await this.activityLog.record(actor, ACTIVITY_ACTIONS.ONBOARDING_INFO_SUBMITTED, 'Application', applicationId, {
      candidate: onboarding.application.candidate.name,
      updated: !first,
    });
    await this.notifyIfReady(onboarding.id);
  }

  /** 新员工确认劳动合同：输入的姓名要和档案一致 */
  async portalSignContract(applicationId: string, dto: SignContractDto, actor: JwtUser) {
    const onboarding = await this.prisma.onboarding.findUnique({ where: { applicationId }, include: ONBOARDING_INCLUDE });
    if (!onboarding?.contract) throw new BadRequestException('合同尚未生成，请联系 HR');
    if (onboarding.contract.signStatus === 'SIGNED') throw new BadRequestException('合同已确认');
    const expected = onboarding.application.candidate.name.replace(/\s/g, '');
    if (dto.signerName.replace(/\s/g, '') !== expected) {
      throw new BadRequestException('输入的姓名与档案不一致，请输入本人姓名');
    }
    // 状态前置条件进写入条件：连点两次只有一次落库
    const result = await this.prisma.contract.updateMany({
      where: { id: onboarding.contract.id, signStatus: 'PENDING' },
      data: { signStatus: 'SIGNED', signedAt: new Date(), signerName: dto.signerName.trim() },
    });
    if (result.count === 0) throw new ConflictException('合同刚被确认过，请刷新查看');
    await this.activityLog.record(actor, ACTIVITY_ACTIONS.CONTRACT_SIGNED, 'Application', applicationId, {
      candidate: onboarding.application.candidate.name,
      template: onboarding.contract.templateName,
    });
    await this.notifyIfReady(onboarding.id);
  }

  /** 信息和合同都齐了：提醒 HR 确认入职 */
  private async notifyIfReady(id: string) {
    const onboarding = await this.findOrThrow(id);
    if (!this.isReady(onboarding) || onboarding.status === 'COMPLETED') return;
    const { candidate, job } = onboarding.application;
    await this.notifications.pushByPermission(
      PERMISSIONS.ONBOARDING_MANAGE,
      job.departmentId,
      `入职资料已齐：${candidate.name}`,
      `${job.title} · 入职信息已提交、合同已确认，到岗后请确认入职`,
      `/onboarding?onboarding=${id}`,
    );
  }

  private async findOrThrow(id: string) {
    const onboarding = await this.prisma.onboarding.findUnique({ where: { id }, include: ONBOARDING_INCLUDE });
    if (!onboarding) throw new NotFoundException('入职单不存在');
    return onboarding;
  }

  private assertDepartment(user: JwtUser, departmentId: string) {
    const deptScope = departmentScopeOf(user);
    if (deptScope && !inDepartmentScope(deptScope, departmentId)) {
      throw new ForbiddenException('仅可查看本部门的入职单（数据范围：本部门）');
    }
  }
}
