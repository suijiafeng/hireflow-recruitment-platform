import { maskContactsDeep, maskContactsInText, maskEmail, maskPhone } from './mask';

describe('maskPhone', () => {
  it('保留前 3 后 4', () => {
    expect(maskPhone('13910000000')).toBe('139***0000');
  });

  it('忽略分隔符只看数字', () => {
    expect(maskPhone('139-1000-0000')).toBe('139***0000');
  });

  it('短号退化为首尾各一位', () => {
    expect(maskPhone('10086')).toBe('1***6');
  });

  it('过短则整串遮蔽', () => {
    expect(maskPhone('12')).toBe('***');
  });

  it('星号数量固定，不随原文长度变化（长度本身也是信息）', () => {
    const stars = (s: string) => s.match(/\*+/)![0].length;
    expect(stars(maskPhone('13900000000'))).toBe(stars(maskPhone('139000000000009')));
  });
});

describe('maskEmail', () => {
  it('保留本地部分前 2 位与完整域名', () => {
    expect(maskEmail('zhenghao@example.com')).toBe('zh***@example.com');
  });

  it('本地部分过短时只保留 1 位', () => {
    expect(maskEmail('ab@example.com')).toBe('a***@example.com');
  });

  it('非法邮箱整串遮蔽', () => {
    expect(maskEmail('not-an-email')).toBe('***');
    expect(maskEmail('@example.com')).toBe('***');
  });
});

describe('maskContactsInText', () => {
  it('遮蔽正文中的手机号与邮箱，其余文字不动', () => {
    expect(maskContactsInText('李娜 | 手机 13800000002 | 邮箱 lina@example.com | 五年经验')).toBe(
      '李娜 | 手机 138***0002 | 邮箱 li***@example.com | 五年经验',
    );
  });

  it('识别 +86 前缀与分隔符写法', () => {
    expect(maskContactsInText('电话：+86 138-0000-0002')).toBe('电话：138***0002');
    expect(maskContactsInText('Tel 138 0000 0002')).toBe('Tel 138***0002');
  });

  it('不误伤年份、金额、更长的数字串', () => {
    const text = '2019-2024 年，年薪 350000，订单号 1380000000212345';
    expect(maskContactsInText(text)).toBe(text);
  });
});

describe('maskContactsDeep', () => {
  it('递归处理对象与数组里的字符串，保留非字符串值', () => {
    expect(
      maskContactsDeep({ contact: { phone: '13800000002', emails: ['a.b@x.com'] }, years: 5, ok: true }),
    ).toEqual({ contact: { phone: '138***0002', emails: ['a.***@x.com'] }, years: 5, ok: true });
  });
});
