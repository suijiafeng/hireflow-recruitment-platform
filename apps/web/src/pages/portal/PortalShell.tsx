import type { ReactNode } from 'react';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

/** 免登录 H5 外壳：深色品牌头 + 单列滚动内容 + 固定底部主操作 */
export function PortalShell({
  title,
  desc,
  company = 'HireFlow',
  children,
  footer,
}: {
  title: ReactNode;
  desc?: ReactNode;
  company?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  // 候选人看到的是公司名，不是内部系统名
  useDocumentTitle(typeof title === 'string' ? `${title} · ${company}` : company);
  return (
    <div className="hf-portal">
      <div className="hf-portal-head">
        <div className="hf-portal-brand">
          <span className="hf-portal-mark">{company.slice(0, 1)}</span>
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
