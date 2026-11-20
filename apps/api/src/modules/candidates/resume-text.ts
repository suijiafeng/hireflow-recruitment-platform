/**
 * 简历文件 → 纯文本 + 联系方式。
 * 只做确定性抽取（PDF / Word .docx / 纯文本），联系方式用正则，不交给大模型：
 * 去重靠邮箱和手机号，必须稳定可复现，也避免把联系方式发给外部模型。
 */

const MAX_TEXT = 50_000;

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** 能自动抽取文字的格式；其余（扫描件图片、老式 .doc）只留档 */
export function canExtractText(mimetype: string, fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    mimetype === 'application/pdf' ||
    lower.endsWith('.pdf') ||
    mimetype === DOCX_MIME ||
    lower.endsWith('.docx') ||
    mimetype.startsWith('text/') ||
    /\.(txt|md|markdown)$/.test(lower)
  );
}

export async function extractResumeText(buffer: Buffer, mimetype: string, fileName: string): Promise<string | null> {
  const lower = fileName.toLowerCase();
  let text: string | undefined;
  if (mimetype === 'application/pdf' || lower.endsWith('.pdf')) {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  } else if (mimetype === DOCX_MIME || lower.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (mimetype.startsWith('text/') || /\.(txt|md|markdown)$/.test(lower)) {
    text = buffer.toString('utf8');
  }
  const normalized = text
    ?.replace(/\r\n?/g, '\n')
    .replace(/^-- \d+ of \d+ --$/gm, '') // pdf-parse 的分页标记
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return normalized ? normalized.slice(0, MAX_TEXT) : null;
}

export interface ResumeContacts {
  name?: string;
  email?: string;
  phone?: string;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// 大陆手机号，允许 +86 / 空格 / 短横线分隔
const PHONE_RE = /(?:\+?86[\s-]?)?(1[3-9]\d)[\s-]?(\d{4})[\s-]?(\d{4})(?!\d)/;
const NAME_LABEL_RE = /(?:姓\s*名|Name)\s*[:：]\s*([\u4e00-\u9fa5·]{2,6}|[A-Za-z][A-Za-z.'-]*(?: [A-Za-z][A-Za-z.'-]*){0,3})/i;
const CN_NAME_LINE_RE = /^[\u4e00-\u9fa5·]{2,4}$/;
// 常见的简历标题行，不能当姓名
const NOT_NAME = new Set(['个人简历', '简历', '求职简历', '个人信息', '基本信息', '联系方式', '求职意向', '工作经历', '教育背景', '项目经历']);

export function extractContacts(text: string, fileName?: string): ResumeContacts {
  const out: ResumeContacts = {};
  const email = text.match(EMAIL_RE)?.[0];
  if (email) out.email = email.toLowerCase();
  const phone = text.match(PHONE_RE);
  if (phone) out.phone = `${phone[1]}${phone[2]}${phone[3]}`;

  const labeled = text.match(NAME_LABEL_RE)?.[1]?.trim();
  if (labeled) {
    out.name = labeled;
  } else {
    // 没有「姓名：」时取前几行里第一个像中文姓名的独立行
    const line = text
      .split('\n')
      .slice(0, 8)
      .map((l) => l.trim())
      .find((l) => CN_NAME_LINE_RE.test(l) && !NOT_NAME.has(l));
    if (line) out.name = line;
  }
  if (!out.name && fileName) {
    // 文件名兜底：「张三-后端工程师.pdf」「简历_李四.docx」
    const stem = fileName.replace(/\.[^.]+$/, '');
    const fromFile = stem
      .split(/[-_\s（）()【】[\]·]+/)
      .find((part) => CN_NAME_LINE_RE.test(part) && !NOT_NAME.has(part));
    if (fromFile) out.name = fromFile;
  }
  return out;
}
