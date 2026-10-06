import { CheckOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, DatePicker, Form, Input, InputNumber, Result, Spin } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useParams } from 'react-router';
import { portalApi } from '../../api';
import { extractErrorMessage } from '../../api/client';
import { PortalShell } from './InterviewPortalPage';
import { pressable } from '../../utils/pressable';

/** 单选题：卡片式选项，取代 Radio.Group（移动端点击区更大） */
function OptionPicker<T extends string | number | boolean>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value?: T;
  onChange?: (v: T) => void;
}) {
  return (
    <>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <div key={String(o.value)} className={on ? 'hf-opt hf-opt--on' : 'hf-opt'} {...pressable(() => onChange?.(o.value))}>
            <span className="hf-opt-mark">{on ? <CheckOutlined /> : null}</span>
            <span>{o.label}</span>
          </div>
        );
      })}
    </>
  );
}

/** AI 预筛：邀约前核实硬性条件三问；不符项仅提示 HR，绝不自动淘汰 */
export function PrescreenPortalPage() {
  const { token = '' } = useParams();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{
    expectedSalary: number;
    availableDate: Dayjs;
    travelOk: boolean;
    note?: string;
  }>();

  const viewQuery = useQuery({
    queryKey: ['portal-prescreen', token],
    queryFn: () => portalApi.prescreenView(token),
    enabled: Boolean(token),
    retry: false,
  });

  const submitMutation = useMutation({
    mutationFn: (values: { expectedSalary: number; availableDate: Dayjs; travelOk: boolean; note?: string }) =>
      portalApi.prescreenSubmit(token, {
        expectedSalary: values.expectedSalary,
        availableDate: values.availableDate.format('YYYY-MM-DD'),
        travelOk: values.travelOk,
        note: values.note,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['portal-prescreen', token], data);
      message.success('已提交，感谢您的配合！');
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

  if (view.closed && !view.prescreen)
    return (
      <PortalShell title="本次应聘已结束" desc="感谢您的关注，问卷不再需要填写。如有疑问请联系 HR。" company={view.company}>
        <div className="hf-portal-done">
          <span className="hf-portal-done-mark">
            <CheckOutlined />
          </span>
          <div className="hf-secondary">{view.jobTitle}</div>
        </div>
      </PortalShell>
    );

  if (view.prescreen)
    return (
      <PortalShell title="信息已提交" desc="HR 会尽快与您联系安排后续环节。" company={view.company}>
        <div className="hf-portal-done">
          <span className="hf-portal-done-mark">
            <CheckOutlined />
          </span>
          <div className="hf-secondary">提交时间 {dayjs(view.prescreen.submittedAt).format('YYYY-MM-DD HH:mm')}</div>
        </div>
      </PortalShell>
    );

  return (
    <PortalShell
      title="3 个问题，1 分钟"
      desc={`感谢您应聘「${view.jobTitle}」。答案只对本次招聘的 HR 与用人经理可见。`}
      company={view.company}
      footer={
        <>
          <Button type="primary" block loading={submitMutation.isPending} onClick={() => form.submit()}>
            提交
          </Button>
          <div className="hf-portal-legal">免登录安全链接，信息仅用于招聘流程</div>
        </>
      }
    >
      <Form form={form} layout="vertical" onFinish={(v) => submitMutation.mutate(v)} requiredMark={false}>
        <div className="hf-q">
          <div className="hf-q-head">
            <span className="hf-q-no">01</span>
            <span className="hf-q-text">期望月薪（税前）</span>
          </div>
          <Form.Item name="expectedSalary" rules={[{ required: true, message: '请填写期望月薪' }]} noStyle>
            <InputNumber
              min={1000}
              max={1_000_000}
              step={1000}
              size="large"
              className="u-w-full"
              prefix="¥"
              placeholder="如 38000"
            />
          </Form.Item>
          <div className="hf-faint u-mt-8">仅用于判断是否在带宽内，不会作为压价依据</div>
        </div>

        <div className="hf-q">
          <div className="hf-q-head">
            <span className="hf-q-no">02</span>
            <span className="hf-q-text">最早可到岗日期</span>
          </div>
          <Form.Item name="availableDate" rules={[{ required: true, message: '请选择日期' }]} noStyle>
            <DatePicker size="large" className="u-w-full" minDate={dayjs()} placeholder="选择日期" />
          </Form.Item>
        </div>

        <div className="hf-q">
          <div className="hf-q-head">
            <span className="hf-q-no">03</span>
            <span className="hf-q-text">能否接受不定期出差</span>
          </div>
          <Form.Item name="travelOk" rules={[{ required: true, message: '请选择' }]} noStyle>
            <OptionPicker
              options={[
                { value: true, label: '可以接受' },
                { value: false, label: '不方便出差' },
              ]}
            />
          </Form.Item>
        </div>

        <div className="hf-q">
          <div className="hf-q-head">
            <span className="hf-q-no">04</span>
            <span className="hf-q-text">
              其他想提前说明的情况<span className="hf-faint">（可选）</span>
            </span>
          </div>
          <Form.Item name="note" noStyle>
            <Input.TextArea rows={3} maxLength={300} placeholder="如：目前在职需一个月交接" />
          </Form.Item>
        </div>
      </Form>
    </PortalShell>
  );
}
