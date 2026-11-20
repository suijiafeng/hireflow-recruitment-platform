import { Segmented } from 'antd';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import type { ActivityItem } from '../api/types';
import { EmptyState } from './EmptyState';

export const ACTION_LABEL: Record<string, string> = {
  'job.created': '创建职位',
  'job.updated': '更新职位',
  'job.stages_updated': '调整招聘流程',
  'candidate.created': '录入候选人',
  'candidate.updated': '更新候选人',
  'resume.added': '导入简历',
  'resume.intake': '上传简历自动建档',
  'resume.parsed': 'AI 解析简历',
  'application.created': '加入职位流程',
  'application.reapplied': '重复投递',
  'application.reactivated': '重新激活应聘',
  'application.stage_changed': '阶段变更',
  'application.stage_reverted': '阶段回退',
  'application.rejected': '淘汰候选人',
  'application.withdrawn': '候选人撤回',
  'application.scored': 'AI 匹配评分',
  'application.candidates_compared': 'AI 候选人对比',
  'application.talent_pool_activated': '人才库唤醒激活',
  'job.talent_pool_scanned': '人才库扫描',
  'interview.scheduled': '安排面试',
  'interview.self_scheduled': '候选人自助选时',
  'interview.canceled': '取消面试',
  'evaluation.submitted': '提交面评',
  'evaluation.drafted': 'AI 生成面评草稿',
  'offer.initiated': '创建 Offer',
  'offer.sent': 'Offer 已发送',
  'offer.responded': '候选人答复 Offer',
  'offer.extended': 'Offer 答复期续期',
  'portal.link_rotated': '重新生成候选人页链接',
  'portal.link_revoked': '候选人页链接失效',
  'offer.expired': 'Offer 已过期失效',
  'onboarding.created': '创建入职单',
  'onboarding.completed': '确认入职',
  'onboarding.info_submitted': '候选人提交入职信息',
  'contract.created': '生成劳动合同',
  'contract.signed': '候选人确认合同',
  'webhook.fired': '自动化通知（Webhook）',
  'candidate.note_added': '添加备注',
  'copilot.action_executed': 'Copilot 执行操作',
  'copilot.action_rejected': 'Copilot 操作被取消',
  'copilot.action_failed': 'Copilot 操作失败',
  'job.deleted': '删除职位',
  'candidate.deleted': '删除候选人',
};

/** 由 AI 完成（或 AI 参与）的动作：时间轴上单独标记，可一键只看这些 */
const AI_ACTIONS = new Set([
  'resume.parsed',
  'application.scored',
  'evaluation.drafted',
  'application.candidates_compared',
  'job.talent_pool_scanned',
  'application.talent_pool_activated',
]);

const isCopilot = (item: ActivityItem) => item.action.startsWith('copilot.') || item.payload?.via === 'copilot';
const isAi = (item: ActivityItem) => AI_ACTIONS.has(item.action) || isCopilot(item);

const CONCLUSION: Record<string, string> = { STRONG_YES: '强烈推荐', YES: '推荐', NO: '不推荐', STRONG_NO: '强烈不推荐' };
const DECISION: Record<string, string> = { ACCEPTED: '接受', DECLINED: '拒绝' };

function actorLabel(item: ActivityItem) {
  const name = item.actor?.name ?? item.actorName ?? '系统';
  const trigger = item.payload?.triggeredBy;
  return !item.actor && typeof trigger === 'string' && trigger ? `${name} · 由 ${trigger} 触发` : name;
}

/** 每类动作的一行补充说明；返回 null 表示不显示 */
export function describe(item: ActivityItem): string | null {
  const p = item.payload ?? {};
  const str = (v: unknown) => (v == null ? '' : String(v));
  switch (item.action) {
    case 'application.stage_changed':
    case 'application.stage_reverted':
      return p.from || p.to ? `${str(p.from)} → ${str(p.to)}` : null;
    case 'application.scored':
      return `${str(p.job)} 匹配分 ${str(p.score)}${p.source === 'rule' ? '（规则引擎）' : ''}`;
    case 'resume.parsed': {
      const skills = Array.isArray(p.skills) ? (p.skills as string[]).slice(0, 6).join('、') : '';
      return skills ? `识别技能：${skills}${p.degraded ? '（降级为规则解析）' : ''}` : null;
    }
    case 'resume.intake': {
      const how = p.created ? '新建档案' : p.matchedBy === 'email' ? '按邮箱合并到原档案' : '按手机号合并到原档案';
      return `${str(p.fileName)} · 投递「${str(p.job)}」· ${how}`;
    }
    case 'evaluation.drafted':
      return `第 ${str(p.round)} 轮 · 建议「${CONCLUSION[str(p.conclusion)] ?? str(p.conclusion)}」（草稿，需面试官确认提交）`;
    case 'offer.responded':
      return p.decision ? `候选人${DECISION[str(p.decision)] ?? str(p.decision)}${p.reason ? `：${str(p.reason)}` : ''}` : null;
    case 'application.rejected':
      return p.reason ? `原因：${str(p.reason)}` : null;
    case 'interview.scheduled':
    case 'interview.self_scheduled':
      return p.scheduledAt ? `${p.round ? `第 ${str(p.round)} 轮 · ` : ''}${dayjs(str(p.scheduledAt)).format('MM-DD HH:mm')}` : null;
    case 'candidate.note_added':
      return str(p.note) || null;
    case 'copilot.action_executed':
    case 'copilot.action_rejected':
    case 'copilot.action_failed':
      return [str(p.summary), p.error ? `（${str(p.error)}）` : ''].join('') || null;
    default:
      return null;
  }
}

type Filter = 'all' | 'ai' | 'people';

export function ActivityTimeline({ items }: { items: ActivityItem[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const aiCount = useMemo(() => items.filter(isAi).length, [items]);
  const shown = filter === 'all' ? items : items.filter((i) => (filter === 'ai' ? isAi(i) : !isAi(i)));

  if (items.length === 0) {
    return <EmptyState size="sm" title="暂无操作记录" description="候选人的流转、面试、面评和 AI 操作会按时间记录在这里。" />;
  }
  return (
    <>
      <Segmented<Filter>
        className="hf-tl-filter"
        size="small"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: `全部 ${items.length}` },
          { value: 'ai', label: `AI ${aiCount}` },
          { value: 'people', label: `人工 ${items.length - aiCount}` },
        ]}
      />
      {shown.length === 0 && <div className="hf-faint">没有符合条件的记录</div>}
      {shown.map((item, i) => {
        const extra = describe(item);
        return (
          <div className="hf-tl" key={item.id ?? i} data-testid="timeline-item">
            <div className="hf-tl-rail">
              <span className={i === 0 ? 'hf-tl-dot hf-tl-dot--on' : 'hf-tl-dot'} />
              {i < shown.length - 1 && <span className="hf-tl-line" />}
            </div>
            <div className="hf-tl-body">
              <div className="hf-tl-head">
                <span className="hf-secondary hf-strong">{ACTION_LABEL[item.action] ?? item.action}</span>
                {isCopilot(item) ? (
                  <span className="hf-tl-badge hf-tl-badge--copilot">Copilot</span>
                ) : (
                  AI_ACTIONS.has(item.action) && <span className="hf-tl-badge">AI</span>
                )}
                {item.payload?.auto === true && <span className="hf-tl-badge hf-tl-badge--auto">自动</span>}
                <span className="hf-muted">{actorLabel(item)}</span>
                <span className="u-flex-1" />
                <span className="hf-faint hf-td--num">{dayjs(item.createdAt).format('MM-DD HH:mm')}</span>
              </div>
              {extra && <div className="hf-tl-extra">{extra}</div>}
            </div>
          </div>
        );
      })}
    </>
  );
}
