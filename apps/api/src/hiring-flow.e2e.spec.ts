import { StageKind } from '@hireflow/shared';
import type { PrismaService } from './prisma/prisma.service';
import { bootTestApp, expectOk, TEST_HR, type TestApp } from './test-utils/app';

/**
 * 端到端主流程（整个 AppModule + 真 HTTP + 临时 Postgres WASM，AI 用规则引擎）：
 *   HR 登录 → 建职位（4 个系统阶段）→ 建候选人并投递 → 安排面试（卡片自动进「面试」）→
 *   直接发 Offer（无审批，卡片自动进「录用」）→ 候选人在同一个门户链接里接受 →
 *   填入职信息 → 确认合同 → HR 确认入职 → 已入职。
 * 同时覆盖：统一错误体（中文校验信息 + requestId）、门户无效令牌 404、/health 与 /ready、安全响应头。
 */
describe('招聘主流程 e2e', () => {
  let t: TestApp;
  let prisma: PrismaService;
  const call: TestApp['call'] = (...args) => t.call(...args);

  beforeAll(async () => {
    t = await bootTestApp();
    prisma = t.prisma;
  }, 60_000);

  afterAll(async () => {
    await t?.stop();
  });

  it('health 不查库、ready 查库，均带安全响应头与请求号', async () => {
    const health = await call('GET', '/health', undefined, false);
    expectOk(health);
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    expect(health.headers.get('x-request-id')).toBeTruthy();
    const ready = await call('GET', '/ready', undefined, false);
    expectOk(ready);
    expect(ready.body.checks.database).toBe('up');
  });

  it('校验错误统一为中文 + requestId', async () => {
    const res = await call('POST', '/auth/login', { email: 'not-an-email', password: '1' }, false);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.requestId).toBeTruthy();
    expect(res.body.message.join('；')).toMatch(/邮箱格式不正确/);
    expect(res.body.message.join('；')).toMatch(/密码至少 6 位/);
  });

  it('从投递到入职走完全流程', async () => {
    await t.login();

    // 建职位：默认 4 个系统阶段
    const job = await call('POST', '/jobs', { title: '后端工程师', departmentId: TEST_HR.departmentId, headcount: 1, status: 'OPEN' });
    expectOk(job);
    const stages = await prisma.pipelineStage.findMany({ where: { jobId: job.body.id }, orderBy: { order: 'asc' } });
    expect(stages.map((s) => [s.name, s.kind])).toEqual([
      ['筛选', StageKind.SCREENING],
      ['面试', StageKind.INTERVIEW],
      ['录用', StageKind.OFFER],
      ['入职', StageKind.ONBOARDING],
    ]);

    const candidate = await call('POST', '/candidates', { name: '沈知夏', email: 'shen@example.com', phone: '13800001111' });
    expectOk(candidate);
    const application = await call('POST', '/applications', { candidateId: candidate.body.id, jobId: job.body.id });
    expectOk(application);
    const appId = application.body.id;
    const kindOf = async () =>
      (await prisma.application.findUniqueOrThrow({ where: { id: appId }, include: { stage: true } })).stage.kind;
    expect(await kindOf()).toBe(StageKind.SCREENING);

    // 安排面试 → 自动进入「面试」，看板卡片带轮次标签
    const at = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const interview = await call('POST', '/interviews', { applicationId: appId, round: 1, scheduledAt: at, durationMins: 60, interviewerIds: [TEST_HR.id] });
    expectOk(interview);
    expect(await kindOf()).toBe(StageKind.INTERVIEW);
    const board = await call('GET', `/jobs/${job.body.id}/board`);
    const card = board.body.columns.find((c: { stage: { kind: string } }) => c.stage.kind === 'INTERVIEW').applications[0];
    expect(card.interview).toMatchObject({ round: 1, state: 'scheduled' });

    // 不能跳过 Offer 直接拖进「入职」
    const jump = await call('PATCH', `/applications/${appId}/stage`, { stageId: stages[3].id });
    expect(jump.status).toBe(400);

    // 直接发 Offer（无审批）→ 自动进入「录用」
    const startDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const offer = await call('POST', '/offers', { applicationId: appId, salaryBase: 30000, bonusMonths: 2, startDate, grade: 'P6' });
    expectOk(offer);
    expect(offer.body.status).toBe('SENT');
    expect(await kindOf()).toBe(StageKind.OFFER);

    // 同一个门户链接
    const link = await call('POST', `/applications/${appId}/portal-link`, {});
    expectOk(link);
    const portalToken: string = link.body.token;
    expect(portalToken).toBeTruthy();

    expect((await call('GET', '/portal/not-a-real-token', undefined, false)).status).toBe(404);
    const view1 = await call('GET', `/portal/${portalToken}`, undefined, false);
    expectOk(view1);
    expect(view1.body).toMatchObject({ step: 'offer', company: '测试科技有限公司', candidateName: '沈知夏' });

    // 候选人接受 → 生成入职单 + 待确认合同，卡片进入「入职」
    const accepted = await call('POST', `/portal/${portalToken}/offer/respond`, { decision: 'ACCEPTED' }, false);
    expectOk(accepted);
    expect(accepted.body.step).toBe('onboarding');
    expect(await kindOf()).toBe(StageKind.ONBOARDING);
    const onboarding = await prisma.onboarding.findUniqueOrThrow({ where: { applicationId: appId }, include: { contract: true } });
    expect(onboarding.contract?.signStatus).toBe('PENDING');

    // 资料没齐不能确认入职
    expect((await call('POST', `/onboardings/${onboarding.id}/complete`, {})).status).toBe(400);

    // 入职信息：校验信息为中文
    const bad = await call('PUT', `/portal/${portalToken}/onboarding/info`, { idNumber: '123' }, false);
    expect(bad.status).toBe(400);
    expect(bad.body.message.join('；')).toMatch(/身份证号/);
    const info = await call(
      'PUT',
      `/portal/${portalToken}/onboarding/info`,
      { idNumber: '11010519900307888X', bankName: '招商银行', bankAccount: '6225880112345678', address: '上海市浦东新区张江路 88 号', emergencyContact: '沈母', emergencyPhone: '13900002222' },
      false,
    );
    expectOk(info);

    // 合同确认：姓名必须与本人一致
    expect((await call('POST', `/portal/${portalToken}/onboarding/contract/sign`, { signerName: '别人' }, false)).status).toBe(400);
    const signed = await call('POST', `/portal/${portalToken}/onboarding/contract/sign`, { signerName: '沈知夏' }, false);
    expectOk(signed);

    // HR 视图：敏感信息按权限显示，ready = true
    const detail = await call('GET', `/onboardings/${onboarding.id}`);
    expect(detail.body.ready).toBe(true);

    const done = await call('POST', `/onboardings/${onboarding.id}/complete`, {});
    expectOk(done);
    const final = await prisma.application.findUniqueOrThrow({ where: { id: appId } });
    expect(final.status).toBe('HIRED');
    const view2 = await call('GET', `/portal/${portalToken}`, undefined, false);
    expect(view2.body.step).toBe('hired');

    // 时间轴留痕：谁、何时、做了什么
    const actions = (await prisma.activityLog.findMany({ where: { entityId: appId }, orderBy: { createdAt: 'asc' } })).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['application.created', 'interview.scheduled', 'offer.sent', 'offer.responded', 'onboarding.created', 'contract.signed', 'onboarding.completed']));
  }, 60_000);
});
