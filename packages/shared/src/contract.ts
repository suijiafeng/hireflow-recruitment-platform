/**
 * 劳动合同正文：由合同变量渲染出条款，新员工门户与后台共用同一份文本，
 * 保证「签署前阅读」的内容就是存证的内容。接入真实电子签后以服务商返回的 PDF 为准。
 */
export interface ContractVariables {
  companyName?: string;
  candidateName?: string;
  jobTitle?: string;
  department?: string;
  grade?: string;
  salaryBase?: number | null;
  bonusMonths?: number;
  probationMonths?: number;
  startDate?: string | null;
  signDate?: string;
  /** 无 salary:view 的后台视图会抹掉薪资变量并打上此标记 */
  salaryMasked?: boolean;
}

export interface ContractClause {
  title: string;
  text: string;
}

const formatMoney = (n: number) => n.toLocaleString('zh-CN');

export function renderContractClauses(vars: ContractVariables): ContractClause[] {
  const company = vars.companyName ?? '公司';
  const name = vars.candidateName ?? '员工';
  const probation = vars.probationMonths ?? 3;
  const salary = vars.salaryMasked
    ? '（薪资信息仅授权人员可见）'
    : vars.salaryBase != null
      ? `月基本工资人民币 ${formatMoney(vars.salaryBase)} 元（税前），年终奖 ${vars.bonusMonths ?? 0} 个月`
      : '以双方确认的 Offer 为准';
  return [
    {
      title: '一、合同双方',
      text: `甲方：${company}；乙方：${name}。双方根据《中华人民共和国劳动合同法》，经平等协商订立本合同。`,
    },
    {
      title: '二、合同期限与试用期',
      text: `本合同为三年期固定期限劳动合同，自 ${vars.startDate ?? '乙方实际报到之日'} 起算，其中试用期 ${probation} 个月。`,
    },
    {
      title: '三、工作内容',
      text: `乙方在${vars.department ?? '甲方指定部门'}担任${vars.jobTitle ?? '约定岗位'}${
        vars.grade && vars.grade !== '-' ? `（职级 ${vars.grade}）` : ''
      }，按甲方规章制度及岗位职责完成工作。`,
    },
    {
      title: '四、劳动报酬',
      text: `${salary}。试用期工资不低于转正工资的 80%。甲方每月 15 日前以银行转账方式支付上月工资。`,
    },
    {
      title: '五、工作时间与休假',
      text: '执行标准工时制，每日工作 8 小时、每周 40 小时；乙方依法享有法定节假日、带薪年休假等假期。',
    },
    {
      title: '六、社会保险与福利',
      text: '甲方依法为乙方缴纳社会保险及住房公积金，个人承担部分由甲方代扣代缴。',
    },
    {
      title: '七、保密义务',
      text: '乙方对在职期间知悉的甲方商业秘密负有保密义务，该义务在合同终止后继续有效。',
    },
    {
      title: '八、合同的解除与终止',
      text: '合同的变更、解除与终止按《劳动合同法》相关规定执行。本合同经双方电子签署后生效，具有同等法律效力。',
    },
  ];
}
