import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { StorageService } from './storage.service';

/**
 * 本地盘驱动的文件下载。和 S3 预签名链接同一个语义：链接本身就是凭证（HMAC 签名 + 过期时间，默认 10 分钟），
 * 所以不要求登录——浏览器直接打开 / <iframe> 预览都能用。S3 驱动下这个接口恒 404。
 */
@ApiExcludeController()
@Controller('files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Public()
  @Get(':token')
  async download(@Param('token') token: string, @Res() res: Response) {
    const file = await this.storage.readSigned(token);
    const name = file.fileName ? `; filename*=UTF-8''${encodeURIComponent(file.fileName)}` : '';
    res.setHeader('Content-Disposition', `${file.disposition}${name}`);
    // 预览也只按二进制/PDF 给，不按 HTML 渲染，避免上传的 HTML 简历在本站同源执行脚本
    res.setHeader('Content-Type', file.disposition === 'attachment' ? 'application/octet-stream' : guessType(file.fileName));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(file.body);
  }
}

function guessType(name?: string): string {
  if (name && /\.pdf$/i.test(name)) return 'application/pdf';
  if (name && /\.(png)$/i.test(name)) return 'image/png';
  if (name && /\.(jpe?g)$/i.test(name)) return 'image/jpeg';
  return 'application/octet-stream';
}
