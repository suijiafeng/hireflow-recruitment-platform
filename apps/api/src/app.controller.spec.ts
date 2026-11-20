import { ServiceUnavailableException } from '@nestjs/common';
import { AppController } from './app.controller';
import type { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  it('health 返回 ok，不访问数据库', () => {
    const prisma = { $queryRaw: jest.fn() };
    const controller = new AppController(prisma as unknown as PrismaService);
    const result = controller.health();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('hireflow-api');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('ready：数据库可用时 ready，不可用时 503', async () => {
    const ok = new AppController({ $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } as unknown as PrismaService);
    await expect(ok.ready()).resolves.toMatchObject({ status: 'ready', checks: { database: 'up' } });
    const down = new AppController({ $queryRaw: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) } as unknown as PrismaService);
    await expect(down.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
