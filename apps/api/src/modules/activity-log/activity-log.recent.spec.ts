import { parseActionPrefixes } from './activity-log.controller';
import { ActivityLogService } from './activity-log.service';

describe('审计日志按动作前缀筛选（设置页「最近权限变更」）', () => {
  it('只接受「小写字母 / 下划线 + 点」形状的前缀，最多 10 个', () => {
    expect(parseActionPrefixes('role.,user.,department.')).toEqual(['role.', 'user.', 'department.']);
    expect(parseActionPrefixes('role.;drop table,USER.,../x, user.roles_updated')).toEqual(['user.roles_updated']);
    expect(parseActionPrefixes('')).toBeUndefined();
    expect(parseActionPrefixes(undefined)).toBeUndefined();
    expect(parseActionPrefixes(Array.from({ length: 20 }, () => 'role.').join(','))).toHaveLength(10);
  });

  it('给了前缀时 count 与 findMany 用同一个 where（之前前端取全站最近 20 条再筛，常常一条都不剩）', async () => {
    const count = jest.fn().mockReturnValue('count');
    const findMany = jest.fn().mockReturnValue('find');
    const prisma = {
      activityLog: { count, findMany },
      $transaction: jest.fn().mockResolvedValue([3, []]),
    };
    const service = new ActivityLogService(prisma as never);
    const res = await service.recent(1, 12, ['role.', 'user.']);
    const where = { OR: [{ action: { startsWith: 'role.' } }, { action: { startsWith: 'user.' } }] };
    expect(count).toHaveBeenCalledWith({ where });
    expect(findMany.mock.calls[0][0].where).toEqual(where);
    expect(res.total).toBe(3);

    await service.recent(1, 20);
    expect(count).toHaveBeenLastCalledWith({ where: {} });
  });
});
