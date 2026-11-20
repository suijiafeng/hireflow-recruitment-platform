import { CheckCircleFilled, ExclamationCircleFilled, InboxOutlined, LoadingOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Form, Modal, Select, Upload } from 'antd';
import { useState } from 'react';
import { candidatesApi, jobsApi } from '../api';
import { extractErrorMessage } from '../api/client';
import type { IntakeResult } from '../api/types';
import { useAppDialogs } from '../hooks/useAppDialogs';
import { MAX_UPLOAD_BYTES } from '../utils/prepareUpload';

export const CANDIDATE_SOURCES = ['BOSS直聘', '猎聘', '拉勾', '内推', '猎头推荐', '官网投递', '人才库唤醒'];

const ACCEPT = '.pdf,.docx,.txt';

type Row =
  | { uid: string; name: string; state: 'waiting' | 'running' }
  | { uid: string; name: string; state: 'done'; result: IntakeResult }
  | { uid: string; name: string; state: 'failed'; error: string };

interface Props {
  open: boolean;
  onClose: () => void;
  /** 点结果里的姓名打开候选人详情 */
  onOpenCandidate: (id: string) => void;
  defaultJobId?: string;
}

/**
 * 上传简历自动建档：选职位 → 拖入一份或多份 PDF / Word / 文本 →
 * 逐份走「抽取 → 去重 → AI 解析 → 投递 → AI 评分」，每份单独给出结果。
 * 逐份顺序处理而不是并发：AI 调用有限流，并发只会让后面的排队超时。
 */
export function ResumeIntakeModal({ open, onClose, onOpenCandidate, defaultJobId }: Props) {
  const queryClient = useQueryClient();
  const { message } = useAppDialogs();
  const [form] = Form.useForm<{ jobId: string; source?: string }>();
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);

  const jobsQuery = useQuery({
    queryKey: ['jobs', 'open-options'],
    queryFn: () => jobsApi.list({ page: 1, pageSize: 100, status: 'OPEN' }),
    enabled: open,
  });

  const reset = () => {
    setFiles([]);
    setRows([]);
    form.resetFields();
  };

  const run = async ({ jobId, source }: { jobId: string; source?: string }) => {
    const queue = files.map((f, i) => ({ uid: `${i}-${f.name}`, file: f }));
    setRows(queue.map((q) => ({ uid: q.uid, name: q.file.name, state: 'waiting' })));
    setFiles([]);
    setRunning(true);
    for (const item of queue) {
      setRows((prev) => prev.map((r) => (r.uid === item.uid ? { ...r, state: 'running' } : r)));
      try {
        const result = await candidatesApi.intake(item.file, { jobId, source });
        setRows((prev) => prev.map((r) => (r.uid === item.uid ? { uid: r.uid, name: r.name, state: 'done', result } : r)));
      } catch (error) {
        const message = extractErrorMessage(error, '处理失败');
        setRows((prev) => prev.map((r) => (r.uid === item.uid ? { uid: r.uid, name: r.name, state: 'failed', error: message } : r)));
      }
    }
    setRunning(false);
    void queryClient.invalidateQueries({ queryKey: ['candidates'] });
    void queryClient.invalidateQueries({ queryKey: ['board'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const finished = rows.length > 0 && !running;

  return (
    <Modal
      className="hf-modal"
      title={
        <>
          上传简历
          <div className="hf-modal-sub">自动识别联系方式、按邮箱 / 手机号去重，AI 解析后投递并评分</div>
        </>
      }
      open={open}
      onCancel={() => {
        if (running) return;
        reset();
        onClose();
      }}
      maskClosable={!running}
      destroyOnHidden
      footer={
        finished ? (
          <>
            <Button onClick={() => setRows([])}>继续上传</Button>
            <Button
              type="primary"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              完成
            </Button>
          </>
        ) : (
          <>
            <Button disabled={running} onClick={() => { reset(); onClose(); }}>
              取消
            </Button>
            <Button type="primary" loading={running} disabled={files.length === 0} onClick={() => form.submit()}>
              {running ? '处理中…' : `开始处理${files.length > 1 ? `（${files.length} 份）` : ''}`}
            </Button>
          </>
        )
      }
    >
      {rows.length === 0 ? (
        <Form form={form} layout="vertical" onFinish={run} initialValues={{ jobId: defaultJobId }}>
          <Form.Item name="jobId" label="投递职位" rules={[{ required: true, message: '请选择职位' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择在招职位"
              loading={jobsQuery.isPending}
              options={(jobsQuery.data?.items ?? []).map((j) => ({ value: j.id, label: `${j.title}（${j.department.name}）` }))}
              notFoundContent={jobsQuery.isSuccess ? '没有在招职位' : undefined}
            />
          </Form.Item>
          <Form.Item name="source" label="来源渠道">
            <Select allowClear placeholder="可选" options={CANDIDATE_SOURCES.map((s) => ({ value: s, label: s }))} />
          </Form.Item>
          <Upload.Dragger
            accept={ACCEPT}
            multiple
            fileList={files.map((f, i) => ({ uid: `${i}-${f.name}`, name: f.name, status: 'done' as const }))}
            beforeUpload={(file) => {
              const f = file as unknown as File;
              if (f.size > MAX_UPLOAD_BYTES) {
                message.error(`「${f.name}」超过 10MB`);
              } else if (!/\.(pdf|docx|txt)$/i.test(f.name)) {
                message.error(`「${f.name}」格式不支持：仅支持 PDF、Word（.docx）和纯文本，图片或 .doc 请手工新增候选人`);
              } else {
                setFiles((prev) => (prev.length >= 20 ? prev : [...prev, f]));
              }
              return false;
            }}
            onRemove={(file) => setFiles((prev) => prev.filter((f, i) => `${i}-${f.name}` !== file.uid))}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖入简历（PDF / Word .docx / 文本，单份 ≤10MB，一次最多 20 份）</p>
            <p className="ant-upload-hint hf-faint">同一邮箱或手机号的候选人会合并到原档案，不会重复建人</p>
          </Upload.Dragger>
        </Form>
      ) : (
        <div className="intake-results">
          {rows.map((row) => (
            <div className="intake-row" key={row.uid}>
              <span className="intake-icon">
                {row.state === 'done' ? (
                  <CheckCircleFilled className={row.result.warnings.length ? 'hf-warn' : 'hf-ok'} />
                ) : row.state === 'failed' ? (
                  <ExclamationCircleFilled className="hf-err" />
                ) : row.state === 'running' ? (
                  <LoadingOutlined />
                ) : (
                  <span className="hf-dot" />
                )}
              </span>
              <div className="intake-body">
                <div className="intake-head">
                  {row.state === 'done' ? (
                    <a onClick={() => onOpenCandidate(row.result.candidate.id)}>{row.result.candidate.name}</a>
                  ) : (
                    <span>{row.name}</span>
                  )}
                  {row.state === 'done' && (
                    <>
                      <span className={row.result.created ? 'hf-tag hf-tag--on' : 'hf-tag'}>
                        {row.result.created ? '新建档案' : `按${row.result.matchedBy === 'email' ? '邮箱' : '手机号'}合并`}
                      </span>
                      {row.result.score != null && <span className="hf-tag hf-tag--ok">匹配分 {row.result.score}</span>}
                    </>
                  )}
                  {row.state === 'waiting' && <span className="hf-faint">排队中</span>}
                  {row.state === 'running' && <span className="hf-faint">解析与评分中…</span>}
                </div>
                {row.state === 'done' && (
                  <div className="hf-faint">
                    {row.name}
                    {row.result.skills.length > 0 && ` · 技能：${row.result.skills.slice(0, 6).join('、')}`}
                    {row.result.backfilled.length > 0 && ` · 补充了${row.result.backfilled.join('、')}`}
                  </div>
                )}
                {row.state === 'done' &&
                  row.result.warnings.map((w) => (
                    <div className="hf-warn-text" key={w}>
                      {w}
                    </div>
                  ))}
                {row.state === 'failed' && <div className="hf-err-text">{row.error}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
