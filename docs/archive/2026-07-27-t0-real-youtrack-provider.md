<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Real YouTrack Provider in the T0 Story Lane — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the real `YouTrackProvider` inside the hermetic T0 story sandbox, reached through genuine runtime composition (manifest → approval → activation → registry → tool loop), served by a stateful fake YouTrack REST API over the story dispatcher.

**Architecture:** Three pieces. (1) `StrictHttpDispatcher` gains `serveHost()`, a host-scoped catch-all responder mode that replaces strict FIFO for simulated hosts. (2) The existing 661-line stateful fake YouTrack server moves from `tests/plugins/` into `tests/stories/harness/`, splitting its transport-free core from two transports — the current `Bun.serve` wrapper (for the in-process conformance test) and a new dispatcher responder (for T0). (3) A `realTaskProvider` scenario option approves the real plugin before runtime boot, seeds instance + context config, and registers the simulated host.

**Tech Stack:** Bun test runner, TypeScript (strict, `.js` import paths), Zod v4, existing story harness (`tests/stories/harness/`).

**Spec:** `docs/superpowers/specs/2026-07-27-t0-real-youtrack-provider-design.md`

## Global Constraints

- Runtime is **Bun**; test runner is `bun:test`. No Jest, no Vitest.
- **Import paths use the `.js` extension**, always — including relative imports of `.ts` files.
- **Never add lint-disable or type-ignore comments.** A hook policy blocks them; fix the underlying issue.
- Every new file starts with the four-line BUSL header (copy it verbatim from any existing file in the same directory). A `license-headers` check runs on commit.
- `max-lines` and `max-lines-per-function` are **off** under `tests/**` (`.oxlintrc.json:52-63`). Do not split files to satisfy a limit that does not apply; split only for clarity.
- Error extraction is always `error instanceof Error ? error.message : String(error)`.
- Use `p-limit` for bounded concurrency over remote ops, never unbounded `Promise.all`. No task here needs it.
- **Do not weaken the story I/O guards.** No retries, no widening of allowed network/process access beyond the explicit `serveHost` registration this plan adds.
- Every file this plan creates or modifies under `tests/stories/**` becomes a **frozen refactor-qualification input**. See Task 10 for the mandatory baseline procedure. Do not attempt to record a baseline mid-plan.
- Scenarios must not leave net `process.env` mutations; the I/O guard fails unrestored changes at teardown. No task here mutates env.

## Naming Contract

These exact names are used across tasks. Do not rename.

- Dispatcher method: `serveHost(host, respond, options?)`
- Simulator core module: `tests/stories/harness/fake-youtrack/state.ts` exporting `createFakeYouTrackState`, `resetFakeYouTrackState`, types `FakeYouTrackState`, `FakeYouTrackCtx`
- Simulator router: `tests/stories/harness/fake-youtrack/router.ts` exporting `handleFakeYouTrackRequest`
- HTTP transport: `tests/stories/harness/fake-youtrack/serve-over-http.ts` exporting `startFakeYouTrackServer`, type `FakeYouTrackServer`
- Dispatcher transport: `tests/stories/harness/fake-youtrack/responder.ts` exporting `createFakeYouTrackResponder`
- Fixture method: `fixtures.approveRealTaskProviderPlugin(type)`
- Scenario option: `realTaskProvider?: 'youtrack'`
- Scenario api addition: `world.resolveRealTaskProvider(context)`
- Simulated host: `youtrack.invalid`; base URL `https://youtrack.invalid`; token `fake-token`

## File Structure

| File | Responsibility |
| --- | --- |
| `tests/stories/harness/strict-http.ts` | **Modify.** Add `serveHost` + host registry + min-one-request check inside `verifyConsumed`. |
| `tests/stories/harness/strict-http.test.ts` | **Modify.** Contract tests for the new mode. |
| `tests/stories/harness/fake-youtrack/state.ts` | **Create.** Stored entity types, `FakeYouTrackState`, `FakeYouTrackCtx`, id/timestamp helpers, create/reset. |
| `tests/stories/harness/fake-youtrack/router.ts` | **Create.** All route handlers + `handleFakeYouTrackRequest(ctx)`. Transport-free. |
| `tests/stories/harness/fake-youtrack/serve-over-http.ts` | **Create.** The `Bun.serve` transport, for the in-process lane only. |
| `tests/stories/harness/fake-youtrack/responder.ts` | **Create.** `Request` → `FakeYouTrackCtx` → `Response` adapter for `serveHost`. |
| `tests/stories/harness/fake-youtrack/responder.test.ts` | **Create.** Contract tests for the adapter. |
| `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.ts` | **Delete.** Content moves to the four files above. |
| `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts` | **Modify.** Import paths only. |
| `tests/plugins/task-provider-youtrack/parity/provider-conformance.test.ts` | **Modify.** Import path only. |
| `tests/stories/harness/fixtures.ts` | **Modify.** `approveRealTaskProviderPlugin`, config-carrying `seedTaskInstance`, context-config seeding. |
| `tests/stories/harness/fixtures.test.ts` | **Modify.** Contract tests for the new fixture methods. |
| `tests/stories/harness/world.ts` | **Modify.** Accept `realTaskProvider`, approve before runtime boot, register the simulated host, expose `resolveRealTaskProvider`. |
| `tests/stories/harness/scenario.ts` | **Modify.** Thread `realTaskProvider` through `ScenarioOptions`; expose `world.resolveRealTaskProvider`. |
| `tests/stories/tasks/youtrack-real.story.test.ts` | **Create.** The four wiring scenarios. |
| `tests/stories/tasks/youtrack-conformance.story.test.ts` | **Create.** The six domain sweep scenarios. |
| `tests/stories/catalog/coverage.ts` | **Modify.** Ten new ids + mappings; extend `CATALOG_SOURCE`. |
| `tests/stories/harness/catalog-coverage.test.ts` | **Modify.** Bump the three hardcoded counts. |
| `scripts/story/coverage-floor.json` | **Modify.** Ratchet from a measured green run (Task 9). |

---

### Task 1: `serveHost` on the story HTTP dispatcher

**Files:**
- Modify: `tests/stories/harness/strict-http.ts`
- Test: `tests/stories/harness/strict-http.test.ts`

**Interfaces:**
- Consumes: `ScenarioEvents` from `./events.js` (already imported).
- Produces: `StrictHttpDispatcher.serveHost(host: string, respond: (request: Request) => Response | Promise<Response>, options?: Readonly<{ allowZeroRequests?: boolean; allowRedirect?: boolean }>): void`. Task 4 calls it; Task 3's responder is the `respond` argument.

Read `tests/stories/harness/strict-http.ts` in full before starting. It is 118 lines. Key existing facts: expectations are matched FIFO at `expectations[consumed]` with exact `(method, url)` equality; `verifyConsumed()` throws on any unconsumed remainder; `events.record('http.request', ...)` and `('http.response', ...)` payload shapes must not change.

- [ ] **Step 1: Write the failing tests**

Append to `tests/stories/harness/strict-http.test.ts`. Match the file's existing setup style for constructing a dispatcher and events (read the top of the file first and reuse it).

```typescript
describe('serveHost', () => {
  test('serves every request to a registered host in any order and any count', async () => {
    const { http } = makeDispatcher()
    http.serveHost('sim.invalid', (request) => new Response(new URL(request.url).pathname))

    expect(await (await http.fetch('https://sim.invalid/b')).text()).toBe('/b')
    expect(await (await http.fetch('https://sim.invalid/a')).text()).toBe('/a')
    expect(await (await http.fetch('https://sim.invalid/a')).text()).toBe('/a')
    expect(() => {
      http.verifyConsumed()
    }).not.toThrow()
  })

  test('leaves other hosts on the strict FIFO path', async () => {
    const { http } = makeDispatcher()
    http.serveHost('sim.invalid', () => new Response('sim'))
    http.expect({ method: 'GET', url: 'https://other.invalid/x' }, () => new Response('other'))

    expect(await (await http.fetch('https://sim.invalid/anything')).text()).toBe('sim')
    expect(await (await http.fetch('https://other.invalid/x')).text()).toBe('other')
    expect(() => {
      http.verifyConsumed()
    }).not.toThrow()
  })

  test('rejects an undeclared host even when another host is simulated', async () => {
    const { http } = makeDispatcher()
    http.serveHost('sim.invalid', () => new Response('sim'))

    await expect(http.fetch('https://elsewhere.invalid/x')).rejects.toThrow('undeclared request')
  })

  test('throws at declaration time when serveHost collides with an expectation', () => {
    const { http } = makeDispatcher()
    http.expect({ method: 'GET', url: 'https://sim.invalid/x' }, () => new Response('x'))

    expect(() => {
      http.serveHost('sim.invalid', () => new Response('sim'))
    }).toThrow('already has declared expectations')
  })

  test('throws at declaration time when an expectation collides with a simulated host', () => {
    const { http } = makeDispatcher()
    http.serveHost('sim.invalid', () => new Response('sim'))

    expect(() => {
      http.expect({ method: 'GET', url: 'https://sim.invalid/x' }, () => new Response('x'))
    }).toThrow('is served by a host simulator')
  })

  test('throws at declaration time when the same host is registered twice', () => {
    const { http } = makeDispatcher()
    http.serveHost('sim.invalid', () => new Response('sim'))

    expect(() => {
      http.serveHost('sim.invalid', () => new Response('again'))
    }).toThrow('is already served by a host simulator')
  })

  test('verifyConsumed fails a simulated host that saw no requests', () => {
    const { http } = makeDispatcher()
    http.serveHost('sim.invalid', () => new Response('sim'))

    expect(() => {
      http.verifyConsumed()
    }).toThrow('host simulator received no requests: sim.invalid')
  })

  test('allowZeroRequests exempts a host from the min-one-request check', () => {
    const { http } = makeDispatcher()
    http.serveHost('sim.invalid', () => new Response('sim'), { allowZeroRequests: true })

    expect(() => {
      http.verifyConsumed()
    }).not.toThrow()
  })

  test('rejects a redirect from a simulated host unless allowRedirect is set', async () => {
    const { http } = makeDispatcher()
    http.serveHost('sim.invalid', () => new Response(null, { status: 302, headers: { location: '/next' } }))

    await expect(http.fetch('https://sim.invalid/x')).rejects.toThrow('redirect response rejected')
  })

  test('permits a redirect from a simulated host when allowRedirect is set', async () => {
    const { http } = makeDispatcher()
    http.serveHost('sim.invalid', () => new Response(null, { status: 302, headers: { location: '/next' } }), {
      allowRedirect: true,
    })

    expect((await http.fetch('https://sim.invalid/x')).status).toBe(302)
  })

  test('records host-served traffic in the event trace', async () => {
    const { http, events } = makeDispatcher()
    http.serveHost('sim.invalid', () => new Response('sim'))
    await http.fetch('https://sim.invalid/x')

    expect(events.recorded().some((event) => event.kind === 'http.request')).toBe(true)
    expect(events.recorded().some((event) => event.kind === 'http.response')).toBe(true)
  })

  test('surfaces a throwing host responder with the scenario failure prefix', async () => {
    const { http } = makeDispatcher()
    http.serveHost('sim.invalid', () => {
      throw new Error('boom')
    })

    await expect(http.fetch('https://sim.invalid/x')).rejects.toThrow('HTTP responder failed')
  })
})
```

If the existing file has no `makeDispatcher()` helper, add one at the top of the file that returns `{ http, events }` built the same way the existing tests build them, and leave the existing tests untouched. The last test's `events.recorded()` accessor may be named differently — read `tests/stories/harness/events.ts` and use whatever accessor the existing tests in this file use to inspect recorded events.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/stories/harness/strict-http.test.ts`
Expected: FAIL — `http.serveHost is not a function`.

- [ ] **Step 3: Implement `serveHost`**

In `tests/stories/harness/strict-http.ts`:

Add the option and host types near the existing `StrictHttpExpectation`:

```typescript
export type StrictHttpHostOptions = Readonly<{
  allowZeroRequests?: boolean
  allowRedirect?: boolean
}>

type HostSimulator = Readonly<{
  respond: Responder
  allowZeroRequests: boolean
  allowRedirect: boolean
}>
```

Add `serveHost` to the `StrictHttpDispatcher` type, between `expect` and `fetch`:

```typescript
  serveHost(host: string, respond: Responder, options?: StrictHttpHostOptions): void
```

Add a host-normalizer beside the existing `normalizeUrl`/`normalizeMethod`:

```typescript
const normalizeHost = (host: string): string => host.toLowerCase()
const hostOf = (url: string): string => normalizeHost(new URL(url).hostname)
```

Inside `createStrictHttpDispatcher`, add two mutable maps beside `expectations` and `consumed`:

```typescript
  const hosts: Map<string, HostSimulator> = new Map()
  const hostRequestCounts: Map<string, number> = new Map()
```

Guard `expect()` — insert at the top of its body, before it appends:

```typescript
      const host = hostOf(normalizeUrl(request.url))
      if (hosts.has(host)) {
        throw new Error(events.formatFailure(`${host} is served by a host simulator; remove the expect() call`))
      }
```

Implement `serveHost`:

```typescript
    serveHost(host, respond, options): void {
      const normalized = normalizeHost(host)
      if (hosts.has(normalized)) {
        throw new Error(events.formatFailure(`${normalized} is already served by a host simulator`))
      }
      const collision = expectations.some(({ request }) => hostOf(request.url) === normalized)
      if (collision) {
        throw new Error(
          events.formatFailure(`${normalized} already has declared expectations; remove them or drop serveHost`),
        )
      }
      hosts.set(normalized, {
        respond,
        allowZeroRequests: options?.allowZeroRequests ?? false,
        allowRedirect: options?.allowRedirect ?? false,
      })
    },
```

In `fetch()`, after the existing `events.record('http.request', ...)` call and **before** `const pending = expectations[consumed]`, branch to the host path:

```typescript
      const simulator = hosts.get(hostOf(actual.url))
      if (simulator !== undefined) {
        hostRequestCounts.set(hostOf(actual.url), (hostRequestCounts.get(hostOf(actual.url)) ?? 0) + 1)
        const hostExpectation: PendingExpectation = {
          request: { ...actual, allowRedirect: simulator.allowRedirect },
          respond: simulator.respond,
        }
        return await dispatch(hostExpectation, request, actual)
      }
```

The existing body of `fetch` from `runResponder` through the redirect check and `events.record('http.response', ...)` must be extracted into a local `dispatch(expectation, request, actual)` helper so both paths share it verbatim — do not duplicate the in-flight tracking, the redirect guard, or the response recording. `dispatch` keeps the exact same event payloads.

Extend `verifyConsumed()` to check both, reporting every failure rather than the first:

```typescript
    verifyConsumed(): void {
      const problems: string[] = []
      const remaining = expectations.slice(consumed)
      if (remaining.length > 0) {
        problems.push(`unconsumed HTTP expectations: ${remaining.map(({ request }) => describe(request)).join(', ')}`)
      }
      for (const [host, simulator] of hosts) {
        if (simulator.allowZeroRequests) continue
        if ((hostRequestCounts.get(host) ?? 0) === 0) {
          problems.push(`host simulator received no requests: ${host}`)
        }
      }
      if (problems.length === 0) return
      throw new Error(events.formatFailure(problems.join('; ')))
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/stories/harness/strict-http.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Verify no other harness contract regressed**

Run: `bun test:stories:contracts`
Expected: PASS. `fake-magi.test.ts` and `fake-mcp-server.test.ts` exercise `expect`/`verifyConsumed` heavily; they must be untouched by this change.

- [ ] **Step 6: Commit**

```bash
git add tests/stories/harness/strict-http.ts tests/stories/harness/strict-http.test.ts
git commit -m "feat(stories): add host-scoped responder mode to the story HTTP dispatcher"
```

---

### Task 2: Move the fake YouTrack server into the story harness

**Files:**
- Create: `tests/stories/harness/fake-youtrack/state.ts`
- Create: `tests/stories/harness/fake-youtrack/router.ts`
- Create: `tests/stories/harness/fake-youtrack/serve-over-http.ts`
- Delete: `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.ts`
- Modify: `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts`
- Modify: `tests/plugins/task-provider-youtrack/parity/provider-conformance.test.ts:11`

**Interfaces:**
- Produces:
  - `state.ts`: `createFakeYouTrackState(): FakeYouTrackState`, `resetFakeYouTrackState(state: FakeYouTrackState): void`, and exported types `FakeYouTrackState`, `FakeYouTrackCtx` (the current private `State` and `Ctx`, renamed and exported).
  - `router.ts`: `handleFakeYouTrackRequest(ctx: FakeYouTrackCtx): Response` — runs the handler chain and returns the 404 fallback when nothing matches. Never returns `undefined`.
  - `serve-over-http.ts`: `startFakeYouTrackServer(): FakeYouTrackServer` with the unchanged `{ url, stop, reset }` shape.
- Consumed by: Task 3 (`responder.ts` imports `state.ts` + `router.ts`), and the in-process conformance test (imports `serve-over-http.ts`).

This task is a **pure refactor with zero behavior change**. The existing `fake-youtrack-server.test.ts` (484 lines) is the safety net: it must pass unchanged apart from its import statements.

- [ ] **Step 1: Record the current green baseline**

Run: `bun test tests/plugins/task-provider-youtrack/parity/`
Expected: PASS. Note the test count — it must be identical at the end of this task.

- [ ] **Step 2: Create the state module**

Create `tests/stories/harness/fake-youtrack/state.ts` with the BUSL header, then move these from `fake-youtrack-server.ts` verbatim: the doc comment block (lines 8-15), `StoredProject`, `StoredIssue`, `StoredComment`, `StoredLink`, the bundle seed constants (`STATE_BUNDLE_ID`, `PRIORITY_BUNDLE_ID`, `STATE_VALUES`, `PRIORITY_VALUES`), `createState`, `nextId`, `nextTs`.

Rename and export: `State` → `export type FakeYouTrackState`, `Ctx` → `export type FakeYouTrackCtx`, `createState` → `export const createFakeYouTrackState`. Export `nextId`, `nextTs`, and the four bundle constants (the router needs them). Keep the `Stored*` types exported too — the router references them.

Add the reset function, moving the body out of the current `startFakeYouTrackServer` closure (lines 652-659):

```typescript
export const resetFakeYouTrackState = (state: FakeYouTrackState): void => {
  state.projects.clear()
  state.issues.clear()
  state.issuesByReadable.clear()
  state.comments.clear()
  state.links.clear()
  state.seq = 0
}
```

- [ ] **Step 3: Create the router module**

Create `tests/stories/harness/fake-youtrack/router.ts` with the BUSL header. Move verbatim from `fake-youtrack-server.ts`: the response helpers (`json`, `noContent`, `errorResponse`), the path matcher, every `handle*` function (`handleProjects`, `handleIssues`, `handleComments`, `handleRelations`) and every helper they call (`findIssue`, `matchPath`, `LINK_TYPES`, `decodeLinkId`, `readLinkTargetId`, and all others between lines 119 and 619). Import the types, id helpers, and bundle constants from `./state.js`.

Export the entry point, moving the handler-chain loop and 404 fallback out of the `Bun.serve` callback:

```typescript
const handlers: ReadonlyArray<(ctx: FakeYouTrackCtx) => Response | undefined> = [
  handleProjects,
  handleIssues,
  handleComments,
  handleRelations,
]

export const handleFakeYouTrackRequest = (ctx: FakeYouTrackCtx): Response => {
  for (const handler of handlers) {
    const response = handler(ctx)
    if (response !== undefined) return response
  }
  return errorResponse(404, `no route for ${ctx.method} ${ctx.path}`)
}
```

Export `json` and `errorResponse` as well — `responder.test.ts` in Task 3 asserts on the 404 shape.

- [ ] **Step 4: Create the HTTP transport module**

Create `tests/stories/harness/fake-youtrack/serve-over-http.ts` with the BUSL header:

```typescript
import type { Server } from 'bun'

import { createFakeYouTrackState, resetFakeYouTrackState, type FakeYouTrackCtx } from './state.js'
import { handleFakeYouTrackRequest } from './router.js'

export type FakeYouTrackServer = {
  url: string
  stop(): Promise<void>
  reset(): void
}

/** Live-socket transport for the in-process conformance lane. The T0 story lane
 *  uses createFakeYouTrackResponder (./responder.js) instead: the story sandbox
 *  I/O guard forbids opening a real socket. */
export const startFakeYouTrackServer = (): FakeYouTrackServer => {
  const state = createFakeYouTrackState()
  const server: Server<undefined> = Bun.serve({
    port: 0,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url)
      const hasBody = req.method === 'POST' || req.method === 'PUT'
      const bodyText = hasBody ? await req.text() : ''
      const body: unknown = bodyText.length > 0 ? JSON.parse(bodyText) : undefined
      const ctx: FakeYouTrackCtx = { method: req.method, path: url.pathname, query: url.searchParams, body, state }
      return handleFakeYouTrackRequest(ctx)
    },
  })

  return {
    url: `http://localhost:${server.port}`,
    stop: async (): Promise<void> => {
      await server.stop(true)
    },
    reset: (): void => {
      resetFakeYouTrackState(state)
    },
  }
}
```

- [ ] **Step 5: Delete the old file and repoint its consumers**

```bash
git rm tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.ts
```

In `tests/plugins/task-provider-youtrack/parity/provider-conformance.test.ts`, replace the line 11 import:

```typescript
import {
  startFakeYouTrackServer,
  type FakeYouTrackServer,
} from '../../../stories/harness/fake-youtrack/serve-over-http.js'
```

In `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts`, repoint every import to the new modules. Change **only** import statements; do not touch a single assertion. If that file imported internals that are now split across `state.ts` and `router.ts`, import from both.

- [ ] **Step 6: Run the moved tests**

Run: `bun test tests/plugins/task-provider-youtrack/parity/`
Expected: PASS with the identical test count from Step 1.

- [ ] **Step 7: Verify nothing else referenced the old path**

Run: `bash -c 'grep -rn "fake-youtrack-server" --include="*.ts" tests/ scripts/ src/ plugins/'`
Expected: only matches inside `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts` (its own filename in a comment or describe string, if any). No unresolved import paths.

- [ ] **Step 8: Commit**

```bash
git add tests/stories/harness/fake-youtrack/ tests/plugins/task-provider-youtrack/parity/
git commit -m "refactor(stories): move the fake YouTrack server into the frozen story harness"
```

---

### Task 3: Dispatcher transport for the simulator

**Files:**
- Create: `tests/stories/harness/fake-youtrack/responder.ts`
- Test: `tests/stories/harness/fake-youtrack/responder.test.ts`

**Interfaces:**
- Consumes: `createFakeYouTrackState`, `FakeYouTrackCtx` from `./state.js`; `handleFakeYouTrackRequest` from `./router.js` (Task 2).
- Produces: `createFakeYouTrackResponder(): (request: Request) => Promise<Response>`. Task 4 passes the result straight to `http.serveHost('youtrack.invalid', responder)`.

Each call constructs fresh state, because a scenario is a fresh world — there is no `reset()` on this transport.

- [ ] **Step 1: Write the failing tests**

Create `tests/stories/harness/fake-youtrack/responder.test.ts` with the BUSL header:

```typescript
import { describe, expect, test } from 'bun:test'

import { createFakeYouTrackResponder } from './responder.js'

describe('createFakeYouTrackResponder', () => {
  test('creates a project and reads it back through the responder', async () => {
    const respond = createFakeYouTrackResponder()

    const created = await respond(
      new Request('https://youtrack.invalid/api/admin/projects?fields=id,name,shortName', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Responder Project', shortName: 'RP' }),
      }),
    )
    expect(created.status).toBe(200)
    const project = (await created.json()) as { id: string; name: string }
    expect(project.name).toBe('Responder Project')

    const listed = await respond(new Request('https://youtrack.invalid/api/admin/projects?fields=id,name,shortName'))
    const projects = (await listed.json()) as ReadonlyArray<{ id: string }>
    expect(projects.map((entry) => entry.id)).toContain(project.id)
  })

  test('404s an unrouted path with the router message', async () => {
    const respond = createFakeYouTrackResponder()

    const response = await respond(new Request('https://youtrack.invalid/api/nope'))

    expect(response.status).toBe(404)
    expect((await response.json()) as { error: string }).toEqual({
      error: 'no route for GET /api/nope',
      error_description: 'no route for GET /api/nope',
    })
  })

  test('passes the query string through to the router', async () => {
    const respond = createFakeYouTrackResponder()

    const response = await respond(new Request('https://youtrack.invalid/api/issueLinkTypes?fields=id,name,directed'))

    expect(response.status).toBe(200)
    expect(((await response.json()) as ReadonlyArray<{ name: string }>).length).toBeGreaterThan(0)
  })

  test('gives each responder independent state', async () => {
    const first = createFakeYouTrackResponder()
    const second = createFakeYouTrackResponder()

    await first(
      new Request('https://youtrack.invalid/api/admin/projects?fields=id,name,shortName', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Only In First', shortName: 'OIF' }),
      }),
    )

    const listed = await second(
      new Request('https://youtrack.invalid/api/admin/projects?fields=id,name,shortName'),
    )
    expect((await listed.json()) as ReadonlyArray<unknown>).toHaveLength(0)
  })

  test('tolerates a POST with no body', async () => {
    const respond = createFakeYouTrackResponder()

    const response = await respond(new Request('https://youtrack.invalid/api/nope', { method: 'POST' }))

    expect(response.status).toBe(404)
  })
})
```

The exact YouTrack paths and `fields=` projections above must match what the router actually implements. Before running, read `tests/stories/harness/fake-youtrack/router.ts` and confirm the project create/list path and the `issueLinkTypes` path; if they differ, correct the test URLs to the router's real paths rather than changing the router.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/stories/harness/fake-youtrack/responder.test.ts`
Expected: FAIL — cannot resolve `./responder.js`.

- [ ] **Step 3: Implement the responder**

Create `tests/stories/harness/fake-youtrack/responder.ts` with the BUSL header:

```typescript
import { handleFakeYouTrackRequest } from './router.js'
import { createFakeYouTrackState, type FakeYouTrackCtx } from './state.js'

const readJsonBody = async (request: Request): Promise<unknown> => {
  const hasBody = request.method === 'POST' || request.method === 'PUT'
  if (!hasBody) return undefined
  const text = await request.text()
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(
      `Fake YouTrack expected valid JSON for ${request.method} ${new URL(request.url).pathname}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

/** Dispatcher transport for the fake YouTrack API: adapts a Request into the
 *  router's transport-free Ctx. Register with http.serveHost('youtrack.invalid', ...).
 *  Fresh state per call — a scenario is a fresh world, so nothing ever resets. */
export const createFakeYouTrackResponder = (): ((request: Request) => Promise<Response>) => {
  const state = createFakeYouTrackState()
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const ctx: FakeYouTrackCtx = {
      method: request.method,
      path: url.pathname,
      query: url.searchParams,
      body: await readJsonBody(request),
      state,
    }
    return handleFakeYouTrackRequest(ctx)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/stories/harness/fake-youtrack/responder.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/harness/fake-youtrack/responder.ts tests/stories/harness/fake-youtrack/responder.test.ts
git commit -m "feat(stories): add a dispatcher transport for the fake YouTrack API"
```

---

### Task 4: The `realTaskProvider` seam and the first wiring story

**Files:**
- Modify: `tests/stories/harness/fixtures.ts`
- Modify: `tests/stories/harness/fixtures.test.ts`
- Modify: `tests/stories/harness/world.ts:395-470`
- Modify: `tests/stories/harness/scenario.ts:303`
- Create: `tests/stories/tasks/youtrack-real.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`
- Modify: `tests/stories/harness/catalog-coverage.test.ts:114-115,216,225`

**Interfaces:**
- Consumes: `createFakeYouTrackResponder` (Task 3); `serveHost` (Task 1).
- Produces:
  - `fixtures.approveRealTaskProviderPlugin(type: 'youtrack'): void`
  - `fixtures.seedTaskInstance(input?: Readonly<{ id?: string; type?: string; config?: Record<string, string> }>): void` — `config` is new; existing callers are unaffected.
  - `fixtures.seedProviderContextConfig(input: Readonly<{ contextId: string; pluginId: string; key: string; value: string }>): void`
  - `ScenarioOptions` gains `realTaskProvider?: 'youtrack'`
  - `world.resolveRealTaskProvider(context: ContextHandle): Promise<TaskProvider>` on the scenario api — used by Tasks 5-8.

The seam is not independently observable, so its deliverable is the first wiring story. Read all of `tests/stories/harness/world.ts:395-470` and `tests/stories/harness/fixtures.ts:250-300,340-500` before starting.

Three facts that drive the implementation:

1. **Approval must precede runtime boot.** `src/plugins/loader.ts:213` activates only approved plugins, and activation runs inside `createPapaiRuntime` (`world.ts:465`). So `approveRealTaskProviderPlugin` is called in `createScenarioWorld` next to `fixtures.registerTaskProvider()` (`world.ts:437`), never from a `given.*`.
2. **Config is split across two scopes.** `plugins/task-provider-youtrack/plugin.json` declares `baseUrl` as `scope: "instance"` and `token` as `scope: "context"`. The resolver reads instance fields off `TaskInstance.config` and context fields via `getConfigValue(contextId, storageKey)`, where a plugin descriptor's storage key is `plugin:${pluginId}:provider:${field.key}` (`src/providers/resolver.ts:37-40`). So the token is stored under the literal key `plugin:task-provider-youtrack:provider:token`.
3. **No type collision.** `registerTaskProvider()` claims `'kaneo'` and asserts ownership (`fixtures.ts:481-489`). YouTrack claims `'youtrack'`. Leave that assertion exactly as it is.

- [ ] **Step 1: Write the failing fixture contract tests**

Append to `tests/stories/harness/fixtures.test.ts`, following the file's existing setup style:

```typescript
describe('approveRealTaskProviderPlugin', () => {
  test('approves the real YouTrack plugin so its type becomes resolvable', async () => {
    const fixtures = createScenarioFixtures({ taskProvider: new MemoryTaskProvider() })
    await fixtures.setupDatabase()

    fixtures.approveRealTaskProviderPlugin('youtrack')
    await activateApprovedPlugins({ pluginDirectory: 'plugins' })

    const descriptor = getTaskProviderDescriptor('youtrack')
    expect(descriptor).toBeDefined()
    expect(descriptor?.source).toEqual({ plugin: 'task-provider-youtrack' })
  })

  test('leaves the kaneo memory-fake registration intact', async () => {
    const fixtures = createScenarioFixtures({ taskProvider: new MemoryTaskProvider() })
    await fixtures.setupDatabase()

    fixtures.approveRealTaskProviderPlugin('youtrack')
    expect(() => {
      fixtures.registerTaskProvider()
    }).not.toThrow()
  })
})

describe('seedTaskInstance config passthrough', () => {
  test('stores a caller-supplied instance config', () => {
    const fixtures = createScenarioFixtures({ taskProvider: new MemoryTaskProvider() })
    fixtures.seedTaskInstance({ id: 'ti-1', type: 'youtrack', config: { baseUrl: 'https://youtrack.invalid' } })

    expect(getTaskInstance('ti-1')?.config['baseUrl']).toBe('https://youtrack.invalid')
  })
})

describe('seedProviderContextConfig', () => {
  test('writes the plugin-scoped provider config key the resolver reads', () => {
    const fixtures = createScenarioFixtures({ taskProvider: new MemoryTaskProvider() })
    fixtures.seedProviderContextConfig({
      contextId: 'ctx-1',
      pluginId: 'task-provider-youtrack',
      key: 'token',
      value: 'fake-token',
    })

    expect(getConfigValue('ctx-1', 'plugin:task-provider-youtrack:provider:token')).toBe('fake-token')
  })
})
```

Add whatever imports these need (`getTaskProviderDescriptor` from `../../../src/providers/registry.js`, `getTaskInstance`, `getConfigValue`, and the plugin activation entry point). Read `src/plugins/loader.ts` to find the real name of the activate-all export and use it; the placeholder `activateApprovedPlugins` above must be replaced with the actual exported name and its real signature. Await `setupDatabase()` before any DB-touching fixture call.

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/stories/harness/fixtures.test.ts`
Expected: FAIL — `fixtures.approveRealTaskProviderPlugin is not a function`.

- [ ] **Step 3: Implement the fixture methods**

In `tests/stories/harness/fixtures.ts`, add to the `ScenarioFixtures` type (near `registerTaskProvider(): void` at line 290) and implement:

```typescript
  approveRealTaskProviderPlugin(type: 'youtrack'): void
  seedProviderContextConfig(input: Readonly<{ contextId: string; pluginId: string; key: string; value: string }>): void
```

```typescript
const REAL_TASK_PROVIDER_PLUGIN_IDS: Readonly<Record<'youtrack', string>> = { youtrack: 'task-provider-youtrack' }
```

```typescript
    approveRealTaskProviderPlugin(type): void {
      const pluginId = REAL_TASK_PROVIDER_PLUGIN_IDS[type]
      const discovered = pluginRegistry.discoverAll().find((plugin) => plugin.manifest.id === pluginId)
      if (discovered === undefined) {
        throw new Error(`Real task provider plugin not discovered on disk: ${pluginId}`)
      }
      pluginRegistry.registerDiscovered(discovered)
      const approved = pluginRegistry.approve(pluginId, 'scenario-admin', discovered.manifestHash)
      if (!approved) throw new Error(`Failed to approve real task provider plugin: ${pluginId}`)
    },
    seedProviderContextConfig(input): void {
      setConfigValue(input.contextId, `plugin:${input.pluginId}:provider:${input.key}`, input.value)
    },
```

`pluginRegistry.discoverAll()` is the placeholder for whatever real discovery entry point exists — read `src/plugins/` and use the actual function that reads `plugins/` off disk and returns `DiscoveredPlugin` records with a `manifestHash`. The manifest hash **must** come from real discovery, not be synthesized; approving with a wrong hash is exactly the failure this story is meant to prove works.

Extend `seedTaskInstance` to forward a config:

```typescript
    seedTaskInstance(input = {}): void {
      seedTestTaskInstance({
        id: input.id ?? SCENARIO_TASK_INSTANCE_ID,
        type: input.type ?? 'kaneo',
        config: input.config ?? {},
      })
    },
```

Import `setConfigValue` from `../../../src/config.js`.

- [ ] **Step 4: Run to verify the fixture tests pass**

Run: `bun test tests/stories/harness/fixtures.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the option through world and scenario**

In `tests/stories/harness/scenario.ts:303`:

```typescript
export type ScenarioOptions = Readonly<{ debugEnabled?: boolean; realTaskProvider?: 'youtrack' }>
```

Thread it through `executeScenario` into `createScenarioWorld` alongside the existing `debugEnabled` pass-through at `scenario.ts:937`.

In `tests/stories/harness/world.ts`, in `createScenarioWorld`'s options type add `realTaskProvider?: 'youtrack'`. Then immediately after `fixtures.registerTaskProvider()` (line 437):

```typescript
    if (options.realTaskProvider === 'youtrack') {
      fixtures.approveRealTaskProviderPlugin('youtrack')
      http.serveHost(REAL_YOUTRACK_HOST, createFakeYouTrackResponder())
    }
```

with, at module scope:

```typescript
const REAL_YOUTRACK_HOST = 'youtrack.invalid'
export const REAL_YOUTRACK_BASE_URL = `https://${REAL_YOUTRACK_HOST}`
export const REAL_YOUTRACK_TOKEN = 'fake-token'
```

Import `createFakeYouTrackResponder` from `./fake-youtrack/responder.js`.

Add `resolveRealTaskProvider` to the scenario api in `scenario.ts`, beside the existing `world` surface. It resolves through the same resolver production uses, so the sweep in Task 8 proves resolution rather than bypassing it:

```typescript
    async resolveRealTaskProvider(context: ContextHandle): Promise<TaskProvider> {
      const provider = await defaultTaskProviderResolver.resolve(scopedConfigContextId(context))
      if (provider === null) throw new Error('Scenario expected a resolvable real task provider')
      return provider
    },
```

Read `src/providers/resolver.ts` for the actual exported resolver name and its `resolve` signature, and use it. `scopedConfigContextId` already exists at `scenario.ts:308`.

Finally, extend `given.taskInstance` so a YouTrack instance carries its base URL. It is positional today (`scenario.ts:530`); keep the signature and branch on the provider type:

```typescript
    taskInstance(id = world.ids.next('task-instance'), providerType = 'kaneo'): TaskInstanceHandle {
      prerequisite('given.taskInstance')
      world.fixtures.seedTaskInstance({
        id,
        type: providerType,
        ...(providerType === 'youtrack' ? { config: { baseUrl: REAL_YOUTRACK_BASE_URL } } : {}),
      })
      return makeTaskInstanceHandle(id, providerType)
    },
```

And seed the context token inside `given.assign`, right after the existing `assignContext` call, so the token lands on the same config context the resolver will read:

```typescript
      if (taskInstance.providerType === 'youtrack') {
        world.fixtures.seedProviderContextConfig({
          contextId: scopedConfigContextId(context),
          pluginId: 'task-provider-youtrack',
          key: 'token',
          value: REAL_YOUTRACK_TOKEN,
        })
      }
```

If `TaskInstanceHandle` does not already carry `providerType`, read `makeTaskInstanceHandle` in `world.ts:168` area and add it — it is already passed in as the second argument.

- [ ] **Step 6: Write the first wiring story**

Create `tests/stories/tasks/youtrack-real.story.test.ts` with the BUSL header:

```typescript
import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

scenario(
  'SCN-task-youtrack-real-create: activates the real YouTrack plugin and creates a task over fake REST',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance(undefined, 'youtrack')
    given.assign(dm, instance)
    given.llm([
      callCapability('tasks.projects.create', { name: 'Real YouTrack' }),
      answer('Project created.'),
    ])

    await when.message(alice, dm, 'Create a project called Real YouTrack')
    then.replyTo(alice).equals('Project created.')
  },
  { realTaskProvider: 'youtrack' },
)
```

- [ ] **Step 7: Add the catalog record**

In `tests/stories/catalog/coverage.ts`, append to `CATALOG_SCENARIO_IDS` under a new comment banner:

```typescript
  // @0 — real YouTrack provider inside the hermetic lane (t0-real-youtrack-provider)
  'SCN-task-youtrack-real-create',
```

and to `EXECUTABLE_STORY_MAPPINGS` (omit `provingTier`; omitted means Tier 0):

```typescript
  'SCN-task-youtrack-real-create': {
    verifiedAt: '2026-07-27',
    storyIds: [
      'tests/stories/tasks/youtrack-real.story.test.ts#SCN-task-youtrack-real-create: activates the real YouTrack plugin and creates a task over fake REST',
    ],
  },
```

Extend `CATALOG_SOURCE` by appending to its string: `; extended 2026-07-27 with 10 real-YouTrack (@0) ids (t0-real-youtrack-provider)`.

In `tests/stories/harness/catalog-coverage.test.ts` bump `165` → `166` on lines 114-115 and `140` → `141` on lines 216 and 225. Do **not** touch line 239 (`parityRecords` is keyed off the `SCN-parity-` prefix, which these ids deliberately avoid).

- [ ] **Step 8: Run the story**

Run: `bun test:stories`
Expected: PASS, including the new scenario. If it fails with `Cannot resolve task provider: missing config`, the token storage key or the instance `baseUrl` is wrong — re-read `src/providers/resolver.ts:37-49`. If it fails with an undeclared-request error naming `youtrack.invalid`, `serveHost` was registered after the runtime booted; move it before `createPapaiRuntime`.

- [ ] **Step 9: Run the contract lane**

Run: `bun test:stories:contracts`
Expected: PASS, including `catalog-coverage.test.ts` with the bumped counts.

- [ ] **Step 10: Commit**

```bash
git add tests/stories/harness/fixtures.ts tests/stories/harness/fixtures.test.ts \
  tests/stories/harness/world.ts tests/stories/harness/scenario.ts \
  tests/stories/tasks/youtrack-real.story.test.ts tests/stories/catalog/coverage.ts \
  tests/stories/harness/catalog-coverage.test.ts
git commit -m "feat(stories): reach the real YouTrack provider from the hermetic story lane"
```

---

### Task 5: Custom-field wiring story

**Files:**
- Modify: `tests/stories/tasks/youtrack-real.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`
- Modify: `tests/stories/harness/catalog-coverage.test.ts`

**Interfaces:**
- Consumes: the Task 4 seam (`{ realTaskProvider: 'youtrack' }`, `given.taskInstance(undefined, 'youtrack')`).
- Produces: nothing new.

This story exists to execute `plugins/task-provider-youtrack/field-engine.ts`, `custom-field-values.ts`, and `bundle-cache.ts` through the runtime rather than in isolation. The simulator seeds state and priority bundle values (`STATE_VALUES = ['Open', 'In Progress', 'Done']`, `PRIORITY_VALUES = ['high', 'normal', 'low']` in `state.ts`); the story must use values from those lists or the provider will reject them.

- [ ] **Step 1: Write the failing story**

Append to `tests/stories/tasks/youtrack-real.story.test.ts`:

```typescript
scenario(
  'SCN-task-youtrack-real-fields: maps YouTrack custom fields through the real provider',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance(undefined, 'youtrack')
    given.assign(dm, instance)
    given.llm([callCapability('tasks.projects.create', { name: 'Fields' }), answer('Project created.')])

    await when.message(alice, dm, 'Create a project called Fields')
    then.replyTo(alice).equals('Project created.')

    const provider = await world.resolveRealTaskProvider(dm)
    const projects = await provider.listProjects()
    const projectId = projects[0]?.id ?? ''

    given.llm([
      callCapability('tasks.create', { projectId, title: 'Field Mapped', status: 'In Progress', priority: 'high' }),
      answer('Task created.'),
    ])
    await when.message(alice, dm, 'Create Field Mapped in progress at high priority')
    then.replyTo(alice).equals('Task created.')

    const tasks = await provider.listTasks({ projectId })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.status).toBe('In Progress')
    expect(tasks[0]?.priority).toBe('high')
  },
  { realTaskProvider: 'youtrack' },
)
```

Add `world` to the destructured scenario api parameter. `listProjects` and `listTasks` parameter shapes must match `src/providers/types.ts` — read it and adjust the calls to the real signatures. The `status`/`priority` argument names on `tasks.create` must match the capability's input schema; read the tool definition and correct them if they differ. Do not change the provider or the simulator to fit the story.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test:stories --test-name-pattern "SCN-task-youtrack-real-fields"`
Expected: FAIL — the scenario id is not in the catalog yet, or the assertions do not yet hold.

- [ ] **Step 3: Add the catalog record**

Add `'SCN-task-youtrack-real-fields'` to `CATALOG_SCENARIO_IDS` under the same banner as Task 4, and:

```typescript
  'SCN-task-youtrack-real-fields': {
    verifiedAt: '2026-07-27',
    storyIds: [
      'tests/stories/tasks/youtrack-real.story.test.ts#SCN-task-youtrack-real-fields: maps YouTrack custom fields through the real provider',
    ],
  },
```

Bump `166` → `167` (lines 114-115) and `141` → `142` (lines 216, 225) in `catalog-coverage.test.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test:stories` then `bun test:stories:contracts`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/tasks/youtrack-real.story.test.ts tests/stories/catalog/coverage.ts \
  tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): cover YouTrack custom-field mapping through the runtime"
```

---

### Task 6: Error-translation wiring story

**Files:**
- Modify: `tests/stories/tasks/youtrack-real.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`
- Modify: `tests/stories/harness/catalog-coverage.test.ts`

**Interfaces:**
- Consumes: the Task 4 seam.
- Produces: nothing new.

This drives `plugins/task-provider-youtrack/classify-error.ts` end to end: simulator 404 → `YouTrackClassifiedError` → `AppError` → tool failure result → reply. Per `src/providers/CLAUDE.md`, 404 maps to an entity-specific not-found.

- [ ] **Step 1: Write the failing story**

Append to `tests/stories/tasks/youtrack-real.story.test.ts`:

```typescript
scenario(
  'SCN-task-youtrack-real-error: translates a YouTrack 404 into a tool failure the model can report',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance(undefined, 'youtrack')
    given.assign(dm, instance)
    given.llm([
      callCapability('tasks.create', { projectId: 'no-such-project', title: 'Doomed' }),
      answer('That project does not exist.'),
    ])

    await when.message(alice, dm, 'Create Doomed in project no-such-project')
    then.replyTo(alice).equals('That project does not exist.')
  },
  { realTaskProvider: 'youtrack' },
)
```

The assertion that matters is that the turn **completes** — an unclassified provider throw would fail the scenario rather than round-trip to the model. Before finishing, read the recorded tool result and add one assertion on the failure payload's error shape, using whichever `then.*` accessor the harness exposes for tool results (read `tests/stories/harness/scenario.ts` for the available `then` surface). If no such accessor exists, assert on the provider directly instead: wrap a `provider.createTask({ projectId: 'no-such-project', ... })` call in `expect(...).rejects.toThrow()` and assert the thrown error's classified code.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test:stories --test-name-pattern "SCN-task-youtrack-real-error"`
Expected: FAIL — scenario id not in the catalog.

- [ ] **Step 3: Add the catalog record**

Add `'SCN-task-youtrack-real-error'` to `CATALOG_SCENARIO_IDS`, and:

```typescript
  'SCN-task-youtrack-real-error': {
    verifiedAt: '2026-07-27',
    storyIds: [
      'tests/stories/tasks/youtrack-real.story.test.ts#SCN-task-youtrack-real-error: translates a YouTrack 404 into a tool failure the model can report',
    ],
  },
```

Bump `167` → `168` and `142` → `143`.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test:stories` then `bun test:stories:contracts`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/tasks/youtrack-real.story.test.ts tests/stories/catalog/coverage.ts \
  tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): cover YouTrack error translation end to end"
```

---

### Task 7: Capability-gating wiring story

**Files:**
- Modify: `tests/stories/tasks/youtrack-real.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`
- Modify: `tests/stories/harness/catalog-coverage.test.ts`

**Interfaces:**
- Consumes: the Task 4 seam.
- Produces: nothing new.

`plugins/task-provider-youtrack/plugin.json` declares 42 provider capabilities but **not** `members.provision` (Kaneo declares it — `plugins/task-provider-kaneo/constants.ts:36`). `src/providers/membership/ensure-member.ts:217-220` skips provisioning when the resolved provider lacks it. So this story is the observable mirror of the existing `SCN-task-identity` story, which asserts a `kaneoWorkspaceMembers` row **is** written on a group turn.

Read `tests/stories/tasks/integration-surface.story.test.ts:26-27` for the `readWorkspaceMember` helper and copy its shape.

- [ ] **Step 1: Write the failing story**

Append to `tests/stories/tasks/youtrack-real.story.test.ts`, adding the drizzle imports the helper needs (`getDrizzleDb` from `../../../src/db/drizzle.js`, `kaneoWorkspaceMembers` from `../../../src/db/schema.js`, `eq` from `drizzle-orm`):

```typescript
scenario(
  'SCN-task-youtrack-real-gating: skips member provisioning for a provider without members.provision',
  async ({ given, when, then }) => {
    const bob = given.user('bob')
    const group = given.group(bob)
    const instance = given.taskInstance(undefined, 'youtrack')
    given.assign(group, instance)
    given.llm([callCapability('tasks.projects.create', { name: 'Gated' }), answer('Project created.')])

    await when.message(bob, group, 'Create a project called Gated')
    then.replyTo(bob).equals('Project created.')

    expect(
      getDrizzleDb()
        .select()
        .from(kaneoWorkspaceMembers)
        .where(eq(kaneoWorkspaceMembers.chatUserId, bob.id))
        .get(),
    ).toBeUndefined()
  },
  { realTaskProvider: 'youtrack' },
)
```

`given.group(...)` must match the harness's real group-seeding surface — read the `given` type at `tests/stories/harness/scenario.ts:120-140` and use the actual method and argument shape (the existing `SCN-task-identity` story is the reference for a group turn that provisions).

- [ ] **Step 2: Run to verify it fails**

Run: `bun test:stories --test-name-pattern "SCN-task-youtrack-real-gating"`
Expected: FAIL — scenario id not in the catalog.

- [ ] **Step 3: Add the catalog record**

Add `'SCN-task-youtrack-real-gating'` to `CATALOG_SCENARIO_IDS`, and:

```typescript
  'SCN-task-youtrack-real-gating': {
    verifiedAt: '2026-07-27',
    storyIds: [
      'tests/stories/tasks/youtrack-real.story.test.ts#SCN-task-youtrack-real-gating: skips member provisioning for a provider without members.provision',
    ],
  },
```

Bump `168` → `169` and `143` → `144`.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test:stories` then `bun test:stories:contracts`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/tasks/youtrack-real.story.test.ts tests/stories/catalog/coverage.ts \
  tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): cover provider capability gating for member provisioning"
```

---

### Task 8: The conformance sweep, grouped by domain

**Files:**
- Create: `tests/stories/tasks/youtrack-conformance.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`
- Modify: `tests/stories/harness/catalog-coverage.test.ts`

**Interfaces:**
- Consumes: `world.resolveRealTaskProvider` (Task 4); `PARITY_GROUPS` and `ParityGroup` from `../harness/parity/expectations.js`; `required` from `../harness/parity/group.js`; `YOUTRACK_PARITY_EXCLUSIONS` and `youtrackCustomFieldGroups`, which currently live under `tests/plugins/`.
- Produces: nothing new.

**Import-direction constraint.** `scripts/story/inputs.ts:44-51` captures only `tests/stories/**` plus three explicit frozen lists. A story may **not** import from `tests/plugins/**` — inside the read-only snapshot it either fails to resolve or silently resolves unfrozen candidate bytes, breaking the refactor proof. So `youtrack-parity-exclusions.ts` and `youtrack-custom-field-groups.ts` must **move** into `tests/stories/harness/parity/` first, with `tests/plugins/task-provider-youtrack/parity/provider-conformance.test.ts` and the two existing `*.test.ts` files for them repointed to the new location — the same direction `provider-conformance.test.ts:9` already uses for `PARITY_GROUPS`.

The six scenarios call the provider directly through the resolver, so this sweep proves conformance and resolution, **not** the tool loop. Do not describe it as a wiring proof.

- [ ] **Step 1: Move the YouTrack parity support modules**

```bash
git mv tests/plugins/task-provider-youtrack/parity/youtrack-parity-exclusions.ts tests/stories/harness/parity/
git mv tests/plugins/task-provider-youtrack/parity/youtrack-parity-exclusions.test.ts tests/stories/harness/parity/
git mv tests/plugins/task-provider-youtrack/parity/youtrack-custom-field-groups.ts tests/stories/harness/parity/
git mv tests/plugins/task-provider-youtrack/parity/youtrack-custom-field-groups.test.ts tests/stories/harness/parity/
```

Fix the relative import depths inside all four moved files (they move two directories shallower relative to `src/` and `plugins/`), and repoint the two imports in `provider-conformance.test.ts` to `../../../stories/harness/parity/`.

- [ ] **Step 2: Verify the move changed nothing**

Run: `bun test tests/plugins/task-provider-youtrack/parity/ tests/stories/harness/parity/`
Expected: PASS with the same total test count as before the move.

- [ ] **Step 3: Write the failing sweep**

Create `tests/stories/tasks/youtrack-conformance.story.test.ts` with the BUSL header:

```typescript
import { scenario } from '../harness/scenario.js'
import { PARITY_GROUPS, type ParityGroup } from '../harness/parity/expectations.js'
import { required } from '../harness/parity/group.js'
import { youtrackCustomFieldGroups } from '../harness/parity/youtrack-custom-field-groups.js'
import { YOUTRACK_PARITY_EXCLUSIONS } from '../harness/parity/youtrack-parity-exclusions.js'

const excluded = new Set(YOUTRACK_PARITY_EXCLUSIONS.map((entry) => entry.group))
const included: readonly ParityGroup[] = [
  ...PARITY_GROUPS.filter((group) => !excluded.has(group.id)),
  ...youtrackCustomFieldGroups,
]

const DOMAINS: ReadonlyArray<Readonly<{ id: string; title: string; prefixes: readonly string[] }>> = [
  { id: 'tasks', title: 'task groups', prefixes: ['task'] },
  { id: 'search', title: 'search groups', prefixes: ['search', 'query'] },
  { id: 'comments', title: 'comment groups', prefixes: ['comment'] },
  { id: 'relations', title: 'relation groups', prefixes: ['relation', 'link'] },
  { id: 'projects', title: 'project groups', prefixes: ['project'] },
  { id: 'errors', title: 'error groups', prefixes: ['error'] },
]

const groupsFor = (prefixes: readonly string[]): readonly ParityGroup[] =>
  included.filter((group) => prefixes.some((prefix) => group.id.startsWith(prefix)))

for (const domain of DOMAINS) {
  scenario(
    `SCN-youtrack-conformance-${domain.id}: real YouTrack provider satisfies the shared ${domain.title}`,
    async ({ given, world }) => {
      const alice = given.user('alice')
      const dm = given.dm(alice)
      const instance = given.taskInstance(undefined, 'youtrack')
      given.assign(dm, instance)

      const provider = await world.resolveRealTaskProvider(dm)
      for (const group of groupsFor(domain.prefixes)) {
        const project = required(
          await provider.createProject?.({ name: `Conformance ${group.id}` }),
          'provider.createProject result',
        )
        await group.run({ provider, projectId: project.id })
      }
    },
    { realTaskProvider: 'youtrack' },
  )
}
```

The `prefixes` above are a guess at the group-id naming. Before running, read every file in `tests/stories/harness/parity/expectations/` and replace `DOMAINS` with the real partition of group ids. Add a module-level assertion that the partition is total and disjoint, so a future group can never be silently dropped from the sweep:

```typescript
const partitioned = DOMAINS.flatMap((domain) => groupsFor(domain.prefixes).map((group) => group.id))
if (new Set(partitioned).size !== partitioned.length) {
  throw new Error(`YouTrack conformance domains overlap: ${partitioned.join(', ')}`)
}
const unpartitioned = included.filter((group) => !partitioned.includes(group.id)).map((group) => group.id)
if (unpartitioned.length > 0) {
  throw new Error(`YouTrack conformance domains omit groups: ${unpartitioned.join(', ')}`)
}
```

Each group gets its own project because the parity groups assume a clean project; state is shared across groups within one scenario, which is why per-group projects matter.

- [ ] **Step 4: Run to verify it fails**

Run: `bun test:stories --test-name-pattern "SCN-youtrack-conformance"`
Expected: FAIL — scenario ids not in the catalog.

- [ ] **Step 5: Add the six catalog records**

Add all six ids to `CATALOG_SCENARIO_IDS` under the Task 4 banner:

```typescript
  'SCN-youtrack-conformance-tasks',
  'SCN-youtrack-conformance-search',
  'SCN-youtrack-conformance-comments',
  'SCN-youtrack-conformance-relations',
  'SCN-youtrack-conformance-projects',
  'SCN-youtrack-conformance-errors',
```

Add six `EXECUTABLE_STORY_MAPPINGS` entries, each with `verifiedAt: '2026-07-27'` and a single story id of the form:

```
tests/stories/tasks/youtrack-conformance.story.test.ts#SCN-youtrack-conformance-<domain>: real YouTrack provider satisfies the shared <title>
```

The story id must match the `scenario(...)` name string **exactly**, including the domain title. Bump `169` → `175` (lines 114-115) and `144` → `150` (lines 216, 225).

- [ ] **Step 6: Run to verify it passes**

Run: `bun test:stories` then `bun test:stories:contracts`
Expected: PASS both. A parity group that fails here is a real finding — either the T0 responder diverges from the `Bun.serve` transport, or the group depends on live-server behavior. Do not add it to `YOUTRACK_PARITY_EXCLUSIONS` to make the run green; diagnose it and report it.

- [ ] **Step 7: Verify the in-process lane still passes**

Run: `bun test tests/plugins/task-provider-youtrack/`
Expected: PASS. The same groups run against the same simulator over a live socket; both bindings must agree.

- [ ] **Step 8: Commit**

```bash
git add tests/stories/harness/parity/ tests/plugins/task-provider-youtrack/parity/ \
  tests/stories/tasks/youtrack-conformance.story.test.ts tests/stories/catalog/coverage.ts \
  tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): run the YouTrack conformance sweep inside the hermetic lane"
```

---

### Task 9: Measure coverage and ratchet the floor

**Files:**
- Modify: `scripts/story/coverage-floor.json`

**Interfaces:** none.

The spec deliberately commits to no coverage number. This task records the measured one.

- [ ] **Step 1: Run the full in-process suite**

Run: `bun run test`
Expected: PASS. This is the lane the moved files still belong to.

- [ ] **Step 2: Run the story lane with coverage**

Run: `bun test:stories:coverage`
Expected: PASS. The command prints per-tier totals and writes `reports/stories/coverage/lcov.info`.

- [ ] **Step 3: Record the measurement**

Note the reported production-code line and function percentages, and the before/after for `plugins/task-provider-youtrack/**` specifically. Write both into the commit message in Step 5. The pre-change baseline is line coverage `0.55` / function `0.53` (`scripts/story/coverage-floor.json`), with `plugins/task-provider-youtrack` at 0.0%.

- [ ] **Step 4: Ratchet the floor**

Run: `bun coverage:ratchet:stories`
Expected: `scripts/story/coverage-floor.json` rises. The script never lowers the floor. If it reports no change, the sweep and stories added no measurable coverage — stop and investigate rather than proceeding.

- [ ] **Step 5: Commit**

```bash
git add scripts/story/coverage-floor.json
git commit -m "test(stories): ratchet the T0 coverage floor after real-YouTrack coverage

Measured: lines <before> -> <after>, functions <before> -> <after>.
plugins/task-provider-youtrack: 0.0% -> <after>%."
```

Replace every `<...>` with the real measured value. Do not commit this message with placeholders in it.

---

### Task 10: Freeze the story inputs and re-baseline

**Files:** none modified. This is a procedure, and getting the order wrong invalidates the refactor proof.

- [ ] **Step 1: Confirm the enforcement-imports guard still holds**

Run: `bun test tests/scripts/story-enforcement-imports.test.ts`
Expected: PASS. This plan's additions are reachable from stories, not from `scripts/story/**`, so no change should be needed. If it fails, a new module became reachable from the enforcement tree and must be added to the frozen support list in `scripts/story/inputs.ts` — do that rather than removing the import.

- [ ] **Step 2: Confirm no story imports outside the captured tree**

Run: `bash -c 'grep -rn "from '"'"'\.\..*tests/plugins" tests/stories/'`
Expected: no output. Any match is a refactor-proof hole and must be fixed by moving the imported module into `tests/stories/`.

- [ ] **Step 3: Run the full local gate**

Run: `bun run check:full`
Expected: PASS.

- [ ] **Step 4: Confirm the manifest is clean**

Run: `bun test:stories:manifest`
Expected: PASS. It writes `reports/stories/manifest.json` without spawning stories. Confirm the ten new scenario ids appear.

- [ ] **Step 5: Land on master, then record the baseline**

Every frozen-input change must be on master **before** a baseline is recorded:

1. Merge this branch to master.
2. On master, record the manifest `treeHash` and the baseline SHA per `docs/architecture/commands.md`.
3. Rebase any in-flight refactor branch onto that commit and run `BASE_REF=<sha> bun test:stories:compat --manifest-only` against it.

A ref predating these frozen inputs is incompatible and will report them as added. Do not run a compatibility proof against a pre-merge SHA and treat the failure as a regression.

---

## Deferred, deliberately

- **Kaneo T0 simulator.** No fake Kaneo server exists; it is a genuine ~600-line build and gets its own spec, written against the seam this plan proves. It must also resolve the `'kaneo'` ownership assertion at `tests/stories/harness/fixtures.ts:481-489` that YouTrack sidesteps by claiming a different type.
- **`expectAnyOrder` on the dispatcher.** Not built. It does not solve the simulator problem (parity groups cannot enumerate their request sets). If a magi-shaped need for an unordered-but-enumerable expectation set appears, that is its own small change.
- **Fidelity against a real YouTrack.** Out of reach at every tier: no container image exists, and both the simulator and the expectations are authored from the same reading of the API. Never describe this lane as provider-real.

## Self-Review Notes

Checked against the spec:

- Spec §1 (the seam) → Task 4. Spec §2 (the simulator) → Tasks 2, 3. Spec §3 (`serveHost`) → Task 1. Spec §4 (stories, catalog) → Tasks 4-8. Coverage expectations → Task 9. Freeze procedure → Task 10. Risks table → the `validate-config.ts` risk is retired (it accepts any http/https URL, verified at `plugins/task-provider-youtrack/validate-config.ts:20-22`, so `https://youtrack.invalid` passes); the remaining risks map to Task 8 Step 6, Task 10, and the deferred list.
- One spec item was **added** during planning: Task 8 Step 1 moves `youtrack-parity-exclusions.ts` and `youtrack-custom-field-groups.ts` into `tests/stories/`. The spec named only the fake server as needing to move, but the same `scripts/story/inputs.ts` constraint applies to these two.
- Several steps instruct the implementer to read a file and correct a name or signature rather than trusting the code as written — specifically the plugin-discovery entry point (Task 4 Step 3), the resolver export (Task 4 Step 5), `listProjects`/`listTasks` shapes (Task 5), the `then` tool-result surface (Task 6), `given.group` (Task 7), and the parity-domain partition (Task 8 Step 3). These are named unknowns with a stated verification action, not placeholders; each one is a symbol whose exact form was not read during planning.
