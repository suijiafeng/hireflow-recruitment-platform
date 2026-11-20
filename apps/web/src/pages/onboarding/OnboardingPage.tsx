import { CheckOutlined, IdcardOutlined, LinkOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ONBOARDING_INFO_FIELDS, PERMISSIONS } from '@hireflow/shared';
import { Button, Modal, Spin, Table } from 'antd';
import type { TableProps } from 'antd';
import dayjs from 'dayjs';
import { onboardingApi } from '../../api';
import { extractErrorMessage } from '../../api/client';
import type { Onboarding } from '../../api/types';
import { ContractText } from '../../components/ContractText';
import { QueryErrorResult } from '../../components/QueryErrorResult';
import { useAppDialogs } from '../../hooks/useAppDialogs';
import { useCopyPortalLink } from '../../hooks/usePortalLink';
import { useDrawerParam, useUrlState } from '../../hooks/useUrlState';
import { useAuthStore } from '../../stores/auth';
import { pressable } from '../../utils/pressable';

type Filter = 'active' | 'ready' | 'done';

const infoDone = (o: Onboarding) => Boolean(o.infoSubmittedAt);
const signed = (o: Onboarding) => o.contract?.signStatus === 'SIGNED';
const ready = (o: Onboarding) => o.status !== 'COMPLETED' && infoDone(o) && signed(o);

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={ok ? 'hf-state--ok' : 'hf-faint'}>
      {ok ? <CheckOutlined /> : '○'} {label}
    </span>
  );
}

/** 入职办理：看新员工提交的信息与合同确认情况，两样齐了 HR 确认入职 */
function DetailPanel({ id, onDone }: { id: string; onDone: () => void }) {
  const { message, modal } = useAppDialogs();
  const queryClient = useQueryClient();
  const canManage = useAuthStore((s) => s.hasPermission(PERMISSIONS.ONBOARDING_MANAGE));
  const detailQuery = useQuery({ queryKey: ['onboarding', id], queryFn: () => onboardingApi.get(id) });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['onboarding', id] });
    void queryClient.invalidateQueries({ queryKey: ['onboardings'] });
    void queryClient.invalidateQueries({ queryKey: ['board'] });
  };
  const copyPortalLink = useCopyPortalLink(invalidate);
  const complete = useMutation({
    mutationFn: () => onboardingApi.complete(id),
    onSuccess: () => {
      message.success('已确认入职，候选人标记为已入职');
      invalidate();
      onDone();
    },
    onError: (error) => message.error(extractErrorMessage(error, '确认失败')),
  });

  const o = detailQuery.data;
  if (detailQuery.isLoading || !o)
    return (
      <div className="u-flex-center hf-min-200">
        <Spin />
      </div>
    );
  const done = o.status === 'COMPLETED';
  return (
    <div>
      <div className="u-flex-between u-mb-12">
        <span>
          <span className="hf-panel-title">{o.application.candidate.name}</span>
          <span className="hf-faint u-ml-8">
            {o.application.job.title} · {o.application.job.department.name}
          </span>
        </span>
        {!done && canManage && (
          <span className="hf-link" {...pressable(() => void copyPortalLink(o.application.id))}>
            <LinkOutlined /> 复制候选人页链接
          </span>
        )}
      </div>

      <div className="hf-caption u-mb-4">入职信息 {o.infoSubmittedAt ? `· ${dayjs(o.infoSubmittedAt).format('MM-DD HH:mm')} 提交` : ''}</div>
      {o.info ? (
        ONBOARDING_INFO_FIELDS.map((f) => (
          <div className="hf-kv" key={f.key}>
            <span className="hf-kv-k">{f.label}</span>
            <span className="hf-kv-v">{o.info?.[f.key] || '-'}</span>
          </div>
        ))
      ) : (
        <div className="hf-notice hf-notice--flat u-mb-12">
          <span>新员工还没有填写。把候选人页链接发给 TA，在同一页填写信息、确认合同。</span>
        </div>
      )}

      <div className="hf-caption u-mt-16 u-mb-4">
        劳动合同 · {o.contract?.templateName ?? '未生成'}
        {signed(o) && o.contract?.signedAt ? ` · ${o.contract.signerName} 于 ${dayjs(o.contract.signedAt).format('MM-DD HH:mm')} 确认` : ' · 待确认'}
      </div>
      {o.contract && <ContractText variables={o.contract.variables} />}

      <div className="u-flex-between u-mt-16">
        <span className="u-flex-gap-10">
          <Check ok={infoDone(o)} label="入职信息" />
          <Check ok={signed(o)} label="合同确认" />
        </span>
        {done ? (
          <span className="hf-state--ok hf-strong">已于 {dayjs(o.completedAt).format('YYYY-MM-DD')} 入职</span>
        ) : (
          canManage && (
            <Button
              type="primary"
              disabled={!ready(o)}
              loading={complete.isPending}
              title={ready(o) ? undefined : '入职信息与合同确认都完成后才能确认入职'}
              onClick={() =>
                modal.confirm({
                  title: `确认 ${o.application.candidate.name} 已入职？`,
                  content: '应聘标记为「已入职」，卡片移出看板流程，并计入职位已用编制。',
                  okText: '确认入职',
                  onOk: () => complete.mutateAsync(),
                })
              }
            >
              确认入职
            </Button>
          )
        )}
      </div>
    </div>
  );
}

export function OnboardingPage() {
  const [selected, openSelected, closeSelected] = useDrawerParam('onboarding');
  const [rawFilter, setFilter] = useUrlState<Filter>('tab', 'active');
  const filter: Filter = rawFilter === 'ready' || rawFilter === 'done' ? rawFilter : 'active';
  const listQuery = useQuery({ queryKey: ['onboardings'], queryFn: onboardingApi.list, retry: false });
  const all = listQuery.data ?? [];
  const visible = all.filter((o) =>
    filter === 'done' ? o.status === 'COMPLETED' : filter === 'ready' ? ready(o) : o.status !== 'COMPLETED',
  );

  const columns: TableProps<Onboarding>['columns'] = [
    {
      title: '新员工',
      key: 'name',
      width: 140,
      render: (_, o) => <span className="hf-primary hf-ellipsis">{o.application.candidate.name}</span>,
    },
    {
      title: '职位',
      key: 'job',
      width: 220,
      render: (_, o) => (
        <span className="u-flex-gap-10">
          <span className="hf-secondary hf-ellipsis">{o.application.job.title}</span>
          <span className="hf-faint">{o.application.job.department.name}</span>
        </span>
      ),
    },
    {
      title: '入职日期',
      key: 'startDate',
      width: 100,
      render: (_, o) => <span className="hf-secondary hf-td--num">{o.startDate ? dayjs(o.startDate).format('MM-DD') : '—'}</span>,
    },
    { title: '入职信息', key: 'info', width: 110, render: (_, o) => <Check ok={infoDone(o)} label={infoDone(o) ? '已提交' : '未填写'} /> },
    { title: '合同', key: 'contract', width: 110, render: (_, o) => <Check ok={signed(o)} label={signed(o) ? '已确认' : '待确认'} /> },
    {
      title: '状态',
      key: 'status',
      width: 110,
      render: (_, o) =>
        o.status === 'COMPLETED' ? (
          <span className="hf-state hf-state--ok">
            <span className="hf-dot hf-dot--ok" />
            已入职
          </span>
        ) : ready(o) ? (
          <span className="hf-state hf-state--warn">
            <span className="hf-dot hf-dot--alert" />
            待确认入职
          </span>
        ) : (
          <span className="hf-state">
            <span className="hf-dot hf-dot--on" />
            进行中
          </span>
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      align: 'right',
      fixed: 'right',
      render: (_, o) => (
        <span className="hf-link" {...pressable(() => openSelected(o.id))}>
          查看 / 办理
        </span>
      ),
    },
  ];

  const doneCount = all.filter((o) => o.status === 'COMPLETED').length;
  const kpis = [
    { label: '进行中', value: all.length - doneCount, unit: '人' },
    { label: '待填写信息', value: all.filter((o) => o.status !== 'COMPLETED' && !infoDone(o)).length, unit: '人' },
    { label: '待确认合同', value: all.filter((o) => o.status !== 'COMPLETED' && !signed(o)).length, unit: '人' },
    { label: '待确认入职', value: all.filter(ready).length, unit: '人' },
    { label: '已入职', value: doneCount, unit: '人' },
  ];

  if (listQuery.isError)
    return (
      <div className="hf-page">
        <div className="hf-body">
          <QueryErrorResult error={listQuery.error} />
        </div>
      </div>
    );

  const seg = (key: Filter, label: string) => (
    <span className={filter === key ? 'hf-seg--on' : undefined} {...pressable(() => setFilter(key))}>
      {label}
    </span>
  );

  return (
    <div className="hf-page">
      <div className="hf-bar">
        <div className="hf-bar-left">
          <div className="hf-seg">
            {seg('active', '进行中')}
            {seg('ready', `待确认入职${all.filter(ready).length ? ` ${all.filter(ready).length}` : ''}`)}
            {seg('done', '已入职')}
          </div>
          <span className="hf-muted">新员工在候选人页填写信息、确认合同；两样齐了由 HR 确认入职</span>
        </div>
      </div>
      <div className="hf-body">
        <div className="hf-kpis">
          {kpis.map((k) => (
            <div className="hf-kpi" key={k.label}>
              <div className="hf-kpi-label">{k.label}</div>
              <div className="hf-kpi-val">
                <span className="hf-kpi-num">{k.value}</span>
                <span className="hf-kpi-unit">{k.unit}</span>
              </div>
            </div>
          ))}
        </div>
        {listQuery.isLoading ? (
          <div className="hf-state-block">
            <Spin />
          </div>
        ) : visible.length === 0 ? (
          <div className="hf-state-block">
            <div className="hf-state-icon">
              <IdcardOutlined />
            </div>
            <div>
              <div className="hf-state-title">没有符合条件的入职</div>
              <div className="hf-state-desc">候选人接受 Offer 后自动出现在这里，并生成劳动合同。</div>
            </div>
          </div>
        ) : (
          <div className="hf-atable">
            <Table<Onboarding>
              columns={columns}
              dataSource={visible}
              rowKey="id"
              pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
              scroll={{ x: 880 }}
              rowClassName={(o) => (o.id === selected ? 'hf-row--on' : '')}
            />
          </div>
        )}
      </div>
      <Modal
        className="hf-modal hf-modal--wide"
        title="入职办理"
        open={Boolean(selected)}
        onCancel={closeSelected}
        footer={null}
        width={720}
        destroyOnHidden
      >
        {selected && <DetailPanel id={selected} onDone={closeSelected} />}
      </Modal>
    </div>
  );
}
