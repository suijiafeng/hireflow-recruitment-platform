import { DataScope } from '@hireflow/shared';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { ApplicationsService } from '../applications/applications.service';
import { JobsService, TALENT_POOL_AI_TOP, TALENT_POOL_CONCURRENCY, coarseTagScore } from './jobs.service';

/** 人才库唤醒与单人评分的 AI 调用策略（并发、粗排、降级口径）；数据库与 AI 都用桩 */
const admin: JwtUser = {
  sub: 'admin',
  email: 'admin@example.test',
  name: '管理员',
  roles: [],
  permissions: [],
  departmentId: 'd1',
  departmentIds: ['d1'],
  dataScope: DataScope.ALL,
};
const activityLog = { record: jest.fn().mockResolvedValue(undefined) };
const tick = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe('人才库唤醒：并发上限 + 粗排后精排 + 降级结果不混排', () => {
  const job = { id: 'j1', title: '后端工程师', description: '招聘 SaaS 后端', requirement: '熟悉 NestJS、PostgreSQL', departmentId: 'd1' };
  const pool = Array.from({ length: 25 }, (_, i) => ({
    id: `c${i}`,
    name: `候选人${i}`,
    // 前 5 个和职位毫不相关；c20 之后命中两个标签，粗排应该排在最前
    tags: i >= 20 ? ['NestJS', 'PostgreSQL'] : i >= 5 ? ['NestJS'] : ['Photoshop'],
    source: '官网',
    resumes: [{ rawText: `简历 ${i}`, parsed: null }],
    applications: [{ status: 'REJECTED', rejectReason: null, updatedAt: new Date(), job: { title: '旧职位' } }],
  }));
  const prisma = {
    job: { findUnique: jest.fn().mockResolvedValue(job) },
    candidate: { findMany: jest.fn().mockResolvedValue(pool) },
  };

  it('只把粗排前 N 名交给大模型，同时在途不超过上限；降级的规则分排在大模型结果之后', async () => {
    let inFlight = 0;
    let peak = 0;
    const scored: string[] = [];
    const ai = {
      scoreMatch: jest.fn(async (input: { resumeText: string }) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await tick(15);
        inFlight--;
        const n = Number(input.resumeText.split(' ')[1]);
        scored.push(`c${n}`);
        // c24 降级到规则引擎，并且分数虚高——不应该排第一
        return n === 24
          ? { data: { score: 99, hits: [], highlights: '规则' }, meta: { provider: 'mock', degraded: true } }
          : { data: { score: 50 + n, hits: ['NestJS'], highlights: 'AI' }, meta: { provider: 'anthropic:x', degraded: false } };
      }),
    };
    const service = new JobsService(prisma as never, activityLog as never, ai as never, {} as never);
    const result = await service.talentPoolScan('j1', admin);

    expect(ai.scoreMatch).toHaveBeenCalledTimes(TALENT_POOL_AI_TOP);
    expect(peak).toBeLessThanOrEqual(TALENT_POOL_CONCURRENCY);
    expect(scored).not.toContain('c0'); // 不相关的候选人不花 token
    expect(result).toMatchObject({ scanned: 25, aiScored: TALENT_POOL_AI_TOP, degraded: 1, skipped: 0 });
    const last = result.recommendations[result.recommendations.length - 1];
    expect(last).toMatchObject({ candidate: { id: 'c24' }, ranked: false });
    expect(result.recommendations[0]).toMatchObject({ candidate: { id: 'c23' }, ranked: true });
  });

  it('coarseTagScore 大小写不敏感', () => {
    expect(coarseTagScore(['nestjs', 'Redis', ''], '熟悉 NestJS')).toBe(1);
  });
});

describe('单人匹配评分：分数口径', () => {
  const baseApp = {
    id: 'a1',
    jobId: 'j1',
    job: { title: '后端', description: '', requirement: '' },
    candidate: { name: '张三', tags: ['NestJS'], resumes: [{ rawText: '熟悉 NestJS', parsed: null }] },
  };
  const make = (existing: { matchScore: number | null; matchSource: string | null }, meta: object, score = 40) => {
    const prisma = {
      application: {
        findUnique: jest.fn().mockResolvedValue({ ...baseApp, ...existing }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'a1', ...existing }),
        update: jest.fn(async ({ data }: { data: object }) => ({ id: 'a1', ...data })),
      },
    };
    const ai = { scoreMatch: jest.fn().mockResolvedValue({ data: { score, hits: [], misses: [], highlights: '', risks: '' }, meta }) };
    return { prisma, service: new ApplicationsService(prisma as never, activityLog as never, ai as never, {} as never) };
  };

  it('降级时不拿规则分覆盖已有的大模型分数', async () => {
    const { prisma, service } = make({ matchScore: 88, matchSource: 'ai' }, { provider: 'mock', degraded: true });
    const res = await service.score('a1', admin);
    expect(prisma.application.update).not.toHaveBeenCalled();
    expect(res).toMatchObject({ matchScore: 88, matchSource: 'ai', degradedKept: true, aiMeta: { degraded: true } });
  });

  it('没有大模型分数时写入规则分并标注 rule；大模型结果标注 ai', async () => {
    const rule = make({ matchScore: null, matchSource: null }, { provider: 'mock', degraded: true });
    await rule.service.score('a1', admin);
    expect(rule.prisma.application.update.mock.calls[0][0].data).toMatchObject({ matchScore: 40, matchSource: 'rule' });

    const llm = make({ matchScore: 30, matchSource: 'rule' }, { provider: 'anthropic:x', degraded: false }, 77);
    await llm.service.score('a1', admin);
    expect(llm.prisma.application.update.mock.calls[0][0].data).toMatchObject({ matchScore: 77, matchSource: 'ai' });
  });
});
