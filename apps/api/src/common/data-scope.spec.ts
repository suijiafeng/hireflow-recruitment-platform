import { DataScope } from '@hireflow/shared';
import { departmentScopeOf, departmentSubtree, inDepartmentScope, widestScope } from './data-scope';
import type { JwtUser } from './decorators/current-user.decorator';

const user = (over: Partial<JwtUser>): JwtUser => ({
  sub: 'u1',
  email: 'u@x',
  name: 'u',
  roles: [],
  permissions: [],
  departmentId: null,
  ...over,
});

describe('departmentSubtree', () => {
  const tree = [
    { id: 'tech', parentId: null },
    { id: 'fe', parentId: 'tech' },
    { id: 'be', parentId: 'tech' },
    { id: 'infra', parentId: 'be' },
    { id: 'design', parentId: null },
  ];

  it('includes the root and every descendant, excluding siblings', () => {
    expect(departmentSubtree('tech', tree).sort()).toEqual(['be', 'fe', 'infra', 'tech']);
  });

  it('returns only the leaf itself for a leaf department', () => {
    expect(departmentSubtree('fe', tree)).toEqual(['fe']);
  });

  it('terminates on cyclic parent links', () => {
    const cyclic = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ];
    expect(departmentSubtree('a', cyclic).sort()).toEqual(['a', 'b']);
  });
});

describe('departmentScopeOf', () => {
  it('is unrestricted for non-department scopes', () => {
    expect(departmentScopeOf(user({ dataScope: DataScope.ALL, departmentId: 'tech' }))).toBeNull();
    expect(
      departmentScopeOf(user({ dataScope: DataScope.ASSIGNED, departmentId: 'tech' })),
    ).toBeNull();
  });

  it('uses the subtree carried in the token', () => {
    const u = user({
      dataScope: DataScope.DEPARTMENT,
      departmentId: 'tech',
      departmentIds: ['tech', 'fe'],
    });
    expect(departmentScopeOf(u)).toEqual(['tech', 'fe']);
  });

  it('falls back to the single department for tokens issued before subtrees existed', () => {
    expect(
      departmentScopeOf(user({ dataScope: DataScope.DEPARTMENT, departmentId: 'tech' })),
    ).toEqual(['tech']);
  });

  it('matches nothing when a department-scoped user has no department', () => {
    const scope = departmentScopeOf(user({ dataScope: DataScope.DEPARTMENT }));
    expect(scope).toEqual(['__no_department__']);
    expect(inDepartmentScope(scope, 'tech')).toBe(false);
  });
});

describe('inDepartmentScope', () => {
  it('treats a null scope as unrestricted and rejects missing ids under a real scope', () => {
    expect(inDepartmentScope(null, 'anything')).toBe(true);
    expect(inDepartmentScope(['tech'], null)).toBe(false);
    expect(inDepartmentScope(['tech', 'fe'], 'fe')).toBe(true);
  });
});

describe('widestScope', () => {
  it('picks the widest scope across roles', () => {
    expect(widestScope([DataScope.ASSIGNED, DataScope.DEPARTMENT])).toBe(DataScope.DEPARTMENT);
    expect(widestScope([DataScope.DEPARTMENT, DataScope.ALL])).toBe(DataScope.ALL);
  });
});
