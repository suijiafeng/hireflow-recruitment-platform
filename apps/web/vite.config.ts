import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolveApiProxyTarget } from './devApiTarget';

const webRoot = dirname(fileURLToPath(import.meta.url));

function readApiEnv(): string | null {
  try {
    return readFileSync(resolve(webRoot, '../api/.env'), 'utf8');
  } catch {
    return null;
  }
}

const apiProxyTarget = resolveApiProxyTarget({
  envPort: process.env.PORT,
  apiEnvText: readApiEnv(),
});

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // 首屏必用的运行时单独成块，便于缓存。antd 不合成一整包：
        // Table / DatePicker 会跟着用到它们的路由走。
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 30,
            },
            {
              name: 'query',
              test: /[\\/]node_modules[\\/]@tanstack[\\/]/,
              priority: 20,
            },
            {
              name: 'dayjs',
              test: /[\\/]node_modules[\\/]dayjs[\\/]/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
