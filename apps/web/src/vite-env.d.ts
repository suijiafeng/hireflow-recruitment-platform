/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'false' 时登录页不展示测试账号、不预填（正式部署用） */
  readonly VITE_DEMO_ACCOUNTS?: string;
}
