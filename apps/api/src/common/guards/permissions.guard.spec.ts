import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { PermissionsGuard } from './permissions.guard';

function contextWith(meta: Record<string, string[] | undefined>, permissions?: string[]) {
  const handler = () => undefined;
  for (const [key, value] of Object.entries(meta)) Reflect.defineMetadata(key, value, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ user: permissions ? { permissions } : undefined }),
    }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('passes routes without any permission metadata', () => {
    expect(guard.canActivate(contextWith({}))).toBe(true);
  });

  it('requires every permission listed in @RequirePermissions', () => {
    const ctx = contextWith({ [PERMISSIONS_KEY]: ['a', 'b'] }, ['a']);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(guard.canActivate(contextWith({ [PERMISSIONS_KEY]: ['a', 'b'] }, ['a', 'b']))).toBe(
      true,
    );
  });

  it('accepts any one permission listed in @RequireAnyPermission', () => {
    expect(guard.canActivate(contextWith({ [ANY_PERMISSIONS_KEY]: ['a', 'b'] }, ['b']))).toBe(true);
    expect(() =>
      guard.canActivate(contextWith({ [ANY_PERMISSIONS_KEY]: ['a', 'b'] }, ['c'])),
    ).toThrow(ForbiddenException);
  });

  it('enforces both decorators when stacked', () => {
    const meta = { [PERMISSIONS_KEY]: ['x'], [ANY_PERMISSIONS_KEY]: ['a', 'b'] };
    expect(() => guard.canActivate(contextWith(meta, ['a']))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextWith(meta, ['x']))).toThrow(ForbiddenException);
    expect(guard.canActivate(contextWith(meta, ['x', 'b']))).toBe(true);
  });

  it('rejects when metadata exists but no user is attached', () => {
    expect(() => guard.canActivate(contextWith({ [ANY_PERMISSIONS_KEY]: ['a'] }))).toThrow(
      ForbiddenException,
    );
  });
});
