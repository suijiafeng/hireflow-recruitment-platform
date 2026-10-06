import { CheckOutlined, RocketOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Result, Spin } from 'antd';
import type { AxiosError } from 'axios';
import dayjs from 'dayjs';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { portalApi } from '../../api';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { extractErrorMessage } from '../../api/client';
import { pressable } from '../../utils/pressable';

/**
 * 免登录 H5 外壳：深色品牌头 + 单列滚动内容 + 固定底部主操作。
 * 四个门户页（Offer / 面试选时 / 入职资料 / 预筛问卷）共用这一套。
 */
export function PortalShell({
  title,
  desc,
  company = 'ART 科技有限公司',
  children,
  footer,
}: {
  title: ReactNode;
  desc?: ReactNode;
  company?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  // 候选人看到的是公司名，不是内部系统名「智能招聘平台」
  useDocumentTitle(typeof title === 'string' ? `${title} · ${company}` : company);
  return (
    <div className="hf-portal">
      <div className="hf-portal-head">
        <div className="hf-portal-brand">
          <span className="hf-portal-mark">
            <RocketOutlined className="hf-portal-mark-ico" />
          </span>
          {company}
        </div>
        <h1 className="hf-portal-title">{title}</h1>
        {desc && <p className="hf-portal-desc">{desc}</p>}
      </div>
      <div className="hf-portal-body">{children}</div>
      {footer && <div className="hf-portal-foot">{footer}</div>}
    </div>
  );
}

/** 候选人自助选时：按日分组，档期即选即确认 */
export function InterviewPortalPage() {
  const { token = '' } = useParams();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [slotId, setSlotId] = useState<string | null>(null);

  const viewQuery = useQuery({
    queryKey: ['portal-interview', token],
    queryFn: () => portalApi.interviewView(token),
    enabled: Boolean(token),
    retry: false,
  });

  const pickMutation = useMutation({
    mutationFn: (id: string) => portalApi.interviewPick(token, id),
    onSuccess: (data) => {
      queryClient.setQueryData(['portal-interview', token], data);
      message.success('面试时间已确认，请准时参加！');
    },
    onError: (error) => {
      /** 并发抢占（409）：刷新剩余时段供重选 */
      if ((error as AxiosError)?.response?.status === 409) {
        message.warning('该时段刚被约走，已为您刷新剩余时段');
        setSlotId(null);
        void queryClient.invalidateQueries({ queryKey: ['portal-interview', token] });
      } else {
        message.error(extractErrorMessage(error, '确认失败，请稍后重试'));
      }
    },
  });

  const view = viewQuery.data;

  if (viewQuery.isLoading)
    return (
      <PortalShell title="正在加载…">
        <div className="u-flex-center hf-min-200">
          <Spin />
        </div>
      </PortalShell>
    );

  if (viewQuery.isError || !view)
    return (
      <PortalShell title="链接无效或已失效">
        <Result
          status="warning"
          title="无法打开该链接"
          subTitle={extractErrorMessage(viewQuery.error, '请联系 HR 获取最新链接')}
        />
      </PortalShell>
    );

  if (view.status === 'CANCELED')
    return (
      <PortalShell title="本场面试已取消" desc="HR 会另行与您联系安排时间，原定时间请勿到场。">
        <div className="hf-portal-done">
          <div className="hf-secondary">
            {view.jobTitle} · 第 {view.round} 轮
            {view.scheduledAt ? ` · 原定 ${dayjs(view.scheduledAt).format('MM-DD HH:mm')}` : ''}
          </div>
        </div>
      </PortalShell>
    );

  if (view.scheduledAt)
    return (
      <PortalShell title="面试时间已确认" desc="如需改期请联系 HR。">
        <div className="hf-portal-done">
          <span className="hf-portal-done-mark">
            <CheckOutlined />
          </span>
          <div className="hf-kpi-num">{dayjs(view.scheduledAt).format('MM-DD HH:mm')}</div>
          <div className="hf-secondary u-mt-4">
            {view.jobTitle} · 第 {view.round} 轮 · 约 {view.durationMins} 分钟
          </div>
        </div>
      </PortalShell>
    );

  /** 按日分组 */
  const groups: Array<{ key: string; dow: string; items: typeof view.slots }> = [];
  view.slots
    .slice()
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .forEach((s) => {
      const key = dayjs(s.startAt).format('MM-DD');
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push(s);
      else groups.push({ key, dow: dayjs(s.startAt).format('ddd'), items: [s] });
    });

  const picked = view.slots.find((s) => s.id === slotId);

  return (
    <PortalShell
      title="选一个方便的面试时间"
      desc={`${view.jobTitle} · 第 ${view.round} 轮 · 约 ${view.durationMins} 分钟`}
      company={view.company}
      footer={
        <>
          {picked && (
            <div className="u-flex-between u-mb-8">
              <span className="hf-muted">已选</span>
              <span className="hf-secondary hf-strong">
                {dayjs(picked.startAt).format('MM-DD ddd HH:mm')} – {dayjs(picked.endAt).format('HH:mm')}
              </span>
            </div>
          )}
          <Button
            type="primary"
            block
            disabled={!slotId}
            loading={pickMutation.isPending}
            onClick={() =>
              modal.confirm({
                title: '确认这个面试时间？',
                content: '确认后将同步面试官日程；如需再改期请联系 HR。',
                okText: '确认时间',
                onOk: () => pickMutation.mutateAsync(slotId!),
              })
            }
          >
            确认这个时间
          </Button>
          <div className="hf-portal-legal">免登录安全链接，请勿转发他人</div>
        </>
      }
    >
      {/* 设计稿这里有一条「请在 X 前选择」的截止提示，但 interviews.service.portalView
          并不返回 expiresAt（选时链接后端没有截止时间概念），故不落地——
          留一个永远不显示的块只会让人以为有这个功能。后端补字段后再加回来。 */}

      {view.slots.length === 0 ? (
        <div className="hf-notice hf-notice--warn">
          <span>暂无可选时段，HR 将尽快补充，请稍后再来或联系 HR。</span>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="u-mb-16">
            <div className="u-flex-gap-8 u-flex-baseline u-mb-8">
              <span className="hf-primary hf-td--num">{g.key}</span>
              <span className="hf-muted">{g.dow}</span>
            </div>
            {g.items.map((s) => {
              const start = dayjs(s.startAt);
              const end = dayjs(s.endAt);
              /** 跨天时补日期，避免渲染成误导性的「23:00 – 01:00」 */
              const endLabel = end.isSame(start, 'day') ? end.format('HH:mm') : end.format('MM-DD HH:mm');
              const on = slotId === s.id;
              return (
                <div key={s.id} className={on ? 'hf-opt hf-opt--on' : 'hf-opt'} {...pressable(() => setSlotId(s.id))}>
                  <span className="hf-opt-mark">{on ? <CheckOutlined /> : null}</span>
                  <span className="hf-td--num">
                    {start.format('HH:mm')} – {endLabel}
                  </span>
                </div>
              );
            })}
          </div>
        ))
      )}
    </PortalShell>
  );
}
