import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { makeDocx, makePdf } from '../../test-utils/resume-fixtures';
import { canExtractText, DOCX_MIME, extractContacts, extractResumeText } from './resume-text';

describe('简历文字抽取', () => {
  it('Word .docx 读出段落文字', async () => {
    const buf = await makeDocx(['姓名：林知远', '电话：138-0013-8000', '五年 Java 后端经验']);
    const text = await extractResumeText(buf, DOCX_MIME, '林知远.docx');
    expect(text).toContain('林知远');
    expect(text).toContain('五年 Java 后端经验');
  });

  // pdfjs 依赖动态 import，Jest 的 VM 沙箱跑不了：在独立 Node 进程里走同一个函数
  it('文字版 PDF 读出内容并识别联系方式', () => {
    const out = execFileSync(process.execPath, [require.resolve('tsx/cli'), join(__dirname, '../../../scripts/check-pdf-extract.ts')], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    const { text, contacts } = JSON.parse(out.trim().split('\n').pop()!);
    expect(text).toContain('alex.chen@example.com');
    expect(text).not.toMatch(/-- 1 of 1 --/);
    expect(contacts).toEqual({ name: 'Alex Chen', email: 'alex.chen@example.com', phone: '13900139000' });
  });

  it('图片与 .doc 不在自动抽取范围', () => {
    expect(canExtractText('image/png', 'a.png')).toBe(false);
    expect(canExtractText('application/msword', 'a.doc')).toBe(false);
    expect(canExtractText(DOCX_MIME, 'a.docx')).toBe(true);
  });
});

describe('联系方式识别', () => {
  it('「姓名：」标签、带分隔符的手机号、邮箱统一小写', () => {
    expect(extractContacts('个人简历\n姓名：林知远\n手机：+86 138-0013-8000\n邮箱：Lin.ZY@Example.com')).toEqual({
      name: '林知远',
      phone: '13800138000',
      email: 'lin.zy@example.com',
    });
  });

  it('没有标签时取前几行里独立的中文姓名，跳过「个人简历」这类标题', () => {
    expect(extractContacts('个人简历\n周可欣\n13700137000').name).toBe('周可欣');
  });

  it('正文没有姓名时用文件名兜底', () => {
    expect(extractContacts('电话 13700137000', '简历_许嘉禾-前端.pdf').name).toBe('许嘉禾');
  });

  it('不把长数字串里的片段当手机号', () => {
    expect(extractContacts('身份证 110101199003071234567').phone).toBeUndefined();
  });
});
