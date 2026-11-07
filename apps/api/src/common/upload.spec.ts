import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common';
import { assertResumeFile, RESUME_MIME_TYPES } from './upload';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Python 标准库 zipfile（ZIP_DEFLATED）生成的最小 OOXML 文档，包含内容类型、
// 根关系和 word/document.xml；固定 1980 时间戳，测试不依赖额外 ZIP 库。
const DOCX = Buffer.from(
  'UEsDBBQAAAAIAAAAIQDMVIwQ4AAAAJwBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2Qy07DMBBFf8XyFsUTukAIJekCyhJYlA+w7Eli4Zc8bil/z6QtXaDC0r6PM7rd+hC82GMhl2Ivb1UrBUaTrItTL9+3z829XA/d9isjCbZG6uVca34AIDNj0KRSxsjKmErQlZ9lgqzNh54QVm17BybFirE2demQQ/eEo975KjYH/j5hC3qS4vFkXFi91Dl7Z3RlHfbR/qI0Z4Li5NFDs8t0wwYJVwmL8jfgnHvlHYqzKN50qS86sAs+U7Fgk9kFTqr/a67cmcbRGbzkl7ZckkEiHjh4dVGCdvHnfjjOPXwDUEsDBBQAAAAIAAAAIQA2V97cogAAABgBAAALAAAAX3JlbHMvLnJlbHONzzsOwjAMBuCrRN6pCwNCqGkXhNQVlQNEiZtGNA8l4XV7MjBQxMBo+/dnuekedmY3isl4x2Fd1cDISa+M0xzOw3G1g65tTjSLXBJpMiGxsuIShynnsEdMciIrUuUDuTIZfbQilzJqDEJehCbc1PUW46cBS5P1ikPs1RrY8Az0j+3H0Ug6eHm15PKPE1+JIouoKXO4+6hQvdtVYQHbBhcvti9QSwMEFAAAAAgAAAAhAPfAXyyXAAAAxgAAABEAAAB3b3JkL2RvY3VtZW50LnhtbEWOSw6DMAxErxJlX0y7qCrEZ8cBqvYANDEQicSREwq9fRO66OaNbI/HrrvdLuKNHAy5Rp6LUgp0irRxUyOfj/50k11bb5UmtVp0USS/C9XWyDlGXwEENaMdQkEeXZqNxHaIqeQJNmLtmRSGkOLsApeyvIIdjJM58kX6k9VncEZs7xjSGTGaPa6MNeReJh/0B3978P+p/QJQSwECFAMUAAAACAAAACEAzFSMEOAAAACcAQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAAAAIQA2V97cogAAABgBAAALAAAAAAAAAAAAAACAAREBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAAAAIQD3wF8slwAAAMYAAAARAAAAAAAAAAAAAACAAdwBAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAACiAgAAAAA=',
  'base64',
);
const ORDINARY_ZIP = Buffer.from(
  'UEsDBBQAAAAIAAAAIQAvcSxLFQAAABMAAAAKAAAAcmVhZG1lLnR4dPPLL1FIVAjPL0pRSMlPLs1NzSsBAFBLAQIUAxQAAAAIAAAAIQAvcSxLFQAAABMAAAAKAAAAAAAAAAAAAACAAQAAAAByZWFkbWUudHh0UEsFBgAAAAABAAEAOAAAAD0AAAAAAA==',
  'base64',
);

const file = (buffer: Buffer, mimetype: string) => ({ buffer, mimetype }) as Express.Multer.File;
const expectUnsupported = (buffer: Buffer, mimetype: string) => {
  expect(() => assertResumeFile(file(buffer, mimetype))).toThrow(UnsupportedMediaTypeException);
};

describe('简历文件基础格式校验', () => {
  it('标准 DOCX 可以留档，普通 ZIP 不能只改 MIME 就成为 DOCX', () => {
    expect(() => assertResumeFile(file(DOCX, DOCX_MIME))).not.toThrow();
    expectUnsupported(ORDINARY_ZIP, DOCX_MIME);
  });

  it('非空但被截断的 ZIP/DOCX 返回 415，不抛出缓冲区越界异常', () => {
    for (const buffer of [
      DOCX.subarray(0, 4),
      DOCX.subarray(0, 21),
      DOCX.subarray(0, -1),
      DOCX.subarray(0, -50),
    ]) {
      expectUnsupported(buffer, DOCX_MIME);
    }
  });

  it('畸形中央目录偏移、文件名长度和记录数均返回 415', () => {
    const badOffset = Buffer.from(DOCX);
    badOffset.writeUInt32LE(0xffffffff, badOffset.length - 6);
    const badNameLength = Buffer.from(DOCX);
    const directoryStart = badNameLength.indexOf(Buffer.from('504b0102', 'hex'));
    expect(directoryStart).toBeGreaterThan(0);
    badNameLength.writeUInt16LE(0xffff, directoryStart + 28);
    const badCount = Buffer.from(DOCX);
    badCount.writeUInt16LE(0xffff, badCount.length - 12);
    for (const buffer of [badOffset, badNameLength, badCount]) expectUnsupported(buffer, DOCX_MIME);
  });

  // 这里只验证基础签名，不把接受签名当成完整解码或恶意文件扫描。
  it.each([
    ['PDF', 'application/pdf', Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF')],
    ['JPEG', 'image/jpeg', Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex')],
    [
      'WebP',
      'image/webp',
      Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64'),
    ],
  ])('%s 基础签名可识别，声明为其他格式时拒绝', (_name, mimetype, buffer) => {
    expect(() => assertResumeFile(file(buffer, mimetype))).not.toThrow();
    expectUnsupported(buffer, mimetype === 'application/pdf' ? 'image/jpeg' : 'application/pdf');
  });

  it.each(RESUME_MIME_TYPES)('HTML 声明为 %s 仍返回 415', (mimetype) => {
    expectUnsupported(
      Buffer.from('<!doctype html><html><script>alert(1)</script></html>'),
      mimetype,
    );
  });

  it('正常 UTF-8 文本可留档，零字节文件返回参数错误', () => {
    expect(() =>
      assertResumeFile(file(Buffer.from('应聘简历：擅长软件开发与项目交付。'), 'text/plain')),
    ).not.toThrow();
    expect(() => assertResumeFile(file(Buffer.alloc(0), 'application/pdf'))).toThrow(
      BadRequestException,
    );
  });
});
