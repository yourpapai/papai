FROM oven/bun:1-alpine@sha256:07235578f79ef8c6f97d94aee7938e76f5cdba5f21ae5dbfdd3d3d38058437eb AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY patches ./patches
COPY review-loop/package.json ./review-loop/
COPY mutation-improve/package.json ./mutation-improve/
COPY opencode-agent/package.json ./opencode-agent/
COPY sdd-runner/package.json ./sdd-runner/
RUN bun install --frozen-lockfile

FROM base AS prod-deps
COPY package.json bun.lock ./
COPY patches ./patches
COPY review-loop/package.json ./review-loop/
COPY mutation-improve/package.json ./mutation-improve/
COPY opencode-agent/package.json ./opencode-agent/
COPY sdd-runner/package.json ./sdd-runner/
RUN bun install --frozen-lockfile --production

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY client ./client
COPY plugins ./plugins
COPY scripts ./scripts
COPY src ./src
COPY package.json tsconfig.json vite.config.ts ./
RUN bun scripts/build-client.ts

FROM base AS final
COPY --from=build /app/public ./public
COPY --from=prod-deps /app/node_modules ./node_modules
COPY plugins ./plugins
COPY src ./src
# Operator CLIs (runbook: analytics-stage-b-report/backfill/snapshot/rekey) run inside the
# container via `docker compose exec papai bun run /app/scripts/<name>.ts`.
COPY scripts ./scripts
COPY package.json tsconfig.json CHANGELOG.md ./
COPY LICENSE ./LICENSE

ENV NODE_ENV=production

# Create data directory with proper permissions for the bun user
RUN mkdir -p /data && chown -R bun:bun /data

USER bun

CMD ["bun", "run", "src/index.ts"]
