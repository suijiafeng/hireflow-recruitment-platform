# HireFlow - AI-Powered Recruitment Platform
# Web 运行时镜像：nginx 静态站 + /api 反代。部署见 README「部署」一节（Render）。
# API 镜像单独在 Dockerfile.api（Render 不支持多阶段 Dockerfile 选 target，
# 两者的 deps/build 层需同步维护）。

# ---- 依赖层：仅拷贝清单文件，充分利用缓存 ----
FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# 构建 web 产物需要 vite/tsc，因此这里装全量依赖；devDependencies 只存在于构建阶段，
# 最终 nginx 镜像只拷 dist，不带 node_modules（API 镜像的依赖裁剪见 Dockerfile.api）
RUN npm ci

# ---- 构建层：只需 shared → web（api 镜像见 Dockerfile.api，构建互不影响）----
FROM deps AS build
# 演示模式（登录页展示演示账号）构建期开关，默认关闭；公开演示站构建时传 --build-arg VITE_DEMO_MODE=true。
# 关闭时演示账号与密码不会进入产物（见 apps/web/src/utils/demo.ts）
ARG VITE_DEMO_MODE=false
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build:shared && npm run build -w apps/web

# ---- Web 运行时：nginx 托管静态产物并反代 /api ----
FROM nginx:1.27-alpine AS web
# 默认值：常见容器编排里后端服务名就叫 api；Render 等平台按需覆盖
ENV API_ORIGIN=api:3000
# 令入口脚本把 /etc/resolv.conf 的 nameserver 导出为 NGINX_LOCAL_RESOLVERS，
# 供模板 resolver 指令做请求期 DNS 解析（api 未就绪/换 IP 时 web 仍能启动）
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
# API_ORIGIN -> API_UPSTREAM 协议归一化（envsh 须有执行位才会被入口 source）
COPY deploy/00-api-upstream.envsh /docker-entrypoint.d/00-api-upstream.envsh
RUN chmod +x /docker-entrypoint.d/00-api-upstream.envsh
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
