import { addBusinessDays, candidateActor, CN_TZ_OFFSET_MS, newPortalToken } from './portal';

/** 北京时间的日历字段。用固定偏移换算，不读运行机器的本地时区。 */
function beijingWall(d: Date) {
  const shifted = new Date(d.getTime() + CN_TZ_OFFSET_MS);
  return {
    date: shifted.getUTCDate(),
    day: shifted.getUTCDay(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

describe('portal 工具', () => {
  it('addBusinessDays 跳过周末：周五 +5 个工作日 = 下周五', () => {
    // 2026-07-17 10:00 北京时间，周五。用 UTC 瞬时构造，与 TZ 无关。
    const friday = new Date(Date.UTC(2026, 6, 17, 2, 0, 0));
    const wall = beijingWall(addBusinessDays(friday, 5));
    expect(wall.day).toBe(5); // 周五
    expect(wall.date).toBe(24);
    // 截止到当天最后一刻
    expect(wall.hours).toBe(23);
    expect(wall.minutes).toBe(59);
  });

  it('addBusinessDays 周中不跨周末时按自然日推进', () => {
    // 2026-07-13 09:00 北京时间，周一，+3 个工作日 = 周四
    const monday = new Date(Date.UTC(2026, 6, 13, 1, 0, 0));
    const wall = beijingWall(addBusinessDays(monday, 3));
    expect(wall.date).toBe(16);
    expect(wall.day).toBe(4);
  });

  it('newPortalToken 不可枚举且每次不同', () => {
    const a = newPortalToken();
    const b = newPortalToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32); // 24 字节 base64url
  });

  it('candidateActor 不携带 userId（留痕 actorId 落 null），姓名可读', () => {
    const actor = candidateActor('张三');
    expect(actor.sub).toBeNull();
    expect(actor.name).toContain('张三');
    expect(actor.permissions).toEqual([]);
  });
});
