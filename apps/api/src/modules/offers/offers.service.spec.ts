import { BadRequestException } from '@nestjs/common';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { OffersService } from './offers.service';

/**
 * Offer 状态机守卫单测：
 * 不连库，用最小桩替身验证非法迁移一律拒绝、懒过期在答复前生效。
 */

const HR: JwtUser = {
  sub: 'u1',
  email: 'hr@arthr.local',
  name: '何欣',
  roles: ['HR'],
  permissions: ['offer:initiate', 'offer:approve', 'salary:view'],
  departmentId: null,
};

function makeOffer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'o1',
    applicationId: 'a1',
    approvalStatus: 'SENT',
    approvalNote: null,
    decision: null,
    decisionReason: null,
    salary: { base: 30000, bonusMonths: 3, note: null },
    grade: 'P6',
    sentAt: new Date(),
    expiresAt: new Date(Date.now() + 86_400_000),
    extendedOnce: false,
    portalToken: 'tok',
    respondedAt: null,
    application: {
      id: 'a1',
      stageId: 's1',
      candidate: { id: 'c1', name: '张三', tags: [] },
      job: { id: 'j1', title: '前端工程师', department: { name: '技术部' } },
    },
    ...overrides,
  };
}

function makeService(offer: Record<string, unknown>) {
  const prisma = {
    offer: {
      findUnique: jest.fn().mockResolvedValue(offer),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...offer, ...data })),
      // 并发加固后 approve/send 走写入条件（updateMany where 状态前置）
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    application: {
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const activityLog = { record: jest.fn(), recordAuto: jest.fn() };
  const notifications = { push: jest.fn(), pushToRole: jest.fn(), pushByPermission: jest.fn(), recipientsByPermission: jest.fn().mockResolvedValue([]), jobManagerIds: jest.fn().mockResolvedValue([]) };
  const onboarding = {
    createForApplication: jest.fn().mockResolvedValue({ id: 'ob1' }),
    ensurePortalToken: jest.fn().mockResolvedValue('obtok'),
    portalTokenOf: jest.fn().mockResolvedValue(null),
  };
  const applications = { moveToStageByName: jest.fn() };
  const service = new OffersService(
    prisma as never,
    activityLog as never,
    {} as never,
    onboarding as never,
    applications as never,
    notifications as never,
  );
  return { service, prisma, activityLog, notifications, onboarding, applications };
}

describe('OffersService 状态机守卫', () => {
  it('非 PENDING 不可审批', async () => {
    const { service } = makeService(makeOffer({ approvalStatus: 'SENT' }));
    await expect(service.approve('o1', {}, true, HR)).rejects.toThrow(BadRequestException);
  });

  it('驳回必须带审批意见', async () => {
    const { service } = makeService(makeOffer({ approvalStatus: 'PENDING' }));
    await expect(service.approve('o1', {}, false, HR)).rejects.toThrow('驳回必须填写审批意见');
  });

  it('仅 REJECTED 可修改重提', async () => {
    const { service } = makeService(makeOffer({ approvalStatus: 'APPROVED' }));
    await expect(service.resubmit('o1', { salaryBase: 28000, startDate: '2099-01-01' }, HR)).rejects.toThrow('仅被驳回的');
  });

  it('发送时生成门户令牌与 5 个工作日答复期（写入条件带状态前置）', async () => {
    const { service, prisma } = makeService(makeOffer({ approvalStatus: 'APPROVED', portalToken: null, expiresAt: null }));
    await service.send('o1', HR);
    const call = prisma.offer.updateMany.mock.calls[0][0];
    expect(call.where.approvalStatus).toBe('APPROVED');
    expect(call.data.approvalStatus).toBe('SENT');
    expect(call.data.portalToken).toBeTruthy();
    expect(call.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('拒绝答复必须带原因码', async () => {
    const { service } = makeService(makeOffer());
    await expect(service.respond('o1', { decision: 'DECLINED' }, HR)).rejects.toThrow('原因码');
  });

  it('拒绝后应聘置为 WITHDRAWN 并提示备选', async () => {
    const { service, prisma, notifications } = makeService(makeOffer());
    prisma.application.count.mockResolvedValue(2);
    await service.respond('o1', { decision: 'DECLINED', reason: '接受了其他机会' }, HR);
    expect(prisma.application.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'WITHDRAWN', rejectReason: '接受了其他机会' } }),
    );
    expect(notifications.pushByPermission.mock.calls[0][3]).toContain('2 位流程中候选人');
  });

  it('接受后自动创建入职单 + 移卡待入职', async () => {
    const { service, onboarding, applications } = makeService(makeOffer());
    const prismaJob = { findUniqueOrThrow: jest.fn().mockResolvedValue({ status: 'PAUSED' }) };
    // checkHeadcount 里会读 job；给桩加上
    (service as unknown as { prisma: Record<string, unknown> }).prisma.job = prismaJob;
    await service.respond('o1', { decision: 'ACCEPTED' }, HR);
    expect(onboarding.createForApplication).toHaveBeenCalledWith('a1', HR);
    expect(applications.moveToStageByName).toHaveBeenCalledWith('a1', '待入职', HR);
  });

  it('已过截止的 SENT 在答复时自动失效并拒绝操作', async () => {
    const { service, prisma, notifications } = makeService(
      makeOffer({ expiresAt: new Date(Date.now() - 1000) }),
    );
    await expect(service.respond('o1', { decision: 'ACCEPTED' }, HR)).rejects.toThrow('已超过答复期');
    // 懒过期落库（写入条件带状态前置，并发懒扫描只生效一次）+ 通知 HR
    expect(prisma.offer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'o1', approvalStatus: 'SENT', decision: null }),
        data: { approvalStatus: 'EXPIRED' },
      }),
    );
    expect(notifications.pushByPermission).toHaveBeenCalled();
  });

  it('续期仅一次', async () => {
    const { service } = makeService(makeOffer({ approvalStatus: 'EXPIRED', extendedOnce: true }));
    await expect(service.extend('o1', HR)).rejects.toThrow('仅可续期一次');
  });

  it('已答复的 Offer 不可续期', async () => {
    const { service } = makeService(makeOffer({ decision: 'ACCEPTED' }));
    await expect(service.extend('o1', HR)).rejects.toThrow('已有答复');
  });
});
