import { useMutation } from '@tanstack/react-query';
import { Alert, App, DatePicker, Form, Input, InputNumber, Space } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { offersApi } from '../../api';
import { extractErrorMessage } from '../../api/client';
import type { Offer } from '../../api/types';
import { FormModal } from '../../components/FormModal';

type FormValues = { salaryBase: number; bonusMonths?: number; startDate: Dayjs; grade?: string; note?: string };

/** 驳回后修改重提：调整薪资包重新进入审批 */
export function ResubmitModal({
  offer,
  onClose,
  onDone,
}: {
  offer: Offer | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const mutation = useMutation({
    mutationFn: ({ startDate, ...values }: FormValues) =>
      offersApi.resubmit(offer!.id, { ...values, startDate: startDate.format('YYYY-MM-DD') }),
    onSuccess: () => {
      message.success('已重新提交审批');
      onClose();
      onDone();
    },
    onError: (error) => message.error(extractErrorMessage(error, '操作失败')),
  });
  return (
    <FormModal form={form}
      className="hf-modal"
      title={offer ? `修改重提：${offer.application.candidate.name}` : '修改重提'}
      open={Boolean(offer)}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="重新提交审批"
      confirmLoading={mutation.isPending}
      destroyOnHidden
    >
      {offer?.approvalNote && (
        <Alert type="warning" showIcon title="审批驳回意见" description={offer.approvalNote} className="u-mb-16" />
      )}
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          salaryBase: offer?.salary?.base,
          bonusMonths: offer?.salary?.bonusMonths ?? 0,
          grade: offer?.grade ?? undefined,
          // 原日期已过就留空，逼着重新选
          startDate:
            offer?.startDate && !dayjs(offer.startDate).isBefore(dayjs(), 'day') ? dayjs(offer.startDate) : undefined,
          note: offer?.salary?.note ?? undefined,
        }}
        onFinish={(v) => mutation.mutate(v)}
      >
        <Space className="u-flex-row" align="start">
          <Form.Item name="salaryBase" label="月薪（base，元）" rules={[{ required: true, message: '请输入月薪' }]}>
            <InputNumber min={1000} max={1_000_000} step={1000} className="w-160" />
          </Form.Item>
          <Form.Item name="bonusMonths" label="年终奖月数">
            <InputNumber min={0} max={12} className="w-120" />
          </Form.Item>
          <Form.Item name="grade" label="职级">
            <Input placeholder="P6" maxLength={20} className="w-100" />
          </Form.Item>
        </Space>
        <Form.Item name="startDate" label="预计入职日期" rules={[{ required: true, message: '请选择预计入职日期' }]}>
          <DatePicker className="w-160" disabledDate={(d) => d.isBefore(dayjs(), 'day')} placeholder="选择日期" />
        </Form.Item>
        <Form.Item name="note" label="备注（审批人可见）">
          <Input.TextArea rows={2} maxLength={500} placeholder="如：已按带宽上限调整" />
        </Form.Item>
      </Form>
    </FormModal>
  );
}
