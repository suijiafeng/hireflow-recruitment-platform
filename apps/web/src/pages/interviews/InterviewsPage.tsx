import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClockCircleOutlined, CloseOutlined, PlusOutlined, ScheduleOutlined } from '@ant-design/icons';
import { EVALUATION_CONCLUSION_LABEL, PERMISSIONS, type EvaluationConclusion } from '@hireflow/shared';
import { App, Button, DatePicker, Form, Popconfirm, Select, Spin, Table, Tooltip, Typography } from 'antd';
import type { TableProps } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import { interviewsApi } from '../../api';
import { extractErrorMessage } from '../../api/client';
import type { Interview, InterviewerSlot } from '../../api/types';
import { CandidateDetailDrawer } from '../../components/CandidateDetailDrawer';
import { useDrawerParam, useUrlState } from '../../hooks/useUrlState';
import { EvaluationModal } from '../../components/EvaluationModal';
import { RowActions } from '../../components/RowActions';
import { SetInterviewTimeModal } from '../../components/SetInterviewTimeModal';
import { useSyncedTableScroll } from '../../hooks/useSyncedTableScroll';
import { useAuthStore } from '../../stores/auth';
import { FormModal } from '../../components/FormModal';
import { pressable } from '../../utils/pressable';

/** 15 分钟一档的全天时间选项 */
const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const value = `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`;
  return { value, label: value };
});

const CONCLUSION_SHORT: Record<string, { text: string; cls: string }> = {
  STRONG_YES: { text: '强推', cls: 'hf-tag hf-tag--ok' },
  YES: { text: '推荐', cls: 'hf-tag hf-tag--ok' },
  NO: { text: '不推', cls: 'hf-tag hf-tag--warn' },
  STRONG_NO: { text: '强烈不推', cls: 'hf-tag hf-tag--err' },
};

/** 相对今天的自然语言日签 */
function dayLabel(date: string) {
  const d = dayjs(date);
  const diff = d.startOf('day').diff(dayjs().startOf('day'), 'day');
  if (diff === 0) return { text: '今天', today: true };
  if (diff === 1) return { text: '明天', today: false };
  if (diff === -1) return { text: '昨天', today: false };
  return { text: d.format('ddd'), today: false };
}

/** 单行时段。删除入口常驻（不靠 hover 才出现），已被预约的行根本不渲染删除按钮 */
function SlotRow({
  slot,
  onRemove,
  removing,
  onOpenBooked,
}: {
  slot: InterviewerSlot;
  onRemove: (id: string) => void;
  removing: boolean;
  onOpenBooked: (candidateId: string) => void;
}) {
  const time = `${dayjs(slot.startAt).format('HH:mm')} – ${dayjs(slot.endAt).format('HH:mm')}`;
  return (
    <div className={slot.bookedBy ? 'hf-slot hf-slot--booked' : 'hf-slot'}>
      <span className="hf-slot-time hf-td--num">{time}</span>
      <span className="u-flex-1" />
      {slot.bookedBy ? (
        <Tooltip
          title={
            slot.bookedCandidateId
              ? `${slot.bookedLabel}${slot.bookedRound ? ` · 第 ${slot.bookedRound} 轮` : ''}，点击查看候选人详情。要释放这个档需先改期或取消该面试`
              : '关联的面试已不存在（历史脏数据）。这个档不会被候选人选到，可联系管理员清理'
          }
        >
          <span
            className={slot.bookedCandidateId ? 'hf-slot-badge hf-slot-badge--link' : 'hf-slot-badge'}
            {...pressable(() => slot.bookedCandidateId && onOpenBooked(slot.bookedCandidateId))}
          >
            <span className="hf-ellipsis">
              {slot.bookedCandidateId ? (slot.bookedLabel ?? '已预约') : '面试已失效'}
            </span>
            <span>已约</span>
          </span>
        </Tooltip>
      ) : (
        <Popconfirm
          title="删除该时段？"
          description="删除后候选人自助选时链接将不再展示它。"
          okText="删除"
          okButtonProps={{ danger: true, loading: removing }}
          cancelText="取消"
          onConfirm={() => onRemove(slot.id)}
        >
          <button type="button" className="hf-slot-del" aria-label={`删除 ${time} 时段`} title="删除该时段">
            <CloseOutlined />
          </button>
        </Popconfirm>
      )}
    </div>
  );
}

/** 右栏：我的可约时段。按日分组（接口只返回未过期的档） */
function SlotsRail({ onOpenCandidate }: { onOpenCandidate: (candidateId: string) => void }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [form] = Form.useForm<{ dates: Dayjs[]; startTime: string; endTime: string }>();
  const startTime = Form.useWatch('startTime', form);
  const pickedDates = Form.useWatch('dates', form);

  const slotsQuery = useQuery({ queryKey: ['my-slots'], queryFn: interviewsApi.mySlots });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['my-slots'] });

  /** 一次可提交多天：接口按单个时段建，逐个发再汇总成败 */
  const addMutation = useMutation({
    mutationFn: async (ranges: Array<[Dayjs, Dayjs]>) => {
      const results = await Promise.allSettled(
        ranges.map(([a, b]) => interviewsApi.addSlot(a.toISOString(), b.toISOString())),
      );
      const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      return { ok: results.length - failed.length, failed };
    },
    onSuccess: ({ ok, failed }) => {
      if (ok > 0) message.success(`已添加 ${ok} 个时段，候选人可从中自助选时`);
      if (failed.length > 0) {
        message.warning(`${failed.length} 个未添加：${extractErrorMessage(failed[0].reason, '添加失败')}`);
      }
      if (ok > 0) {
        setAddOpen(false);
        form.resetFields();
      }
      void invalidate();
    },
    onError: (error) => message.error(extractErrorMessage(error, '添加失败')),
  });

  const removeMutation = useMutation({
    mutationFn: interviewsApi.removeSlot,
    onSuccess: () => {
      message.success('时段已删除');
      void invalidate();
    },
    onError: (error) => message.error(extractErrorMessage(error, '删除失败')),
  });

  const now = dayjs();
  const all = (slotsQuery.data ?? []).slice().sort((a, b) => a.startAt.localeCompare(b.startAt));

  // 分组键即展示文案，统一用 YYYY-MM-DD：MM-DD 既看不出年份，也会让不同年份的同月同日撞成一组
  const groups: Array<{ key: string; items: InterviewerSlot[] }> = [];
  all.forEach((s) => {
    const d = dayjs(s.startAt);
    const key = d.format('YYYY-MM-DD');
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(s);
    else groups.push({ key, items: [s] });
  });

  /** 选中的日期里，已存在的时段区间——用于提交前的重叠自检（后端也会拦，这里只是即时反馈） */
  const overlapsExisting = (start: Dayjs, end: Dayjs) =>
    all.some((s) => dayjs(s.startAt).isBefore(end) && dayjs(s.endAt).isAfter(start));

  // 只有「所选全是今天」才藏过去的钟点；混选今天+以后时仍给出全天选项，
  // 提交时再跳过已过的那几天，避免把明天上午也一起禁掉。
  const onlyToday = Boolean(pickedDates?.length && pickedDates.every((d) => d.isSame(now, 'day')));
  const startOptions = TIME_OPTIONS.filter((t) => !onlyToday || t.value > now.format('HH:mm'));
  const popupContainer = () => document.body;

  return (
    <div className="hf-panel hf-panel--grow">
      <div className="hf-panel-head">
        <span className="hf-panel-title">我的可约时段</span>
        <Button size="small" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
          添加
        </Button>
      </div>
      {/* .hf-notice 是 flex 容器：裸文本与 <b> 会各自成为 flex item 把句子拆开，
          必须包一个 span 让整句作为单个 flex item 正常流动 */}
      <div className="hf-notice hf-notice--flat">
        <span>
          候选人自助选时只会展示<b>未被预约</b>的档期。待安排的面试点「选时」即可把链接发给对方。
        </span>
      </div>
      <div className="hf-panel-body">
        {slotsQuery.isLoading ? (
          <Spin size="small" />
        ) : slotsQuery.isError ? (
          // 加载失败必须与「一条都没有」区分开：都渲染成空态会让人以为自己的档丢了
          <Typography.Text type="danger" className="hf-muted">
            时段加载失败，请刷新重试。
          </Typography.Text>
        ) : all.length === 0 ? (
          <Typography.Text type="secondary" className="hf-muted">
            尚未维护空闲时段。添加后，HR 发出的「候选人自助选时」链接将展示你的空闲档。
          </Typography.Text>
        ) : (
          groups.map((g) => {
            const free = g.items.filter((s) => !s.bookedBy).length;
            return (
              <div key={g.key} className="u-mb-16">
                <div className="u-flex-between u-mb-4">
                  <span className="u-flex-gap-8">
                    <span className="hf-group-title hf-td--num">{g.key}</span>
                    <span className="hf-faint">{dayLabel(g.items[0].startAt).text}</span>
                  </span>
                  <span className="hf-faint hf-td--num">
                    {free} / {g.items.length} 可约
                  </span>
                </div>
                {g.items.map((s) => (
                  <SlotRow
                    key={s.id}
                    slot={s}
                    onRemove={removeMutation.mutate}
                    removing={removeMutation.isPending && removeMutation.variables === s.id}
                    onOpenBooked={onOpenCandidate}
                  />
                ))}
              </div>
            );
          })
        )}
      </div>

      <FormModal form={form}
        className="hf-modal hf-modal--pickers"
        title="添加可约时段"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={addMutation.isPending}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ startTime: '10:00', endTime: '11:00' }}
          onFinish={(v) => {
            const [h1, m1] = v.startTime.split(':').map(Number);
            const [h2, m2] = v.endTime.split(':').map(Number);
            const ranges = v.dates.map(
              (d) =>
                [
                  d.hour(h1).minute(m1).second(0).millisecond(0),
                  d.hour(h2).minute(m2).second(0).millisecond(0),
                ] as [Dayjs, Dayjs],
            );
            const upcoming = ranges.filter(([a]) => a.isAfter(now));
            if (upcoming.length === 0) {
              message.error('所选时段已过，请换个时间');
              return;
            }
            const clash = upcoming.filter(([a, b]) => overlapsExisting(a, b));
            if (clash.length > 0) {
              message.error(`${clash.map(([a]) => a.format('MM-DD')).join('、')} 与已有时段重叠`);
              return;
            }
            if (upcoming.length < ranges.length) {
              message.warning(`已跳过 ${ranges.length - upcoming.length} 个已过时段`);
            }
            addMutation.mutate(upcoming);
          }}
        >
          <Form.Item
            name="dates"
            label="日期"
            extra="可多选，一次为多天添加同一时间段。档长建议与面试时长一致（默认 60 分钟）。"
            rules={[{ required: true, message: '请选择日期' }]}
          >
            <DatePicker
              multiple
              disabledDate={(d) => d.isBefore(dayjs(), 'day')}
              maxTagCount="responsive"
              className="u-w-full"
              getPopupContainer={popupContainer}
            />
          </Form.Item>
          <div className="u-flex-gap-12">
            <Form.Item
              name="startTime"
              label="开始时间"
              rules={[{ required: true, message: '请选择开始时间' }]}
              className="u-flex-1"
            >
              <Select
                showSearch
                placeholder="00:00"
                options={startOptions}
                getPopupContainer={popupContainer}
                onChange={() => form.setFieldValue('endTime', undefined)}
              />
            </Form.Item>
            <Form.Item
              name="endTime"
              label="结束时间"
              rules={[{ required: true, message: '请选择结束时间' }]}
              className="u-flex-1"
            >
              <Select
                showSearch
                placeholder="00:00"
                disabled={!startTime}
                getPopupContainer={popupContainer}
                options={TIME_OPTIONS.filter((t) => !startTime || t.value > startTime)}
              />
            </Form.Item>
          </div>
        </Form>
      </FormModal>
    </div>
  );
}

type Filter = 'all' | 'mine' | 'pending';

export function InterviewsPage() {
  const { message, modal } = App.useApp();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [evaluateFor, setEvaluateFor] = useState<string | null>(null);
  // 打开的候选人与筛选标签放在网址里：后退关抽屉、刷新不丢筛选
  const [detailId, openDetail, closeDetail] = useDrawerParam('candidate');
  const [scheduleFor, setScheduleFor] = useState<Interview | null>(null);
  const [filter, setFilter] = useUrlState<Filter>('tab', 'all');

  const interviewsQuery = useQuery({ queryKey: ['interviews', 'all'], queryFn: () => interviewsApi.list() });

  const copySelfScheduleLink = async (interviewId: string) => {
    try {
      const { token } = await interviewsApi.selfScheduleLink(interviewId);
      const url = `${window.location.origin}/portal/interview/${token}`;
      try {
        await navigator.clipboard.writeText(url);
        message.success('选时链接已复制，请发送给候选人');
      } catch {
        modal.info({
          title: '候选人选时链接',
          content: (
            <Typography.Text copyable className="u-break-all">
              {url}
            </Typography.Text>
          ),
        });
      }
    } catch (error) {
      message.error(extractErrorMessage(error, '获取链接失败'));
    }
  };

  const all = interviewsQuery.data ?? [];
  const needsMyEval = (iv: Interview) =>
    iv.status === 'COMPLETED' &&
    iv.interviewers.some((i) => i.user.id === currentUserId) &&
    !iv.evaluations.some((ev) => ev.interviewer.id === currentUserId);

  const upcoming = all.filter((iv) => iv.status === 'SCHEDULED').length;
  const pendingCount = all.filter((iv) => !iv.scheduledAt).length;
  const myEvalCount = all.filter(needsMyEval).length;

  const visible = all.filter((iv) => {
    if (filter === 'pending') return !iv.scheduledAt;
    if (filter === 'mine') return needsMyEval(iv);
    return true;
  });

  /** 按日分组：待安排单独成组排最上，其余按时间正序 */
  const noDate = visible.filter((iv) => !iv.scheduledAt);
  const dated = visible.filter((iv) => iv.scheduledAt).sort((a, b) => (a.scheduledAt! > b.scheduledAt! ? 1 : -1));
  const dayGroups: Array<{ key: string; label: string; today: boolean; items: Interview[] }> = [];
  dated.forEach((iv) => {
    const key = dayjs(iv.scheduledAt!).format('MM-DD');
    const last = dayGroups[dayGroups.length - 1];
    if (last && last.key === key) last.items.push(iv);
    else {
      const l = dayLabel(iv.scheduledAt!);
      dayGroups.push({ key, label: l.text, today: l.today, items: [iv] });
    }
  });
  const groups = [...(noDate.length ? [{ key: '待安排', label: '', today: false, items: noDate }] : []), ...dayGroups];

  /** 各分组的横向滚动串在一起，表头才能只留首组一行 */
  const groupListRef = useSyncedTableScroll<HTMLDivElement>();

  /** 所有分组共用同一套列定义，宽度写死，各组之间才对得齐 */
  const IV_TABLE_X = 836;
  const ivColumns: TableProps<Interview>['columns'] = [
    {
      title: '时间',
      key: 'time',
      // 60 减去单元格内边距后放不下「14:00」，会折成两行
      width: 76,
      render: (_, iv) => (
        <span className="hf-primary hf-primary--sm hf-td--num u-nowrap">
          {iv.scheduledAt ? dayjs(iv.scheduledAt).format('HH:mm') : '—'}
        </span>
      ),
    },
    {
      title: '',
      key: 'dot',
      width: 20,
      render: (_, iv) => {
        const pending = !iv.scheduledAt;
        const done = iv.status === 'COMPLETED';
        return (
          <span className="u-flex-center">
            <span className={pending ? 'hf-dot hf-dot--warn' : done ? 'hf-dot hf-dot--off' : 'hf-dot hf-dot--on'} />
          </span>
        );
      },
    },
    {
      title: '候选人',
      key: 'candidate',
      width: 150,
      ellipsis: true,
      onCell: (iv) => ({ title: iv.application?.candidate.name ?? '' }),
      render: (_, iv) => (
        <span className="hf-primary hf-primary--sm">{iv.application?.candidate.name ?? '—'}</span>
      ),
    },
    {
      title: '职位',
      key: 'job',
      width: 200,
      onCell: (iv) => ({ title: `${iv.application?.job.title ?? '—'} · 第 ${iv.round} 轮` }),
      render: (_, iv) => (
        <span className="u-flex-gap-8">
          <span className="hf-secondary hf-ellipsis">{iv.application?.job.title ?? '—'}</span>
          <span className="hf-faint">第 {iv.round} 轮</span>
        </span>
      ),
    },
    {
      title: '面试官',
      key: 'interviewers',
      width: 180,
      ellipsis: true,
      onCell: (iv) => ({ title: iv.interviewers.map((i) => i.user.name).join('、') }),
      render: (_, iv) => (
        <span className="hf-secondary">{iv.interviewers.map((i) => i.user.name).join('、') || '—'}</span>
      ),
    },
    {
      // 面评：结论缩为短标；未提交时按状态给不同弱化文案
      title: '面评',
      key: 'eval',
      width: 120,
      render: (_, iv) => {
        const evals = iv.evaluations.filter((ev) => ev.conclusion);
        if (evals.length === 0) {
          const pending = !iv.scheduledAt;
          const done = iv.status === 'COMPLETED';
          const mineTodo = needsMyEval(iv);
          return (
            <span className={mineTodo ? 'hf-faint hf-state--warn' : 'hf-faint'}>
              {pending ? '未安排' : done ? '待面评' : '面试后提交'}
            </span>
          );
        }
        return (
          <span className="u-flex-gap-6">
            {evals.map((ev) => {
              const c = CONCLUSION_SHORT[ev.conclusion!] ?? {
                text: EVALUATION_CONCLUSION_LABEL[ev.conclusion as EvaluationConclusion],
                cls: 'hf-tag',
              };
              return (
                <span key={ev.id} className={c.cls} title={`${ev.interviewer.name}：${c.text}`}>
                  {c.text}
                </span>
              );
            })}
          </span>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      align: 'right',
      fixed: 'right',
      render: (_, iv) => {
        const pending = !iv.scheduledAt;
        const canSchedule = hasPermission(PERMISSIONS.INTERVIEW_SCHEDULE);
        const canEvaluate = hasPermission(PERMISSIONS.EVALUATION_SUBMIT);
        const assignedToMe = iv.interviewers.some((i) => i.user.id === currentUserId);
        // 面试官没有「安排面试」权限，但本场被指派时可以自己发选时链接
        const canSendLink = pending && (canSchedule || assignedToMe);
        const detail = iv.application
          ? { key: 'detail', label: '详情', hint: '查看候选人详情', onClick: () => openDetail(iv.application!.candidate.id) }
          : null;
        return (
          <RowActions
            actions={[
              pending && canSchedule
                ? { key: 'schedule', label: '安排', hint: '直接填写面试时间', onClick: () => setScheduleFor(iv) }
                : null,
              canSendLink
                ? { key: 'link', label: '选时', hint: '生成自助选时链接发给候选人', onClick: () => void copySelfScheduleLink(iv.id) }
                : null,
              !pending && iv.status === 'SCHEDULED' && canSchedule
                ? { key: 'reschedule', label: '改期', hint: '修改面试时间（自动释放原档、占用新档）', onClick: () => setScheduleFor(iv) }
                : null,
              (iv.status === 'COMPLETED' || needsMyEval(iv)) && canEvaluate
                ? { key: 'evaluate', label: '面评', hint: '提交面试评价', onClick: () => setEvaluateFor(iv.id) }
                : null,
              detail,
            ]}
          />
        );
      },
    },
  ];

  return (
    <div className="hf-page">
      {/* 控制栏：分段筛选 + 概览计数 */}
      <div className="hf-bar">
        <div className="hf-bar-left">
          <div className="hf-seg">
            <span className={filter === 'all' ? 'hf-seg--on' : undefined} {...pressable(() => setFilter('all'))}>
              全部
            </span>
            <span className={filter === 'mine' ? 'hf-seg--on' : undefined} {...pressable(() => setFilter('mine'))}>
              待我面评
            </span>
            <span className={filter === 'pending' ? 'hf-seg--on' : undefined} {...pressable(() => setFilter('pending'))}>
              待安排
            </span>
          </div>
          <div className="hf-summary">
            <span>
              待进行 <b>{upcoming}</b> 场
            </span>
            <span className="sep" />
            <span className="warn">
              <ClockCircleOutlined />
              待我面评 <b>{myEvalCount}</b>
            </span>
            <span className="sep" />
            <span>
              待安排 <b>{pendingCount}</b>
            </span>
          </div>
        </div>
      </div>

      <div className="hf-body">
        <div className="hf-cols">
          {interviewsQuery.isLoading ? (
            <div className="hf-state-block">
              <Spin />
            </div>
          ) : groups.length === 0 ? (
            <div className="hf-state-block">
              <div className="hf-state-icon">
                <ScheduleOutlined />
              </div>
              <div>
                <div className="hf-state-title">{filter === 'all' ? '还没有面试安排' : '没有符合条件的面试'}</div>
                <div className="hf-state-desc">
                  {filter === 'all'
                    ? hasPermission(PERMISSIONS.INTERVIEW_SCHEDULE)
                      ? '在候选人详情里点「安排面试」，或把卡片拖到面试阶段，面试会自动出现在这里。'
                      : '被指派给你的面试会显示在这里。先在右侧添加可约时段，再用「选时」把链接发给候选人。'
                    : '切回「全部」查看所有面试。'}
                </div>
              </div>
            </div>
          ) : (
            /* 按日分组：每组一张独立的 Table。
               各组本是彼此独立的横向滚动容器，useSyncedTableScroll 把它们的 scrollLeft 串起来，
               于是表头只需首组保留一行——任何一组横滚，首组表头随其表体一起走，列不会错位。 */
            <div className="hf-agroup-list" ref={groupListRef}>
              {groups.map((g, gi) => (
                <div key={g.key} className="hf-agroup-item">
                  <div className="hf-group-head">
                    <span className="hf-group-title hf-td--num">{g.key}</span>
                    {g.label && (
                      <span className={g.today ? 'hf-group-badge hf-group-badge--today' : 'hf-group-badge'}>
                        {g.label}
                      </span>
                    )}
                    <span className="hf-group-count">{g.items.length} 场</span>
                  </div>
                  <div className="hf-atable hf-atable--fit">
                    <Table<Interview>
                      columns={ivColumns}
                      dataSource={g.items}
                      rowKey="id"
                      pagination={false}
                      showHeader={gi === 0}
                      scroll={{ x: IV_TABLE_X }}
                      rowClassName={(iv) => (!iv.scheduledAt ? 'hf-row--todo' : '')}
                    />
                  </div>
                </div>
              ))}
              <div className="hf-panel-foot hf-panel-foot--tight">
                <span>
                  待进行 {upcoming} 场 · 共 {all.length} 场面试
                </span>
              </div>
            </div>
          )}

          {/* 可约时段接口要求 evaluation:submit；没有该权限的角色不渲染右栏，避免「添加」点了必然 403 */}
          {hasPermission(PERMISSIONS.EVALUATION_SUBMIT) && (
            <div className="hf-rail hf-rail--narrow">
              <SlotsRail onOpenCandidate={openDetail} />
            </div>
          )}
        </div>
      </div>

      <EvaluationModal
        interviewId={evaluateFor}
        dimensions={all.find((i) => i.id === evaluateFor)?.application?.job.scorecardTemplate?.map((t) => t.dimension)}
        onClose={() => setEvaluateFor(null)}
      />
      <SetInterviewTimeModal interview={scheduleFor} onClose={() => setScheduleFor(null)} />
      <CandidateDetailDrawer candidateId={detailId} onClose={closeDetail} />
    </div>
  );
}
