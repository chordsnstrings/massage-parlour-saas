# syntax=docker/dockerfile:1.7
# Build from the repo root: docker build -f apps/worker/Dockerfile .
# One self-contained bundle: dist/index.js (worker), dist/migrate.js, dist/seed.js.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.7 prune @spa/worker --docker

FROM base AS build
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
COPY --from=prune /repo/tsconfig.base.json ./
RUN pnpm --filter @spa/worker build

FROM node:22-alpine AS run
# pg_dump must match the server major version (16).
RUN apk add --no-cache postgresql16-client && addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production MIGRATIONS_DIR=/app/drizzle
COPY --from=build /repo/apps/worker/dist ./dist
COPY --from=build /repo/packages/db/drizzle ./drizzle
COPY --from=build /repo/packages/db/sql ./sql
USER app
CMD ["node", "dist/index.js"]
