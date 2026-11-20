import { HttpStatus } from '@nestjs/common';
import { ApplicationsService } from '../modules/applications/applications.service';
import { OffersService } from '../modules/offers/offers.service';
import { OnboardingService } from '../modules/onboarding/onboarding.service';
import { assertPortalLive, isPortalLive, PORTAL_TTL, PortalLinkExpiredException } from './portal';

const past = () => new Date(Date.now() - 1000);
const future = () => new Date(Date.now() + 3600_000);

async function statusOf(p: Promise<unknown>) {
  try {
    await p;
    return 200;
  } catch (e) {
    return (e as { getStatus?: () => number }).getStatus?.() ?? 500;
  }
}

describe('门户链接硬过期', () => {
  it('没有过期时间按「已过期」处理（失败即关闭），过期抛 410', () => {
    expect(isPortalLive(null)).toBe(false);
    expect(isPortalLive(past())).toBe(false);
    expect(isPortalLive(future())).toBe(true);
    expect(() => assertPortalLive(past())).toThrow(PortalLinkExpiredException);
    try {
      assertPortalLive(undefined);
    } catch (e) {
      expect((e as PortalLinkExpiredException).getStatus()).toBe(HttpStatus.GONE);
      expect((e as PortalLinkExpiredException).getResponse()).toMatchObject({ code: 'PORTAL_EXPIRED' });
    }
  });

  describe('预筛问卷', () => {
    const app = (over: object = {}) => ({
      id: 'a1',
      jobId: 'j1',
      status: 'ACTIVE',
      prescreen: null,
      prescreenToken: 'tok',
      prescreenExpiresAt: future(),
      candidate: { id: 'c1', name: '张三' },
      job: { id: 'j1', title: '工程师', departmentId: null },
      ...over,
    });
    const make = (row: object | null) => {
      const prisma = {
        application: { findUnique: jest.fn().mockResolvedValue(row), update: jest.fn().mockResolvedValue({}) },
        job: { findUnique: jest.fn().mockResolvedValue({ departmentId: null }) },
        offer: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const log = { record: jest.fn() };
      const notifications = { pushByPermission: jest.fn() };
      return { prisma, log, service: new ApplicationsService(prisma as never, log as never, {} as never, notifications as never) };
    };
    const hr = { sub: 'u1', permissions: [], roles: [], dataScope: 'ALL' } as never;

    it('过期链接打开 / 提交都返回 410，无效令牌 404', async () => {
      expect(await statusOf(make(app({ prescreenExpiresAt: past() })).service.prescreenView('tok'))).toBe(410);
      expect(
        await statusOf(make(app({ prescreenExpiresAt: past() })).service.prescreenSubmit('tok', {
          expectedSalary: 1, availableDate: '2026-12-01', travelOk: true,
        })),
      ).toBe(410);
      expect(await statusOf(make(null).service.prescreenView('nope'))).toBe(404);
      expect(await statusOf(make(app()).service.prescreenView('tok'))).toBe(200);
    });

    it('提交是一次性的，提交后链接只再保留 3 天', async () => {
      const { prisma, service } = make(app());
      await service.prescreenSubmit('tok', { expectedSalary: 1, availableDate: '2026-12-01', travelOk: true });
      const data = prisma.application.update.mock.calls[0][0].data;
      expect(data.prescreenExpiresAt.getTime() - Date.now()).toBeLessThanOrEqual(PORTAL_TTL.PRESCREEN_AFTER_SUBMIT_MS);
      expect(await statusOf(make(app({ prescreen: { submittedAt: 'x' } })).service.prescreenSubmit('tok', {
        expectedSalary: 1, availableDate: '2026-12-01', travelOk: true,
      }))).toBe(400);
    });

    it('重发：有效期内复用令牌并顺延 7 天；已过期或 rotate 换新令牌', async () => {
      let m = make(app());
      expect((await m.service.sendPrescreen('a1', hr)).token).toBe('tok');
      expect(m.prisma.application.update.mock.calls[0][0].data.prescreenExpiresAt.getTime()).toBeGreaterThan(Date.now() + PORTAL_TTL.PRESCREEN_MS - 5000);
      m = make(app({ prescreenExpiresAt: past() }));
      expect((await m.service.sendPrescreen('a1', hr)).token).not.toBe('tok');
      m = make(app());
      expect((await m.service.sendPrescreen('a1', hr, true)).token).not.toBe('tok');
      expect(m.log.record).toHaveBeenCalledWith(hr, 'portal.link_rotated', 'Application', 'a1', expect.anything());
    });
  });

  describe('Offer 门户', () => {
    const make = (row: object | null) => {
      const prisma = { offer: { findUnique: jest.fn().mockResolvedValue(row) } };
      return new OffersService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    };
    it('过期 410 / 无效 404（查看与答复）', async () => {
      const row = { id: 'o1', portalExpiresAt: past(), application: { candidate: { name: '张三' } } };
      expect(await statusOf(make(row).portalView('tok'))).toBe(410);
      expect(await statusOf(make(row).portalRespond('tok', { decision: 'ACCEPTED' } as never))).toBe(410);
      expect(await statusOf(make(null).portalView('tok'))).toBe(404);
    });
  });

  describe('新员工门户', () => {
    const make = (row: object | null) => {
      const prisma = { onboarding: { findUnique: jest.fn().mockResolvedValue(row) } };
      return new OnboardingService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    };
    it('过期 410；闭环超过宽限期也是 410；无效 404', async () => {
      expect(await statusOf(make({ status: 'IN_PROGRESS', portalExpiresAt: past(), updatedAt: new Date() }).portalView('tok'))).toBe(410);
      expect(
        await statusOf(make({ status: 'COMPLETED', portalExpiresAt: future(), updatedAt: new Date(0) }).portalView('tok')),
      ).toBe(410);
      expect(await statusOf(make(null).portalView('tok'))).toBe(404);
    });
    it('已过期的链接不会再被 Offer 门户当作入职入口发出去', async () => {
      const svc = make({ portalToken: 'tok', portalExpiresAt: past() });
      expect(await svc.portalTokenOf('a1')).toBeNull();
    });
  });
});
