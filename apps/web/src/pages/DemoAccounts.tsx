import { pressable } from '../utils/pressable';

/**
 * 测试账号面板：只在演示模式下被 Login 动态加载（见 utils/demo.ts）。
 * 演示密码只写在这个模块里——非演示构建不会生成这个 chunk。
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
  return (
    <div className="login-tip">
      <div className="login-tip-title">
        <span>演示账号</span>
        <span>密码 {DEMO_PASSWORD}</span>
      </div>
      <div className="login-tip-content">
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
      </div>
    </div>
  );
}
