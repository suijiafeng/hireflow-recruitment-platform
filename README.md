# HireFlow · AI-Powered Recruitment Platform

> 🚀 开源智能招聘系统（ATS）——以「候选人流转看板」为中枢、「AI Copilot」为差异化、「自动化工作流」贯穿全链路

[![在线体验](https://img.shields.io/badge/在线体验-demo.suijf.site-2457c5)](https://demo.suijf.site)
[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D20.19-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](./apps/api/tsconfig.json)
[![Monorepo](https://img.shields.io/badge/Monorepo-npm%20workspaces-333333)](#目录结构)

**[👉 在线体验 demo.suijf.site](https://demo.suijf.site)** —— 登录页列出了系统管理员 / HR / 用人经理 / 面试官 / IT 五个测试账号，用不同角色登录可以直接看出权限与数据范围的差异。

仓库 GitHub Homepage 登记的是 [hireflow-web-15a5.onrender.com/dashboard](https://hireflow-web-15a5.onrender.com/dashboard)。撰写本文时该地址与 `demo.suijf.site` 都能打开本应用页面（两边的静态资源哈希不同，不一定是同一次构建）。徽章仍指向 `demo.suijf.site`。

## 数据洞察：TTH 中位数、渠道效能、面试官效能、阶段停留分位

![数据洞察](./screenshot/insights.jpg)

> 招聘周期 TTH 取**中位数而非均值**（小样本下均值会被个别超长案例带偏）；阶段停留同时给 **P50 与 P90**（P90 才是"最慢的那批人卡在哪"）；渠道效能追踪「投递 → 进面 → Offer → 入职」四段转化，而不只是投递量。

## 角色与权限：按钮级权限 × 行级数据范围

![角色与权限](./screenshot/rbac.jpg)

> 数据范围一列是这套权限模型的核心——同样有「查看候选人」权限，HR 看全部、用人经理看本部门及下级、面试官只看指派给自己的。权限矩阵可在后台可视化编辑并导出 CSV。

<details>
<summary>更多截图（登录页 / 数据大盘）</summary>

![登录](./screenshot/login.jpg)

![数据大盘](./screenshot/dashboard.jpg)

</details>

## 功能矩阵

覆盖「职位 → 简历 → 面试 → Offer → 入职」招聘全流程：

### 核心业务模块

| 模块 | 功能亮点 |
|-----|--------|
| **职位管理** | JD AI 生成、职位级流程阶段（API 可改，见常见问题）、岗位评分卡模板、人才库唤醒 |
| **候选人 360°** | 简历上传（PDF / Word / 纯文本 / 图片）与文字抽取（仅 PDF、纯文本）、语义标签、岗位匹配评分、操作时间轴 |
| **招聘看板** | 路由 `/pipeline`：拖拽、批量操作、AI 候选人对比（2–4 人）、预筛三问 |
| **面试协同** | 面试安排、面试官时段 + 候选人自助选时、结构化面评（AI 草稿） |
| **Offer 与入职** | 审批流转、免登录 Offer 答复、入职清单、电子合同（当前为 mock 电子签）、入职问答机器人 |

### 运营智能化

| 能力 | 说明 |
|-----|------|
| 🤖 **AI Copilot** | JD 生成、简历解析、岗位评分、候选人对比、面评草稿、Offer 留存预测 |
| 📊 **数据大盘** | 招聘漏斗、AI 健康度诊断、多维洞察（TTH / 渠道 / 面试官 / 毁约） |
| 🔐 **权限体系** | 按钮级权限 + 行级数据范围、可视化角色矩阵编辑与 CSV 导出 |
| 📋 **合规与审计** | 操作留痕、审计日志可导出。有应聘记录的候选人 / 职位拒绝物理删除；审计日志没有删除接口。schema 里没有 `deletedAt` |
| 🎯 **流程自动化** | 站内通知与待办、入职问答机器人、免登录门户。邮件 / IM 通道未接 |

### 候选人免登录门户

凭 token 一键直达，无需注册：
- **Offer 答复**：查看 Offer、接受/拒绝、答复截止（发送时 +5 个工作日，可续期一次）
- **入职资料**：清单进度、证件上传。OCR 当前是 mock：只从粘贴的文字层用正则抽字段；只传图片时标记「待人工核对」，不自动勾选待办
- **面试自助选时**：在面试官空闲时段中直接预约
- **预筛问卷**：在线回答期望薪资、到岗时间、出差意愿。硬性条件不符只给 HR 风险旗标，不自动淘汰

## 🛠 技术栈

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (apps/web)                                         │
│ Vite 8 | React 19 | TypeScript | Ant Design 6              │
│ react-router 8 | TanStack Query | Zustand | dnd-kit         │
└─────────────────────────────────────────────────────────────┘
         ↓ API (http://localhost:3000)
┌─────────────────────────────────────────────────────────────┐
│ Backend (apps/api)                                          │
│ NestJS 11 | Prisma 7 | PostgreSQL 18 | JWT | Swagger Docs   │
└─────────────────────────────────────────────────────────────┘
         ↓ Shared (packages/shared)
         └─ Enums | Permissions | Constants | Contract (CJS + ESM)

🤖 AI Gateway: Anthropic SDK + mock 规则引擎
💾 Storage: MinIO (dev) | S3-compatible (prod)
🗄️ Database: PostgreSQL 18 — PGlite/WASM (dev, 零安装) | 任意 Postgres (prod)
🐳 Infrastructure: Docker Compose 只提供 Postgres + MinIO
```

| 层 | 技术选型 | 说明 |
|----|--------|------|
| **前端** | React 19 + Vite 8 | 开发服务器带 HMR；`/api` 代理到 `localhost:3000` |
| **UI 组件** | Ant Design 6 | 企业级组件库、主题定制 |
| **状态管理** | Zustand + TanStack Query | 登录态在本地；服务端数据走 Query 缓存 |
| **拖拽** | dnd-kit | 看板拖拽 |
| **后端** | NestJS 11 | 模块化、装饰器。权限由本仓库的 `JwtAuthGuard` + `PermissionsGuard` 实现 |
| **ORM** | Prisma 7 | 类型安全、迁移、PostgreSQL driver adapter |
| **AI** | Anthropic SDK | JSON schema 结构化输出；模型名由 `ANTHROPIC_MODEL` 配置 |
| **降级方案** | mock 规则引擎 | 无 key 或调用失败（SDK 最多重试 2 次）时自动切换，provider 名为 `mock` |

API 与 Web 的 TypeScript 主版本并不相同：`apps/api` 与 `packages/shared` 是 5.9，`apps/web` 是 6.0。两边的 `tsconfig` 都开了 `strict`。

## ⚡ 快速开始

### 前置条件
- Node.js ≥ 20.19
- npm

**不需要装 Docker，也不需要装 PostgreSQL。** 本地数据库用的是 [PGlite](https://pglite.dev)——把 PostgreSQL 18.3 编译成 WASM，随 `npm install` 一起下载（约 8MB），由 `npm run dev` 自动拉起，数据存在 `apps/api/.pgdata/`。

### 步骤 1：克隆并安装依赖

```bash
git clone https://github.com/suijiafeng/hireflow-recruitment-platform.git
cd hireflow-recruitment-platform
npm install
```

### 步骤 2：配置环境变量

```bash
cp apps/api/.env.example apps/api/.env
```

默认值开箱即用，不用改。`.env.example` 开头的注释写了 `npm run dev:docker`，仓库里没有这个脚本；连外部数据库用的是下面的 `npm run dev:external-db`。

### 步骤 3：启动

```bash
npm run dev
```

首次运行会自动建库、跑迁移、灌演示数据，然后启动：

```
db     → PGlite      127.0.0.1:5433
api    → NestJS      http://localhost:3000
web    → Vite        http://localhost:5173
```

### 数据库常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run db:reset` | 删库重建并重新灌演示数据 |
| `npm run db:import <file.sql>` | 导入 `pg_dump --data-only --inserts` 生成的 SQL（会先清空现有业务数据） |
| `npm run db:setup` | 只建库/补迁移，不启动服务 |

> **一次只能跑一个。** PGlite 对数据目录没有跨进程锁——两个进程同时打开同一个 `.pgdata` 会写坏 WAL 且不可恢复。脚本会在打开数据目录前先探端口 5433 并拦下，但别绕过它手动起第二个实例。真被写坏了就 `npm run db:reset`。

### 想用真 Postgres？

用 `docker compose up -d`（等价于 `npm run db:up`，停掉用 `npm run db:down`）起本仓库自带的 Postgres 18 + MinIO。compose **只提供这两个依赖，不含 API / Web**。对应连接串是：

```
DATABASE_URL="postgresql://arthr:arthr_dev_password@localhost:5432/arthr?schema=public"
```

把它写进 `apps/api/.env`（换成你自己的 Postgres 也一样，只改这一行；连真 Postgres 时删掉或调大 `DATABASE_POOL_MAX`，PGlite 那条必须保持 `1`），然后：

```bash
docker compose up -d          # 或者用你自己的 Postgres
npm run db:generate           # 生成 Prisma Client（src/generated 不进 git，必须跑）
npm run db:migrate            # prisma migrate dev，建表
npm run db:seed               # 灌演示数据
npm run dev:external-db       # 不拉起 PGlite，直连 DATABASE_URL
```

> `npm run dev` 那条路径里，建库/迁移/种子由 `db:setup` 自动完成；`dev:external-db` 只启动服务，
> 上面三步是首次连一个空库时必须手动补的，否则 API 一查表就报错。库里已有数据时直接起最后一条即可。

MinIO 的 bucket 不用手建，API 启动时不存在会自动创建（默认桶名 `arthr`）。

生产镜像的容器入口执行 `prisma migrate deploy` 与 `npm run db:seed`，见 [render.yaml](render.yaml) 与 `deploy/api-entrypoint.sh`。schema 和迁移文件与本地是同一套。上面的 `npm run db:migrate` 只用于开发机（`prisma migrate dev`）。

### 验证安装

| 服务 | 访问地址 | 说明 |
|-----|--------|------|
| **应用** | http://localhost:5173 | React 前端应用 |
| **API 文档** | http://localhost:3000/api/docs | Swagger。`NODE_ENV=production` 时默认关闭，需 `SWAGGER_ENABLED=true` |
| **健康检查** | http://localhost:3000/api/health | `{ status: "ok", service: "hireflow-api" }` |
| **MinIO 控制台** | http://localhost:9001 | 仅在 `docker compose up` 之后。开发账号 `arthr` / `arthr_dev_password`（与 compose 一致）。S3 API 在 9000 |

### 测试账号

种子与登录页使用的开发密码是 `Admin@123456`。这是演示口令，生产环境请更换，并在构建时设 `VITE_DEMO_ACCOUNTS=false` 关掉登录页上的账号列表（不设的话生产构建默认仍展示）。

演示部门、职位和候选人由种子写入（`npm run dev` 里的 `db:setup`，或 API 容器入口里的 `npm run db:seed`）。库里已经有职位时，种子会跳过演示业务数据；角色和这五个账号每次都会 upsert。

| 账号 | 角色 | 数据权限 | 场景 |
|------|-----|--------|------|
| `admin@arthr.local` | 系统管理员 | 全部数据 | 系统配置、权限管理、部门管理 |
| `hr@arthr.local` | HR / 招聘专员 | 全部数据 | 职位发布、候选人管理、Offer 发送 |
| `manager@arthr.local` | 用人经理 | 本部门及下级部门 | 查看部门候选人、审批 Offer |
| `interviewer@arthr.local` | 面试官 | 被指派的候选人 | 面试安排、面评反馈 |
| `it@arthr.local` | IT / 行政 | 被指派（入职单上 owner=IT 的待办） | 受限权限演示 |

预置角色一共 7 个。上表是可登录的内部账号；另外两个门户角色 `CANDIDATE`（候选人）、`NEW_HIRE`（新员工）没有演示登录账号。

## 📁 目录结构

```
hireflow/
├── apps/
│   ├── api/                              # NestJS 后端
│   │   ├── src/
│   │   │   ├── common/                   # 守卫、数据范围、脱敏、门户令牌、上传白名单
│   │   │   ├── modules/
│   │   │   │   ├── auth/                 # 登录、JWT、登录限流
│   │   │   │   ├── users/                # 邀请成员、改角色、停用
│   │   │   │   ├── rbac/                 # 角色、权限码、PermissionsGuard
│   │   │   │   ├── departments/          # 部门树
│   │   │   │   ├── company-docs/         # 制度文档（入职问答的知识库）
│   │   │   │   ├── jobs/                 # 职位、JD、流程阶段、评分卡、人才库
│   │   │   │   ├── candidates/           # 候选人、简历上传与解析
│   │   │   │   ├── applications/         # 投递、看板、预筛门户
│   │   │   │   ├── interviews/           # 面试、面评、自助选时
│   │   │   │   ├── offers/               # Offer、审批、答复门户
│   │   │   │   ├── onboarding/           # 入职清单、材料、电子合同门户
│   │   │   │   ├── helpdesk/             # 入职问答
│   │   │   │   ├── notifications/        # 站内通知
│   │   │   │   ├── analytics/            # 漏斗、洞察、AI 诊断
│   │   │   │   ├── activity-log/         # 操作留痕
│   │   │   │   ├── storage/              # S3 / MinIO
│   │   │   │   └── ai/                   # Anthropic SDK + mock 引擎
│   │   │   └── prisma/                   # PrismaService
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── seed.ts
│   │   │   └── migrations/
│   │   ├── scripts/db.ts                 # PGlite：serve / setup / reset / import
│   │   └── .env.example
│   │
│   └── web/                              # React 前端
│       └── src/
│           ├── pages/
│           │   ├── Login.tsx
│           │   ├── dashboard/            # 数据大盘
│           │   ├── insights/             # 数据洞察
│           │   ├── jobs/                 # 职位、评分卡、人才库
│           │   ├── candidates/           # 候选人列表（详情在抽屉里）
│           │   ├── pipeline/             # 招聘看板，路由 /pipeline
│           │   ├── interviews/
│           │   ├── offers/
│           │   ├── onboarding/
│           │   ├── helpdesk/
│           │   ├── settings/             # 角色、成员、部门、制度文档、审计日志
│           │   └── portal/               # 免登录 4 页：offer / onboarding / interview / prescreen
│           ├── components/
│           ├── layouts/                  # MainLayout
│           ├── api/
│           └── stores/                   # Zustand 登录态
│
├── packages/shared/src/                  # 前后端共享（CJS + ESM）
│   ├── enums.ts
│   ├── permissions.ts
│   ├── constants.ts
│   ├── contract.ts                       # 劳动合同正文
│   └── index.ts
│
├── deploy/
│   ├── nginx.conf.template               # Web 镜像：静态站 + /api 反代
│   ├── 00-api-upstream.envsh             # API_ORIGIN 协议归一化
│   └── api-entrypoint.sh                 # API 容器：监听后后台 migrate deploy + seed
│
├── docs/                                 # 角色 / 数据流 / 界面走查记录
├── screenshot/
├── docker-compose.yml                    # 仅 postgres + minio
├── Dockerfile                            # Web 镜像（nginx）
├── Dockerfile.api                        # API 镜像
└── render.yaml                           # Render.com Blueprint
```

`apps/api/src/generated/` 是 `prisma generate` 的产物，不进 git。

## 🤖 AI 能力

**统一 AI 网关** (`apps/api/src/modules/ai/`)：可降级、带来源标记。

### 核心特性
- ✅ **可降级**：未配置 API key，或 `AI_PROVIDER=mock` 时走内置规则引擎，全链路可用
- ✅ **可追溯**：每条 AI 输出带 `aiMeta.provider`。真实模型是 `anthropic:<ANTHROPIC_MODEL>`，规则引擎是 `mock`，缓存命中是 `<provider>·缓存`
- ✅ **可缓存**：只有 `parseResume` / `scoreMatch` 按输入的 SHA-256 写入 `AiCache`，且仅在真实 LLM 启用时缓存
- ✅ **容错**：Anthropic SDK 超时 60s、最多重试 2 次；仍失败则降级到 mock，不阻断人工流程

### 启用大模型

在 `apps/api/.env` 配置，重启后生效：

```bash
ANTHROPIC_API_KEY="sk-ant-..."
ANTHROPIC_MODEL="claude-opus-4-8"    # 与 .env.example / render.yaml 的默认值一致
# ANTHROPIC_MODEL="claude-haiku-4-5"
# AI_PROVIDER="auto"                  # auto | mock | anthropic
```

### AI 功能速览

| 功能 | 应用场景 | 入口位置 |
|------|--------|--------|
| 🎯 JD 生成 | 职位信息快速补全 | 职位管理 → 新建 → AI 扩写 JD |
| 📄 简历解析 | 结构化 + 标签 + 摘要 | 候选人详情 → 简历 → AI 解析（先要有抽出的正文） |
| 📊 岗位匹配评分 | 可解释的匹配报告 | 候选人详情 → 应聘记录 → AI 评分 |
| 🔄 候选人对比 | 同一职位 2–4 人 | 招聘看板 → 勾选多人 → AI 对比 |
| ✍️ 面评草稿 | 按评分卡维度生成 | 提交面评 → AI 草稿 |
| 📈 招聘诊断 | 漏斗瓶颈 + 建议 | 数据大盘 → 诊断 |
| 🎁 人才库唤醒 | 历史简历匹配新职位 | 职位管理 → 人才库 |
| 🎪 Offer 留存预测 | 风险提示 | 录用管理 → Offer |

## 🚀 部署

### 本地 Docker：只起基础设施

`docker-compose.yml` 里只有 `postgres`（`postgres:18-alpine`，库 `arthr`）和 `minio`。`docker compose up -d` 只启动这两个依赖。应用进程用上一节的 npm 脚本启动。

本地完整流程是：compose 起依赖，再用 npm 脚本跑应用。命令与连接串见上面的「想用真 Postgres」。

```bash
docker compose up -d              # postgres:5432 + minio:9000/9001
npm run dev:external-db           # 在配好 DATABASE_URL、迁移和种子之后
```

### 应用镜像（Render 或自建容器）

这两个 Dockerfile 用来部署应用本身，不由 compose 编排：

```bash
docker build -f Dockerfile.api -t hireflow-api:latest .
docker build -f Dockerfile -t hireflow-web:latest .
```

API 镜像入口是 `deploy/api-entrypoint.sh`：先监听端口，再在后台执行 `npx prisma migrate deploy` 和 `npm run db:seed`。容器里的迁移就是这一步；开发机上的 `npm run db:migrate` 则是 `prisma migrate dev`。

本机若要直接跑镜像，需要自己 `docker run`，把 `DATABASE_URL` 指到 compose 里的 Postgres、把 S3 变量指到 MinIO。仓库没有把 api/web 写进 compose。

### 云平台一键部署

#### Render.com（推荐）
- **优点**：Blueprint 可建服务、自动 HTTPS
- **数据库**：不由 Blueprint 托管，需自备 Postgres（自建或任意云厂商均可，见下方 `DATABASE_URL` 说明）
- **步骤**：
  1. Fork 本仓库到你的 GitHub 账号
  2. 登录 [Render Dashboard](https://dashboard.render.com)
  3. 点击 **New** → **Blueprint** → 选择本仓库
  4. Render 按 [render.yaml](render.yaml) 创建 2 个服务：`hireflow-api` | `hireflow-web`（都是 Docker，`plan: free`，区域 singapore）
  5. 在 `hireflow-api` 的 Environment 里手动填 `DATABASE_URL`（`sync: false`，控制台填、不进 git）
  6. `hireflow-web` 的 `API_ORIGIN` 同样是 `sync: false`，要在控制台填。文件上传再配 S3 变量；不配则上传不可用，其余功能不受影响

- **运行时注意**：
  - 免费实例空闲后会休眠，仅公网请求可唤醒（时长以 Render 当时的策略为准）
  - `API_ORIGIN` 填 API 服务的公网 URL 或同区域私网地址。`deploy/00-api-upstream.envsh` 会做协议归一化
  - 若数据库是自建/公网可访问的 Postgres，需要把 Render 的出口 IP 段加入其防火墙 / `pg_hba.conf` 白名单（`hireflow-api` 服务 → **Connect** → **Outbound** 面板可查具体 IP，或见 [Render 官方文档](https://render.com/docs/outbound-ip-addresses)）
  - 对象存储需单独配置 S3 兼容服务（如 Cloudflare R2）。变量名是 `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET`

### 环境变量配置

详见 [apps/api/.env.example](apps/api/.env.example)。下面是仓库里真实使用的键名：

```bash
# PGlite（npm run dev 的默认值）
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public"
DATABASE_POOL_MAX=1

# compose 里的 Postgres 则改成：
# DATABASE_URL="postgresql://arthr:arthr_dev_password@localhost:5432/arthr?schema=public"

JWT_SECRET="<至少 32 位随机值，如 openssl rand -base64 48 的输出>"  # 生产环境用占位值或短于 32 位会拒绝启动
JWT_EXPIRES_IN="12h"

ANTHROPIC_API_KEY=""
ANTHROPIC_MODEL="claude-opus-4-8"
AI_PROVIDER="auto"

# 对象存储（与 compose 的 MinIO 默认值一致；代码里也有同样的兜底）
S3_ENDPOINT="http://localhost:9000"
S3_PUBLIC_ENDPOINT=""          # 浏览器可达的预签名地址；空则与 S3_ENDPOINT 相同
S3_ACCESS_KEY="arthr"
S3_SECRET_KEY="arthr_dev_password"
S3_BUCKET="arthr"

# 前端默认同源访问 /api（开发走 Vite 代理，生产走 nginx）。
# 确有跨域需求时再设白名单：
# CORS_ORIGINS="https://admin.example.com"
```

### Docker 镜像说明

| 镜像 | Dockerfile | 用途 |
|-----|-----------|------|
| `hireflow-api` | [Dockerfile.api](Dockerfile.api) | NestJS API（入口脚本负责 migrate deploy + seed） |
| `hireflow-web` | [Dockerfile](Dockerfile) | 静态资源 + nginx 反代 `/api` |

> **为什么分开？** Render 目前不支持多阶段 Dockerfile 的 `--target`，所以两个文件分开维护。deps 层（拷贝三份 `package.json` 再 `npm ci`）需要同步；build 层各编各的——Web 只编 shared + web，API 编 shared、`prisma generate` 和 api。

## 📐 设计原则

HireFlow 遵循以下核心设计理念，确保系统稳定、安全、可追溯：

### 1️⃣ 删除克制，但不是全表假删
- schema 里没有 `deletedAt`。已经产生应聘记录的候选人、已经有人投递的职位，删除接口会拒绝
- 结束流程用状态：
  - 应聘淘汰 → `REJECTED` + 原因码
  - 候选人拒绝 Offer → 应聘记为 `WITHDRAWN`
  - 职位下线 → `CLOSED`（删除只留给还没有应聘的空职位）
  - 面试 → `CANCELED`
- 还没有应聘的候选人、空的流程阶段、部门、制度文档、未预约的面试官时段可以物理删除
- `ActivityLog` 没有删除接口。候选人详情上的时间轴默认取最近 100 条

### 2️⃣ 权限双保险
```
前端:  hasPermission() → 按钮显隐（体验层）
                ↓
后端:  PermissionsGuard → 请求校验（安全边界）
```
- 独立生效，前端隐藏 ≠ 安全验证
- 任何客户端都需通过后端权限检查
- 菜单和按钮用的本地权限，由 `GET /auth/profile` 刷新（见下方权衡）

### 3️⃣ 数据范围与功能权限正交
- **功能权限**：能不能执行某个操作（如「发送 Offer」）。多角色取权限码并集
- **数据范围**：能看到哪些行。四档由宽到窄是 `ALL` / `DEPARTMENT`（本部门及全部下级）/ `ASSIGNED` / `OWN`。多角色取最宽一档（`widestScope`）
- 令牌只证明身份。每次请求 `loadAccess` 按数据库重算角色、权限和部门子树，不使用令牌里签进去的那份旧快照

### 4️⃣ AI 完全可降级、可解释
- 缺 API key → 自动使用 mock 规则引擎
- 调用失败 → SDK 重试后仍失败则降级 mock，不阻断业务
- `aiMeta.provider` 是 `anthropic:<model>`、`mock`，或缓存命中时的 `<provider>·缓存`
- `aiMeta.degraded` 标记这次是否发生了降级

### 5️⃣ 乐观锁而非悲观锁

**并发控制不是套一个模板，而是逐点选武器。** 全库只有一个 `version` 字段（`Application.version`），因为只有「拖拽看板」这一个场景操作的是 `position` 这种没有状态语义的字段，必须靠版本号。

其余 6 处并发点用的是**状态守卫式 CAS**——把状态的前置条件直接写进 `updateMany` 的 `WHERE`，靠影响行数判定输赢：Offer 审批、Offer 发送、Offer 答复、Offer 懒过期、合同签署、面试官时段占用。

```ts
// Offer 答复：approvalStatus 与 decision 两个维度都不留读写窗口
const result = await prisma.offer.updateMany({
  where: { id: offerId, approvalStatus: 'SENT', decision: null },
  data: {
    decision,
    respondedAt: new Date(),
    decisionReason: decision === 'DECLINED' ? reason : null,
  },
});
if (result.count === 0) throw new ConflictException('该 Offer 刚被答复过，请刷新查看');
```

关键差别在于：**状态机校验和并发控制合并成了一次原子写**，而不是「先 `findUnique` 查出来 `if` 一下，再去 `update`」——后者在读和写之间永远有窗口。而且这个 `WHERE` 同时表达了业务规则本身：`decision: null` 既是并发保护，也是「已答复的 Offer 不能再答复」。

看板拖拽的 409 在前端走 `onMutate` 快照 / `onError` 回滚 / `onSettled` invalidate。409 的提示是「该卡片刚被他人移动，看板已自动刷新」。

## ⚖️ 已知权衡与欠账

写在这里而不是等着被发现。以下都是清楚知道、当前有意接受、并且知道正确做法的取舍：

| 现状 | 代价 | 正确做法 |
|---|---|---|
| **访问令牌 12h，无 refresh、无吊销名单。鉴权本身已改为每请求查库** | 令牌只证明「你是谁」。改权限、改数据范围、停用账号，下一次 API 请求即生效。泄露且账号仍启用的令牌，在剩余有效期内无法单独作废。设置页和 `PermissionsGuard` / `rbac.service` 的注释仍写着「重新登录后生效」，和守卫行为不一致；前端菜单最多滞后一个 profile 缓存周期（60s，回到窗口会重拉） | 短 access token + refresh，或令牌版本号。把设置页和过期注释改成与 `JwtAuthGuard` 一致 |
| **`expectedVersion` 在 DTO 里是可选的** | 客户端不传即退化成无锁——**这是协议性乐观锁，防误操作有效，防恶意无效**；批量移动复用 `moveStage` 但不传版本号，整条路径无锁 | 设为必填，或把 `stageId`（从哪一列来）也钉进 `WHERE`，让「起点」也成为 CAS 条件 |
| **数据范围的 where 在 7 个 service 里手写** | `jobs`、`candidates`、`applications`、`interviews`、`offers`、`onboarding`、`analytics` 各自拼部门 / 指派条件，拒绝文案也不统一。加一档新范围要改这些调用点 | 用 Prisma Client Extension 在 ORM 层统一注入；`data-scope.ts` 对 `DataScope` 做 exhaustive switch，新增枚举值不处理就编译失败 |
| **门户 token 本身没有过期时间** | token 在 URL path 段，会进反代日志、浏览器历史、Referer。Offer 与入职链接可以 `rotate` 作废旧链；预筛和面试选时只在为空时生成，没有轮换入口。Offer 的 `expiresAt` 是 5 个工作日答复期，不是 token 过期 | 给令牌加 `expiresAt`、提交后置空、加限流。预筛 / 选时与 Offer、入职一样支持轮换 |
| **9 个 spec，都在 `apps/api`；乐观锁的 `count === 0` 分支仍无覆盖** | 前端零测试。`offers.service.spec` 把 `updateMany` 固定成 `{ count: 1 }`，Offer 审批 / 发送 / 答复、合同签署、选时占档这些冲突分支没有跑到。`Application.version` 没有 spec | 对每条冲突分支 `mockResolvedValueOnce({ count: 0 })`。漏斗与阶段停留是纯计算，可以喂数据断言 |
| **无 CI、无全局异常过滤器** | Prisma 的 `P2002`/`P2003` 会原样冒成 500，而 schema 里有大量刻意不级联的外键 | `PrismaExceptionFilter` 映射 P2002→409 / P2003→409 / P2025→404；补一条跑 `tsc --noEmit + jest + prettier --check` 的 workflow |
| **`analytics` 模块未使用 `CN_TZ_OFFSET_MS`** | 容器默认 UTC，北京时间 00:00–08:00 创建的应聘会落到上一周 / 上一季度的桶里 | 周/季度分桶统一走 `CN_TZ_OFFSET_MS`，与 Offer 有效期、面试禁跨天、合同签署日三处保持同一口径 |
| **批量移动是串行 N 次全流程** | DTO 上限 100。`runBatch` 对每条串行调用完整的 `moveStage`；失败后再查一次姓名。部分失败不回滚 | 串行是刻意的错误报告模式，可改成分批并发；失败时的姓名应从已有查询结果带出 |
| **撞场检测无时间下界、无 `take`** | 拉出该面试官历史上所有非取消面试再在 JS 里 filter，随职业生涯线性增长 | 加 `scheduledAt: { gte, lte }` 把全表扫变索引范围扫，并给 `Interview` 补对应索引 |

## 📊 功能完成度

| 阶段 | 功能 | 状态 |
|-----|------|------|
| **工程骨架** | Monorepo \| RBAC \| 看板拖拽 \| 操作留痕 | ✅ |
| **一期 MVP** | 职位管理 \| 候选人 360° \| 面试协同 \| 简历导入 | ✅ |
| **二期 AI 增强** | AI 网关 \| JD 生成 \| 简历解析 \| 岗位评分 \| 面评草稿 | ✅ |
| **三期 自动化** | Offer 审批 \| 免登录答复 \| 入职清单 \| 电子合同（mock 签） \| 入职机器人 | ✅ |
| **V5 增强** | 批量操作 \| 人才库唤醒 \| 数据洞察 \| 面试自助选时 \| 评分卡 \| AI 对比 | ✅ |
| **🚧 规划中** | 独立的去偏见筛选产品（现有的是面试官联系方式脱敏，以及评分 prompt 里的忽略人口学信息） \| Offer 到期邮件提醒（通知目前只有站内信） \| 漏斗精确回放 | ⏳ |

## 🔓 免登录门户

候选人和新员工凭 token 直达，无需注册账号。

| 页面 | 路由 | 功能 | 触发时机 |
|------|------|------|---------|
| **Offer 答复** | `/portal/offer/:token` | 查看 Offer、接受/拒绝（拒绝需原因码）、答复截止（5 个工作日，可续期一次） | 发送 Offer 时 |
| **入职资料** | `/portal/onboarding/:token` | 清单进度、证件上传、mock OCR、电子合同签署（mock 电子签，正文由 `contract.ts` 渲染） | Offer 已接受 |
| **面试自助选时** | `/portal/interview/:token` | 在面试官维护的空闲时段中直接预约。这条链接没有截止时间 | 面试已创建且尚未定时间 |
| **预筛问卷** | `/portal/prescreen/:token` | 期望薪资、到岗时间、出差意愿；不符项只通知 HR，不自动淘汰 | 发起预筛时 |

## 📈 性能与实现边界

下面只写仓库里实际有的机制。

### 前端
- **分页**：候选人列表、职位列表每页 20 条
- **查询缓存**：TanStack Query
- **打包**：页面在 `router.tsx` 里静态引入，`vite.config.ts` 没有按路由拆包，也没有「初始包 < 300KB」的预算配置
- **头像**：顶栏和问答用的是图标 / 色块。`image/webp` 出现在简历和证件的上传白名单里

### 后端
- **索引**（`schema.prisma`）：`PipelineStage(jobId)`、`Application(candidateId, jobId)` 唯一与 `(jobId, stageId)`、`InterviewerSlot(userId, startAt)`、`AiCache(capability, hash)` 唯一、`Evaluation(interviewId, interviewerId)` 唯一、`Notification(userId, read)`、`ActivityLog(entityType, entityId)`。`Candidate` 上没有 `created_at` / `department_id` / `status` 索引（后两列也不在这张表上）
- **关联加载**：列表用 Prisma `include`。没有 DataLoader
- **AI 缓存**：`AiCache`，仅 `parseResume` / `scoreMatch`，且只在真实 LLM 启用时写入
- **并发**：看板在客户端传了 `expectedVersion` 时用 `Application.version`；其它冲突点用状态 CAS

### 基础设施
- **静态资源由 Web 镜像里的 nginx 直接提供**，仓库未配置 CDN
- **gzip**：nginx 对自身响应开启了 gzip（`text/css`、`application/javascript`、`application/json`、`image/svg+xml`）。未设置 `gzip_proxied`，反代的 API 响应保持原样。Nest 进程未挂压缩中间件
- **静态资源**：`/assets/` 缓存 30 天、`Cache-Control: public, immutable`
- **连接池**：PGlite 开发必须 `DATABASE_POOL_MAX=1`。不设这个变量时由 `pg` 驱动使用自己的默认池。仓库里没有「开发环境连接池 20」

## 🤝 贡献指南

我们欢迎所有形式的贡献！无论是功能、bug 修复、文档还是翻译。

### 开发流程

1. **Fork & Clone**
   ```bash
   git clone https://github.com/suijiafeng/hireflow-recruitment-platform.git
   cd hireflow-recruitment-platform
   npm install
   ```

2. **创建功能分支**
   ```bash
   git checkout -b feat/your-feature-name
   # 或 fix/issue-number
   ```

3. **提交代码**
   ```bash
   npm run format                # 格式化代码
   git commit -m "feat: add xxx"  # 遵循 Conventional Commits
   git push origin feat/your-feature-name
   ```

4. **提交 Pull Request**
   - 描述改动内容、为什么做这个改动
   - 关联相关的 Issue（如果有）
   - 等待 Code Review

### 代码规范

- **TypeScript**：`apps/api/tsconfig.json` 与 `apps/web/tsconfig.app.json` 都是 `strict: true`（API 关闭了 `strictPropertyInitialization`）
- **命名**：驼峰式（变量/函数）、PascalCase（类/组件）
- **格式化**：运行 `npm run format` 来自动修复（范围是 `{apps,packages}/*/src/**/*.{ts,tsx}`）
- **注释**：仅在 WHY 不明显时添加；WHAT 应由代码自说明

### 测试要求

**当前状态（如实说明）**：`apps/api` 下有 9 个 `*.spec.ts`，前端没有测试，仓库没有 CI。已有用例覆盖健康检查、数据范围纯函数、权限守卫、脱敏、门户工作日计算、生产环境 `JWT_SECRET` 自检、登录限流、mock 面评草稿、Offer 状态机的合法/非法迁移。乐观锁和 `updateMany` 影响 0 行的分支没有覆盖——见 [已知权衡](#️-已知权衡与欠账)。

跑测试（根目录没有 `test` 脚本，要指定 workspace）：

```bash
npm run test -w apps/api        # Jest，匹配 apps/api/src/**/*.spec.ts
npm run lint  -w apps/web       # oxlint
```

提 PR 时：

- 改动 `apps/api/src/common/` 下的纯函数（`data-scope` / `mask` / `portal`），请补对应的表驱动测试
- 改动涉及 `updateMany + count === 0` 的并发分支，请至少补一个 `mockResolvedValueOnce({ count: 0 })` 的用例

### 报告 Bug

如发现 bug，请通过 [Issues](https://github.com/suijiafeng/hireflow-recruitment-platform/issues) 报告，包含：
- 复现步骤
- 预期行为 vs 实际行为
- 环境信息（Node 版本、浏览器等）
- 错误日志（如有）

## 📚 文档与资源

| 资源 | 链接 |
|-----|------|
| **API 文档** | http://localhost:3000/api/docs （Swagger，生产默认关闭） |
| **数据库 Schema** | [prisma/schema.prisma](apps/api/prisma/schema.prisma) |
| **环境变量** | [apps/api/.env.example](apps/api/.env.example) |
| **部署配置** | [render.yaml](render.yaml) |
| **走查记录** | [docs/](docs/)（角色、数据流、界面、分支） |

## ❓ 常见问题

### Q: 为什么需要配置 AI API key？
A: JD 生成、简历解析等会调用 Anthropic API。不配置也能用，网关会改走 mock 规则引擎（`aiMeta.provider` 为 `mock`）。

### Q: MinIO 存储的文件怎么备份？
A: 开发期的 MinIO 与 S3 兼容。生产环境建议换云对象存储（AWS S3 / Cloudflare R2），只改 `S3_*` 环境变量。

### Q: 如何在生产环境中部署？
A: 参考 [render.yaml](render.yaml)，或使用 `Dockerfile` / `Dockerfile.api` 部署到支持容器的平台。数据库和对象存储要单独准备。`docker compose up` 只起本地的 Postgres 和 MinIO。

### Q: 简历解析支持哪些格式？
A: 上传白名单是 PDF、Word（`.doc` / `.docx`）、纯文本、JPEG / PNG / WebP。文字抽取只实现了 PDF 和纯文本（含 `.txt` / `.md`）；Word 和图片会留档，`rawText` 为空，后续 AI 解析没有正文可用。

### Q: 如何修改招聘流程阶段？
A: 阶段挂在**职位**上，不挂在部门上。新建职位时写入默认六段：简历初筛、一面、二面、Offer、待入职、已入职（`DEFAULT_PIPELINE_STAGES`）。后端有 `GET/PUT /api/jobs/:id/stages`（权限 `job:stages:manage`）。当前 Web 没有编辑阶段的页面；「设置 → 部门管理」只管理部门树。

### Q: 权限体系如何工作？
A: 预置 7 个角色：系统管理员、HR、用人经理、面试官、IT / 行政，以及门户用的候选人、新员工。功能权限是该用户全部角色的并集；数据范围取最宽的一档。设置页可以改非管理员角色的权限矩阵并导出 CSV。API 每次请求按数据库重算，不必等令牌过期；设置页上「需重新登录生效」的文案还没改过来。

---
> **声明**：本仓库为个人项目，仅供学习交流。
