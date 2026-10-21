# ===== 智能物料仓储系统 · 一体化镜像 =====
# 构建上下文必须是仓库根目录（需要 web/ 与 server/ 两部分）：
#   docker build -f server/Dockerfile -t wms .
#
# 镜像内同时包含：
#   - 前端静态产物（web/dist，由第一阶段构建）
#   - 后端 API（server/src）
# 运行时通过 SERVE_WEB=true 让 API 托管前端 → 一个服务一个永久链接（前后端同源）

# ---------- 阶段 1：构建前端 ----------
FROM node:22-alpine AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# 前端接口地址：单服务部署用同源 /api（不设 VITE_API_BASE 即可）
ARG VITE_API_BASE=/api
ARG VITE_BASE=/
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_BASE=$VITE_BASE
RUN npm run build

# ---------- 阶段 2：后端运行时 ----------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV SERVE_WEB=true

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/src ./src
COPY --from=web-build /web/dist ./web/dist

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
