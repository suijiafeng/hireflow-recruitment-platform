import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  HolderOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { PERMISSIONS } from '@hireflow/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Input, Space, Spin, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { jobsApi } from '../../api';
import { extractErrorMessage } from '../../api/client';
import type { Job, JobStage, JobStageInput } from '../../api/types';
import { FormModal } from '../../components/FormModal';
import { useAuthStore } from '../../stores/auth';
import './JobStagesModal.css';

interface DraftStage extends JobStageInput {
  key: string;
  applications: number;
}

const draftOf = (stages: JobStage[]): DraftStage[] =>
  stages.map((stage) => ({
    key: stage.id,
    id: stage.id,
    name: stage.name,
    applications: stage._count.applications,
  }));
const payloadOf = (stages: DraftStage[]): JobStageInput[] =>
  stages.map(({ id, name }) => ({
    ...(id ? { id } : {}),
    name: name.trim(),
  }));

function StageRow({
  stage,
  index,
  total,
  disabled,
  onName,
  onMove,
  onDelete,
}: {
  stage: DraftStage;
  index: number;
  total: number;
  disabled: boolean;
  onName: (name: string) => void;
  onMove: (offset: number) => void;
  onDelete: () => void;
}) {
  const drag = useDraggable({ id: stage.key, disabled });
  const drop = useDroppable({ id: stage.key, disabled });
  const deleteReason =
    stage.applications > 0
      ? `仍有 ${stage.applications} 条应聘记录，请先在看板移出候选人`
      : total <= 1
        ? '至少保留一个阶段'
        : undefined;

  return (
    <li ref={drop.setNodeRef} className={`hf-stage-row${drop.isOver ? ' hf-stage-row--over' : ''}`}>
      <div
        ref={drag.setNodeRef}
        className="hf-stage-row-content"
        style={{ opacity: drag.isDragging ? 0.45 : 1 }}
      >
        <Button
          ref={drag.setActivatorNodeRef}
          {...drag.attributes}
          {...drag.listeners}
          className="hf-stage-handle"
          aria-label={`拖动阶段 ${index + 1}`}
          title="拖动排序，也可使用右侧上移、下移按钮"
          icon={<HolderOutlined />}
          disabled={disabled}
        />
        <span className="hf-muted">{index + 1}</span>
        <div className="hf-stage-name">
          <Input
            aria-label={`阶段 ${index + 1} 名称`}
            value={stage.name}
            placeholder="阶段名称"
            status={!stage.name.trim() ? 'error' : undefined}
            disabled={disabled}
            onChange={(event) => onName(event.target.value)}
          />
          <Typography.Text type="secondary">
            {stage.id ? `${stage.applications} 条应聘记录` : '新增阶段，保存后生效'}
          </Typography.Text>
        </div>
        <Space size={0}>
          <Button
            aria-label={`上移阶段 ${index + 1}`}
            icon={<ArrowUpOutlined />}
            disabled={disabled || index === 0}
            onClick={() => onMove(-1)}
          />
          <Button
            aria-label={`下移阶段 ${index + 1}`}
            icon={<ArrowDownOutlined />}
            disabled={disabled || index === total - 1}
            onClick={() => onMove(1)}
          />
          <span title={deleteReason}>
            <Button
              danger
              aria-label={`删除阶段 ${index + 1}`}
              disabled={disabled || Boolean(deleteReason)}
              onClick={onDelete}
            >
              删除
            </Button>
          </span>
        </Space>
      </div>
    </li>
  );
}

/** 草稿只属于本次弹窗；任何不确定的保存结果都必须重新读取，绝不自动重放 PUT。 */
export function JobStagesModal({ job, onClose }: { job: Job; onClose: () => void }) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const canManage = useAuthStore(
    (state) => state.user?.permissions.includes(PERMISSIONS.JOB_STAGES_MANAGE) ?? false,
  );
  const [draft, setDraft] = useState<DraftStage[]>([]);
  const [baseline, setBaseline] = useState('[]');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [needsReload, setNeedsReload] = useState(false);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const dirty = JSON.stringify(payloadOf(draft)) !== baseline;
  const disabled = loading || saving || needsReload || !canManage;

  async function load() {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setError('');
    try {
      const stages = draftOf(await jobsApi.getStages(job.id, request.signal));
      if (request.signal.aborted) return;
      setDraft(stages);
      setBaseline(JSON.stringify(payloadOf(stages)));
      setNeedsReload(false);
    } catch (cause) {
      if (!request.signal.aborted) {
        setError(extractErrorMessage(cause, '读取招聘流程失败，请重试'));
        setNeedsReload(true);
      }
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    return () => controller.current?.abort();
    // 每个职位使用独立实例，后台刷新不会覆盖未保存草稿。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  function reload() {
    if (dirty) {
      modal.confirm({
        title: '重新读取招聘流程？',
        content: '将丢弃当前草稿，并以服务端最新阶段为准。',
        okText: '丢弃草稿并读取',
        cancelText: '保留草稿',
        onOk: load,
      });
    } else {
      void load();
    }
  }

  function move(key: string, target: number) {
    if (disabled) return;
    setDraft((current) => {
      const from = current.findIndex((stage) => stage.key === key);
      if (from < 0 || target < 0 || target >= current.length || from === target) return current;
      const next = [...current];
      next.splice(target, 0, next.splice(from, 1)[0]);
      return next;
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (over)
      move(
        String(active.id),
        draft.findIndex((stage) => stage.key === over.id),
      );
  }

  async function invalidate() {
    // PUT 返回丢失或服务端写入后报错时也可能已经提交，相关页面都要重新读取。
    await Promise.allSettled(
      [['jobs'], ['board', job.id], ['funnel', job.id], ['candidate-detail'], ['activity-log']].map(
        (queryKey) => queryClient.invalidateQueries({ queryKey }),
      ),
    );
  }

  async function save() {
    if (disabled || inFlight.current || !dirty) return;
    const payload = payloadOf(draft);
    if (!payload.length || payload.some((stage) => !stage.name)) {
      setError('至少保留一个阶段，且阶段名称不能为空');
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError('');
    let saved = false;
    try {
      const stages = draftOf(await jobsApi.updateStages(job.id, payload));
      setDraft(stages);
      setBaseline(JSON.stringify(payloadOf(stages)));
      saved = true;
    } catch (cause) {
      setError(
        `${extractErrorMessage(cause, '保存结果未确认')}。请重新读取服务端流程后再编辑保存。`,
      );
      setNeedsReload(true);
    } finally {
      await invalidate();
      inFlight.current = false;
      setSaving(false);
    }
    if (saved) {
      message.success('招聘流程已保存');
      onClose();
    }
  }

  return (
    <FormModal
      open
      className="hf-modal"
      title={`招聘流程 · ${job.title}`}
      width={720}
      isDirty={() => dirty}
      onCancel={() => {
        if (!inFlight.current) onClose();
      }}
      onOk={() => void save()}
      okText="保存流程"
      cancelText="取消"
      okButtonProps={{
        disabled: disabled || !dirty || !draft.length || draft.some((stage) => !stage.name.trim()),
      }}
      confirmLoading={saving}
      cancelButtonProps={{ disabled: saving }}
      closable={!saving}
      keyboard={!saving}
      mask={{ closable: false }}
      classNames={{ body: 'modal-body-scroll' }}
    >
      <Typography.Paragraph type="secondary">
        从上到下为候选人流转顺序。拖动手柄或使用上移、下移按钮排序，保存后生效。
        至少保留一个阶段；有应聘记录的阶段须先在看板移出候选人才能删除。
      </Typography.Paragraph>
      {!canManage && <Alert type="warning" showIcon title="当前账号已无配置招聘流程权限" />}
      {error && <Alert type="error" showIcon title={error} />}
      {needsReload && (
        <Button className="u-mt-8" onClick={reload} disabled={loading || saving}>
          重新读取服务端流程
        </Button>
      )}
      {loading ? (
        <div className="hf-state-block" role="status" aria-label="读取招聘流程">
          <Spin />
        </div>
      ) : (
        <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <ol className="hf-stage-list" aria-label="招聘阶段列表">
              {draft.map((stage, index) => (
                <StageRow
                  key={stage.key}
                  stage={stage}
                  index={index}
                  total={draft.length}
                  disabled={disabled}
                  onName={(name) =>
                    setDraft((current) =>
                      current.map((item) => (item.key === stage.key ? { ...item, name } : item)),
                    )
                  }
                  onMove={(offset) => move(stage.key, index + offset)}
                  onDelete={() =>
                    setDraft((current) =>
                      current.length > 1 && stage.applications === 0
                        ? current.filter((item) => item.key !== stage.key)
                        : current,
                    )
                  }
                />
              ))}
            </ol>
          </DndContext>
          <Button
            block
            type="dashed"
            aria-label="添加阶段"
            icon={<PlusOutlined />}
            disabled={disabled}
            onClick={() =>
              setDraft((current) => [
                ...current,
                { key: `new:${crypto.randomUUID()}`, name: '', applications: 0 },
              ])
            }
          >
            添加阶段
          </Button>
        </>
      )}
    </FormModal>
  );
}
