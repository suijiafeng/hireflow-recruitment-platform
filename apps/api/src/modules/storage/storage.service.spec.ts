import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

it('简历下载签名同时固定attachment和二进制响应类型，包括没有文件名的历史记录', async () => {
  const service = new StorageService(new ConfigService({
    S3_ENDPOINT: 'https://storage.example.test', S3_ACCESS_KEY: 'test-key', S3_SECRET_KEY: 'test-secret',
  }));
  // 只测试离线签名，不连接存储、不运行onModuleInit。
  (service as unknown as { available: boolean }).available = true;
  for (const name of ['中文简历.html', undefined]) {
    const url = new URL(await service.presignedGetUrl('resumes/test', name, 600, 'attachment'));
    expect(url.searchParams.get('response-content-disposition')).toMatch(/^attachment(?:;|$)/);
    expect(url.searchParams.get('response-content-type')).toBe('application/octet-stream');
  }
});

describe('本地盘驱动', () => {
  const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'hf-store-'));
  const make = () =>
    new StorageService(new ConfigService({ STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: dir, JWT_SECRET: 'test-secret' }));

  it('写入后可以用签名链接读回，篡改或过期都读不到', async () => {
    const service = make();
    await service.onModuleInit();
    expect(service.driver).toBe('local');
    await service.put('resumes/a/简历.pdf', Buffer.from('hello'));
    const url = await service.presignedGetUrl('resumes/a/简历.pdf', '简历.pdf', 600, 'attachment');
    expect(url).toMatch(/^\/api\/files\//);
    const token = url.split('/').pop()!;
    const file = await service.readSigned(token);
    expect(file.body.toString()).toBe('hello');
    expect(file.disposition).toBe('attachment');

    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ k: '../../etc/passwd', d: 'inline', exp: Date.now() + 1e6 })).toString('base64url');
    await expect(service.readSigned(`${forged}.${sig}`)).rejects.toThrow();
    await expect(service.readSigned(`${payload}.x${sig.slice(1)}`)).rejects.toThrow();

    const expired = await service.presignedGetUrl('resumes/a/简历.pdf', undefined, -1);
    await expect(service.readSigned(expired.split('/').pop()!)).rejects.toThrow('过期');
  });

  it('没配 S3_ENDPOINT 时默认本地盘；配了则走 S3', () => {
    expect(new StorageService(new ConfigService({})).driver).toBe('local');
    expect(new StorageService(new ConfigService({ S3_ENDPOINT: 'http://x:9000' })).driver).toBe('s3');
  });

  it('S3 驱动下签名下载接口恒 404', async () => {
    const s3 = new StorageService(new ConfigService({ S3_ENDPOINT: 'http://x:9000' }));
    await expect(s3.readSigned('a.b')).rejects.toThrow();
  });
});
