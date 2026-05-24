# syntax=docker/dockerfile:1.6

# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app

COPY services/chat-ui/package.json services/chat-ui/package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY services/chat-ui/tsconfig.json services/chat-ui/tsconfig.node.json ./
COPY services/chat-ui/vite.config.ts services/chat-ui/index.html ./
COPY services/chat-ui/src ./src

RUN npm run build

# ---- Runtime stage ----
FROM nginx:1.27-alpine AS runtime
RUN rm /etc/nginx/conf.d/default.conf
COPY services/chat-ui/nginx.conf /etc/nginx/conf.d/chat-ui.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=10 \
  CMD wget -qO- http://127.0.0.1/health > /dev/null || exit 1
