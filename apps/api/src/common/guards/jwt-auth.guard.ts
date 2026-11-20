import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { loadAccess } from '../access';
import type { JwtUser } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('未登录或令牌缺失');

    let payload: JwtUser & { tv?: number };
    try {
      payload = await this.jwtService.verifyAsync<JwtUser & { tv?: number }>(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('令牌无效或已过期');
    }
    // 令牌只证明「你是谁」；「你能做什么」每次按数据库当前状态重算：
    // 停用即时生效，降权 / 改角色权限也不必等 12 小时令牌过期（见 loadAccess）。
    const loaded = await loadAccess(this.prisma, { id: payload.sub });
    if (!loaded || loaded.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('账号已停用或不存在，请联系管理员');
    }
    // 吊销：改密 / 重置密码 / 停用 / 退出所有设备都会让 tokenVersion +1，之前签发的令牌一律作废。
    // 上线前签发的旧令牌没有 tv，按 0 处理：账号从未改过密码时仍有效，改过即失效
    if ((payload.tv ?? 0) !== loaded.user.tokenVersion) {
      throw new UnauthorizedException('登录已失效（密码已修改或已在其他地方退出），请重新登录');
    }
    (request as Request & { user: unknown }).user = loaded.access;
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
