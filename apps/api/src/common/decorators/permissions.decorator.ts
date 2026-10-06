import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@hireflow/shared';

export const PERMISSIONS_KEY = 'requiredPermissions';

/** 声明接口所需的功能点权限（全部满足才放行），权限码见 @hireflow/shared PERMISSIONS */
export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const ANY_PERMISSIONS_KEY = 'anyOfPermissions';

/** 声明接口所需的功能点权限（满足其一即放行）。可与 @RequirePermissions 叠加，两者都需通过 */
export const RequireAnyPermission = (...permissions: PermissionCode[]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissions);
