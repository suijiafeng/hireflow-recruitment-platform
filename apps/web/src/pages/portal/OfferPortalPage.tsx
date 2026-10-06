import { CheckOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Form, Result, Select, Spin } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { portalApi } from '../../api';
import { extractErrorMessage } from '../../api/client';
import { PortalShell } from './InterviewPortalPage';
import { FormModal } from '../../components/FormModal';
import { pressable } from '../../utils/pressable';

/**
 * Offer 门户（免登录 H5）：
 * 月薪做主视觉，补年度总包与「接受后会发生什么」，答复时效前置提醒。
 * PortalShell 统一定义在 InterviewPortalPage.tsx，本文件不再导出外壳。
 */
export function OfferPortalPage() {
  const { token = '' } = useParams();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineForm] = Form.useForm<{ reason: string }>();

  const viewQuery = useQuery({
    queryKey: ['portal-offer', token],
    queryFn: () => portalApi.offerView(token),
    enabled: Boolean(token),
    retry: false,
  });

  const respondMutation = useMutation({
    mutationFn: ({ decision, reason }: { decision: 'ACCEPTED' | 'DECLINED'; reason?: string }) =>
      portalApi.offerRespond(token, decision, reason),
    onSuccess: (data) => {
      queryClient.setQueryData(['portal-offer', token], data);
      setDeclineOpen(false);
      message.success(data.decision === 'ACCEPTED' ? '已确认接受，欢迎加入！' : '已提交答复');
    },
    onError: (error) => message.error(extractErrorMessage(error, '提交失败，请稍后重试')),
  });

  const view = viewQuery.data;

  if (viewQuery.isLoading)
    return (
      <PortalShell title="正在加载…">
        <div className="u-flex-center hf-min-200">
          <Spin />
        </div>
      </PortalShell>
    );

  if (viewQuery.isError || !view)
    return (
      <PortalShell title="链接无效或已失效">
        <Result
          status="warning"
          title="无法打开该链接"
          subTitle={extractErrorMessage(viewQuery.error, '请联系 HR 获取最新链接')}
        />
      </PortalShell>
    );

  if (view.preparing)
    return (
      <PortalShell
        title="Offer 正在更新中"
        company={view.company}
        desc="我们正在为您调整录用方案，稍后将重新发送，请留意通知。"
      >
        <div className="hf-notice hf-notice--flat">
          <span>如有疑问可直接联系 HR。</span>
        </div>
      </PortalShell>
    );

  if (view.decision === 'ACCEPTED')
    return (
      <PortalShell
        title="您已接受这份 Offer"
        company={view.company}
        desc={`答复时间：${dayjs(view.respondedAt).format('YYYY-MM-DD HH:mm')}。期待与您共事！`}
        footer={
          view.onboardingPortalToken ? (
            <Link to={`/portal/onboarding/${view.onboardingPortalToken}`}>
              <Button type="primary" block>
                进入入职资料填报
              </Button>
            </Link>
          ) : undefined
        }
      >
        <div className="hf-portal-done">
          <span className="hf-portal-done-mark">
            <CheckOutlined />
          </span>
          <div className="hf-secondary">
            {view.jobTitle} · {view.department}
          </div>
        </div>
      </PortalShell>
    );

  if (view.decision === 'DECLINED')
    return (
      <PortalShell
        title="您已婉拒这份 Offer"
        company={view.company}
        desc={`原因：${view.decisionReason ?? '-'} · ${dayjs(view.respondedAt).format('YYYY-MM-DD HH:mm')}。感谢您的坦诚，期待未来再会。`}
      >
        <div className="hf-notice hf-notice--flat">
          <span>若情况有变，欢迎随时联系 HR。</span>
        </div>
      </PortalShell>
    );

  if (view.status === 'EXPIRED')
    return (
      <PortalShell title="该 Offer 已超过答复期" company={view.company} desc="如您仍有意向，请尽快联系 HR 续期后再答复。">
        <div className="hf-notice hf-notice--warn">
          <ClockCircleOutlined />
          <span>答复期已于 {dayjs(view.expiresAt).format('YYYY-MM-DD')} 截止。</span>
        </div>
      </PortalShell>
    );

  const base = view.salary?.base ?? null;
  const months = 12 + (view.salary?.bonusMonths ?? 0);
  const total = base ? base * months : null;
  const daysLeft = view.expiresAt ? Math.max(dayjs(view.expiresAt).diff(dayjs(), 'day'), 0) : null;

  return (
    <PortalShell
      title={`${view.candidateName}，欢迎加入`}
      company={view.company}
      desc="这是你的正式录用方案，确认后我们会立即为你开启入职流程。"
      footer={
        <>
          <Button
            type="primary"
            block
            icon={<CheckOutlined />}
            loading={respondMutation.isPending}
            onClick={() =>
              modal.confirm({
                title: '确认接受这份 Offer？',
                content: '接受后我们将为您开启入职流程。',
                okText: '确认接受',
                onOk: () => respondMutation.mutateAsync({ decision: 'ACCEPTED' }),
              })
            }
          >
            接受 Offer
          </Button>
          <div className="hf-portal-actions">
            {/* 「联系 HR」必须真的能点：邮件直达对接 HR；拿不到联系人时才退回纯文字 */}
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
          <div className="hf-portal-legal">免登录安全链接，请勿转发他人</div>
        </>
      }
    >
      {daysLeft != null && (
        <div className={daysLeft <= 2 ? 'hf-notice hf-notice--warn u-mb-16' : 'hf-notice hf-notice--flat u-mb-16'}>
          <ClockCircleOutlined />
          <span>
            请在 <b>{dayjs(view.expiresAt).format('MM-DD')}</b> 前答复，还剩 <b>{daysLeft} 天</b>
            {view.extendedOnce ? '（已续期）' : ''}
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
        <span className="hf-kv-v">{[view.department, view.grade].filter(Boolean).join(' · ')}</span>
      </div>
      {view.startDate && (
        <div className="hf-kv">
          <span className="hf-kv-k">入职日期</span>
          <span className="hf-kv-v hf-td--num">{dayjs(view.startDate).format('YYYY 年 M 月 D 日')}</span>
        </div>
      )}
      {base != null && (
        <>
          {/* 月薪做主视觉 */}
          <div className="hf-kv">
            <span className="hf-kv-k">月薪</span>
            <span className="hf-kv-v hf-kpi-num">¥{base.toLocaleString()}</span>
          </div>
          <div className="hf-kv">
            <span className="hf-kv-k">年度总包</span>
            <span className="hf-kv-v hf-td--num">
              {months} 薪 · 约 ¥{total!.toLocaleString()}
            </span>
          </div>
        </>
      )}
      {view.salary?.note && (
        <div className="hf-kv">
          <span className="hf-kv-k">备注</span>
          <span className="hf-kv-v">{view.salary.note}</span>
        </div>
      )}

      <div className="hf-caption u-mt-16 u-mb-8">接受后会发生什么</div>
      {[
        '收到入职资料填报链接（身份证、学历、银行卡）',
        '在线签署劳动合同（电子签，可存证下载）',
        'IT 预配设备与账号，报到当天即可开工',
      ].map((text, i) => (
        <div className="hf-step-row" key={i}>
          <span className="hf-step-no">0{i + 1}</span>
          <span className="hf-secondary">{text}</span>
        </div>
      ))}

      <div className="hf-notice hf-notice--flat u-mt-16">
        <span>薪资与职级信息仅对你本人可见。如需调整入职日期或对方案有疑问，可直接联系 HR。</span>
      </div>

      <FormModal form={declineForm}
        className="hf-modal"
        title="确认婉拒这份 Offer？"
        open={declineOpen}
        onCancel={() => setDeclineOpen(false)}
        onOk={() => declineForm.submit()}
        okText="确认婉拒"
        okButtonProps={{ danger: true }}
        confirmLoading={respondMutation.isPending}
        destroyOnHidden
      >
        <Form
          form={declineForm}
          layout="vertical"
          onFinish={(v) => respondMutation.mutate({ decision: 'DECLINED', reason: v.reason })}
        >
          <Form.Item
            name="reason"
            label="请告诉我们原因"
            rules={[{ required: true, message: '请选择婉拒原因' }]}
            extra="您的反馈仅用于改进我们的招聘工作"
          >
            <Select placeholder="选择原因" options={view.declineReasons.map((r) => ({ value: r, label: r }))} />
          </Form.Item>
        </Form>
      </FormModal>
    </PortalShell>
  );
}
