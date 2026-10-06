import { PlusOutlined, TeamOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS } from '@hireflow/shared';
import { App, Button, Form, Input, Select, Spin, Table, Tag } from 'antd';
import type { TableProps } from 'antd';
import dayjs from 'dayjs';
import type { CSSProperties } from 'react';
import { useState } from 'react';
import { candidatesApi } from '../../api';
import { extractErrorMessage } from '../../api/client';
import type { Candidate } from '../../api/types';
import { CandidateDetailDrawer } from '../../components/CandidateDetailDrawer';
import { RowActions } from '../../components/RowActions';
import { useAuthStore } from '../../stores/auth';
import { FormModal } from '../../components/FormModal';
import { useDrawerParam, useUrlParams } from '../../hooks/useUrlState';

const cssVars = (v: Record<string, string | number>) => v as CSSProperties;

const PAGE_SIZE = 20;

/** 匹配分色带：≥85 正向 / ≥70 主色 / 其余预警。与看板卡片、漏斗同一套规则 */
function scoreColor(score: number) {
  if (score >= 85) return '#059669';
  if (score >= 70) return '#2563EB';
  return '#B45309';
}

/** 阶段 Tag 用有序蓝阶，越靠后越深；终态走中性/正向 */
function stageTagClass(stage: string) {
  if (stage.includes('Offer')) return 'hf-tag hf-tag--ok';
  if (stage.includes('终面')) return 'hf-tag hf-tag--deep';
  if (stage.includes('面试') || stage.includes('沟通')) return 'hf-tag hf-tag--on';
  return 'hf-tag';
}

export function CandidatesPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);

  // 搜索、页码、打开的候选人都在网址里：看完详情后退、刷新、分享链接都回到同一视图
  const [params, updateParams] = useUrlParams();
  const page = Number(params.get('page')) || 1;
  const keyword = params.get('q') ?? '';
  /** 从大盘「待处理新简历」进来时带 stage=screening，只看待初筛的人 */
  const stage = params.get('stage') === 'screening' ? ('screening' as const) : undefined;
  const [detailId, openDetail, closeDetail] = useDrawerParam('candidate');
  const setPage = (p: number) => updateParams({ page: p === 1 ? null : p });
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Candidate | null>(null);
  const [form] = Form.useForm();

  const candidatesQuery = useQuery({
    queryKey: ['candidates', page, keyword, stage],
    queryFn: () => candidatesApi.list({ page, pageSize: PAGE_SIZE, keyword: keyword || undefined, stage }),
  });

  const createMutation = useMutation({
    mutationFn: candidatesApi.create,
    onSuccess: (candidate) => {
      message.success(`候选人「${candidate.name}」已录入`);
      setCreateOpen(false);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
    onError: (error) => message.error(extractErrorMessage(error, '录入失败')),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; values: Parameters<typeof candidatesApi.update>[1] }) =>
      candidatesApi.update(vars.id, vars.values),
    onSuccess: (candidate) => {
      message.success(`候选人「${candidate.name}」资料已更新`);
      setEditing(null);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
    onError: (error) => message.error(extractErrorMessage(error, '更新失败')),
  });

  const removeMutation = useMutation({
    mutationFn: candidatesApi.remove,
    onSuccess: () => {
      message.success('候选人已删除');
      void queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
    onError: (error) => message.error(extractErrorMessage(error, '删除失败')),
  });

  const openEdit = (candidate: Candidate) => {
    setEditing(candidate);
    form.setFieldsValue({
      name: candidate.name,
      email: candidate.email ?? undefined,
      phone: candidate.phone ?? undefined,
      source: candidate.source ?? undefined,
      tags: candidate.tags,
    });
  };

  /**
   * 列宽给的是「内容撑得开」的自然宽度，合计 1260 > 容器约 1020，
   * 于是交给 scroll.x 出横向滚动条，而不是把各列互相挤瘦。
   * 操作列 fixed:'right'，横向滚动时始终可见。
   */
  const columns: TableProps<Candidate>['columns'] = [
    {
      title: '姓名',
      dataIndex: 'name',
      width: 180,
      ellipsis: true,
      onCell: (c) => ({ title: c.name }),
      render: (name: string) => <span className="hf-primary">{name}</span>,
    },
    {
      // 匹配分：色点 + 数字 + 细条，与看板同一套色带
      title: '匹配分',
      key: 'score',
      width: 110,
      render: (_, c) => {
        const app = c.applications?.[0];
        const score = (c as Candidate & { matchScore?: number | null }).matchScore ?? app?.matchScore ?? null;
        if (score == null) return <span className="hf-muted">—</span>;
        return (
          <span className="u-flex-gap-6">
            <span className="hf-dot" style={cssVars({ background: scoreColor(score) })} />
            <span className="hf-progress-num">{score}</span>
            <span className="hf-bar-track hf-bar-track--thin">
              <span className="hf-bar-fill" style={cssVars({ '--w': `${score}%`, '--c': scoreColor(score) })} />
            </span>
          </span>
        );
      },
    },
    {
      // 联系方式两行：邮箱在上、电话弱化在下
      // 两行结构，不能用 antd 的 ellipsis（它给 td 加 nowrap 会把两行压成一行），
      // 改为内层 span 各自省略、title 挂到 td 上
      title: '联系方式',
      key: 'contact',
      width: 230,
      onCell: (c) => ({ title: `${c.email ?? '-'}\n${c.phone ?? '-'}` }),
      render: (_, c) => (
        <span className="contact-stack">
          <span className="hf-secondary hf-ellipsis">{c.email ?? '-'}</span>
          <span className="hf-faint hf-td--num">{c.phone ?? '-'}</span>
        </span>
      ),
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 100,
      ellipsis: true,
      onCell: (c) => ({ title: c.source ?? '' }),
      render: (source: string | null) => <span className="hf-secondary">{source ?? '-'}</span>,
    },
    {
      // 技能：一行点分文本，取代 4 个彩色 Tag
      title: '技能',
      dataIndex: 'tags',
      width: 220,
      ellipsis: true,
      onCell: (c) => ({ title: c.tags.join(' · ') }),
      render: (tags: string[]) => <span className="hf-secondary">{tags.length ? tags.join(' · ') : '—'}</span>,
    },
    {
      // 应聘进展：职位为文本，只有阶段用 Tag（Tag 不能被 nowrap 截掉，故不用 antd ellipsis）
      title: '应聘进展',
      key: 'progress',
      width: 260,
      onCell: (c) => {
        const a = c.applications?.[0];
        return { title: a ? `${a.job.title} · ${a.stage.name}` : '未投递' };
      },
      render: (_, c) => {
        const app = c.applications?.[0];
        if (!app) return <span className="hf-faint">未投递</span>;
        return (
          <span className="u-flex-gap-6">
            <span className="hf-secondary hf-ellipsis">{app.job.title}</span>
            <span className={stageTagClass(app.stage.name)}>{app.stage.name}</span>
            {(c.applications?.length ?? 0) > 1 && (
              <span className="hf-faint">+{(c.applications?.length ?? 1) - 1}</span>
            )}
          </span>
        );
      },
    },
    {
      title: '录入',
      dataIndex: 'createdAt',
      width: 90,
      align: 'right',
      render: (at: string) => <span className="hf-muted hf-td--num">{dayjs(at).format('MM-DD')}</span>,
    },
    {
      title: '操作',
      key: 'action',
      width: 132,
      align: 'right',
      fixed: 'right',
      render: (_, c) => (
        <RowActions
          actions={[
            { key: 'detail', label: '详情', hint: '查看候选人 360° 详情', onClick: () => openDetail(c.id) },
            hasPermission(PERMISSIONS.CANDIDATE_UPDATE) && {
              key: 'edit',
              label: '编辑',
              onClick: () => openEdit(c),
            },
            hasPermission(PERMISSIONS.CANDIDATE_DELETE) && {
              key: 'delete',
              label: '删除',
              danger: true,
              // 进过流程的候选人不给删，避免抹掉招聘留痕；后端同样会拦
              disabled: (c.applications?.length ?? 0) > 0,
              onClick: () =>
                modal.confirm({
                  title: `删除候选人「${c.name}」？`,
                  content: '其简历将一并移除，此操作不可撤销。',
                  okText: '删除',
                  okButtonProps: { danger: true },
                  cancelText: '取消',
                  onOk: () => removeMutation.mutateAsync(c.id),
                }),
            },
          ]}
        />
      ),
    },
  ];
  const TABLE_X = 1300;

  const items = candidatesQuery.data?.items ?? [];
  const total = candidatesQuery.data?.total ?? 0;
  // 页码区间与总页数改由 antd 分页器自己算（showTotal 回调里拿 range）

  return (
    <div className="hf-page">
      {/* 控制栏：搜索 + 总数 + 操作。页标题由面包屑承担，不再有三段式页头与独立筛选卡 */}
      <div className="hf-bar">
        <div className="hf-bar-left">
          <Input.Search
            key={keyword}
            defaultValue={keyword}
            className="w-260"
            placeholder="搜索姓名、邮箱、电话、技能"
            allowClear
            onSearch={(value) => updateParams({ q: value.trim(), page: null })}
          />
          {stage && (
            <Tag closable color="blue" onClose={() => updateParams({ stage: null, page: null })}>
              仅看待初筛
            </Tag>
          )}
          <span className="hf-muted">
            共 <b className="hf-td--num">{total}</b> 人
          </span>
        </div>
        <div className="hf-bar-right">
          {hasPermission(PERMISSIONS.CANDIDATE_CREATE) && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              新增候选人
            </Button>
          )}
        </div>
      </div>

      <div className="hf-body">
        {candidatesQuery.isLoading ? (
          <div className="hf-state-block">
            <Spin />
          </div>
        ) : items.length === 0 ? (
          <div className="hf-state-block">
            <div className="hf-state-icon">
              <TeamOutlined />
            </div>
            <div>
              <div className="hf-state-title">{keyword ? '没有匹配的候选人' : '候选人库还是空的'}</div>
              <div className="hf-state-desc">
                {keyword ? '换个关键词，或清空搜索查看全部。' : '导入简历或从人才库唤醒历史候选人后，这里会列出全部候选人。'}
              </div>
            </div>
            {keyword ? (
              <div className="hf-state-actions">
                <Button
                  onClick={() => updateParams({ q: null, page: null })}
                >
                  清空搜索
                </Button>
              </div>
            ) : (
              hasPermission(PERMISSIONS.CANDIDATE_CREATE) && (
                <div className="hf-state-actions">
                  <Button type="primary" onClick={() => setCreateOpen(true)}>
                    新增候选人
                  </Button>
                </div>
              )
            )}
          </div>
        ) : (
          /* 表格直接铺满，不再包 Card；表头 40、行高 48（观感由 .hf-atable 统一） */
          <div className="hf-atable">
            <Table<Candidate>
              columns={columns}
              dataSource={items}
              rowKey="id"
              /* y 只是开关：给了它 antd 才拆成 header/body 两张表用自己的滚动容器，
                 实际高度由 .hf-atable 的 flex 撑满（CSS 里把 max-height 解掉了） */
              scroll={{ x: TABLE_X, y: 1 }}
              pagination={{
                current: page,
                pageSize: PAGE_SIZE,
                total,
                showSizeChanger: false,
                showTotal: (t, [f, to]) => `第 ${f}–${to} 条 / 共 ${t} 条`,
                onChange: setPage,
              }}
            />
          </div>
        )}
      </div>

      <CandidateDetailDrawer candidateId={detailId} onClose={closeDetail} />

      <FormModal form={form}
        className="hf-modal"
        title={
          <>
            {editing ? '编辑候选人' : '新增候选人'}
            {editing && <div className="hf-modal-sub">{editing.name}</div>}
          </>
        }
        open={createOpen || editing != null}
        onCancel={() => {
          setCreateOpen(false);
          setEditing(null);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText={editing ? '保存' : '录入'}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) =>
            editing ? updateMutation.mutate({ id: editing.id, values }) : createMutation.mutate(values)
          }
        >
          <Form.Item name="name" label="姓名" rules={[{ required: true, min: 1 }]}>
            <Input placeholder="候选人姓名" />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ type: 'email', message: '邮箱格式不正确' }]}>
            <Input placeholder="name@example.com" />
          </Form.Item>
          <Form.Item name="phone" label="电话">
            <Input placeholder="手机号" />
          </Form.Item>
          <Form.Item name="source" label="来源渠道">
            <Select
              allowClear
              placeholder="选择来源"
              options={['BOSS直聘', '猎聘', '拉勾', '内推', '猎头推荐', '官网投递', '人才库唤醒'].map((s) => ({
                value: s,
                label: s,
              }))}
            />
          </Form.Item>
          <Form.Item name="tags" label="技能标签" extra="输入后回车，可多个；导入简历后由 AI 自动打标">
            <Select mode="tags" placeholder="如：React、TypeScript" />
          </Form.Item>
        </Form>
      </FormModal>
    </div>
  );
}
