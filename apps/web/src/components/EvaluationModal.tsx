import { RobotOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AI_DRAFT_MARKER,
  DEFAULT_SCORECARD_TEMPLATE,
  EVALUATION_CONCLUSION_LABEL,
  EvaluationConclusion,
} from '@hireflow/shared';
import { App, Button, Form, Input } from 'antd';
import { useEffect, useState } from 'react';
import { interviewsApi } from '../api';
import { extractErrorMessage } from '../api/client';
import { FormModal } from './FormModal';
import { pressable } from '../utils/pressable';

const DEFAULT_DIMENSIONS = DEFAULT_SCORECARD_TEMPLATE.map((t) => t.dimension);
const SCORES = [1, 2, 3, 4, 5];

interface Props {
  interviewId: string | null;
  /** 岗位评分卡模板维度；缺省用全局默认 */
  dimensions?: string[];
  /** 弹窗副标题的上下文（候选人 · 职位 · 轮次），可选 */
  subtitle?: string;
  onClose: () => void;
}

/** 1-5 分段打分：取代 Rate 星级——星级占地方、难比较、也不便键盘输入 */
function ScoreSegments({ value, onChange }: { value?: number; onChange?: (v: number) => void }) {
  return (
    <div className="hf-score" role="radiogroup">
      {SCORES.map((n) => (
        <span
          key={n}
          className={value === n ? 'is-on' : value != null && n < value ? 'is-below' : undefined}
          {...pressable(() => onChange?.(n), { role: 'radio', checked: value === n })}
        >
          {n}
        </span>
      ))}
    </div>
  );
}

/** 结论分段：推荐档走正向色，不推荐档走预警/错误色 */
function ConclusionSegments({ value, onChange }: { value?: string; onChange?: (v: string) => void }) {
  const items = Object.values(EvaluationConclusion);
  return (
    <div className="hf-conclusion" role="radiogroup">
      {items.map((v) => {
        const good = v === 'STRONG_YES' || v === 'YES';
        const cls = value === v ? (good ? 'is-on is-ok' : 'is-on is-warn') : undefined;
        return (
          <span key={v} className={cls} {...pressable(() => onChange?.(v), { role: 'radio', checked: value === v })}>
            {EVALUATION_CONCLUSION_LABEL[v]}
          </span>
        );
      })}
    </div>
  );
}

/** 面评草稿：按面试场次存在本机，刷新 / 误关 / 断网后都能找回；提交成功或主动放弃时清除 */
const draftKey = (interviewId: string) => `hf-eval-draft:${interviewId}`;
type EvalDraft = { notes: string; values: Record<string, unknown> };

function readDraft(interviewId: string): EvalDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(interviewId));
    return raw ? (JSON.parse(raw) as EvalDraft) : null;
  } catch {
    return null;
  }
}

function writeDraft(interviewId: string, draft: EvalDraft) {
  try {
    localStorage.setItem(draftKey(interviewId), JSON.stringify(draft));
  } catch {
    /* 隐私模式 / 存储已满：草稿只是兜底，失败不打断填写 */
  }
}

function clearDraft(interviewId: string) {
  try {
    localStorage.removeItem(draftKey(interviewId));
  } catch {
    /* 同上 */
  }
}

type EvaluationValues = { scores: Record<string, number>; conclusion: string; comments?: string };

/** 结构化评分卡面评：AI 生成草稿 → 面试官修改确认 */
export function EvaluationModal({ interviewId, dimensions, subtitle, onClose }: Props) {
  const dims = dimensions?.length ? dimensions : DEFAULT_DIMENSIONS;
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [notes, setNotes] = useState('');

  // 弹窗组件常驻，换一场面试时先清空上一场的残留，再恢复本场草稿
  useEffect(() => {
    if (!interviewId) return;
    form.resetFields();
    const draft = readDraft(interviewId);
    setNotes(draft?.notes ?? '');
    if (draft) {
      form.setFieldsValue(draft.values);
      message.info('已恢复上次未提交的面评草稿');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewId]);

  const saveDraft = (nextNotes = notes) => {
    if (interviewId) writeDraft(interviewId, { notes: nextNotes, values: form.getFieldsValue(true) });
  };

  /** 关闭：未改动直接关；有改动时 FormModal 会先确认，确认放弃才走到这里，草稿一并清除 */
  const close = () => {
    if (interviewId) clearDraft(interviewId);
    form.resetFields();
    setNotes('');
    onClose();
  };

  const draftMutation = useMutation({
    mutationFn: () => interviewsApi.draftEvaluation(interviewId!, notes),
    onSuccess: (draft) => {
      const scores: Record<string, number> = {};
      draft.scorecard.forEach((s) => {
        scores[s.dimension] = s.score;
      });
      form.setFieldsValue({ scores, conclusion: draft.conclusion, comments: draft.comments });
      saveDraft();
      message.success(
        draft.aiMeta.provider === 'mock' ? '草稿已生成（规则引擎）——请务必核对修改' : 'AI 草稿已生成，请核对修改后提交',
      );
    },
    onError: (error) => message.error(extractErrorMessage(error, '草稿生成失败')),
  });

  const submitMutation = useMutation({
    mutationFn: (values: EvaluationValues) =>
      interviewsApi.submitEvaluation(interviewId!, {
        scorecard: dims.map((dimension) => ({ dimension, score: values.scores[dimension] })),
        conclusion: values.conclusion,
        comments: values.comments,
      }),
    onSuccess: () => {
      message.success('面评已提交');
      close();
      void queryClient.invalidateQueries({ queryKey: ['candidate-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['interviews'] });
    },
    onError: (error) => message.error(extractErrorMessage(error, '提交失败')),
  });

  return (
    <FormModal
      form={form}
      isDirty={() => notes.trim().length > 0}
      className="hf-modal"
      width={560}
      title={
        <>
          提交面试评价
          {subtitle && <div className="hf-modal-sub">{subtitle}</div>}
        </>
      }
      open={Boolean(interviewId)}
      onCancel={close}
      onOk={() => form.submit()}
      okText="提交面评"
      confirmLoading={submitMutation.isPending}
      footer={(_, { OkBtn, CancelBtn }) => (
        <>
          <span className="hf-modal-hint">填写内容自动保存在本机，提交后清除</span>
          <CancelBtn />
          <OkBtn />
        </>
      )}
      destroyOnHidden
    >
      {/* AI 辅助区：中性灰底，不用蓝底 Alert */}
      <div className="hf-ai-box u-mb-16">
        <div className="hf-ai-head">
          <RobotOutlined /> 面试 Copilot
          <span className="hf-faint">规则引擎</span>
        </div>
        <div className="hf-ai-desc">粘贴面试记录，AI 生成评分卡草稿；最终以你修改确认的为准。</div>
        <Input.TextArea
          className="u-mt-8"
          rows={3}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            saveDraft(e.target.value);
          }}
          placeholder="如：候选人对高并发场景方案设计清晰，Redis 经验扎实，但分布式事务理解较浅…"
        />
        <div className="u-flex-between u-mt-8">
          <span className="hf-faint">至少 10 字后可生成</span>
          <Button
            size="small"
            icon={<RobotOutlined />}
            loading={draftMutation.isPending}
            disabled={notes.trim().length < 10}
            onClick={() => draftMutation.mutate()}
          >
            生成草稿
          </Button>
        </div>
      </div>

      <Form
        form={form}
        layout="vertical"
        onValuesChange={() => saveDraft()}
        onFinish={(values: EvaluationValues) => {
          // 分数和结论方向相反时多问一句：这份面评会直接影响 Offer 决策
          const scores = dims.map((d) => values.scores[d]).filter((n): n is number => typeof n === 'number');
          const avg = scores.reduce((a, b) => a + b, 0) / Math.max(scores.length, 1);
          const positive = values.conclusion === 'YES' || values.conclusion === 'STRONG_YES';
          const mismatch = (positive && avg < 3) || (!positive && avg >= 3.5);
          if (!mismatch) return submitMutation.mutate(values);
          modal.confirm({
            title: '结论与评分不太一致',
            content: `各维度平均 ${avg.toFixed(1)} 分，结论却是「${
              EVALUATION_CONCLUSION_LABEL[values.conclusion as EvaluationConclusion]
            }」。确认按此提交？`,
            okText: '确认提交',
            cancelText: '返回修改',
            focusable: { autoFocusButton: 'cancel' },
            onOk: () => submitMutation.mutate(values),
          });
        }}
      >
        <div className="hf-caption u-mb-8">评分卡 · 岗位模板 {dims.length} 维</div>
        {dims.map((dimension) => (
          <Form.Item
            key={dimension}
            name={['scores', dimension]}
            label={dimension}
            rules={[{ required: true, message: `请为「${dimension}」打分` }]}
          >
            <ScoreSegments />
          </Form.Item>
        ))}

        <Form.Item name="conclusion" label="结论" rules={[{ required: true, message: '请选择结论' }]}>
          <ConclusionSegments />
        </Form.Item>

        <Form.Item
          name="comments"
          label="评语"
          rules={[
            {
              validator: (_, v?: string) =>
                v?.includes(AI_DRAFT_MARKER)
                  ? Promise.reject(new Error(`请核对评语内容，并删除开头的「${AI_DRAFT_MARKER}」`))
                  : Promise.resolve(),
            },
          ]}
        >
          <Input.TextArea rows={4} placeholder="优缺点、技术亮点、风险提示…" />
        </Form.Item>
      </Form>
    </FormModal>
  );
}
