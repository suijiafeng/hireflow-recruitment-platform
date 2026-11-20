import { DownOutlined } from '@ant-design/icons';
import { useId, useState } from 'react';
import { pressable } from '../utils/pressable';

/**
 * 测试账号面板：只在演示模式下被 Login 动态加载（见 utils/demo.ts）。
 * 演示密码只写在这个模块里——非演示构建不会生成这个 chunk。
 * 默认折叠成卡片底部一行灰字，不抢正式登录的视线。
 */
export const DEMO_ACCOUNTS = [
  { email: 'admin@arthr.local', role: '系统管理员' },
  { email: 'hr@arthr.local', role: 'HR / 招聘专员' },
  { email: 'manager@arthr.local', role: '用人经理' },
  { email: 'interviewer@arthr.local', role: '面试官' },
  { email: 'it@arthr.local', role: 'IT / 行政' },
];
export const DEMO_PASSWORD = 'Admin@123456';

export default function DemoAccounts({
  onPick,
  onLogin,
}: {
  onPick: (email: string, password: string) => void;
  onLogin: (email: string, password: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="login-demo">
      <button
        type="button"
        className="login-demo-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          演示账号<span className="login-demo-tag">仅演示环境</span>
        </span>
        <DownOutlined className="login-demo-chev" />
      </button>
      {open && (
        <div className="login-demo-list" id={listId}>
          {DEMO_ACCOUNTS.map((a) => (
            <div
              className="login-account-row"
              key={a.email}
              title="填入该账号；双击直接登录"
              {...pressable(() => onPick(a.email, DEMO_PASSWORD))}
              onDoubleClick={() => onLogin(a.email, DEMO_PASSWORD)}
            >
              <span>{a.email}</span>
              <span className="role">{a.role}</span>
            </div>
          ))}
          <div className="login-demo-pw">点一行填入账号，双击直接登录；密码 {DEMO_PASSWORD}</div>
        </div>
      )}
    </div>
  );
}
