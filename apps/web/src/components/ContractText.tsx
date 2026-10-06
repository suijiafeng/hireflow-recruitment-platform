import { renderContractClauses, type ContractVariables } from '@hireflow/shared';

/** 劳动合同正文（门户签署前阅读、后台预览共用；条款由共享包按合同变量渲染） */
export function ContractText({ variables }: { variables: Record<string, unknown> | null | undefined }) {
  const clauses = renderContractClauses((variables ?? {}) as ContractVariables);
  return (
    <div className="hf-contract-text" tabIndex={0} aria-label="劳动合同全文">
      {clauses.map((c) => (
        <section key={c.title}>
          <div className="hf-contract-title">{c.title}</div>
          <p>{c.text}</p>
        </section>
      ))}
    </div>
  );
}
