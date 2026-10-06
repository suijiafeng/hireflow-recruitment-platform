/**
 * 种子数据：幂等可重复执行。
 * 角色/权限/部门/内部账号始终 upsert 对齐。
 */
import 'dotenv/config';
import { hashSync } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import {
  ACTIVITY_ACTIONS,
  DEFAULT_ONBOARDING_CHECKLIST,
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_DEFS,
  RoleCode,
} from '@hireflow/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

/** 与 src/common/portal.ts 的 newPortalToken 同算法（seed 不引用应用代码） */
const demoPortalToken = () => randomBytes(24).toString('base64url');

const DEV_PASSWORD = 'Admin@123456';

async function seedRbac() {
  for (const def of PERMISSION_DEFS) {
    await prisma.permission.upsert({
      where: { code: def.code },
      create: def,
      update: { name: def.name, group: def.group },
    });
  }

  for (const [code, def] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const existed = await prisma.role.findUnique({ where: { code } });
    const role = await prisma.role.upsert({
      where: { code },
      create: { code, name: def.name, dataScope: def.dataScope },
      update: { name: def.name, dataScope: def.dataScope },
    });
    // ADMIN 始终全量对齐（新增权限点自动补上，设置页也锁定不可编辑）；
    // 其余角色仅首次创建时写入默认值，此后不再覆盖——设置页的自定义权限要在重启/重部署后存活
    if (!existed && code !== RoleCode.ADMIN) {
      const permissions = await prisma.permission.findMany({
        where: { code: { in: [...def.permissions] } },
      });
      await prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      });
    }
    if (code === RoleCode.ADMIN) {
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      const permissions = await prisma.permission.findMany({
        where: { code: { in: [...def.permissions] } },
      });
      await prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      });
    }
  }
  console.log(`✔ RBAC：${PERMISSION_DEFS.length} 个权限点 / ${Object.keys(DEFAULT_ROLE_PERMISSIONS).length} 个角色`);
}

async function seedDepartmentsAndUsers() {
  const tech = await upsertDepartment('技术部');
  const product = await upsertDepartment('产品部');

  const passwordHash = hashSync(DEV_PASSWORD, 10);
  const users: Array<{ email: string; name: string; role: RoleCode; departmentId?: string }> = [
    { email: 'admin@arthr.local', name: '系统管理员', role: RoleCode.ADMIN },
    { email: 'hr@arthr.local', name: '何欣（HR）', role: RoleCode.HR },
    { email: 'manager@arthr.local', name: '林涛（技术总监）', role: RoleCode.HIRING_MANAGER, departmentId: tech.id },
    { email: 'interviewer@arthr.local', name: '苏晴（资深工程师）', role: RoleCode.INTERVIEWER, departmentId: tech.id },
    { email: 'it@arthr.local', name: '陈明（IT 支持）', role: RoleCode.IT_SUPPORT },
  ];

  for (const u of users) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: u.role } });
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: { email: u.email, name: u.name, passwordHash, departmentId: u.departmentId },
      update: { name: u.name, departmentId: u.departmentId },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
  }
  console.log(`✔ 部门与账号：${users.length} 个测试账号（密码 ${DEV_PASSWORD}）`);
  return { tech, product };
}

async function upsertDepartment(name: string) {
  const found = await prisma.department.findFirst({ where: { name } });
  return found ?? prisma.department.create({ data: { name } });
}

interface DemoCandidate {
  name: string;
  email: string;
  phone: string;
  source: string;
  tags: string[];
  matchScore: number;
  stage: string;
}

async function seedDemoData(techDeptId: string, productDeptId: string) {
  if ((await prisma.job.count()) > 0) {
    console.log('… 已存在职位数据，跳过示例数据');
    return;
  }

  const hr = await prisma.user.findUniqueOrThrow({ where: { email: 'hr@arthr.local' } });
  const manager = await prisma.user.findUniqueOrThrow({ where: { email: 'manager@arthr.local' } });

  const backendJob = await prisma.job.create({
    data: {
      title: '后端工程师',
      description:
        '负责智能招聘平台核心服务研发：Pipeline 流转引擎、RBAC 权限体系、自动化工作流。技术栈 NestJS + PostgreSQL + Redis。',
      requirement: '3 年以上后端经验；熟悉 Node.js/TypeScript；有 B 端系统或高并发经验者优先。',
      headcount: 2,
      status: 'OPEN',
      departmentId: techDeptId,
      hiringManagerId: manager.id,
      createdById: hr.id,
      stages: { create: DEFAULT_PIPELINE_STAGES.map((name, index) => ({ name, order: index })) },
    },
    include: { stages: true },
  });

  const productJob = await prisma.job.create({
    data: {
      title: '产品经理（B端）',
      description: '负责 ATS 产品规划与需求落地，深度参与 AI 招聘场景设计。',
      requirement: '3 年以上 B 端产品经验，有 HR SaaS 背景优先。',
      headcount: 1,
      status: 'OPEN',
      departmentId: productDeptId,
      createdById: hr.id,
      stages: { create: DEFAULT_PIPELINE_STAGES.map((name, index) => ({ name, order: index })) },
    },
    include: { stages: true },
  });

  const stageByName = (jobStages: { id: string; name: string }[], name: string) =>
    jobStages.find((s) => s.name === name)!;

  const backendCandidates: DemoCandidate[] = [
    { name: '张伟', email: 'zhangwei@example.com', phone: '13800000001', source: 'BOSS直聘', tags: ['React', 'TypeScript', 'Node.js'], matchScore: 92, stage: '二面' },
    { name: '李娜', email: 'lina@example.com', phone: '13800000002', source: '猎聘', tags: ['NestJS', 'PostgreSQL', '微服务'], matchScore: 88, stage: '一面' },
    { name: '王强', email: 'wangqiang@example.com', phone: '13800000003', source: '内推', tags: ['Java', 'Spring', '高并发'], matchScore: 85, stage: '一面' },
    { name: '赵敏', email: 'zhaomin@example.com', phone: '13800000004', source: '拉勾', tags: ['Go', 'Kubernetes', '微服务'], matchScore: 81, stage: '简历初筛' },
    { name: '刘洋', email: 'liuyang@example.com', phone: '13800000005', source: 'BOSS直聘', tags: ['Python', '数据工程'], matchScore: 74, stage: '简历初筛' },
    { name: '陈静', email: 'chenjing@example.com', phone: '13800000006', source: '官网投递', tags: ['Node.js', 'React', '全栈'], matchScore: 79, stage: '简历初筛' },
    { name: '杨帆', email: 'yangfan@example.com', phone: '13800000007', source: '猎头推荐', tags: ['Java', '分布式', '带团队'], matchScore: 90, stage: 'Offer' },
    { name: '周杰', email: 'zhoujie@example.com', phone: '13800000008', source: '人才库唤醒', tags: ['Vue', '小程序'], matchScore: 68, stage: '待入职' },
  ];
  const productCandidates: DemoCandidate[] = [
    { name: '吴悠', email: 'wuyou@example.com', phone: '13800000011', source: 'BOSS直聘', tags: ['B端产品', '数据分析'], matchScore: 86, stage: '一面' },
    { name: '郑好', email: 'zhenghao@example.com', phone: '13800000012', source: '猎聘', tags: ['产品设计', '用户研究'], matchScore: 77, stage: '简历初筛' },
  ];

  const seedApplications = async (job: typeof backendJob, candidates: DemoCandidate[]) => {
    let position = 0;
    for (const c of candidates) {
      const candidate = await prisma.candidate.create({
        data: {
          name: c.name,
          email: c.email,
          phone: c.phone,
          source: c.source,
          tags: c.tags,
          resumes: {
            create: {
              fileName: `${c.name}-简历.pdf`,
              parseStatus: 'DONE',
              skills: c.tags,
              parsed: {
                summary: `${c.tags.join('/')} 方向候选人，示例解析结果`,
                educations: [{ school: '示例大学', degree: '本科' }],
                experiences: [{ company: '示例科技', title: '工程师', years: 3 }],
              },
            },
          },
        },
      });
      const stage = stageByName(job.stages, c.stage);
      const application = await prisma.application.create({
        data: {
          candidateId: candidate.id,
          jobId: job.id,
          stageId: stage.id,
          matchScore: c.matchScore,
          position: ++position,
        },
      });
      await prisma.activityLog.create({
        data: {
          actorId: hr.id,
          actorName: hr.name,
          action: ACTIVITY_ACTIONS.APPLICATION_CREATED,
          entityType: 'Application',
          entityId: application.id,
          payload: { candidate: c.name, job: job.title, stage: stage.name },
        },
      });
    }
  };

  await seedApplications(backendJob, backendCandidates);
  await seedApplications(productJob, productCandidates);

  // 李娜：明天 14:00 一面；张伟：补一场已完成的一面与面评
  const interviewer = await prisma.user.findUniqueOrThrow({
    where: { email: 'interviewer@arthr.local' },
  });
  const lina = await prisma.application.findFirstOrThrow({
    where: { job: { id: backendJob.id }, candidate: { name: '李娜' } },
  });
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(14, 0, 0, 0);
  await prisma.interview.create({
    data: {
      applicationId: lina.id,
      round: 1,
      scheduledAt: tomorrow,
      durationMins: 60,
      interviewers: { create: [{ userId: interviewer.id }] },
    },
  });

  const zhangwei = await prisma.application.findFirstOrThrow({
    where: { job: { id: backendJob.id }, candidate: { name: '张伟' } },
  });
  const doneInterview = await prisma.interview.create({
    data: {
      applicationId: zhangwei.id,
      round: 1,
      scheduledAt: new Date(Date.now() - 3 * 24 * 3600 * 1000),
      durationMins: 60,
      status: 'COMPLETED',
      interviewers: { create: [{ userId: interviewer.id }] },
    },
  });
  await prisma.evaluation.create({
    data: {
      interviewId: doneInterview.id,
      interviewerId: interviewer.id,
      conclusion: 'YES',
      comments: '工程基础扎实，React 生态经验丰富，沟通清晰，建议进入二面。',
      submittedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
      scorecard: [
        { dimension: '技术能力', score: 4, comment: '框架原理理解到位' },
        { dimension: '工程素养', score: 4, comment: '重视测试与代码规范' },
        { dimension: '沟通协作', score: 5, comment: '表达结构化' },
      ],
    },
  });
  await prisma.activityLog.create({
    data: {
      actorId: interviewer.id,
      actorName: interviewer.name,
      action: ACTIVITY_ACTIONS.EVALUATION_SUBMITTED,
      entityType: 'Application',
      entityId: zhangwei.id,
      payload: { candidate: '张伟', round: 1, conclusion: 'YES' },
    },
  });

  console.log(
    `✔ 示例数据：2 个职位 / ${backendCandidates.length + productCandidates.length} 名候选人 / 2 场面试`,
  );
}

async function seedCompanyDocs() {
  const docs = [
    {
      title: '办公网络与 WiFi 使用规定',
      tags: ['WiFi', '网络', '密码'],
      content:
        '办公区 WiFi：员工网络 SSID 为 ART-Staff，密码为 art@2026!，每季度更换一次并由 IT 邮件通知；访客网络 SSID 为 ART-Guest，密码 guest2026。严禁将员工网络密码告知外部人员。VPN 远程接入请在 IT 服务台提交申请，审批通过后 1 个工作日内开通。',
    },
    {
      title: '五险一金缴纳说明',
      tags: ['公积金', '社保', '五险一金'],
      content:
        '公司按国家与本市规定为员工缴纳五险一金。住房公积金缴存比例为个人 12% + 公司 12%，以上月应发工资为基数；社保（养老/医疗/失业/工伤/生育）按本市最新基数标准执行。入职当月 15 日前报到的员工当月起缴，15 日后次月起缴。公积金账户转移请联系 HR 何欣。',
    },
    {
      title: '休假制度（年假/病假/事假）',
      tags: ['年假', '请假', '病假', '事假', '调休'],
      content:
        '年假：入职满 1 年 5 天，满 3 年 10 天，满 10 年 15 天，按自然年折算，当年未休完可顺延至次年 3 月底。病假：需提供医院证明，全年累计 10 天内全薪。事假：无薪，需提前 1 天在 OA 申请。申请路径：OA → 假勤 → 请假申请，直属上级审批，3 天以上需部门负责人审批。',
    },
    {
      title: '差旅与报销制度',
      tags: ['报销', '差旅', '发票'],
      content:
        '报销周期：每月 1-5 日提交上月单据，财务 15 日前打款。交通：市内打车凭发票实报，异地差旅高铁二等座/经济舱。住宿标准：一线城市 500 元/晚，其他城市 350 元/晚。餐补：出差期间 100 元/天。所有报销需在 OA 上传发票照片并由直属上级审批。',
    },
    {
      title: '试用期与转正规定',
      tags: ['试用期', '转正', '考核'],
      content:
        '试用期一般为 3 个月，表现优秀者可申请提前转正（最早满 1 个月）。试用期工资为转正工资的 100%（不打折）。转正流程：试用期满前 2 周，员工在 OA 提交转正述职，直属上级与 HRBP 评估，用人部门负责人审批。试用期内双方均可提前 3 天通知解除劳动关系。',
    },
    {
      title: '考勤与办公时间',
      tags: ['考勤', '打卡', '办公时间', '远程'],
      content:
        '标准工作时间为周一至周五 10:00-19:00（含 1 小时午休），弹性打卡区间 9:00-10:30。每周三为无会议日。每月可申请 4 天远程办公，需提前 1 天报备直属上级。缺卡每月可补 3 次，在 OA → 假勤 → 补卡申请中提交。',
    },
  ];
  for (const doc of docs) {
    const existing = await prisma.companyDoc.findFirst({ where: { title: doc.title } });
    if (existing) {
      await prisma.companyDoc.update({ where: { id: existing.id }, data: doc });
    } else {
      await prisma.companyDoc.create({ data: doc });
    }
  }
  console.log(`✔ 制度文档：${docs.length} 篇（入职问答机器人知识库）`);
}

// ---------------------------------------------------------------------------
// 扩展示例数据
//
// 基础 seedDemoData 的数据全部落在「当下」，导致三件事看不出效果：
//   1. 洞察页的时间范围筛选（近30天/本季度/今年）三档数字完全一样；
//   2. TTH、Offer 接受率、阶段停留 P50/P90 全是空或 0——没有走完流程的样本；
//   3. 录用管理与入职管理两页整页空白。
// 这里补一批跨 12 个月的历史数据，专门把上面三块喂满。
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const daysAgo = (n: number, hour = 10) => {
  const d = new Date(Date.now() - n * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
};

interface HistoryCandidate {
  name: string;
  email: string;
  source: string;
  tags: string[];
  matchScore: number;
  /** 投递距今天数 */
  appliedDaysAgo: number;
  /** ACTIVE 停在哪个阶段；HIRED/REJECTED 为终态 */
  outcome: 'HIRED' | 'REJECTED' | 'ACTIVE';
  stage: string;
  /** HIRED 专用：入职闭环距今天数（TTH = applied - completed） */
  hiredDaysAgo?: number;
  /** REJECTED 专用 */
  rejectReason?: string;
  /** ACTIVE 专用：进入当前阶段距今天数（驱动「超时停留」提示） */
  stageEnteredDaysAgo?: number;
}

async function seedExtendedDemo() {
  const MARKER_JOB = '前端工程师';
  if (await prisma.job.findFirst({ where: { title: MARKER_JOB } })) {
    console.log('… 已存在扩展示例数据，跳过');
    return;
  }

  const tech = await upsertDepartment('技术部');
  const product = await upsertDepartment('产品部');
  const design = await upsertDepartment('设计部');
  const marketing = await upsertDepartment('市场部');

  const hr = await prisma.user.findUniqueOrThrow({ where: { email: 'hr@arthr.local' } });
  const manager = await prisma.user.findUniqueOrThrow({ where: { email: 'manager@arthr.local' } });

  // 多几个面试官，「面试官效能」图才有横向对比（通过率偏离基线才看得出来）
  const passwordHash = hashSync(DEV_PASSWORD, 10);
  const extraStaff: Array<{ email: string; name: string; role: RoleCode; departmentId: string }> = [
    { email: 'zhaolei@arthr.local', name: '赵磊（后端专家）', role: RoleCode.INTERVIEWER, departmentId: tech.id },
    { email: 'qianwen@arthr.local', name: '钱文（前端负责人）', role: RoleCode.INTERVIEWER, departmentId: tech.id },
    { email: 'sunli@arthr.local', name: '孙丽（设计总监）', role: RoleCode.HIRING_MANAGER, departmentId: design.id },
    { email: 'zhoumin@arthr.local', name: '周敏（市场总监）', role: RoleCode.HIRING_MANAGER, departmentId: marketing.id },
  ];
  const staff: Record<string, { id: string; name: string }> = {};
  for (const s of extraStaff) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: s.role } });
    const user = await prisma.user.upsert({
      where: { email: s.email },
      create: { email: s.email, name: s.name, passwordHash, departmentId: s.departmentId },
      update: { name: s.name, departmentId: s.departmentId },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
    staff[s.email] = { id: user.id, name: user.name };
  }
  const suqing = await prisma.user.findUniqueOrThrow({ where: { email: 'interviewer@arthr.local' } });
  const interviewers = [
    { id: suqing.id, name: suqing.name },
    staff['zhaolei@arthr.local'],
    staff['qianwen@arthr.local'],
  ];

  /** 建职位并回带阶段 */
  const mkJob = async (data: {
    title: string;
    departmentId: string;
    headcount: number;
    status: 'OPEN' | 'PAUSED' | 'CLOSED';
    hiringManagerId?: string;
    createdDaysAgo: number;
    description?: string;
    requirement?: string;
  }) =>
    prisma.job.create({
      data: {
        title: data.title,
        description: data.description ?? `${data.title}岗位说明（示例数据）`,
        requirement: data.requirement ?? '3 年以上相关经验，具备良好的沟通与协作能力。',
        headcount: data.headcount,
        status: data.status,
        departmentId: data.departmentId,
        hiringManagerId: data.hiringManagerId,
        createdById: hr.id,
        createdAt: daysAgo(data.createdDaysAgo),
        stages: { create: DEFAULT_PIPELINE_STAGES.map((name, index) => ({ name, order: index })) },
      },
      include: { stages: true },
    });

  const frontendJob = await mkJob({
    title: MARKER_JOB,
    departmentId: tech.id,
    headcount: 3,
    status: 'CLOSED',
    hiringManagerId: staff['qianwen@arthr.local'].id,
    createdDaysAgo: 320,
    description: '负责 ATS 前端体系建设：看板拖拽、可视化图表、免登录 H5 门户。技术栈 React + TypeScript + Vite。',
    requirement: '3 年以上前端经验；熟悉 React 生态；有复杂交互或数据可视化经验者优先。',
  });
  const qaJob = await mkJob({
    title: '测试工程师',
    departmentId: tech.id,
    headcount: 2,
    status: 'OPEN',
    hiringManagerId: manager.id,
    createdDaysAgo: 150,
  });
  const dataJob = await mkJob({
    title: '数据分析师',
    departmentId: tech.id,
    headcount: 1,
    status: 'PAUSED',
    hiringManagerId: manager.id,
    createdDaysAgo: 95,
  });
  const uiJob = await mkJob({
    title: 'UI 设计师',
    departmentId: design.id,
    headcount: 2,
    status: 'OPEN',
    hiringManagerId: staff['sunli@arthr.local'].id,
    createdDaysAgo: 60,
  });
  const marketingJob = await mkJob({
    title: '市场运营专员',
    departmentId: marketing.id,
    headcount: 2,
    status: 'OPEN',
    hiringManagerId: staff['zhoumin@arthr.local'].id,
    createdDaysAgo: 25,
  });

  const stageOf = (job: { stages: Array<{ id: string; name: string }> }, name: string) =>
    job.stages.find((s) => s.name === name) ?? job.stages[0];

  /**
   * 落一条完整的应聘记录，含：
   * - 回填的 createdAt / stageEnteredAt（驱动 TTH 与超时停留）
   * - application.created 留痕
   * - 逐阶段的 stage_changed 留痕（阶段停留 P50/P90 靠回放这些日志算）
   * - HIRED 的 onboarding.completed 留痕（TTH 的终点）
   */
  const placeCandidate = async (
    job: { id: string; title: string; stages: Array<{ id: string; name: string }> },
    c: HistoryCandidate,
  ) => {
    const appliedAt = daysAgo(c.appliedDaysAgo);
    const candidate = await prisma.candidate.create({
      data: {
        name: c.name,
        email: c.email,
        phone: `137${String(Math.abs(hashCode(c.email)) % 100_000_000).padStart(8, '0')}`,
        source: c.source,
        tags: c.tags,
        createdAt: appliedAt,
        resumes: {
          create: {
            fileName: `${c.name}-简历.pdf`,
            parseStatus: 'DONE',
            skills: c.tags,
            createdAt: appliedAt,
            parsed: { summary: `${c.tags.join('/')} 方向候选人，示例解析结果` },
          },
        },
      },
    });

    const targetStage = stageOf(job, c.stage);
    /**
     * 旅程终点：HIRED 取入职闭环日、REJECTED 取淘汰日、ACTIVE 取进入当前阶段日。
     * 不能一律用「投递后 2 天」——那会让一个走完 5 个阶段的人显示成两天走完全程，
     * 阶段停留 P50/P90 全变成 0.4 天，图就没意义了。
     */
    const journeyEndDaysAgo =
      c.outcome === 'HIRED'
        ? (c.hiredDaysAgo ?? Math.max(c.appliedDaysAgo - 30, 0))
        : c.outcome === 'REJECTED'
          ? Math.max(c.appliedDaysAgo - 20, 0)
          : (c.stageEnteredDaysAgo ?? Math.max(c.appliedDaysAgo - 2, 0));
    const stageEnteredAt = daysAgo(journeyEndDaysAgo);

    const application = await prisma.application.create({
      data: {
        candidateId: candidate.id,
        jobId: job.id,
        stageId: targetStage.id,
        status: c.outcome,
        matchScore: c.matchScore,
        rejectReason: c.rejectReason,
        position: Math.random() * 1000,
        createdAt: appliedAt,
        stageEnteredAt,
      },
    });

    await prisma.activityLog.create({
      data: {
        actorId: hr.id,
        actorName: hr.name,
        action: ACTIVITY_ACTIONS.APPLICATION_CREATED,
        entityType: 'Application',
        entityId: application.id,
        payload: { candidate: c.name, job: job.title, stage: DEFAULT_PIPELINE_STAGES[0] },
        createdAt: appliedAt,
      },
    });

    // 逐级流转留痕：把「投递 → 当前阶段」之间的每一跳都补上，
    // 时间在投递日与当前阶段进入日之间均分，阶段停留才有真实分布
    const targetIndex = (DEFAULT_PIPELINE_STAGES as readonly string[]).indexOf(targetStage.name);
    const span = appliedAt.getTime() - stageEnteredAt.getTime();
    for (let i = 1; i <= targetIndex; i += 1) {
      const at = new Date(appliedAt.getTime() - (span * i) / Math.max(targetIndex, 1));
      await prisma.activityLog.create({
        data: {
          actorId: hr.id,
          actorName: hr.name,
          action: ACTIVITY_ACTIONS.APPLICATION_STAGE_CHANGED,
          entityType: 'Application',
          entityId: application.id,
          payload: { from: DEFAULT_PIPELINE_STAGES[i - 1], to: DEFAULT_PIPELINE_STAGES[i], candidate: c.name },
          createdAt: at,
        },
      });
    }

    if (c.outcome === 'HIRED' && c.hiredDaysAgo != null) {
      await prisma.activityLog.create({
        data: {
          actorId: hr.id,
          actorName: hr.name,
          action: ACTIVITY_ACTIONS.ONBOARDING_COMPLETED,
          entityType: 'Application',
          entityId: application.id,
          payload: { candidate: c.name, job: job.title },
          createdAt: daysAgo(c.hiredDaysAgo),
        },
      });
    }
    if (c.outcome === 'REJECTED') {
      await prisma.activityLog.create({
        data: {
          actorId: hr.id,
          actorName: hr.name,
          action: ACTIVITY_ACTIONS.APPLICATION_REJECTED,
          entityType: 'Application',
          entityId: application.id,
          payload: { candidate: c.name, reason: c.rejectReason },
          createdAt: daysAgo(Math.max(c.appliedDaysAgo - 20, 0)),
        },
      });
    }
    return { application, candidate };
  };

  // ---- 历史同期群：跨 12 个月，覆盖入职/淘汰/在途三种归宿 ----
  const frontendHistory: HistoryCandidate[] = [
    { name: '孙浩', email: 'sunhao@example.com', source: '猎聘', tags: ['React', 'Webpack'], matchScore: 91, appliedDaysAgo: 300, outcome: 'HIRED', stage: '已入职', hiredDaysAgo: 262 },
    { name: '马晓', email: 'maxiao@example.com', source: 'BOSS直聘', tags: ['Vue', 'TypeScript'], matchScore: 87, appliedDaysAgo: 285, outcome: 'HIRED', stage: '已入职', hiredDaysAgo: 243 },
    { name: '胡兵', email: 'hubing@example.com', source: '内推', tags: ['React', 'Node.js'], matchScore: 84, appliedDaysAgo: 270, outcome: 'HIRED', stage: '已入职', hiredDaysAgo: 236 },
    { name: '林芳', email: 'linfang@example.com', source: '拉勾', tags: ['前端', '小程序'], matchScore: 62, appliedDaysAgo: 290, outcome: 'REJECTED', stage: '一面', rejectReason: '技术能力不匹配' },
    { name: '郭强', email: 'guoqiang@example.com', source: '官网投递', tags: ['jQuery'], matchScore: 45, appliedDaysAgo: 280, outcome: 'REJECTED', stage: '简历初筛', rejectReason: '技术栈不符' },
  ];
  const qaHistory: HistoryCandidate[] = [
    { name: '何露', email: 'helu@example.com', source: '猎头推荐', tags: ['自动化测试', 'Playwright'], matchScore: 89, appliedDaysAgo: 140, outcome: 'HIRED', stage: '已入职', hiredDaysAgo: 96 },
    { name: '许诺', email: 'xunuo@example.com', source: 'BOSS直聘', tags: ['接口测试', 'Postman'], matchScore: 76, appliedDaysAgo: 120, outcome: 'REJECTED', stage: '二面', rejectReason: '薪资预期不匹配' },
    { name: '邓超', email: 'dengchao@example.com', source: '猎聘', tags: ['性能测试', 'JMeter'], matchScore: 82, appliedDaysAgo: 45, outcome: 'ACTIVE', stage: '二面', stageEnteredDaysAgo: 12 },
    { name: '曹阳', email: 'caoyang@example.com', source: '内推', tags: ['测试开发', 'Python'], matchScore: 80, appliedDaysAgo: 28, outcome: 'ACTIVE', stage: '一面', stageEnteredDaysAgo: 9 },
    { name: '袁媛', email: 'yuanyuan@example.com', source: '官网投递', tags: ['手工测试'], matchScore: 58, appliedDaysAgo: 26, outcome: 'ACTIVE', stage: '简历初筛', stageEnteredDaysAgo: 22 },
  ];
  const dataHistory: HistoryCandidate[] = [
    { name: '范磊', email: 'fanlei@example.com', source: '猎聘', tags: ['SQL', 'Python', 'BI'], matchScore: 88, appliedDaysAgo: 88, outcome: 'HIRED', stage: '已入职', hiredDaysAgo: 42 },
    { name: '石磊', email: 'shilei@example.com', source: 'BOSS直聘', tags: ['数据仓库', 'dbt'], matchScore: 79, appliedDaysAgo: 70, outcome: 'REJECTED', stage: 'Offer', rejectReason: '候选人接受了其他 Offer' },
    { name: '田甜', email: 'tiantian@example.com', source: '人才库唤醒', tags: ['数据分析', 'Tableau'], matchScore: 73, appliedDaysAgo: 55, outcome: 'ACTIVE', stage: '一面', stageEnteredDaysAgo: 18 },
  ];
  const uiHistory: HistoryCandidate[] = [
    { name: '汪静', email: 'wangjing@example.com', source: '猎头推荐', tags: ['Figma', 'B端设计', '设计系统'], matchScore: 93, appliedDaysAgo: 50, outcome: 'HIRED', stage: '已入职', hiredDaysAgo: 18 },
    { name: '方圆', email: 'fangyuan@example.com', source: 'BOSS直聘', tags: ['交互设计', '用户研究'], matchScore: 85, appliedDaysAgo: 40, outcome: 'ACTIVE', stage: 'Offer', stageEnteredDaysAgo: 6 },
    { name: '崔莹', email: 'cuiying@example.com', source: '拉勾', tags: ['视觉设计', 'C端'], matchScore: 71, appliedDaysAgo: 35, outcome: 'ACTIVE', stage: '二面', stageEnteredDaysAgo: 15 },
    { name: '龙飞', email: 'longfei@example.com', source: '官网投递', tags: ['插画', '品牌设计'], matchScore: 55, appliedDaysAgo: 33, outcome: 'REJECTED', stage: '简历初筛', rejectReason: '方向不匹配' },
    { name: '秦月', email: 'qinyue@example.com', source: '内推', tags: ['Figma', '动效'], matchScore: 81, appliedDaysAgo: 20, outcome: 'ACTIVE', stage: '一面', stageEnteredDaysAgo: 8 },
  ];
  const marketingHistory: HistoryCandidate[] = [
    { name: '严欣', email: 'yanxin@example.com', source: 'BOSS直聘', tags: ['内容运营', '社媒'], matchScore: 84, appliedDaysAgo: 20, outcome: 'ACTIVE', stage: '二面', stageEnteredDaysAgo: 4 },
    { name: '侯亮', email: 'houliang@example.com', source: '猎聘', tags: ['增长', '投放'], matchScore: 78, appliedDaysAgo: 18, outcome: 'ACTIVE', stage: '一面', stageEnteredDaysAgo: 11 },
    { name: '雷鸣', email: 'leiming@example.com', source: '人才库唤醒', tags: ['活动策划'], matchScore: 66, appliedDaysAgo: 15, outcome: 'ACTIVE', stage: '简历初筛', stageEnteredDaysAgo: 15 },
    { name: '姚琳', email: 'yaolin@example.com', source: '官网投递', tags: ['市场分析'], matchScore: 60, appliedDaysAgo: 12, outcome: 'REJECTED', stage: '简历初筛', rejectReason: '经验年限不足' },
  ];

  const placed: Record<string, { application: { id: string }; candidate: { id: string; name: string } }> = {};
  const batches: Array<[typeof frontendJob, HistoryCandidate[]]> = [
    [frontendJob, frontendHistory],
    [qaJob, qaHistory],
    [dataJob, dataHistory],
    [uiJob, uiHistory],
    [marketingJob, marketingHistory],
  ];
  for (const [job, list] of batches) {
    for (const c of list) {
      placed[c.email] = await placeCandidate(job, c);
    }
  }

  // ---- 面试与面评：三位面试官，通过率与 24h 及时率刻意拉开差距 ----
  const evalPlan: Array<{
    email: string;
    interviewer: { id: string; name: string };
    daysAgo: number;
    conclusion: 'STRONG_YES' | 'YES' | 'NO' | 'STRONG_NO';
    /** 面评距面试的小时数：>24 即超 SLA */
    submitAfterHours: number;
    comments: string;
  }> = [
    { email: 'sunhao@example.com', interviewer: interviewers[1], daysAgo: 292, conclusion: 'STRONG_YES', submitAfterHours: 3, comments: '框架原理与工程化都很扎实，独立负责过设计系统。' },
    { email: 'maxiao@example.com', interviewer: interviewers[1], daysAgo: 278, conclusion: 'YES', submitAfterHours: 6, comments: 'Vue 生态熟练，TypeScript 使用规范，可上手。' },
    { email: 'hubing@example.com', interviewer: interviewers[2], daysAgo: 262, conclusion: 'YES', submitAfterHours: 40, comments: '全栈视野不错，前端深度略欠，可培养。' },
    { email: 'linfang@example.com', interviewer: interviewers[2], daysAgo: 286, conclusion: 'NO', submitAfterHours: 52, comments: '对框架原理理解停留在使用层面。' },
    { email: 'helu@example.com', interviewer: interviewers[0], daysAgo: 130, conclusion: 'STRONG_YES', submitAfterHours: 2, comments: '自动化体系搭建经验完整，能独立推进。' },
    { email: 'xunuo@example.com', interviewer: interviewers[0], daysAgo: 112, conclusion: 'YES', submitAfterHours: 5, comments: '接口测试扎实，薪资预期偏高需协调。' },
    { email: 'dengchao@example.com', interviewer: interviewers[1], daysAgo: 14, conclusion: 'YES', submitAfterHours: 8, comments: '性能压测经验丰富，指标定义清晰。' },
    { email: 'fanlei@example.com', interviewer: interviewers[0], daysAgo: 60, conclusion: 'STRONG_YES', submitAfterHours: 4, comments: '指标体系设计能力强，SQL 功底好。' },
    { email: 'shilei@example.com', interviewer: interviewers[2], daysAgo: 58, conclusion: 'YES', submitAfterHours: 60, comments: '数仓建模合格，沟通稍显被动。' },
    { email: 'wangjing@example.com', interviewer: interviewers[0], daysAgo: 30, conclusion: 'STRONG_YES', submitAfterHours: 3, comments: '设计系统落地经验完整，作品质量高。' },
    { email: 'cuiying@example.com', interviewer: interviewers[2], daysAgo: 16, conclusion: 'NO', submitAfterHours: 70, comments: 'C 端风格为主，与 B 端诉求差距较大。' },
  ];

  let interviewCount = 0;
  for (const p of evalPlan) {
    const target = placed[p.email];
    if (!target) continue;
    const scheduledAt = daysAgo(p.daysAgo, 14);
    const interview = await prisma.interview.create({
      data: {
        applicationId: target.application.id,
        round: 1,
        scheduledAt,
        durationMins: 60,
        status: 'COMPLETED',
        createdAt: daysAgo(p.daysAgo + 3),
        interviewers: { create: [{ userId: p.interviewer.id }] },
      },
    });
    const submittedAt = new Date(scheduledAt.getTime() + p.submitAfterHours * 3600 * 1000);
    await prisma.evaluation.create({
      data: {
        interviewId: interview.id,
        interviewerId: p.interviewer.id,
        conclusion: p.conclusion,
        comments: p.comments,
        submittedAt,
        createdAt: submittedAt,
        scorecard: [
          { dimension: '技术能力', score: p.conclusion.includes('YES') ? 4 : 2 },
          { dimension: '工程素养', score: p.conclusion === 'STRONG_YES' ? 5 : 3 },
          { dimension: '沟通协作', score: 4 },
        ],
      },
    });
    await prisma.activityLog.create({
      data: {
        actorId: p.interviewer.id,
        actorName: p.interviewer.name,
        action: ACTIVITY_ACTIONS.EVALUATION_SUBMITTED,
        entityType: 'Application',
        entityId: target.application.id,
        payload: { candidate: target.candidate.name, round: 1, conclusion: p.conclusion },
        createdAt: submittedAt,
      },
    });
    interviewCount += 1;
  }

  // ---- Offer：覆盖录用管理页的每一个分组，页面才不会只有一两行 ----
  const offerPlan: Array<{
    email: string;
    approvalStatus: 'PENDING' | 'REJECTED' | 'APPROVED' | 'SENT' | 'EXPIRED';
    decision?: 'ACCEPTED' | 'DECLINED';
    base: number;
    bonusMonths: number;
    grade: string;
    daysAgo: number;
    approvalNote?: string;
    decisionReason?: string;
    /** SENT/EXPIRED 专用：答复截止距今天数（负数代表已过期） */
    expiresInDays?: number;
    extendedOnce?: boolean;
  }> = [
    { email: 'fangyuan@example.com', approvalStatus: 'PENDING', base: 32000, bonusMonths: 3, grade: 'P6', daysAgo: 5 },
    { email: 'dengchao@example.com', approvalStatus: 'PENDING', base: 28000, bonusMonths: 2, grade: 'P5', daysAgo: 3 },
    { email: 'shilei@example.com', approvalStatus: 'REJECTED', base: 45000, bonusMonths: 4, grade: 'P8', daysAgo: 62, approvalNote: '超出该职级带宽上限约 20%，请按 P7 重新核算后重提。' },
    { email: 'yanxin@example.com', approvalStatus: 'APPROVED', base: 22000, bonusMonths: 2, grade: 'P5', daysAgo: 2 },
    { email: 'caoyang@example.com', approvalStatus: 'SENT', base: 26000, bonusMonths: 3, grade: 'P5', daysAgo: 4, expiresInDays: 3 },
    { email: 'qinyue@example.com', approvalStatus: 'SENT', base: 24000, bonusMonths: 2, grade: 'P4', daysAgo: 6, expiresInDays: 1 },
    { email: 'tiantian@example.com', approvalStatus: 'EXPIRED', base: 27000, bonusMonths: 3, grade: 'P5', daysAgo: 30, expiresInDays: -9, extendedOnce: true },
    { email: 'wangjing@example.com', approvalStatus: 'SENT', decision: 'ACCEPTED', base: 38000, bonusMonths: 4, grade: 'P7', daysAgo: 24 },
    { email: 'helu@example.com', approvalStatus: 'SENT', decision: 'ACCEPTED', base: 30000, bonusMonths: 3, grade: 'P6', daysAgo: 110 },
    { email: 'fanlei@example.com', approvalStatus: 'SENT', decision: 'ACCEPTED', base: 34000, bonusMonths: 3, grade: 'P6', daysAgo: 55 },
    { email: 'sunhao@example.com', approvalStatus: 'SENT', decision: 'ACCEPTED', base: 36000, bonusMonths: 4, grade: 'P7', daysAgo: 275 },
    { email: 'maxiao@example.com', approvalStatus: 'SENT', decision: 'ACCEPTED', base: 31000, bonusMonths: 3, grade: 'P6', daysAgo: 258 },
    { email: 'hubing@example.com', approvalStatus: 'SENT', decision: 'ACCEPTED', base: 29000, bonusMonths: 3, grade: 'P5', daysAgo: 250 },
    { email: 'xunuo@example.com', approvalStatus: 'SENT', decision: 'DECLINED', base: 25000, bonusMonths: 2, grade: 'P5', daysAgo: 105, decisionReason: '薪资未达预期' },
  ];

  for (const o of offerPlan) {
    const target = placed[o.email];
    if (!target) continue;
    const createdAt = daysAgo(o.daysAgo);
    const sent = o.approvalStatus === 'SENT' || o.approvalStatus === 'EXPIRED';
    await prisma.offer.create({
      data: {
        applicationId: target.application.id,
        salary: { base: o.base, bonusMonths: o.bonusMonths, note: null },
        grade: o.grade,
        // 发起后约一个月入职：已在职的人按历史日期，待入职的人落在未来
        startDate: daysAgo(o.daysAgo - 30, 12),
        approvalStatus: o.approvalStatus,
        approvalNote: o.approvalNote,
        sentAt: sent ? createdAt : null,
        expiresAt: o.expiresInDays != null ? daysAgo(-o.expiresInDays, 18) : null,
        extendedOnce: o.extendedOnce ?? false,
        decision: o.decision,
        decisionReason: o.decisionReason,
        respondedAt: o.decision ? daysAgo(Math.max(o.daysAgo - 3, 0)) : null,
        portalToken: o.decision ? null : demoPortalToken(), // 随机：演示站公开，可推算的令牌等于开放门户
        createdAt,
        updatedAt: createdAt,
      },
    });
    await prisma.activityLog.create({
      data: {
        actorId: hr.id,
        actorName: hr.name,
        action: ACTIVITY_ACTIONS.OFFER_INITIATED,
        entityType: 'Application',
        entityId: target.application.id,
        payload: { candidate: target.candidate.name, grade: o.grade },
        createdAt,
      },
    });
  }

  // ---- 入职单：2 进行中（其中 1 个有待人工核对的材料）+ 1 已完成 ----
  const onboardingPlan: Array<{ email: string; status: 'IN_PROGRESS' | 'COMPLETED'; doneCount: number; withReview: boolean; daysAgo: number }> = [
    { email: 'wangjing@example.com', status: 'IN_PROGRESS', doneCount: 5, withReview: true, daysAgo: 20 },
    { email: 'helu@example.com', status: 'IN_PROGRESS', doneCount: 7, withReview: false, daysAgo: 100 },
    { email: 'fanlei@example.com', status: 'COMPLETED', doneCount: DEFAULT_ONBOARDING_CHECKLIST.length, withReview: false, daysAgo: 50 },
  ];
  for (const ob of onboardingPlan) {
    const target = placed[ob.email];
    if (!target) continue;
    const createdAt = daysAgo(ob.daysAgo);
    const checklist = DEFAULT_ONBOARDING_CHECKLIST.map((item, i) => ({
      ...item,
      done: i < ob.doneCount,
      doneAt: i < ob.doneCount ? daysAgo(ob.daysAgo - i).toISOString() : null,
    }));
    const documents = [
      {
        type: 'ID_CARD',
        label: '身份证',
        fields: { 姓名: target.candidate.name, 公民身份号码: '11010519900307****' },
        addedAt: daysAgo(ob.daysAgo - 1).toISOString(),
        ocrProvider: 'mock',
        needsReview: false,
      },
      ...(ob.withReview
        ? [
            {
              type: 'DIPLOMA',
              label: '学历证书',
              fields: {},
              addedAt: daysAgo(ob.daysAgo - 2).toISOString(),
              ocrProvider: 'mock',
              needsReview: true,
            },
          ]
        : []),
    ];
    const onboarding = await prisma.onboarding.create({
      data: {
        applicationId: target.application.id,
        checklist,
        documents,
        status: ob.status,
        portalToken: demoPortalToken(),
        createdAt,
        updatedAt: createdAt,
      },
    });
    // 合同变量与真实流程（OnboardingService.createContract）同构，门户才能渲染出完整条款
    const offerRow = await prisma.offer.findUnique({
      where: { applicationId: target.application.id },
      include: { application: { include: { job: { include: { department: true } } } } },
    });
    const offerSalary = offerRow?.salary as { base?: number; bonusMonths?: number } | null;
    await prisma.contract.create({
      data: {
        onboardingId: onboarding.id,
        templateName: '标准劳动合同 v1',
        variables: {
          companyName: 'ART 科技有限公司',
          candidateName: target.candidate.name,
          jobTitle: offerRow?.application.job.title ?? '-',
          department: offerRow?.application.job.department.name ?? '-',
          grade: offerRow?.grade ?? '-',
          salaryBase: offerSalary?.base ?? null,
          bonusMonths: offerSalary?.bonusMonths ?? 0,
          probationMonths: 3,
          startDate: offerRow?.startDate?.toISOString().slice(0, 10) ?? null,
          signDate: createdAt.toISOString().slice(0, 10),
        },
        signStatus: ob.status === 'COMPLETED' ? 'ARCHIVED' : 'SENT',
        evidenceNo: ob.status === 'COMPLETED' ? `EV${Date.now().toString().slice(-10)}` : null,
        createdAt,
        updatedAt: createdAt,
      },
    });
  }

  const totalCandidates =
    frontendHistory.length + qaHistory.length + dataHistory.length + uiHistory.length + marketingHistory.length;
  console.log(
    `✔ 扩展数据：+4 名员工 / 5 个职位（跨 4 部门）/ ${totalCandidates} 名候选人（跨 12 个月）/ ` +
      `${interviewCount} 场面评 / ${offerPlan.length} 份 Offer / ${onboardingPlan.length} 张入职单`,
  );
}

/** 稳定的字符串哈希，用来给示例手机号生成可复现的后 8 位 */
function hashCode(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}

// ---------------------------------------------------------------------------
// 批量数据：把「量」和「边界场景」补齐
//
// 前面两批数据能让各页面有内容，但还有一批只在特定数据下才出现的分支没被覆盖：
//   分页、子部门、未投递的人才库存量、一人多投、简历解析失败、
//   待安排面试、未来面试、可约时段、站内通知、AI 匹配依据、预筛问卷。
// 这里按索引确定性生成（不用随机数），保证每次重跑结果一致、可复核。
// ---------------------------------------------------------------------------

const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许邓冯韩曹曾彭萧蔡潘田董袁于余叶蒋杜苏魏程吕丁沈任姚卢傅钟姜崔谭廖范汪陆金石戴贾韦夏邱方侯邹熊孟秦白江阎薛尹段雷黎史龙陶贺顾毛郝龚邵万钱严覃武戚莫孔向汤'.split('');
const GIVEN = ['志强','秀英','建华','丽娟','伟东','雅静','子涵','思远','浩然','梦琪','宇轩','欣怡','俊杰','若曦','嘉豪','诗涵','明轩','雨桐','天佑','可馨'];
const SOURCES = ['BOSS直聘', '猎聘', '拉勾', '内推', '猎头推荐', '官网投递', '人才库唤醒', '校园招聘', '脉脉'];
const SKILL_POOL = [
  ['React', 'TypeScript'], ['Vue', 'Vite'], ['Node.js', 'NestJS'], ['Java', 'Spring'],
  ['Go', 'Kubernetes'], ['Python', '数据分析'], ['Figma', '交互设计'], ['内容运营', '社交媒体'],
  ['自动化测试', 'Playwright'], ['SQL', 'BI'], ['Android', 'Kotlin'], ['iOS', 'Swift'],
];
const pick = <T,>(arr: readonly T[], i: number) => arr[i % arr.length];

async function seedBulkDemo() {
  const MARKER = 'bulk-0001@example.com';
  if (await prisma.candidate.findFirst({ where: { email: MARKER } })) {
    console.log('… 已存在批量示例数据，跳过');
    return;
  }

  const hr = await prisma.user.findUniqueOrThrow({ where: { email: 'hr@arthr.local' } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@arthr.local' } });
  const tech = await upsertDepartment('技术部');
  const product = await upsertDepartment('产品部');
  const design = await upsertDepartment('设计部');
  const marketing = await upsertDepartment('市场部');

  // ---- 子部门：部门管理页的「子部门」列一直是 —，也顺带覆盖「有子部门不可删除」分支 ----
  const subDepts = [
    { name: '前端组', parentId: tech.id },
    { name: '后端组', parentId: tech.id },
    { name: '测试组', parentId: tech.id },
    { name: '用户研究组', parentId: product.id },
  ];
  for (const sd of subDepts) {
    const found = await prisma.department.findFirst({ where: { name: sd.name } });
    if (!found) await prisma.department.create({ data: sd });
  }
  // 一个空部门：用来演示「可删除」（其余部门都有职位/成员，删除会被拦）
  const emptyDept = await upsertDepartment('法务部');

  const deptPool = [tech.id, product.id, design.id, marketing.id, emptyDept.id];

  // ---- 批量职位：凑到 2 页分页，覆盖全部 5 种状态 ----
  const jobTitles = [
    '高级前端工程师', '资深后端工程师', 'DevOps 工程师', '算法工程师', '安全工程师',
    '技术支持工程师', '解决方案架构师', '数据平台工程师', '客户成功经理', '销售运营',
    '品牌设计师', '增长产品经理', '商业分析师', '人力资源专员', '财务分析师',
    '供应链专员', '法务顾问', '行政主管',
  ];
  const jobStatuses = ['OPEN', 'OPEN', 'OPEN', 'PAUSED', 'DRAFT', 'CLOSED', 'PENDING_APPROVAL'] as const;
  const bulkJobs: Array<{ id: string; title: string; stages: Array<{ id: string; name: string }> }> = [];
  for (let i = 0; i < jobTitles.length; i += 1) {
    const job = await prisma.job.create({
      data: {
        title: jobTitles[i],
        description: `${jobTitles[i]}岗位说明（批量示例数据）`,
        requirement: '相关方向 3 年以上经验；良好的沟通与协作能力。',
        headcount: (i % 3) + 1,
        status: pick(jobStatuses, i),
        departmentId: pick(deptPool, i),
        createdById: hr.id,
        createdAt: daysAgo(200 - i * 8),
        stages: { create: DEFAULT_PIPELINE_STAGES.map((name, index) => ({ name, order: index })) },
      },
      include: { stages: true },
    });
    bulkJobs.push(job);
  }

  // ---- 批量候选人：凑到 6+ 页分页，并覆盖各类边界 ----
  const PARSE_STATES = ['DONE', 'DONE', 'DONE', 'DONE', 'PENDING', 'FAILED'] as const;
  const OUTCOMES = ['ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'REJECTED', 'HIRED'] as const;
  const REASONS = ['技术能力不匹配', '薪资预期不匹配', '经验年限不足', '候选人主动放弃', '岗位已关闭'];

  const BULK_N = 90;
  /** 后 20 个不投递任何职位：候选人库的「未投递」分支 + 人才库唤醒的素材 */
  const NO_APPLY_FROM = 70;
  let created = 0;
  let multiApply = 0;

  for (let i = 0; i < BULK_N; i += 1) {
    const name = `${pick(SURNAMES, i * 7)}${pick(GIVEN, i * 3)}`;
    const seq = String(i + 1).padStart(4, '0');
    const skills = pick(SKILL_POOL, i);
    const appliedDaysAgo = 5 + ((i * 13) % 340); // 铺满一年
    const appliedAt = daysAgo(appliedDaysAgo);
    // 每 11 个留一个没邮箱、每 13 个留一个没电话：列表页的 '-' 分支
    const noEmail = i % 11 === 5;
    const noPhone = i % 13 === 7;

    const candidate = await prisma.candidate.create({
      data: {
        name,
        email: noEmail ? null : `bulk-${seq}@example.com`,
        phone: noPhone ? null : `139${String(10_000_000 + i * 137).slice(0, 8)}`,
        source: pick(SOURCES, i * 5),
        tags: skills,
        createdAt: appliedAt,
        resumes: {
          create: {
            fileName: `${name}-简历.pdf`,
            parseStatus: pick(PARSE_STATES, i),
            skills: pick(PARSE_STATES, i) === 'DONE' ? skills : [],
            createdAt: appliedAt,
            rawText: `${name}，${skills.join('/')} 方向，示例简历正文。`,
            parsed: pick(PARSE_STATES, i) === 'DONE' ? { summary: `${skills.join('/')} 方向候选人` } : undefined,
          },
        },
      },
    });
    created += 1;
    if (i >= NO_APPLY_FROM) continue; // 未投递的人才库存量

    const job = pick(bulkJobs, i * 3);
    const outcome = pick(OUTCOMES, i);
    const stageIdx = outcome === 'HIRED' ? 5 : outcome === 'REJECTED' ? (i % 3) + 1 : i % 4;
    const stage = job.stages[stageIdx] ?? job.stages[0];
    // 每 9 个留一个没有匹配分：列表与卡片的 '—' 分支
    const hasScore = i % 9 !== 4;
    const score = 55 + ((i * 17) % 45);

    const app = await prisma.application.create({
      data: {
        candidateId: candidate.id,
        jobId: job.id,
        stageId: stage.id,
        status: outcome,
        matchScore: hasScore ? score : null,
        // AI 匹配依据：详情抽屉「命中 / 缺失」两栏靠它，之前全库只有 1 条
        matchReport: hasScore
          ? {
              score,
              hits: skills,
              misses: score < 75 ? ['分布式经验', '团队管理'] : ['大规模并发'],
              highlights: `命中岗位关键能力：${skills.join('、')}。`,
              risks: score < 75 ? '以下要求未在简历中体现，建议面试验证。' : '整体匹配良好。',
              aiMeta: { provider: 'mock', degraded: false },
            }
          : undefined,
        // 预筛问卷：邀约前核实三问，覆盖「已提交 / 未提交」两态
        prescreen:
          i % 6 === 2
            ? {
                expectedSalary: 20000 + (i % 5) * 4000,
                availableDate: daysAgo(-((i % 30) + 7)).toISOString().slice(0, 10),
                travelOk: i % 2 === 0,
                note: i % 4 === 0 ? '目前在职，需一个月交接' : null,
                submittedAt: daysAgo(Math.max(appliedDaysAgo - 3, 0)).toISOString(),
              }
            : undefined,
        rejectReason: outcome === 'REJECTED' ? pick(REASONS, i) : null,
        position: i,
        createdAt: appliedAt,
        // 每 7 个制造一张超时停留卡：看板列头的「N 超时」与卡片红字
        stageEnteredAt: daysAgo(i % 7 === 3 ? Math.min(appliedDaysAgo, 12) : Math.max(appliedDaysAgo - 5, 0)),
      },
    });

    await prisma.activityLog.create({
      data: {
        actorId: hr.id,
        actorName: hr.name,
        action: ACTIVITY_ACTIONS.APPLICATION_CREATED,
        entityType: 'Application',
        entityId: app.id,
        payload: { candidate: name, job: job.title, stage: stage.name },
        createdAt: appliedAt,
      },
    });
    if (outcome === 'HIRED') {
      await prisma.activityLog.create({
        data: {
          actorId: hr.id,
          actorName: hr.name,
          action: ACTIVITY_ACTIONS.ONBOARDING_COMPLETED,
          entityType: 'Application',
          entityId: app.id,
          payload: { candidate: name, job: job.title },
          createdAt: daysAgo(Math.max(appliedDaysAgo - 35, 0)),
        },
      });
    }

    // 每 8 个再投一个别的职位：候选人库「+N」与详情抽屉的多条应聘记录
    if (i % 8 === 6) {
      const job2 = pick(bulkJobs, i * 3 + 5);
      if (job2.id !== job.id) {
        await prisma.application.create({
          data: {
            candidateId: candidate.id,
            jobId: job2.id,
            stageId: job2.stages[0].id,
            status: 'ACTIVE',
            matchScore: 60 + (i % 30),
            position: i,
            createdAt: daysAgo(Math.max(appliedDaysAgo - 10, 1)),
            stageEnteredAt: daysAgo(Math.max(appliedDaysAgo - 10, 1)),
          },
        });
        multiApply += 1;
      }
    }
  }

  // ---- 面试：补齐「待安排」「今天/明天」「多面试官」三种在页面上有独立表现的形态 ----
  const ivUsers = await prisma.user.findMany({
    where: { email: { in: ['interviewer@arthr.local', 'zhaolei@arthr.local', 'qianwen@arthr.local'] } },
  });
  const activeApps = await prisma.application.findMany({
    where: { status: 'ACTIVE', candidate: { email: { startsWith: 'bulk-' } } },
    take: 14,
    orderBy: { createdAt: 'desc' },
    include: { candidate: true },
  });
  let ivCount = 0;
  for (let i = 0; i < activeApps.length; i += 1) {
    const a = activeApps[i];
    const kind = i % 4;
    // 0 = 待安排（scheduledAt null）；1/2 = 今天/明天；3 = 本周内
    const scheduledAt = kind === 0 ? null : daysAgo(-(kind === 3 ? 4 : kind - 1), 10 + (i % 8));
    await prisma.interview.create({
      data: {
        applicationId: a.id,
        round: 1,
        scheduledAt,
        durationMins: 60,
        status: 'SCHEDULED',
        createdAt: daysAgo(2),
        // 每 3 场安排两位面试官：面试官列的「、」拼接
        interviewers: { create: (i % 3 === 0 ? ivUsers.slice(0, 2) : ivUsers.slice(i % 3, (i % 3) + 1)).map((u) => ({ userId: u.id })) },
      },
    });
    ivCount += 1;
  }

  // ---- 可约时段：面试管理右栏原本只有 2 条，候选人自助选时页也需要有档可选 ----
  // 把 admin 也算进来：右栏展示的是「我的」时段，默认演示账号是 admin，
  // 只给面试官铺时段的话，用 admin 登录看到的永远是空态。
  let slotCount = 0;
  for (const u of [...ivUsers, admin]) {
    for (let d = 1; d <= 10; d += 1) {
      const day = new Date(Date.now() + d * DAY);
      if (day.getDay() === 0 || day.getDay() === 6) continue; // 跳过周末
      for (const h of [10, 14, 16]) {
        const startAt = new Date(day);
        startAt.setHours(h, 0, 0, 0);
        const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
        await prisma.interviewerSlot.create({
          data: {
            userId: u.id,
            startAt,
            endAt,
            bookedBy: null,
          },
        });
        slotCount += 1;
      }
    }
  }

  // 少量「已被预约」的档，用于演示右栏灰态。必须指向真实面试：bookedBy 存的是 interview.id，
  // 早先这里写死 'demo-booked'，面试官在右栏看到「已约」却查不到是谁约的，纯属误导。
  const bookableInterviews = await prisma.interview.findMany({
    where: { status: 'SCHEDULED', scheduledAt: null },
    include: { interviewers: true },
    take: 2,
  });
  for (const iv of bookableInterviews) {
    // 把 admin 也指派进去，演示账号一登录就能在右栏看到「已约」样例并点进候选人
    if (!iv.interviewers.some((i) => i.userId === admin.id)) {
      await prisma.interviewInterviewer.create({ data: { interviewId: iv.id, userId: admin.id } });
    }
    const slot = await prisma.interviewerSlot.findFirst({
      where: { bookedBy: null, userId: admin.id },
      orderBy: { startAt: 'asc' },
    });
    if (!slot) continue;
    await prisma.interviewerSlot.update({ where: { id: slot.id }, data: { bookedBy: iv.id } });
    await prisma.interview.update({
      where: { id: iv.id },
      data: { scheduledAt: slot.startAt, durationMins: 60 },
    });
  }

  // 演示账号 interviewer@arthr.local（苏晴）也要有一条「已约」：右栏灰态 + 点进候选人
  const suqing = await prisma.user.findUnique({ where: { email: 'interviewer@arthr.local' } });
  if (suqing) {
    const pending = await prisma.interview.findFirst({
      where: {
        status: 'SCHEDULED',
        scheduledAt: null,
        interviewers: { some: { userId: suqing.id } },
      },
    });
    const free = pending
      ? await prisma.interviewerSlot.findFirst({
          where: { bookedBy: null, userId: suqing.id },
          orderBy: { startAt: 'asc' },
        })
      : null;
    if (pending && free) {
      await prisma.interviewerSlot.update({ where: { id: free.id }, data: { bookedBy: pending.id } });
      await prisma.interview.update({
        where: { id: pending.id },
        data: { scheduledAt: free.startAt, durationMins: 60 },
      });
    }
  }

  // ---- 站内通知：铃铛之前是空的，未读/已读都要有 ----
  // 按角色发：早先同一批通知同时发给管理员和 HR，HR 会收到「Offer 待你审批」却没有审批权限
  const lintao = await prisma.user.findUniqueOrThrow({ where: { email: 'manager@arthr.local' } });
  const suqingUser = await prisma.user.findUniqueOrThrow({ where: { email: 'interviewer@arthr.local' } });
  const notices: Array<{ to: Array<{ id: string }>; title: string; body: string; link: string; read: boolean }> = [
    { to: [lintao, admin], title: 'Offer 待你审批', body: '邓超（测试工程师）的 Offer 已提交审批', link: '/offers?tab=approve', read: false },
    { to: [suqingUser], title: '面评待提交', body: '你有已完成的面试尚未提交面评', link: '/interviews?tab=mine', read: false },
    { to: [hr, admin], title: '材料待人工核对', body: '汪静的学历证书仅有图片，未识别出字段', link: '/onboarding?tab=review', read: false },
    { to: [hr, admin], title: 'Offer 即将到期', body: '秦月的 Offer 将于今日到期，请跟进', link: '/offers?tab=reply', read: true },
    { to: [hr, admin], title: '入职闭环完成', body: '范磊已完成全部入职流程', link: '/onboarding?tab=done', read: true },
  ];
  for (const [i, { to, ...n }] of notices.entries()) {
    for (const u of to) {
      await prisma.notification.create({
        data: { userId: u.id, ...n, createdAt: daysAgo(i, 9) },
      });
    }
  }

  console.log(
    `✔ 批量数据：+${jobTitles.length} 个职位 / +${created} 名候选人（含 ${BULK_N - NO_APPLY_FROM} 名未投递、` +
      `${multiApply} 人多投）/ ${ivCount} 场待办面试 / ${slotCount} 个可约时段 / ${notices.reduce((n, x) => n + x.to.length, 0)} 条通知 / +4 个子部门`,
  );
}

async function main() {
  await seedRbac();
  const { tech, product } = await seedDepartmentsAndUsers();
  await seedCompanyDocs();
  await seedDemoData(tech.id, product.id);
  await seedExtendedDemo();
  await seedBulkDemo();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
