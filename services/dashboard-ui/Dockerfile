# syntax=docker/dockerfile:1.6

FROM node:20-alpine AS build
WORKDIR /app

COPY services/dashboard-ui/package.json services/dashboard-ui/package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY services/dashboard-ui/tsconfig.json services/dashboard-ui/tsconfig.node.json ./
COPY services/dashboard-ui/vite.config.ts services/dashboard-ui/index.html ./
COPY services/dashboard-ui/src ./src

RUN npm run build

FROM nginx:1.27-alpine AS runtime
RUN rm /etc/nginx/conf.d/default.conf
COPY services/dashboard-ui/nginx.conf /etc/nginx/conf.d/dashboard-ui.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=10 \
  CMD wget -qO- http://127.0.0.1/health > /dev/null || exit 1
