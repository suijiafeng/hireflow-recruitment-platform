import { ensurePortalLink, isPortalLive, PORTAL_TTL, portalExpiry } from '../../common/portal';
import { bootTestApp, createApplication, expectOk, type TestApp } from '../../test-utils/app';

/**
 * Offer 状态机 + 候选人门户链接（真库）：
 * 发出即生效、拒绝必须给原因码、拒绝后应聘撤回、过期懒失效、续期只一次、重复发 409、
 * 门户链接只顺延不缩短、重新生成后旧链接立即失效、过期 410。
 */
describe('Offer 与门户链接', () => {
  let t: TestApp;
  const startDate = () => new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  const sendOffer = async (applicationId: string) =>
    expectOk(await t.call('POST', '/offers', { applicationId, salaryBase: 25000, startDate: startDate() })).body;
  const linkOf = async (applicationId: string, rotate = false) =>
    expectOk(await t.call('POST', `/applications/${applicationId}/portal-link`, rotate ? { rotate: true } : {})).body
      .token as string;

  beforeAll(async () => {
    t = await bootTestApp();
    await t.login();
  }, 60_000);
  afterAll(() => t?.stop());

  it('同一应聘不能重复发 Offer（409）', async () => {
    const { applicationId } = await createApplication(t, '甲');
    await sendOffer(applicationId);
    const again = await t.call('POST', '/offers', { applicationId, salaryBase: 26000, startDate: startDate() });
    expect(again.status).toBe(409);
    expect(again.body.message).toContain('已存在 Offer');
  });

  it('拒绝必须给原因码；拒绝后应聘置为撤回，门户只显示结束', async () => {
    const { applicationId } = await createApplication(t, '乙');
    await sendOffer(applicationId);
    const token = await linkOf(applicationId);
    const noReason = await t.call('POST', `/portal/${token}/offer/respond`, { decision: 'DECLINED' }, false);
    expect(noReason.status).toBe(400);
    expect(JSON.stringify(noReason.body.message)).toContain('原因码');
    expectOk(await t.call('POST', `/portal/${token}/offer/respond`, { decision: 'DECLINED', reason: '接受了其他机会' }, false));
    const app = await t.prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(app.status).toBe('WITHDRAWN');
    const view = expectOk(await t.call('GET', `/portal/${token}`, undefined, false)).body;
    expect(view.step).toBe('closed');
    expect(view.offer).toBeNull();
  });

  it('过了答复期：答复被拒、Offer 懒失效为 EXPIRED；续期一次后可答复，第二次续期被拒', async () => {
    const { applicationId } = await createApplication(t, '丙');
    const offer = await sendOffer(applicationId);
    await t.prisma.offer.update({ where: { id: offer.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const token = await linkOf(applicationId);
    const late = await t.call('POST', `/portal/${token}/offer/respond`, { decision: 'ACCEPTED' }, false);
    expect(late.status).toBe(400);
    expect(late.body.message).toContain('超过答复期');
    expect((await t.prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe('EXPIRED');

    expectOk(await t.call('POST', `/offers/${offer.id}/extend`, {}));
    const extended = await t.prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(extended.status).toBe('SENT');
    expect(extended.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    const twice = await t.call('POST', `/offers/${offer.id}/extend`, {});
    expect(twice.status).toBe(400);
    expect(twice.body.message).toContain('仅可续期一次');
    expectOk(await t.call('POST', `/portal/${token}/offer/respond`, { decision: 'ACCEPTED' }, false));
  });

  it('门户链接：只顺延不缩短；重新生成后旧链接 404；过期 410', async () => {
    const { applicationId } = await createApplication(t, '丁');
    const first = await ensurePortalLink(t.prisma, applicationId, portalExpiry(PORTAL_TTL.ONBOARDING_MS));
    const shorter = await ensurePortalLink(t.prisma, applicationId, portalExpiry(PORTAL_TTL.DEFAULT_MS));
    expect(shorter.token).toBe(first.token);
    expect(shorter.expiresAt.getTime()).toBe(first.expiresAt.getTime());
    expect(shorter.rotated).toBe(false);

    const rotated = await ensurePortalLink(t.prisma, applicationId, portalExpiry(PORTAL_TTL.DEFAULT_MS), true);
    expect(rotated.token).not.toBe(first.token);
    expect(rotated.rotated).toBe(true);
    expect((await t.call('GET', `/portal/${first.token}`, undefined, false)).status).toBe(404);
    expectOk(await t.call('GET', `/portal/${rotated.token}`, undefined, false));

    await t.prisma.application.update({ where: { id: applicationId }, data: { portalExpiresAt: new Date(Date.now() - 1000) } });
    const expired = await t.call('GET', `/portal/${rotated.token}`, undefined, false);
    expect(expired.status).toBe(410);
    expect(expired.body.code).toBe('PORTAL_EXPIRED');
    expect(isPortalLive(null)).toBe(false);
  });

  it('入职完成 7 天后门户关闭（410），完成前一直可看', async () => {
    const { applicationId } = await createApplication(t, '戊');
    await sendOffer(applicationId);
    const token = await linkOf(applicationId);
    expectOk(await t.call('POST', `/portal/${token}/offer/respond`, { decision: 'ACCEPTED' }, false));
    const ob = await t.prisma.onboarding.findUniqueOrThrow({ where: { applicationId } });
    await t.prisma.onboarding.update({
      where: { id: ob.id },
      data: { status: 'COMPLETED', completedAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    expect((await t.call('GET', `/portal/${token}`, undefined, false)).status).toBe(410);
  });
});
