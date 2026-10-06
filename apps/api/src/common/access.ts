import type { PrismaService } from '../prisma/prisma.service';
import { departmentSubtree, widestScope } from './data-scope';
import type { JwtUser } from './decorators/current-user.decorator';

const ACCESS_INCLUDE = {
  department: true,
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
} as const;

/**
 * 按数据库当前状态算出一个账号的访问身份（角色、权限码、数据范围、部门子树）。
 *
 * 登录签发令牌和每次请求的鉴权都走这里：权限不再「冻结」在 12 小时的令牌里——
 * 管理员降权、改角色权限、停用账号，下一次请求即生效。
 * 返回 null 表示账号不存在或已停用。
 */
export async function loadAccess(prisma: PrismaService, where: { id: string } | { email: string }) {
  const user = await prisma.user.findUnique({ where, include: ACCESS_INCLUDE });
  if (!user) return null;
  const departmentIds = user.departmentId
    ? departmentSubtree(user.departmentId, await prisma.department.findMany({ select: { id: true, parentId: true } }))
    : [];
  const access: JwtUser = {
    sub: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles.map((ur) => ur.role.code),
    permissions: [...new Set(user.roles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.code)))],
    departmentId: user.departmentId,
    departmentIds,
    dataScope: widestScope(user.roles.map((ur) => ur.role.dataScope)),
  };
  return { user, access };
}
