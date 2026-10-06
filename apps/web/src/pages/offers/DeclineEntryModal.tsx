import { useMutation } from '@tanstack/react-query';
import { OFFER_DECLINE_REASONS } from '@hireflow/shared';
import { App, Form, Select } from 'antd';
import { offersApi } from '../../api';
import { extractErrorMessage } from '../../api/client';
import type { Offer } from '../../api/types';
import { FormModal } from '../../components/FormModal';

/** HR 代录候选人拒绝：原因码必选 */
export function DeclineEntryModal({
  offer,
  onClose,
  onDone,
}: {
  offer: Offer | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ reason: string }>();
  const mutation = useMutation({
    mutationFn: (values: { reason: string }) => offersApi.respond(offer!.id, 'DECLINED', values.reason),
    onSuccess: () => {
      message.success('已录入：拒绝');
      onClose();
      onDone();
    },
    onError: (error) => message.error(extractErrorMessage(error, '操作失败')),
  });
  return (
    <FormModal form={form}
      className="hf-modal"
      title={offer ? `录入拒绝：${offer.application.candidate.name}` : '录入拒绝'}
      open={Boolean(offer)}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="确认录入"
      okButtonProps={{ danger: true }}
      confirmLoading={mutation.isPending}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={(v) => mutation.mutate(v)}>
        <Form.Item
          name="reason"
          label="拒绝原因码（必选，用于渠道与薪酬竞争力分析）"
          rules={[{ required: true, message: '请选择原因码' }]}
        >
          <Select placeholder="选择原因" options={OFFER_DECLINE_REASONS.map((r) => ({ value: r, label: r }))} />
        </Form.Item>
      </Form>
    </FormModal>
  );
}
