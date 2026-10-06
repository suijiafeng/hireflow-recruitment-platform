import { AI_DRAFT_MARKER, EvaluationConclusion } from '@hireflow/shared';
import type {
  AiEngine,
  CompareInput,
  CompareResult,
  EvaluationDraft,
  EvaluationDraftInput,
  FunnelInput,
  HelpdeskInput,
  JdDraft,
  JdInput,
  MatchInput,
  MatchResult,
  ParsedResume,
  RetentionHint,
  RetentionInput,
} from './ai-engine.interface';

/** 技能本体（极简版 Skill Ontology）：关键词 → 标准标签 + 语义推导标签 */
const SKILL_ONTOLOGY: Array<{ pattern: RegExp; tag: string; implies?: string[] }> = [
  { pattern: /react/i, tag: 'React', implies: ['前端开发'] },
  { pattern: /vue/i, tag: 'Vue', implies: ['前端开发', 'JavaScript'] },
  { pattern: /typescript|\bts\b/i, tag: 'TypeScript' },
  { pattern: /javascript|\bjs\b/i, tag: 'JavaScript' },
  { pattern: /node\.?js/i, tag: 'Node.js', implies: ['后端开发'] },
  { pattern: /nestjs|nest\.js/i, tag: 'NestJS', implies: ['Node.js', '后端开发'] },
  { pattern: /java\b/i, tag: 'Java', implies: ['后端开发'] },
  { pattern: /spring/i, tag: 'Spring', implies: ['Java'] },
  { pattern: /\bgo(lang)?\b/i, tag: 'Go', implies: ['后端开发'] },
  { pattern: /python/i, tag: 'Python' },
  { pattern: /postgres|postgresql/i, tag: 'PostgreSQL', implies: ['数据库'] },
  { pattern: /mysql/i, tag: 'MySQL', implies: ['数据库'] },
  { pattern: /redis/i, tag: 'Redis' },
  { pattern: /kafka/i, tag: 'Kafka' },
  { pattern: /docker/i, tag: 'Docker' },
  { pattern: /k8s|kubernetes/i, tag: 'Kubernetes', implies: ['云原生'] },
  { pattern: /微服务/, tag: '微服务' },
  { pattern: /高并发/, tag: '高并发' },
  { pattern: /分布式/, tag: '分布式' },
  { pattern: /前端/, tag: '前端开发' },
  { pattern: /后端/, tag: '后端开发' },
  { pattern: /全栈/, tag: '全栈' },
  { pattern: /带(领)?团队|团队管理|管理.{0,4}人/, tag: '带团队' },
  { pattern: /产品(经理|设计|规划)/, tag: 'B端产品' },
  { pattern: /数据分析/, tag: '数据分析' },
  { pattern: /用户研究|用研/, tag: '用户研究' },
  { pattern: /小程序/, tag: '小程序' },
  // 词边界必须写全：裸 ai/ts 会被 Email、reports 这类普通词误命中
  { pattern: /\bai\b|大模型|\bllm\b|机器学习/i, tag: 'AI/大模型' },
];

const POSITIVE_WORDS = /扎实|清晰|优秀|熟练|深入|出色|流畅|完整|亮眼|主导|独立|高效/g;
const NEGATIVE_WORDS = /薄弱|欠缺|含糊|紧张|不足|一般|模糊|卡壳|依赖|浅/g;

function extractSkills(text: string): string[] {
  const tags = new Set<string>();
  for (const item of SKILL_ONTOLOGY) {
    if (item.pattern.test(text)) {
      tags.add(item.tag);
      item.implies?.forEach((t) => tags.add(t));
    }
  }
  return [...tags];
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

/**
 * 确定性规则引擎：未配置 LLM 时兜底，保证 AI 链路端到端可用。
 * 输出质量有限但格式与真实引擎完全一致（先用规则兜底，逐步替换）。
 */
export class MockAiEngine implements AiEngine {
  readonly name = 'mock';

  async generateJd(input: JdInput): Promise<JdDraft> {
    const dept = input.departmentName ? `${input.departmentName} · ` : '';
    const keywords = input.keywords?.trim();
    const skillLine = keywords ? `熟悉 ${keywords}；` : '';
    return {
      description: [
        `【${dept}${input.title}】`,
        `1. 负责${input.title}相关系统/业务的设计、研发与迭代，保障交付质量与稳定性；`,
        `2. 参与需求评审与技术方案设计，推动跨团队协作落地；`,
        `3. 持续优化性能与工程效率，沉淀可复用的组件与最佳实践；`,
        `4. 关注业界动态，引入合适的新技术改进现有体系。`,
      ].join('\n'),
      requirement: [
        `1. ${skillLine}3 年以上相关工作经验，基础扎实；`,
        `2. 具备良好的工程素养与代码规范意识，重视测试与文档；`,
        `3. 良好的沟通协作能力与自驱力，能独立推进复杂任务；`,
        `4. 有大型项目 / 高并发 / B 端系统经验者优先。`,
      ].join('\n'),
    };
  }

  async parseResume(rawText: string): Promise<ParsedResume> {
    const skills = extractSkills(rawText);
    const yearsMatch = rawText.match(/(\d{1,2})\s*年(?:以上)?(?:相关)?(?:工作|开发|后端|前端|产品)?经[验历]/);
    const years = yearsMatch?.[1];

    const educations: ParsedResume['educations'] = [];
    const schoolMatch = rawText.match(/([^\s，。、于毕就读]{2,12}(?:大学|学院))/);
    if (schoolMatch) {
      const degree = rawText.match(/(博士|硕士|研究生|本科|大专)/)?.[1];
      educations.push({ school: schoolMatch[1], ...(degree ? { degree } : {}) });
    }

    const experiences: ParsedResume['experiences'] = [];
    const companyMatch = rawText.match(/([一-龥A-Za-z0-9]{2,16}(?:公司|科技|集团|工作室|平台))/);
    const titleMatch = rawText.match(/((?:高级|资深|首席)?[一-龥A-Za-z]{2,10}(?:工程师|经理|总监|负责人|架构师|专家|设计师))/);
    if (companyMatch || titleMatch) {
      experiences.push({
        company: companyMatch?.[1] ?? '未识别',
        ...(titleMatch ? { title: titleMatch[1] } : {}),
        ...(years ? { years: `${years} 年` } : {}),
      });
    }

    const top = skills.slice(0, 4).join('、');
    const summary = [
      top ? `候选人主攻 ${top}${years ? `，约 ${years} 年相关经验` : ''}。` : '简历中未识别出明确技能关键词。',
      skills.length >= 4 ? '技能覆盖面较广，与技术岗位匹配潜力较高。' : '技能信息较少，建议面试中重点验证实际深度。',
      '（规则引擎解析结果，配置 ANTHROPIC_API_KEY 后可获得更准确的语义解析）',
    ].join('');

    return { summary, skills, educations, experiences };
  }

  async scoreMatch(input: MatchInput): Promise<MatchResult> {
    const jobText = `${input.jobTitle} ${input.jobDescription} ${input.jobRequirement}`;
    const required = extractSkills(jobText);
    const owned = new Set([...extractSkills(input.resumeText), ...input.candidateTags]);

    const hits = required.filter((s) => owned.has(s));
    const misses = required.filter((s) => !owned.has(s));

    let score: number;
    if (required.length === 0) {
      score = Math.min(60 + owned.size * 3, 85);
    } else {
      score = Math.round(50 + (hits.length / required.length) * 45);
    }
    score = Math.max(35, Math.min(score, 97));

    return {
      score,
      hits,
      misses,
      highlights: hits.length > 0 ? `命中岗位关键能力：${hits.join('、')}。` : '未命中岗位显性关键词，或为潜力型候选人。',
      risks:
        misses.length > 0
          ? `以下要求未在简历中体现：${misses.join('、')}，建议面试验证。`
          : '暂无明显缺失项，注意验证项目经验真实深度。',
    };
  }

  async draftEvaluation(input: EvaluationDraftInput): Promise<EvaluationDraft> {
    const positive = countMatches(input.notes, POSITIVE_WORDS);
    const negative = countMatches(input.notes, NEGATIVE_WORDS);
    const base = 3 + Math.min(positive, 4) * 0.5 - Math.min(negative, 4) * 0.7;

    const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)));
    const techSignal = countMatches(input.notes, /算法|架构|设计|原理|源码|性能|方案/g);
    const commSignal = countMatches(input.notes, /沟通|表达|清晰|条理|协作/g);

    // 岗位模板维度：技术/沟通类维度叠加对应信号，其余用基础分
    const dimensions = input.dimensions?.length ? input.dimensions : ['技术能力', '工程素养', '沟通协作'];
    const scorecard = dimensions.map((dimension) => {
      const isTech = /技术|工程|架构|算法|代码|专业/.test(dimension);
      const isComm = /沟通|协作|表达|团队/.test(dimension);
      const score = clamp(
        base + (isTech ? Math.min(techSignal, 2) * 0.4 : 0) + (isComm ? Math.min(commSignal, 2) * 0.4 : 0),
      );
      return { dimension, score, comment: `依据面试记录中与「${dimension}」相关的信号评估` };
    });
    const avg = scorecard.reduce((s, i) => s + i.score, 0) / scorecard.length;

    // 1-5 分制里 3 分是「达到要求」：均分过 3 就该是推荐，否则 3/3/4 会配上「不推荐」，自相矛盾
    const conclusion =
      avg >= 4.5
        ? EvaluationConclusion.STRONG_YES
        : avg >= 3
          ? EvaluationConclusion.YES
          : avg >= 2
            ? EvaluationConclusion.NO
            : EvaluationConclusion.STRONG_NO;

    const excerpt = input.notes.replace(/\s+/g, ' ').slice(0, 80);
    return {
      scorecard,
      conclusion,
      comments: `${AI_DRAFT_MARKER}第 ${input.round} 轮面试（${input.jobTitle}）记录要点：${excerpt}${input.notes.length > 80 ? '…' : ''}`,
    };
  }

  async answerQuestion(input: HelpdeskInput): Promise<string> {
    if (input.docs.length === 0) {
      return '抱歉，制度库中没有找到与该问题相关的内容，建议直接联系 HR（hr@arthr.local）确认。';
    }
    const best = input.docs[0];
    const excerpt = best.content.replace(/\s+/g, ' ').slice(0, 220);
    return `根据《${best.title}》：${excerpt}${best.content.length > 220 ? '……' : ''}（规则引擎按关键词检索作答，配置 ANTHROPIC_API_KEY 后可获得更准确的综合回答）`;
  }

  async predictRetention(input: RetentionInput): Promise<RetentionHint> {
    let probability = 0.7;
    const factors: string[] = [];
    if ((input.matchScore ?? 0) >= 85) {
      probability += 0.1;
      factors.push('岗位匹配度高（≥85），入职后适配成本低');
    } else if ((input.matchScore ?? 0) > 0 && (input.matchScore ?? 0) < 60) {
      probability -= 0.1;
      factors.push('岗位匹配度偏低，可能存在适配风险');
    }
    if (input.tags.some((t) => /带团队|架构|分布式|高并发/.test(t))) {
      probability += 0.05;
      factors.push('具备进阶能力标签，职业发展空间充足');
    }
    if (input.tags.length <= 2) {
      probability -= 0.05;
      factors.push('画像信息较少，建议入职后加强导师辅导');
    }
    probability = Math.max(0.5, Math.min(0.95, probability));
    if (factors.length === 0) factors.push('画像常规，无显著风险信号');
    factors.push('（规则引擎估算，仅作辅助参考，录用决策以人工判断为准）');
    return { probability: Math.round(probability * 100) / 100, factors };
  }

  async funnelInsight(input: FunnelInput): Promise<string> {
    const stages = input.stages;
    const total = stages.reduce((s, x) => s + x.count, 0);
    if (total === 0) return `「${input.jobTitle}」暂无候选人数据，建议先导入简历或检查职位发布渠道。`;

    let worst: { from: string; to: string; rate: number } | null = null;
    for (let i = 1; i < stages.length; i++) {
      if (stages[i - 1].count === 0) continue;
      const rate = stages[i].count / stages[i - 1].count;
      if (!worst || rate < worst.rate) {
        worst = { from: stages[i - 1].name, to: stages[i].name, rate };
      }
    }
    const head = `「${input.jobTitle}」漏斗共 ${total} 人：${stages.map((s) => `${s.name} ${s.count}`).join(' → ')}。`;
    const tail = worst
      ? `「${worst.from} → ${worst.to}」转化率 ${(worst.rate * 100).toFixed(0)}% 为全流程最低，建议复盘该环节的筛选标准或面试官档期。`
      : '各阶段转化平稳，暂无明显瓶颈。';
    return head + tail;
  }

  async compareCandidates(input: CompareInput): Promise<CompareResult> {
    // 规则口径：AI 匹配分 60% + 面评均分（换算百分制）40%；无面评按 50 中性分
    const scored = input.candidates.map((c) => {
      const evalScores = c.evaluations.map((e) => e.avgScore).filter((s): s is number => s != null);
      const evalAvg100 = evalScores.length
        ? (evalScores.reduce((a, b) => a + b, 0) / evalScores.length) * 20
        : 50;
      const passCount = c.evaluations.filter(
        (e) => e.conclusion === 'YES' || e.conclusion === 'STRONG_YES',
      ).length;
      const composite = (c.matchScore ?? 50) * 0.6 + evalAvg100 * 0.4;
      return { name: c.name, composite, passCount, evalCount: c.evaluations.length };
    });
    const ranked = [...scored].sort((a, b) => b.composite - a.composite);
    const top = ranked[0];
    return {
      summary:
        `按「匹配分 60% + 面评均分 40%」综合，${ranked
          .map((r, i) => `${i + 1}) ${r.name} ${Math.round(r.composite)} 分`)
          .join('；')}。` +
        `${top.name} 综合领先${top.passCount > 0 ? `，且已获 ${top.passCount} 轮推荐结论` : ''}；建议结合岗位侧重与团队互补做终审。`,
      ranking: ranked.map((r, i) => ({
        name: r.name,
        rank: i + 1,
        rationale: `综合 ${Math.round(r.composite)} 分（面评 ${r.evalCount} 轮、推荐 ${r.passCount} 轮）`,
      })),
      risks:
        scored.some((s) => s.evalCount === 0)
          ? '部分候选人尚无面评数据，排名主要依赖简历匹配分，建议补齐面试后再终审。（规则引擎估算，仅作辅助参考）'
          : '各候选人均有面评数据；注意规则引擎不理解语义细节，终审以人工判断为准。',
    };
  }
}
