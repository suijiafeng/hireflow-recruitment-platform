import {
  CameraOutlined,
  CheckOutlined,
  EditOutlined,
  FileProtectOutlined,
  PlusOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CONTRACT_SIGN_STATUS_LABEL,
  DOCUMENT_FIELD_LABEL,
  DOCUMENT_TYPE_META,
  type ContractSignStatus,
} from '@hireflow/shared';
import { App, Button, Form, Input, Result, Select, Spin, Upload } from 'antd';
import dayjs from 'dayjs';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { portalApi } from '../../api';
import { extractErrorMessage } from '../../api/client';
import type { ChecklistItem } from '../../api/types';
import { PortalShell } from './InterviewPortalPage';
import { ContractText } from '../../components/ContractText';
import { FormModal } from '../../components/FormModal';
import { pressable } from '../../utils/pressable';
import { prepareUpload } from '../../utils/prepareUpload';

const cssVars = (v: Record<string, string | number>) => v as CSSProperties;

const OWNER_LABEL: Record<ChecklistItem['owner'], string> = {
  HR: 'HR 准备',
  IT: 'IT 准备',
  NEW_HIRE: '需要您完成',
};

/** 清单项状态：待办 / 已完成 / HR 核对中 */
/** 清单项 → 对应的证件类型（「签署劳动合同」不对应证件，单独处理） */
const DOC_TYPE_BY_ITEM: Record<string, string> = Object.fromEntries(
  Object.entries(DOCUMENT_TYPE_META).map(([type, meta]) => [meta.checklistKey, type]),
);

function ItemRow({
  label,
  done,
  review,
  at,
  action,
}: {
  label: string;
  done: boolean;
  review?: boolean;
  at?: string | null;
  /** 未完成项的入口：有就渲染成可点的「去填写」，没有就给出等待说明 */
  action?: { text: string; onPress?: () => void };
}) {
  return (
    <div className="hf-check-row">
      <span className={done ? 'hf-check hf-check--on' : review ? 'hf-check hf-check--review' : 'hf-check'}>
        {done ? <CheckOutlined /> : null}
      </span>
      <span className={done ? 'hf-check-label hf-check-label--done' : 'hf-check-label'}>{label}</span>
      {review ? (
        <span className="hf-state--warn hf-review-note">HR 核对中</span>
      ) : done ? (
        at && <span className="hf-check-at">{dayjs(at).format('MM-DD HH:mm')}</span>
      ) : action?.onPress ? (
        <span className="hf-link" {...pressable(action.onPress)}>
          {action.text}
        </span>
      ) : (
        <span className="hf-faint">{action?.text ?? '待完成'}</span>
      )}
    </div>
  );
}

/** 新员工资料填报（免登录 H5）：进度前置 + 分组清单 + 材料识别结果核对 */
export function OnboardingPortalPage() {
  const { token = '' } = useParams();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [docOpen, setDocOpen] = useState(false);
  /** 打开上传弹窗时预选的材料类型（从清单项点进来时） */
  const [docPreset, setDocPreset] = useState<string | undefined>();
  const openDoc = (type?: string) => {
    setDocPreset(type);
    setDocOpen(true);
  };
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docForm] = Form.useForm<{ type: string; rawText?: string }>();
  // 每次打开都显式写入预选类型：表单实例常驻，initialValues 只在首次挂载时生效，
  // 否则第二次从「银行卡」点进来仍预选上一次的「身份证」，用户一提交就把已识别的身份证覆盖掉
  useEffect(() => {
    if (docOpen) docForm.setFieldsValue({ type: docPreset });
  }, [docOpen, docPreset, docForm]);

  const viewQuery = useQuery({
    queryKey: ['portal-onboarding', token],
    queryFn: () => portalApi.onboardingView(token),
    enabled: Boolean(token),
    retry: false,
  });

  const addDocMutation = useMutation({
    mutationFn: (values: { type: string; rawText?: string }) =>
      docFile
        ? portalApi.onboardingAddDocumentFile(token, { ...values, file: docFile })
        : portalApi.onboardingAddDocument(token, values as { type: string; rawText: string }),
    onSuccess: (data, values) => {
      queryClient.setQueryData(['portal-onboarding', token], data);
      setDocOpen(false);
      setDocFile(null);
      docForm.resetFields();
      message.success(docFile && !values.rawText ? '照片已提交，HR 将人工核对后确认' : '材料已提交，系统已自动识别关键信息');
    },
    onError: (error) => message.error(extractErrorMessage(error, '提交失败，请稍后重试')),
  });

  const signMutation = useMutation({
    mutationFn: () => portalApi.onboardingSignContract(token),
    onSuccess: (data) => {
      queryClient.setQueryData(['portal-onboarding', token], data);
      message.success('合同已签署，感谢配合！');
    },
    onError: (error) => message.error(extractErrorMessage(error, '签署失败，请稍后重试')),
  });

  const view = viewQuery.data;

  // 「已阅读合同条款」必须真的能读到：确认框里放全文，读完再签
  const confirmSign = () =>
    modal.confirm({
      title: '阅读并签署劳动合同',
      width: 560,
      icon: null,
      content: (
        <>
          <ContractText variables={view?.contract?.variables} />
          <div className="hf-faint u-mt-8">点击「我已阅读，确认签署」即表示同意以上条款，电子签署具有法律效力。</div>
        </>
      ),
      okText: '我已阅读，确认签署',
      cancelText: '稍后再签',
      onOk: () => signMutation.mutateAsync(),
    });

  const showContract = () =>
    modal.info({
      title: '劳动合同全文',
      width: 560,
      icon: null,
      content: <ContractText variables={view?.contract?.variables} />,
      okText: '关闭',
    });

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

  const myItems = view.checklist.filter((i) => i.owner === 'NEW_HIRE');
  const companyItems = view.checklist.filter((i) => i.owner !== 'NEW_HIRE');
  const submittedTypes = new Set(view.documents.map((d) => d.type));
  const pct = Math.round((view.progress.done / view.progress.total) * 100);
  /** 还有没交的证件：合同待签时也要能继续上传，两个入口并存 */
  const nextDocTodo = myItems.find((i) => !i.done && DOC_TYPE_BY_ITEM[i.key]);
  const contract = view.contract;
  const reviewing = view.documents.filter((d) => d.needsReview).length;
  const done = view.status === 'COMPLETED';

  return (
    <PortalShell
      title={done ? '入职流程已全部完成' : '入职资料填报'}
      desc={`${view.candidateName} · ${view.jobTitle}（${view.department}）`}
      company={view.company}
      footer={
        done ? (
          <div className="hf-portal-legal">期待您的到来 · 免登录安全链接，请勿转发他人</div>
        ) : (
          <>
            {contract?.signStatus === 'SENT' && (
              <Button type="primary" block icon={<EditOutlined />} loading={signMutation.isPending} onClick={confirmSign}>
                签署劳动合同
              </Button>
            )}
            {(contract?.signStatus !== 'SENT' || nextDocTodo) && (
              <Button
                // 还有证件没交 → 主按钮；证件已齐 → 次要按钮，仅用于补充 / 更正
                type={nextDocTodo && contract?.signStatus !== 'SENT' ? 'primary' : 'default'}
                block
                icon={<PlusOutlined />}
                className={contract?.signStatus === 'SENT' ? 'u-mt-8' : undefined}
                onClick={() => openDoc(nextDocTodo ? DOC_TYPE_BY_ITEM[nextDocTodo.key] : undefined)}
              >
                {nextDocTodo ? `继续：${nextDocTodo.label}` : '补充或更新证件材料'}
              </Button>
            )}
            <div className="hf-portal-legal">进度自动保存，可随时关闭后再回来</div>
          </>
        )
      }
    >
      {/* 进度前置：一眼看到还差几项 */}
      <div className="hf-portal-progress">
        <div className="u-flex-between u-mb-4">
          <span className="hf-muted">完成进度</span>
          <span className="hf-progress-num">
            {view.progress.done} / {view.progress.total}
          </span>
        </div>
        <div className="hf-bar-track">
          <span
            className="hf-bar-fill"
            style={cssVars({ '--w': `${Math.max(pct, 2)}%`, '--c': done ? '#059669' : '#2563EB' })}
          />
        </div>
      </div>

      {reviewing > 0 && (
        <div className="hf-notice hf-notice--warn u-mb-16">
          <WarningOutlined />
          <span>{reviewing} 项材料已收到，HR 正在人工核对，无需重复提交。</span>
        </div>
      )}

      {/* 需要您完成 */}
      <div className="hf-caption u-mb-4">需要您完成</div>
      {myItems.map((item) => {
        const docType = DOC_TYPE_BY_ITEM[item.key];
        const action = docType
          ? { text: '去上传', onPress: () => openDoc(docType) }
          : contract?.signStatus === 'SENT'
            ? { text: '去签署', onPress: confirmSign }
            : { text: '等待 HR 发送合同' };
        return <ItemRow key={item.key} label={item.label} done={item.done} at={item.doneAt} action={action} />;
      })}

      {/* 已提交材料：识别结果供核对 */}
      {view.documents.length > 0 && (
        <>
          <div className="hf-caption u-mt-16 u-mb-4">已提交的材料</div>
          {view.documents.map((doc) => (
            <div className="hf-portal-doc" key={doc.type}>
              <div className="u-flex-between">
                <span className="hf-secondary hf-strong">{doc.label}</span>
                {doc.needsReview ? (
                  <span className="hf-tag hf-tag--warn">人工核对中</span>
                ) : (
                  <span className="hf-tag hf-tag--ok">已识别</span>
                )}
              </div>
              {doc.fileUrl && <img src={doc.fileUrl} alt={`${doc.label}照片`} className="hf-portal-doc-img" />}
              {Object.keys(doc.fields).length > 0 ? (
                <>
                  {Object.entries(doc.fields).map(([k, v]) => (
                    <div className="hf-check-row hf-check-row--static" key={k}>
                      <span className="hf-muted hf-field-key hf-field-key--sm">{DOCUMENT_FIELD_LABEL[k] ?? k}</span>
                      <span className="hf-check-label">{v}</span>
                    </div>
                  ))}
                  <div className="hf-faint u-mt-4">请核对识别结果，如有误可重新提交同类型材料覆盖</div>
                </>
              ) : (
                <div className="hf-faint u-mt-4">照片已上传，HR 核对后会为您勾选对应事项，无需重复提交</div>
              )}
            </div>
          ))}
        </>
      )}

      {/* 劳动合同 */}
      <div className="hf-caption u-mt-16 u-mb-4">
        <FileProtectOutlined /> 劳动合同
      </div>
      {!contract ? (
        <div className="hf-notice hf-notice--flat">
          <span>
            {nextDocTodo
              ? '合同尚未生成，请先完成材料提交，HR 确认后会发起签署。'
              : '材料已提交齐全，HR 确认后会生成合同并发起签署，届时可在此在线签署。'}
          </span>
        </div>
      ) : (
        <>
          <div className="hf-check-row hf-check-row--static">
            <span className="hf-muted hf-field-key hf-field-key--sm">模板</span>
            <span className="hf-check-label">{contract.templateName}</span>
          </div>
          <div className="hf-check-row hf-check-row--static">
            <span className="hf-muted hf-field-key hf-field-key--sm">状态</span>
            <span className="hf-check-label">
              <span
                className={contract.signStatus === 'SIGNED' || contract.signStatus === 'ARCHIVED' ? 'hf-state--ok' : ''}
              >
                {CONTRACT_SIGN_STATUS_LABEL[contract.signStatus as ContractSignStatus] ?? contract.signStatus}
              </span>
            </span>
          </div>
          {Boolean(contract.variables?.salaryBase) && (
            <div className="hf-check-row hf-check-row--static">
              <span className="hf-muted hf-field-key hf-field-key--sm">月薪</span>
              <span className="hf-check-label hf-td--num">
                ¥{Number(contract.variables?.salaryBase).toLocaleString()}
              </span>
            </div>
          )}
          {Boolean(contract.variables?.startDate) && (
            <div className="hf-check-row hf-check-row--static">
              <span className="hf-muted hf-field-key hf-field-key--sm">入职日期</span>
              <span className="hf-check-label hf-td--num">{String(contract.variables?.startDate)}</span>
            </div>
          )}
          {contract.evidenceNo && (
            <div className="hf-check-row hf-check-row--static">
              <span className="hf-muted hf-field-key hf-field-key--sm">存证号</span>
              <span className="hf-check-label hf-mono hf-td--num">{contract.evidenceNo}</span>
            </div>
          )}
          <Button block className="hf-portal-action u-mt-8" onClick={showContract}>
            查看合同全文
          </Button>
        </>
      )}

      {/* 公司同步准备中 */}
      <div className="hf-caption u-mt-16 u-mb-4">公司同步为您准备</div>
      {companyItems.map((item) => (
        <div className="hf-check-row hf-check-row--static" key={item.key}>
          <span className={item.done ? 'hf-check hf-check--on' : 'hf-check'}>{item.done ? <CheckOutlined /> : null}</span>
          <span className={item.done ? 'hf-check-label hf-check-label--done' : 'hf-check-label'}>{item.label}</span>
          <span className="hf-faint">{OWNER_LABEL[item.owner]}</span>
        </div>
      ))}

      <FormModal form={docForm}
        className="hf-modal"
        title="提交证件材料"
        open={docOpen}
        onCancel={() => {
          setDocOpen(false);
          setDocFile(null);
          docForm.resetFields();
        }}
        onOk={() => docForm.submit()}
        confirmLoading={addDocMutation.isPending}
        destroyOnHidden
      >
        <Form
          form={docForm}
          layout="vertical"
          onFinish={(values) => addDocMutation.mutate(values)}
        >
          <Form.Item name="type" label="材料类型" rules={[{ required: true, message: '请选择类型' }]}>
            <Select
              placeholder="选择材料类型"
              options={Object.entries(DOCUMENT_TYPE_META).map(([value, meta]) => ({
                value,
                label: submittedTypes.has(value) ? `${meta.label}（已提交，可覆盖）` : meta.label,
              }))}
            />
          </Form.Item>
          <Form.Item label="拍照 / 选择图片" extra="照片将安全存档；未填写下方文字时由 HR 人工核对">
            <Upload
              accept="image/*"
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
              <Button icon={<CameraOutlined />} block>
                拍照或从相册选择
              </Button>
            </Upload>
          </Form.Item>
          <Form.Item
            name="rawText"
            label="证件文字内容"
            rules={docFile ? [{ min: 6, message: '内容过短' }] : [{ required: true, min: 6, message: '请输入材料文本' }]}
            extra="粘贴证件文字可立即自动识别；只传照片则由 HR 人工核对"
          >
            <Input.TextArea rows={4} placeholder="如：姓名：杨帆 公民身份号码 110105199305124533 住址：…" />
          </Form.Item>
        </Form>
      </FormModal>
    </PortalShell>
  );
}
