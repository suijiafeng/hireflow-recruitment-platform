import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

export type StorageDriver = 's3' | 'local';

/** 本地盘驱动的下载令牌负载 */
interface LocalFileClaim {
  k: string;
  n?: string;
  d: 'inline' | 'attachment';
  exp: number;
}

/**
 * 文件存储抽象：简历 / 合同等文件统一走这里，两种驱动：
 * - s3：MinIO / 云 OSS（S3 协议兼容），浏览器拿预签名链接直连；
 * - local：写本机目录（STORAGE_LOCAL_DIR，默认 apps/api/.storage），下载走 /api/files/<签名令牌>。
 *   没配 S3_ENDPOINT 时默认用它，本地开发不必先起 MinIO。注意容器的本地盘随实例销毁，生产请用 s3。
 * 存储不可用时：文件上传报 503 引导用户走文本粘贴通道，其余流程不受影响（人工兜底原则）。
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  /** 预签名专用 client：容器化部署时 API 内网访问与浏览器公网访问的端点不同（SigV4 签 Host，必须按浏览器可达地址签名） */
  private readonly presignClient: S3Client;
  private readonly bucket: string;
  private available = false;
  readonly driver: StorageDriver;
  private readonly localDir: string;
  private readonly signingKey: string;

  constructor(config: ConfigService) {
    const explicit = config.get<string>('STORAGE_DRIVER')?.trim().toLowerCase();
    this.driver = explicit === 'local' || explicit === 's3' ? explicit : config.get<string>('S3_ENDPOINT') ? 's3' : 'local';
    this.localDir = resolve(config.get<string>('STORAGE_LOCAL_DIR') || '.storage');
    this.signingKey = `files:${config.get<string>('JWT_SECRET') ?? 'dev-only-secret'}`;
    this.bucket = config.get<string>('S3_BUCKET') ?? 'hireflow';
    const endpoint = config.get<string>('S3_ENDPOINT') ?? 'http://localhost:9000';
    const clientConfig = {
      region: config.get<string>('S3_REGION') ?? 'us-east-1',
      forcePathStyle: true, // MinIO 必需：路径风格寻址
      credentials: {
        accessKeyId: config.get<string>('S3_ACCESS_KEY') ?? 'hireflow',
        secretAccessKey: config.get<string>('S3_SECRET_KEY') ?? 'hireflow_dev_password',
      },
    };
    this.client = new S3Client({ ...clientConfig, endpoint });
    // 预签名是离线计算，不要求 API 能访问该端点；未配置时与内网端点一致（本地开发零变化）
    const publicEndpoint = config.get<string>('S3_PUBLIC_ENDPOINT') ?? endpoint;
    this.presignClient =
      publicEndpoint === endpoint ? this.client : new S3Client({ ...clientConfig, endpoint: publicEndpoint });
  }

  async onModuleInit() {
    if (this.driver === 'local') {
      try {
        await mkdir(this.localDir, { recursive: true });
        this.available = true;
        this.logger.log(`文件存储：本地目录 ${this.localDir}`);
        if (process.env.NODE_ENV === 'production') {
          this.logger.warn('生产环境使用本地盘存储：容器重建后文件会丢失，建议配置 S3_ENDPOINT 改用对象存储');
        }
      } catch (error) {
        this.logger.warn(`本地存储目录不可写（${error instanceof Error ? error.message : error}），文件上传功能将降级`);
      }
      return;
    }
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
    if (this.driver === 'local') {
      const path = this.localPath(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
      return;
    }
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
    if (this.driver === 'local') {
      const claim: LocalFileClaim = { k: key, n: fileName, d: disposition, exp: Date.now() + expiresInSeconds * 1000 };
      const payload = Buffer.from(JSON.stringify(claim)).toString('base64url');
      return `/api/files/${payload}.${this.sign(payload)}`;
    }
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

  // ---------- 本地盘驱动 ----------

  private sign(payload: string): string {
    return createHmac('sha256', this.signingKey).update(payload).digest('base64url');
  }

  /** key 只允许落在存储目录内（防 ../ 穿越） */
  private localPath(key: string): string {
    const path = resolve(this.localDir, key);
    if (!path.startsWith(this.localDir + sep)) throw new NotFoundException('文件不存在');
    return path;
  }

  /** 校验 /api/files/<令牌> 并读出文件；签名不对或过期一律 404（不区分原因，免得被探测） */
  async readSigned(token: string): Promise<{ body: Buffer; fileName?: string; disposition: 'inline' | 'attachment' }> {
    if (this.driver !== 'local') throw new NotFoundException('文件不存在');
    const [payload, sig] = token.split('.');
    if (!payload || !sig) throw new NotFoundException('文件不存在');
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new NotFoundException('文件不存在');
    let claim: LocalFileClaim;
    try {
      claim = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LocalFileClaim;
    } catch {
      throw new NotFoundException('文件不存在');
    }
    if (!claim.k || claim.exp < Date.now()) throw new NotFoundException('链接已过期，请刷新页面后重试');
    try {
      return { body: await readFile(this.localPath(claim.k)), fileName: claim.n, disposition: claim.d };
    } catch {
      throw new NotFoundException('文件不存在');
    }
  }
}
