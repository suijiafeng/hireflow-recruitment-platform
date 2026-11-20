import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Form, Input } from 'antd';
import { authApi } from '../api';
import { extractErrorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { FormModal } from './FormModal';

/** 与后端 PASSWORD_RULE 一致：8–72 位，同时含字母和数字 */
export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;

/**
 * 修改自己的密码。成功后后端把其他设备上的登录全部作废，并给当前会话签发新令牌——
 * 这里换上新令牌，用户留在原页面，不用重新登录。
 */
export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ currentPassword: string; newPassword: string; confirm: string }>();
  const { user, setAuth } = useAuthStore();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (v: { currentPassword: string; newPassword: string }) => authApi.changePassword(v),
    onSuccess: ({ accessToken }) => {
      if (user) setAuth(accessToken, user);
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      message.success('密码已修改，其他设备上的登录已失效');
      form.resetFields();
      onClose();
    },
    onError: (error) => message.error(extractErrorMessage(error, '修改失败')),
  });
  return (
    <FormModal
      title="修改密码"
      open={open}
      form={form}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      onOk={() => form.submit()}
      okText="确认修改"
      confirmLoading={mutation.isPending}
    >
      <Alert
        type="info"
        showIcon
        className="u-mb-16"
        title="修改后，其他电脑和手机上的登录会立即失效，当前页面保持登录。"
      />
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={({ currentPassword, newPassword }) => mutation.mutate({ currentPassword, newPassword })}
      >
        <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}>
          <Input.Password autoComplete="current-password" autoFocus />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码"
          extra="8–72 位，同时包含字母和数字"
          rules={[
            { required: true, message: '请输入新密码' },
            { pattern: PASSWORD_RULE, message: '新密码需 8–72 位，且同时包含字母和数字' },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="确认新密码"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator: (_, v) =>
                !v || v === getFieldValue('newPassword') ? Promise.resolve() : Promise.reject(new Error('两次输入不一致')),
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </FormModal>
  );
}
