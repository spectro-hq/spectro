FROM node:22-bookworm-slim AS build
WORKDIR /workspace
RUN npm install -g pnpm@12.3.4
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @spectro/api... --filter @spectro/ingest... --filter @spectro/processor... --filter @spectro/web... build

FROM build AS runtime
ENV NODE_ENV=production
USER node
CMD ["node", "apps/api/dist/server.js"]

FROM caddy:2.10.2-alpine AS web
COPY --from=build /workspace/apps/web/dist /srv
COPY infra/staging/Caddyfile /etc/caddy/Caddyfile
