import {
  CalendarOutlined,
  FileTextOutlined,
  InboxOutlined,
  PaperClipOutlined,
  PlusOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  APPLICATION_STATUS_LABEL,
  EVALUATION_CONCLUSION_LABEL,
  INTERVIEW_STATUS_LABEL,
  PERMISSIONS,
  REJECT_REASONS,
  type ApplicationStatus,
  type EvaluationConclusion,
  type InterviewStatus,
} from '@hireflow/shared';
import { Alert, App, Button, DatePicker, Drawer, Form, Input, InputNumber, Popconfirm, Select, Spin, Typography, Upload } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { CSSProperties } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { applicationsApi, boardApi, candidatesApi, jobsApi, offersApi, resumesApi } from '../api';
import { extractErrorMessage } from '../api/client';
import type { ActivityItem, CandidateDetail, DetailApplication, Interview } from '../api/types';
import { useAuthStore } from '../stores/auth';
import { EvaluationModal } from './EvaluationModal';
import { ScheduleInterviewModal } from './ScheduleInterviewModal';
import { FormModal } from './FormModal';
import { prepareUpload } from '../utils/prepareUpload';
import { pressable } from '../utils/pressable';

const cssVars = (v: Record<string, string | number>) => v as CSSProperties;

const ACTION_LABEL: Record<string, string> = {
  'job.created': '创建职位',
  'job.updated': '更新职位',
  'job.stages_updated': '调整招聘流程',
  'candidate.created': '录入候选人',
  'candidate.updated': '更新候选人',
  'resume.added': '导入简历',
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
  'application.prescreen_sent': '发送预筛问卷',
  'application.prescreen_submitted': '候选人提交预筛',
  'application.talent_pool_activated': '人才库唤醒激活',
  'job.talent_pool_scanned': '人才库扫描',
  'interview.scheduled': '安排面试',
  'interview.self_scheduled': '候选人自助选时',
  'interview.canceled': '取消面试',
  'evaluation.submitted': '提交面评',
  'offer.initiated': '发起 Offer',
  'offer.approved': 'Offer 审批通过',
  'offer.rejected': 'Offer 审批驳回',
  'offer.sent': 'Offer 已发送',
  'offer.responded': '候选人答复 Offer',
  'offer.resubmitted': 'Offer 修改重提',
  'offer.extended': 'Offer 答复期续期',
  'portal.link_rotated': '重新生成候选人链接',
  'offer.expired': 'Offer 已过期失效',
  'onboarding.created': '创建入职单',
  'onboarding.item_done': '入职待办更新',
  'onboarding.completed': '入职闭环完成',
  'onboarding.document_added': '提交入职材料',
  'contract.created': '生成劳动合同',
  'contract.sent': '合同发送签署',
  'contract.signed': '合同签署完成',
  'webhook.fired': '自动化通知（Webhook）',
};

const CONCLUSION_TAG: Record<string, string> = {
  STRONG_YES: 'hf-tag hf-tag--ok',
  YES: 'hf-tag hf-tag--ok',
  NO: 'hf-tag hf-tag--warn',
  STRONG_NO: 'hf-tag hf-tag--err',
};

function scoreColor(score: number) {
  if (score >= 85) return '#059669';
  if (score >= 70) return '#2563EB';
  return '#B45309';
}

type Tab = 'applications' | 'resumes' | 'timeline';

/** 一次面试 + 它的面评：行式布局，评分改数字，不再用星级 */
function InterviewRow({
  interview,
  canEvaluate,
  onEvaluate,
}: {
  interview: Interview;
  canEvaluate: boolean;
  onEvaluate: (id: string) => void;
}) {
  const done = interview.status === 'COMPLETED';
  const evals = interview.evaluations.filter((ev) => ev.conclusion);
  return (
    <div className="hf-iv-row">
      <div className="u-flex-gap-10 u-flex-center-v">
        <span className={done ? 'hf-dot hf-dot--off' : 'hf-dot hf-dot--on'} />
        <span className="hf-secondary hf-strong">第 {interview.round} 轮</span>
        <span className="hf-secondary hf-td--num">
          {interview.scheduledAt ? dayjs(interview.scheduledAt).format('MM-DD HH:mm') : '待定时间'}
        </span>
        <span className="hf-muted hf-ellipsis">{interview.interviewers.map((i) => i.user.name).join('、') || '—'}</span>
        <span className="u-flex-1" />
        {evals.length > 0 ? (
          evals.map((ev) => (
            <span key={ev.id} className={CONCLUSION_TAG[ev.conclusion!] ?? 'hf-tag'} title={ev.interviewer.name}>
              {EVALUATION_CONCLUSION_LABEL[ev.conclusion as EvaluationConclusion]}
            </span>
          ))
        ) : (
          <span className="hf-faint">{INTERVIEW_STATUS_LABEL[interview.status as InterviewStatus]}</span>
        )}
        {canEvaluate && evals.length === 0 && (
          <span className="hf-link" {...pressable(() => onEvaluate(interview.id))}>
            提交面评
          </span>
        )}
      </div>
      {interview.evaluations.map((ev) =>
        ev.scorecard?.length || ev.comments ? (
          <div key={`d-${ev.id}`} className="hf-iv-detail">
            {ev.scorecard?.length ? (
              <div className="hf-iv-scores">
                {ev.scorecard.map((s) => (
                  <span key={s.dimension}>
                    {s.dimension} <b>{s.score}</b>/5
                  </span>
                ))}
              </div>
            ) : null}
            {ev.comments && <div className="hf-iv-comment">{ev.comments}</div>}
          </div>
        ) : null,
      )}
    </div>
  );
}

/** 一条应聘记录：头部一行 + AI 依据两栏 + 面试列表 + 底部动作条 */
function ApplicationBlock({
  application,
  onSchedule,
  onEvaluate,
  onScore,
  onOffer,
  onReject,
  onReactivate,
  reactivating,
  scoring,
}: {
  application: DetailApplication;
  onSchedule: (id: string, rounds: number) => void;
  onEvaluate: (id: string) => void;
  onScore: (id: string) => void;
  onOffer: (id: string) => void;
  onReject: (id: string) => void;
  onReactivate: (jobId: string) => void;
  reactivating: boolean;
  scoring: boolean;
}) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();
  const active = application.status === 'ACTIVE';
  // 候选人拒绝 / 过期未续的 Offer 已终结，可以重新发起
  const liveOffer =
    application.offer && application.offer.decision !== 'DECLINED' && application.offer.approvalStatus !== 'EXPIRED'
      ? application.offer
      : null;
  const prescreen = application.prescreen;
  const report = application.matchReport;
  const score = application.matchScore;

  if (!active) {
    /** 终态应聘：降为灰底单行 + 原因 + 重新激活 */
    return (
      <div className="hf-app-block hf-app-block--off">
        <div className="u-flex-between">
          <span className="u-flex-gap-10 u-flex-baseline">
            {/* 详情接口的 job 不带 department（设计稿按带写的，直接取 .name 会抛错），故只显示职位名 */}
            <span className="hf-secondary hf-strong">{application.job.title}</span>
            <span className="hf-tag">{APPLICATION_STATUS_LABEL[application.status as ApplicationStatus]}</span>
            {application.rejectReason && <span className="hf-faint">{application.rejectReason}</span>}
          </span>
          {/* (candidateId, jobId) 唯一：本职位只可能有一条应聘记录，所以「重新激活」是把这条终态记录
              复活回首个阶段，而不是新建一条——历史面评/打分/淘汰原因都还挂在同一条时间轴上 */}
          {hasPermission(PERMISSIONS.APPLICATION_CREATE) ? (
            <Popconfirm
              title="重新激活该候选人？"
              description="该应聘记录将回到首个阶段重新开始；历史面评、匹配分与淘汰原因会保留在同一条时间轴上。"
              okText="确认激活"
              onConfirm={() => onReactivate(application.job.id)}
            >
              <span className="hf-link">{reactivating ? '激活中…' : '重新激活'}</span>
            </Popconfirm>
          ) : (
            <span className="hf-link--off" title="需要「加入职位流程」权限">
              重新激活
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="hf-app-block">
      <div className="hf-app-head">
        <span className="u-flex-gap-10 u-flex-baseline">
          <span className="hf-panel-title">{application.job.title}</span>
          <span className="hf-tag hf-tag--on">{application.stage.name}</span>
        </span>
        {score != null && (
          <span className="hf-state hf-strong" style={cssVars({ color: scoreColor(score) })}>
            <span className="hf-dot" style={cssVars({ background: scoreColor(score) })} />
            匹配 {score}
          </span>
        )}
      </div>

      {/* AI 依据：命中 / 缺失两栏平铺，取代 Popover 里的一堆 Tag */}
      {report && (
        <div className="hf-match">
          <div className="hf-match-col">
            <div className="hf-caption u-mb-4">命中要求 {report.hits.length}</div>
            <div className="hf-secondary">{report.hits.join(' · ') || '—'}</div>
            {report.highlights && <div className="hf-faint u-mt-4">{report.highlights}</div>}
          </div>
          <div className="hf-match-col hf-match-col--miss">
            <div className="hf-caption hf-caption--warn u-mb-4">缺失 {report.misses.length}</div>
            <div className="hf-state--warn">{report.misses.join(' · ') || '—'}</div>
            {report.risks && <div className="hf-faint u-mt-4">{report.risks}</div>}
          </div>
        </div>
      )}

      {prescreen && (
        <div className={prescreen.flags.length ? 'hf-notice hf-notice--warn u-mb-8' : 'hf-notice hf-notice--flat u-mb-8'}>
          <div className="u-flex-1">
            <div className="hf-caption u-mb-4">
              预筛问卷 · {dayjs(prescreen.submittedAt).format('MM-DD HH:mm')} 提交
            </div>
            <div className="hf-secondary">
              期望月薪 ¥{prescreen.expectedSalary.toLocaleString()} · 最早 {prescreen.availableDate} 到岗 ·{' '}
              {prescreen.travelOk ? '接受出差' : '不接受出差'}
              {prescreen.note ? ` · ${prescreen.note}` : ''}
            </div>
            {prescreen.flags.length > 0 && (
              <div className="hf-state--warn u-mt-4">不符项：{prescreen.flags.join('；')}</div>
            )}
          </div>
        </div>
      )}
      {application.interviews.length === 0 ? (
        <div className="hf-iv-row hf-faint">暂无面试安排</div>
      ) : (
        application.interviews.map((interview) => (
          <InterviewRow
            key={interview.id}
            interview={interview}
            canEvaluate={hasPermission(PERMISSIONS.EVALUATION_SUBMIT)}
            onEvaluate={onEvaluate}
          />
        ))
      )}

      <div className="hf-app-foot">
        {hasPermission(PERMISSIONS.INTERVIEW_SCHEDULE) && (
          <span className="hf-link" {...pressable(() => onSchedule(application.id, application.interviews.length))}>
            <CalendarOutlined /> {application.interviews.length === 0 ? '安排面试' : '安排下一轮'}
          </span>
        )}
        {hasPermission(PERMISSIONS.APPLICATION_MOVE) && (
          <span className="hf-link" {...pressable(() => onScore(application.id))}>
            <RobotOutlined /> {scoring ? '评分中…' : '重新 AI 评分'}
          </span>
        )}
        {liveOffer ? (
          // 一条应聘只能有一个在途 Offer：已有就去录用管理看进度，不再给「发起」入口
          <span className="hf-link" {...pressable(() => navigate(`/offers?focus=${liveOffer.id}`))}>
            查看 Offer
          </span>
        ) : (
          hasPermission(PERMISSIONS.OFFER_INITIATE) && (
            <span className="hf-link" {...pressable(() => onOffer(application.id))}>
              发起 Offer
            </span>
          )
        )}
        <span className="u-flex-1" />
        {hasPermission(PERMISSIONS.APPLICATION_MOVE) && (
          <span className="hf-link hf-link--danger" {...pressable(() => onReject(application.id))}>
            淘汰
          </span>
        )}
      </div>
    </div>
  );
}

/** 时间轴操作人：系统自动动作带上是谁的操作触发了它 */
function actorLabel(item: ActivityItem) {
  const name = item.actor?.name ?? item.actorName ?? '系统';
  const trigger = item.payload?.triggeredBy;
  return !item.actor && typeof trigger === 'string' && trigger ? `${name} · 由 ${trigger} 触发` : name;
}

type OfferFormValues = { salaryBase: number; bonusMonths?: number; startDate: Dayjs; grade?: string; note?: string };

interface Props {
  candidateId: string | null;
  onClose: () => void;
}

/** 360° 候选人详情：头部固定主操作 + 三个 Tab + 底部最近动态 */
export function CandidateDetailDrawer({ candidateId, onClose }: Props) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const [tab, setTab] = useState<Tab>('applications');
  const [scheduleFor, setScheduleFor] = useState<{ id: string; rounds: number } | null>(null);
  const [evaluateFor, setEvaluateFor] = useState<string | null>(null);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [offerFor, setOfferFor] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [resumeForm] = Form.useForm();
  const [applyForm] = Form.useForm();
  const [offerForm] = Form.useForm();
  const [rejectForm] = Form.useForm();

  const detailQuery = useQuery({
    queryKey: ['candidate-detail', candidateId],
    queryFn: () => candidatesApi.get(candidateId!),
    enabled: Boolean(candidateId),
  });
  const jobsQuery = useQuery({
    queryKey: ['jobs', 'options'],
    queryFn: () => jobsApi.list({ page: 1, pageSize: 100 }),
    enabled: applyOpen,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['candidate-detail', candidateId] });
    void queryClient.invalidateQueries({ queryKey: ['candidates'] });
    void queryClient.invalidateQueries({ queryKey: ['board'] });
  };

  const parseMutation = useMutation({
    mutationFn: resumesApi.parse,
    onSuccess: (resume) => {
      message.success(`简历解析完成，提取 ${resume.skills.length} 个技能标签`);
      invalidate();
    },
    onError: (error) => message.error(extractErrorMessage(error, '解析失败')),
  });

  const addResumeMutation = useMutation({
    mutationFn: (values: { rawText: string }) => candidatesApi.addResume(candidateId!, values),
    onSuccess: () => {
      message.success('简历已导入，可点击「AI 解析」提取结构化信息');
      setResumeOpen(false);
      resumeForm.resetFields();
      invalidate();
    },
    onError: (error) => message.error(extractErrorMessage(error, '导入失败')),
  });

  const uploadResumeMutation = useMutation({
    mutationFn: (file: File) => candidatesApi.addResumeFile(candidateId!, file),
    onSuccess: (resume) => {
      setResumeOpen(false);
      setResumeFile(null);
      resumeForm.resetFields();
      invalidate();
      if (resume.textExtracted) {
        message.success('原件已留档，文字抽取成功，正在自动进行 AI 解析…');
        parseMutation.mutate(resume.id);
      } else {
        message.warning('原件已留档，但未能抽取文字（扫描件/图片），请补充粘贴文本后再解析');
      }
    },
    onError: (error) => message.error(extractErrorMessage(error, '上传失败')),
  });

  const applyMutation = useMutation({
    mutationFn: (values: { jobId: string }) => applicationsApi.create({ candidateId: candidateId!, jobId: values.jobId }),
    onSuccess: () => {
      message.success('已加入职位流程');
      setApplyOpen(false);
      applyForm.resetFields();
      invalidate();
    },
    onError: (error) => message.error(extractErrorMessage(error, '操作失败')),
  });

  /** 重新激活：复用人才库唤醒端点；本职位已有终态记录时后端会复活原记录（唯一键不允许再建一条） */
  const reactivateMutation = useMutation({
    mutationFn: (jobId: string) => jobsApi.talentPoolActivate(jobId, candidateId!),
    onSuccess: (data) => {
      message.success(
        data.revived ? '已重新激活：原应聘记录回到首个阶段，历史留痕保留' : '已加入职位流程，卡片落在首个阶段',
      );
      invalidate();
    },
    onError: (error) => message.error(extractErrorMessage(error, '激活失败')),
  });

  const scoreMutation = useMutation({
    mutationFn: applicationsApi.score,
    onSuccess: () => {
      message.success('AI 匹配评分完成');
      invalidate();
    },
    onError: (error) => message.error(extractErrorMessage(error, '评分失败')),
  });

  const rejectMutation = useMutation({
    mutationFn: (values: { reason: string; note?: string }) => boardApi.reject(rejectFor!, values),
    onSuccess: () => {
      message.success('已淘汰并留痕');
      setRejectFor(null);
      rejectForm.resetFields();
      invalidate();
    },
    onError: (error) => message.error(extractErrorMessage(error, '操作失败')),
  });

  const offerMutation = useMutation({
    mutationFn: ({ startDate, ...values }: OfferFormValues) =>
      offersApi.create({ applicationId: offerFor!, ...values, startDate: startDate.format('YYYY-MM-DD') }),
    onSuccess: () => {
      message.success('Offer 已发起，等待用人经理审批（见「录用管理」）');
      setOfferFor(null);
      offerForm.resetFields();
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['offers'] });
    },
    onError: (error) => message.error(extractErrorMessage(error, '发起失败')),
  });

  const detail: CandidateDetail | undefined = detailQuery.data;
  const topScore = detail?.applications.find((a) => a.matchScore != null)?.matchScore ?? null;
  const salaryBase = Form.useWatch('salaryBase', offerForm) as number | undefined;
  const bonusMonths = Form.useWatch('bonusMonths', offerForm) as number | undefined;
  const totalPackage = salaryBase ? salaryBase * (12 + (bonusMonths ?? 0)) : null;
  // 发起前把面评结论摆出来：不推荐 / 没有面评时 HR 应当是有意识地继续，而不是没看到
  const offerEvals = (detail?.applications.find((a) => a.id === offerFor)?.interviews ?? []).flatMap((iv) =>
    iv.evaluations.filter((ev) => ev.conclusion).map((ev) => ({ ...ev, round: iv.round })),
  );
  const offerNegative = offerEvals.filter((ev) => ev.conclusion === 'NO' || ev.conclusion === 'STRONG_NO');

  return (
    <Drawer
      className="hf-drawer"
      size={760}
      open={Boolean(candidateId)}
      onClose={onClose}
      destroyOnHidden
      title={
        !detail ? (
          '候选人详情'
        ) : (
          <>
            {/* 头部：姓名 + 匹配分 + 一行元信息 + 固定主操作 */}
            <div className="u-flex-between">
              <div className="u-flex-gap-12 u-flex-center-v">
                <div>
                  <div className="u-flex-gap-10 u-flex-center-v">
                    <span className="hf-section-title">{detail.name}</span>
                    {topScore != null && (
                      <span className="hf-state hf-strong" style={cssVars({ color: scoreColor(topScore) })}>
                        <span className="hf-dot" style={cssVars({ background: scoreColor(topScore) })} />
                        匹配 {topScore}
                      </span>
                    )}
                  </div>
                  <div className="hf-panel-sub">
                    {[detail.email, detail.phone, detail.source, `${dayjs(detail.createdAt).format('MM-DD')} 录入`]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
              </div>
              <div className="hf-bar-right">
                {hasPermission(PERMISSIONS.APPLICATION_CREATE) && (
                  <Button icon={<PlusOutlined />} onClick={() => setApplyOpen(true)}>
                    加入职位
                  </Button>
                )}
                {hasPermission(PERMISSIONS.CANDIDATE_UPDATE) && (
                  <Button type="primary" onClick={() => setResumeOpen(true)}>
                    导入简历
                  </Button>
                )}
              </div>
            </div>
            {/* Tab：下划线式，不用 antd Tabs 的容器边框 */}
            <div className="hf-drawer-tabs">
              {(
                [
                  ['applications', `应聘记录`],
                  ['resumes', `简历`],
                  ['timeline', `时间轴`],
                ] as Array<[Tab, string]>
              ).map(([key, label]) => (
                <span
                  key={key}
                  className={tab === key ? 'hf-drawer-tab hf-drawer-tab--on' : 'hf-drawer-tab'}
                  {...pressable(() => setTab(key))}
                >
                  {label}
                </span>
              ))}
            </div>
          </>
        )
      }
    >
      {detailQuery.isLoading || !detail ? (
        <div className="u-flex-center hf-min-240">
          <Spin />
        </div>
      ) : (
        <>
          {tab === 'applications' && (
            <>
              {detail.applications.length === 0 ? (
                <div className="hf-notice hf-notice--flat">
                  <span>尚未应聘任何职位——点右上「加入职位」把候选人放进流程。</span>
                </div>
              ) : (
                detail.applications.map((application) => (
                  <ApplicationBlock
                    key={application.id}
                    application={application}
                    onSchedule={(id, rounds) => setScheduleFor({ id, rounds })}
                    onEvaluate={setEvaluateFor}
                    onScore={(id) => scoreMutation.mutate(id)}
                    onOffer={setOfferFor}
                    onReject={setRejectFor}
                    onReactivate={(jobId) => reactivateMutation.mutate(jobId)}
                    reactivating={reactivateMutation.isPending}
                    scoring={scoreMutation.isPending}
                  />
                ))
              )}

              {/* 底部最近动态：不用切 Tab 就能看到 */}
              <div className="hf-caption u-mt-16 u-mb-8">最近动态</div>
              {detail.timeline.slice(0, 6).map((item, i) => (
                <div className="hf-tl" key={item.id ?? i}>
                  <div className="hf-tl-rail">
                    <span className={i === 0 ? 'hf-tl-dot hf-tl-dot--on' : 'hf-tl-dot'} />
                    {i < Math.min(detail.timeline.length, 6) - 1 && <span className="hf-tl-line" />}
                  </div>
                  <div className="hf-tl-body">
                    <div className="hf-tl-head">
                      <span className="hf-secondary hf-strong">{ACTION_LABEL[item.action] ?? item.action}</span>
                      <span className="hf-muted">{actorLabel(item)}</span>
                      <span className="u-flex-1" />
                      <span className="hf-faint hf-td--num">{dayjs(item.createdAt).format('MM-DD HH:mm')}</span>
                    </div>
                    {item.action === 'application.stage_changed' && item.payload && (
                      <div className="hf-tl-extra">
                        {String(item.payload.from)} → {String(item.payload.to)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

          {tab === 'resumes' && (
            <>
              {detail.resumes.length === 0 ? (
                <div className="hf-notice hf-notice--flat">
                  <span>暂无简历——导入后 AI 会自动解析出技能标签与画像。</span>
                </div>
              ) : (
                detail.resumes.map((resume) => (
                  <div className="hf-app-block" key={resume.id}>
                    <div className="hf-app-head">
                      <span className="u-flex-gap-10 u-flex-center-v">
                        <FileTextOutlined />
                        <span className="hf-secondary hf-strong">{resume.fileName ?? '未命名简历'}</span>
                        <span
                          className={
                            resume.parseStatus === 'DONE'
                              ? 'hf-tag hf-tag--ok'
                              : resume.parseStatus === 'FAILED'
                                ? 'hf-tag hf-tag--err'
                                : 'hf-tag'
                          }
                        >
                          {resume.parseStatus === 'DONE' ? '已解析' : resume.parseStatus === 'FAILED' ? '解析失败' : '待解析'}
                        </span>
                      </span>
                      <span className="u-flex-gap-12">
                        {resume.fileKey && (
                          <span
                            className="hf-link"
                            {...pressable(() =>
                              resumesApi
                                .fileUrl(resume.id)
                                .then(({ url }) => window.open(url, '_blank'))
                                .catch((error) => message.error(extractErrorMessage(error, '获取原件链接失败')))
                            )}
                          >
                            <PaperClipOutlined /> 原件
                          </span>
                        )}
                        {resume.rawText && hasPermission(PERMISSIONS.CANDIDATE_UPDATE) && (
                          <span className="hf-link" {...pressable(() => parseMutation.mutate(resume.id))}>
                            <RobotOutlined /> {resume.parseStatus === 'DONE' ? '重新解析' : 'AI 解析'}
                          </span>
                        )}
                        <span className="hf-faint hf-td--num">{dayjs(resume.createdAt).format('MM-DD')}</span>
                      </span>
                    </div>
                    {resume.skills.length > 0 && <div className="hf-iv-row hf-secondary">{resume.skills.join(' · ')}</div>}
                    {resume.parsed?.summary && <div className="hf-iv-comment">{resume.parsed.summary}</div>}
                    {resume.rawText && (
                      <Typography.Paragraph
                        type="secondary"
                        className="hf-iv-comment"
                        ellipsis={{ rows: 3, expandable: true, symbol: '展开全文' }}
                      >
                        {resume.rawText}
                      </Typography.Paragraph>
                    )}
                  </div>
                ))
              )}
            </>
          )}

          {tab === 'timeline' && (
            <>
              {detail.timeline.length === 0 ? (
                <div className="hf-notice hf-notice--flat">
                  <span>暂无操作记录。</span>
                </div>
              ) : (
                detail.timeline.map((item, i) => (
                  <div className="hf-tl" key={item.id ?? i}>
                    <div className="hf-tl-rail">
                      <span className={i === 0 ? 'hf-tl-dot hf-tl-dot--on' : 'hf-tl-dot'} />
                      {i < detail.timeline.length - 1 && <span className="hf-tl-line" />}
                    </div>
                    <div className="hf-tl-body">
                      <div className="hf-tl-head">
                        <span className="hf-secondary hf-strong">{ACTION_LABEL[item.action] ?? item.action}</span>
                        <span className="hf-muted">{actorLabel(item)}</span>
                        <span className="u-flex-1" />
                        <span className="hf-faint hf-td--num">{dayjs(item.createdAt).format('MM-DD HH:mm')}</span>
                      </div>
                      {item.action === 'application.stage_changed' && item.payload && (
                        <div className="hf-tl-extra">
                          {String(item.payload.from)} → {String(item.payload.to)}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </>
          )}

          {/* ---------- 弹窗 ---------- */}
          <FormModal form={resumeForm}
            className="hf-modal"
            title="导入简历"
            open={resumeOpen}
            onCancel={() => {
              setResumeOpen(false);
              setResumeFile(null);
            }}
            onOk={() => {
              if (resumeFile) uploadResumeMutation.mutate(resumeFile);
              else resumeForm.submit();
            }}
            okText={resumeFile ? '上传原件' : '导入文本'}
            confirmLoading={addResumeMutation.isPending || uploadResumeMutation.isPending}
            destroyOnHidden
          >
            <Upload.Dragger
              accept=".pdf,.txt,.md"
              maxCount={1}
              // 受控文件列表 + 上传前处理（大图压缩、超限拦截）：列表里显示的就是实际要传的文件
              fileList={resumeFile ? [{ uid: 'picked', name: resumeFile.name, status: 'done' as const }] : []}
              beforeUpload={(file) => {
                void prepareUpload(file as unknown as File).then((r) => {
                  if (r.ok) setResumeFile(r.file);
                  else {
                    setResumeFile(null);
                    message.error(r.reason);
                  }
                });
                return false;
              }}
              onRemove={() => setResumeFile(null)}
              className="u-mb-16"
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">点击或拖入简历原件（PDF / 文本，≤10MB）</p>
              <p className="ant-upload-hint hf-faint">原件入对象存储留档；PDF 自动抽取文字并进入 AI 解析</p>
            </Upload.Dragger>
            <Form form={resumeForm} layout="vertical" onFinish={(values) => addResumeMutation.mutate(values)}>
              <Form.Item
                name="rawText"
                label="或直接粘贴简历全文"
                rules={resumeFile ? [] : [{ required: true, min: 20, message: '请粘贴完整简历文本（至少 20 字）' }]}
              >
                <Input.TextArea rows={6} placeholder="与文件上传二选一" disabled={Boolean(resumeFile)} />
              </Form.Item>
            </Form>
          </FormModal>

          <FormModal form={applyForm}
            className="hf-modal"
            title="加入职位流程"
            open={applyOpen}
            onCancel={() => setApplyOpen(false)}
            onOk={() => applyForm.submit()}
            confirmLoading={applyMutation.isPending}
            destroyOnHidden
          >
            <Form form={applyForm} layout="vertical" onFinish={(values) => applyMutation.mutate(values)}>
              <Form.Item name="jobId" label="目标职位" rules={[{ required: true, message: '请选择职位' }]}>
                <Select
                  placeholder="选择职位"
                  loading={jobsQuery.isLoading}
                  options={jobsQuery.data?.items.map((j) => ({
                    value: j.id,
                    label: `${j.title}（${j.department.name}）`,
                  }))}
                />
              </Form.Item>
            </Form>
          </FormModal>

          <FormModal form={offerForm}
            className="hf-modal"
            title={
              <>
                发起 Offer
                <div className="hf-modal-sub">{detail.name}</div>
              </>
            }
            open={Boolean(offerFor)}
            onCancel={() => setOfferFor(null)}
            onOk={() => offerForm.submit()}
            okText="提交审批"
            confirmLoading={offerMutation.isPending}
            footer={(_, { OkBtn, CancelBtn }) => (
              <>
                <span className="hf-modal-hint">提交后进入审批，审批通过才能发送候选人</span>
                <CancelBtn />
                <OkBtn />
              </>
            )}
            destroyOnHidden
          >
            <Form
              form={offerForm}
              layout="vertical"
              initialValues={{ bonusMonths: 3 }}
              onFinish={(values: OfferFormValues) => offerMutation.mutate(values)}
            >
              {offerEvals.length === 0 ? (
                <Alert type="warning" showIcon className="u-mb-16" title="该候选人还没有任何面评" />
              ) : offerNegative.length > 0 ? (
                <Alert
                  type="warning"
                  showIcon
                  className="u-mb-16"
                  title={`有 ${offerNegative.length} 份面评结论为不推荐`}
                  description={offerNegative
                    .map(
                      (ev) =>
                        `第 ${ev.round} 轮 · ${ev.interviewer.name}：${EVALUATION_CONCLUSION_LABEL[ev.conclusion as EvaluationConclusion]}`,
                    )
                    .join('；')}
                />
              ) : null}
              <div className="u-flex-gap-12">
                <Form.Item
                  name="salaryBase"
                  label="月薪（base，元）"
                  rules={[{ required: true, message: '请填写月薪' }]}
                  className="u-flex-1"
                >
                  <InputNumber min={1000} max={1000000} step={1000} className="u-w-full" placeholder="如 39000" />
                </Form.Item>
                <Form.Item name="bonusMonths" label="年终奖月数" className="w-140">
                  <InputNumber min={0} max={12} className="u-w-full" />
                </Form.Item>
                <Form.Item name="grade" label="职级" className="w-100">
                  <Input placeholder="P6" maxLength={20} />
                </Form.Item>
              </div>
              <Form.Item
                name="startDate"
                label="预计入职日期"
                rules={[{ required: true, message: '请选择预计入职日期' }]}
                extra="会写入 Offer 与劳动合同，候选人在门户里可见"
              >
                <DatePicker
                  className="w-160"
                  disabledDate={(d) => d.isBefore(dayjs(), 'day')}
                  placeholder="选择日期"
                />
              </Form.Item>
              {/* 年度总包自动计算，避免审批人自己乘 */}
              <div className="hf-notice hf-notice--flat u-mb-16">
                <span className="u-flex-1">年度总包（自动计算）</span>
                <span className="hf-kpi-num">{totalPackage ? `¥${totalPackage.toLocaleString()}` : '—'}</span>
              </div>
              <Form.Item name="note" label="备注（审批人可见）">
                <Input.TextArea rows={2} maxLength={500} placeholder="如：竞品有同级别 Offer，建议按带宽上限给" />
              </Form.Item>
            </Form>
          </FormModal>

          <FormModal form={rejectForm}
            className="hf-modal"
            title={
              <>
                淘汰候选人
                <div className="hf-modal-sub">{detail.name}</div>
              </>
            }
            open={Boolean(rejectFor)}
            onCancel={() => setRejectFor(null)}
            onOk={() => rejectForm.submit()}
            okButtonProps={{ danger: true }}
            okText="确认淘汰"
            confirmLoading={rejectMutation.isPending}
            destroyOnHidden
          >
            <div className="hf-notice hf-notice--err u-mb-16">
              <span>淘汰为终态、不可逆。误操作需通过「重新激活」生成新的应聘记录，历史面评不会带过去。</span>
            </div>
            <Form form={rejectForm} layout="vertical" onFinish={(values) => rejectMutation.mutate(values)}>
              <Form.Item
                name="reason"
                label="淘汰原因码"
                rules={[{ required: true, message: '必须选择原因码' }]}
                extra="原因码用于漏斗流失分析与人才库回流，请如实选择"
              >
                <Select placeholder="选择淘汰原因" options={REJECT_REASONS.map((r) => ({ value: r, label: r }))} />
              </Form.Item>
              <Form.Item name="note" label="补充说明（可选）">
                <Input.TextArea rows={2} maxLength={300} />
              </Form.Item>
            </Form>
          </FormModal>

          <ScheduleInterviewModal
            applicationId={scheduleFor?.id ?? null}
            existingRounds={scheduleFor?.rounds}
            onClose={() => setScheduleFor(null)}
          />
          <EvaluationModal
            interviewId={evaluateFor}
            subtitle={detail.name}
            dimensions={detail.applications
              .find((a) => a.interviews.some((iv) => iv.id === evaluateFor))
              ?.job.scorecardTemplate?.map((t) => t.dimension)}
            onClose={() => setEvaluateFor(null)}
          />
        </>
      )}
    </Drawer>
  );
}
