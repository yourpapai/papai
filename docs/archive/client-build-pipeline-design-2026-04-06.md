<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Client Build Pipeline Design

**Date:** 2026-04-06
**Status:** Approved

## Problem

The debug dashboard UI lives in `src/debug/dashboard-ui/` and `src/debug/dashboard/` as plain TS/CSS/HTML. It is transpiled at runtime via `Bun.build()` IIFE and cached in memory. This causes two problems:

1. **Runtime transpilation cost** — growing file count (825+ lines across 8 client files) means slower startup and no tree-shaking/minification.
2. **TDD hook friction** — hooks treat `src/` as server code, enforcing server-oriented TDD rules on browser modules.

## Decisions

- Keep plain TS + DOM manipulation (no framework).
- Use `Bun.build()` as a build script (not runtime).
- Move client source to top-level `client/` directory.
- Build output goes to `public/` (gitignored).
- Use happy-dom for client-side test DOM environment.
- `bun start` calls `bun build:client` automatically.
- CI gets a dedicated build job; downstream jobs depend on it.
- Dockerfile gets a build stage for client assets.

## Directory Structure

```
client/
  debug/
    index.ts              ← single entry point (consolidates dashboard-ui/ + dashboard/)
    helpers.ts
    logs.ts
    trace-detail.ts
    session-detail.ts
    session-card.ts
    log-detail.ts
    types.ts
    state.ts
    handlers.ts
    sse.ts
    search.ts
    init.ts
    tree-view.ts
    logs-bootstrap.ts
    dashboard.html
    dashboard.css

public/                   ← gitignored build output
  dashboard.js
  dashboard.css
  dashboard.html

scripts/
  build-client.ts

tests/
  client/
    debug/                ← client tests with happy-dom
      helpers.test.ts
      logs.test.ts
      ...
  client-setup.ts         ← happy-dom preload
  debug/                  ← server-side tests (unchanged)
    server.test.ts
    state-collector.test.ts
    ...
```

## Build Script

`scripts/build-client.ts`:

- Calls `Bun.build()` with entry point `client/debug/index.ts`, format `iife`, output to `public/`.
- Copies `client/debug/dashboard.html` and `client/debug/dashboard.css` to `public/`.
- Exits non-zero on build failure.

## Package Scripts

```json
{
  "build:client": "bun scripts/build-client.ts",
  "start": "bun build:client && bun run src/index.ts",
  "test:client": "bun test tests/client --preload ./tests/client-setup.ts",
  "check:full": "bun run --parallel lint typecheck format:check knip test test:client duplicates"
}
```

## Server Changes

`src/debug/server.ts`:

- Remove `transpileDashboard()`, `jsCache`, and all in-memory caching logic.
- Serve static files from `public/` via `Bun.file()`.
- Routes: `/dashboard` → `public/dashboard.html`, `/dashboard.css` → `public/dashboard.css`, `/dashboard.js` → `public/dashboard.js`.

`dashboard.html`:

- Two `<script>` tags collapse to one (`dashboard.js`).
- Inline tree-view `<script>` block moves into `client/debug/index.ts`.

## TDD Hook Changes

`.hooks/tdd/test-resolver.mjs`:

**`isGateableImplFile()`** — recognize `client/` as second source root:

```js
if (!rel.startsWith('src/') && !rel.startsWith('client/')) return false
```

**`findTestFile()`** — `client/debug/helpers.ts` → `tests/client/debug/helpers.test.ts`. Same mapping logic as `src/` → `tests/`, extended for `client/` → `tests/client/`.

**`suggestTestPath()`** — `client/debug/helpers.ts` → `tests/client/debug/helpers.test.ts`.

**`resolveImplPath()`** — `tests/client/debug/helpers.test.ts` → `client/debug/helpers.ts`. If test path starts with `tests/client/`, strip `tests/` prefix.

Post-tool-use hooks (test runner, coverage, surface diff, mutation diff) adapt automatically since they work off resolved test paths.

## Testing Strategy

**Client tests** (`tests/client/debug/`):

- Use happy-dom as DOM environment.
- New preload: `tests/client-setup.ts` initializes happy-dom `Window`, assigns `document`, `window`, `HTMLElement`, etc. to globalThis.
- Run via `bun test:client`.

**Server tests** (`tests/debug/`):

- Unchanged, no DOM globals.
- `bun test` excludes `tests/client/` via `bunfig.toml` `pathIgnorePatterns`.

**bunfig.toml**:

```toml
[test]
preload = ["./tests/setup.ts", "./tests/mock-reset.ts"]
pathIgnorePatterns = ["tests/e2e/**", "tests/client/**"]
```

**Smoke test** (`tests/debug/dashboard-smoke.test.ts`):

- Stays in `tests/debug/` — tests server serving from `public/`.
- Updated to verify pre-built `public/dashboard.js` is served (requires `bun build:client` as prerequisite).

## CI Workflow

```yaml
jobs:
  build:
    name: Build
    steps:
      - checkout, setup-bun, install
      - run: bun build:client
      - upload-artifact: public/

  check:
    needs: build
    steps:
      - checkout, setup-bun, install
      - download-artifact: public/
      - run: bun check:full

  e2e:
    needs: build
    steps:
      - checkout, setup-bun, install, docker
      - download-artifact: public/
      - run: bun test:e2e

  security:
    # no dependency on build
    steps:
      - run: bun security

  mutation-testing:
    needs: build
    steps:
      - download-artifact: public/
      - run: bun run test:mutate:changed
```

## Dockerfile

```dockerfile
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY client ./client
COPY scripts ./scripts
COPY package.json tsconfig.json ./
RUN bun build:client

FROM base AS final
COPY --from=build /app/public ./public
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY package.json tsconfig.json CHANGELOG.md ./
ENV NODE_ENV=production
RUN mkdir -p /data && chown -R bun:bun /data
USER bun
CMD ["bun", "run", "src/index.ts"]
```

## New Dependency

- `happy-dom` — devDependency for client test DOM environment.

## What Stays Unchanged

- `src/debug/schemas.ts`, `state-collector.ts`, `event-bus.ts`, `log-buffer.ts`, `dashboard-types.ts` — all server-side debug code stays in `src/debug/`.
- Existing server tests in `tests/debug/`.

## Change Summary

| Area                                    | Change                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| New `client/debug/`                     | Browser TS, HTML, CSS moved from `src/debug/dashboard-ui/` + `src/debug/dashboard/` |
| New `public/`                           | Gitignored build output                                                             |
| New `scripts/build-client.ts`           | Bun.build() IIFE + asset copy                                                       |
| New `tests/client/debug/`               | Client unit tests with happy-dom                                                    |
| New `tests/client-setup.ts`             | happy-dom preload                                                                   |
| New dep `happy-dom`                     | devDependency                                                                       |
| Modified `src/debug/server.ts`          | Remove transpilation, serve static from `public/`                                   |
| Modified `dashboard.html`               | Single script tag, inline script removed                                            |
| Modified `.hooks/tdd/test-resolver.mjs` | Recognize `client/` as source root                                                  |
| Modified `bunfig.toml`                  | Exclude `tests/client/` from `bun test`                                             |
| Modified `package.json`                 | New scripts, `start` calls `build:client`                                           |
| Modified `.github/workflows/ci.yml`     | New build job, downstream deps                                                      |
| Modified `Dockerfile`                   | Build stage for client                                                              |
| Modified `.gitignore`                   | Add `public/`                                                                       |
| Removed `src/debug/dashboard-ui/`       | Moved to `client/debug/`                                                            |
| Removed `src/debug/dashboard/`          | Consolidated into `client/debug/`                                                   |
| Removed runtime transpilation           | `transpileDashboard()`, `jsCache` deleted                                           |
