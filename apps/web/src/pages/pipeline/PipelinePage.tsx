import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppstoreOutlined,
  CheckSquareOutlined,
  ClockCircleOutlined,
  SwapOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { PERMISSIONS, REJECT_REASONS, STAGE_STAY_SLA } from '@hireflow/shared';
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Checkbox,
  Dropdown,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { AxiosError } from 'axios';
import dayjs from 'dayjs';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { applicationsApi, boardApi, candidatesApi, jobsApi } from '../../api';
import { extractErrorMessage } from '../../api/client';
import type { BatchResult, BoardCard, BoardData, CompareData } from '../../api/types';
import { CandidateDetailDrawer } from '../../components/CandidateDetailDrawer';
import { useDrawerParam } from '../../hooks/useUrlState';
import { useAuthStore } from '../../stores/auth';
import { pickDefaultJobId } from '../../utils/jobs';
import { FormModal } from '../../components/FormModal';
import { pressable } from '../../utils/pressable';

const cssVars = (v: Record<string, string | number>) => v as CSSProperties;

/** 乐观更新：在本地缓存里把卡片从旧列挪到新列尾部 */
function moveCardInBoard(board: BoardData, applicationId: string, stageId: string): BoardData {
  let moved: BoardCard | undefined;
  const stripped = board.columns.map((col) => {
    const hit = col.applications.find((a) => a.id === applicationId);
    if (hit) moved = { ...hit, stageId };
    return { ...col, applications: col.applications.filter((a) => a.id !== applicationId) };
  });
  if (!moved) return board;
  return {
    ...board,
    columns: stripped.map((col) =>
      col.stage.id === stageId ? { ...col, applications: [...col.applications, moved!] } : col,
    ),
  };
}

function scoreBand(score: number): string {
  if (score >= 85) return 'kanban-score-dot kanban-score-dot--high';
  if (score >= 70) return 'kanban-score-dot kanban-score-dot--mid';
  return 'kanban-score-dot kanban-score-dot--low';
}

const stayDays = (card: BoardCard) => dayjs().diff(dayjs(card.stageEnteredAt), 'day');
const isOverdue = (card: BoardCard) => stayDays(card) > STAGE_STAY_SLA.warnDays;

/**
 * 卡片纯视图：列表与 DragOverlay 复用同一渲染。
 * 信息密度：第一行「姓名 + 匹配分」，第二行「来源 · 日期 · 技能」点分单行，
 * 第三行只在超 SLA 时出现——正常卡片就是两行，一屏能多看一倍。
 */
function CardView({ card, overlay = false }: { card: BoardCard; overlay?: boolean }) {
  const days = stayDays(card);
  const meta = [
    card.candidate.source ?? '未知来源',
    dayjs(card.createdAt).format('MM-DD'),
    card.candidate.tags.slice(0, 3).join(' · '),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Card
      size="small"
      className={overlay ? 'kanban-card kanban-card--overlay' : 'kanban-card'}
      classNames={{ body: 'kanban-card-body' }}
    >
      <div className="u-flex-between">
        <span className="kanban-card-name">{card.candidate.name}</span>
        {card.matchScore != null && (
          <Tooltip title={`AI 匹配分 ${card.matchScore}（≥85 优，≥70 良）`}>
            <span className="kanban-score">
              <span className={scoreBand(card.matchScore)} />
              {card.matchScore}
            </span>
          </Tooltip>
        )}
      </div>
      <div className="kanban-card-meta">{meta}</div>
      {card.prescreen && (
        <Tooltip
          title={
            card.prescreen.flags.length
              ? card.prescreen.flags.join('；')
              : `期望 ¥${card.prescreen.expectedSalary.toLocaleString()} · ${card.prescreen.availableDate} 可到岗`
          }
        >
          <span className={card.prescreen.flags.length ? 'hf-tag hf-tag--warn' : 'hf-tag hf-tag--ok'}>
            {card.prescreen.flags.length ? `预筛 ${card.prescreen.flags.length} 项不符` : '预筛符合'}
          </span>
        </Tooltip>
      )}
      {/* 看板只会出现 ACTIVE 与 HIRED 两种卡；终态卡片不参与流转，也不再算停留时长 */}
      {card.status !== 'ACTIVE' && <div className="kanban-card-meta">已入职 · 流程已完成</div>}
      {card.status === 'ACTIVE' && days > STAGE_STAY_SLA.warnDays && (
        <div className={days > STAGE_STAY_SLA.dangerDays ? 'kanban-stay kanban-stay--danger' : 'kanban-stay'}>
          <ClockCircleOutlined />
          停留 {days} 天
        </div>
      )}
    </Card>
  );
}

/** 由业务事件自动流转、不能直接拖入的阶段（后端同样拒绝）：拖动时置灰并说明原因 */
const AUTO_ONLY_STAGES: Record<string, string> = {
  待入职: '候选人接受 Offer 后自动进入',
  已入职: '入职流程闭环后自动进入',
};

type StageRef = { id: string; name: string; order: number };

/** 卡片从 from 移到 to 是否被禁止；返回原因或 null（回退不受限，走填写原因流程） */
function blockedMove(from: StageRef | undefined, to: StageRef): string | null {
  if (!from || to.id === from.id) return null;
  if (to.order > from.order && AUTO_ONLY_STAGES[to.name]) return AUTO_ONLY_STAGES[to.name];
  return null;
}

function DraggableCard({
  card,
  disabled,
  onOpen,
  stages,
  onMoveTo,
}: {
  card: BoardCard;
  disabled: boolean;
  onOpen: (candidateId: string) => void;
  stages: StageRef[];
  onMoveTo: (card: BoardCard, stageId: string) => void;
}) {
  // 已入职是终态：卡片留在末列可见，但后端拒绝再流转（moveStage 只放行 ACTIVE），所以这里也不给拖
  const locked = disabled || card.status !== 'ACTIVE';
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id, disabled: locked });
  const cls = ['drag-source', locked ? 'drag-source--readonly' : '', isDragging ? 'drag-source--dragging' : '']
    .filter(Boolean)
    .join(' ');
  const current = stages.find((st) => st.id === card.stageId);
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (!isDragging) onOpen(card.candidate.id);
      }}
      // 卡片可 Tab 聚焦（dnd-kit 已给 tabIndex），Enter 打开详情
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(card.candidate.id);
      }}
      className={cls}
    >
      <CardView card={card} />
      {/* 拖拽之外的移动方式：键盘 / 触控板用户也能流转；与拖拽走同一套校验（回退填原因、自动阶段不可直接进） */}
      {!locked && (
        // 下拉菜单渲染在 portal 里，但 React 事件仍沿组件树冒泡回卡片：
        // 不在这里截住，菜单项上的按下会被卡片的拖拽监听接管、点击被吞，真实鼠标点了没反应
        <span
          className="kanban-card-move-wrap"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
        <Dropdown
          trigger={['click']}
          menu={{
            items: stages
              .filter((st) => st.id !== card.stageId)
              .map((st) => {
                const blocked = blockedMove(current, st);
                return {
                  key: st.id,
                  label: blocked ? `${st.name}（${blocked}）` : st.name,
                  disabled: Boolean(blocked),
                };
              }),
            onClick: ({ key, domEvent }) => {
              domEvent.stopPropagation();
              onMoveTo(card, key);
            },
          }}
        >
          <button
            type="button"
            className="kanban-card-move"
            aria-label={`移动「${card.candidate.name}」到其他阶段`}
            title="移动到…"
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <SwapOutlined />
          </button>
        </Dropdown>
        </span>
      )}
    </div>
  );
}

function SelectableCard({
  card,
  checked,
  onToggle,
}: {
  card: BoardCard;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div {...pressable(() => onToggle(card.id))} className="select-card">
      <div className="select-card-check">
        <Checkbox checked={checked} onChange={() => onToggle(card.id)} onClick={(e) => e.stopPropagation()} />
      </div>
      <div className={checked ? 'select-card-frame select-card-frame--on' : 'select-card-frame'}>
        <CardView card={card} />
      </div>
    </div>
  );
}

function BoardColumnView({
  stage,
  cards,
  maxCount,
  dragDisabled,
  onOpen,
  batchMode,
  selected,
  onToggle,
  onToggleColumn,
  blockedReason,
  stages,
  onMoveTo,
}: {
  stage: { id: string; name: string };
  /** 正在拖的卡片不能放进本列时的原因；拖动期间置灰并提示 */
  blockedReason: string | null;
  stages: StageRef[];
  onMoveTo: (card: BoardCard, stageId: string) => void;
  cards: BoardCard[];
  maxCount: number;
  dragDisabled: boolean;
  onOpen: (candidateId: string) => void;
  batchMode: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleColumn: (ids: string[], select: boolean) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, disabled: batchMode || Boolean(blockedReason) });
  // 批量操作只对在途卡片有意义：已入职是终态，后端的批量移动/淘汰都会拒绝它
  const actionable = cards.filter((c) => c.status === 'ACTIVE');
  const selectedInColumn = cards.filter((c) => selected.has(c.id)).length;
  const overdue = cards.filter((c) => c.status === 'ACTIVE' && isOverdue(c)).length;
  const pct = maxCount > 0 ? Math.round((cards.length / maxCount) * 100) : 0;
  return (
    <div
      ref={setNodeRef}
      className={['kanban-col', isOver ? 'kanban-col--over' : '', blockedReason ? 'kanban-col--blocked' : '']
        .filter(Boolean)
        .join(' ')}
    >
      {blockedReason && <div className="kanban-col-blocked-hint">不能直接拖入：{blockedReason}</div>}
      <div className="kanban-col-head">
        <div className="kanban-col-headrow">
          {batchMode && actionable.length > 0 && (
            <Checkbox
              checked={selectedInColumn === actionable.length}
              indeterminate={selectedInColumn > 0 && selectedInColumn < actionable.length}
              onChange={(e) =>
                onToggleColumn(
                  actionable.map((c) => c.id),
                  e.target.checked,
                )
              }
            />
          )}
          <span className="kanban-col-title">{stage.name}</span>
          <Badge count={cards.length} className="kanban-badge" showZero />
          {overdue > 0 && <span className="kanban-col-alert">{overdue} 超时</span>}
        </div>
        {/* 阶段人数占比条：一眼看出流程堆在哪一段 */}
        <div className="kanban-col-bar">
          <i style={cssVars({ '--w': `${pct}%` })} />
        </div>
      </div>
      <div className="kanban-col-scroll">
        {cards.map((card) =>
          batchMode && card.status === 'ACTIVE' ? (
            <SelectableCard key={card.id} card={card} checked={selected.has(card.id)} onToggle={onToggle} />
          ) : (
            <DraggableCard
              key={card.id}
              card={card}
              disabled={dragDisabled || batchMode}
              onOpen={onOpen}
              stages={stages}
              onMoveTo={onMoveTo}
            />
          ),
        )}
        {cards.length === 0 && <div className="kanban-col-empty">拖拽候选人到此阶段</div>}
      </div>
    </div>
  );
}

/** 候选人对比（V2 页面清单）：2-4 人并排 + AI 综合意见；AI 是辅助，终审在人 */
function CompareModal({ data, loading, onClose }: { data: CompareData | null; loading: boolean; onClose: () => void }) {
  const CONCLUSION_TEXT: Record<string, string> = {
    STRONG_YES: '强烈推荐',
    YES: '推荐',
    NO: '不推荐',
    STRONG_NO: '强烈不推荐',
  };
  return (
    <Modal
      className="hf-modal"
      title={data ? `候选人对比 · ${data.jobTitle}` : 'AI 正在对比…'}
      open={loading || Boolean(data)}
      onCancel={onClose}
      footer={null}
      width={Math.min(320 * (data?.candidates.length ?? 2) + 80, 1200)}
      classNames={{ body: 'modal-body-scroll' }}
      destroyOnHidden
    >
      {loading || !data ? (
        <div className="loading-center loading-center--lg">
          <Spin description="AI 正在汇总匹配分与面评数据…" />
        </div>
      ) : (
        <>
          <div className="compare-cols">
            {data.candidates.map((c) => {
              const rank = data.ai.ranking.find((r) => r.name === c.name)?.rank;
              return (
                <Card
                  key={c.applicationId}
                  size="small"
                  className={rank === 1 ? 'compare-card compare-card--top' : 'compare-card'}
                  title={
                    <Space>
                      {c.name}
                      {rank === 1 && <Tag color="processing">AI 首推</Tag>}
                    </Space>
                  }
                >
                  <p className="compare-line">
                    匹配分：
                    {c.matchScore != null ? (
                      <Tag color={c.matchScore >= 85 ? 'success' : c.matchScore >= 70 ? 'processing' : 'default'}>
                        {c.matchScore}
                      </Tag>
                    ) : (
                      '未评分'
                    )}
                  </p>
                  <div className="u-mb-4">
                    {c.tags.slice(0, 4).map((t) => (
                      <Tag key={t} className="tag-meta">
                        {t}
                      </Tag>
                    ))}
                  </div>
                  {c.highlights && (
                    <Typography.Paragraph className="u-meta u-mb-4" ellipsis={{ rows: 3 }}>
                      {c.highlights}
                    </Typography.Paragraph>
                  )}
                  <div className="u-meta">
                    面评：
                    {c.evaluations.length === 0 ? (
                      <span className="u-muted">暂无</span>
                    ) : (
                      c.evaluations.map((e, i) => (
                        <Tag key={i} color={e.conclusion?.includes('YES') ? 'success' : 'warning'} className="tag-meta">
                          {CONCLUSION_TEXT[e.conclusion ?? ''] ?? '无结论'}
                          {e.avgScore != null ? ` ${e.avgScore}分` : ''}
                        </Tag>
                      ))
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
          <Alert
            type="info"
            showIcon
            title={`AI 综合意见（${data.aiMeta.provider}${data.aiMeta.degraded ? '·降级' : ''}，仅供参考，终审权在用人经理）`}
            description={
              <>
                <Typography.Paragraph className="u-mb-8">{data.ai.summary}</Typography.Paragraph>
                <ol className="plain-ol">
                  {data.ai.ranking
                    .slice()
                    .sort((a, b) => a.rank - b.rank)
                    .map((r) => (
                      <li key={r.name}>
                        <b>{r.name}</b> — {r.rationale}
                      </li>
                    ))}
                </ol>
                <Typography.Text type="secondary" className="u-meta u-block u-mt-8">
                  风险提示：{data.ai.risks}
                </Typography.Text>
              </>
            }
          />
        </>
      )}
    </Modal>
  );
}

interface PendingMove {
  applicationId: string;
  stageId: string;
  expectedVersion: number;
  candidateName: string;
  fromStage: string;
  toStage: string;
}

export function PipelinePage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [searchParams, setSearchParams] = useSearchParams();
  const jobId = searchParams.get('jobId') ?? '';
  const [detailId, openDetail, closeDetail] = useDrawerParam('candidate');
  const [activeCard, setActiveCard] = useState<BoardCard | null>(null);
  const [pendingRevert, setPendingRevert] = useState<PendingMove | null>(null);
  const [revertForm] = Form.useForm();
  // 批量操作：选择态仅存前端，切换职位/退出批量即清空
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchRejectOpen, setBatchRejectOpen] = useState(false);
  const [batchMoveOpen, setBatchMoveOpen] = useState(false);
  const [batchRejectForm] = Form.useForm<{ reason: string; note?: string }>();
  const [batchMoveForm] = Form.useForm<{ stageId: string; reason?: string }>();

  const jobsQuery = useQuery({
    queryKey: ['jobs', 'options'],
    queryFn: () => jobsApi.list({ page: 1, pageSize: 100 }),
  });

  useEffect(() => {
    if (jobId) return;
    const preferred = pickDefaultJobId(jobsQuery.data?.items);
    if (preferred) setSearchParams({ jobId: preferred }, { replace: true });
  }, [jobId, jobsQuery.data, setSearchParams]);

  // 切换职位即清空批量选择态：否则勾选的是 A 职位的候选人，操作却在 B 职位看板上下文触发
  useEffect(() => {
    setBatchMode(false);
    setSelected(new Set());
  }, [jobId]);

  const boardQuery = useQuery({
    queryKey: ['board', jobId],
    queryFn: () => boardApi.get(jobId),
    enabled: Boolean(jobId),
  });

  const moveMutation = useMutation({
    mutationFn: (vars: {
      applicationId: string;
      stageId: string;
      reason?: string;
      expectedVersion?: number;
      /** 向前移动时携带，用于成功提示里的「撤销」 */
      undo?: { fromStageId: string; fromStageName: string; toStageName: string };
    }) =>
      boardApi.moveCard(vars.applicationId, {
        stageId: vars.stageId,
        reason: vars.reason,
        expectedVersion: vars.expectedVersion,
      }),
    onMutate: async ({ applicationId, stageId }) => {
      await queryClient.cancelQueries({ queryKey: ['board', jobId] });
      const previous = queryClient.getQueryData<BoardData>(['board', jobId]);
      if (previous) {
        queryClient.setQueryData(['board', jobId], moveCardInBoard(previous, applicationId, stageId));
      }
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['board', jobId], context.previous);
      const status = (error as AxiosError)?.response?.status;
      if (status === 409) {
        message.warning('该卡片刚被他人移动，看板已自动刷新');
      } else {
        message.error(extractErrorMessage(error, '移动卡片失败'));
      }
    },
    onSuccess: (updated, vars) => {
      // 回退（带原因）不再给撤销；向前移动给 6 秒撤销窗口，拖错了不必去写「回退原因」
      if (vars.reason || !vars.undo) return;
      const { fromStageId, fromStageName, toStageName } = vars.undo;
      const key = `move-${vars.applicationId}`;
      message.open({
        key,
        type: 'success',
        duration: 6,
        content: (
          <span>
            已移至「{toStageName}」
            <a
              className="u-ml-8"
              onClick={() => {
                message.destroy(key);
                moveMutation.mutate({
                  applicationId: vars.applicationId,
                  stageId: fromStageId,
                  // 后端规定回退必须留痕：撤销自动带上原因，审计里看得到这是一次即时撤回
                  reason: `撤销误操作：从「${toStageName}」撤回「${fromStageName}」`,
                  expectedVersion: updated.version,
                });
              }}
            >
              撤销
            </a>
          </span>
        ),
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['board', jobId] }),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const canMove = hasPermission(PERMISSIONS.APPLICATION_MOVE);

  const exitBatch = () => {
    setBatchMode(false);
    setSelected(new Set());
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleColumn = (ids: string[], select: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (select ? next.add(id) : next.delete(id)));
      return next;
    });
  };

  /** 批量结果反馈：全部成功报数字；部分失败弹错误报告 */
  const reportBatch = (result: BatchResult, verb: string) => {
    void queryClient.invalidateQueries({ queryKey: ['board', jobId] });
    setSelected(new Set());
    if (result.failed.length === 0) {
      message.success(`${verb}成功 ${result.succeeded} 人`);
      return;
    }
    modal.warning({
      title: `${verb}完成：成功 ${result.succeeded} / ${result.total} 人`,
      width: 520,
      content: (
        <ul className="batch-fail-list">
          {result.failed.map((f) => (
            <li key={f.id}>
              <b>{f.candidate ?? f.id}</b>：{f.error}
            </li>
          ))}
        </ul>
      ),
    });
  };

  const batchRejectMutation = useMutation({
    mutationFn: (values: { reason: string; note?: string }) => boardApi.batchReject({ ids: [...selected], ...values }),
    onSuccess: (result) => {
      setBatchRejectOpen(false);
      batchRejectForm.resetFields();
      reportBatch(result, '淘汰');
    },
    onError: (error) => message.error(extractErrorMessage(error, '批量淘汰失败')),
  });

  const batchMoveMutation = useMutation({
    mutationFn: (values: { stageId: string; reason?: string }) =>
      boardApi.batchMove({ ids: [...selected], stageId: values.stageId, reason: values.reason || undefined }),
    onSuccess: (result) => {
      setBatchMoveOpen(false);
      batchMoveForm.resetFields();
      reportBatch(result, '移动');
    },
    onError: (error) => message.error(extractErrorMessage(error, '批量移动失败')),
  });

  /**
   * 添加候选人：把库里已有的候选人加进当前职位流程。
   * 后端 applications.create 会自动落到该职位的首个阶段并留痕，前端不用自己指定 stageId。
   * 已在本职位流程中的人要从候选列表里滤掉——重复投递后端会 409，让用户点了才报错是不礼貌的。
   */
  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm<{ candidateId: string }>();
  const [addKeyword, setAddKeyword] = useState('');

  const addCandidatesQuery = useQuery({
    queryKey: ['candidates', 'pipeline-add', addKeyword],
    queryFn: () => candidatesApi.list({ page: 1, pageSize: 50, keyword: addKeyword || undefined }),
    enabled: addOpen,
  });

  const inFlowIds = new Set(
    boardQuery.data?.columns.flatMap((c) => c.applications.map((a) => a.candidate.id)) ?? [],
  );
  const addOptions = (addCandidatesQuery.data?.items ?? [])
    .filter((c) => !inFlowIds.has(c.id))
    .map((c) => {
      // 同名候选人很常见：第二行给联系方式与录入日期，才分得清是哪一位
      const contact = c.email || (c.phone ? `尾号 ${c.phone.slice(-4)}` : '');
      const meta = [contact, c.source, c.tags.slice(0, 3).join('/'), `${dayjs(c.createdAt).format('YYYY-MM-DD')} 录入`]
        .filter(Boolean)
        .join(' · ');
      return { value: c.id, label: c.name, meta };
    });

  const addMutation = useMutation({
    mutationFn: (values: { candidateId: string }) =>
      applicationsApi.create({ candidateId: values.candidateId, jobId }),
    onSuccess: (data) => {
      // 该候选人此前在本职位被淘汰/撤回时，后端复活的是原记录（唯一键不允许再建一条），说清楚免得以为是新人
      message.success(
        data.revived
          ? '该候选人此前在本职位已淘汰，已复活原应聘记录并回到首个阶段'
          : '已加入本职位流程，卡片落在首个阶段',
      );
      setAddOpen(false);
      addForm.resetFields();
      setAddKeyword('');
      void queryClient.invalidateQueries({ queryKey: ['board', jobId] });
      void queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
    onError: (error) => message.error(extractErrorMessage(error, '加入失败')),
  });

  const [compareData, setCompareData] = useState<CompareData | null>(null);
  const compareMutation = useMutation({
    mutationFn: () => applicationsApi.compare([...selected]),
    onSuccess: setCompareData,
    onError: (error) => message.error(extractErrorMessage(error, '对比失败')),
  });

  /** 发预筛链接（选中恰 1 人时可用；V2 1.2 邀约前核实硬性条件） */
  const sendPrescreen = async () => {
    const id = [...selected][0];
    try {
      const { token } = await applicationsApi.prescreenLink(id);
      const url = `${window.location.origin}/portal/prescreen/${token}`;
      try {
        await navigator.clipboard.writeText(url);
        message.success('预筛链接已复制，请发送给候选人（薪资/到岗/出差三问）');
      } catch {
        modal.info({
          title: '候选人预筛链接',
          content: (
            <Typography.Text copyable className="u-break-all">
              {url}
            </Typography.Text>
          ),
        });
      }
    } catch (error) {
      message.error(extractErrorMessage(error, '获取链接失败'));
    }
  };

  const findCard = (id: string) => boardQuery.data?.columns.flatMap((c) => c.applications).find((a) => a.id === id);

  const onDragStart = (event: DragStartEvent) => {
    setActiveCard(findCard(String(event.active.id)) ?? null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveCard(null);
    const { active, over } = event;
    if (!over) return;
    const card = findCard(String(active.id));
    if (card) requestMove(card, String(over.id));
  };

  /** 拖拽与「移动到…」菜单共用：自动阶段拦截 → 回退填原因 → 向前直接移动（带撤销） */
  const requestMove = (card: BoardCard, targetStageId: string) => {
    if (!boardQuery.data || card.stageId === targetStageId) return;
    const applicationId = card.id;
    const fromCol = boardQuery.data.columns.find((c) => c.stage.id === card.stageId);
    const toCol = boardQuery.data.columns.find((c) => c.stage.id === targetStageId);
    if (!fromCol || !toCol) return;

    const blocked = blockedMove(fromCol.stage, toCol.stage);
    if (blocked) {
      message.info(`「${toCol.stage.name}」${blocked}，不能手动移入`);
      return;
    }

    // 受控回退：向后拖必须填写原因
    if (toCol.stage.order < fromCol.stage.order) {
      setPendingRevert({
        applicationId,
        stageId: targetStageId,
        expectedVersion: card.version,
        candidateName: card.candidate.name,
        fromStage: fromCol.stage.name,
        toStage: toCol.stage.name,
      });
      return;
    }
    moveMutation.mutate({
      applicationId,
      stageId: targetStageId,
      expectedVersion: card.version,
      undo: { fromStageId: fromCol.stage.id, fromStageName: fromCol.stage.name, toStageName: toCol.stage.name },
    });
  };

  // 控制栏概览：总在流程人数 / 本周新增 / 超 SLA 停留
  const allCards = boardQuery.data?.columns.flatMap((c) => c.applications) ?? [];
  const weekAgo = dayjs().subtract(7, 'day');
  const summary = {
    total: allCards.length,
    fresh: allCards.filter((c) => dayjs(c.createdAt).isAfter(weekAgo)).length,
    overdue: allCards.filter(isOverdue).length,
  };
  const maxCount = Math.max(...(boardQuery.data?.columns.map((c) => c.applications.length) ?? [0]), 1);

  const jobOptions = jobsQuery.data?.items.map((j) => ({
    value: j.id,
    label: `${j.title}（${j.department.name}）`,
  }));

  return (
    <div className="pipeline-page">
      {/* 控制栏：职位上下文 + 流程概览 + 操作，一条解决（页标题已在面包屑，不再重复） */}
      {batchMode ? (
        <div className="pipeline-bar pipeline-bar--batch">
          <Space size={14} align="center">
            <Space size={8}>
              <span className="batch-count">{selected.size}</span>
              <b>已选 {selected.size} 人</b>
            </Space>
            <span className="batch-hint">点卡片或列头复选框继续选择</span>
          </Space>
          <Space size={8}>
            <Button size="small" type="primary" disabled={selected.size === 0} onClick={() => setBatchMoveOpen(true)}>
              批量移动
            </Button>
            <Button
              size="small"
              icon={<RobotOutlined />}
              disabled={selected.size < 2 || selected.size > 4}
              loading={compareMutation.isPending}
              onClick={() => compareMutation.mutate()}
            >
              AI 对比
            </Button>
            <Button size="small" disabled={selected.size !== 1} onClick={() => void sendPrescreen()}>
              预筛链接
            </Button>
            <Button size="small" danger disabled={selected.size === 0} onClick={() => setBatchRejectOpen(true)}>
              批量淘汰
            </Button>
            <Button size="small" type="text" onClick={exitBatch}>
              退出
            </Button>
          </Space>
        </div>
      ) : (
        <div className="pipeline-bar">
          <div className="pipeline-bar-left">
            <Select
              variant="outlined"
              className="w-260"
              placeholder="选择职位"
              loading={jobsQuery.isLoading}
              value={jobId || undefined}
              onChange={(value) => setSearchParams({ jobId: value })}
              options={jobOptions}
            />
            {boardQuery.data && (
              <div className="pipeline-bar-summary">
                <span>
                  在流程 <b>{summary.total}</b> 人
                </span>
                <span className="sep" />
                <span>
                  本周新增 <b>{summary.fresh}</b>
                </span>
                {summary.overdue > 0 && (
                  <>
                    <span className="sep" />
                    <span className="warn">
                      <ClockCircleOutlined />
                      超时停留 <b>{summary.overdue}</b>
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
          <Space size={8}>
            {!canMove && <span className="pipeline-readonly-tip">仅查看</span>}
            {canMove && (
              <Button icon={<CheckSquareOutlined />} onClick={() => setBatchMode(true)}>
                批量操作
              </Button>
            )}
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!jobId || !hasPermission(PERMISSIONS.APPLICATION_CREATE)}
              onClick={() => setAddOpen(true)}
            >
              添加候选人
            </Button>
          </Space>
        </div>
      )}

      {/* 看板区域：无外层卡片壳，白面板 + 发丝分栏，列宽自适应铺满 */}
      <Card className="kanban-board-card" variant="borderless">
        {/* 分支顺序：错误 → 无职位 → 数据未到 → 数据为空 → 看板。
            「数据未到」必须单独一档：query 处于 pending/paused（加载中、离线暂停、重试退避）
            时 data 也是 undefined，若并进空状态就会对用户断言「这个职位还没有候选人」——
            实际上一条都没读到，这是在报假数据。 */}
        {boardQuery.isError ? (
          <div className="state-block">
            <div className="state-icon state-icon--warn">
              <WarningOutlined />
            </div>
            <div>
              <div className="state-title">看板数据加载失败</div>
              <div className="state-desc">
                {extractErrorMessage(boardQuery.error, '服务暂时无响应')}。已保留上一次的本地缓存，重试不会丢失未提交的操作。
              </div>
            </div>
            <div className="state-actions">
              <Button
                type="primary"
                icon={<ReloadOutlined />}
                loading={boardQuery.isFetching}
                onClick={() => void boardQuery.refetch()}
              >
                重试
              </Button>
            </div>
            <div className="state-trace">请求时间 {dayjs().format('HH:mm:ss')}</div>
          </div>
        ) : !jobId ? (
          jobsQuery.isLoading ? (
            <div className="state-block">
              <Spin />
            </div>
          ) : (
            <div className="state-block">
              <div className="state-icon">
                <AppstoreOutlined />
              </div>
              <div>
                <div className="state-title">还没有可用的职位</div>
                <div className="state-desc">先在「职位管理」创建职位并配置流程阶段，看板才有可流转的候选人。</div>
              </div>
              <div className="state-actions">
                <Button type="primary" href="/jobs">
                  创建职位
                </Button>
              </div>
            </div>
          )
        ) : !boardQuery.data ? (
          <div className="state-block">
            <Spin />
          </div>
        ) : boardQuery.data.columns.every((c) => c.applications.length === 0) ? (
          <div className="state-block">
            <div className="state-icon">
              <AppstoreOutlined />
            </div>
            <div>
              {/* 招过但全被淘汰 ≠ 从没招过人：前者说「还没有候选人」会让人以为数据丢了 */}
              <div className="state-title">
                {boardQuery.data.closedCount > 0 ? '这个职位当前没有在途候选人' : '这个职位还没有候选人'}
              </div>
              <div className="state-desc">
                {boardQuery.data.closedCount > 0
                  ? `历史上有 ${boardQuery.data.closedCount} 位候选人已淘汰或撤回（不进看板，可在候选人详情的时间轴里查看）。继续导入简历或从人才库唤醒。`
                  : '导入简历或从人才库唤醒历史候选人，卡片会自动进入首个阶段。'}
              </div>
            </div>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setActiveCard(null)}
          >
            <div className="kanban-board">
              {boardQuery.data.columns.map((column) => (
                <BoardColumnView
                  key={column.stage.id}
                  stage={column.stage}
                  cards={column.applications}
                  maxCount={maxCount}
                  dragDisabled={!canMove || batchMode}
                  onOpen={openDetail}
                  batchMode={batchMode}
                  selected={selected}
                  onToggle={toggleSelected}
                  onToggleColumn={toggleColumn}
                  stages={boardQuery.data!.columns.map((c) => c.stage)}
                  onMoveTo={requestMove}
                  blockedReason={
                    activeCard
                      ? blockedMove(
                          boardQuery.data!.columns.find((c) => c.stage.id === activeCard.stageId)?.stage,
                          column.stage,
                        )
                      : null
                  }
                />
              ))}
            </div>
            {/* 拖拽浮层：脱离列容器渲染，修复卡片被 overflow 裁剪/异常位移的问题 */}
            <DragOverlay dropAnimation={null}>
              {activeCard ? (
                <div className="drag-overlay-card">
                  <CardView card={activeCard} overlay />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </Card>

      <FormModal form={revertForm}
        className="hf-modal"
        title="回退阶段需填写原因"
        open={Boolean(pendingRevert)}
        onCancel={() => {
          setPendingRevert(null);
          revertForm.resetFields();
        }}
        onOk={() => revertForm.submit()}
        confirmLoading={moveMutation.isPending}
        destroyOnHidden
      >
        {pendingRevert && (
          <Typography.Paragraph>
            将「{pendingRevert.candidateName}」从 <Tag>{pendingRevert.fromStage}</Tag> 回退到{' '}
            <Tag>{pendingRevert.toStage}</Tag>，回退操作仅 HR 可执行且全程留痕。
          </Typography.Paragraph>
        )}
        <Form
          form={revertForm}
          layout="vertical"
          onFinish={(values: { reason: string }) => {
            if (!pendingRevert) return;
            moveMutation.mutate(
              { ...pendingRevert, reason: values.reason },
              {
                onSuccess: () => {
                  setPendingRevert(null);
                  revertForm.resetFields();
                  message.success('已回退并留痕');
                },
              },
            );
          }}
        >
          <Form.Item
            name="reason"
            label="回退原因"
            rules={[{ required: true, min: 2, message: '请填写回退原因（至少 2 个字）' }]}
          >
            <Input.TextArea rows={3} placeholder="如：二面评价存在分歧，需重新安排一面补充考察" />
          </Form.Item>
        </Form>
      </FormModal>

      {/* 批量淘汰：破坏性操作显示影响人数 */}
      <FormModal form={batchRejectForm}
        className="hf-modal"
        title={`批量淘汰 ${selected.size} 人`}
        open={batchRejectOpen}
        onCancel={() => setBatchRejectOpen(false)}
        onOk={() => batchRejectForm.submit()}
        okText={`确认淘汰 ${selected.size} 人`}
        okButtonProps={{ danger: true }}
        confirmLoading={batchRejectMutation.isPending}
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          className="u-mb-16"
          title="淘汰为终态操作，不可逆"
          description="每人独立留痕；原因码将用于漏斗分析与人才库回流。感谢信通道接入后将按防呆规则延迟 3 天发送。"
        />
        <Form form={batchRejectForm} layout="vertical" onFinish={(v) => batchRejectMutation.mutate(v)}>
          <Form.Item
            name="reason"
            label="淘汰原因码（应用于全部所选）"
            rules={[{ required: true, message: '请选择原因码' }]}
          >
            <Select placeholder="选择原因" options={REJECT_REASONS.map((r) => ({ value: r, label: r }))} />
          </Form.Item>
          <Form.Item name="note" label="补充说明（可选）">
            <Input.TextArea rows={2} maxLength={300} placeholder="如：本批次为简历初筛不匹配" />
          </Form.Item>
        </Form>
      </FormModal>

      {/* 批量移动：目标阶段 + 可选回退原因（批量含回退卡时后端逐条校验） */}
      <FormModal form={batchMoveForm}
        className="hf-modal"
        title={`批量移动 ${selected.size} 人`}
        open={batchMoveOpen}
        onCancel={() => setBatchMoveOpen(false)}
        onOk={() => batchMoveForm.submit()}
        okText={`移动 ${selected.size} 人`}
        confirmLoading={batchMoveMutation.isPending}
        destroyOnHidden
      >
        <Form form={batchMoveForm} layout="vertical" onFinish={(v) => batchMoveMutation.mutate(v)}>
          <Form.Item name="stageId" label="目标阶段" rules={[{ required: true, message: '请选择目标阶段' }]}>
            <Select
              placeholder="选择阶段"
              options={boardQuery.data?.columns.map((c) => ({ value: c.stage.id, label: c.stage.name }))}
            />
          </Form.Item>
          <Form.Item name="reason" label="回退原因（所选中含需回退的卡片时必填，未填的回退卡会失败并列入报告）">
            <Input.TextArea rows={2} maxLength={200} placeholder="如：批量回退重新安排一面" />
          </Form.Item>
        </Form>
      </FormModal>

      {/* 添加候选人：从候选人库挑一个加进本职位流程 */}
      <FormModal form={addForm}
        className="hf-modal"
        title={
          <>
            添加候选人
            <div className="hf-modal-sub">{jobOptions?.find((j) => j.value === jobId)?.label ?? '当前职位'}</div>
          </>
        }
        open={addOpen}
        onCancel={() => {
          setAddOpen(false);
          addForm.resetFields();
          setAddKeyword('');
        }}
        onOk={() => addForm.submit()}
        okText="加入流程"
        confirmLoading={addMutation.isPending}
        footer={(_, { OkBtn, CancelBtn }) => (
          <>
            <span className="hf-modal-hint">
              已在本职位流程中（含已入职）的候选人不会出现；此前被淘汰的会复活原记录
            </span>
            <CancelBtn />
            <OkBtn />
          </>
        )}
        destroyOnHidden
      >
        <Form form={addForm} layout="vertical" onFinish={(v) => addMutation.mutate(v)}>
          <Form.Item
            name="candidateId"
            label="选择候选人"
            extra="加入后自动落到该职位的首个阶段并留痕；库里没有的人请先到「候选人」页录入"
            rules={[{ required: true, message: '请选择候选人' }]}
          >
            <Select
              showSearch
              filterOption={false}
              placeholder="输入姓名 / 邮箱 / 技能搜索"
              loading={addCandidatesQuery.isFetching}
              onSearch={setAddKeyword}
              options={addOptions}
              optionRender={(o) => (
                <div>
                  <div>{o.data.label}</div>
                  <div className="hf-faint">{o.data.meta}</div>
                </div>
              )}
              notFoundContent={
                addCandidatesQuery.isFetching ? <Spin size="small" /> : <span className="hf-faint">没有可加入的候选人</span>
              }
            />
          </Form.Item>
        </Form>
      </FormModal>

      <CompareModal data={compareData} loading={compareMutation.isPending} onClose={() => setCompareData(null)} />

      <CandidateDetailDrawer candidateId={detailId} onClose={closeDetail} />
    </div>
  );
}
