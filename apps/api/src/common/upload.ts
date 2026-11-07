import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common';
import { isUtf8 } from 'node:buffer';
import type { Request } from 'express';

type MulterFileFilter = (
  req: Request,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) => void;

/** 简历原件：PDF/Word/纯文本/常见图片（扫描件） */
export const RESUME_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/webp',
];

/** 入职材料（身份证/银行卡/学历证书，拍照或扫描件） */
export const ONBOARDING_DOCUMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/**
 * Multer fileFilter：按白名单校验 mimetype，拒绝时返回 415。
 * 这里只能检查客户端声明，简历落存储前还须调用 assertResumeFile 检查实际内容。
 */
export function fileTypeFilter(allowedMimeTypes: string[]): MulterFileFilter {
  return (_req, file, callback) => {
    if (!allowedMimeTypes.includes(file.mimetype)) {
      callback(new UnsupportedMediaTypeException(`不支持的文件类型：${file.mimetype}`), false);
      return;
    }
    callback(null, true);
  };
}

/** 读取 ZIP 中央目录的文件名，避免把任意 ZIP 当成 Word 文档；不解压用户数据。 */
function isDocx(buffer: Buffer): boolean {
  const firstPossibleEnd = Math.max(0, buffer.length - 65_557);
  for (let end = buffer.length - 22; end >= firstPossibleEnd; end--) {
    if (buffer.readUInt32LE(end) !== 0x06054b50) continue;
    if (end + 22 + buffer.readUInt16LE(end + 20) !== buffer.length) continue;
    const count = buffer.readUInt16LE(end + 10);
    const directorySize = buffer.readUInt32LE(end + 12);
    let offset = buffer.readUInt32LE(end + 16);
    if (offset + directorySize !== end) return false;
    const names = new Set<string>();
    for (let index = 0; index < count; index++) {
      if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) return false;
      const nameLength = buffer.readUInt16LE(offset + 28);
      const next = offset + 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
      if (next > end || buffer.readUInt32LE(offset + 42) >= end) return false;
      names.add(buffer.toString('utf8', offset + 46, offset + 46 + nameLength));
      offset = next;
    }
    return offset === end && names.has('[Content_Types].xml') && names.has('word/document.xml');
  }
  return false;
}

/** 基础格式签名校验，不代替病毒扫描或完整解码；无法抽取正文的合法文件仍可留档。 */
export function assertResumeFile(file: Express.Multer.File): void {
  const buffer = file.buffer;
  if (!buffer?.length) throw new BadRequestException('不能上传空文件');
  let valid = false;
  switch (file.mimetype) {
    case 'application/pdf':
      valid = buffer.subarray(0, 5).toString('ascii') === '%PDF-';
      break;
    case 'image/png':
      valid = buffer.length >= 33 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        && buffer.readUInt32BE(8) === 13 && buffer.toString('ascii', 12, 16) === 'IHDR';
      break;
    case 'image/jpeg':
      valid = buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      break;
    case 'image/webp':
      valid = buffer.length >= 16 && buffer.toString('ascii', 0, 4) === 'RIFF'
        && buffer.toString('ascii', 8, 12) === 'WEBP'
        && ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16));
      break;
    case 'application/msword':
      valid = buffer.length >= 512 && buffer.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'));
      break;
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      valid = buffer.length >= 22 && buffer.readUInt32LE(0) === 0x04034b50 && isDocx(buffer);
      break;
    case 'text/plain': {
      const text = buffer.toString('utf8');
      valid = isUtf8(buffer) && !/[\u0000-\u0008\u000b\u000e-\u001f]/.test(text)
        && !/<\s*(?:!doctype\s+html\b|html\b|script\b|svg\b|iframe\b|object\b|embed\b)/i.test(text);
      break;
    }
  }
  if (!valid) throw new UnsupportedMediaTypeException('文件实际格式与声明类型不符，或不是支持的简历格式');
}
