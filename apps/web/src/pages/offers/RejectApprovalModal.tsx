import { useMutation } from '@tanstack/react-query';
import { App, Form, Input } from 'antd';
import { offersApi } from '../../api';
import { extractErrorMessage } from '../../api/client';
import type { Offer } from '../../api/types';
import { FormModal } from '../../components/FormModal';

/** 审批驳回：意见必填，退回 HR 修改重提 */
export function RejectApprovalModal({
  offer,
  onClose,
  onDone,
}: {
  offer: Offer | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ note: string }>();
  const mutation = useMutation({
    mutationFn: (values: { note: string }) => offersApi.reject(offer!.id, values.note),
    onSuccess: () => {
      message.success('已驳回，意见已退回 HR 修改重提');
      onClose();
      onDone();
    },
    onError: (error) => message.error(extractErrorMessage(error, '操作失败')),
  });
  return (
    <FormModal form={form}
      className="hf-modal"
      title={offer ? `驳回 Offer：${offer.application.candidate.name}` : '驳回 Offer'}
      open={Boolean(offer)}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="确认驳回"
      okButtonProps={{ danger: true }}
      confirmLoading={mutation.isPending}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={(v) => mutation.mutate(v)}>
        <Form.Item
          name="note"
          label="审批意见（必填，供 HR 修改重提）"
          rules={[{ required: true, message: '驳回必须填写意见' }]}
        >
          <Input.TextArea rows={3} placeholder="如：薪资超出该职级带宽，请调整后重提" maxLength={500} />
        </Form.Item>
      </Form>
    </FormModal>
  );
}
