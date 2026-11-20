/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'true'：生产构建也展示演示账号（公开演示站）；'false'：开发环境也不展示。见 utils/demo.ts */
  readonly VITE_DEMO_MODE?: string;
}
