import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionCode } from '@hireflow/shared';
import type { JwtUser } from '../decorators/current-user.decorator';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/permissions.decorator';

/** 功能点权限守卫。权限码随 JWT 下发，改动角色权限后需重新登录生效。 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionCode[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const anyOf = this.reflector.getAllAndOverride<PermissionCode[] | undefined>(ANY_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length && !anyOf?.length) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: JwtUser }>();
    // public 路由无 user，也不会声明权限要求；有权限要求但无 user 说明认证环节异常
    if (!user) throw new ForbiddenException('无法识别当前用户');

    const owned = new Set(user.permissions ?? []);
    const missing = (required ?? []).filter((p) => !owned.has(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`缺少权限: ${missing.join(', ')}`);
    }
    if (anyOf?.length && !anyOf.some((p) => owned.has(p))) {
      throw new ForbiddenException(`缺少权限（任一即可）: ${anyOf.join(' / ')}`);
    }
    return true;
  }
}
