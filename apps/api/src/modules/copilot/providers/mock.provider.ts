import type { ChatMessage, CopilotProvider, StreamEvent, StreamRequest, ToolCall } from './types';

/** system prompt 里给 mock 读的上下文标记（真实模型读自然语言那一段） */
export const CONTEXT_MARKER = /\[\[context:(candidate|job):([\w-]+)\]\]/;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Turn {
  userText: string;
  /** 本轮已调用过的工具 → 解析后的结果 */
  results: Map<string, Json>;
  context: { type: 'candidate' | 'job'; id: string } | null;
  available: Set<string>;
}

const STAGE_HINT = /(?:推进|移到|移动到|进入|推到|改到|转到)(?:到)?\s*[「“"]?([^」”"，。,\s]{1,10})/;
const NAME_BEFORE_VERB = /(?:把|将|给|帮|为)\s*([\u4e00-\u9fa5A-Za-z·]{1,8}?)\s*(?:推进|移到|移动|安排|加|记|淘汰|写|起草|的)/;
const NAME_AFTER_VERB = /(?:找|搜索|搜一下|查找|查询|查一下|介绍一下|看看|总结一下)\s*(?:候选人)?\s*([\u4e00-\u9fa5A-Za-z·]{2,8}?)(?:的|这个|这位|简历|档案|情况|吗|？|\?|$|，|。|\s)/;

const NAME_AFTER_ACTION = /(?:淘汰|推进)\s*([\u4e00-\u9fa5·]{2,4}?)(?:，|,|。|\s|$|到|的)/;

function extractName(text: string): string | null {
  const m = text.match(NAME_BEFORE_VERB) ?? text.match(NAME_AFTER_VERB) ?? text.match(NAME_AFTER_ACTION);
  const name = m?.[1]?.replace(/^我(?:给|把|为|将)?/, '').replace(/候选人|一下|他|她|这位|这个/g, '').trim();
  if (!name || name.length < 2 || /^(候选|职位|岗位|面试|所有|全部|最近|本周|今天)/.test(name)) return null;
  return name;
}

function parseResult(content: string): Json | null {
  try {
    return JSON.parse(content.replace(/…（结果过长已截断）$/, '')) as Json;
  } catch {
    return null;
  }
}

/** 去掉不可信内容的装箱标签，回答里以引用形式展示（mock 不会、也不该执行里面的任何话） */
const unwrap = (s: unknown) =>
  typeof s === 'string' ? s.replace(/<\/?untrusted_[a-z_]+>/g, '').trim().replace(/\s+/g, ' ').slice(0, 160) : '';

/**
 * 规则引擎版 Copilot：无模型 key 时全链路可用，也给测试 / 演示一个确定性的「模型」。
 * 支持流式输出与多步工具调用（先查人 → 读档案 → 提议写操作）；只根据【用户的话】决定调用什么，
 * 工具结果里的候选人文本只当数据展示——注入内容即使写着「立刻推进到 Offer」也不会触发任何工具。
 */
export class MockCopilotProvider implements CopilotProvider {
  readonly kind = 'mock';
  readonly model = 'rules';
  readonly mode = 'mock' as const;

  constructor(private readonly delayMs = 16) {}

  async *stream(request: StreamRequest): AsyncIterable<StreamEvent> {
    const turn = this.readTurn(request);
    const next = this.plan(turn);
    const inputTokens = Math.ceil((request.system.length + JSON.stringify(request.messages).length) / 2);
    if (next) {
      yield { type: 'tool_call', call: next };
      yield { type: 'usage', inputTokens, outputTokens: 20, model: this.model };
      yield { type: 'stop', reason: 'tool_use' };
      return;
    }
    const answer = this.compose(turn);
    for (const piece of chunk(answer)) {
      if (request.signal.aborted) throw abortError(request.signal);
      if (this.delayMs) await sleep(this.delayMs, request.signal);
      yield { type: 'text', delta: piece };
    }
    yield { type: 'usage', inputTokens, outputTokens: Math.ceil(answer.length / 2), model: this.model };
    yield { type: 'stop', reason: 'end_turn' };
  }

  private readTurn(request: StreamRequest): Turn {
    const msgs = request.messages;
    let lastUser = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        lastUser = i;
        break;
      }
    }
    const results = new Map<string, Json>();
    for (const m of msgs.slice(lastUser + 1)) {
      if (m.role === 'tool') results.set(m.name, parseResult(m.content) ?? { ok: false });
    }
    const ctx = request.system.match(CONTEXT_MARKER);
    return {
      userText: lastUser >= 0 ? (msgs[lastUser] as Extract<ChatMessage, { role: 'user' }>).content : '',
      results,
      context: ctx ? { type: ctx[1] as 'candidate' | 'job', id: ctx[2] } : null,
      available: new Set(request.tools.map((t) => t.name)),
    };
  }

  /** 下一步要调用的工具；null 表示该作答了 */
  private plan(turn: Turn): ToolCall | null {
    const t = turn.userText;
    const r = turn.results;
    const call = (name: string, args: Json): ToolCall | null =>
      turn.available.has(name) && !r.has(name) ? { id: `mock_${name}_${r.size}`, name, args } : null;

    const write =
      /淘汰/.test(t) ? 'reject_application'
      : /(写|起草|生成|草拟).{0,6}面评|面评草稿/.test(t) ? 'draft_evaluation'
      : /安排.{0,6}面试|约.{0,3}面试/.test(t) ? 'schedule_interview'
      : /备注|记一笔|记录一下/.test(t) ? 'add_candidate_note'
      : /推进|移到|移动到|推到|进入下一|转到/.test(t) ? 'move_candidate_stage'
      : null;

    const name = extractName(t);
    const wantsPerson = Boolean(write) || Boolean(name) || /候选人|简历|档案|怎么样|总结|介绍/.test(t);

    // 1) 确定是哪位候选人
    let candidateId: string | null = turn.context?.type === 'candidate' ? turn.context.id : null;
    if (wantsPerson && name && !(turn.context?.type === 'candidate' && !/找|搜|查/.test(t))) {
      const searched = r.get('search_candidates');
      if (!searched) {
        const next = call('search_candidates', { keyword: name, limit: 5 });
        if (next) return next;
      } else {
        candidateId = searched.data?.items?.[0]?.id ?? null;
      }
    }
    if (wantsPerson && candidateId) {
      if (!r.has('get_candidate')) {
        const next = call('get_candidate', { candidateId });
        if (next) return next;
      }
    }

    // 2) 写操作：只生成提议
    if (write && candidateId && !r.has(write)) {
      const profile = r.get('get_candidate')?.data;
      const app = (profile?.applications ?? []).find((a: Json) => a.status === 'ACTIVE') ?? profile?.applications?.[0];
      if (write === 'add_candidate_note') {
        const note = t.split(/[:：]/).slice(1).join('：').trim() || t.replace(/.*?(备注|记一笔|记录一下)/, '').trim() || t;
        return call(write, { candidateId, note: note.slice(0, 200) });
      }
      if (write === 'draft_evaluation') {
        const interviews: Json[] = (profile?.applications ?? []).flatMap((a: Json) => a.interviews ?? []);
        const target = [...interviews].sort((a, b) => (b.round ?? 0) - (a.round ?? 0))[0];
        if (!target) return null;
        const notes = t.split(/[:：]/).slice(1).join('：').trim() || t;
        return call(write, { interviewId: target.interviewId, notes: notes.slice(0, 500) });
      }
      if (!app) return null;
      if (write === 'move_candidate_stage') {
        const hinted = t.match(STAGE_HINT)?.[1];
        const stages: string[] = app.stages ?? [];
        const target =
          (hinted && stages.find((s) => s.includes(hinted) || hinted.includes(s))) ??
          stages[stages.indexOf(app.stage) + 1] ??
          hinted;
        if (!target) return null;
        return call(write, { applicationId: app.applicationId, targetStage: target });
      }
      if (write === 'schedule_interview') {
        const at = new Date(Date.now() + 86_400_000);
        at.setUTCHours(2, 0, 0, 0); // 次日北京时间 10:00
        return call(write, { applicationId: app.applicationId, scheduledAt: at.toISOString(), durationMins: 60 });
      }
      if (write === 'reject_application') {
        const reason = /经验/.test(t) ? '经验不足' : /薪资/.test(t) ? '薪资不匹配' : /失联/.test(t) ? '候选人失联' : '技能不符';
        return call(write, { applicationId: app.applicationId, reason });
      }
    }
    if (write) return null;

    // 3) 只读问题
    if (/面试/.test(t) && !/面评/.test(t)) {
      const next = call('upcoming_interviews', { days: /今天|明天/.test(t) ? 2 : 7 });
      if (next) return next;
    }
    if (/offer/i.test(t)) {
      const next = call('offer_status', name ? { keyword: name } : {});
      if (next) return next;
    }
    if (/待办|要做|todo/i.test(t)) {
      const next = call('my_todos', {});
      if (next) return next;
    }
    const jobId = turn.context?.type === 'job' ? turn.context.id : null;
    if (/制度|政策|年假|休假|考勤|报销|福利|公积金|社保/.test(t)) {
      const next = call('search_policies', { question: t.slice(0, 200) });
      if (next) return next;
    }
    if (/对比|比较/.test(t) && jobId) {
      if (!r.has('job_pipeline')) {
        const next = call('job_pipeline', { jobId });
        if (next) return next;
      }
      const ids = ((r.get('job_pipeline')?.data?.columns ?? []) as Json[])
        .flatMap((c) => c.longestWaiting ?? [])
        .filter((a: Json) => a.matchScore != null)
        .sort((a: Json, b: Json) => b.matchScore - a.matchScore)
        .slice(0, 3)
        .map((a: Json) => a.applicationId);
      if (ids.length >= 2) {
        const next = call('compare_candidates', { applicationIds: ids });
        if (next) return next;
      }
    }
    if (/诊断|原因|为什么/.test(t) && /漏斗|转化|流失/.test(t) && jobId) {
      const next = call('funnel_diagnosis', { jobId });
      if (next) return next;
    }
    if (/漏斗|转化|瓶颈|卡在/.test(t)) {
      if (!jobId && !r.has('list_jobs')) {
        const next = call('list_jobs', { status: 'OPEN' });
        if (next) return next;
      }
      const target = jobId ?? r.get('list_jobs')?.data?.items?.[0]?.id;
      const next = call('funnel_insights', target ? { jobId: target } : {});
      if (next) return next;
    }
    if (/看板|进展|进度|各阶段|多少人/.test(t) && (jobId || r.has('list_jobs'))) {
      const target = jobId ?? r.get('list_jobs')?.data?.items?.[0]?.id;
      if (target) {
        const next = call('job_pipeline', { jobId: target });
        if (next) return next;
      }
    }
    if (/职位|岗位|在招|招聘情况|HC/i.test(t) && !r.has('job_pipeline') && !r.has('funnel_insights')) {
      const next = call('list_jobs', {});
      if (next) return next;
    }
    if (/待初筛|新简历/.test(t)) {
      const next = call('search_candidates', { stage: 'screening', limit: 10 });
      if (next) return next;
    }
    if (/候选人|人选|简历/.test(t) && !candidateId && !r.size) {
      const next = call('search_candidates', { limit: 8 });
      if (next) return next;
    }
    // 4) 没有明确意图：按打开页面的上下文给一份概览
    if (!r.size && turn.context?.type === 'candidate') return call('get_candidate', { candidateId: turn.context.id });
    if (!r.size && jobId) return call('job_pipeline', { jobId });
    return null;
  }

  /** 由工具结果拼出最终回答（Markdown） */
  private compose(turn: Turn): string {
    const parts: string[] = [];
    let injection = false;
    const WRITES = ['move_candidate_stage', 'schedule_interview', 'add_candidate_note', 'draft_evaluation', 'reject_application'];
    const wrote = [...turn.results.keys()].some((k) => WRITES.includes(k));
    for (const [name, res] of turn.results) {
      if (res.injectionSuspected) injection = true;
      // 提议了写操作：回答只讲提议本身，查询过程留在折叠步骤里
      if (wrote && !WRITES.includes(name) && res.ok) continue;
      if (!res.ok) {
        parts.push(`- ${toolTitle(name)}没有成功：${res.error ?? '无权限或数据不存在'}`);
        continue;
      }
      const d = res.data ?? {};
      switch (name) {
        case 'search_candidates': {
          const items: Json[] = d.items ?? [];
          if (!items.length) {
            parts.push('在你的数据范围内没有找到匹配的候选人。');
            break;
          }
          parts.push(`找到 **${d.total}** 位候选人${d.total > items.length ? `（展示前 ${items.length} 位）` : ''}：`);
          const rows = items.map((c) => {
            const a = c.applications?.[0];
            return `| ${c.name} | ${a?.job ?? '—'} | ${a?.stage ?? '—'} | ${a?.matchScore ?? '—'} |`;
          });
          parts.push(['| 候选人 | 职位 | 阶段 | 匹配分 |', '| --- | --- | --- | --- |', ...rows].join('\n'));
          break;
        }
        case 'get_candidate': {
          const tags = (d.tags ?? []).slice(0, 6).join('、');
          parts.push(`### ${d.name}${tags ? `\n技能 / 标签：${tags}` : ''}`);
          const summary = unwrap(d.resume?.summary) || unwrap(d.resume?.excerpt);
          if (summary) parts.push(`> 简历摘要：${summary}`);
          for (const a of d.applications ?? []) {
            const evals = (a.interviews ?? []).flatMap((i: Json) => i.evaluations ?? []);
            const evalText = evals.length ? `，面评 ${evals.map((e: Json) => `${e.interviewer}：${e.conclusion ?? '—'}`).join('；')}` : '';
            parts.push(`- **${a.job}**：当前「${a.stage}」${a.matchScore != null ? `，匹配分 ${a.matchScore}` : ''}${evalText}${a.offer ? `，Offer ${a.offer.status}${a.offer.decision ? ` / ${a.offer.decision}` : ''}` : ''}`);
          }
          break;
        }
        case 'list_jobs': {
          const items: Json[] = d.items ?? [];
          parts.push(`共 **${d.total}** 个职位${items.length ? '：' : '。'}`);
          parts.push(items.slice(0, 8).map((j) => `- ${j.title}（${j.department ?? '—'}，${j.statusLabel ?? j.status}）· 应聘 ${j.applications} 人 · HC ${j.hcUsed}/${j.headcount}`).join('\n'));
          break;
        }
        case 'job_pipeline': {
          parts.push(`**${d.job?.title}** 看板：`);
          parts.push((d.columns ?? []).map((c: Json) => `- ${c.stage}：${c.count} 人${c.longestWaiting?.[0] ? `（停留最久：${c.longestWaiting[0].name}，${c.longestWaiting[0].daysInStage} 天）` : ''}`).join('\n'));
          break;
        }
        case 'upcoming_interviews': {
          const items: Json[] = d.items ?? [];
          parts.push(items.length ? `未来 ${d.days} 天有 **${items.length}** 场面试：` : `未来 ${d.days} 天没有已排期的面试。`);
          if (items.length) parts.push(items.slice(0, 10).map((i) => `- ${i.localTime} · ${i.candidate}（${i.job}，${i.roundLabel ?? `第 ${i.round} 轮`}）· 面试官 ${i.interviewers.join('、')}`).join('\n'));
          break;
        }
        case 'offer_status': {
          const items: Json[] = d.items ?? [];
          parts.push(items.length ? `Offer 状态（${items.length} 条）：` : '没有找到相关 Offer。');
          if (items.length) parts.push(items.slice(0, 10).map((o) => `- ${o.candidate}（${o.job}）：${o.status}${o.decision ? ` / ${o.decision}` : ''}`).join('\n'));
          break;
        }
        case 'funnel_insights': {
          if (d.overview) {
            const o = d.overview;
            parts.push(`整体概览：在招职位 **${o.openJobs}** 个，候选人 ${o.candidates} 位，待进行面试 ${o.upcomingInterviews} 场，已入职 ${o.hired} 人。`);
          } else {
            const stages: Json[] = d.stages ?? [];
            parts.push(`**${d.job?.title}** 招聘漏斗：`);
            parts.push(stages.map((s) => `- ${s.name}：到达 ${s.reached} 人${s.conversion != null ? `，转化 ${Math.round(s.conversion * 100)}%` : ''}`).join('\n'));
            const worst = stages.filter((s) => s.conversion != null).sort((a, b) => a.conversion - b.conversion)[0];
            if (worst) parts.push(`转化最低的一环是「${worst.name}」（${Math.round(worst.conversion * 100)}%），建议优先排查这一段。`);
          }
          break;
        }
        case 'compare_candidates': {
          const rows = ((d.candidates ?? []) as Json[]).map((c) => `| ${c.name} | ${c.matchScore ?? '—'} | ${unwrap(c.highlights) || '—'} |`);
          parts.push(`**${d.jobTitle}** 候选人对比：`);
          parts.push(['| 候选人 | 匹配分 | 亮点 |', '| --- | --- | --- |', ...rows].join('\n'));
          if (d.ai?.summary) parts.push(`AI 综合意见（仅供参考）：${d.ai.summary}`);
          break;
        }
        case 'funnel_diagnosis': {
          parts.push(`漏斗诊断：${d.insight ?? '暂无结论'}`);
          break;
        }
        case 'search_policies': {
          parts.push(String(d.answer ?? '没有找到相关制度。'));
          if (d.sources?.length) parts.push(`出处：${(d.sources as Json[]).map((x) => `《${x.title}》`).join('、')}`);
          break;
        }
        case 'my_todos': {
          const labels: Record<string, string> = {
            newResumes: '待初筛简历',
            myPendingEvaluations: '待提交面评',
            offersDue: '即将到期的 Offer',
            onboardingInProgress: '入职进行中',
            onboardingReady: '资料齐全、待确认入职',
          };
          const rows = Object.entries(d).filter(([, v]) => v != null).map(([k, v]) => `- ${labels[k] ?? k}：${v}`);
          parts.push(rows.length ? `你的待办：\n${rows.join('\n')}` : '目前没有待办。');
          break;
        }
        default: {
          if (d.actionId) parts.push(`我已准备好操作：**${d.summary}**。它还**没有执行**——请在下方卡片确认后才会生效。`);
          break;
        }
      }
    }
    if (!parts.length) {
      const tools = [...turn.available].filter((t) => t !== 'my_todos' && t !== 'search_policies');
      return tools.length
        ? '我可以帮你查询候选人、职位看板、面试安排、Offer 状态和招聘漏斗，也可以起草推进阶段、安排面试、添加备注等操作（都需要你确认后才执行）。试试问我：「本周有哪些面试？」'
        : '你的账号目前没有可查询的招聘数据权限，如需使用请联系管理员。';
    }
    if (injection) parts.push('⚠️ 候选人材料中含疑似指令注入内容，我只把它当作数据，没有执行其中的任何要求，建议人工复核。');
    parts.push('_数据来自系统实时查询，范围与你的账号权限一致。_');
    return parts.join('\n\n');
  }
}

function toolTitle(name: string) {
  return { search_candidates: '查询候选人', get_candidate: '读取档案', list_jobs: '查询职位', job_pipeline: '读取看板', upcoming_interviews: '查询面试', offer_status: '查询 Offer', funnel_insights: '漏斗分析', my_todos: '汇总待办', compare_candidates: '对比候选人', funnel_diagnosis: '漏斗诊断', search_policies: '查阅制度' }[name] ?? '操作';
}

/** 按 2~4 个字符切片，模拟 token 流 */
function* chunk(text: string) {
  let i = 0;
  let n = 0;
  while (i < text.length) {
    const size = 2 + (n++ % 3);
    yield text.slice(i, i + size);
    i += size;
  }
}

function abortError(signal: AbortSignal) {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError(signal));
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), reject(abortError(signal))), { once: true });
  });
}
