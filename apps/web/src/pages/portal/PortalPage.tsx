import { CheckOutlined, ClockCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Select, Spin, Steps } from 'antd';
import type { AxiosError } from 'axios';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useParams } from 'react-router';
import { portalApi } from '../../api';
import { extractErrorMessage } from '../../api/client';
import type { HelpdeskAnswer, PortalView } from '../../api/types';
import { ContractText } from '../../components/ContractText';
import { FormModal } from '../../components/FormModal';
import { useAppDialogs } from '../../hooks/useAppDialogs';
import { pressable } from '../../utils/pressable';
import { isPortalExpired, PortalLinkError } from './PortalLinkError';
import { PortalShell } from './PortalShell';

type Interview = PortalView['interviews'][number];
type OfferView = NonNullable<PortalView['offer']>;
type OnboardingView = NonNullable<PortalView['onboarding']>;

const STEP_INDEX: Record<PortalView['step'], number> = { interview: 0, offer: 1, onboarding: 2, hired: 3, closed: 0 };

/** 与后端 OnboardingInfoDto 同一套规则：先在前端拦住，少一次往返 */
const INFO_RULES: Record<string, { pattern?: RegExp; min?: number; message: string }> = {
  idNumber: { pattern: /^\d{17}[\dXx]$/, message: '请填写 18 位身份证号' },
  bankName: { min: 2, message: '请填写开户银行' },
  bankAccount: { pattern: /^\d{12,19}$/, message: '工资卡号应为 12–19 位数字' },
  address: { min: 4, message: '请填写现居住地址' },
  emergencyContact: { min: 1, message: '请填写紧急联系人' },
  emergencyPhone: { pattern: /^[\d+\- ]{6,20}$/, message: '紧急联系人电话格式不正确' },
};

/**
 * 候选人页（免登录，链接即凭证）：一条应聘一个链接。
 * 面试阶段选时间 → 收到 Offer 后答复 → 接受后填写入职信息、确认合同、问入职问题。
 */
export function PortalPage() {
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const { message } = useAppDialogs();
  const key = ['portal', token];
  const viewQuery = useQuery({ queryKey: key, queryFn: () => portalApi.view(token), enabled: Boolean(token), retry: false });
  const view = viewQuery.data;

  const onUpdated = (data: PortalView, text: string) => {
    queryClient.setQueryData(key, data);
    message.success(text);
  };
  const onFailed = (error: unknown, fallback: string) => {
    if (isPortalExpired(error)) void viewQuery.refetch();
    else message.error(extractErrorMessage(error, fallback));
  };

  if (viewQuery.isLoading)
    return (
      <PortalShell title="正在加载…">
        <div className="u-flex-center hf-min-200">
          <Spin />
        </div>
      </PortalShell>
    );
  if (viewQuery.isError || !view) return <PortalLinkError error={viewQuery.error} onRetry={() => void viewQuery.refetch()} />;

  const subtitle = `${view.jobTitle} · ${view.department}`;

  if (view.step === 'closed')
    return (
      <PortalShell title="本次招聘流程已结束" company={view.company} desc={subtitle}>
        <div className="hf-notice hf-notice--flat">
          <span>感谢您的时间与关注。如有疑问，欢迎联系 HR{view.hrContact ? `（${view.hrContact.email}）` : ''}。</span>
        </div>
      </PortalShell>
    );

  if (view.step === 'hired')
    return (
      <PortalShell title={`${view.candidateName}，欢迎加入！`} company={view.company} desc={subtitle}>
        <PortalSteps view={view} />
        <div className="hf-portal-done">
          <span className="hf-portal-done-mark">
            <CheckOutlined />
          </span>
          <div className="hf-secondary">入职手续已全部完成，报到当天见。</div>
        </div>
      </PortalShell>
    );

  return (
    <PortalShell title={`${view.candidateName}，您好`} company={view.company} desc={subtitle}>
      <PortalSteps view={view} />
      {view.step === 'interview' && (
        <InterviewSection token={token} view={view} onUpdated={onUpdated} onFailed={onFailed} onConflict={() => void viewQuery.refetch()} />
      )}
      {view.step === 'offer' && view.offer && (
        <OfferSection token={token} view={view} offer={view.offer} onUpdated={onUpdated} onFailed={onFailed} />
      )}
      {view.step === 'onboarding' && view.onboarding && (
        <OnboardingSection token={token} view={view} onboarding={view.onboarding} onUpdated={onUpdated} onFailed={onFailed} />
      )}
      <div className="hf-portal-legal">
        免登录安全链接，请勿转发他人
        {view.expiresAt ? ` · 有效期至 ${dayjs(view.expiresAt).format('YYYY-MM-DD')}` : ''}
      </div>
    </PortalShell>
  );
}

function PortalSteps({ view }: { view: PortalView }) {
  return (
    <Steps
      className="hf-portal-progress"
      size="small"
      current={STEP_INDEX[view.step]}
      items={[{ title: '面试' }, { title: 'Offer' }, { title: '入职' }]}
    />
  );
}

type SectionProps = {
  token: string;
  view: PortalView;
  onUpdated: (data: PortalView, text: string) => void;
  onFailed: (error: unknown, fallback: string) => void;
};

function InterviewSection({ token, view, onUpdated, onFailed, onConflict }: SectionProps & { onConflict: () => void }) {
  const { message, modal } = useAppDialogs();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const pick = useMutation({
    mutationFn: (v: { interviewId: string; slotId: string; startAt: string }) => portalApi.pick(token, v.interviewId, v.slotId, v.startAt),
    onSuccess: (data) => onUpdated(data, '面试时间已确认，请准时参加！'),
    onError: (error) => {
      // 并发抢占（409）：刷新剩余时段供重选
      if ((error as AxiosError)?.response?.status === 409) {
        message.warning('该时段刚被约走，已为您刷新剩余时段');
        setPicked({});
        onConflict();
      } else onFailed(error, '确认失败，请稍后重试');
    },
  });

  if (view.interviews.length === 0)
    return (
      <div className="hf-notice hf-notice--flat">
        <span>HR 正在为您安排面试，安排好后在这里选择时间。</span>
      </div>
    );

  return (
    <>
      {view.interviews.map((iv) => (
        <div key={iv.id} className="hf-portal-card">
          <div className="u-flex-between u-mb-8">
            <span className="hf-strong">{iv.roundLabel}</span>
            <span className="hf-muted">约 {iv.durationMins} 分钟</span>
          </div>
          {iv.status === 'CANCELED' ? null : iv.scheduledAt ? (
            <ScheduledInterview iv={iv} />
          ) : (
            <SlotPicker
              iv={iv}
              value={picked[iv.id] ?? null}
              onChange={(slotKey) => setPicked((p) => ({ ...p, [iv.id]: slotKey }))}
              loading={pick.isPending}
              onConfirm={(slot) =>
                modal.confirm({
                  title: '确认这个面试时间？',
                  content: `${dayjs(slot.startAt).format('MM-DD ddd HH:mm')}。确认后同步给面试官，如需改期请联系 HR。`,
                  okText: '确认时间',
                  onOk: () => pick.mutateAsync({ interviewId: iv.id, slotId: slot.id, startAt: slot.startAt }),
                })
              }
            />
          )}
        </div>
      ))}
    </>
  );
}

function ScheduledInterview({ iv }: { iv: Interview }) {
  return (
    <>
      <div className="hf-kv">
        <span className="hf-kv-k">时间</span>
        <span className="hf-kv-v hf-td--num">{dayjs(iv.scheduledAt).format('YYYY-MM-DD ddd HH:mm')}</span>
      </div>
      {iv.interviewers.length > 0 && (
        <div className="hf-kv">
          <span className="hf-kv-k">面试官</span>
          <span className="hf-kv-v">{iv.interviewers.join('、')}</span>
        </div>
      )}
      {(iv.meetingUrl || iv.location) && (
        <div className="hf-kv">
          <span className="hf-kv-k">{iv.meetingUrl ? '会议链接' : '地点'}</span>
          <span className="hf-kv-v">
            {iv.meetingUrl ? (
              <a href={iv.meetingUrl} target="_blank" rel="noreferrer noopener">
                进入会议
              </a>
            ) : (
              iv.location
            )}
          </span>
        </div>
      )}
    </>
  );
}

function SlotPicker({
  iv,
  value,
  onChange,
  onConfirm,
  loading,
}: {
  iv: Interview;
  value: string | null;
  onChange: (key: string) => void;
  onConfirm: (slot: { id: string; startAt: string }) => void;
  loading: boolean;
}) {
  if (iv.slots.length === 0)
    return (
      <div className="hf-notice hf-notice--warn">
        <span>暂无可选时段，HR 将尽快补充，请稍后再来或联系 HR。</span>
      </div>
    );
  const groups: Array<{ day: string; dow: string; items: Interview['slots'] }> = [];
  for (const s of [...iv.slots].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
    const day = dayjs(s.startAt).format('MM-DD');
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(s);
    else groups.push({ day, dow: dayjs(s.startAt).format('ddd'), items: [s] });
  }
  const chosen = iv.slots.find((s) => `${s.id}:${s.startAt}` === value);
  return (
    <>
      <div className="hf-caption u-mb-8">选一个方便的时间</div>
      {groups.map((g) => (
        <div key={g.day} className="u-mb-12">
          <div className="u-flex-gap-8 u-flex-baseline u-mb-8">
            <span className="hf-primary hf-td--num">{g.day}</span>
            <span className="hf-muted">{g.dow}</span>
          </div>
          {g.items.map((s) => {
            const k = `${s.id}:${s.startAt}`;
            const on = value === k;
            const start = dayjs(s.startAt);
            const end = dayjs(start).add(iv.durationMins, 'minute');
            return (
              <div key={k} className={on ? 'hf-opt hf-opt--on' : 'hf-opt'} {...pressable(() => onChange(k))}>
                <span className="hf-opt-mark">{on ? <CheckOutlined /> : null}</span>
                <span className="hf-td--num">
                  {start.format('HH:mm')} – {end.format('HH:mm')}
                </span>
              </div>
            );
          })}
        </div>
      ))}
      <Button type="primary" block disabled={!chosen} loading={loading} onClick={() => chosen && onConfirm(chosen)}>
        确认这个时间
      </Button>
    </>
  );
}

function OfferSection({ token, view, offer, onUpdated, onFailed }: SectionProps & { offer: OfferView }) {
  const { modal } = useAppDialogs();
  const [declineOpen, setDeclineOpen] = useState(false);
  const [form] = Form.useForm<{ reason: string }>();
  const respond = useMutation({
    mutationFn: (v: { decision: 'ACCEPTED' | 'DECLINED'; reason?: string }) => portalApi.respond(token, v.decision, v.reason),
    onSuccess: (data, v) => {
      setDeclineOpen(false);
      onUpdated(data, v.decision === 'ACCEPTED' ? '已确认接受，欢迎加入！请继续填写入职信息' : '已提交答复');
    },
    onError: (error) => onFailed(error, '提交失败，请稍后重试'),
  });

  if (offer.preparing)
    return (
      <div className="hf-notice hf-notice--flat">
        <span>HR 正在准备您的录用方案，发出后会在这里显示。</span>
      </div>
    );
  if (offer.decision === 'DECLINED')
    return (
      <div className="hf-notice hf-notice--flat">
        <span>您已婉拒这份 Offer（{offer.decisionReason ?? '-'}）。感谢您的坦诚，期待未来再会。</span>
      </div>
    );
  if (offer.status === 'EXPIRED')
    return (
      <div className="hf-notice hf-notice--warn">
        <ClockCircleOutlined />
        <span>答复期已于 {dayjs(offer.expiresAt).format('YYYY-MM-DD')} 截止。如仍有意向，请联系 HR 续期。</span>
      </div>
    );

  const base = offer.salary?.base ?? null;
  const months = 12 + (offer.salary?.bonusMonths ?? 0);
  const daysLeft = offer.expiresAt ? Math.max(dayjs(offer.expiresAt).diff(dayjs(), 'day'), 0) : null;
  return (
    <div className="hf-portal-card">
      {daysLeft != null && (
        <div className={daysLeft <= 2 ? 'hf-notice hf-notice--warn u-mb-16' : 'hf-notice hf-notice--flat u-mb-16'}>
          <ClockCircleOutlined />
          <span>
            请在 <b>{dayjs(offer.expiresAt).format('MM-DD')}</b> 前答复，还剩 <b>{daysLeft} 天</b>
            {offer.extendedOnce ? '（已续期）' : ''}
          </span>
        </div>
      )}
      <div className="hf-caption u-mb-4">录用方案</div>
      <div className="hf-kv">
        <span className="hf-kv-k">职位</span>
        <span className="hf-kv-v hf-primary">{view.jobTitle}</span>
      </div>
      <div className="hf-kv">
        <span className="hf-kv-k">部门 / 职级</span>
        <span className="hf-kv-v">{[view.department, offer.grade].filter(Boolean).join(' · ')}</span>
      </div>
      {offer.startDate && (
        <div className="hf-kv">
          <span className="hf-kv-k">入职日期</span>
          <span className="hf-kv-v hf-td--num">{dayjs(offer.startDate).format('YYYY 年 M 月 D 日')}</span>
        </div>
      )}
      {base != null && (
        <>
          <div className="hf-kv">
            <span className="hf-kv-k">月薪</span>
            <span className="hf-kv-v hf-kpi-num">¥{base.toLocaleString()}</span>
          </div>
          <div className="hf-kv">
            <span className="hf-kv-k">年度总包</span>
            <span className="hf-kv-v hf-td--num">
              {months} 薪 · 约 ¥{(base * months).toLocaleString()}
            </span>
          </div>
        </>
      )}
      {offer.salary?.note && (
        <div className="hf-kv">
          <span className="hf-kv-k">备注</span>
          <span className="hf-kv-v">{offer.salary.note}</span>
        </div>
      )}
      <div className="hf-caption u-mt-16 u-mb-8">接受后</div>
      <div className="hf-secondary u-mb-16">在本页填写入职信息、阅读并确认劳动合同，HR 确认后即完成入职。</div>
      <Button
        type="primary"
        block
        icon={<CheckOutlined />}
        loading={respond.isPending}
        onClick={() =>
          modal.confirm({
            title: '确认接受这份 Offer？',
            content: '接受后即可在本页填写入职信息。',
            okText: '确认接受',
            onOk: () => respond.mutateAsync({ decision: 'ACCEPTED' }),
          })
        }
      >
        接受 Offer
      </Button>
      <div className="hf-portal-actions">
        {view.hrContact ? (
          <a
            className="hf-portal-action"
            href={`mailto:${view.hrContact.email}?subject=${encodeURIComponent(`关于 ${view.jobTitle} Offer 的咨询`)}`}
          >
            有疑问，联系 {view.hrContact.name}
          </a>
        ) : (
          <span className="hf-muted">有疑问，请联系 HR</span>
        )}
        <span className="hf-portal-sep" />
        <span className="hf-link hf-link--danger hf-portal-action" {...pressable(() => setDeclineOpen(true))}>
          婉拒
        </span>
      </div>
      <FormModal
        form={form}
        className="hf-modal"
        title="确认婉拒这份 Offer？"
        open={declineOpen}
        onCancel={() => setDeclineOpen(false)}
        onOk={() => form.submit()}
        okText="确认婉拒"
        okButtonProps={{ danger: true }}
        confirmLoading={respond.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(v) => respond.mutate({ decision: 'DECLINED', reason: v.reason })}>
          <Form.Item name="reason" label="请告诉我们原因" rules={[{ required: true, message: '请选择婉拒原因' }]}>
            <Select placeholder="选择原因" options={offer.declineReasons.map((r) => ({ value: r, label: r }))} />
          </Form.Item>
        </Form>
      </FormModal>
    </div>
  );
}

function OnboardingSection({ token, view, onboarding, onUpdated, onFailed }: SectionProps & { onboarding: OnboardingView }) {
  const [form] = Form.useForm<Record<string, string>>();
  const [editing, setEditing] = useState(!onboarding.infoSubmittedAt);
  const [signerName, setSignerName] = useState('');
  const save = useMutation({
    mutationFn: (info: Record<string, string>) => portalApi.saveInfo(token, info),
    onSuccess: (data) => {
      setEditing(false);
      onUpdated(data, '入职信息已提交');
    },
    onError: (error) => onFailed(error, '提交失败，请检查后重试'),
  });
  const sign = useMutation({
    mutationFn: () => portalApi.sign(token, signerName.trim()),
    onSuccess: (data) => onUpdated(data, '劳动合同已确认'),
    onError: (error) => onFailed(error, '确认失败，请稍后重试'),
  });
  const contract = onboarding.contract;
  const done = Boolean(onboarding.infoSubmittedAt) && contract?.signStatus === 'SIGNED';

  return (
    <>
      {done && (
        <div className="hf-notice hf-notice--flat u-mb-16">
          <CheckOutlined />
          <span>资料已齐，等待 HR 确认入职。</span>
        </div>
      )}
      <div className="hf-portal-card">
        <div className="u-flex-between u-mb-8">
          <span className="hf-strong">1. 入职信息</span>
          {onboarding.infoSubmittedAt && !editing && (
            <Button size="small" type="link" onClick={() => setEditing(true)}>
              修改
            </Button>
          )}
        </div>
        {editing ? (
          <Form
            form={form}
            layout="vertical"
            initialValues={onboarding.info ?? undefined}
            onFinish={(v) => save.mutate(v)}
            requiredMark={false}
          >
            {onboarding.fields.map((f) => {
              const rule = INFO_RULES[f.key];
              return (
                <Form.Item
                  key={f.key}
                  name={f.key}
                  label={f.label}
                  rules={[
                    { required: true, whitespace: true, message: rule?.message ?? `请填写${f.label}` },
                    ...(rule?.pattern ? [{ pattern: rule.pattern, message: rule.message }] : []),
                    ...(rule?.min ? [{ min: rule.min, message: rule.message }] : []),
                  ]}
                >
                  <Input autoComplete="off" />
                </Form.Item>
              );
            })}
            <Button type="primary" block htmlType="submit" loading={save.isPending}>
              提交入职信息
            </Button>
          </Form>
        ) : (
          onboarding.fields.map((f) => (
            <div className="hf-kv" key={f.key}>
              <span className="hf-kv-k">{f.label}</span>
              <span className="hf-kv-v">{onboarding.info?.[f.key] || '-'}</span>
            </div>
          ))
        )}
      </div>

      {contract && (
        <div className="hf-portal-card">
          <div className="hf-strong u-mb-8">2. 劳动合同</div>
          <div className="hf-muted u-mb-8">{contract.templateName}</div>
          <ContractText variables={contract.variables} />
          {contract.signStatus === 'SIGNED' ? (
            <div className="hf-notice hf-notice--flat u-mt-12">
              <CheckOutlined />
              <span>
                {contract.signerName} 已于 {dayjs(contract.signedAt).format('YYYY-MM-DD HH:mm')} 确认
              </span>
            </div>
          ) : (
            <div className="u-mt-12">
              <div className="hf-secondary u-mb-8">已阅读并同意以上合同条款，请输入本人姓名确认：</div>
              <Input
                placeholder={view.candidateName}
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                aria-label="本人姓名"
                className="u-mb-8"
              />
              <Button block type="primary" disabled={!signerName.trim()} loading={sign.isPending} onClick={() => sign.mutate()}>
                确认合同
              </Button>
            </div>
          )}
        </div>
      )}
      <AskBox token={token} hrEmail={view.hrContact?.email} onFailed={onFailed} />
    </>
  );
}

/** 入职问答：基于公司制度文档回答并附出处 */
function AskBox({ token, hrEmail, onFailed }: { token: string; hrEmail?: string; onFailed: SectionProps['onFailed'] }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<(HelpdeskAnswer & { question: string }) | null>(null);
  const ask = useMutation({
    mutationFn: (q: string) => portalApi.ask(token, q),
    onSuccess: (data, q) => setAnswer({ ...data, question: q }),
    onError: (error) => onFailed(error, '暂时无法回答，请稍后再试'),
  });
  return (
    <div className="hf-portal-card">
      <div className="hf-strong u-mb-8">
        <QuestionCircleOutlined /> 入职问答
      </div>
      <Input.Search
        placeholder="例如：试用期多久？社保什么时候交？"
        enterButton="提问"
        maxLength={300}
        value={question}
        loading={ask.isPending}
        onChange={(e) => setQuestion(e.target.value)}
        onSearch={(q) => q.trim() && ask.mutate(q.trim())}
      />
      {answer && (
        <div className="hf-portal-answer u-mt-12">
          <div className="hf-muted u-mb-4">问：{answer.question}</div>
          <div className="hf-pre-wrap">{answer.answer}</div>
          {answer.sources.length > 0 && (
            <div className="hf-muted u-mt-8">出处：{answer.sources.map((s) => `《${s.title}》`).join('、')}</div>
          )}
        </div>
      )}
      <div className="hf-muted u-mt-8">没找到答案？联系 HR{hrEmail ? `：${hrEmail}` : ''}</div>
    </div>
  );
}
