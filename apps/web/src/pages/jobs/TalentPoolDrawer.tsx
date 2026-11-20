import { ThunderboltOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Drawer, Space, Spin, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { jobsApi } from '../../api';
import { extractErrorMessage } from '../../api/client';
import type { Job, TalentPoolScanResult } from '../../api/types';
import { EmptyBlock } from '../../components/ui';

/** 人才库唤醒抽屉：打开即扫描，AI 打分推荐 + 一键激活 */
export function TalentPoolDrawer({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<TalentPoolScanResult | null>(null);
  const [activated, setActivated] = useState<Set<string>>(new Set());

  const scanMutation = useMutation({
    mutationFn: (jobId: string) => jobsApi.talentPoolScan(jobId),
    onSuccess: setResult,
    onError: (error) => message.error(extractErrorMessage(error, '扫描失败')),
  });

  const activateMutation = useMutation({
    mutationFn: (candidateId: string) => jobsApi.talentPoolActivate(job!.id, candidateId),
    onSuccess: (_card, candidateId) => {
      setActivated((prev) => new Set(prev).add(candidateId));
      message.success('已激活：新应聘已进入简历初筛');
      void queryClient.invalidateQueries({ queryKey: ['board'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (error) => message.error(extractErrorMessage(error, '激活失败')),
  });

  return (
    <Drawer
      className="hf-drawer"
      title={job ? `人才库唤醒 · ${job.title}` : '人才库唤醒'}
      size={560}
      open={Boolean(job)}
      onClose={() => {
        setResult(null);
        setActivated(new Set());
        onClose();
      }}
      destroyOnHidden
      afterOpenChange={(open) => {
        if (open && job) scanMutation.mutate(job.id);
      }}
    >
      {scanMutation.isPending ? (
        <div className="loading-center loading-center--xl">
          <Spin description="AI 正在按本职位要求重新评估历史候选人…" />
        </div>
      ) : !result ? (
        <EmptyBlock minHeight={200} description="扫描未完成，请关闭后重试" />
      ) : result.recommendations.length === 0 ? (
        <EmptyBlock minHeight={200} description={`已扫描 ${result.scanned} 位历史候选人，暂无匹配推荐`} />
      ) : (
        <>
          <Alert
            type="info"
            showIcon
            className="u-mb-16"
            title={`已扫描 ${result.scanned} 位历史淘汰/撤回候选人，按匹配度推荐 ${result.recommendations.length} 位`}
            description={[
              result.aiScored != null && result.aiScored < result.scanned
                ? `先按标签粗排，只对最相关的 ${result.aiScored} 位做 AI 精排`
                : '',
              result.degraded ? `${result.degraded} 位因 AI 引擎降级由规则引擎估算，已排在后面、不参与排序` : '',
              result.skipped ? `${result.skipped} 位超出本次时间预算未评估，可稍后重试` : '',
            ]
              .filter(Boolean)
              .join('；') || undefined}
          />
          {result.recommendations.map((rec) => (
            <Card key={rec.candidate.id} size="small" className="u-mb-16 talent-pool-card">
              <div className="u-flex-between">
                <Space>
                  <Typography.Text className="talent-pool-name">{rec.candidate.name}</Typography.Text>
                  <Tag color={rec.score >= 85 ? 'success' : rec.score >= 70 ? 'processing' : 'default'}>
                    匹配 {rec.score}
                  </Tag>
                  {rec.ranked === false && <Tag className="tag-meta">规则估算 · 未参与排序</Tag>}
                </Space>
                <Button
                  size="small"
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  disabled={activated.has(rec.candidate.id)}
                  loading={activateMutation.isPending && activateMutation.variables === rec.candidate.id}
                  onClick={() => activateMutation.mutate(rec.candidate.id)}
                >
                  {activated.has(rec.candidate.id) ? '已激活' : '激活到本职位'}
                </Button>
              </div>
              <div className="kanban-card-tags u-mt-8">
                {rec.hits.map((h) => (
                  <Tag key={h} className="tag-meta">
                    {h}
                  </Tag>
                ))}
              </div>
              <Typography.Paragraph className="talent-pool-highlights u-mb-4">{rec.highlights}</Typography.Paragraph>
              {rec.lastApplication && (
                <Typography.Text className="talent-pool-meta">
                  上次：{rec.lastApplication.jobTitle} ·{' '}
                  {rec.lastApplication.status === 'WITHDRAWN' ? '已撤回' : '已淘汰'}
                  {rec.lastApplication.rejectReason ? `（${rec.lastApplication.rejectReason}）` : ''} ·{' '}
                  {dayjs(rec.lastApplication.updatedAt).format('YYYY-MM-DD')}
                </Typography.Text>
              )}
            </Card>
          ))}
        </>
      )}
    </Drawer>
  );
}
