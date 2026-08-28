# 构建 Vite 前端产物。使用根 workspace，确保共享 contracts/canvas-core 可解析。
FROM node:22-alpine AS web-build
ARG VITE_PLATFORM_MODE=local
ARG VITE_API_BASE=
ENV VITE_PLATFORM_MODE=$VITE_PLATFORM_MODE VITE_API_BASE=$VITE_API_BASE

RUN corepack enable
WORKDIR /app
COPY . .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter infinite-canvas build

# 运行镜像：Local mode 可由浏览器直连 Provider，Server mode 由 Nginx 反代平台 API。
FROM nginx:1.27-alpine

COPY --from=web-build /app/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY web/docker-entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh

EXPOSE 3000
