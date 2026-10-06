import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** 当前请求的访问身份：JWT 只用来认人，角色 / 权限 / 范围由 loadAccess 按库重算 */
export interface JwtUser {
  sub: string; // 用户 id
  email: string;
  name: string;
  roles: string[]; // RoleCode[]
  permissions: string[]; // PermissionCode[]
  departmentId: string | null;
  /** 本部门 + 全部下级部门（登录时计算，供「本部门」数据范围使用；旧令牌无此字段） */
  departmentIds?: string[];
  /** 数据行级范围（多角色取最宽）；鉴权时按数据库当前角色重算，改角色下一次请求即生效 */
  dataScope?: string;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): JwtUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user as JwtUser;
});
