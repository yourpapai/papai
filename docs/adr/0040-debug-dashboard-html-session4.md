<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0040: Debug Dashboard HTML — Session 4: Live Debug Dashboard UI

## Status

Accepted

## Context

The debug tracing system (Sessions 1-3) provides real-time visibility into papai's internal state via Server-Sent Events (SSE) and log aggregation. However, consuming raw SSE streams and JSON log endpoints requires manual tooling (curl, browser dev tools) which is cumbersome for ongoing development and troubleshooting.

We needed a visual dashboard that:

- Displays live system state (sessions, LLM traces, infrastructure metrics)
- Streams logs in real-time with client-side filtering
- Requires no external dependencies or build steps
- Serves from the existing debug server (port 9100)
- Uses only vanilla web technologies for simplicity

## Decision Drivers

- **Must work without npm packages** — dashboard code is served as static files
- **Must leverage Bun's build capability** — TypeScript transpilation at server startup
- **Must be self-contained** — single HTML file, single CSS file, transpiled JS
- **Must match terminal/hacker aesthetic** — consistent with developer tooling expectations
- **Must handle real-time updates** — SSE-based live streaming without polling
- **Must filter client-side** — no REST calls for log filtering after initial bootstrap

## Considered Options

### Option 1: Plain HTML/CSS/JS (No Build Step)

Serve vanilla JavaScript files directly without transpilation.

- **Pros**: Simplest setup, no build complexity
- **Cons**: No type safety, no linting for client code, inconsistent with TypeScript codebase
- **Verdict**: Rejected — we want type checking and linting for dashboard code

### Option 2: External Build Tool (Vite, esbuild)

Add a build step with Vite or esbuild to bundle dashboard assets.

- **Pros**: Industry standard, fast, optimized bundles
- **Cons**: Additional dependency, separate build process needed in dev workflow
- **Verdict**: Rejected — adds complexity for a simple dashboard; Bun can transpile natively

### Option 3: Bun.build() Transpilation (Selected)

Use Bun's native `Bun.build()` API to transpile TypeScript dashboard files at server startup, caching JS output in memory.

- **Pros**: No external dependencies, TypeScript type checking via `bun typecheck`, linting via `bun lint`, runs once at startup
- **Cons**: Slight delay on first server start (transpilation time)
- **Verdict**: Accepted — aligns with Bun runtime, keeps workflow simple

## Decision

We will use **Bun.build() transpilation at server startup** to serve TypeScript-authored dashboard files as JavaScript.

### Architecture

```
src/debug/
├── dashboard.html          # Static HTML markup
├── dashboard.css           # Terminal theme styles
├── dashboard-ui.ts         # Render functions, DOM manipulation
├── dashboard-types.ts      # Shared type definitions
└── dashboard/              # Modular state management (improvement over plan)
    ├── dashboard-state.ts  # Barrel exports
    ├── state.ts            # State object, LOG_CAP, renderAll()
    ├── handlers.ts         # SSE event handlers with rAF batching
    ├── sse.ts              # EventSource setup
    ├── logs.ts             # Log bootstrap with Zod validation
    └── init.ts             # Initialization orchestration
```

### Serving Strategy

```typescript
// Bun.build() at startup caches transpiled JS
const result = await Bun.build({
  entrypoints: ['src/debug/dashboard/dashboard-state.ts', 'src/debug/dashboard-ui.ts'],
})

// Routes:
// GET /dashboard            → dashboard.html (Bun.file)
// GET /dashboard.css        → dashboard.css  (Bun.file)
// GET /dashboard-state.js     → cached JS      (from Map)
// GET /dashboard-ui.js      → cached JS      (from Map)
// GET /dashboard.*          → 404 for unknown extensions
```

### Client-Side Architecture

**State Structure:**

```typescript
interface DashboardState {
  connected: boolean
  stats: { startedAt; totalMessages; totalLlmCalls; totalToolCalls }
  sessions: Map<string, Session>
  wizards: Map<string, DashboardWizard>
  scheduler: SchedulerInfo
  pollers: PollersInfo
  messageCache: MessageCacheInfo
  llmTraces: LlmTrace[]
  logs: LogEntry[] // Capped at 65,535 entries
  logScopes: Set<string>
}
```

**Initialization Sequence:**

1. `dashboard-ui.ts` loads first — registers render functions on `window.dashboard`
2. `dashboard-state.ts` loads second — defines state, calls `init()`
3. `init()` fetches `/logs` for backlog, then opens `EventSource('/events')`
4. SSE `state:init` populates all state → full UI render
5. Subsequent events → targeted re-renders

**Render Optimization:**

- `requestAnimationFrame` batching for log/session/trace renders
- Event delegation for trace row expansion (single listener on container)
- DOM updates via `innerHTML` for lists, `textContent` for scalars

## Consequences

### Positive

- **Type safety** — `bun typecheck` validates dashboard code
- **Lint consistency** — `bun lint` applies to dashboard TypeScript
- **No build step in dev workflow** — transpilation happens automatically at server start
- **Self-contained** — no external CDN dependencies
- **Modular structure** — `dashboard/` subdirectory with clean separation of concerns
- **Performance** — rAF batching prevents layout thrashing
- **Security** — CSS whitelist, HTML escaping, Zod validation on log bootstrap

### Negative

- **Startup delay** — Bun.build() adds ~100-200ms to debug server startup
- **Memory overhead** — Transpiled JS cached in `Map<string, string>`
- **No hot reload** — Must restart server to pick up dashboard code changes

### Neutral

- **Desktop-only** — No responsive breakpoints (acceptable for dev tool)

## Implementation Notes

### Improvements Over Original Plan

The actual implementation improved upon the original plan:

1. **Modular subdirectory** — Instead of two flat files (`dashboard-ui.ts`, `dashboard-state.ts`), we used a `dashboard/` directory with focused modules:
   - `state.ts` — State object and `LOG_CAP` constant
   - `handlers.ts` — Event handlers with `requestAnimationFrame` scheduling
   - `sse.ts` — SSE connection management
   - `logs.ts` — Log bootstrap with Zod validation
   - `init.ts` — Initialization orchestration

2. **Typed window namespace** — `window.dashboard` uses `DashboardAPI` interface instead of `(window as any)`

3. **Schema validation** — Full Zod schemas with `safeParse` functions for runtime validation

4. **No lint overrides needed** — Dashboard code passes strict lint rules without exceptions

### Files Created/Modified

**New files (15 total, ~650 lines):**

- `src/debug/dashboard.html` (67 lines)
- `src/debug/dashboard.css` (370 lines)
- `src/debug/dashboard-ui.ts` (228 lines)
- `src/debug/dashboard-types.ts` (93 lines)
- `src/debug/dashboard/state.ts` (45 lines)
- `src/debug/dashboard/handlers.ts` (243 lines)
- `src/debug/dashboard/sse.ts` (49 lines)
- `src/debug/dashboard/logs.ts` (34 lines)
- `src/debug/dashboard/init.ts` (15 lines)
- `src/debug/dashboard/dashboard-state.ts` (8 lines)

**Modified files:**

- `src/debug/server.ts` — Added `Bun.build()` transpilation, `jsCache` Map, `handleDashboardFile()`
- `tests/debug/server.test.ts` — Added static file route tests
- `src/debug/schemas.ts` — Added dashboard-specific Zod schemas

## Testing

### Automated Tests

- `GET /dashboard` returns HTML with correct content type
- `GET /dashboard.css` returns CSS with `#log-explorer` marker
- `GET /dashboard-state.js` returns JS with `EventSource` marker
- `GET /dashboard-ui.js` returns JS with `getElementById` marker
- `GET /dashboard.xyz` returns 404

All 57 debug tests passing.

### Manual Verification

- [x] Page loads with dark terminal theme
- [x] Header shows connection status (green pulse animation)
- [x] Header shows uptime and stats counters
- [x] Header shows infrastructure indicators
- [x] Sessions panel shows active user sessions
- [x] LLM Trace panel shows traces with expandable details
- [x] Log Explorer streams entries in real-time
- [x] Level/scope/search filters work client-side
- [x] Auto-scroll disengages on manual scroll, re-engages via button

## Related Decisions

- [ADR-0037](0037-debug-server-session1.md) — Debug Server Session 1: Event Bus + Server Skeleton
- [ADR-0038](0038-pino-log-pipeline-session2.md) — Debug Tracing Tool Session 2: Pino Log Pipeline
- [ADR-0039](0039-debug-instrumentation-session3.md) — Debug Tracing Tool Session 3: Instrumentation

## References

- Implementation plan: `docs/plans/done/2026-03-29-debug-session4-dashboard-html-implementation.md`
- Design document: `docs/plans/done/2026-03-29-debug-session4-dashboard-html-design.md`
- [Bun.build() documentation](https://bun.sh/docs/bundler)
- [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
