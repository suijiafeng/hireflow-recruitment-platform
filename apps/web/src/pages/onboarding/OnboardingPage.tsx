import { FileProtectOutlined, IdcardOutlined, LinkOutlined, PlusOutlined, WarningOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CONTRACT_SIGN_STATUS_LABEL,
  DOCUMENT_FIELD_LABEL,
  DOCUMENT_TYPE_META,
  PERMISSIONS,
  type ContractSignStatus,
} from '@hireflow/shared';
import { App, Button, Form, Input, Modal, Select, Spin, Steps, Table, Typography, Upload } from 'antd';
import type { TableProps } from 'antd';
import dayjs from 'dayjs';
import type { CSSProperties } from 'react';
import { useState } from 'react';
import { onboardingApi } from '../../api';
import { extractErrorMessage } from '../../api/client';
import { QueryErrorResult } from '../../components/QueryErrorResult';
import type { ChecklistItem, Onboarding } from '../../api/types';
import { useAuthStore } from '../../stores/auth';
import { ContractText } from '../../components/ContractText';
import { FormModal } from '../../components/FormModal';
import { useDrawerParam, useUrlState } from '../../hooks/useUrlState';
import { prepareUpload } from '../../utils/prepareUpload';
import { pressable } from '../../utils/pressable';

const cssVars = (v: Record<string, string | number>) => v as CSSProperties;

const OWNER_LABEL: Record<ChecklistItem['owner'], string> = {
  HR: 'HR 待办',
  IT: 'IT / 行政待办',
  NEW_HIRE: '新员工待办',
};
const SIGN_STEP: Record<string, number> = { DRAFT: 1, SENT: 2, SIGNED: 3, ARCHIVED: 4 };

type Filter = 'mine' | 'active' | 'done' | 'review';

/** 右栏：选中入职单的三方清单 + 材料 + 合同。取代原来 720px 抽屉 */
function DetailRail({ id }: { id: string | null }) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const roles = useAuthStore((s) => s.user?.roles ?? []);
  const [docOpen, setDocOpen] = useState(false);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docForm] = Form.useForm();

  const canManage = hasPermission(PERMISSIONS.ONBOARDING_MANAGE);
  const canToggleOwner = (owner: ChecklistItem['owner']) =>
    canManage ||
    (owner === 'IT' && roles.includes('IT_SUPPORT')) ||
    (owner === 'NEW_HIRE' && roles.includes('NEW_HIRE'));

  const detailQuery = useQuery({
    queryKey: ['onboarding', id],
    queryFn: () => onboardingApi.get(id!),
    enabled: Boolean(id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['onboarding', id] });
    void queryClient.invalidateQueries({ queryKey: ['onboardings'] });
    void queryClient.invalidateQueries({ queryKey: ['board'] });
  };

  const run = (fn: () => Promise<unknown>, success: string) => {
    fn()
      .then(() => {
        message.success(success);
        invalidate();
      })
      .catch((error) => message.error(extractErrorMessage(error, '操作失败')));
  };

  const copyPortalLink = async (onboardingId: string, rotate = false) => {
    try {
      const { token } = await onboardingApi.portalLink(onboardingId, rotate);
      const url = `${window.location.origin}/portal/onboarding/${token}`;
      try {
        await navigator.clipboard.writeText(url);
        message.success(rotate ? '已重新生成并复制新链接，旧链接已失效' : '新员工链接已复制，请通过邮件/IM 发送');
      } catch {
        modal.info({
          title: '新员工资料填报链接',
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

  const addDocMutation = useMutation({
    mutationFn: (values: { type: string; rawText?: string }) =>
      docFile
        ? onboardingApi.addDocumentFile(id!, { ...values, file: docFile })
        : onboardingApi.addDocument(id!, values as { type: string; rawText: string }),
    onSuccess: (_data, values) => {
      if (docFile && !values.rawText) {
        message.warning('图片已留档；未提供文字层，材料标记「待人工核对」，请核对后手动勾选待办');
      } else {
        message.success('材料已入档，OCR 字段已抽取，对应待办自动勾选');
      }
      setDocOpen(false);
      setDocFile(null);
      docForm.resetFields();
      invalidate();
    },
    onError: (error) => message.error(extractErrorMessage(error, '入档失败')),
  });

  if (!id)
    return (
      <div className="hf-panel hf-panel--grow">
        <div className="hf-panel-body u-flex-center">
          <span className="hf-muted">从左侧选择一张入职单，这里显示三方清单与合同</span>
        </div>
      </div>
    );

  const detail = detailQuery.data;
  if (detailQuery.isLoading || !detail)
    return (
      <div className="hf-panel hf-panel--grow">
        <div className="hf-panel-body u-flex-center">
          <Spin />
        </div>
      </div>
    );

  const contract = detail.contract ?? null;
  const needReview = detail.documents?.filter((d) => d.needsReview).length ?? 0;

  return (
    <div className="hf-panel hf-panel--grow">
      <div className="hf-panel-head">
        <div>
          <span className="hf-panel-title">{detail.application.candidate.name} · 入职流程</span>
          <div className="hf-panel-sub">
            {detail.application.job.title} · {detail.application.job.department.name} ·{' '}
            {detail.status === 'COMPLETED' ? '已完成' : '进行中'}
          </div>
        </div>
        {hasPermission(PERMISSIONS.ONBOARDING_UPLOAD) && (
          <Button size="small" icon={<PlusOutlined />} onClick={() => setDocOpen(true)}>
            提交材料
          </Button>
        )}
      </div>

      <div className="hf-panel-body">
        {needReview > 0 && (
          <div className="hf-notice hf-notice--warn u-mb-16">
            <WarningOutlined />
            <span className="u-flex-1">{needReview} 项材料仅有图片、未识别出字段，需人工核对</span>
          </div>
        )}
        {/* 闭环后服务端不再发放链接（门户含未脱敏的薪资与证件信息） */}
        {canManage && detail.status !== 'COMPLETED' && (
          <div className="u-flex-gap-8 u-mb-16">
            <Button size="small" icon={<LinkOutlined />} onClick={() => void copyPortalLink(detail.id)}>
              复制新员工资料填报链接
            </Button>
            <Button
              size="small"
              type="text"
              onClick={() =>
                modal.confirm({
                  title: '重新生成资料填报链接？',
                  content: '旧链接将立即失效，请把新链接重新发给新员工。',
                  cancelText: '取消',
                  onOk: () => copyPortalLink(detail.id, true),
                })
              }
            >
              重置链接
            </Button>
          </div>
        )}

        {/* 三方清单：按责任方分组，勾选框 + 完成时间，不再每组套一张 Card */}
        {(['HR', 'IT', 'NEW_HIRE'] as const).map((owner) => {
          const items = detail.checklist.filter((i) => i.owner === owner);
          if (items.length === 0) return null;
          const done = items.filter((i) => i.done).length;
          const editable = canToggleOwner(owner);
          return (
            <div key={owner} className="u-mb-16">
              <div className="u-flex-between u-mb-4">
                <span className="hf-caption">{OWNER_LABEL[owner]}</span>
                <span className="hf-faint hf-td--num">
                  {done} / {items.length}
                </span>
              </div>
              {items.map((item) => (
                <div
                  key={item.key}
                  className={editable ? 'hf-check-row' : 'hf-check-row hf-check-row--static'}
                  {...pressable(() => {
                    if (editable)
                      run(() => onboardingApi.toggle(detail.id, item.key, !item.done), item.done ? '已取消勾选' : '已完成');
                  })}
                >
                  <span className={item.done ? 'hf-check hf-check--on' : 'hf-check'}>{item.done ? '✓' : ''}</span>
                  <span className={item.done ? 'hf-check-label hf-check-label--done' : 'hf-check-label'}>
                    {item.label}
                  </span>
                  {item.doneAt && <span className="hf-check-at">{dayjs(item.doneAt).format('MM-DD HH:mm')}</span>}
                </div>
              ))}
            </div>
          );
        })}

        {/* 材料：字段以「标签 值」两列平铺，不再每份材料一张 Card */}
        {(detail.documents?.length ?? 0) > 0 && (
          <div className="u-mb-16">
            <div className="hf-caption u-mb-8">入职材料 {detail.documents!.length}</div>
            {detail.documents!.map((doc) => (
              <div key={doc.type} className="u-mb-8">
                <div className="u-flex-between">
                  <span className="hf-secondary hf-strong">{doc.label}</span>
                  <span className="u-flex-gap-8">
                    {doc.needsReview && <span className="hf-tag hf-tag--warn">待人工核对</span>}
                    {doc.fileUrl && (
                      <span className="hf-link" {...pressable(() => window.open(doc.fileUrl!, '_blank'))}>
                        原件
                      </span>
                    )}
                  </span>
                </div>
                {doc.redacted ? (
                  <div className="hf-faint">证件信息仅 HR 可见</div>
                ) : Object.keys(doc.fields).length > 0 ? (
                  Object.entries(doc.fields).map(([k, v]) => (
                    <div key={k} className="hf-check-row hf-check-row--static">
                      <span className="hf-muted hf-field-key">{DOCUMENT_FIELD_LABEL[k] ?? k}</span>
                      <span className="hf-secondary u-flex-1">{v}</span>
                    </div>
                  ))
                ) : (
                  <div className="hf-faint">仅上传图片、未识别字段：请打开原件人工核对后手动勾选待办</div>
                )}
                <div className="hf-faint u-mt-4">
                  {doc.ocrProvider} · {dayjs(doc.addedAt).format('MM-DD HH:mm')}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 合同：横向步骤 + 关键信息两列，取代 Descriptions + Card */}
        <div className="hf-caption u-mb-8">
          <FileProtectOutlined /> 劳动合同 · 电子签
        </div>
        <Steps
          size="small"
          className="u-mb-16"
          current={contract ? SIGN_STEP[contract.signStatus] - 1 : 0}
          items={[{ title: '生成合同' }, { title: '发送签署' }, { title: '完成签署' }, { title: '存证归档' }]}
        />
        {!contract ? (
          canManage ? (
            <Button
              type="primary"
              block
              onClick={() => run(() => onboardingApi.createContract(detail.id), '合同已生成（模板变量自动填充）')}
            >
              生成劳动合同
            </Button>
          ) : (
            <span className="hf-muted">等待 HR 生成合同</span>
          )
        ) : (
          <>
            <div className="hf-check-row hf-check-row--static">
              <span className="hf-muted hf-field-key">模板</span>
              <span className="hf-secondary u-flex-1">{contract.templateName}</span>
              <span
                className="hf-link"
                {...pressable(() =>
                  modal.info({
                    title: `劳动合同 · ${detail.application.candidate.name}`,
                    width: 560,
                    icon: null,
                    content: <ContractText variables={contract.variables} />,
                    okText: '关闭',
                  }),
                )}
              >
                预览全文
              </span>
            </div>
            {Boolean(contract.variables?.startDate) && (
              <div className="hf-check-row hf-check-row--static">
                <span className="hf-muted hf-field-key">入职日期</span>
                <span className="hf-secondary hf-td--num u-flex-1">{String(contract.variables?.startDate)}</span>
              </div>
            )}
            <div className="hf-check-row hf-check-row--static">
              <span className="hf-muted hf-field-key">状态</span>
              <span className="u-flex-1">
                <span
                  className={
                    contract.signStatus === 'SIGNED' || contract.signStatus === 'ARCHIVED'
                      ? 'hf-state--ok'
                      : 'hf-secondary'
                  }
                >
                  {CONTRACT_SIGN_STATUS_LABEL[contract.signStatus as ContractSignStatus]}
                </span>
              </span>
            </div>
            {contract.evidenceNo && (
              <div className="hf-check-row hf-check-row--static">
                <span className="hf-muted hf-field-key">存证号</span>
                <Typography.Text copyable className="hf-secondary hf-td--num u-flex-1">
                  {contract.evidenceNo}
                </Typography.Text>
              </div>
            )}
            {contract.signStatus === 'DRAFT' && canManage && (
              <Button
                type="primary"
                block
                className="u-mt-8"
                onClick={() =>
                  onboardingApi
                    .sendContract(contract.id)
                    .then(() => {
                      invalidate();
                      // 新员工没有站内账号，系统通知不到他：发完立刻引导 HR 把签署入口转过去
                      modal.confirm({
                        title: '合同已发出',
                        content: `请把门户链接发给${detail.application.candidate.name}，新员工在门户里阅读并签署。`,
                        okText: '复制门户链接',
                        cancelText: '稍后',
                        onOk: () => copyPortalLink(detail.id),
                      });
                    })
                    .catch((error) => message.error(extractErrorMessage(error, '发送失败')))
                }
              >
                发送签署
              </Button>
            )}
            {contract.signStatus === 'SENT' && canManage && (
              <>
                <div className="hf-muted u-mt-8">等待新员工在门户签署</div>
                <Button block className="u-mt-8" onClick={() => copyPortalLink(detail.id)}>
                  复制签署链接
                </Button>
                {import.meta.env.DEV && (
                  <Button
                    block
                    type="dashed"
                    className="u-mt-8"
                    onClick={() =>
                      run(() => onboardingApi.signContract(contract.id), '已模拟签署回调：已存证、通知 IT')
                    }
                  >
                    模拟电子签回调（仅开发环境）
                  </Button>
                )}
              </>
            )}
          </>
        )}
      </div>

      <FormModal form={docForm}
        className="hf-modal"
        title="提交入职材料"
        open={docOpen}
        onCancel={() => {
          setDocOpen(false);
          setDocFile(null);
        }}
        onOk={() => docForm.submit()}
        confirmLoading={addDocMutation.isPending}
        destroyOnHidden
      >
        <Form form={docForm} layout="vertical" onFinish={(values) => addDocMutation.mutate(values)}>
          <Form.Item name="type" label="材料类型" rules={[{ required: true, message: '请选择类型' }]}>
            <Select
              placeholder="选择材料类型"
              options={Object.entries(DOCUMENT_TYPE_META).map(([value, meta]) => ({ value, label: meta.label }))}
            />
          </Form.Item>
          <Form.Item label="证件照片（可选）" extra="原件入对象存储留档；纯图片将标记「待人工核对」">
            <Upload
              accept="image/*,.pdf"
              maxCount={1}
              // 受控文件列表 + 上传前处理（大图压缩、超限拦截）：列表里显示的就是实际要传的文件
              fileList={docFile ? [{ uid: 'picked', name: docFile.name, status: 'done' as const }] : []}
              beforeUpload={(file) => {
                void prepareUpload(file as unknown as File).then((r) => {
                  if (r.ok) setDocFile(r.file);
                  else {
                    setDocFile(null);
                    message.error(r.reason);
                  }
                });
                return false;
              }}
              onRemove={() => setDocFile(null)}
            >
              <Button>选择图片 / PDF（≤10MB）</Button>
            </Upload>
          </Form.Item>
          <Form.Item
            name="rawText"
            label="材料文字内容"
            rules={docFile ? [{ min: 6, message: '材料内容过短' }] : [{ required: true, min: 6, message: '请输入材料文本' }]}
            extra="粘贴证件文字，OCR 自动抽取字段并勾选待办；只传图片可留空"
          >
            <Input.TextArea rows={4} placeholder="如：姓名：杨帆 公民身份号码 110105199305124533 住址：…" />
          </Form.Item>
        </Form>
      </FormModal>
    </div>
  );
}

export function OnboardingPage() {
  // 打开的入职单与筛选标签放在网址里：后退关闭详情、刷新不丢、通知可直接链接到某张入职单
  const [selected, openSelected, closeSelected] = useDrawerParam('onboarding');
  const roles = useAuthStore((s) => s.user?.roles ?? []);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  // 我负责哪一方的待办：IT 只管 IT 项；HR（onboarding:manage）管 HR 项。其余角色没有「我的待办」
  const myOwner: ChecklistItem['owner'] | null = roles.includes('IT_SUPPORT')
    ? 'IT'
    : hasPermission(PERMISSIONS.ONBOARDING_MANAGE)
      ? 'HR'
      : null;
  // IT 打开页面最关心的就是「哪几单还等着我」：默认落在我的待办
  const [filter, setFilter] = useUrlState<Filter>('tab', myOwner === 'IT' ? 'mine' : 'active');
  const listQuery = useQuery({ queryKey: ['onboardings'], queryFn: onboardingApi.list, retry: false });

  const all = listQuery.data ?? [];

  const reviewCount = (o: Onboarding) => o.documents?.filter((d) => d.needsReview).length ?? 0;
  const myPending = (o: Onboarding) =>
    myOwner && o.status !== 'COMPLETED'
      ? (o.checklist ?? []).filter((i) => i.owner === myOwner && !i.done).length
      : 0;
  const mineCount = all.filter((o) => myPending(o) > 0).length;
  const visible = all.filter((o) => {
    if (filter === 'mine') return myPending(o) > 0;
    if (filter === 'done') return o.status === 'COMPLETED';
    if (filter === 'review') return reviewCount(o) > 0;
    return o.status !== 'COMPLETED';
  });

  /** 左栏窄（约 666px），列按内容给自然宽，合计 760 触发横向滚动 */
  const onboardingColumns: TableProps<Onboarding>['columns'] = [
    {
      title: '候选人',
      key: 'name',
      width: 150,
      onCell: (o) => ({ title: o.application.candidate.name }),
      render: (_, o) => (
        <span className="u-flex-gap-8">
          <span className="hf-primary hf-ellipsis">{o.application.candidate.name}</span>
          {reviewCount(o) > 0 && <span className="hf-dot hf-dot--alert" title="有材料待人工核对" />}
          {myPending(o) > 0 && (
            <span className="hf-tag hf-tag--warn" title={`${OWNER_LABEL[myOwner!]}还有 ${myPending(o)} 项未完成`}>
              待我 {myPending(o)}
            </span>
          )}
        </span>
      ),
    },
    {
      title: '职位',
      key: 'job',
      width: 200,
      onCell: (o) => ({ title: `${o.application.job.title} · ${o.application.job.department.name}` }),
      render: (_, o) => (
        <span className="u-flex-gap-10">
          <span className="hf-secondary hf-ellipsis">{o.application.job.title}</span>
          <span className="hf-faint">{o.application.job.department.name}</span>
        </span>
      ),
    },
    {
      title: '清单进度',
      key: 'progress',
      width: 150,
      render: (_, o) => {
        const pct = Math.round((o.progress.done / o.progress.total) * 100);
        const complete = o.status === 'COMPLETED';
        return (
          <span className="hf-progress">
            <span className="hf-bar-track">
              <span
                className="hf-bar-fill"
                style={cssVars({ '--w': `${Math.max(pct, 2)}%`, '--c': complete ? '#059669' : '#2563EB' })}
              />
            </span>
            <span className="hf-progress-num">
              {o.progress.done} / {o.progress.total}
            </span>
          </span>
        );
      },
    },
    {
      title: '合同',
      key: 'contract',
      width: 90,
      render: (_, o) => {
        const signed = o.contract?.signStatus === 'SIGNED' || o.contract?.signStatus === 'ARCHIVED';
        return (
          <span className={signed ? 'hf-state--ok' : o.contract ? 'hf-secondary' : 'hf-faint'}>
            {o.contract ? CONTRACT_SIGN_STATUS_LABEL[o.contract.signStatus as ContractSignStatus] : '未生成'}
          </span>
        );
      },
    },
    {
      title: '状态',
      key: 'status',
      width: 90,
      render: (_, o) => {
        const complete = o.status === 'COMPLETED';
        return (
          <span className={`hf-state ${complete ? 'hf-state--ok' : ''}`}>
            <span className={complete ? 'hf-dot hf-dot--ok' : 'hf-dot hf-dot--on'} />
            {complete ? '已完成' : '进行中'}
          </span>
        );
      },
    },
    {
      title: '创建',
      dataIndex: 'createdAt',
      width: 80,
      align: 'right',
      render: (at: string) => <span className="hf-muted hf-td--num">{dayjs(at).format('MM-DD')}</span>,
    },
    {
      title: '操作',
      key: 'action',
      width: 110,
      align: 'right',
      fixed: 'right',
      render: (_, o) => (
        // 入职单没有独立的可编辑业务字段：清单勾选、材料上传、合同生成都在详情弹窗里完成，
        // 所以这里只给一个入口，不去凑一个指向同一处的「编辑」按钮
        <span className="hf-link" {...pressable(() => openSelected(o.id))}>
          查看 / 办理
        </span>
      ),
    },
  ];

  const doneCount = all.filter((o) => o.status === 'COMPLETED').length;
  const kpis = [
    { label: '进行中', value: all.length - doneCount, unit: '张' },
    { label: '本月已入职', value: doneCount, unit: '人' },
    {
      label: '合同待签署',
      value: all.filter(
        (o) => o.contract && o.contract.signStatus !== 'SIGNED' && o.contract.signStatus !== 'ARCHIVED',
      ).length,
      unit: '份',
    },
    { label: '材料待核对', value: all.reduce((s, o) => s + reviewCount(o), 0), unit: '项' },
    {
      label: '清单平均完成',
      value: all.length
        ? `${Math.round((all.reduce((s, o) => s + o.progress.done / o.progress.total, 0) / all.length) * 100)}%`
        : '—',
      unit: '',
    },
  ];

  if (listQuery.isError) {
    return (
      <div className="hf-page">
        <div className="hf-body">
          <QueryErrorResult error={listQuery.error} />
        </div>
      </div>
    );
  }

  return (
    <div className="hf-page">
      <div className="hf-bar">
        <div className="hf-bar-left">
          <div className="hf-seg">
            {myOwner && (
              <span className={filter === 'mine' ? 'hf-seg--on' : undefined} {...pressable(() => setFilter('mine'))}>
                我的待办{mineCount > 0 ? ` ${mineCount}` : ''}
              </span>
            )}
            <span className={filter === 'active' ? 'hf-seg--on' : undefined} {...pressable(() => setFilter('active'))}>
              进行中
            </span>
            <span className={filter === 'done' ? 'hf-seg--on' : undefined} {...pressable(() => setFilter('done'))}>
              已完成
            </span>
            <span className={filter === 'review' ? 'hf-seg--on' : undefined} {...pressable(() => setFilter('review'))}>
              待核对材料
            </span>
          </div>
          <span className="hf-muted">清单全部完成且合同已签署后，候选人自动标记为已入职</span>
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

        <div className="hf-cols">
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
                <div className="hf-state-title">
                  {filter === 'mine' ? '你负责的待办都已完成' : '没有符合条件的入职单'}
                </div>
                <div className="hf-state-desc">
                  {filter === 'mine'
                    ? '有新员工接受 Offer 或签署合同时会通知你。'
                    : '候选人接受 Offer 后会自动生成入职单，并在这里跟踪三方清单与合同。'}
                </div>
              </div>
            </div>
          ) : (
            <div className="hf-atable">
              <Table<Onboarding>
                columns={onboardingColumns}
                dataSource={visible}
                rowKey="id"
                pagination={{
            pageSize: 20,
            showSizeChanger: false,
            hideOnSinglePage: true,
            showTotal: (t, [f, to]) => `第 ${f}–${to} 条 / 共 ${t} 条`,
          }}
                scroll={{ x: 760, y: 1 }}
                rowClassName={(o) => (o.id === selected ? 'hf-row--on' : '')}
              />
              <div className="hf-panel-foot hf-panel-foot--tight">
                <span>全部 {all.length} 张入职单</span>
                <span className="hf-faint">
                  <span className="hf-dot hf-dot--alert u-mr-4" />
                  姓名后的琥珀点 = 有材料待人工核对
                </span>
              </div>
            </div>
          )}


        </div>
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
        <DetailRail id={selected} />
      </Modal>
    </div>
  );
}
