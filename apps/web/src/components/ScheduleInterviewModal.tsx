import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, DatePicker, Form, Input, InputNumber, Select } from 'antd';
import type { Dayjs } from 'dayjs';
import { interviewsApi, usersApi } from '../api';
import { extractErrorMessage } from '../api/client';
import dayjs from 'dayjs';
import { FormModal } from './FormModal';

interface Props {
  applicationId: string | null;
  /** 已有面试轮次数，用于默认下一轮 */
  existingRounds?: number;
  onClose: () => void;
}

/** 有 evaluation:submit 权限的角色（见 packages/shared/src/permissions.ts 默认权限映射），
 * 才会被列进「面试官」候选名单——排除 IT/新员工/候选人等不参与面评的账号 */
const INTERVIEWER_ELIGIBLE_ROLES = new Set(['ADMIN', 'HR', 'HIRING_MANAGER', 'INTERVIEWER']);

export function ScheduleInterviewModal({ applicationId, existingRounds = 0, onClose }: Props) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();

  const usersQuery = useQuery({
    queryKey: ['users', 'all'],
    queryFn: () => usersApi.list(),
    enabled: Boolean(applicationId),
  });

  const createMutation = useMutation({
    mutationFn: interviewsApi.create,
    onSuccess: () => {
      message.success('面试已安排（二期将自动读取日历并发送会议邀请）');
      form.resetFields();
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['candidate-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['interviews'] });
    },
    onError: (error) => message.error(extractErrorMessage(error, '安排失败')),
  });

  return (
    <FormModal form={form}
      className="hf-modal"
      title="安排面试"
      open={Boolean(applicationId)}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={createMutation.isPending}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ round: existingRounds + 1, durationMins: 60 }}
        onFinish={(values: {
          round: number;
          scheduledAt?: Dayjs;
          durationMins?: number;
          meetingUrl?: string;
          interviewerIds: string[];
        }) =>
          createMutation.mutate({
            applicationId: applicationId!,
            round: values.round,
            scheduledAt: values.scheduledAt?.toISOString(),
            durationMins: values.durationMins,
            meetingUrl: values.meetingUrl || undefined,
            interviewerIds: values.interviewerIds,
          })
        }
      >
        <Form.Item name="round" label="轮次" rules={[{ required: true }]}>
          <InputNumber min={1} max={10} className="u-w-full" />
        </Form.Item>
        <Form.Item
          name="scheduledAt"
          label="面试时间"
          rules={[
            {
              validator: (_, v?: dayjs.Dayjs) =>
                !v || v.isAfter(dayjs()) ? Promise.resolve() : Promise.reject(new Error('面试时间不能早于现在')),
            },
          ]}
        >
          {/* 与改期弹窗一致：不能排到过去 */}
          <DatePicker
            showTime={{ format: 'HH:mm', minuteStep: 15 }}
            format="YYYY-MM-DD HH:mm"
            className="u-w-full"
            disabledDate={(d) => d.isBefore(dayjs(), 'day')}
          />
        </Form.Item>
        <Form.Item name="durationMins" label="时长（分钟）">
          <InputNumber min={15} max={480} step={15} className="u-w-full" />
        </Form.Item>
        <Form.Item
          name="interviewerIds"
          label="面试官"
          rules={[{ required: true, message: '至少指派一名面试官' }]}
        >
          <Select
            mode="multiple"
            placeholder="选择面试官"
            loading={usersQuery.isLoading}
            options={usersQuery.data
              ?.filter((u) => u.roles.some((ur) => INTERVIEWER_ELIGIBLE_ROLES.has(ur.role.code)))
              .map((u) => ({ value: u.id, label: u.name }))}
          />
        </Form.Item>
        <Form.Item name="meetingUrl" label="会议链接（可选，二期自动生成）">
          <Input placeholder="https://meeting.tencent.com/..." />
        </Form.Item>
      </Form>
    </FormModal>
  );
}
