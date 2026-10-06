import { AI_DRAFT_MARKER, EvaluationConclusion } from '@hireflow/shared';
import { MockAiEngine } from './mock.engine';

const POSITIVE = [EvaluationConclusion.YES, EvaluationConclusion.STRONG_YES];

describe('MockAiEngine.draftEvaluation', () => {
  const engine = new MockAiEngine();
  const draft = (notes: string) =>
    engine.draftEvaluation({ candidateName: '周一鸣', jobTitle: '测试工程师', round: 1, notes });

  it.each([
    '候选人表达清晰，自动化框架设计有条理，接口测试经验扎实',
    '基础一般，部分问题回答不上来，项目经验偏浅',
    '沟通顺畅，但性能测试原理理解较浅，缺少大型项目经历',
    '很一般',
  ])('结论方向与均分一致：%s', async (notes) => {
    const d = await draft(notes);
    const avg = d.scorecard.reduce((s, i) => s + i.score, 0) / d.scorecard.length;
    // 1-5 分制里 3 分是「达到要求」：均分 ≥3 必须是推荐，<3 必须是不推荐
    expect(POSITIVE.includes(d.conclusion)).toBe(avg >= 3);
  });

  it('评语带草稿标记，提醒面试官修改', async () => {
    const d = await draft('候选人表达清晰，项目经验扎实');
    expect(d.comments.startsWith(AI_DRAFT_MARKER)).toBe(true);
  });
});
