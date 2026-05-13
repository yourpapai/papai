FROM oven/bun:1-alpine@sha256:a108a3f67197646f1f975ff70237a45034d313d255051cd54e98c64737c1d204 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY codeindex/package.json ./codeindex/
COPY review-loop/package.json ./review-loop/
RUN bun install --frozen-lockfile --production

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY client ./client
COPY scripts ./scripts
COPY src ./src
COPY package.json tsconfig.json ./
RUN bun scripts/build-client.ts

FROM base AS final
COPY --from=build /app/public ./public
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY package.json tsconfig.json CHANGELOG.md ./

ENV NODE_ENV=production

# Create data directory with proper permissions for the bun user
RUN mkdir -p /data && chown -R bun:bun /data

USER bun

CMD ["bun", "run", "src/index.ts"]
