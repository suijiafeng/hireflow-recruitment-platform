import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';

/**
 * 对象存储抽象：简历/合同/证件文件统一走这里。
 * 开发期对接 docker compose 里的 MinIO；生产换云 OSS 只改 env（S3 协议兼容）。
 * MinIO 不可用时：文件上传报 503 引导用户走文本粘贴通道，其余流程不受影响（人工兜底原则）。
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  /** 预签名专用 client：容器化部署时 API 内网访问与浏览器公网访问的端点不同（SigV4 签 Host，必须按浏览器可达地址签名） */
  private readonly presignClient: S3Client;
  private readonly bucket: string;
  private available = false;

  constructor(config: ConfigService) {
    this.bucket = config.get<string>('S3_BUCKET') ?? 'arthr';
    const endpoint = config.get<string>('S3_ENDPOINT') ?? 'http://localhost:9000';
    const clientConfig = {
      region: config.get<string>('S3_REGION') ?? 'us-east-1',
      forcePathStyle: true, // MinIO 必需：路径风格寻址
      credentials: {
        accessKeyId: config.get<string>('S3_ACCESS_KEY') ?? 'arthr',
        secretAccessKey: config.get<string>('S3_SECRET_KEY') ?? 'arthr_dev_password',
      },
    };
    this.client = new S3Client({ ...clientConfig, endpoint });
    // 预签名是离线计算，不要求 API 能访问该端点；未配置时与内网端点一致（本地开发零变化）
    const publicEndpoint = config.get<string>('S3_PUBLIC_ENDPOINT') ?? endpoint;
    this.presignClient =
      publicEndpoint === endpoint ? this.client : new S3Client({ ...clientConfig, endpoint: publicEndpoint });
  }

  async onModuleInit() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.available = true;
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.available = true;
        this.logger.log(`已创建对象存储 bucket：${this.bucket}`);
      } catch (error) {
        this.available = false;
        this.logger.warn(
          `对象存储不可用（${error instanceof Error ? error.message : error}），文件上传功能将降级`,
        );
      }
    }
  }

  get isAvailable(): boolean {
    return this.available;
  }

  private ensureAvailable() {
    if (!this.available) {
      throw new ServiceUnavailableException('对象存储暂不可用，请改用文本粘贴通道或稍后重试');
    }
  }

  /** 生成不可枚举的对象 key：<prefix>/<随机>-<安全文件名> */
  objectKey(prefix: string, fileName: string): string {
    const safe = fileName.replace(/[^\w.一-龥-]+/g, '_').slice(-80);
    return `${prefix}/${randomBytes(8).toString('hex')}-${safe}`;
  }

  async put(key: string, body: Buffer, contentType?: string): Promise<void> {
    this.ensureAvailable();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType ?? 'application/octet-stream',
      }),
    );
  }

  /** 预签名下载/预览链接（默认 10 分钟有效，浏览器直连 MinIO，不过 API 转发） */
  async presignedGetUrl(
    key: string,
    fileName?: string,
    expiresInSeconds = 600,
    disposition: 'inline' | 'attachment' = 'inline',
  ): Promise<string> {
    this.ensureAvailable();
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: fileName
        ? `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`
        : disposition,
      ...(disposition === 'attachment' ? { ResponseContentType: 'application/octet-stream' } : {}),
    });
    return getSignedUrl(this.presignClient, command, { expiresIn: expiresInSeconds });
  }

  /** 安全版：key 为空或存储不可用时返回 null，供列表批量拼 URL 用 */
  async tryPresignedGetUrl(key: string | null | undefined, fileName?: string): Promise<string | null> {
    if (!key || !this.available) return null;
    try {
      return await this.presignedGetUrl(key, fileName);
    } catch {
      return null;
    }
  }
}
