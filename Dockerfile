# Multi-stage, so the shipped image carries no build toolchain and no dev
# dependencies.
#
# Written by hand rather than left to a buildpack for one reason: debugging.
# `docker build && docker run` locally reproduces the EXACT production runtime —
# same Node, same OS libraries, same file layout. A buildpack builds in the
# host's environment, which you cannot reproduce, so a production-only failure
# has no bisect path.

# ---------- build ----------
FROM node:24-slim AS build
WORKDIR /app

RUN corepack enable

# Copy manifests first so the dependency layer is cached independently of source
# changes — edits to src/ don't trigger a reinstall.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

# --ignore-scripts skips the root `prepare` hook, which would try to build core
# before any source has been copied.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm build

# ---------- runtime ----------
FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

# Production dependencies only. @libsql/client resolves its prebuilt binary
# from npm here — nothing is compiled, on any platform.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @trase/server...

# Compiled output, the built UI, and the migrations that run on boot.
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/drizzle ./packages/server/drizzle
COPY --from=build /app/packages/web/dist ./packages/web/dist

# The SQLite file lives on a mounted disk, so it survives restarts.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
