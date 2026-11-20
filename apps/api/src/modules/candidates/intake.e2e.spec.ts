import { hashSync } from 'bcryptjs';
import ExcelJS from 'exceljs';
import { bootTestApp, expectOk, TEST_HR, type TestApp } from '../../test-utils/app';
import { makeDocx } from '../../test-utils/resume-fixtures';
import { DOCX_MIME } from './resume-text';

/**
 * 简历自动建档 + 候选人筛选导出 + 时间轴（整个 AppModule，AI 用规则引擎）。
 */
describe('简历自动建档 / 筛选导出 / 时间轴 e2e', () => {
  let t: TestApp;
  let jobId: string;

  const upload = async (buffer: Buffer, fileName: string, mime: string, fields: Record<string, string>) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), fileName);
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const res = await t.fetchRaw('/candidates/intake', { method: 'POST', body: form });
    return { status: res.status, body: await res.json() };
  };

  beforeAll(async () => {
    t = await bootTestApp();
    await t.login();
    const job = expectOk(
      await t.call('POST', '/jobs', {
        title: 'Java 后端工程师',
        departmentId: TEST_HR.departmentId,
        headcount: 2,
        status: 'OPEN',
        requirement: '熟悉 Java、Spring、MySQL、Redis',
      }),
    );
    jobId = job.body.id;
  }, 60_000);

  afterAll(async () => {
    await t?.stop();
  });

  it('上传 Word 简历：建档、解析回填技能、投递职位、自动评分', async () => {
    const docx = await makeDocx([
      '个人简历',
      '姓名：林知远',
      '手机：138-0013-8000　邮箱：Lin.ZY@Example.com',
      '5 年 Java 后端开发经验，熟悉 Spring Boot、MySQL、Redis，负责过高并发订单系统。',
      '浙江大学 计算机 本科',
    ]);
    const res = await upload(docx, '林知远-后端.docx', DOCX_MIME, { jobId, source: '官网投递' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ created: true, matchedBy: null, parsed: true, candidate: { name: '林知远' } });
    expect(res.body.skills.length).toBeGreaterThan(0);
    expect(res.body.application?.id).toBeTruthy();
    expect(typeof res.body.score).toBe('number');

    const c = await t.prisma.candidate.findUniqueOrThrow({ where: { id: res.body.candidate.id }, include: { resumes: true, applications: true } });
    expect(c).toMatchObject({ email: 'lin.zy@example.com', phone: '13800138000', source: '官网投递' });
    expect(c.tags.length).toBeGreaterThan(0);
    expect(c.resumes[0]).toMatchObject({ parseStatus: 'DONE', fileName: '林知远-后端.docx' });
    expect(c.applications[0]).toMatchObject({ jobId, matchSource: 'rule' });
  });

  it('同一手机号再次上传：合并到原档案、补空字段，不重复建人', async () => {
    const before = await t.prisma.candidate.count();
    const docx = await makeDocx(['姓名：林知远', '电话 13800138000', '新增：熟悉 Kafka 与 Kubernetes，带过 3 人小组。']);
    const res = await upload(docx, 'lin-v2.docx', DOCX_MIME, { jobId });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ created: false, matchedBy: 'phone' });
    // 已在本职位流程中：提示但不报错，仍对原应聘重新评分
    expect(res.body.warnings.join()).toMatch(/已在此职位流程中/);
    expect(res.body.application?.id).toBeTruthy();
    expect(await t.prisma.candidate.count()).toBe(before);
    expect(await t.prisma.resume.count({ where: { candidateId: res.body.candidate.id } })).toBe(2);
  });

  it('识别不到邮箱和手机号、职位未开放时拒绝，且不留下孤儿档案', async () => {
    const before = await t.prisma.candidate.count();
    const noContact = await upload(await makeDocx(['姓名：无名氏', '只有一段没有联系方式的自我介绍，写得很长很长。']), 'x.docx', DOCX_MIME, { jobId });
    expect(noContact.status).toBe(400);
    expect(noContact.body.message).toMatch(/邮箱或手机号/);

    const closed = expectOk(await t.call('POST', '/jobs', { title: '已关闭职位', departmentId: TEST_HR.departmentId, headcount: 1 }));
    await t.prisma.job.update({ where: { id: closed.body.id }, data: { status: 'CLOSED' } });
    const valid = await makeDocx(['姓名：周可欣', '手机 13700137000', '三年产品经理经验，负责过 B 端 SaaS。']);
    const res = await upload(valid, 'z.docx', DOCX_MIME, { jobId: closed.body.id });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/未在招聘中/);

    const noJob = await upload(valid, 'z.docx', DOCX_MIME, {});
    expect(noJob.status).toBe(400);
    expect(noJob.body.message.join()).toMatch(/请选择职位/);
    expect(await t.prisma.candidate.count()).toBe(before);
  });

  it('部门范围的经理不能向其他部门职位导入，且不留下档案', async () => {
    const role = await t.prisma.role.create({ data: { code: 'HIRING_MANAGER', name: '用人经理', dataScope: 'DEPARTMENT' } });
    const perms = await t.prisma.permission.findMany();
    await t.prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    await t.prisma.department.create({ data: { id: 'dept-sales', name: '销售部' } });
    await t.prisma.user.create({
      data: {
        id: 'mgr-sales',
        email: 'mgr@e2e.test',
        name: '销售经理',
        passwordHash: hashSync('Passw0rd!', 4),
        departmentId: 'dept-sales',
        roles: { create: { roleId: role.id } },
      },
    });
    const before = await t.prisma.candidate.count();
    await t.login('mgr@e2e.test', 'Passw0rd!');
    try {
      const res = await upload(await makeDocx(['姓名：越权者', '手机 13600136000', '一段足够长的简历正文内容。']), 'm.docx', DOCX_MIME, { jobId });
      expect(res.status).toBe(403);
      expect(await t.prisma.candidate.count()).toBe(before);
    } finally {
      await t.login();
    }
  });

  it('列表筛选：职位、阶段类型、来源、最低分、状态', async () => {
    expectOk(await t.call('POST', '/candidates', { name: '未投递者', email: 'idle@example.com', source: '内推' }));
    const q = async (qs: string) => expectOk(await t.call('GET', `/candidates?${qs}`)).body;

    expect((await q(`jobId=${jobId}`)).items.map((c: { name: string }) => c.name)).toEqual(['林知远']);
    expect((await q('stageKind=SCREENING')).total).toBe(1);
    expect((await q('stageKind=OFFER')).total).toBe(0);
    expect((await q('source=内推')).items[0].name).toBe('未投递者');
    expect((await q('status=NONE')).items.map((c: { name: string }) => c.name)).toEqual(['未投递者']);
    const bad = await t.call('GET', '/candidates?minScore=101');
    expect(bad.status).toBe(400);
    const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
    expect((await q(`createdFrom=${today}&createdTo=${today}`)).total).toBe(2);
    expect((await q('createdTo=2000-01-01')).total).toBe(0);

    const sources = expectOk(await t.call('GET', '/candidates/sources')).body;
    expect(sources).toEqual(expect.arrayContaining(['内推', '官网投递']));
  });

  it('按筛选导出 Excel，导出动作进审计', async () => {
    const res = await t.fetchRaw(`/candidates/export?jobId=${jobId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/spreadsheetml/);
    expect(res.headers.get('x-export-rows')).toBe('1');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const sheet = wb.getWorksheet('候选人')!;
    expect(sheet.getRow(1).getCell(1).value).toBe('姓名');
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getRow(2).getCell(1).value).toBe('林知远');
    expect(sheet.getRow(2).getCell(3).value).toBe('13800138000');
    expect(sheet.getRow(2).getCell(6).value).toBe('Java 后端工程师');

    const log = await t.prisma.activityLog.findFirst({ where: { action: 'candidate.exported' } });
    expect(log?.payload).toMatchObject({ rows: 1 });
  });

  it('候选人时间轴包含建档、AI 解析与 AI 评分', async () => {
    const list = expectOk(await t.call('GET', `/candidates?jobId=${jobId}`)).body;
    const detail = expectOk(await t.call('GET', `/candidates/${list.items[0].id}`)).body;
    const actions: string[] = detail.timeline.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['resume.intake', 'resume.parsed', 'application.scored', 'application.created', 'candidate.created']));
  });
});
