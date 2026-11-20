import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';
import { PrismaService } from './prisma/prisma.service';

@ApiTags('system')
@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  /** 存活探针：进程在、事件循环不卡就返回 200，不碰数据库（数据库抖动不该让平台重启容器） */
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', service: 'hireflow-api', time: new Date().toISOString() };
  }

  /** 就绪探针：能查数据库才算可以接流量；失败返回 503 */
  @Public()
  @Get('ready')
  async ready() {
    const started = Date.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), 3000);
        }),
      ]);
    } catch {
      throw new ServiceUnavailableException({ message: '数据库暂不可用', checks: { database: 'down' } });
    } finally {
      clearTimeout(timer);
    }
    return { status: 'ready', checks: { database: 'up' }, latencyMs: Date.now() - started };
  }
}
