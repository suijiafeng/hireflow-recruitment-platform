import { ClockCircleOutlined, DisconnectOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import axios from 'axios';
import { extractErrorMessage } from '../../api/client';
import { EmptyState } from '../../components/EmptyState';
import { PortalShell } from './PortalShell';

export type PortalLinkErrorKind = 'expired' | 'invalid' | 'network';

/** 410 = 链接已过期（后端 PORTAL_EXPIRED）；404 = 无效或已作废；其他 = 暂时打不开（可重试） */
export function portalErrorKind(error: unknown): PortalLinkErrorKind {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 410) return 'expired';
    if (error.response?.status === 404) return 'invalid';
  }
  return 'network';
}

export function isPortalExpired(error: unknown) {
  return portalErrorKind(error) === 'expired';
}

const COPY: Record<PortalLinkErrorKind, { title: string; fallback: string }> = {
  expired: {
    title: '链接已过期',
    fallback: '为保护您的个人信息，链接设有有效期。请联系 HR 重新发送。',
  },
  invalid: {
    title: '链接无效',
    fallback: '链接可能输入有误，或已被 HR 重新生成。请使用最新收到的链接，或联系 HR。',
  },
  network: {
    title: '暂时无法打开',
    fallback: '网络或服务暂时不可用，请稍后重试。',
  },
};

/** 候选人页的统一错误页：区分过期、无效与网络问题，给出下一步 */
export function PortalLinkError({
  error,
  onRetry,
  kind = portalErrorKind(error),
}: {
  error?: unknown;
  onRetry?: () => void;
  kind?: PortalLinkErrorKind;
}) {
  const copy = COPY[kind];
  // 过期与无效的说明以前端文案为准（后端文案偏技术）；网络错误展示后端/超时原因
  const desc = kind === 'network' ? extractErrorMessage(error, copy.fallback) : copy.fallback;
  return (
    <PortalShell title={copy.title}>
      <EmptyState
        size="lg"
        tone={kind === 'network' ? 'warn' : 'neutral'}
        icon={kind === 'expired' ? <ClockCircleOutlined /> : <DisconnectOutlined />}
        title={copy.title}
        description={desc}
        action={
          kind === 'network' && onRetry ? (
            <Button icon={<ReloadOutlined />} onClick={onRetry}>
              重试
            </Button>
          ) : undefined
        }
        className="hf-portal-error"
      />
    </PortalShell>
  );
}

/** 旧版 /portal/(offer|onboarding|interview|prescreen)/:token 地址：统一按「链接无效」处理 */
export function RetiredPortalLink() {
  return <PortalLinkError kind="invalid" />;
}
