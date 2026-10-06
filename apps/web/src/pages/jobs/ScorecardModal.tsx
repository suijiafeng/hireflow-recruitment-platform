import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Button, Form, Input, InputNumber, Space, Typography } from 'antd';
import { jobsApi } from '../../api';
import { extractErrorMessage } from '../../api/client';
import type { Job } from '../../api/types';
import { FormModal } from '../../components/FormModal';

/** 岗位评分卡模板配置 */
export function ScorecardModal({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ template: Array<{ dimension: string; weight: number }> }>();

  const saveMutation = useMutation({
    mutationFn: (template: Array<{ dimension: string; weight: number }>) =>
      jobsApi.update(job!.id, { scorecardTemplate: template }),
    onSuccess: () => {
      message.success('评分卡模板已保存，面评表单与 AI 草稿将按新维度出题');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['interviews'] });
      onClose();
    },
    onError: (error) => message.error(extractErrorMessage(error, '保存失败')),
  });

  return (
    <FormModal form={form}
      className="hf-modal"
      title={job ? `评分卡模板 · ${job.title}` : '评分卡模板'}
      open={Boolean(job)}
      classNames={{ body: 'modal-body-scroll' }}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={saveMutation.isPending}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary" className="u-meta">
        面评表单与 AI 面评草稿都会按此模板出维度（2-8 个）；权重供终审对比参考。
      </Typography.Paragraph>
      <Form
        form={form}
        initialValues={{
          template: job?.scorecardTemplate?.length
            ? job.scorecardTemplate
            : [
                { dimension: '技术能力', weight: 40 },
                { dimension: '工程素养', weight: 30 },
                { dimension: '沟通协作', weight: 30 },
              ],
        }}
        onFinish={(v) => saveMutation.mutate(v.template)}
      >
        <Form.List
          name="template"
          rules={[
            {
              validator: async (_, value: unknown[]) => {
                if (!value || value.length < 2) throw new Error('至少 2 个维度');
                if (value.length > 8) throw new Error('最多 8 个维度');
              },
            },
          ]}
        >
          {(fields, { add, remove }, { errors }) => (
            <>
              {fields.map((field) => (
                <Space key={field.key} align="baseline" className="u-flex-row u-mb-4">
                  <Form.Item
                    name={[field.name, 'dimension']}
                    rules={[{ required: true, message: '维度名必填' }, { max: 20 }]}
                  >
                    <Input placeholder="维度名，如：系统设计" className="w-220" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'weight']} rules={[{ required: true, message: '权重必填' }]}>
                    <InputNumber min={0} max={100} placeholder="权重" className="w-100" addonAfter="%" />
                  </Form.Item>
                  <Button type="link" danger size="small" onClick={() => remove(field.name)}>
                    删除
                  </Button>
                </Space>
              ))}
              <Button block type="dashed" icon={<PlusOutlined />} onClick={() => add({ dimension: '', weight: 10 })}>
                添加维度
              </Button>
              <Form.ErrorList errors={errors} />
            </>
          )}
        </Form.List>
      </Form>
    </FormModal>
  );
}
