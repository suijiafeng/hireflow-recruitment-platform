#!/bin/sh
# API 容器入口：先迁移、后启动。
#
#   1. prisma migrate deploy：数据库一时连不上会重试（默认 15 次 × 3 秒）；
#      重试用尽仍失败 → 以非 0 退出，容器起不来，部署判定失败，旧版本继续服务。
#      不再「先起服务、后台迁移」——那样迁移失败时新代码会跑在旧表结构上。
#   2. 基础种子（幂等）：权限点 / 内置角色对齐 + 首个管理员（ADMIN_EMAIL / ADMIN_PASSWORD，
#      不给密码则随机生成并只在本次日志里打印一次）。NODE_ENV=production 时绝不写演示账号与演示数据。
#      种子失败同样让部署失败。
#   3. exec 应用：node 成为 PID 1 的直接替身，SIGTERM 直达应用，优雅退出由 Nest shutdown hooks 处理。
#
# 注意：基础镜像是 node:22-alpine，/bin/sh 是 BusyBox ash（非 bash），禁止 <<<、[[ ]] 等 bashism。
set -eu

MAX_RETRIES="${MIGRATE_MAX_RETRIES:-15}"
RETRY_INTERVAL="${MIGRATE_RETRY_INTERVAL:-3}"

attempt=1
until npx prisma migrate deploy; do
  if [ "$attempt" -ge "$MAX_RETRIES" ]; then
    echo "[entrypoint] ✖ 数据库迁移 $MAX_RETRIES 次仍失败，终止部署" >&2
    exit 1
  fi
  echo "[entrypoint] 迁移失败，${RETRY_INTERVAL}s 后重试 ($attempt/$MAX_RETRIES)..." >&2
  attempt=$((attempt + 1))
  sleep "$RETRY_INTERVAL"
done

echo "[entrypoint] 基础种子（幂等）..."
npm run db:seed

echo "[entrypoint] 启动应用 (端口: ${PORT:-3000}) ..."
exec node dist/main.js
