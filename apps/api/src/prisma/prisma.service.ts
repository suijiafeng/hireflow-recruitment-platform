import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    // Prisma 7 移除内置 Rust 引擎，PostgreSQL 通过 driver adapter 连接。
    // DATABASE_POOL_MAX：本地 PGlite 必须设为 1。pglite-socket 把所有连接接到同一个单会话后端，
    // 多条连接并发时扩展协议的 Parse/Bind/Execute 会互相穿插——表现为随机 500
    // （unnamed prepared statement does not exist），更糟的是 A 查询拿到 B 查询的结果。
    const poolMax = Number(config.get<string>('DATABASE_POOL_MAX')) || undefined;
    super({
      adapter: new PrismaPg({
        connectionString: config.getOrThrow<string>('DATABASE_URL'),
        ...(poolMax ? { max: poolMax } : {}),
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
