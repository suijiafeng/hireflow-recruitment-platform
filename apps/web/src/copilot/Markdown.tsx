import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNavigate } from 'react-router';

/**
 * 模型输出的 Markdown：react-markdown 默认不渲染原始 HTML（防 XSS）；
 * 站内链接走前端路由，外链新窗口打开，其它协议（javascript: 等）一律降级成纯文本。
 */
export function Markdown({ text }: { text: string }) {
  const navigate = useNavigate();
  const components: Components = {
    a: ({ href, children }) => {
      if (href?.startsWith('/')) {
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              navigate(href);
            }}
          >
            {children}
          </a>
        );
      }
      if (href && /^https?:\/\//.test(href)) {
        return (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        );
      }
      return <span>{children}</span>;
    },
    table: ({ children }) => (
      <div className="cp-md-table">
        <table>{children}</table>
      </div>
    ),
    img: () => null,
  };
  return (
    <div className="cp-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}
