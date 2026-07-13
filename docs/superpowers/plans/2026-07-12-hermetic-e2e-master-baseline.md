<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Hermetic E2E Master Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and baseline the hermetic full-stack user-story harness on current master so the unchanged harness can later qualify `plugin-core-separation`.

**Architecture:** Extract current startup into a lifecycle-managed `PapaiRuntime` shared by production and tests. Scenario tests use real routing, persistence, settings, plugin activation, AI SDK tool execution, and provider resolution while injecting deterministic chat, model, task-provider, clock/ID, and HTTP boundaries. All files under `tests/stories/**` are hashed into the compatibility manifest.

**Tech Stack:** Bun 1.3.x, TypeScript, `bun:test`, AI SDK 6 `MockLanguageModelV3`, Zod 4, in-memory SQLite, existing papai plugin/provider/settings interfaces.

**Design:** `docs/superpowers/specs/2026-07-12-hermetic-full-stack-e2e-harness-design.md`

---

## Scope boundary

This plan ends with a passing, recorded baseline on the current master architecture. It does not add trusted-module APIs to master and does not modify `plugin-core-separation`. The linked follow-up plan `docs/superpowers/plans/2026-07-12-hermetic-e2e-core-separation-proof.md` applies the frozen baseline to that branch.

## File structure

Production runtime:

- Create `src/runtime/lifecycle.ts` — priority-ordered cleanup stack with LIFO ties and partial-startup rollback.
- Create `src/runtime/capability-catalog.ts` — stable capability id → current wire tool name.
- Create `src/runtime/types.ts` — `PapaiRuntime`, configuration, ingress, and dependency contracts.
- Create `src/runtime/create-runtime.ts` — ordered application startup and shutdown.
- Create `src/runtime/production-deps.ts` — current-master concrete dependencies extracted from `src/index.ts`.
- Modify `src/index.ts` — environment validation, runtime construction, and signal handlers only.
- Modify `src/debug/server.ts` — export the fetch-style route function without binding a port.
- Modify `src/llm-orchestrator-types.ts`, `src/llm-orchestrator.ts` — inject a language model rather than an OpenAI-specific provider factory.
- Modify `src/plugins/runtime-types.ts`, `src/plugins/contributions.ts`, `plugins/acp/*.ts` — stable behavioral capability metadata.

Harness:

- Create `tests/stories/harness/events.ts` — sanitized scenario event recorder.
- Create `tests/stories/harness/chat.ts` — normalized in-process chat ingress and reply capture.
- Create `tests/stories/harness/scripted-llm.ts` — deterministic AI SDK model script.
- Create `tests/stories/harness/strict-http.ts` — exact-match in-memory HTTP dispatcher.
- Create `tests/stories/harness/memory-task-provider.ts` — stateful deterministic `TaskProvider`.
- Create `tests/stories/harness/fixtures.ts` — database/instance/user/context/settings seeds.
- Create `tests/stories/harness/world.ts` — per-scenario runtime ownership and cleanup.
- Create `tests/stories/harness/scenario.ts` — typed `given`/`when`/`then` authoring API.
- Create `tests/stories/preload.ts` — undeclared I/O guards and leak checks.
- Create user stories under `tests/stories/{chat-task,context,settings,integrations}/`.

Runner and proof:

- Create `scripts/test-stories.ts` — sanitized-environment story launcher.
- Create `scripts/story-manifest.ts` — deterministic manifest and compatibility check.
- Modify `package.json`, `bunfig.toml`, `.github/workflows/ci.yml`, `docs/architecture/commands.md`, and `tests/CLAUDE.md`.

### Task 1: Add stable behavioral capability metadata

**Files:**

- Create: `src/runtime/capability-catalog.ts`
- Modify: `src/plugins/runtime-types.ts`
- Modify: `src/plugins/contributions.ts`
- Modify: `plugins/acp/tools.ts`
- Modify: `plugins/acp/session-tools.ts`
- Modify: `plugins/acp/continue-tool.ts`
- Test: `tests/runtime/capability-catalog.test.ts`
- Test: `tests/plugins/contributions.test.ts`

- [ ] **Step 1: Write failing catalog and contribution tests**

Create `tests/runtime/capability-catalog.test.ts` with these cases:

```typescript
import { describe, expect, test } from 'bun:test'

import { createToolCapabilityCatalog } from '../../src/runtime/capability-catalog.js'

describe('tool capability catalog', () => {
  test('resolves a stable capability to its wire name', () => {
    const catalog = createToolCapabilityCatalog()
    catalog.register('coding-session.start', 'plugin_acp__start_session')
    expect(catalog.resolve('coding-session.start')).toBe('plugin_acp__start_session')
  })

  test('rejects duplicate capability ids', () => {
    const catalog = createToolCapabilityCatalog()
    catalog.register('coding-session.start', 'plugin_acp__start_session')
    expect(() => catalog.register('coding-session.start', 'other_start')).toThrow(
      "Duplicate tool capability id 'coding-session.start'",
    )
  })

  test('rejects missing capability ids', () => {
    const catalog = createToolCapabilityCatalog()
    expect(() => catalog.resolve('coding-session.start')).toThrow("Unknown tool capability id 'coding-session.start'")
  })
})
```

Extend `tests/plugins/contributions.test.ts` with a tool carrying `capabilityId: 'coding-session.start'`; assert that building the plugin tool set registers `plugin_demo__start_session` in an injected catalog.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
bun test tests/runtime/capability-catalog.test.ts tests/plugins/contributions.test.ts
```

Expected: FAIL because `capability-catalog.ts`, `PluginTool.capabilityId`, and the catalog injection do not exist.

- [ ] **Step 3: Implement the catalog and metadata propagation**

Create `src/runtime/capability-catalog.ts`:

```typescript
export interface ToolCapabilityCatalog {
  register(capabilityId: string, wireName: string): void
  resolve(capabilityId: string): string
  clear(): void
  entries(): ReadonlyArray<readonly [capabilityId: string, wireName: string]>
}

export function createToolCapabilityCatalog(): ToolCapabilityCatalog {
  const values = new Map<string, string>()
  return {
    register(capabilityId, wireName): void {
      const existing = values.get(capabilityId)
      if (existing === wireName) return
      if (existing !== undefined) throw new Error(`Duplicate tool capability id '${capabilityId}'`)
      values.set(capabilityId, wireName)
    },
    resolve(capabilityId): string {
      const wireName = values.get(capabilityId)
      if (wireName === undefined) throw new Error(`Unknown tool capability id '${capabilityId}'`)
      return wireName
    },
    clear(): void {
      values.clear()
    },
    entries: () => [...values.entries()],
  }
}

export const toolCapabilityCatalog = createToolCapabilityCatalog()
```

Add `capabilityId?: string` to `PluginTool`. Extend `buildPluginToolSet` with a final `ToolCapabilityCatalog` parameter defaulting to `toolCapabilityCatalog`, and register `pluginTool.capabilityId` after collision checks and before creating the AI SDK tool. Repeated assembly of the same capability/wire pair is idempotent; a different wire name for an already registered id fails.

Assign these stable ids in ACP factories:

```typescript
const ACP_CAPABILITIES = {
  listProjects: 'coding-session.projects.list',
  listAgents: 'coding-session.agents.list',
  start: 'coding-session.start',
  list: 'coding-session.list',
  status: 'coding-session.status',
  finish: 'coding-session.finish',
  cancel: 'coding-session.cancel',
  answerPermission: 'coding-session.permission.answer',
  continue: 'coding-session.continue',
} as const
```

Each returned `Tool` must carry the matching `capabilityId`. Keep the wire names unchanged.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
bun test tests/runtime/capability-catalog.test.ts tests/plugins/contributions.test.ts tests/plugins/acp/start-session.test.ts
bun typecheck
```

Expected: all commands exit 0; existing ACP wire-name assertions remain unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/capability-catalog.ts src/plugins/runtime-types.ts src/plugins/contributions.ts plugins/acp tests/runtime/capability-catalog.test.ts tests/plugins/contributions.test.ts
git commit -m "feat(runtime): add stable tool capability catalog"
```

### Task 2: Add a provider-neutral language-model seam

**Files:**

- Modify: `src/llm-orchestrator-types.ts`
- Modify: `src/llm-orchestrator.ts`
- Modify: `tests/llm-orchestrator.test.ts`
- Test: `tests/llm-model-seam.test.ts`

- [ ] **Step 1: Write the failing seam test**

Create a test that supplies a `MockLanguageModelV3` through `buildModel` and verifies that `processMessage` passes that exact model to the real `generateText` dependency. Use a complete global LLM config seed and a providerless DM so no task provider is required.

```typescript
const zeroUsage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
}

test('uses the injected provider-neutral model factory', async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'hello' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: zeroUsage,
      warnings: [],
    }),
  })
  let received: LanguageModel | undefined
  await processMessage(reply, 'dm-alice', 'alice', 'alice', 'hello', 'dm', undefined, {
    ...defaultDeps,
    buildModel: () => model,
    generateText: (options) => {
      received = options.model
      return generateText(options)
    },
    resolve: () => null,
  })
  expect(received).toBe(model)
})
```

- [ ] **Step 2: Run and verify RED**

Run: `bun test tests/llm-model-seam.test.ts`

Expected: FAIL because `LlmOrchestratorDeps` exposes `buildOpenAI`, not `buildModel`.

- [ ] **Step 3: Replace the OpenAI-specific dependency**

In `LlmOrchestratorDeps`, replace `buildOpenAI` with:

```typescript
buildModel: (config: EffectiveLlmConfig) => LanguageModel
```

Set the default in `llm-orchestrator.ts`:

```typescript
buildModel: ({ llmApiKey, llmBaseUrl, mainModel }) =>
  getOpenAICompatibleProvider(llmApiKey, llmBaseUrl)(mainModel),
```

Replace the existing two-line provider/model construction in `callLlm` with:

```typescript
const model = deps.buildModel(resolvedLlm)
```

Mechanically update tests that construct `LlmOrchestratorDeps`: `buildOpenAI: () => provider` becomes `buildModel: () => model`.

- [ ] **Step 4: Verify focused and orchestrator suites**

Run:

```bash
bun test tests/llm-model-seam.test.ts tests/llm-orchestrator.test.ts
bun typecheck
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/llm-orchestrator-types.ts src/llm-orchestrator.ts tests/llm-model-seam.test.ts tests/llm-orchestrator.test.ts
git commit -m "refactor(llm): inject provider-neutral language model"
```

### Task 3: Build the runtime cleanup stack

**Files:**

- Create: `src/runtime/lifecycle.ts`
- Test: `tests/runtime/lifecycle.test.ts`

- [ ] **Step 1: Write lifecycle tests**

Cover priority ordering, reverse-order ties, idempotent stop, and rollback after partial startup:

```typescript
test('runs cleanups once in reverse order', async () => {
  const calls: string[] = []
  const lifecycle = createRuntimeLifecycle()
  lifecycle.add('first', () => void calls.push('first'))
  lifecycle.add('second', async () => void calls.push('second'))
  await lifecycle.stop()
  await lifecycle.stop()
  expect(calls).toEqual(['second', 'first'])
})

test('runs higher-priority cleanup before lower-priority cleanup', async () => {
  const calls: string[] = []
  const lifecycle = createRuntimeLifecycle()
  lifecycle.add('database', () => void calls.push('database'), 0)
  lifecycle.add('ingress', () => void calls.push('ingress'), 100)
  await lifecycle.stop()
  expect(calls).toEqual(['ingress', 'database'])
})

test('reports all cleanup failures', async () => {
  const lifecycle = createRuntimeLifecycle()
  lifecycle.add('one', () => {
    throw new Error('one failed')
  })
  lifecycle.add('two', () => {
    throw new Error('two failed')
  })
  await expect(lifecycle.stop()).rejects.toThrow('Runtime cleanup failed: two: two failed; one: one failed')
})
```

- [ ] **Step 2: Run and verify RED**

Run: `bun test tests/runtime/lifecycle.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement `createRuntimeLifecycle`**

Use this interface:

```typescript
export interface RuntimeLifecycle {
  add(name: string, cleanup: () => void | Promise<void>, priority?: number): void
  stop(): Promise<void>
  pending(): readonly string[]
}
```

Store named cleanups with a monotonic registration index. On stop, sort by descending priority and then descending registration index. Normalize errors with the repository convention and throw one aggregate message after every cleanup has been attempted.

- [ ] **Step 4: Verify**

Run: `bun test tests/runtime/lifecycle.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/lifecycle.ts tests/runtime/lifecycle.test.ts
git commit -m "feat(runtime): add deterministic cleanup lifecycle"
```

### Task 4: Define the shared runtime contract and dependency boundaries

**Files:**

- Create: `src/runtime/types.ts`
- Test: `tests/runtime/types.test.ts`

- [ ] **Step 1: Write a compile-time/runtime contract test**

Construct a minimal `PapaiRuntimeDeps` object with fake database, chat factory, ingress, routing, and background/extension lifecycle functions. Assert the `PapaiRuntimeConfig` defaults disable nothing in production and the scenario helper explicitly disables background/network services.

- [ ] **Step 2: Run and verify RED**

Run: `bun test tests/runtime/types.test.ts`

Expected: FAIL because the types and normalizer do not exist.

- [ ] **Step 3: Add the runtime types**

Define:

```typescript
export type PapaiRuntimeConfig = Readonly<{
  adminUserId: string
  pluginDirectory: string
  startBackgroundServices: boolean
  startNetworkServer: boolean
  sendStartupAnnouncement: boolean
}>

export type RuntimeIngress = Readonly<{
  dispatch(message: IncomingMessage): Promise<void>
  dispatchInteraction(interaction: IncomingInteraction): Promise<void>
}>

export interface PapaiRuntime {
  start(): Promise<void>
  stop(): Promise<void>
  dispatch(message: IncomingMessage): Promise<void>
  dispatchInteraction(interaction: IncomingInteraction): Promise<void>
  request(request: Request): Promise<Response>
  resolveToolCapability(capabilityId: string): string
}
```

`PapaiRuntimeDeps` groups the current startup collaborators into focused records:

```typescript
export type PapaiRuntimeDeps = Readonly<{
  database: { start(): void | Promise<void>; stop(): void | Promise<void> }
  chat: {
    createRouter(): ChatRouter
    ingress: RuntimeIngress
    setRuntime(router: ChatRouter): void
    clearRuntime(): void
  }
  extensions: { start(router: ChatRouter): Promise<readonly string[]>; stop(): Promise<void> }
  application: {
    initializeStores(): void
    setupBot(router: ChatRouter, adminUserId: string): void
    registerCommandMenu(router: ChatRouter, adminUserId: string): Promise<void>
    announceStartup(router: ChatRouter, adminUserId: string): Promise<void>
    flush(): Promise<void>
  }
  background: { start(router: ChatRouter): void; stop(): void }
  web: { start(adminUserId: string): void; stop(): void; route(request: Request): Promise<Response> }
  capabilities: ToolCapabilityCatalog
}>

export type PartialRuntimeDeps = {
  [K in keyof PapaiRuntimeDeps]?: Partial<PapaiRuntimeDeps[K]>
}
```

`createProductionRuntimeDeps(overrides?)` returns these dependencies with `capabilities: toolCapabilityCatalog` and performs a shallow merge by dependency group for scenario overrides. Keep startup data loading and compatibility evaluation in the production implementation of `extensions.start`; do not duplicate them in the scenario world.

- [ ] **Step 4: Verify**

Run: `bun test tests/runtime/types.test.ts && bun typecheck`

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/types.ts tests/runtime/types.test.ts
git commit -m "feat(runtime): define shared application contract"
```

### Task 5: Implement `createPapaiRuntime`

**Files:**

- Create: `src/runtime/create-runtime.ts`
- Test: `tests/runtime/create-runtime.test.ts`

- [ ] **Step 1: Write ordered-startup and rollback tests**

Use dependency fakes that append these events:

```typescript
expect(events).toEqual([
  'database:start',
  'stores:initialize',
  'chat:set-runtime',
  'extensions:start',
  'bot:setup',
  'chat:start',
  'commands:register',
])
```

With announcement, background, and network enabled, append `announcement:send`, `background:start`, and `web:start` in that order. Add a failure at `extensions:start` and assert database/chat cleanup still runs. Assert `dispatch` and `request` reject before `start()` and after `stop()`.

- [ ] **Step 2: Run and verify RED**

Run: `bun test tests/runtime/create-runtime.test.ts`

Expected: FAIL because `createPapaiRuntime` does not exist.

- [ ] **Step 3: Implement ordered lifecycle composition**

`createPapaiRuntime(config, deps)` must:

1. guard state with `'new' | 'starting' | 'started' | 'stopping' | 'stopped'`;
2. clear the capability catalog, register its cleanup, then call each dependency in the tested order;
3. register cleanup immediately after each successful start;
4. call `lifecycle.stop()` if any later phase fails;
5. delegate ingress, request routing, and capability resolution only while started;
6. honor each optional-service flag independently;
7. make `stop()` idempotent.

Register cleanup priorities as constants so shutdown is deterministic and preserves the current safety constraints:

```typescript
const CLEANUP_PRIORITY = {
  clearIngress: 100,
  flush: 90,
  extensions: 80,
  background: 70,
  web: 60,
  chat: 50,
  capabilities: 10,
  database: 0,
} as const
```

Register `application.flush()` after store initialization, even when queues are empty. Within `extensions.stop`, plugin cleanups remain reverse activation order.

Do not import feature/plugin modules from this file. All current-master specifics belong in `production-deps.ts`.

- [ ] **Step 4: Verify**

Run: `bun test tests/runtime/create-runtime.test.ts tests/runtime/lifecycle.test.ts && bun typecheck`

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/create-runtime.ts tests/runtime/create-runtime.test.ts
git commit -m "feat(runtime): compose lifecycle-managed papai runtime"
```

### Task 6: Extract current production composition from `src/index.ts`

**Files:**

- Create: `src/runtime/production-deps.ts`
- Modify: `src/index.ts`
- Modify: `src/debug/server.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/index-startup.test.ts`
- Test: `tests/runtime/production-deps.test.ts`

- [ ] **Step 1: Move existing startup characterization assertions to runtime tests**

Before changing `src/index.ts`, add tests around `createProductionRuntimeDeps` for:

- unreadable platform/task rows are logged and skipped;
- compatibility evaluates readable platform/task instances;
- plugin discovery guard behavior is preserved;
- `setupBot` occurs before chat start;
- shutdown ordering is `clearRuntime` → queue flush → extension stop → background stop → web stop → chat stop → database stop.

Run the existing `tests/index.test.ts` and `tests/index-startup.test.ts` once to record the green baseline.

- [ ] **Step 2: Run the new tests and verify RED**

Run: `bun test tests/runtime/production-deps.test.ts`

Expected: FAIL because `createProductionRuntimeDeps` does not exist.

- [ ] **Step 3: Export the fetch-style route**

In `src/debug/server.ts`, rename the internal `routeRequest` to exported `routeRequest`, retain:

```typescript
export const routeRequestForTest = (req: Request, options?: Partial<WebServerRouteOptions>): Promise<Response> =>
  routeRequest(req, { ...DEFAULT_ROUTE_OPTIONS, ...options })
```

Both `Bun.serve` and `PapaiRuntime.request()` must call this same function.

- [ ] **Step 4: Implement production dependencies by moving code, not rewriting behavior**

Move the bodies from current `src/index.ts` into the focused dependency groups defined in Task 4. Preserve existing logging and ordering. Export `createProductionRuntimeDeps(overrides?: PartialRuntimeDeps)`; merge overrides by top-level dependency group so the scenario world can replace database/chat/application/web boundaries while retaining real extension composition. The production ingress is an object whose dispatch methods throw `Programmatic ingress is available only when configured`; real adapters continue invoking registered handlers normally.

The application `setupBot` closure must inject `LlmOrchestratorDeps` through the existing lazy import:

```typescript
const processMessage: BotDeps['processMessage'] = (...args) =>
  import('../llm-orchestrator.js').then((mod) => mod.processMessage(...args))
```

The extension start/stop pair owns discovery, compatibility evaluation, activation, Kaneo repair, health warnings, and `deactivateAllPlugins()`.

- [ ] **Step 5: Reduce `src/index.ts` to the executable shell**

Keep required-env validation and signal registration. Construct production config with all three service flags enabled, start once, and on either signal await `runtime.stop()` before `process.exit(0)`.

- [ ] **Step 6: Verify parity**

Run:

```bash
bun test tests/runtime/production-deps.test.ts tests/runtime/create-runtime.test.ts tests/index.test.ts tests/index-startup.test.ts
bun typecheck
```

Expected: exit 0. Update old source-text assertions to target runtime behavior, not implementation strings in `src/index.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/production-deps.ts src/index.ts src/debug/server.ts tests/runtime/production-deps.test.ts tests/index.test.ts tests/index-startup.test.ts
git commit -m "refactor(startup): run production through PapaiRuntime"
```

### Task 7: Add deterministic event, chat, and HTTP boundaries

**Files:**

- Create: `tests/stories/harness/events.ts`
- Create: `tests/stories/harness/chat.ts`
- Create: `tests/stories/harness/strict-http.ts`
- Test: `tests/stories/harness/events.test.ts`
- Test: `tests/stories/harness/chat.test.ts`
- Test: `tests/stories/harness/strict-http.test.ts`

- [ ] **Step 1: Write boundary tests**

Test that:

- events receive monotonically increasing sequence numbers;
- sensitive headers are rendered as `[REDACTED]`;
- chat dispatch before bot registration fails with scenario and phase;
- a dispatched message captures `text`, `formatted`, and proactive `sendMessage` replies;
- strict HTTP consumes a declared expectation once and fails on undeclared or leftover requests.

- [ ] **Step 2: Run and verify RED**

Run: `bun test tests/stories/harness/events.test.ts tests/stories/harness/chat.test.ts tests/stories/harness/strict-http.test.ts`

Expected: FAIL because the harness files do not exist.

- [ ] **Step 3: Implement `ScenarioEvents`**

Use a discriminated event type with `seq`, `phase`, and sanitized `data`. Provide `record`, `all`, `recent(limit)`, `setPhase`, and `formatFailure`.

- [ ] **Step 4: Implement `ScenarioChat`**

Implement `ChatProvider` plus `RuntimeIngress`. Capture registered message/interaction handlers. For each dispatch, create a complete `ReplyFn` that records replies and returns deterministic handles for buttons/status. `start()` and `stop()` update lifecycle state and event records.

- [ ] **Step 5: Implement exact-match `StrictHttpDispatcher`**

Expose:

```typescript
expect(request: { method: string; url: string }, respond: (request: Request) => Response | Promise<Response>): void
fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
verifyConsumed(): void
```

Match method and normalized URL exactly, consume in declaration order, record sanitized request metadata, and reject redirects unless the expectation explicitly returns one.

- [ ] **Step 6: Verify**

Run the three focused test files. Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add tests/stories/harness/events.ts tests/stories/harness/chat.ts tests/stories/harness/strict-http.ts tests/stories/harness/*.test.ts
git commit -m "test(stories): add deterministic external boundaries"
```

### Task 8: Add the scripted AI SDK model

**Files:**

- Create: `tests/stories/harness/scripted-llm.ts`
- Test: `tests/stories/harness/scripted-llm.test.ts`

- [ ] **Step 1: Write model-script tests**

Cover a two-step script:

```typescript
const script = createScriptedModel({ resolveCapability })
script.enqueue([
  callCapability('tasks.create', { title: 'Release 7', projectId: 'project-1' }),
  answer('Created “Release 7”.'),
])
```

Assert the first AI SDK generation emits a V3 tool call using the resolved wire name, the second sees a tool result and emits text, missing advertised tools fail, and `verifyConsumed()` reports unused steps.

- [ ] **Step 2: Run and verify RED**

Run: `bun test tests/stories/harness/scripted-llm.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement with `MockLanguageModelV3`**

Define:

```typescript
export type ModelDecision = { kind: 'tool'; capabilityId: string; input: unknown } | { kind: 'answer'; text: string }

export const callCapability = (capabilityId: string, input: unknown): ModelDecision => ({
  kind: 'tool',
  capabilityId,
  input,
})

export const answer = (text: string): ModelDecision => ({ kind: 'answer', text })
```

Build `MockLanguageModelV3.doGenerate` with deterministic call IDs from the scenario ID source. Before returning a tool call, verify the resolved wire name exists in the `tools` passed to the model. Return complete V3 usage, warning, and finish-reason shapes. Record prompt summaries without credentials or full tool schemas.

- [ ] **Step 4: Verify with real AI SDK execution**

Add one test calling `generateText({ model, tools, stopWhen: stepCountIs(5), messages })` and assert the actual tool executor runs. Then run the focused suite.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/harness/scripted-llm.ts tests/stories/harness/scripted-llm.test.ts
git commit -m "test(stories): add deterministic AI SDK script model"
```

### Task 9: Add deterministic task state and database fixtures

**Files:**

- Create: `tests/stories/harness/memory-task-provider.ts`
- Create: `tests/stories/harness/fixtures.ts`
- Test: `tests/stories/harness/memory-task-provider.test.ts`
- Test: `tests/stories/harness/fixtures.test.ts`

- [ ] **Step 1: Write provider and fixture tests**

Test create/get/list/update task behavior, deterministic IDs, fresh state, platform/task instance seeding, context assignment, group/member setup, system LLM config, and plugin approval records.

- [ ] **Step 2: Run and verify RED**

Run: `bun test tests/stories/harness/memory-task-provider.test.ts tests/stories/harness/fixtures.test.ts`

Expected: FAIL because the files do not exist.

- [ ] **Step 3: Implement `MemoryTaskProvider`**

Implement only the required `TaskProvider` core methods (`createTask`, `getTask`, `updateTask`, `listTasks`, `searchTasks`) plus exact capabilities needed by the walking skeleton. Store immutable copies in a map and emit scenario events. Missing task IDs throw `Task not found: <id>`.

- [ ] **Step 4: Register the memory provider through the real registry**

Fixtures call `registerContributedTaskProviderType('kaneo', ...)` with `pluginId: 'scenario-memory-provider'`, empty schemas, and the factory returning the world-owned provider. Teardown calls `unregisterContributedTaskProviderType('scenario-memory-provider')`. Do not bypass `TaskProviderResolver`.

- [ ] **Step 5: Implement database fixtures**

Reuse `setupTestDb`, `seedTestPlatformInstance`, `seedTestTaskInstance`, `setContextSettings`, existing authorized-group/member stores, `setSystemConfigValue`, and plugin registry/store APIs. Do not write SQL from the harness when a production store exists.

- [ ] **Step 6: Verify**

Run both focused tests and `bun typecheck`. Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add tests/stories/harness/memory-task-provider.ts tests/stories/harness/fixtures.ts tests/stories/harness/memory-task-provider.test.ts tests/stories/harness/fixtures.test.ts
git commit -m "test(stories): add deterministic task and state fixtures"
```

### Task 10: Compose a fresh `ScenarioWorld` and typed DSL

**Files:**

- Create: `tests/stories/harness/world.ts`
- Create: `tests/stories/harness/scenario.ts`
- Test: `tests/stories/harness/world.test.ts`
- Test: `tests/stories/harness/scenario.test.ts`

- [ ] **Step 1: Write fresh-world and leak tests**

Create two worlds sequentially. Seed data and consume an LLM step in the first; assert the second has a new DB, empty task/reply/event state, reset capability catalog, no active plugins, and ID counter starting at one. Force a scenario assertion failure and verify `runtime.stop`, plugin deactivation, provider unregister, DB reset, and strict HTTP verification still run.

- [ ] **Step 2: Run and verify RED**

Run: `bun test tests/stories/harness/world.test.ts tests/stories/harness/scenario.test.ts`

Expected: FAIL because the world and DSL do not exist.

- [ ] **Step 3: Implement world construction**

`createScenarioWorld(name)` must create events, fixed clock (`2026-01-01T00:00:00.000Z`), seeded IDs, strict HTTP, scenario chat, scripted model, memory provider, fresh DB lifecycle, and `PapaiRuntime` configured with all background/network/announcement flags false. The runtime still performs real plugin discovery/activation and real bot/settings/tool wiring.

- [ ] **Step 4: Implement the typed DSL**

Expose:

```typescript
export type ScenarioApi = {
  given: ScenarioGiven
  when: ScenarioWhen
  then: ScenarioThen
  world: ScenarioWorld
}

export function scenario(name: string, run: (api: ScenarioApi) => Promise<void>): void {
  test(name, async () => {
    const world = await createScenarioWorld(name)
    try {
      await run(world.api)
      world.verify()
    } finally {
      await world.stop()
    }
  })
}
```

Provide typed handles for users, groups, threads, task instances, and plugins. `then` methods use Bun `expect` and add recent sanitized events to thrown assertion messages.

- [ ] **Step 5: Verify**

Run both focused files twice, once serially and once with `--rerun-each 3`. Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add tests/stories/harness/world.ts tests/stories/harness/scenario.ts tests/stories/harness/world.test.ts tests/stories/harness/scenario.test.ts
git commit -m "test(stories): compose fresh typed scenario worlds"
```

### Task 11: Add the master walking-skeleton user stories

**Files:**

- Create: `tests/stories/chat-task/create-and-read-task.story.test.ts`
- Create: `tests/stories/context/group-users.story.test.ts`
- Create: `tests/stories/context/thread-scope.story.test.ts`
- Create: `tests/stories/context/guest-readonly.story.test.ts`

- [ ] **Step 1: Write the chat-to-task story**

Use the DSL to seed Alice, a DM, a task instance assignment, and this model script:

```typescript
given.llm([
  callCapability('tasks.create', { projectId: 'project-1', title: 'Release 7' }),
  answer('Created “Release 7”.'),
])
await when.message(alice, dm, 'Create task Release 7')
then.replyTo(alice).equals('Created “Release 7”.')
then.task('Release 7').exists()
```

Add a second turn that calls `tasks.get` and asserts conversation history affects the real prompt and final reply.

- [ ] **Step 2: Run and verify RED**

Run the story. Expected: FAIL at the first missing fixture, capability id, or orchestration integration rather than a live network call.

- [ ] **Step 3: Add stable capability ids for core task tools**

Extend the capability catalog integration to built-in tool assembly with this immutable map:

```typescript
const CORE_TOOL_CAPABILITIES = {
  'tasks.create': 'create_task',
  'tasks.get': 'get_task',
  'tasks.list': 'list_tasks',
  'tasks.search': 'search_tasks',
} as const
```

After core tool construction, register only entries whose wire names exist in the real tool set. Preserve all wire names and permission keys. Add a focused test proving a provider/context that omits a tool does not advertise that capability for the turn even though the global catalog knows its stable mapping.

- [ ] **Step 4: Write group, thread, and guest stories**

Use real context scope helpers and authorization stores. Assert:

- two group members share durable group settings but keep their own identities;
- two threads share config-context settings while histories remain isolated;
- a guest sees a read tool but the real offered tool set omits `tasks.create`.

- [ ] **Step 5: Verify stories under repeated/random order**

Run:

```bash
bun test tests/stories/chat-task tests/stories/context --rerun-each 3
bun test tests/stories/chat-task tests/stories/context --seed 41021
```

Expected: exit 0 with identical semantic outcomes.

- [ ] **Step 6: Commit**

```bash
git add src/tools tests/stories/chat-task tests/stories/context
git commit -m "test(stories): prove chat task and context behavior"
```

### Task 12: Add a real settings-route story

**Files:**

- Create: `tests/stories/settings/task-instance-assignment.story.test.ts`
- Modify: `tests/stories/harness/fixtures.ts`

- [ ] **Step 1: Write the settings story**

Establish a real settings session using the same auth-code exchange as `tests/debug/settings/helpers.ts`. Send an authenticated, CSRF-protected `PATCH /settings/api/context/task-instance` through `runtime.request()`. Assert status 200 and then send a chat message whose real provider resolution uses the newly assigned memory task provider.

- [ ] **Step 2: Run and verify RED**

Run: `bun test tests/stories/settings/task-instance-assignment.story.test.ts`

Expected: FAIL until the world exposes authenticated request helpers and the runtime route initializes settings auth state correctly.

- [ ] **Step 3: Add request helpers without bypassing routes**

Add `given.settingsSession(user)` and `when.settingsRequest(session, path, init)`. Reuse production auth code/session stores; do not directly mutate the final context assignment in this story.

- [ ] **Step 4: Verify**

Run the settings story together with `tests/debug/settings/context-task-instance-routes.test.ts`. Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/settings/task-instance-assignment.story.test.ts tests/stories/harness/fixtures.ts
git commit -m "test(stories): prove settings changes affect chat turns"
```

### Task 13: Add real ACP-plugin/fake-magi and plugin lifecycle stories

**Files:**

- Create: `tests/stories/integrations/coding-sessions/start-session.story.test.ts`
- Create: `tests/stories/integrations/plugins/eligibility.story.test.ts`
- Create: `tests/stories/harness/fake-magi.ts`
- Test: `tests/stories/harness/fake-magi.test.ts`

- [ ] **Step 1: Implement and test the fake magi contract**

Register exact `StrictHttpDispatcher` expectations for `GET /agents`, `POST /sessions`, `GET /sessions`, and `GET /sessions/:id`. Validate request JSON with Zod, record sanitized bodies, and return deterministic session IDs and transcript URLs.

- [ ] **Step 2: Write the coding-session story**

Seed real ACP approval, admin magi config, repository and coding credentials through production stores. Script `callCapability('coding-session.start', { project: 'papai', prompt: 'Add health check' })`, then answer with the transcript URL. Assert:

- the real ACP plugin contributed the resolved wire tool;
- fake magi received the correct project/context/prompt shape with secrets redacted from events;
- plugin KV contains the session record;
- the reply contains the transcript URL.

- [ ] **Step 3: Run and verify RED, then fix only harness/runtime seams**

Run: `bun test tests/stories/integrations/coding-sessions/start-session.story.test.ts`

Expected initial failure: a missing declared fixture or HTTP expectation. Do not replace ACP execution with a fake tool.

- [ ] **Step 4: Add plugin lifecycle story**

Use `synthetic-web-search` or a minimal checked-in test fixture plugin. Assert approved+eligible contributes its tool, disabled does not, and incompatible chat capabilities do not. This story may name the plugin because lifecycle behavior is its subject.

- [ ] **Step 5: Verify**

Run:

```bash
bun test tests/stories/integrations tests/plugins/acp/start-session.test.ts tests/plugins/integration.test.ts
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add tests/stories/integrations tests/stories/harness/fake-magi.ts tests/stories/harness/fake-magi.test.ts
git commit -m "test(stories): prove ACP and plugin integration behavior"
```

### Task 14: Enforce sanitized environment and undeclared-I/O failures

**Files:**

- Create: `tests/stories/preload.ts`
- Create: `tests/stories/harness/io-guard.ts`
- Create: `scripts/test-stories.ts`
- Test: `tests/stories/harness/io-guard.test.ts`
- Modify: `package.json`
- Modify: `bunfig.toml`

- [ ] **Step 1: Write I/O guard tests**

In isolated child invocations of the story runner, assert undeclared `fetch`, `Bun.spawn`, `node:child_process.execFile`, socket listen/connect, `Bun.write`, and `node:fs` writes outside the scenario temp root fail with scenario name, phase, and attempted operation. Assert writes inside the root and declared strict HTTP calls succeed.

- [ ] **Step 2: Run and verify RED**

Run: `bun test tests/stories/harness/io-guard.test.ts`

Expected: FAIL because guards and launcher do not exist.

- [ ] **Step 3: Implement the launcher with an explicit environment**

`scripts/test-stories.ts` spawns `bun test` for `tests/stories/**/*.story.test.ts` with:

```typescript
const allowed = ['PATH', 'HOME', 'TMPDIR', 'CI'] as const
const env = Object.fromEntries(
  allowed.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]!]])),
)
env['TZ'] = 'UTC'
env['PAPAI_STORY_RUNNER'] = '1'
```

Invoke the child as `bun --no-env-file test`, pass `--preload ./tests/stories/preload.ts`, and forward supported `--seed`, `--rerun-each`, `--randomize`, `--test-name-pattern`, and reporter arguments. Never load `.env`.

- [ ] **Step 4: Implement guards and restoration**

The preload installs before any story module import. Wrap global fetch, Bun process APIs, Node child-process/socket exports, and filesystem write APIs. All wrappers consult the active world boundary. If no world is active, reject. Restore originals in preload `afterAll`; per-scenario verification asserts no active timers/listeners/servers or environment mutations.

- [ ] **Step 5: Add package scripts and discovery exclusions**

Add:

```json
"test:stories": "bun scripts/test-stories.ts",
"test:stories:stress": "bun scripts/test-stories.ts --rerun-each 10 --randomize"
```

Add `tests/stories/**` to default `bunfig.toml` ignore patterns so `bun run test` does not run the special-preload suite.

- [ ] **Step 6: Verify**

Run:

```bash
bun test tests/stories/harness/io-guard.test.ts
bun test:stories
```

Expected: both exit 0; deliberately undeclared operations fail only inside the negative guard tests.

- [ ] **Step 7: Commit**

```bash
git add tests/stories/preload.ts tests/stories/harness/io-guard.ts tests/stories/harness/io-guard.test.ts scripts/test-stories.ts package.json bunfig.toml
git commit -m "test(stories): enforce hermetic process boundaries"
```

### Task 15: Add the frozen manifest, CI baseline, and documentation

**Files:**

- Create: `scripts/story-manifest.ts`
- Test: `tests/scripts/story-manifest.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`
- Modify: `docs/architecture/commands.md`
- Modify: `tests/CLAUDE.md`

- [ ] **Step 1: Write manifest tests**

Build fixtures in a temporary git repository. Assert deterministic sorted hashes for every file under `tests/stories/**`, inclusion of scenario IDs, mismatch failure naming changed files, and success against an explicit baseline ref.

- [ ] **Step 2: Run and verify RED**

Run: `bun test tests/scripts/story-manifest.test.ts`

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement manifest generation and comparison**

The JSON schema is:

```typescript
const StoryManifestSchema = z.object({
  version: z.literal(1),
  commit: z.string().min(7),
  bunVersion: z.string().min(1),
  seed: z.number().int(),
  treeHash: z.string().regex(/^[a-f0-9]{64}$/u),
  files: z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/u) })),
  scenarios: z.array(z.object({ id: z.string(), checkpoints: z.array(z.string()) })),
})
```

Hash Git blob bytes for committed baseline comparison and filesystem bytes for the current candidate; normalize ordering, not content. `--baseline-ref=<ref>` exits nonzero before stories run when any `tests/stories/**` file differs.

- [ ] **Step 4: Wire manifest output into the runner**

Add `test:stories:manifest` and `test:stories:compat` package scripts. The normal runner writes `reports/stories/manifest.json` and JUnit output. The compatibility script requires `BASE_REF` or `--baseline-ref` and refuses an implicit default.

- [ ] **Step 5: Add required CI job**

Add a `stories` job after dependency installation and client build. Run `bun test:stories`, upload `reports/stories/**` on `always()`, and do not configure retries. Do not enable compatibility mode on master; that mode is used by the refactor PR after rebasing onto the baseline.

- [ ] **Step 6: Document commands and invariants**

Document sanitized env, no retries, full `tests/stories/**` freeze, fake transport policy, failure traces, and baseline/candidate procedure in both docs. Add the harness to the E2E section without replacing the Docker provider-real tier.

- [ ] **Step 7: Run complete verification and record baseline**

Run:

```bash
bun build:client
bun test:stories
bun test:stories:stress
bun run test
bun test:client
bun check:full
```

Expected: all commands exit 0. Record the committed baseline SHA and generated manifest hash in the CI artifact; do not commit machine-specific reports.

- [ ] **Step 8: Commit**

```bash
git add scripts/story-manifest.ts tests/scripts/story-manifest.test.ts .github/workflows/ci.yml package.json docs/architecture/commands.md tests/CLAUDE.md
git commit -m "ci(stories): establish hermetic master baseline"
```

## Master baseline completion gate

Before starting the linked refactor-qualification plan, verify all of the following:

- `src/index.ts` and stories construct the application through the same `createPapaiRuntime`.
- `tests/stories/**` passes twice with the same seed and manifest hash.
- The master baseline commit containing the harness is reachable by the refactor branch.
- `reports/stories/manifest.json` records every file under `tests/stories/**`.
- No story uses live network, wall-clock IDs, developer credentials, or direct final-state database writes for the behavior under test.
- The ACP story runs the checked-in ACP plugin and real tool executor against fake magi.
- Existing `package.json`/`bun.lock` changes are reconciled intentionally before execution; do not overwrite unrelated user work.
