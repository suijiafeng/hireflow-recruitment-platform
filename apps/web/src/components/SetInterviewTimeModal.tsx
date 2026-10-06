import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, DatePicker, Form, InputNumber } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { interviewsApi } from '../api';
import { extractErrorMessage, isConflictError } from '../api/client';
import type { Interview } from '../api/types';
import { FormModal } from './FormModal';

interface Props {
  /** 待定时间/改期的面试；null 时弹窗关闭 */
  interview: Interview | null;
  onClose: () => void;
}

/**
 * HR 直接敲定面试时间。与「候选人自助选时链接」是并列的两条路径：
 * 已经和候选人电话/微信约好时，没必要再让对方去点链接。
 */
export function SetInterviewTimeModal({ interview, onClose }: Props) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ scheduledAt: Dayjs; durationMins: number }>();
  const isReschedule = Boolean(interview?.scheduledAt);

  const mutation = useMutation({
    mutationFn: (vars: { scheduledAt: string; durationMins: number; ignoreConflict?: boolean }) =>
      interviewsApi.schedule(interview!.id, vars),
    onSuccess: () => {
      message.success(isReschedule ? '面试已改期，已通知面试官' : '面试时间已确定，已通知面试官');
      form.resetFields();
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['interviews'] });
      void queryClient.invalidateQueries({ queryKey: ['my-slots'] });
      void queryClient.invalidateQueries({ queryKey: ['candidate-detail'] });
    },
    onError: (error, vars) => {
      // 撞场是「警告」而非「禁止」：给出冲突详情，由 HR 决定是否仍要安排
      if (isConflictError(error)) {
        modal.confirm({
          title: '面试官时间冲突',
          content: extractErrorMessage(error, '该时间与其他面试冲突'),
          okText: '仍然安排',
          okButtonProps: { danger: true },
          cancelText: '换个时间',
          onOk: () => mutation.mutate({ ...vars, ignoreConflict: true }),
        });
        return;
      }
      message.error(extractErrorMessage(error, '安排失败'));
    },
  });

  return (
    <FormModal form={form}
      className="hf-modal hf-modal--pickers"
      title={isReschedule ? '修改面试时间' : '填写面试时间'}
      open={Boolean(interview)}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={mutation.isPending}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          scheduledAt: interview?.scheduledAt ? dayjs(interview.scheduledAt) : undefined,
          durationMins: interview?.durationMins ?? 60,
        }}
        onFinish={(v) =>
          mutation.mutate({ scheduledAt: v.scheduledAt.toISOString(), durationMins: v.durationMins })
        }
      >
        <Form.Item
          name="scheduledAt"
          label="面试时间"
          extra="若该时间落在面试官的可约时段内，对应档期会自动标记为已占用，不会再被候选人选走。"
          rules={[{ required: true, message: '请选择面试时间' }]}
        >
          <DatePicker
            showTime={{ format: 'HH:mm', minuteStep: 15 }}
            format="YYYY-MM-DD HH:mm"
            disabledDate={(d) => d.isBefore(dayjs(), 'day')}
            className="u-w-full"
            getPopupContainer={() => document.body}
          />
        </Form.Item>
        <Form.Item name="durationMins" label="时长（分钟）" rules={[{ required: true }]}>
          <InputNumber min={15} max={480} step={15} className="u-w-full" />
        </Form.Item>
      </Form>
    </FormModal>
  );
}
