<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# F7 MCP Story Family Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the 3 F7 MCP scenarios (`SCN-settings-admin-mcp-catalog`, `SCN-settings-admin-mcp-plugin-servers`, `SCN-http-mcp-plugin`) as executable hermetic stories, realizing and exhausting the `fake-mcp-server` seam and moving the catalog ledger from 97→100 executable / 31→28 pending.

**Architecture:** F7 spans two opposite MCP directions. _papai-as-client_ (the `src/mcp/` adapter): one new production seam (user-MCP capability registration) + a new `FakeMcpServer` harness helper serving a fake external MCP server over the strict HTTP dispatcher, exercised by a real chat turn that invokes a remote tool. _papai-as-server_ (the `/mcp/plugin/:pluginId` route): zero production change — a story hand-crafts JSON-RPC via `world.runtime.request()`, authed by the production `mintPluginMcpToken`, against the real `synthetic-web-search` plugin.

**Tech Stack:** Bun test runner (`bun:test`), TypeScript (strict, `.js` import paths), Zod v4, `@modelcontextprotocol/sdk` v1.29.0 (`StreamableHTTPClientTransport`), the hermetic story harness under `tests/stories/`.

## Global Constraints

- **Runtime Bun; strict TypeScript; import paths end in `.js`.** Copy the SPDX license header (see any existing file, e.g. `src/tools/core-capabilities.ts:1-4`) into every new file.
- **Never add lint-disable / type-ignore comments.** A `require-await` lint failure means drop the unneeded `async` (F4 precedent); fix the underlying issue, never suppress.
- **No assertion-only stories (roadmap rule 3).** Every scenario qualifies through observable behavior: a reply, a durable state change on a following turn, an authorization flip, or an exact outbound/returned payload — never a bare status or an internal call count.
- **Harness-seam tasks land first and are reviewed independently (roadmap rule 2).** Tasks 1–3 (production seam + harness seams) precede any story task; each is its own commit.
- **Frozen-tree discipline (roadmap rule 7).** New/edited files under `tests/stories/**` are frozen compat inputs. The compat manifest re-baselines only for the intended byte changes in Tasks 2, 3, and the ledger task; routine story additions (Tasks 4/6/7) also touch frozen bytes and are expected. Re-record the baseline once at the end (Task 8), not per task.
- **Ledger rides with the stories in the same PR (roadmap rule 5).** Each story task moves its own `AUDIT_RECORDS` entry to `EXECUTABLE_STORY_MAPPINGS`; Task 8 reconciles the totals literals.
- **Story child hermeticity.** No live network/process, no undeclared HTTP, no leaked timers/env at teardown. The MCP client pool arms a 10-minute idle timer — Task 3 clears it in teardown or the I/O guard fails.
- **Capability catalog is test-only for resolution.** Production registers wire names under capability ids purely so the scripted model can address tools; nothing in production resolves them. Registering MCP wire names is the standard F1–F6 capability-id pattern.

**Commands (run from repo root):**

- Story unit/contract tests: `bun test:stories:contracts`
- Story scenarios (sandboxed): `bun test:stories`
- A single story file: `bun test:stories tests/stories/<path>.story.test.ts`
- Non-story unit tests: `bun test tests/<path>.test.ts`
- Stress (determinism): `bun test:stories:stress`
- Lint/type/format gate (also runs on commit): the pre-commit hook runs lint + typecheck + `format:check` + license-headers on staged files. Auto-fix formatting with `npx oxfmt --write <file>`.

---

## File Structure

**Production (papai-as-client seam — Task 1):**

- Modify: `src/tools/core-capabilities.ts` — add `registerMcpToolCapabilities(tools, catalog)`.
- Modify: `src/llm-orchestrator-tools.ts:222` — call it beside `registerOfferedCoreToolCapabilities`.
- Test: `tests/tools/core-capabilities.test.ts` (create if absent).

**Harness seams (Tasks 2–3):**

- Create: `tests/stories/harness/fake-mcp-server.ts` — the fake external MCP server responder.
- Modify: `tests/stories/harness/fixtures.ts` — call `mcpPool.shutdown()` in `teardown`.
- Test: `tests/stories/harness/fake-mcp-server.test.ts` (contract test, real transport).
- Test: `tests/stories/harness/fixtures.test.ts` — pool-isolation contract test.

**Stories (Tasks 4, 6, 7):**

- Create: `tests/stories/integrations/mcp/admin-mcp-catalog.story.test.ts` — `SCN-settings-admin-mcp-catalog` (papai-as-client).
- Create: `tests/stories/integrations/mcp/mcp-plugin-route.story.test.ts` — `SCN-http-mcp-plugin` (papai-as-server route + token negatives).
- Create: `tests/stories/integrations/mcp/mcp-plugin-servers.story.test.ts` — `SCN-settings-admin-mcp-plugin-servers` (governance flip).

**Ledger (Task 8):**

- Modify: `tests/stories/catalog/coverage.ts` — move 3 `AUDIT_RECORDS` → `EXECUTABLE_STORY_MAPPINGS`.
- Modify: `tests/stories/harness/catalog-coverage.test.ts` — totals literals 97→100, 31→28, needs-seam 8→5.

---

## Task 1: Production seam — user-MCP capability registration

**Files:**

- Modify: `src/tools/core-capabilities.ts:97-101` (append a new exported function)
- Modify: `src/llm-orchestrator-tools.ts:222` (add one call), `:22` (import)
- Test: `tests/tools/core-capabilities.test.ts`

**Interfaces:**

- Produces: `registerMcpToolCapabilities(tools: ToolSet, catalog: ToolCapabilityCatalog): void` — registers each `mcp_*`-prefixed wire name in `tools` as an identity capability (id === wire name). Consumed by the scripted model as `callCapability('mcp_<serverId>__<tool>', input)` in Task 4.

**Context:** `resolveToolCapability` (`src/runtime/create-runtime.ts:203-206`) → `capability-catalog.ts:24-28` **throws** on an unknown id. `registerOfferedCoreToolCapabilities` (`core-capabilities.ts:97-101`) only iterates the static `CORE_TOOL_CAPABILITIES` map; MCP tools (`mcp_<sanitizedServerId>__<toolName>`, `src/mcp/tool-adapter.ts:26-33`) are never registered, so the scripted model cannot address them. The catalog is cleared per runtime start/stop (`create-runtime.ts:41,45`) and re-registration of the same id→wire pair is idempotent (`capability-catalog.ts:18-22`).

- [ ] **Step 1: Write the failing test**

Create `tests/tools/core-capabilities.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { tool } from 'ai'
import { z } from 'zod'

import { createToolCapabilityCatalog } from '../../src/runtime/capability-catalog.js'
import { registerMcpToolCapabilities } from '../../src/tools/core-capabilities.js'

const stub = () => tool({ description: 'x', inputSchema: z.object({}), execute: () => Promise.resolve({}) })

describe('registerMcpToolCapabilities', () => {
  test('registers mcp_-prefixed wire names as identity capabilities', () => {
    const catalog = createToolCapabilityCatalog()
    registerMcpToolCapabilities({ mcp_fake__echo: stub(), create_task: stub() }, catalog)
    expect(catalog.resolve('mcp_fake__echo')).toBe('mcp_fake__echo')
  })

  test('does not register non-mcp tools', () => {
    const catalog = createToolCapabilityCatalog()
    registerMcpToolCapabilities({ create_task: stub() }, catalog)
    expect(() => catalog.resolve('create_task')).toThrow("Unknown tool capability id 'create_task'")
  })

  test('is idempotent across repeated registration', () => {
    const catalog = createToolCapabilityCatalog()
    const tools = { mcp_fake__echo: stub() }
    registerMcpToolCapabilities(tools, catalog)
    expect(() => registerMcpToolCapabilities(tools, catalog)).not.toThrow()
    expect(catalog.resolve('mcp_fake__echo')).toBe('mcp_fake__echo')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/core-capabilities.test.ts`
Expected: FAIL — `registerMcpToolCapabilities` is not exported.

- [ ] **Step 3: Implement the function**

Append to `src/tools/core-capabilities.ts` (after line 101):

```typescript
/**
 * Registers MCP-sourced tools (user endpoints, wire prefix `mcp_`) as identity capabilities so
 * the scripted story model can address them by `callCapability(wireName, input)`. MCP wire names
 * are dynamic per configured server, so — unlike the static core map — the id is the wire name
 * itself. Idempotent: the catalog rejects only a duplicate id mapping to a different wire name.
 */
export function registerMcpToolCapabilities(tools: ToolSet, catalog: ToolCapabilityCatalog): void {
  for (const wireName of Object.keys(tools)) {
    if (wireName.startsWith('mcp_')) catalog.register(wireName, wireName)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/core-capabilities.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire it into tool assembly**

In `src/llm-orchestrator-tools.ts`, update the import at line 22:

```typescript
import { registerMcpToolCapabilities, registerOfferedCoreToolCapabilities } from './tools/core-capabilities.js'
```

And add one line immediately after line 222 (`registerOfferedCoreToolCapabilities(gatedTools, toolCapabilityCatalog)`):

```typescript
registerMcpToolCapabilities(gatedTools, toolCapabilityCatalog)
```

- [ ] **Step 6: Verify typecheck + existing tool tests**

Run: `bun test tests/tools/core-capabilities.test.ts && bun test tests/tools/mcp-integration.test.ts`
Expected: PASS. (Type-check happens on commit; the pre-commit hook covers it.)

- [ ] **Step 7: Commit**

```bash
git add src/tools/core-capabilities.ts src/llm-orchestrator-tools.ts tests/tools/core-capabilities.test.ts
git commit -m "feat(tools): register user-MCP tool wire names as capabilities"
```

---

## Task 2: Harness seam — `FakeMcpServer`

**Files:**

- Create: `tests/stories/harness/fake-mcp-server.ts`
- Test: `tests/stories/harness/fake-mcp-server.test.ts`

**Interfaces:**

- Consumes: `StrictHttpDispatcher` (`strict-http.ts:16-21`), `ScenarioEvents` (`events.ts`).
- Produces: `createFakeMcpServer(options: { http: StrictHttpDispatcher; events: ScenarioEvents; url: string }): FakeMcpServer` where
  ```typescript
  type FakeMcpServer = Readonly<{
    expectConnect(serverInfo?: { name?: string; version?: string }): void
    expectToolsList(tools: readonly { name: string; description: string; inputSchema: object }[]): void
    expectToolCall(expected: { name: string }, result: { text: string }): void
    verifyConsumed(): void
  }>
  ```
  Each method appends ordered expectations to the strict dispatcher. `expectConnect` declares the `GET`→405 SSE probe, then the `initialize` and `notifications/initialized` POSTs. Consumed by Tasks 2's contract test and Task 4's story.

**Context:** The real `StreamableHTTPClientTransport` (`src/mcp/client-pool.ts:37-39`, no custom `fetch`) calls live `globalThis.fetch`, which the I/O guard patches to the strict dispatcher (`io-guard.ts:333-336`). The connect handshake is: `GET {url}` with `Accept: text/event-stream` (405 ⇒ no SSE, graceful), then POST `initialize`, POST `notifications/initialized`, then papai's `client.listTools()` → POST `tools/list`, then `client.callTool()` → POST `tools/call`. All POSTs go to the same `{url}`; the strict dispatcher matches by method+URL in order (`strict-http.ts:74-80`), so responders are declared in exactly this order and branch defensively on the parsed JSON-RPC `method`. The URL must be HTTPS (`mcpEndpointConfigSchema` rejects non-`https`, `src/mcp/types.ts:20-23`). Model the file on `fake-magi.ts` (the `options.http.expect(...)` + `events.record(...)` + `jsonResponse` pattern).

- [ ] **Step 1: Write the failing contract test**

Create `tests/stories/harness/fake-mcp-server.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { createScenarioEvents } from './events.js'
import { createStrictHttpDispatcher } from './strict-http.js'
import { createFakeMcpServer } from './fake-mcp-server.js'

const URL_ = 'https://mcp.invalid/rpc'
const originalFetch = globalThis.fetch

describe('createFakeMcpServer', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('a real StreamableHTTP client connects, lists, and calls a tool over the dispatcher', async () => {
    const events = createScenarioEvents('fake-mcp')
    const http = createStrictHttpDispatcher(events)
    const server = createFakeMcpServer({ http, events, url: URL_ })
    server.expectConnect()
    server.expectToolsList([{ name: 'echo', description: 'echoes', inputSchema: { type: 'object' } }])
    server.expectToolCall({ name: 'echo' }, { text: 'server-sourced-token' })

    // The story harness patches globalThis.fetch; the contract test does it directly.
    globalThis.fetch = http.fetch as typeof globalThis.fetch

    const client = new Client({ name: 'test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(URL_)))
    const listed = await client.listTools()
    expect(listed.tools.map((t) => t.name)).toContain('echo')
    const called = await client.callTool({ name: 'echo', arguments: {} })
    expect(JSON.stringify(called.content)).toContain('server-sourced-token')
    await client.close()
    server.verifyConsumed()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/stories/harness/fake-mcp-server.test.ts`
Expected: FAIL — `./fake-mcp-server.js` does not exist.

- [ ] **Step 3: Implement `FakeMcpServer`**

Create `tests/stories/harness/fake-mcp-server.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ScenarioEvents } from './events.js'
import type { StrictHttpDispatcher } from './strict-http.js'

export type FakeMcpTool = Readonly<{ name: string; description: string; inputSchema: object }>

export type FakeMcpServer = Readonly<{
  expectConnect(serverInfo?: { name?: string; version?: string }): void
  expectToolsList(tools: readonly FakeMcpTool[]): void
  expectToolCall(expected: { name: string }, result: { text: string }): void
  verifyConsumed(): void
}>

type JsonRpc = Readonly<{ jsonrpc: '2.0'; id?: number | string; method?: string; params?: unknown }>

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function readRpc(request: Request): Promise<JsonRpc> {
  return (await request.json()) as JsonRpc
}

function assertMethod(rpc: JsonRpc, expected: string): void {
  if (rpc.method !== expected) throw new Error(`FakeMcpServer expected JSON-RPC ${expected}, got ${rpc.method}`)
}

type Options = Readonly<{ http: StrictHttpDispatcher; events: ScenarioEvents; url: string }>

export function createFakeMcpServer(options: Options): FakeMcpServer {
  const { http, events, url } = options
  return {
    expectConnect(serverInfo): void {
      // 1. SSE probe (GET) → 405 "no server-push stream".
      http.expect({ method: 'GET', url }, () => new Response(null, { status: 405 }))
      // 2. initialize.
      http.expect({ method: 'POST', url }, async (request) => {
        const rpc = await readRpc(request)
        assertMethod(rpc, 'initialize')
        const protocolVersion = (rpc.params as { protocolVersion?: string })?.protocolVersion ?? '2025-06-18'
        events.record('mcp.server.initialize', { url })
        return jsonResponse({
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: serverInfo?.name ?? 'fake-mcp', version: serverInfo?.version ?? '1.0.0' },
          },
        })
      })
      // 3. notifications/initialized (no id) → 202 empty.
      http.expect({ method: 'POST', url }, async (request) => {
        const rpc = await readRpc(request)
        assertMethod(rpc, 'notifications/initialized')
        return new Response(null, { status: 202 })
      })
    },
    expectToolsList(tools): void {
      http.expect({ method: 'POST', url }, async (request) => {
        const rpc = await readRpc(request)
        assertMethod(rpc, 'tools/list')
        events.record('mcp.server.tools_list', { url, count: tools.length })
        return jsonResponse({ jsonrpc: '2.0', id: rpc.id, result: { tools: [...tools] } })
      })
    },
    expectToolCall(expected, result): void {
      http.expect({ method: 'POST', url }, async (request) => {
        const rpc = await readRpc(request)
        assertMethod(rpc, 'tools/call')
        const name = (rpc.params as { name?: string })?.name
        if (name !== expected.name) throw new Error(`FakeMcpServer expected tools/call ${expected.name}, got ${name}`)
        events.record('mcp.server.tools_call', { url, name })
        return jsonResponse({
          jsonrpc: '2.0',
          id: rpc.id,
          result: { content: [{ type: 'text', text: result.text }], isError: false },
        })
      })
    },
    verifyConsumed: http.verifyConsumed,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/stories/harness/fake-mcp-server.test.ts`
Expected: PASS. If the SDK sends an extra request (e.g. a duplicate `tools/list`), the dispatcher throws `undeclared request` or `expected … but received …` — this pins the real v1.29.0 sequence for Task 4's discovery. If it fails on the `initialize` protocolVersion, log `rpc.params` and echo the exact version the client sent.

- [ ] **Step 5: Format and commit**

```bash
npx oxfmt --write tests/stories/harness/fake-mcp-server.ts tests/stories/harness/fake-mcp-server.test.ts
git add tests/stories/harness/fake-mcp-server.ts tests/stories/harness/fake-mcp-server.test.ts
git commit -m "test(stories): add the FakeMcpServer external-server harness seam"
```

---

## Task 3: Harness seam — MCP pool teardown

**Files:**

- Modify: `tests/stories/harness/fixtures.ts:19` (import), `:328-336` (`teardown`)
- Test: `tests/stories/harness/fixtures.test.ts`

**Interfaces:**

- Consumes: `mcpPool` (`src/mcp/client-pool.ts:274`), `mcpPool.shutdown(): Promise<void>` (`client-pool.ts:160-176`, clears idle timers + closes clients + clears entries).
- Produces: `teardown()` now also shuts the MCP pool down. No new exported symbol.

**Context:** `buildMcpToolSet` connects through the module-singleton `mcpPool`, which arms a 10-minute idle timer per entry (`client-pool.ts:252-259`). Production never shuts the pool down in a lifecycle hook, so a scenario that connected leaves a live timer + open client; the story I/O guard fails unrestored timers/handles at teardown. `fixtures.teardown` (`fixtures.ts:328`) is synchronous today; `mcpPool.shutdown()` is async but fire-and-forget is unsafe (the timer must be cleared synchronously before the guard checks). `shutdown()` clears the timers synchronously via `clearTimeout` before awaiting client closes, so calling it (even without awaiting) clears the timers; await it if `teardown` can be made async — check whether the cleanup coordinator awaits `teardown` (`world.ts` `createCleanupCoordinator`). Prefer keeping `teardown` synchronous and calling `void mcpPool.shutdown()` if the timers clear synchronously; the contract test verifies no timer leaks either way.

- [ ] **Step 0: Discovery — confirm timer-clear timing**

Run: `bun test tests/stories/harness/fake-mcp-server.test.ts` already proved a real connect. Read `src/mcp/client-pool.ts:160-176` and confirm `shutdown()` calls `clearTimeout(entry.idleTimer)` before any `await`. If yes, a synchronous `void mcpPool.shutdown()` in `teardown` clears timers synchronously (client-close completes on the microtask queue before the guard's async check). If the `clearTimeout` is after an `await`, make `teardown` async and `await mcpPool.shutdown()`, updating the coordinator callsite accordingly.

- [ ] **Step 1: Write the failing isolation test**

Add to `tests/stories/harness/fixtures.test.ts`:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { mcpPool } from '../../../src/mcp/client-pool.js'
import { createScenarioEvents } from './events.js'
import { createStrictHttpDispatcher } from './strict-http.js'
import { createFakeMcpServer } from './fake-mcp-server.js'
import { createScenarioFixtures } from './fixtures.js'

test('teardown shuts the MCP pool down so no idle timer leaks', async () => {
  const events = createScenarioEvents('pool-isolation')
  const http = createStrictHttpDispatcher(events)
  const server = createFakeMcpServer({ http, events, url: 'https://mcp.invalid/rpc' })
  server.expectConnect()
  const originalFetch = globalThis.fetch
  globalThis.fetch = http.fetch as typeof globalThis.fetch
  try {
    await mcpPool.getOrCreateFromUser({ id: 's1', url: 'https://mcp.invalid/rpc', enabled: true })
    expect(mcpPool.getServerInfos().length).toBeGreaterThan(0)

    const fixtures = createScenarioFixtures()
    fixtures.teardown()
    // Allow the async client close to settle if teardown is fire-and-forget.
    await new Promise((r) => setTimeout(r, 0))
    expect(mcpPool.getServerInfos().length).toBe(0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
```

Note: confirm the exact `mcpPool.getOrCreateFromUser` argument shape against `src/mcp/user-endpoints.ts:65-99` / `client-pool.ts:81-97` during Step 0 and adjust the seed endpoint object to match (`{ id, url, enabled }`).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/stories/harness/fixtures.test.ts -t "MCP pool"`
Expected: FAIL — `getServerInfos().length` is still > 0 after `teardown()`.

- [ ] **Step 3: Implement the teardown hook**

In `tests/stories/harness/fixtures.ts`, add the import beside line 19:

```typescript
import { mcpPool } from '../../../src/mcp/client-pool.js'
```

In the `teardown` closure (around line 328), add a first line (before `teardownRegistries()`):

```typescript
const teardown = (): void => {
  void mcpPool.shutdown()
  teardownRegistries()
  settingsSessions.revoke()
  // ...existing publicBaseUrl restore...
}
```

(If Step 0 found the `clearTimeout` is post-`await`, make `teardown` `async` and `await mcpPool.shutdown()` instead, then update the coordinator callsite in `world.ts` to await it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/stories/harness/fixtures.test.ts -t "MCP pool"`
Expected: PASS.

- [ ] **Step 5: Run the full harness contract suite (no regressions)**

Run: `bun test:stories:contracts`
Expected: PASS (all existing harness contract tests plus the two new ones).

- [ ] **Step 6: Format and commit**

```bash
npx oxfmt --write tests/stories/harness/fixtures.ts tests/stories/harness/fixtures.test.ts
git add tests/stories/harness/fixtures.ts tests/stories/harness/fixtures.test.ts
git commit -m "test(stories): shut the MCP client pool down at scenario teardown"
```

---

## Task 4: Story — `SCN-settings-admin-mcp-catalog` (papai-as-client)

**Files:**

- Create: `tests/stories/integrations/mcp/admin-mcp-catalog.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts` (move this ID's audit → executable mapping)

**Interfaces:**

- Consumes: `createFakeMcpServer` (Task 2); `registerMcpToolCapabilities` (Task 1, wired into assembly); `scenario`, `given`, `when`, `world` (`scenario.ts`); `callCapability`, `answer`, `promptTextFingerprint` (`scripted-llm.ts`); `setCachedConfig` (`src/cache.js`), `getConfigContextIdFromStorageContextId`, `toScopedContextId` (`src/chat/scoped-context.js`).

**Context:** `buildMcpToolSet(sharedContextId)` runs during tool assembly whenever `sharedContextId = getConfigContextIdFromStorageContextId(storageContextId)` is defined (`src/tools/index.ts:204-210`), reads `getCachedConfig(sharedContextId, 'mcp_endpoints')` (`src/mcp/user-endpoints.ts:65-99`), connects each enabled endpoint via `mcpPool`, and merges `mcp_<sanitizeServerId(id)>__<tool>` tools (`tool-adapter.ts:26-33`). The scripted model then addresses the tool via the identity capability registered in Task 1. The observable is the server-sourced token surfacing on the real tool result (the web-fetch story's `world.model.inspections().at(-1)?.promptToolResultTokenFingerprints` fingerprint pattern, `tests/stories/web/web-fetch.story.test.ts:45-47`) — never a scripted reply string.

- [ ] **Step 0: Discovery spike — pin the real request sequence and the config-context id**

Write a throwaway scenario that seeds one enabled `mcp_endpoints` entry (server id `fake`, url `https://mcp.invalid/rpc`), registers a `createFakeMcpServer` with **only `expectConnect()`** declared, and runs one `when.message` turn with `given.llm([callCapability('mcp_fake__echo', {}), answer('done')])`. Run `bun test:stories <spike>`; the strict dispatcher's failure message names the first undeclared request (e.g. a second `tools/list`), revealing exactly how many `tools/list` POSTs assembly issues per turn. Record the count. Also log `sharedContextId` (from `getConfigContextIdFromStorageContextId`) and confirm it equals the id your `given` seed writes to. Delete the spike. **This resolves spec risk #1.**

- [ ] **Step 1: Write the story (initially expected to fail on the pinned sequence)**

Create `tests/stories/integrations/mcp/admin-mcp-catalog.story.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { setCachedConfig } from '../../../../src/cache.js'
import { getConfigContextIdFromStorageContextId, toScopedContextId } from '../../../../src/chat/scoped-context.js'
import { createFakeMcpServer } from '../../harness/fake-mcp-server.js'
import { scenario } from '../../harness/scenario.js'
import { answer, callCapability, promptTextFingerprint } from '../../harness/scripted-llm.js'

const MCP_URL = 'https://mcp.invalid/rpc'
// A unique word present ONLY in the fake server's tools/call result — never in any tool input or
// reply string. Its fingerprint on the tool result proves the remote MCP tool round-tripped.
const SERVER_MARKER = 'papaimcpmarker9z'

scenario(
  'SCN-settings-admin-mcp-catalog: a configured MCP endpoint surfaces a remote tool the model invokes',
  async ({ given, when, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)

    // Seed the user MCP endpoint config the adapter reads during assembly.
    const storageContextId = toScopedContextId({
      platformInstanceId: alice.platformInstanceId,
      nativeContextId: alice.id,
    })
    const configContextId = getConfigContextIdFromStorageContextId(storageContextId)
    setCachedConfig(configContextId, 'mcp_endpoints', JSON.stringify([{ id: 'fake', url: MCP_URL, enabled: true }]))

    // Serve the fake external MCP server over the strict dispatcher. Declare exactly the sequence
    // pinned in Step 0 (expectToolsList repeated per assembly pass if the spike showed > 1).
    const server = createFakeMcpServer({ http: world.http, events: world.events, url: MCP_URL })
    server.expectConnect()
    server.expectToolsList([{ name: 'echo', description: 'echoes a message', inputSchema: { type: 'object' } }])
    server.expectToolCall({ name: 'echo' }, { text: `remote result ${SERVER_MARKER}` })

    given.llm([callCapability('mcp_fake__echo', { message: 'hi' }), answer('The remote tool replied.')])

    await when.message(alice, dm, 'Use the fake tool please')

    // The server-sourced marker surfaces on the real tool result — unscriptable, so its presence
    // proves the real MCP client → fake server round trip reached the model.
    expect(world.model.inspections().at(-1)?.promptToolResultTokenFingerprints).toContain(
      promptTextFingerprint(SERVER_MARKER),
    )
  },
)
```

Adjust the number of `server.expectToolsList([...])` calls to match the Step-0 count. Confirm the `setCachedConfig`/`toScopedContextId`/`getConfigContextIdFromStorageContextId` import paths and the `alice.platformInstanceId`/`alice.id` handle fields against `scenario.ts` `UserHandle` and `eligibility.story.test.ts:54` (which uses the same `toScopedContextId` shape).

- [ ] **Step 2: Run the story**

Run: `bun test:stories tests/stories/integrations/mcp/admin-mcp-catalog.story.test.ts`
Expected: PASS. If it fails with `undeclared request` / `expected … received …`, the pinned sequence is off by one — re-run Step 0 and match `expectToolsList` count. If the marker fingerprint is absent, the scripted model didn't surface the tool result — confirm Task 1's registration ran (the capability resolved) and `autoLoadTools` loaded the disclosure-hidden tool.

- [ ] **Step 3: Move the ledger entry**

In `tests/stories/catalog/coverage.ts`, remove the `'SCN-settings-admin-mcp-catalog': needs(...)` entry from `AUDIT_RECORDS` (lines ~838-842) and add to `EXECUTABLE_STORY_MAPPINGS`:

```typescript
  'SCN-settings-admin-mcp-catalog': {
    verifiedAt: '2026-07-22',
    storyIds: [
      'tests/stories/integrations/mcp/admin-mcp-catalog.story.test.ts#SCN-settings-admin-mcp-catalog: a configured MCP endpoint surfaces a remote tool the model invokes',
    ],
  },
```

(The totals literals in `catalog-coverage.test.ts` are updated once in Task 8; the per-ID contract that "audit records cover exactly the pending scenarios" will fail until Task 8 — that is expected, so run only this story file here, not the full contract suite.)

- [ ] **Step 4: Format and commit**

```bash
npx oxfmt --write tests/stories/integrations/mcp/admin-mcp-catalog.story.test.ts tests/stories/catalog/coverage.ts
git add tests/stories/integrations/mcp/admin-mcp-catalog.story.test.ts tests/stories/catalog/coverage.ts
git commit -m "test(stories): cover a configured MCP endpoint invoked in a chat turn"
```

---

## Task 5: papai-as-server enablement helper — `given.mcpPluginServer`

**Files:**

- Modify: `tests/stories/harness/scenario.ts` (add `given.mcpPluginServer` to `ScenarioGiven` + `createGiven`)
- Modify: `tests/stories/harness/fixtures.ts` (add `enableMcpPluginServer` fixture method)
- Test: `tests/stories/harness/scenario.test.ts`

**Interfaces:**

- Produces: `given.mcpPluginServer(platformInstanceId: string, pluginId: string): void` — calls `setMcpPluginServerConfigs(platformInstanceId, [{ plugin_id: pluginId, enabled: true, default_tool_policy: 'allow' }])` (`src/coding-credentials/mcp-plugin-servers.ts:48-54`). Consumed by Tasks 6 and 7. (A disabled variant is not needed — Task 7 calls `setMcpPluginServerConfigs` directly to flip `enabled: false`.)

**Context:** The `/mcp/plugin` exposure gate (`isExposedInternalServer` → `listEnabledInternalMcpServers`, `mcp-plugin-servers.ts:76-102`) requires the plugin be operator-enabled in `mcp_plugin_servers` config AND active+eligible for the context AND `mcpServer: true` AND `SETTINGS_PUBLIC_BASE_URL` set. This helper covers the operator-enabled half; the plugin-activation half is `given.plugin` + `setPluginAdminConfig` + `setPluginEnabledForContext` (the `eligibility.story.test.ts:57-63` pattern), and `given.publicBaseUrl` covers the base URL. Follow the `given.notifyToken` seam shape (`scenario.ts:710-712` → `world.fixtures.seedNotifyToken`).

- [ ] **Step 1: Write the failing contract test**

Add to `tests/stories/harness/scenario.test.ts` a test that, inside an `executeScenario`, calls `given.mcpPluginServer(platformInstanceId, 'synthetic-web-search')` and asserts `resolveMcpPluginServerConfigs(platformInstanceId)` (imported from `src/coding-credentials/mcp-plugin-servers.js`) returns one entry with `enabled: true, default_tool_policy: 'allow'`. Model the harness/assertion shape on the existing `given.notifyToken` contract test in the same file.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:stories:contracts` (or the single file via `bun test tests/stories/harness/scenario.test.ts`)
Expected: FAIL — `given.mcpPluginServer` is not a function.

- [ ] **Step 3: Implement the fixture + given method**

In `tests/stories/harness/fixtures.ts`, add near the other seed methods:

```typescript
    enableMcpPluginServer(platformInstanceId: string, pluginId: string): void {
      setMcpPluginServerConfigs(platformInstanceId, [
        { plugin_id: pluginId, enabled: true, default_tool_policy: 'allow' },
      ])
    },
```

with the import:

```typescript
import { setMcpPluginServerConfigs } from '../../../src/coding-credentials/mcp-plugin-servers.js'
```

and add `enableMcpPluginServer(platformInstanceId: string, pluginId: string): void` to the `ScenarioFixtures` type.

In `tests/stories/harness/scenario.ts`, add to `ScenarioGiven` (beside `notifyToken`):

```typescript
  mcpPluginServer(platformInstanceId: string, pluginId: string): void
```

and in `createGiven` (beside the `notifyToken` impl at ~710):

```typescript
    mcpPluginServer(platformInstanceId, pluginId): void {
      prerequisite('given.mcpPluginServer')
      world.fixtures.enableMcpPluginServer(platformInstanceId, pluginId)
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/stories/harness/scenario.test.ts -t "mcpPluginServer"`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
npx oxfmt --write tests/stories/harness/scenario.ts tests/stories/harness/fixtures.ts tests/stories/harness/scenario.test.ts
git add tests/stories/harness/scenario.ts tests/stories/harness/fixtures.ts tests/stories/harness/scenario.test.ts
git commit -m "test(stories): add the given.mcpPluginServer enablement seam"
```

---

## Task 6: Story — `SCN-http-mcp-plugin` (papai-as-server route + token auth)

**Files:**

- Create: `tests/stories/integrations/mcp/mcp-plugin-route.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts` (move this ID's audit → executable mapping)

**Interfaces:**

- Consumes: `given.plugin`, `given.publicBaseUrl`, `given.mcpPluginServer` (Task 5), `world.runtime.request`, `world.start` (`scenario.ts`); `mintPluginMcpToken` (`src/mcp-server/token.js`); `discoverPlugins` (`src/plugins/discovery.js`), `setPluginAdminConfig` (`src/plugins/store.js`), `setPluginEnabledForContext` (`src/plugins/registry.js`), `toScopedContextId`, `getConfigContextIdFromStorageContextId` (`src/chat/scoped-context.js`).

**Context:** The `/mcp/plugin/:pluginId` route is always live in `routeRequest` (`src/debug/server.ts:200-206`, not debug-gated) and is stateless (`sessionIdGenerator: undefined`, `enableJsonResponse: true`, `server-route.ts:107-133`) — a single JSON-RPC POST suffices, no `initialize` handshake, no SDK client. The exact request/response shape is `tests/mcp-server/integration.test.ts:76-97,103-111`. In a story the real `defaultDeps` run (`server-route.ts:204` passes none), so the real exposure gate + real `verifyPluginMcpToken` apply: the enablement stack (plugin active+eligible+enabled, `mcp_plugin_servers` on, `publicBaseUrl` set) and a token whose `{storageContextId, chatUserId, pluginId}` match the context are all required. Reuse `synthetic-web-search` (`eligibility.story.test.ts` activation pattern). Its `search` tool egresses `POST https://api.synthetic.new/v2/search` with body `{query}` (`plugins/synthetic-web-search/index.ts:164-170`) and needs an `api_key` admin config.

- [ ] **Step 0: Discovery spike — confirm the plugin egress routes through the dispatcher**

The `tools/call` happy path executes `synthetic-web-search.search`, which calls its runtime `httpFetch`. Confirm that fetch is the harness dispatcher: read how `callPluginMcpTool` → `buildPluginToolRuntimeContext` (`src/mcp-server/plugin-bridge.ts:89-103`) resolves the plugin's `httpFetch`, and whether it derives from `pluginProviderRuntimeDeps.fetch` (= `world.http.fetch`, `world.ts:438`) or the io-guard-patched global `fetch`. Either is interceptable. **If** neither routes through the dispatcher (egress would trip the I/O guard), fall back to a `tools/list` happy-path observable (the real `search` descriptor surfaces over the route — spec risk #3) and skip the api.synthetic.new stub. Record which path applies; the steps below assume `tools/call` with the stub.

- [ ] **Step 1: Write the story**

Create `tests/stories/integrations/mcp/mcp-plugin-route.story.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { getConfigContextIdFromStorageContextId, toScopedContextId } from '../../../../src/chat/scoped-context.js'
import { mintPluginMcpToken } from '../../../../src/mcp-server/token.js'
import { discoverPlugins } from '../../../../src/plugins/discovery.js'
import { setPluginEnabledForContext } from '../../../../src/plugins/registry.js'
import { setPluginAdminConfig } from '../../../../src/plugins/store.js'
import { scenario } from '../../harness/scenario.js'

const PLUGIN_ID = 'synthetic-web-search'
const API_URL = 'https://api.synthetic.new/v2/search'
const RESULT_MARKER = 'papaipluginroute4k'

function discovered(pluginId: string) {
  const p = discoverPlugins('plugins').plugins.find(({ manifest }) => manifest.id === pluginId)
  if (p === undefined) throw new Error(`Expected discovered plugin ${pluginId}`)
  return p
}

async function jsonRpc(
  world: { runtime: { request(r: Request): Promise<Response> } },
  pluginId: string,
  token: string,
  method: string,
  params: unknown,
) {
  const req = new Request(new URL(`https://bot.invalid/mcp/plugin/${pluginId}`), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return world.runtime.request(req)
}

scenario(
  'SCN-http-mcp-plugin: a signed token calls a hosted plugin tool; bad tokens are rejected',
  async ({ given, world }) => {
    const alice = given.user('alice')
    given.dm(alice)
    const storageContextId = toScopedContextId({
      platformInstanceId: alice.platformInstanceId,
      nativeContextId: alice.id,
    })
    const configContextId = getConfigContextIdFromStorageContextId(storageContextId)

    given.plugin(discovered(PLUGIN_ID))
    setPluginAdminConfig(PLUGIN_ID, 'api_key', 'scenario-key', 'scenario-admin')
    setPluginEnabledForContext(PLUGIN_ID, configContextId, true)
    given.publicBaseUrl('https://bot.invalid')
    given.mcpPluginServer(alice.platformInstanceId, PLUGIN_ID)

    await world.start()

    // Stub the plugin's upstream so tools/call returns a marker-bearing result (see Step 0).
    world.http.expect({ method: 'POST', url: API_URL }, () =>
      Response.json({ results: [{ title: 'r', url: 'https://x.invalid', snippet: RESULT_MARKER }] }),
    )

    const token = mintPluginMcpToken({ storageContextId, chatUserId: alice.id, pluginId: PLUGIN_ID })

    // Happy path: real signed token → real plugin tool result over the route.
    const ok = await jsonRpc(world, PLUGIN_ID, token, 'tools/call', { name: 'search', arguments: { query: 'hi' } })
    expect(ok.status).toBe(200)
    expect(JSON.stringify(await ok.json())).toContain(RESULT_MARKER)

    // Negatives (no upstream is hit — the gate rejects before dispatch).
    const noToken = await jsonRpc(world, PLUGIN_ID, '', 'tools/list', {})
    expect(noToken.status).toBe(401)
    const wrongPlugin = mintPluginMcpToken({ storageContextId, chatUserId: alice.id, pluginId: 'other-plugin' })
    const mismatch = await jsonRpc(world, PLUGIN_ID, wrongPlugin, 'tools/list', {})
    expect(mismatch.status).toBe(401)
  },
)
```

Confirm `alice.platformInstanceId`/`alice.id` handle fields, the `setPluginAdminConfig` signature (`plugins/store.js`), the exact `search` response schema the stub must satisfy (`plugins/synthetic-web-search/index.ts` `parseSearchResponse`), and the `given.publicBaseUrl` base matching the token/route host, against the cited files. If Step 0 chose the `tools/list` fallback, replace the happy-path block with a `tools/list` call asserting the `search` descriptor and drop the `world.http.expect` stub.

- [ ] **Step 2: Run the story**

Run: `bun test:stories tests/stories/integrations/mcp/mcp-plugin-route.story.test.ts`
Expected: PASS. A 401 on the happy path means the exposure gate rejected — recheck the enablement stack (publicBaseUrl set before `world.start`, plugin eligible for `configContextId`, `mcp_plugin_servers` enabled, token claims match). If the stub isn't hit, Step 0's egress path was wrong — switch to the `tools/list` fallback.

- [ ] **Step 3: Move the ledger entry**

In `tests/stories/catalog/coverage.ts`, remove `'SCN-http-mcp-plugin': needs(...)` from `AUDIT_RECORDS` (~833-837) and add to `EXECUTABLE_STORY_MAPPINGS`:

```typescript
  'SCN-http-mcp-plugin': {
    verifiedAt: '2026-07-22',
    storyIds: [
      'tests/stories/integrations/mcp/mcp-plugin-route.story.test.ts#SCN-http-mcp-plugin: a signed token calls a hosted plugin tool; bad tokens are rejected',
    ],
  },
```

- [ ] **Step 4: Format and commit**

```bash
npx oxfmt --write tests/stories/integrations/mcp/mcp-plugin-route.story.test.ts tests/stories/catalog/coverage.ts
git add tests/stories/integrations/mcp/mcp-plugin-route.story.test.ts tests/stories/catalog/coverage.ts
git commit -m "test(stories): cover the hosted plugin-MCP route and its token gate"
```

---

## Task 7: Story — `SCN-settings-admin-mcp-plugin-servers` (governance flip)

**Files:**

- Create: `tests/stories/integrations/mcp/mcp-plugin-servers.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts` (move this ID's audit → executable mapping)

**Interfaces:**

- Consumes: the same enablement stack as Task 6; `setMcpPluginServerConfigs` (`src/coding-credentials/mcp-plugin-servers.js`) directly to flip `enabled`.

**Context:** This scenario proves the `mcp_plugin_servers` operator config **governs** the `/mcp/plugin` route: enabled ⇒ the route serves the tool; disabled ⇒ the exposure gate 401s. It reuses Task 6's route driver and enablement but toggles the config between two requests — an authorization flip (rule 3), not a config readback. `setCachedConfig` writes take effect immediately (no restart), so the flip is observable within one scenario.

- [ ] **Step 1: Write the story**

Create `tests/stories/integrations/mcp/mcp-plugin-servers.story.test.ts` mirroring Task 6's setup and the `jsonRpc` helper (repeat the helper — the engineer may read this file standalone), then:

```typescript
// Enabled → the route serves tools/list (the real search descriptor).
given.mcpPluginServer(alice.platformInstanceId, PLUGIN_ID)
await world.start()
const token = mintPluginMcpToken({ storageContextId, chatUserId: alice.id, pluginId: PLUGIN_ID })
const enabled = await jsonRpc(world, PLUGIN_ID, token, 'tools/list', {})
expect(enabled.status).toBe(200)
expect(JSON.stringify(await enabled.json())).toContain('search')

// Operator disables the internal server → same request is now gate-rejected.
setMcpPluginServerConfigs(alice.platformInstanceId, [
  { plugin_id: PLUGIN_ID, enabled: false, default_tool_policy: 'allow' },
])
const disabled = await jsonRpc(world, PLUGIN_ID, token, 'tools/list', {})
expect(disabled.status).toBe(401)
```

Use `tools/list` here (no upstream egress needed — the descriptor is the observable) so this scenario stays fully hermetic regardless of Task 6's Step-0 outcome. Import `setMcpPluginServerConfigs` from `src/coding-credentials/mcp-plugin-servers.js` and reuse the Task 6 imports (`discoverPlugins`, `setPluginAdminConfig`, `setPluginEnabledForContext`, `mintPluginMcpToken`, scoped-context helpers).

- [ ] **Step 2: Run the story**

Run: `bun test:stories tests/stories/integrations/mcp/mcp-plugin-servers.story.test.ts`
Expected: PASS (200 enabled, 401 disabled). If the disabled case still 200s, confirm `setMcpPluginServerConfigs` writes the same `platformInstanceId` the gate reads and that no config cache masks the write.

- [ ] **Step 3: Move the ledger entry**

In `tests/stories/catalog/coverage.ts`, remove `'SCN-settings-admin-mcp-plugin-servers': needs(...)` from `AUDIT_RECORDS` (~843-847) and add to `EXECUTABLE_STORY_MAPPINGS`:

```typescript
  'SCN-settings-admin-mcp-plugin-servers': {
    verifiedAt: '2026-07-22',
    storyIds: [
      'tests/stories/integrations/mcp/mcp-plugin-servers.story.test.ts#SCN-settings-admin-mcp-plugin-servers: operator config governs the hosted plugin-MCP route',
    ],
  },
```

Match the `storyIds` string to the exact `scenario(...)` name you wrote in Step 1.

- [ ] **Step 4: Format and commit**

```bash
npx oxfmt --write tests/stories/integrations/mcp/mcp-plugin-servers.story.test.ts tests/stories/catalog/coverage.ts
git add tests/stories/integrations/mcp/mcp-plugin-servers.story.test.ts tests/stories/catalog/coverage.ts
git commit -m "test(stories): cover operator governance of the hosted plugin-MCP route"
```

---

## Task 8: Ledger reconciliation + compat re-baseline

**Files:**

- Modify: `tests/stories/harness/catalog-coverage.test.ts` (totals literals)
- (Re-baseline the compat manifest per the repo's frozen-tree procedure)

**Context:** After Tasks 4/6/7 moved 3 records from `AUDIT_RECORDS` to `EXECUTABLE_STORY_MAPPINGS`, the contract-test literals must match: executable 97→100 (`catalog-coverage.test.ts:197`), pending 31→28 (`:233`), needs-seam 8→5 (`:263`); executable-as-is stays 1 (`:262`), blocked stays 22 (`:264`), total ids stays 128 (`:109-110`). The manifest totals string is auto-derived (`scripts/story/coverage-totals.ts:31`) — no manual edit. `fake-mcp-server` stays in `STORY_SEAM_IDS` as realized (no removal).

- [ ] **Step 1: Update the totals literals**

In `tests/stories/harness/catalog-coverage.test.ts`:

- Line ~197: `.toHaveLength(97)` → `.toHaveLength(100)`
- Line ~233: `.toHaveLength(31)` → `.toHaveLength(28)`
- Line ~263: needs-seam `.toHaveLength(8)` → `.toHaveLength(5)`

Leave executable-as-is (1), blocked (22), and 128-id literals unchanged.

- [ ] **Step 2: Run the full story contract suite**

Run: `bun test:stories:contracts`
Expected: PASS — including "tracks the executable coverage total" (100), "audit records cover exactly the pending scenarios" (28), and "audit readiness totals match" (1/5/22). Fix any literal the runner reports mismatched.

- [ ] **Step 3: Run all three stories + the harness seams together**

Run: `bun test:stories tests/stories/integrations/mcp/`
Expected: PASS (3 scenarios).

- [ ] **Step 4: Full sandboxed story run + stress**

Run: `bun test:stories`
Expected: PASS (100 executable scenarios; runner prints `story catalog: 100/128 executable; pending 28 (1 executable-as-is, 5 needs-seam, 22 blocked)`).

Run: `bun test:stories:stress`
Expected: PASS with no flakes (the MCP pool-timer isolation from Task 3 is the specific determinism guard under scrutiny).

- [ ] **Step 5: Re-record the compat baseline**

Follow the repo's frozen-tree re-baseline procedure (`tests/CLAUDE.md` E2E section): the intended frozen-byte changes are the new `fake-mcp-server.ts`, the three new story files, the `fixtures.ts`/`scenario.ts` seam edits, and `coverage.ts`. Record the branch HEAD as the new compat baseline SHA and the manifest `treeHash`. Do not re-baseline for anything else.

- [ ] **Step 6: Commit**

```bash
npx oxfmt --write tests/stories/harness/catalog-coverage.test.ts
git add tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): reconcile F7 ledger totals to 100 executable"
```

---

## Self-Review

**Spec coverage:**

- Production seam (user-MCP capability registration) → Task 1. ✓
- `FakeMcpServer` harness seam → Task 2. ✓
- MCP pool teardown → Task 3. ✓
- papai-as-server enablement (`given.mcpPluginServer`) → Task 5. ✓
- `SCN-settings-admin-mcp-catalog` (papai-as-client) → Task 4. ✓
- `SCN-http-mcp-plugin` (papai-as-server route + token negatives) → Task 6. ✓
- `SCN-settings-admin-mcp-plugin-servers` (governance flip) → Task 7. ✓
- Ledger 97→100 / 31→28 / needs-seam 8→5, `fake-mcp-server` realized, compat re-baseline → Tasks 4/6/7 (per-ID) + Task 8. ✓
- Rule-6 reclassification note (catalog → user `mcp_endpoints`): the spec records it on the executable mapping's context; the mapping lands in Task 4 and the audit rationale is already in the spec/roadmap — no separate task needed. ✓
- Spec risks: #1 (handshake order) → Task 4 Step 0; #2 (pool isolation) → Task 3; #3 (egress path) → Task 6 Step 0 with `tools/list` fallback; #4 (capability-id collision) → Task 1 tests; #5 (token/claim binding) → Task 6 (claims match + mismatch negative). ✓

**Deliberate spec exclusions honored:** no fetch-injection seam (Task 2 relies on global-fetch interception); no SDK client in stories (Task 6 hand-crafts JSON-RPC); no bespoke fixture plugin (Tasks 6/7 reuse `synthetic-web-search`); plugin-declared-MCP client path not separately covered (no task — recorded as out of scope).

**Placeholder scan:** discovery spikes (Task 4 Step 0, Task 6 Step 0, Task 3 Step 0) are genuine investigations with exact commands and recorded outcomes, not deferred implementation. All code steps carry real code. Field/signature confirmations against cited `file:line` are verification steps, not TBDs.

**Type consistency:** `registerMcpToolCapabilities(tools, catalog)` (Task 1) matches its callsite (Task 1 Step 5) and test (Task 1 Step 1). `createFakeMcpServer` / `expectConnect` / `expectToolsList` / `expectToolCall` / `verifyConsumed` (Task 2) match their uses (Tasks 2 test, 4). `given.mcpPluginServer(platformInstanceId, pluginId)` (Task 5) matches Tasks 6/7. `mintPluginMcpToken({storageContextId, chatUserId, pluginId})` matches `token.ts:51-59`. Ledger literals (100/28/5/1/22/128) are internally consistent (100+28=128; 1+5+22=28).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-f7-mcp-story-family.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Which approach?
