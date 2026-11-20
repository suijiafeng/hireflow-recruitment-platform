/** 各 AI 能力的结构化输出 JSON Schema（Anthropic output_config / OpenAI response_format 共用） */

export const JD_SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string', description: '岗位职责，分条列出，约 200-300 字' },
    requirement: { type: 'string', description: '任职要求，分条列出，约 150-250 字' },
  },
  required: ['description', 'requirement'],
  additionalProperties: false,
} as const;

export const PARSED_RESUME_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '约150字的候选人亮点与风险提示' },
    skills: {
      type: 'array',
      items: { type: 'string' },
      description: '技能标签，含语义推导（如“精通Vue”应同时给出 Vue、前端开发、JavaScript）',
    },
    educations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          school: { type: 'string' },
          degree: { type: 'string' },
          major: { type: 'string' },
        },
        required: ['school', 'degree', 'major'],
        additionalProperties: false,
      },
    },
    experiences: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          company: { type: 'string' },
          title: { type: 'string' },
          years: { type: 'string' },
          highlights: { type: 'string' },
        },
        required: ['company', 'title', 'years', 'highlights'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'skills', 'educations', 'experiences'],
  additionalProperties: false,
} as const;

export const MATCH_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', description: '0-100 的匹配度整数分' },
    hits: { type: 'array', items: { type: 'string' }, description: '命中的岗位要求（每条都要在 evidence 里给出原文证据）' },
    misses: { type: 'array', items: { type: 'string' }, description: '缺失的岗位要求' },
    evidence: {
      type: 'array',
      description: '每条命中要求的证据：quote 必须是逐字摘自候选人材料的原文片段（不超过 60 字），找不到原文就不要列为命中',
      items: {
        type: 'object',
        properties: {
          requirement: { type: 'string', description: '对应 hits 中的一条' },
          quote: { type: 'string', description: '候选人材料中的原文片段，逐字复制' },
        },
        required: ['requirement', 'quote'],
        additionalProperties: false,
      },
    },
    highlights: { type: 'string', description: '候选人亮点，1-2 句' },
    risks: { type: 'string', description: '风险提示，1-2 句' },
  },
  required: ['score', 'hits', 'misses', 'evidence', 'highlights', 'risks'],
  additionalProperties: false,
} as const;

export const EVALUATION_DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    scorecard: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dimension: { type: 'string', enum: ['技术能力', '工程素养', '沟通协作'] },
          score: { type: 'integer', description: '1-5 分' },
          comment: { type: 'string', description: '该维度的评分依据，1 句' },
        },
        required: ['dimension', 'score', 'comment'],
        additionalProperties: false,
      },
      description: '必须且只包含 技术能力/工程素养/沟通协作 三个维度',
    },
    conclusion: { type: 'string', enum: ['STRONG_YES', 'YES', 'NO', 'STRONG_NO'] },
    comments: { type: 'string', description: '综合评语草稿，100 字左右，客观中立' },
  },
  required: ['scorecard', 'conclusion', 'comments'],
  additionalProperties: false,
} as const;

export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: '基于文档的中文回答，简洁直接；文档无法回答时明确说明' },
  },
  required: ['answer'],
  additionalProperties: false,
} as const;

export const COMPARE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '3-5 句综合对比意见：谁更适合该岗位、关键差异是什么' },
    ranking: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          rank: { type: 'integer', description: '1 为最推荐' },
          rationale: { type: 'string', description: '一句话排名依据' },
        },
        required: ['name', 'rank', 'rationale'],
        additionalProperties: false,
      },
    },
    risks: { type: 'string', description: '决策风险提示（信息不足、维度缺失、偏差可能）' },
  },
  required: ['summary', 'ranking', 'risks'],
  additionalProperties: false,
} as const;

export const RETENTION_SCHEMA = {
  type: 'object',
  properties: {
    probability: { type: 'number', description: '0-1 之间的试用期留存概率估计' },
    factors: { type: 'array', items: { type: 'string' }, description: '2-4 条影响因素说明' },
  },
  required: ['probability', 'factors'],
  additionalProperties: false,
} as const;

export const INSIGHT_SCHEMA = {
  type: 'object',
  properties: {
    insight: { type: 'string', description: '一段 2-3 句的中文诊断结论，指出瓶颈并给出建议' },
  },
  required: ['insight'],
  additionalProperties: false,
} as const;
