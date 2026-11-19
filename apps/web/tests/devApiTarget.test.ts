import { describe, expect, it } from 'vitest';
import { resolveApiProxyTarget } from '../devApiTarget';

describe('开发代理端口', () => {
  const file = 'PORT=4000\n# PORT=1\n';

  it('进程环境变量优先于 .env', () => {
    expect(resolveApiProxyTarget({ envPort: '4010', apiEnvText: file })).toBe('http://localhost:4010');
  });

  it('否则读取 apps/api/.env 里的 PORT', () => {
    expect(resolveApiProxyTarget({ envPort: undefined, apiEnvText: file })).toBe('http://localhost:4000');
    expect(resolveApiProxyTarget({ envPort: '  ', apiEnvText: 'PORT="4100" # api' })).toBe(
      'http://localhost:4100',
    );
  });

  it('都没有时用 3000', () => {
    expect(resolveApiProxyTarget({ envPort: undefined, apiEnvText: null })).toBe('http://localhost:3000');
    expect(resolveApiProxyTarget({ envPort: 'abc', apiEnvText: '# PORT=9\n' })).toBe('http://localhost:3000');
  });
});
