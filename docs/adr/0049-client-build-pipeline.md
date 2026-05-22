<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0049: Client Build Pipeline for Debug Dashboard

## Status

Accepted

## Context

The debug dashboard UI was originally implemented as server-side TypeScript in `src/debug/dashboard-ui/` and `src/debug/dashboard/`. These modules were transpiled at runtime using `Bun.build()` IIFE format and cached in memory. This approach had two critical problems:

1. **Runtime transpilation cost** — Growing file count (825+ lines across 8+ client files) meant slower startup, no tree-shaking, and no minification. Each server restart required re-transpiling client code.

2. **TDD hook friction** — The TDD enforcement hooks treated `src/` as server code, applying server-oriented TDD rules (mutation testing, coverage gates) to browser modules. This created false blockages during development.

Additionally, the debug dashboard had evolved from a simple experiment into a production debugging tool with:

- Live LLM trace visualization
- Log explorer with search
- Session detail modals
- Real-time SSE updates

The architecture needed to support client-side testing with DOM globals while keeping server-side debug instrumentation separate.

## Decision Drivers

- **Must eliminate runtime transpilation** — Build client assets ahead of time
- **Must support client-side testing** — Need DOM environment (happy-dom) for dashboard tests
- **Must separate client/server concerns** — Different TDD rules for browser vs server code
- **Should maintain vanilla TS/CSS/HTML** — No framework migration (design constraint)
- **Should integrate with existing CI/CD** — Docker, GitHub Actions, local dev workflow
- **Must preserve hot-reload** — Debug dashboard development needs fast iteration

## Considered Options

### Option 1: Separate Client Build Pipeline (Selected)

Move client source to top-level `client/` directory, build to `public/` via `Bun.build()`, serve static files from `public/`.

- **Pros**: Clean separation, proper build step, happy-dom for client tests, framework-agnostic, matches industry patterns
- **Cons**: Requires TDD hook changes, new directory structure, build artifact in repo (gitignored)

### Option 2: Keep Runtime Transpilation with Caching

Keep existing `transpileDashboard()` but add persistent disk cache.

- **Pros**: Minimal changes, no new build step
- **Cons**: Still runtime overhead, cache invalidation complexity, doesn't solve TDD hook issues

### Option 3: Vite-based Build System

Adopt Vite for client build with HMR.

- **Pros**: Fast HMR, rich ecosystem, modern DX
- **Cons**: Overkill for vanilla TS project, adds dependency, doesn't solve TDD hook issues

### Option 4: Keep in `src/` with Separate Test Path

Keep client code in `src/debug/client/` with separate test discovery.

- **Pros**: No directory migration
- **Cons**: Still conflates server/client TDD rules, `src/` bloat, less clear separation

## Decision

We will implement a **dedicated client build pipeline** with these components:

1. **Directory Structure**: Move client source to `client/debug/` (top-level, parallel to `src/`)
2. **Build Step**: `scripts/build-client.ts` uses `Bun.build()` IIFE format → `public/`
3. **Static Serving**: `src/debug/server.ts` serves from `public/` via `Bun.file()`
4. **Client Testing**: `tests/client/debug/` with happy-dom preload (`tests/client-setup.ts`)
5. **TDD Hooks**: Extend `.hooks/tdd/test-resolver.mjs` to recognize `client/` as second source root
6. **CI Integration**: Build job creates artifact, downstream jobs depend on it
7. **Docker**: Multi-stage build with client build stage

## Consequences

### Positive

- Eliminated runtime transpilation (~500ms saved per server start)
- Enabled tree-shaking and minification for client bundle
- Client tests run in happy-dom environment (no jsdom overhead)
- TDD hooks apply appropriate rules:
  - `client/` → client TDD rules (no mutation testing for DOM manipulation)
  - `src/` → server TDD rules (full mutation testing)
- Single command: `bun start` builds client and runs server
- Clean mental model: `client/` = browser, `src/` = server

### Negative

- New build artifact (`public/`) must be gitignored but included in Docker
- Two test commands: `bun test` (server) and `bun test:client`
- CI workflow needs build job before check/e2e jobs
- Developers must remember to run `bun build:client` after changing client code

### Risks

- Risk: Stale `public/` directory causes confusion
  - Mitigation: `public/` in `.gitignore`, CI rebuilds fresh, `bun start` always builds
- Risk: `client/` tests require different mocking patterns
  - Mitigation: Documented in `tests/CLAUDE.md` and `client/CLAUDE.md`

## Implementation

### Files Created

| File                             | Purpose                                               |
| -------------------------------- | ----------------------------------------------------- |
| `client/debug/index.ts`          | Single entry point (replaces `dashboard-ui/index.ts`) |
| `client/debug/dashboard-api.ts`  | Dashboard API setup (renamed from `index.ts`)         |
| `client/debug/helpers.ts`        | DOM helpers (escapeHtml, formatTime, etc.)            |
| `client/debug/logs.ts`           | Log explorer functionality                            |
| `client/debug/trace-detail.ts`   | LLM trace detail modal rendering                      |
| `client/debug/session-detail.ts` | Session detail modal                                  |
| `client/debug/session-card.ts`   | Session card components                               |
| `client/debug/log-detail.ts`     | Log detail modal                                      |
| `client/debug/types.ts`          | Client-side type definitions                          |
| `client/debug/state.ts`          | Dashboard state management                            |
| `client/debug/handlers.ts`       | Event handlers                                        |
| `client/debug/sse.ts`            | Server-Sent Events client                             |
| `client/debug/search.ts`         | Search functionality                                  |
| `client/debug/init.ts`           | Bootstrap initialization                              |
| `client/debug/tree-view.ts`      | Tree view toggle handler                              |
| `client/debug/logs-bootstrap.ts` | Log bootstrap (renamed from `logs.ts`)                |
| `client/debug/dashboard.html`    | HTML template                                         |
| `client/debug/dashboard.css`     | Stylesheet                                            |
| `scripts/build-client.ts`        | Build script                                          |
| `tests/client-setup.ts`          | happy-dom preload                                     |
| `tests/client/debug/*.test.ts`   | 10 client test files                                  |

### Files Modified

| File                           | Change                                                   |
| ------------------------------ | -------------------------------------------------------- |
| `src/debug/server.ts`          | Remove `transpileDashboard()`, serve from `public/`      |
| `package.json`                 | Add `build:client`, `test:client` scripts; add happy-dom |
| `bunfig.toml`                  | Exclude `tests/client/**` from default test              |
| `.gitignore`                   | Add `public/`                                            |
| `.hooks/tdd/test-resolver.mjs` | Recognize `client/` source root                          |
| `.github/workflows/ci.yml`     | Add build job, artifact upload/download                  |
| `Dockerfile`                   | Multi-stage build with client build stage                |
| `knip.jsonc`                   | Add `client/` to project scope                           |
| `scripts/check.sh`             | Add `test:client` to full check                          |
| `CLAUDE.md`                    | Document new commands and architecture                   |

### Build Output

```
public/
├── dashboard.js      # IIFE bundle from client/debug/index.ts
├── dashboard.css     # Copied from client/debug/dashboard.css
└── dashboard.html    # Copied from client/debug/dashboard.html
```

### Testing Strategy

- **Server tests** (`bun test`): Run against `src/`, no DOM globals
- **Client tests** (`bun test:client`): Run against `client/`, happy-dom provides `document`, `window`, `HTMLElement`
- **Smoke tests**: Verify pre-built `public/dashboard.js` is served correctly

## Verification

All acceptance criteria met:

- [x] `bun build:client` creates `public/dashboard.js` (IIFE format)
- [x] `bun test:client` passes all client tests with happy-dom
- [x] `bun start` calls `build:client` before starting server
- [x] `bun check:full` includes `test:client`
- [x] CI build job creates artifact, check/e2e jobs download it
- [x] Docker multi-stage build includes `public/`
- [x] TDD hooks recognize `client/` paths (`client/debug/helpers.ts` → `tests/client/debug/helpers.test.ts`)

## Related Decisions

- ADR-0037: Debug Tracing Tool — Foundation for the debug dashboard
- ADR-0040: Debug Dashboard HTML — Previous iteration with runtime transpilation
- ADR-0043: TDD Hooks Integration — Extended to support `client/` source root

## References

- Design doc: `docs/superpowers/plans/2026-04-06-client-build-pipeline-design.md`
- Implementation plan: `docs/superpowers/plans/2026-04-06-client-build-pipeline.md`
- Bun.build() documentation: https://bun.sh/docs/bundler
- happy-dom: https://github.com/capricorn86/happy-dom
