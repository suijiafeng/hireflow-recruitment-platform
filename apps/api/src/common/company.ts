/** 对候选人展示的公司名（候选人页、合同、邮件）。部署时用 COMPANY_NAME 配置 */
export function companyName(): string {
  return process.env.COMPANY_NAME?.trim() || 'HireFlow 科技有限公司';
}
