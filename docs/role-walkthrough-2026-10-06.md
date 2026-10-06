# 分角色功能走查记录（2026-10-06）

走查方式：本地 `npm run dev`（PGlite）+ seed 数据；五个内置账号（admin / hr / manager / interviewer / it）各自登录前端走页面，并用各账号的 JWT 直接打接口做跨范围探测。候选人 / 新员工门户用令牌链接验证。

严重度：**P0** 越权或数据泄露 · **P1** 功能不可用 · **P2** 体验 / 一致性 · **P3** 环境 / 工程

---

## P0 权限与数据泄露

### 1. 入职单详情把门户令牌原样返回，任何有「查看入职单」权限的人都能冒充新员工
- 现象：`GET /api/onboardings/:id` 响应里带 `portalToken`。用人经理、IT 都能拿到。
- 后果：拿到令牌后直接访问 `GET /api/portal/onboardings/:token`，**薪资不再脱敏**（IT 没有 `salary:view`，后台接口里合同变量返回 `salaryMasked: true`，门户里却看到 `salaryBase: 30000`）。同一个令牌还能调 `POST /portal/onboardings/:token/contract/sign` 和 `.../documents`，等于替新员工签合同、传材料。
- 复现：用 it@arthr.local 登录拿 token → 查 `/api/onboardings/cmuw8x8ua009scrsbr23yfodl` → 取 `portalToken` → 匿名访问门户接口。
- 位置：[onboarding.service.ts](../apps/api/src/modules/onboarding/onboarding.service.ts) 的详情/列表查询没有 `select` 掉 `portalToken`；前端只给 `ONBOARDING_MANAGE` 显示「发送门户链接」，但数据已经到浏览器了。
- 建议：详情/列表响应剥掉 `portalToken`，链接只通过 `POST /onboardings/:id/portal-link`（已有 `ONBOARDING_MANAGE` 门禁）生成；门户视图的薪资脱敏策略单独评估。

### 2. Offer 列表把候选人门户令牌返回给用人经理
- 现象：`GET /api/offers` 对用人经理返回的每条 SENT 状态 Offer 都带 `portalToken`（如 `demo-offer-pwilmaai`）。
- 后果：审批人可以用 `POST /portal/offers/:token/respond` 替候选人「接受 / 拒绝」Offer，审批与答复两个角色失去隔离。HR 本来就能生成链接，但经理不该拿到。
- 位置：[offers.service.ts](../apps/api/src/modules/offers/offers.service.ts) `OFFER_INCLUDE` / 列表查询。
- 建议：列表与详情去掉 `portalToken`，只在 `POST /offers/:id/portal-link`（`OFFER_INITIATE` 门禁）返回。

### 3. 面试官可以看任何职位的完整招聘看板
- 现象：`GET /api/jobs/:jobId/board` 只要求 `candidate:read`，面试官（数据范围 = 仅被指派）访问市场部职位的看板返回 200，拿到该职位所有候选人姓名、阶段、匹配分、应聘记录 id。
- 对比：同一个面试官访问 `GET /candidates/:id`（非指派候选人）正确返回 403；`GET /jobs` 返回 403。看板是唯一绕过指派范围的读接口。
- 位置：[applications.service.ts:190](../apps/api/src/modules/applications/applications.service.ts:190) 只处理了 `DEPARTMENT` 范围，没有处理 `ASSIGNED`。
- 建议：`ASSIGNED` 范围直接拒绝看板，或只返回含本人指派面试的应聘记录。

### 4. 待办中心（/analytics/todos）没有任何行级范围
- 现象：用人经理（技术部）登录后数据大盘显示「待审批 Offer 1」，但他的录用管理页待审批为 0。那 1 条是设计部的 Offer。`newResumes`、`onboardingInProgress`、`docsNeedReview` 同样是全公司计数。
- 位置：[analytics.service.ts:27](../apps/api/src/modules/analytics/analytics.service.ts:27)。上一次提交修了 analytics 五个端点的部门过滤，`todos` 漏掉了。接口也没有 `@RequirePermissions`。
- 建议：用 `deptScopeOf(user)` 把各个 count 的 where 加上 `job.departmentId`。

---

## P1 功能不可用

### 5. 录用管理页在接口 403 时整页白屏
- 现象：面试官、IT 直接访问 `/offers`，页面崩溃为 React Router 默认错误页「Rendered fewer hooks than expected」。
- 原因：[OffersPage.tsx:283](../apps/web/src/pages/offers/OffersPage.tsx:283) 的 `useSyncedTableScroll()` 写在 `if (offersQuery.isError) return ...` 之后，违反 hooks 顺序。
- 建议：把 hook 挪到所有 early return 之前。

### 6. 本地开发库在并发请求下串连接，设置页基本打不开
- 现象：打开「系统设置」会并发请求 `/roles`、`/permissions`、`/activities/recent`，经常有一个 500，角色表显示「共 0 个角色」。管理员、HR、用人经理都复现；大盘的 `/analytics/trend`、`/departments` 也偶发 500。
- 日志证据：`invalid input value for enum "OfferApprovalStatus": "cmuw8x8et000ucrsbn3n4n8tm"`（部门 id 被塞进了另一条查询）、`role.findMany` 返回了 permission 表的行、`unnamed prepared statement does not exist`。
- 原因：PGlite 单后端，`pglite-socket` 的 `maxConnections: 20` 只是排队，并不隔离各连接的 prepared statement；Prisma 连接池并发时结果串台。
- 建议：本地 `DATABASE_URL` 加 `connection_limit=1`，或 db.ts 把 `maxConnections` 降到 1 并在文档里说明。注意这是数据串台，不只是报错——在共享 PGlite 的演示环境里可能把 A 的查询结果给 B。

### 7. 全新 clone 跑 `npm run dev` 直接失败
- 现象：`db:setup` 阶段 seed 报 `Cannot find module '../src/generated/prisma/client'`，因为 `npm install` 后没有执行 `prisma generate`。
- 建议：`apps/api/package.json` 加 `postinstall: prisma generate`，或 `db:setup` 脚本先跑 generate。

---

## P2 前端体验 / 一致性

### 8. 无权限页面的处理方式不统一
- `/onboarding`（面试官）正确显示「无权访问 · 缺少权限 onboarding:read」。
- `/candidates`（IT）显示「候选人库还是空的，去上传简历吧」；`/jobs`、`/pipeline`、`/dashboard`、`/insights`（面试官）显示空数据态，`/pipeline` 还给面试官一个「创建职位」按钮。
- `/offers` 直接崩溃（见 5）。
- 建议：统一用 `QueryErrorResult` 处理 403，或在路由层按菜单权限拦截。

### 9. 设置页对所有角色可读，角色矩阵与「编辑」按钮都渲染出来
- 面试官访问 `/settings` 看到 7 个角色、各自权限数和「编辑」入口（保存时才 403）。`GET /roles`、`GET /permissions` 没有权限要求。
- 建议：`/roles` 对非 `config:manage` 返回精简字段，或前端按权限隐藏整个页面。

### 10. IT 的面试管理页显示「我的可约时段 + 添加」
- IT 没有 `evaluation:submit`，点添加必然 403。页面应按权限隐藏右栏。

### 11. 批量接口全部失败时仍返回 201
- 用人经理对其他部门应聘记录 `POST /applications/batch/reject`，响应 `{succeeded: 0, failed: [...]}` 但 HTTP 201。前端若只看状态码会误判成功。

### 12. 用人经理可以对本部门任何面试提交面评
- `submitEvaluation` 只对 `ASSIGNED` 范围校验指派关系，`DEPARTMENT` 范围的经理即使不是面试官也能提交。界面上面试列表给经理显示了「面评」按钮。是否符合业务需要确认。

---

## P3 设计与环境观察

### 13. 部门范围不含子部门
- `departmentScopeOf` 按 `departmentId` 精确匹配。seed 里技术部下有前端组 / 后端组 / 测试组；一旦职位挂到子部门，技术部总监就看不到。当前 seed 没有子部门职位，所以暂未触发。

### 14. Swagger `/api/docs` 无鉴权、无环境开关
- [main.ts:26](../apps/api/src/main.ts:26) 任何环境都挂载，匿名可读全部接口定义。

### 15. IT 能看到新员工的手机、邮箱、身份证号（部分遮蔽）
- `GET /onboardings/:id` 对 IT 返回 `application.candidate.phone/email` 和 `documents[].fields`。IT 的职责只是开账号配电脑，联系方式和证件字段可以不下发。

### 16. 面试官可以从候选人列表看到录用结果
- 面试官候选人列表里显示「Offer」「已入职」等应聘进展。对去偏见设计来说，面试官看到自己评价过的人最终是否录用属于可接受范围，但仍记一笔。

### 17. 预览工具注入的 `PORT` 被 API 拾取
- `main.ts` 读 `process.env.PORT`，在把 5173 作为预览端口的环境里 API 会和 Vite 抢端口。已在 `.claude/launch.json` 里显式 `PORT=3000` 绕过。

---

## 验证过、没有问题的点

- 用人经理：候选人 / 职位 / 阶段 / 漏斗 / 简历文件 / 应聘记录移动与评分 / Offer / 入职单 / 面试，跨部门全部 403 或列表过滤正确；批量操作逐条拒绝。
- 面试官：非指派候选人详情 403；非指派面试提交评价 403；生成选时链接 403；联系方式脱敏（`li***@example.com` / `138***0002`）在列表和详情都生效；Offer / 入职单 / 用户 / 大盘 403。
- IT：只能勾选 owner=IT 的清单项，HR / 新员工项 403；已闭环入职单不可改；上传材料 403；合同薪资在后台接口脱敏。
- HR：审批 Offer 403；用户管理 / 角色管理 / 制度文档 / 审计日志 403；页面上没有审批按钮。
- 通用：未登录访问业务接口 401；门户随机令牌错误返回 404；通知已读、面试官时段删除都做了归属校验；管理员角色不可编辑、门户角色不可分配给内部成员。

---

## 修复状态（2026-10-06 同日）

| # | 问题 | 状态 | 复测结果 |
|---|---|---|---|
| 1 | 入职单泄露门户令牌 | 已修 | 列表 / 详情不再含 `portalToken`；IT 看不到联系方式和证件字段；HR 通过 portal-link 接口照常拿链接 |
| 2 | Offer 泄露门户令牌 | 已修 | 经理 / HR 列表均无令牌；portal-link 接口照常 |
| 3 | 面试官可看任意看板 | 已修 | 看板对「仅被指派」范围 403；对比接口只允许被指派的候选人 |
| 4 | 待办中心无部门过滤 | 已修 | 技术部经理「待审批 Offer」由 1 变 0，与录用管理页一致 |
| 5 | 录用管理页 403 白屏 | 已修 | 走页面自身的「无权访问」；web lint 新增 rules-of-hooks，全量无其他违例 |
| 6 | PGlite 并发串台 | 已修 | 新增 `DATABASE_POOL_MAX`，本地设 1；110 个并发请求 0 个 500 |
| 7 | 全新 clone 跑不起来 | 已修 | `db:setup` 先跑 `prisma generate`；删掉生成目录后验证通过 |
| 8 | 无权页面处理不统一 | 已修 | 布局层按菜单权限表统一给 403 |
| 9 | 设置页对所有角色可读 | 已修 | 前端被 8 拦截；`/roles` `/permissions` 要求 user:manage 或 config:manage 任一 |
| 10 | IT 面试页显示可约时段 | 已修 | IT 被 8 拦截；右栏另按 evaluation:submit 显隐 |
| 11 | 批量全失败返回 201 | 已修 | 改为 200，响应体不变 |
| 12 | 经理可对非指派面试提交面评 | 已修 | 保留原设计（HR / 经理可代录面评），但补上缺失的部门范围：经理跨部门提交与 AI 草稿都 403；草稿接口原本完全没有范围校验，面试官也能对任意场次生成，一并修复 |
| 13 | 部门范围不含子部门 | 已修 | 登录时计算本部门子树写入 JWT；技术部经理可见前端组职位，设计部经理不可见；旧令牌退化为仅本部门，重新登录后生效 |
| 14 | Swagger 无鉴权 | 已修 | production 默认关闭，`SWAGGER_ENABLED=true` 可开 |
| 15 | IT 看到联系方式与证件号 | 已修 | 随 1 一起处理；证件卡片显示「证件信息仅 HR 可见」，不再误报「未识别字段」 |
| 16 | 面试官看到录用结果 | 不改 | 可接受 |
| 17 | 预览注入 PORT | 已绕过 | launch.json 固定 `PORT=3000` |

---

## 第二轮：安全加固（2026-10-06）

| # | 问题 | 处理 | 复测结果 |
|---|---|---|---|
| 18 | 简历原文绕过联系方式脱敏 | 面试官视角下简历正文与 AI 解析结果中的手机号、邮箱一律打码；原件文件无法打码，对该视角禁用下载并隐藏按钮 | 面试官看到 `138***0002`、`li***@example.com`，原件链接 403；HR 不受影响 |
| 19 | 登录无限流 | 同一账号 15 分钟内失败 5 次锁定；配置 `TRUST_PROXY` 后另按 IP 计数（20 次）。所有失败统一提示「邮箱或密码错误」，不存在的账号也做同成本密码比对，防止枚举 | 第 6 次起返回 429，锁定期间正确密码也被拒；其他账号不受影响 |
| 20 | 停用账号令牌仍有效 | JWT 守卫每次请求按主键查账号状态 | 停用后同一令牌立即 401，恢复后 200 |
| 21 | 跨域对任意来源放行 | 默认不开 CORS（前端同源访问）；需要时用 `CORS_ORIGINS` 列白名单 | 外部来源预检无任何放行头；同源登录正常 |
| 22 | 默认 JWT 密钥可上线 | production 下密钥为文档占位值或短于 32 位时拒绝启动；README 示例同步修改 | 单测覆盖 |
| 23 | 门户令牌可推算、永不失效 | 演示数据改用随机令牌；HR 可「重置链接」使旧链接立即失效并留痕；入职闭环 7 天后门户链接失效，闭环后不再发放 | 重置后旧链接 404、新链接 200；经理重置 403；范磊（已闭环）链接失效 |

部署注意：
- 生产 `JWT_SECRET` 必须是 32 位以上随机值，否则服务拒绝启动。Render 自动生成的值满足要求。
- 想启用按 IP 限流，需按代理层数设置 `TRUST_PROXY`（nginx 一层填 1，Render 等平台再加一层填 2）。不确定就不设，只按账号限流。
- 登录限流计数在进程内存里，多实例部署需改为共享存储。
