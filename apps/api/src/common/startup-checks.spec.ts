import { assertProductionSecrets } from './startup-checks';

describe('assertProductionSecrets', () => {
  const strong = 'k3p9Qx7vT2mN8wR4zY6bH1cF5gJ0sL2dA9eU7iO3';

  it('ignores non-production environments', () => {
    expect(() => assertProductionSecrets({ NODE_ENV: 'development', JWT_SECRET: 'change-me-in-production' })).not.toThrow();
  });

  it('rejects documented placeholders, short and missing secrets in production', () => {
    for (const JWT_SECRET of ['change-me-in-production', 'your-secret-key-here', 'short-but-random', undefined]) {
      expect(() => assertProductionSecrets({ NODE_ENV: 'production', JWT_SECRET })).toThrow(/JWT_SECRET/);
    }
  });

  it('accepts a long random secret in production', () => {
    expect(() => assertProductionSecrets({ NODE_ENV: 'production', JWT_SECRET: strong })).not.toThrow();
  });
});
