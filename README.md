# HireFlow

把职位、候选人、面试、Offer 和入职放在同一条流程里的全栈招聘系统。界面里的产品名是 **ART 智能招聘**。

[![CI](https://github.com/suijiafeng/hireflow-recruitment-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/suijiafeng/hireflow-recruitment-platform/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.19-339933)](./package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

HireFlow is a full-stack applicant tracking app: a pipeline board in the middle, role-based access around it, and an AI gateway that falls back to a built-in rules engine when no model key is set.

公开演示站：[demo.suijf.site](https://demo.suijf.site)。下面的截图和账号说明都来自本仓库 `develop` 上 `npm run dev` 拉起的本地种子数据，不是演示站的实时画面。

## 界面

管理员登录后的首页是数据大盘。下面这张图选中了种子数据里的「高级前端工程师」；没有配置 Anthropic key，诊断卡片标注的是规则引擎。

![数据大盘：招聘漏斗、投递趋势和规则引擎诊断](./docs/screenshots/dashboard.webp)

### 招聘

![职位管理：在招、待审批和编制进度](./docs/screenshots/jobs.webp)

职位列表带状态、编制进度和在流程人数。新建职位会带上默认六段流程：简历初筛、一面、二面、Offer、待入职、已入职。阶段可以按职位改。

![候选人列表和详情抽屉](./docs/screenshots/candidates.webp)

候选人页打开右侧抽屉，而不是跳到单独的详情路由。抽屉里是应聘记录、面评、时间轴，以及安排下一轮、AI 评分、发起 Offer。

![招聘看板](./docs/screenshots/pipeline.webp)

看板按当前职位分列。卡片可以拖到下一阶段；勾选之后可以批量移动、淘汰，或做 AI 对比。

![面试管理：场次、面评和可约时段](./docs/screenshots/interviews.webp)

左侧是面试场次和面评结论，右侧是面试官自己的可约时段。候选人可以用免登录链接在这些空档里选时间。

### 录用与入职

![录用管理：审批、发送和候选人答复](./docs/screenshots/offers.webp)

Offer 按审批和答复状态分组。没有 `salary:view` 的角色看不到薪资。候选人链接不会出现在列表里，要点「通知」才会单独取回。

![入职办理：三方清单和待核对材料](./docs/screenshots/onboarding.webp)

接受 Offer 之后生成入职单。清单按 HR、IT、新员工拆开；材料识别失败时标成待人工核对，不自动勾掉。

![数据洞察：渠道、面试官、阶段停留和 TTH](./docs/screenshots/insights.webp)

洞察页把范围放在「全部」时，能看到渠道漏斗、面试官通过率相对基线的偏离、阶段停留的 P50 / P90，以及按职位的招聘周期中位数。默认打开是「本季度」。

![入职问答：按制度文档回答并标出处](./docs/screenshots/helpdesk.webp)

入职问答对着公司制度文档回答，并标出出处。没配模型 key 时走规则引擎，回答里会说明这一点。

### 手机

Offer 门户不需要登录。下面左图是 375px 宽的整页（内容比一屏略高，所以把答复按钮也收了进来）。右图是同一套后台在 375×812 下的数据大盘：侧栏收成菜单按钮，指标改成两列。

<p>
  <img alt="候选人 Offer 门户" src="./docs/screenshots/portal-offer.webp" width="375" />
  <img alt="手机宽度下的数据大盘" src="./docs/screenshots/dashboard-mobile.webp" width="375" />
</p>

### 同一个地址，两种首页

登录后去菜单里第一个有权限的页面，不固定跳到数据大盘。

管理员有 `dashboard:view`，所以落在上面那张数据大盘，侧栏是全部菜单。面试官只有查看候选人和提交 / 查看面评的权限，首页是候选人，侧栏只剩候选人、面试管理和入职问答。联系方式被打码，列表也只剩指派给自己的人。种子数据里，管理员看到 122 人，这个面试官看到 11 人。

![面试官登录后的候选人列表](./docs/screenshots/landing-interviewer.webp)

IT / 行政只有入职查看权限，首页会落到入职管理。入职问答不设权限，每个登录用户都能打开。

## 功能

**职位和流转。** 职位有草稿、待审批、在招、暂停、关闭。看板拖拽会带上当前卡片的版本号做乐观锁；客户端没传版本号时，这一次移动不做版本检查。预筛有单独的免登录问卷。

**候选人和简历。** 支持粘贴文本，以及上传 PDF、纯文本、Markdown 后抽取正文。其他格式只留档、不抽字。面试官看简历正文时电话和邮箱会打码，也打不开原件。

**面试和 Offer。** 面评可以先让 AI 出草稿，再由面试官改完提交。Offer 走审批、驳回、发送、候选人接受或拒绝。发送后的答复期是 5 个工作日，可以续期一次。接受之后才进入入职。

**入职。** 清单、证件材料和劳动合同分三块。生产环境里，后台代签默认关掉，合同要新员工自己在门户签；需要补录纸质合同时才打开 `ESIGN_STAFF_SIGN`。

**AI。** 网关统一包了 JD 生成、简历解析、岗位匹配、面评草稿、候选人对比、漏斗诊断、入职问答和 Offer 留存预测。`AI_PROVIDER=auto` 且没有 `ANTHROPIC_API_KEY` 时用内置规则引擎。模型调用失败会降级到同一套规则引擎。`parseResume` 和 `scoreMatch` 只在真正走到模型时按内容哈希缓存。

**权限。** 功能权限和数据范围是两条轴。范围有全部、本部门（含下级部门）、仅被指派、仅本人；一个人挂多个角色时取最宽的范围。按钮隐藏只影响界面，接口另有守卫。每次请求都会按数据库里的当前角色和账号状态重算权限，停用和改权限不用等令牌过期。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 19、Vite 8、React Router 8、Ant Design 6、TanStack Query、Zustand、dnd-kit |
| 后端 | NestJS 11、Prisma 7、JWT |
| 数据库 | 本地 [PGlite](https://pglite.dev)（PostgreSQL 18 的 WASM 构建，数据在 `apps/api/.pgdata/`）；也可以换任意 Postgres |
| 文件 | S3 兼容存储。本地用 docker compose 里的 MinIO；不启动时上传接口返回 503，其余功能继续可用 |
| AI | Anthropic SDK，或内置规则引擎 |
| 共享包 | `packages/shared` 同时产出 CJS 和 ESM，放枚举、权限码和常量 |
| 仓库 | npm workspaces。Node.js `>=20.19` |

```mermaid
flowchart LR
  web["浏览器<br/>apps/web"]
  api["NestJS API<br/>/api"]
  db["Postgres<br/>PGlite 或外部库"]
  s3["S3 / MinIO"]
  ai["AI 网关"]
  shared["packages/shared"]

  web -->|"同源 /api"| api
  shared --> web
  shared --> api
  api --> db
  api --> s3
  api --> ai
  ai --> anthropic["Anthropic"]
  ai --> rules["规则引擎"]
```

开发时 Vite 把 `/api` 代理到 `localhost:3000`。生产镜像里由 nginx 反代到 `API_ORIGIN`，浏览器仍然访问同源的 `/api`。候选人门户走 `/portal/.../:token`，不经过登录。

## 快速开始

需要 Node.js 20.19 或更高，以及 npm。不需要先装 Docker 或 PostgreSQL。

```bash
git clone https://github.com/suijiafeng/hireflow-recruitment-platform.git
cd hireflow-recruitment-platform
npm install
cp apps/api/.env.example apps/api/.env
npm run dev
```

`npm run dev` 会先构建 shared、建库并灌种子，然后一起拉起：

| 进程 | 地址 |
| --- | --- |
| PGlite | `127.0.0.1:5433` |
| API | http://localhost:3000/api ，文档在 http://localhost:3000/api/docs |
| Vite | http://localhost:5173 |

健康检查是 `GET /api/health`。

PGlite 对数据目录没有跨进程锁。`5433` 上已经有实例时，脚本会拒绝再开一个；两个进程同时写同一个 `.pgdata` 会损坏 WAL。需要重来时用 `npm run db:reset`。

### 环境变量

API 读 `apps/api/.env`。下表的默认值就是 `.env.example` 里的值，复制之后可以直接跑本地开发。

| 变量 | 作用 | 默认值 | 是否必须 |
| --- | --- | --- | --- |
| `DATABASE_URL` | Prisma 连接串。本地指向 PGlite | `postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public` | 是。不设的话 `npm run dev` 会停 |
| `DATABASE_POOL_MAX` | 连接池上限。PGlite 只有一个会话，必须是 1 | `1` | 本地必须保持 1。换真正的 Postgres 后删掉或调大 |
| `JWT_SECRET` | 签名密钥 | `change-me-in-production` | 是。`NODE_ENV=production` 时占位符或短于 32 位会拒绝启动 |
| `JWT_EXPIRES_IN` | 访问令牌有效期 | `12h` | 否 |
| `AI_PROVIDER` | `auto` / `mock` / `anthropic` | `auto` | 否 |
| `ANTHROPIC_API_KEY` | 留空则走规则引擎 | 空 | 否 |
| `ANTHROPIC_MODEL` | 模型名 | `claude-opus-4-8` | 否 |
| `ANTHROPIC_BASE_URL` | 兼容网关地址 | 空 | 否 |
| `PORT` | API 端口 | `3000` | 否 |
| `SWAGGER_ENABLED` | 生产环境是否挂 `/api/docs`。非 production 默认开启 | 未设置 | 否 |
| `ESIGN_STAFF_SIGN` | 生产环境是否允许后台代签合同 | 未设置 | 否 |
| `CORS_ORIGINS` | 逗号分隔的跨域白名单。空则不开启 CORS | 空 | 否 |
| `TRUST_PROXY` | Express `trust proxy`。设置后登录限流才按客户端 IP 计数 | 未设置 | 否 |
| `S3_ENDPOINT` | 对象存储地址 | `http://localhost:9000` | 否。代码里也有同样的默认值 |
| `S3_PUBLIC_ENDPOINT` | 浏览器能访问的预签名地址 | 空，则与 `S3_ENDPOINT` 相同 | 否 |
| `S3_ACCESS_KEY` | 对象存储账号 | `arthr` | 否 |
| `S3_SECRET_KEY` | 对象存储密码 | `arthr_dev_password` | 否 |
| `S3_BUCKET` | 桶名。不存在时 API 启动会尝试创建 | `arthr` | 否 |
| `S3_REGION` | 签名用的 region。示例文件里没有这一项 | 代码默认 `us-east-1` | 否 |

前端另有一个构建期变量 `VITE_DEMO_ACCOUNTS`。不是 `false` 时，登录页会列出下面的测试账号并预填密码。正式部署如果不要这块，构建时设为 `false`。

Web 容器还要 `API_ORIGIN`（镜像默认 `api:3000`），给 nginx 做 `/api` 反代。这不是 API 进程的变量。

### 演示账号

种子密码都是 `Admin@123456`。登录页上列出的是这五个：

| 邮箱 | 角色 | 数据范围 | 登录后的首页 |
| --- | --- | --- | --- |
| `admin@arthr.local` | 系统管理员 | 全部 | `/dashboard` |
| `hr@arthr.local` | HR | 全部 | `/dashboard` |
| `manager@arthr.local` | 用人经理，挂在技术部 | 本部门及下级 | `/dashboard` |
| `interviewer@arthr.local` | 面试官 | 指派给自己的 | `/candidates` |
| `it@arthr.local` | IT / 行政 | 指派给自己的 | `/onboarding` |

种子还会再建四个内部账号（赵磊、钱文、孙丽、周敏），密码相同，用来把面试和部门数据铺开。业务数据只在库里还没有职位时灌入；再跑一遍种子不会覆盖已有职位。

### 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm test` | API 的 Jest。当前是 9 个套件、54 个用例 |
| `npm run lint` | `apps/web` 的 oxlint |
| `npm run typecheck` | 构建 shared，再对 API 和 Web 跑 `tsc` |
| `npm run build` | shared、API、Web |
| `npm run db:setup` | 只建库 / 补迁移，不启动服务 |
| `npm run db:reset` | 删掉本地库，重新迁移并灌种子 |
| `npm run db:migrate` | 对 `DATABASE_URL` 执行 `prisma migrate dev` |
| `npm run db:seed` | 幂等种子 |
| `npm run db:generate` | 生成 Prisma Client。`npm install`、API 的 build 和 test 也会生成 |
| `npm run db:import -- <file.sql>` | 导入 `pg_dump --data-only --inserts` 的 SQL |
| `npm run dev:external-db` | 不启动 PGlite，API 直接连 `DATABASE_URL` |

推送到 `develop` 或 `main`，以及指向这两支的 PR，会跑 [CI](.github/workflows/ci.yml)：Node 22、`npm ci`、生成 Prisma Client、lint、类型检查、测试、构建。

### 换真正的 Postgres

`docker compose up -d` 只启动 Postgres 18 和 MinIO，不启动应用。对应连接串：

```text
postgresql://arthr:arthr_dev_password@localhost:5432/arthr?schema=public
```

把 `DATABASE_URL` 换成它（或你自己的库），删掉或调大 `DATABASE_POOL_MAX`，然后：

```bash
docker compose up -d
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev:external-db
```

`npm run dev` 会自己做迁移和种子；`dev:external-db` 不会。MinIO 控制台在 http://localhost:9001 ，账号与上面的 `S3_ACCESS_KEY` / `S3_SECRET_KEY` 相同。桶不用手建。

### 部署

两个镜像分开维护，因为 Render 不能对一个多阶段 Dockerfile 选 target。

| 镜像 | 文件 | 运行时 |
| --- | --- | --- |
| API | [Dockerfile.api](Dockerfile.api) | Node 22。入口先监听端口，再在后台做 `prisma migrate deploy` 和幂等种子 |
| Web | [Dockerfile](Dockerfile) | nginx 托管静态文件，并把 `/api` 反代到 `API_ORIGIN` |

[render.yaml](render.yaml) 是 Render Blueprint：`hireflow-api` 和 `hireflow-web` 两个免费实例，区域新加坡。数据库不在 Blueprint 里，要自己提供 `DATABASE_URL`。不填 S3 变量时，上传不可用，其他接口不受影响。免费实例休眠后，`API_ORIGIN` 需要填 API 的公网地址，填私网地址会一直 502。

本地构建镜像：

```bash
docker build -f Dockerfile.api -t hireflow-api .
docker build -f Dockerfile -t hireflow-web .
```

应用镜像不会被 `docker compose up` 拉起来。

## 目录

```text
hireflow-recruitment-platform/
├── apps/api/                 NestJS。模块按 auth、rbac、jobs、candidates、
│                             applications、interviews、offers、onboarding、
│                             helpdesk、analytics、notifications、ai、storage 拆开
├── apps/api/prisma/          schema、迁移、种子
├── apps/web/src/pages/       登录、大盘、洞察、职位、候选人、看板、面试、
│                             录用、入职、问答、设置，以及四个免登录门户
├── apps/web/src/router.tsx   路由级懒加载
├── packages/shared/          前后端共用的枚举、权限码、常量
├── deploy/                   nginx 模板和 API 容器入口
├── docker-compose.yml        仅 Postgres 与 MinIO
├── Dockerfile                Web 镜像
├── Dockerfile.api            API 镜像
└── render.yaml               Render Blueprint
```

## 实现上值得看的地方

**路由级代码分割。** 页面用 React Router 的 `lazy` 按路由加载，不进首屏包。Vite 再把 `react` / `react-dom`、TanStack Query 和 dayjs 拆成独立块；antd 不打成一整包，Table、DatePicker 跟着用到它们的页面走。

**CI 和 Prisma Client。** `develop` 和 `main` 上的 CI 会安装依赖、生成 Client、lint、做类型检查、跑测试并构建。Client 在 `npm install` 时生成，API 的 build 和 test 会再生成一次，所以全新 clone 不用先手跑 `prisma generate`。生成本身不连数据库。

**登录和会话。** 同一邮箱 15 分钟内失败 5 次锁定；配置了 `TRUST_PROXY` 之后，同一 IP 15 分钟 20 次也锁定。计数在进程内存里，多实例不共享。切换账号或退出时会清掉查询缓存，避免上一个用户的数据留在界面上。主动退出不会把回跳地址带到登录页。

**数据和权限。** 面试官视角的电话、邮箱和简历正文会打码。Offer 列表不下发门户 token。分析接口按数据范围过滤，用人经理看不到全公司报表。通知按权限和数据范围投递。

**并发。** 看板移动可以带 `expectedVersion`，冲突返回 409，前端回滚乐观更新。Offer 审批和答复把状态前置条件写进 `updateMany` 的 `WHERE`，用影响行数判断是不是已经被别人改过。

**时区。** Offer 的 5 个工作日、可约时段禁止跨天、合同签署日，都按东八区计算。工作日的测试不依赖机器时区。洞察页的周和季度分桶还没有走同一套偏移，容器默认 UTC 时，北京时间凌晨的记录可能进上一个桶。

## 已知限制

这些是当前代码里的取舍，不是路线图。仓库里没有对应的开放 issue 来排期。

- 访问令牌 12 小时，没有 refresh，也没有服务端吊销列表。权限和停用在下一次请求生效，令牌在过期前仍然能证明身份。
- 看板的 `expectedVersion` 是可选字段。不传就退回无版本检查。
- 门户 token 列本身没有过期时间。Offer 的答复截止是业务字段；面试选时和入职门户的链接发出去之后一直有效，直到被轮换。
- 登录限流存在单个进程的内存里。
- 没有把 Prisma 的唯一约束和外键错误映射成 409 / 404 的全局过滤器。
- 简历抽字只覆盖 PDF 和纯文本。Word 不会被解析。
- 自动化测试在 API：权限范围、脱敏、门户工作日、登录限流、权限守卫、启动时的密钥检查、规则引擎、Offer 状态机和健康检查。前端没有测试。
- 候选人和职位可以物理删除。应聘上的淘汰和撤回是状态变更。操作会写入 activity log。

## 许可证

[MIT](./LICENSE)。Copyright (c) 2026 suijiafeng。

> **声明**：本仓库为个人项目，仅供学习交流。
