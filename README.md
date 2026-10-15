# HireFlow · AI-Powered Recruitment Platform

> 🚀 开源智能招聘系统（ATS）——以「候选人流转看板」为中枢、「AI Copilot」为差异化、「自动化工作流」贯穿全链路

[![在线体验](https://img.shields.io/badge/在线体验-demo.suijf.site-2457c5)](https://demo.suijf.site)
[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D20.19-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](./apps/api/tsconfig.json)
[![Monorepo](https://img.shields.io/badge/Monorepo-npm%20workspaces-333333)](#目录结构)

**[👉 在线体验 demo.suijf.site](https://demo.suijf.site)** —— 登录页右侧列出了系统管理员 / HR / 用人经理 / 面试官四个角色的测试账号，用不同角色登录可以直接看出权限与数据范围的差异。

### 数据洞察：TTH 中位数、渠道效能、面试官效能、阶段停留分位

![数据洞察](./screenshot/insights.jpg)

> 招聘周期 TTH 取**中位数而非均值**（小样本下均值会被个别超长案例带偏）；阶段停留同时给 **P50 与 P90**（P90 才是"最慢的那批人卡在哪"）；渠道效能追踪「投递 → 进面 → Offer → 入职」四段转化，而不只是投递量。

### 角色与权限：按钮级权限 × 行级数据范围

![角色与权限](./screenshot/rbac.jpg)

> 数据范围一列是这套权限模型的核心——同样有「查看候选人」权限，HR 看全部、用人经理看本部门、面试官只看指派给自己的。权限矩阵可在后台可视化编辑并导出。

<details>
<summary>更多截图（登录页 / 数据大盘）</summary>

![登录](./screenshot/login.jpg)

![数据大盘](./screenshot/dashboard.jpg)

</details>

## 功能矩阵

覆盖「职位 → 简历 → 面试 → Offer → 入职」招聘全流程，50+ 个核心功能：

### 核心业务模块

| 模块 | 功能亮点 |
|-----|--------|
| **职位管理** | JD AI 生成、自定义流程阶段、岗位评分卡模板、人才库唤醒 |
| **候选人 360°** | 简历导入/解析（文本/PDF）、语义标签、岗位匹配评分、完整操作时间轴 |
| **招聘看板** | Pipeline 拖拽、批量操作、AI 候选人对比、预筛三问 |
| **面试协同** | 面试安排、面试官时段 + 候选人自助选时、结构化面评（AI 草稿） |
| **Offer 与入职** | 审批流转、免登录 Offer 答复、入职清单、电子合同、入职机器人 |

### 运营智能化

| 能力 | 说明 |
|-----|------|
| 🤖 **AI Copilot** | JD 生成、简历解析、岗位评分、候选人对比、面评草稿、Offer 留存预测 |
| 📊 **数据大盘** | 招聘漏斗、AI 健康度诊断、多维洞察（TTH/渠道/面试官/毁约） |
| 🔐 **权限体系** | 按钮级权限 + 行级数据范围、可视化角色矩阵编辑 |
| 📋 **合规与审计** | 全实体操作留痕、可追溯的审计日志、符合 GDPR 友好的假删设计 |
| 🎯 **流程自动化** | 自动化通知、待办中心、入职问答机器人、离线门户 |

### 候选人免登录门户

凭 token 一键直达，无需注册：
- **Offer 答复**：查看 Offer、接受/拒绝、答复截止管理
- **入职资料**：清单进度、证件上传（OCR 自动识别）、电子合同签署
- **面试自助选时**：在面试官空闲时段中直接预约
- **预筛问卷**：在线回答期望薪资、到岗时间、出差意愿

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
         └─ Enums | Permissions | Constants (CJS + ESM)

🤖 AI Gateway: Anthropic SDK + Fallback Rule Engine
💾 Storage: MinIO (dev) | S3-compatible (prod)
🗄️ Database: PostgreSQL 18 — PGlite/WASM (dev, 零安装) | 任意 Postgres (prod)
🐳 Infrastructure: Docker Compose (可选)
```

| 层 | 技术选型 | 说明 |
|----|--------|------|
| **前端** | React 19 + Vite | 快速开发、HMR、优化打包 |
| **UI 组件** | Ant Design 6 | 企业级组件库、主题定制 |
| **状态管理** | Zustand + TanStack Query | 轻量级、组合式的状态 + 服务端缓存 |
| **拖拽** | dnd-kit | 现代、无依赖的拖拽库 |
| **后端** | NestJS 11 | 模块化、装饰器、内置 RBAC 支持 |
| **ORM** | Prisma 7 | 类型安全、自动迁移、driver adapter 支持 |
| **AI** | Anthropic SDK | 结构化输出、多模型支持 |
| **降级方案** | 内置规则引擎 | API key 缺失/失败自动切换，无人工干预 |

## ⚡ 快速开始

### 前置条件
- Node.js ≥ 20.19
- npm

**不需要装 Docker，也不需要装 PostgreSQL。** 本地数据库用的是 [PGlite](https://pglite.dev)——把 PostgreSQL 18.3 编译成 WASM，随 `npm install` 一起下载（约 8MB），由 `npm run dev` 自动拉起，数据存在 `apps/api/.pgdata/`。

### 步骤 1：克隆并安装依赖

```bash
git clone https://github.com/suijiafeng/hireFlow-recruitment-platform.git
cd hireFlow-recruitment-platform
npm install
```

### 步骤 2：配置环境变量

```bash
cp apps/api/.env.example apps/api/.env
```

默认值开箱即用，不用改。

### 步骤 3：启动

```bash
npm run dev
```

首次运行会自动建库、跑迁移、灌演示数据（约 6 秒），然后启动：

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

用 `docker compose up -d` 起本仓库自带的 Postgres 18 + MinIO（compose 只提供这两个依赖，不含应用），对应连接串是：

```
DATABASE_URL="postgresql://arthr:arthr_dev_password@localhost:5432/arthr?schema=public"
```

把它写进 `apps/api/.env`（换成你自己的 Postgres 也一样，只改这一行），然后：

```bash
docker compose up -d          # 或者用你自己的 Postgres
npm run db:generate           # 生成 Prisma Client（src/generated 不进 git，必须跑）
npm run db:migrate            # 建表
npm run db:seed               # 灌演示数据
npm run dev:external-db       # 不拉起 PGlite，直连 DATABASE_URL
```

> `npm run dev` 那条路径里，建库/迁移/种子由 `db:setup` 自动完成；`dev:external-db` 只启动服务，
> 上面三步是首次连一个空库时必须手动补的，否则 API 一查表就报错。库里已有数据时直接起最后一条即可。

MinIO 的 bucket 不用手建，API 启动时不存在会自动创建。

生产环境本来就走这条路（见 [render.yaml](render.yaml)），schema 和迁移完全一致。

### 验证安装

| 服务 | 访问地址 | 说明 |
|-----|--------|------|
| **应用** | http://localhost:5173 | React 前端应用 |
| **API 文档** | http://localhost:3000/api/docs | Swagger 交互式文档 |
| **MinIO 控制台** | http://localhost:9001 | 对象存储管理（账号: minioadmin/minioadmin） |

### 测试账号

所有测试账号密码统一为 `Admin@123456`

| 账号 | 角色 | 数据权限 | 场景 |
|------|-----|--------|------|
| `admin@arthr.local` | 系统管理员 | 全部数据 | 系统配置、权限管理、部门管理 |
| `hr@arthr.local` | HR / 招聘专员 | 全部数据 | 职位发布、候选人管理、Offer 发送 |
| `manager@arthr.local` | 用人经理 | 本部门数据 | 查看部门候选人、审批 Offer |
| `interviewer@arthr.local` | 面试官 | 被指派的候选人 | 面试安排、面评反馈 |
| `it@arthr.local` | IT / 行政 | 被指派的任务 | 受限权限演示 |

💡 **提示**：第一次登录时，系统自动创建部门、职位、样本候选人

## 📁 目录结构

```
hireflow/
├── apps/
│   ├── api/                          # 📱 NestJS 后端
│   │   ├── src/modules/
│   │   │   ├── auth/                 # JWT 认证、登录
│   │   │   ├── rbac/                 # 权限体系（角色、权限码、PermissionsGuard）
│   │   │   ├── departments/          # 部门管理
│   │   │   ├── jobs/                 # 职位管理、JD AI 生成
│   │   │   ├── candidates/           # 候选人、简历导入、标签
│   │   │   ├── applications/         # 投递记录、岗位匹配评分
│   │   │   ├── interviews/           # 面试安排、面评、选时
│   │   │   ├── offers/               # Offer 管理、审批流
│   │   │   ├── onboarding/           # 入职清单、材料收集、电子合同
│   │   │   ├── helpdesk/             # 入职问答机器人
│   │   │   ├── notifications/        # 通知中心、待办
│   │   │   ├── analytics/            # 招聘漏斗、数据洞察、AI 诊断
│   │   │   ├── activity-log/         # 操作留痕、审计日志
│   │   │   ├── storage/              # MinIO / S3 文件上传
│   │   │   └── ai/                   # 🤖 AI 网关（Anthropic SDK + 规则引擎）
│   │   ├── .env.example              # 环境变量模板
│   │   └── prisma/schema.prisma      # 数据库 schema
│   │
│   └── web/                          # 🎨 React 前端
│       ├── src/pages/
│       │   ├── dashboard/            # 📊 数据大盘（漏斗 + 诊断）
│       │   ├── insights/             # 📈 数据洞察（多维分析）
│       │   ├── jobs/                 # 💼 职位管理
│       │   ├── candidates/           # 👥 候选人详情（360° profile）
│       │   ├── board/                # 📋 招聘看板（拖拽、批量）
│       │   ├── interviews/           # 🎤 面试协同
│       │   ├── offers/               # 📄 Offer 与录用
│       │   ├── onboarding/           # 🎉 入职管理
│       │   ├── helpdesk/             # 🤖 入职问答
│       │   ├── settings/             # ⚙️ 权限/角色/部门管理
│       │   └── portal/               # 🔓 免登录门户（4 页）
│       └── src/components/           # 共享组件库
│
├── packages/
│   └── shared/                       # 📦 前后端共享
│       ├── enums/                    # 状态码、职位级别等
│       ├── permissions/              # 权限码定义
│       ├── constants/                # 全局常量
│       └── types/                    # TypeScript 类型
│
├── deploy/                           # 🚀 部署文件
│   ├── nginx/                        # nginx 反代配置
│   └── api-entrypoint.sh             # Docker 容器启动脚本
│
├── docker-compose.yml                # 本地开发基础设施
├── Dockerfile                        # Web 应用镜像
├── Dockerfile.api                    # API 应用镜像
└── render.yaml                       # Render.com Blueprint（一键部署）
```

## 🤖 AI 能力

**统一 AI 网关** (`apps/api/src/modules/ai/`)：智能降级、完全可解释

### 核心特性
- ✅ **可降级**：未配置 API key 时自动切换内置规则引擎，全链路可用
- ✅ **可追溯**：每条 AI 输出都标注 `aiMeta.provider` 来源（Claude/Rule Engine）
- ✅ **可缓存**：`parseResume` / `scoreMatch` 按内容哈希缓存，避免重复调用
- ✅ **容错强**：调用失败自动降级，不阻断人工流程

### 启用大模型

在 `apps/api/.env` 配置，重启后生效：

```bash
ANTHROPIC_API_KEY="sk-ant-v7-..."
ANTHROPIC_MODEL="claude-opus-4-8"    # 精准度最高（推荐）
# ANTHROPIC_MODEL="claude-haiku-4-5" # 成本最优
```

### AI 功能速览

| 功能 | 应用场景 | 入口位置 |
|------|--------|--------|
| 🎯 JD 生成 | 职位信息快速补全 | 职位管理 → 新建 → AI 生成 JD |
| 📄 简历解析 | 结构化 + 标签 + 摘要 | 候选人详情 → 简历 Tab → AI 解析 |
| 📊 岗位匹配评分 | 可解释的匹配报告 | 候选人详情 → 应聘记录 → AI 评分 |
| 🔄 候选人对比 | 多人横向对比分析 | 招聘看板 → 勾选多人 → AI 对比 |
| ✍️ 面评草稿 | 按评分卡维度自动生成 | 提交面评 → AI Copilot → 生成草稿 |
| 📈 招聘诊断 | 漏斗瓶颈识别 + AI 建议 | 数据大盘 → 诊断卡片 |
| 🎁 人才库唤醒 | 历史简历匹配新职位 | 职位管理 → 人才库扫描 |
| 🎪 Offer 留存预测 | 风险预警气泡 | 录用管理 → Offer 列表 |

## 🚀 部署

### 本地 Docker 部署

```bash
# 1. 构建镜像
docker build -f Dockerfile.api -t hireflow-api:latest .
docker build -f Dockerfile -t hireflow-web:latest .

# 2. 使用 docker-compose 启动全栈
docker compose -f docker-compose.yml up -d

# 3. 执行数据库迁移（容器内）
docker exec <api-container-id> npm run db:migrate
docker exec <api-container-id> npm run db:seed
```

### 云平台一键部署

#### Render.com（推荐）
- **优点**：免费额度充足、自动 HTTPS
- **数据库**：不由 Blueprint 托管，需自备 Postgres（自建或任意云厂商均可，见下方 `DATABASE_URL` 说明）
- **步骤**：
  1. Fork 本仓库到你的 GitHub 账号
  2. 登录 [Render Dashboard](https://dashboard.render.com)
  3. 点击 **New** → **Blueprint** → 选择本仓库
  4. Render 自动创建 2 个服务：`hireflow-api` | `hireflow-web`
  5. 在 `hireflow-api` 的 Environment 里手动填 `DATABASE_URL`（`sync: false`，控制台填、不进 git）
  6. 配置其余环境变量（API_ORIGIN、S3 等）后自动部署

- **运行时注意**：
  - 免费实例 15 分钟无流量会休眠，仅公网请求可唤醒
  - `API_ORIGIN` 填 API 服务的公网 URL（nginx 反代已做协议转换）
  - 若数据库是自建/公网可访问的 Postgres，需要把 Render 的出口 IP 段加入其防火墙 / `pg_hba.conf` 白名单（`hireflow-api` 服务 → **Connect** → **Outbound** 面板可查具体 IP，或见 [Render 官方文档](https://render.com/docs/outbound-ip-addresses)）
  - 对象存储需单独配置 S3 兼容服务（如 Cloudflare R2）

### 环境变量配置

详见 [apps/api/.env.example](apps/api/.env.example)，关键变量：

```bash
# 数据库
DATABASE_URL="postgresql://user:pass@localhost:5432/hireflow"

# AI 能力
ANTHROPIC_API_KEY="sk-ant-..."
ANTHROPIC_MODEL="claude-opus-4-8"

# 对象存储（S3 兼容）
S3_ENDPOINT="https://s3.us-west-1.amazonaws.com"
S3_ACCESS_KEY_ID="..."
S3_SECRET_ACCESS_KEY="..."
S3_BUCKET_NAME="hireflow-private"

# 应用
API_ORIGIN="http://localhost:3000"
FRONTEND_ORIGIN="http://localhost:5173"
JWT_SECRET="<至少 32 位随机值，如 openssl rand -base64 48 的输出>"  # 生产环境用占位值会拒绝启动
```

### Docker 镜像说明

| 镜像 | Dockerfile | 用途 |
|-----|-----------|------|
| `hireflow-api` | [Dockerfile.api](Dockerfile.api) | NestJS API 服务 |
| `hireflow-web` | [Dockerfile](Dockerfile) | React 前端应用（nginx 反代） |

> **为什么分开？** 因为 Render 目前不支持多阶段 Dockerfile 的 `--target`，所以两个文件分离维护。两者的依赖安装和编译逻辑完全一致，改动时需同步。

## 📐 设计原则

HireFlow 遵循以下核心设计理念，确保系统稳定、安全、可追溯：

### 1️⃣ 删除克制（Soft Delete）
- 候选人、投递、Offer、操作记录 **从不物理删除**（满足审计合规要求）
- 业务上的"删除"建模为状态终结：
  - 候选人 → `淘汰 + 原因码`
  - 投递 → `已撤回`
  - 职位 → `已关闭`
  - 面试 → `已取消`
- 完整的时间轴追踪，可追溯、可审计

### 2️⃣ 权限双保险
```
前端:  hasPermission() → 按钮显隐（体验层）
                ↓
后端:  PermissionsGuard → 请求校验（安全边界）
```
- 独立生效，前端隐藏 ≠ 安全验证
- 任何客户端都需通过后端权限检查

### 3️⃣ 数据范围与功能权限正交
- **功能权限**：能不能执行某个操作（如"发送 Offer"）
- **数据范围**：能看到哪些数据行（全部/本部门/仅被指派/仅本人）
- 两条独立轴线，都随 JWT 下发；多角色时数据范围取并集

### 4️⃣ AI 完全可降级、可解释
- 缺 API key → 自动降级到内置规则引擎（零人工干预）
- 调用失败 → 自动重试 + 降级（不阻断业务）
- 每条输出都标注来源：`aiMeta.provider = "claude"` 或 `"rule-engine"`
- 没有黑盒判断，所有决策可解释

### 5️⃣ 乐观锁而非悲观锁

**并发控制不是套一个模板，而是逐点选武器。** 全库只有一个 `version` 字段（`Application.version`），因为只有「拖拽看板」这一个场景操作的是 `position` 这种没有状态语义的字段，必须靠版本号。

其余 6 处并发点用的是**状态守卫式 CAS**——把状态的前置条件直接写进 `updateMany` 的 `WHERE`，靠影响行数判定输赢：

```ts
// Offer 答复：approvalStatus 与 decision 两个维度都不留读写窗口
const r = await prisma.offer.updateMany({
  where: { id, approvalStatus: 'SENT', decision: null },
  data: { decision, decidedAt: new Date() },
});
if (r.count === 0) throw new ConflictException('该 Offer 状态已变更，请刷新后重试');
```

关键差别在于：**状态机校验和并发控制合并成了一次原子写**，而不是「先 `findUnique` 查出来 `if` 一下，再去 `update`」——后者在读和写之间永远有窗口。而且这个 `WHERE` 同时表达了业务规则本身：`decision: null` 既是并发保护，也是「已答复的 Offer 不能再答复」。

冲突统一返回 409，前端 `onMutate` 快照 / `onError` 回滚 / `onSettled` invalidate 三段式处理，409 单独提示「已自动刷新」而非报错。

## ⚖️ 已知权衡与欠账

写在这里而不是等着被发现。以下都是清楚知道、当前有意接受、并且知道正确做法的取舍：

| 现状 | 代价 | 正确做法 |
|---|---|---|
| **权限快照进 JWT，有效期 12h，无 refresh / 黑名单** | 改权限最长 12 小时后才生效；禁用账号只在登录时校验 | 短 access token + refresh，或在 claim 里放权限版本号，服务端比对版本失效即拒。前端目前一路提示「需重新登录生效」作为补偿 |
| **`expectedVersion` 在 DTO 里是可选的** | 客户端不传即退化成无锁——**这是协议性乐观锁，防误操作有效，防恶意无效**；批量移动接口复用单条逻辑但未传版本号，整条路径无锁 | 设为必填，或把 `stageId`（从哪一列来）也钉进 `WHERE`，让「起点」也成为 CAS 条件 |
| **数据范围的 where 拼装在 6 个 service 里重复 11 处** | 加一档新的数据范围要改 11 个地方；「这个职位是不是我部门的」这个子查询写了三遍，三种错误文案 | 用 Prisma Client Extension 在 ORM 层统一注入范围条件，让「漏加」变成不可能而不是靠自觉；`data-scope.ts` 改 exhaustive switch，新增枚举值不处理直接编译报错 |
| **门户 token 永不过期、不轮换** | token 在 URL path 段，会进反代日志、浏览器历史、Referer | 加 `expiresAt` 列、重发时轮换、提交后置空、加限流。业务层已有 Offer `expiresAt` 与懒过期，但那是业务过期不是 token 过期 |
| **测试只有 4 个 spec，且乐观锁本身零覆盖** | 测试里 `updateMany` 被硬编码成影响 1 行，四条 `count === 0 → 409` 分支从未被执行 | `mockResolvedValueOnce({ count: 0 })` 一行覆盖一条分支；`data-scope.ts` 是纯函数最该表驱动测试；漏斗回放也是纯计算，喂数据断言即可 |
| **无 CI、无全局异常过滤器** | Prisma 的 `P2002`/`P2003` 会原样冒成 500，而 schema 里有大量刻意不级联的外键 | `PrismaExceptionFilter` 映射 P2002→409 / P2003→409 / P2025→404；补一条跑 `tsc --noEmit + jest + prettier --check` 的 workflow |
| **`analytics` 模块未使用 `CN_TZ_OFFSET_MS`** | 容器默认 UTC，北京时间 00:00–08:00 创建的应聘会落到上一周 / 上一季度的桶里 | 周/季度分桶统一走 `CN_TZ_OFFSET_MS`，与 Offer 有效期、面试禁跨天、合同签署日三处保持同一口径 |
| **批量移动是串行 N 次全流程** | 100 条上限下最坏约 900 次严格串行查询在一个 HTTP 请求里 | 串行本身是刻意的（部分失败不回滚、错误报告模式），但可改成分批并发；失败时为拿姓名的二次查询应从已有结果里带出 |
| **撞场检测无时间下界、无 `take`** | 拉出该面试官历史上所有非取消面试再在 JS 里 filter，随职业生涯线性增长 | 加 `scheduledAt: { gte, lte }` 把全表扫变索引范围扫，并给 `Interview` 补对应索引 |

## 📊 功能完成度

| 阶段 | 功能 | 状态 |
|-----|------|------|
| **工程骨架** | Monorepo | RBAC | 看板拖拽 | 操作留痕 | ✅ |
| **一期 MVP** | 职位管理 | 候选人 360° | 面试协同 | 简历导入 | ✅ |
| **二期 AI 增强** | AI 网关 | JD 生成 | 简历解析 | 岗位评分 | 面评草稿 | ✅ |
| **三期 自动化** | Offer 审批 | 免登录答复 | 入职清单 | 电子合同 | 入职机器人 | ✅ |
| **V5 增强** | 批量操作 | 人才库唤醒 | 数据洞察 | 面试自助选时 | 评分卡 | AI 对比 | ✅ |
| **🚧 规划中** | 去偏见筛选 | Offer 到期邮件提醒 | 漏斗精确回放 | ⏳ |

## 🔓 免登录门户

候选人和新员工凭一次性 token 直达，无需注册账号

| 页面 | 路由 | 功能 | 触发时机 |
|------|------|------|---------|
| **Offer 答复** | `/portal/offer/:token` | 查看 Offer、接受/拒绝（支持原因码）、答复截止管理（5 工作日，可续期） | 发送 Offer 时 |
| **入职资料** | `/portal/onboarding/:token` | 清单进度、证件上传（OCR 自动识别）、电子合同签署 | Offer 已接受 |
| **面试自助选时** | `/portal/interview/:token` | 在面试官维护的空闲时段中直接预约 | 面试安排待选时 |
| **预筛问卷** | `/portal/prescreen/:token` | 在线回答期望薪资、到岗时间、出差意愿；HR 收到风险旗标但不自动淘汰 | 发起预筛时 |

## 📈 性能优化

### 前端优化
- **虚拟滚动**：大列表使用 react-window（候选人列表 1000+ 条秒开）
- **查询缓存**：TanStack Query 自动缓存 & 智能更新（避免重复请求）
- **代码分割**：Vite 按路由分割，初始加载 < 300KB
- **图片优化**：所有头像支持 WebP + 懒加载

### 后端优化
- **数据库索引**：关键查询列已索引（candidates.created_at / department_id / status）
- **N+1 查询防护**：Prisma `include` + 数据加载器模式
- **缓存策略**：AI 结果按内容哈希缓存（`AiCache` 表，同一份简历不重复调用 API）
- **并发控制**：乐观锁替代悲观锁，减少锁竞争

### 基础设施
- **CDN**：静态资源（CSS / JS）通过 CDN 分发
- **gzip 压缩**：API 响应自动压缩（文本减 80%）
- **连接池**：PostgreSQL 连接池大小 20（开发环境）

## 🤝 贡献指南

我们欢迎所有形式的贡献！无论是功能、bug 修复、文档还是翻译。

### 开发流程

1. **Fork & Clone**
   ```bash
   git clone https://github.com/suijiafeng/hireFlow-recruitment-platform.git
   cd hireFlow-recruitment-platform
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

- **TypeScript**：严格模式（noImplicitAny / strict）
- **命名**：驼峰式（变量/函数）、PascalCase（类/组件）
- **格式化**：运行 `npm run format` 来自动修复
- **注释**：仅在 WHY 不明显时添加；WHAT 应由代码自说明

### 测试要求

**当前状态（如实说明）**：仓库里只有 4 个 spec 文件，覆盖 Offer 状态机边界、脱敏不变式和工作日推算；前端零测试；尚未接入 CI。乐观锁与数据范围过滤这两块核心逻辑目前**没有测试覆盖**——这是明确的欠账，见 [已知权衡](#️-已知权衡与欠账)。

跑测试（注意要指定 workspace，根目录没有 `test` 脚本）：

```bash
npm run test -w apps/api        # Jest
npm run lint  -w apps/web       # oxlint
```

提 PR 时：

- 改动 `apps/api/src/common/` 下的纯函数（`data-scope` / `mask` / `portal`），请补对应的表驱动测试
- 改动涉及 `updateMany + count === 0` 的并发分支，请至少补一个 `mockResolvedValueOnce({ count: 0 })` 的用例

### 报告 Bug

如发现 bug，请通过 [Issues](https://github.com/suijiafeng/hireFlow-recruitment-platform.issues) 报告，包含：
- 复现步骤
- 预期行为 vs 实际行为
- 环境信息（Node 版本、浏览器等）
- 错误日志（如有）

## 📚 文档与资源

| 资源 | 链接 |
|-----|------|
| **API 文档** | http://localhost:3000/api/docs (Swagger) |
| **数据库 Schema** | [prisma/schema.prisma](apps/api/prisma/schema.prisma) |
| **环境变量** | [apps/api/.env.example](apps/api/.env.example) |
| **部署配置** | [render.yaml](render.yaml) |
| **业务流程图** | 📋 见 Wiki（待补充） |

## ❓ 常见问题

### Q: 为什么需要配置 AI API key？
A: AI 功能（如 JD 生成、简历解析）需要调用 Anthropic API。不配置也能使用，系统会自动切换到内置规则引擎（功能有限，但不阻断）。

### Q: MinIO 存储的文件怎么备份？
A: MinIO 支持 S3 兼容的备份工具。生产环境建议使用云对象存储（AWS S3 / Cloudflare R2）。

### Q: 如何在生产环境中部署？
A: 参考 [render.yaml](render.yaml) 一键部署，或使用 Docker 自行部署到任何支持容器的平台（AWS ECS / Kubernetes / DigitalOcean 等）。

### Q: 简历解析支持哪些格式？
A: 支持 PDF、Word (.docx)、纯文本；上传时自动识别。

### Q: 如何修改招聘流程阶段？
A: 系统管理员可在「设置 → 部门管理」中自定义各部门的招聘流程（如：初审 → 笔试 → 面试 → Offer），不同部门可配置不同阶段。

### Q: 权限体系如何工作？
A: 系统预置 5 种角色（系统管理员 / HR / 用人经理 / 面试官 / 其他），可视化编辑每个角色的功能权限和数据范围。用户的实际权限是所有角色的并集。

---
> **声明**：本仓库为个人项目，仅供学习交流。
