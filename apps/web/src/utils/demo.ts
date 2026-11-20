/**
 * 演示模式（登录页展示测试账号）。
 *
 * - 开发环境（vite dev）默认开启，可用 VITE_DEMO_MODE=false 关闭；
 * - 生产构建默认关闭，只有显式 VITE_DEMO_MODE=true（公开演示站）才展示；
 * - 无论哪种情况，生产构建都不预填密码——演示站点一下账号行再填入。
 *
 * Login.tsx 里用同一规则直接读 import.meta.env 写成内联表达式：Vite 构建时替换成字面量，
 * 关闭时测试账号模块（含演示密码）与预填对象整块被摇掉，不会出现在产物里（构建后 grep 产物可验证）。
 */
/** 演示模式规则（纯函数，供单测覆盖各组合；Login.tsx 的内联表达式须与之一致） */
export function demoFlags(env: { DEV?: boolean; VITE_DEMO_MODE?: string }) {
  const showAccounts = env.VITE_DEMO_MODE === 'true' || (Boolean(env.DEV) && env.VITE_DEMO_MODE !== 'false');
  return { showAccounts, prefillPassword: showAccounts && Boolean(env.DEV) };
}
