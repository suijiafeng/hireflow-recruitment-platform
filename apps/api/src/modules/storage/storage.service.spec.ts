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
