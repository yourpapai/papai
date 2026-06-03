<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin Review Follow-Up Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the remaining worthwhile plugin review findings: `/plugin disable` must reject unknown or inactive plugins, remove cheap dead-code cleanup, and make plugin tool-name collisions visible through existing plugin runtime diagnostics.

**Architecture:** Keep the changes small and local. Command validation stays in `src/commands/plugin.ts`; provider registry cleanup stays in `src/providers/registry.ts`; collision observability reuses the existing `plugin_runtime_events` table and `/plugin info` recent-events output instead of adding a new alerting surface.

**Tech Stack:** Bun test runner (`bun:test`), TypeScript strict mode, SQLite/Drizzle-backed plugin store, existing plugin registry and contribution registry modules.

---

## Recommended Scope

Fix now:

- `/plugin disable` ghost-write for unknown or inactive plugin IDs.
- Remove the unused `adminUserId` parameter from `registerPluginCommand()` and its call sites.
- Remove the redundant module-private `ProviderFactory` alias.
- Remove the production export `getContributedTaskProviderType()` by rewriting tests to use production-facing APIs.
- Record plugin tool-name collisions as runtime `skipped` events so `/plugin info <id>` surfaces the issue.

Do not change in this pass:

- Startup race finding: current `src/index.ts` already awaits `activatePlugins()` before `setupBot()`, `chatProvider.start()`, scheduler startup, and poller startup.
- `TaskProviderTypeDescriptor.configSchema` compatibility surface: it is explicitly intentional and still supports legacy descriptor consumers and tests.
- `/config` inactive-vs-disabled wording: `/config` currently filters to active plugins in `appendPluginConfigLines()`, so inactive plugins are absent rather than mislabeled in the normal UI flow.

## File Structure

- Modify: `src/commands/plugin.ts`
  - Responsibility: `/plugin` command registration and subcommand behavior.
  - Changes: validate `disable` against the registry just like `enable`; drop unused `adminUserId` parameter from `registerPluginCommand()`.
- Modify: `src/bot.ts`
  - Responsibility: bot command wiring.
  - Changes: call `registerPluginCommand(observedChat)` with the new signature.
- Modify: `src/providers/registry.ts`
  - Responsibility: built-in and plugin-contributed task provider registration and runtime provider construction.
  - Changes: inline the `TaskProviderFactory` type where the redundant alias is used; delete `getContributedTaskProviderType()`.
- Modify: `src/plugins/contributions.ts`
  - Responsibility: plugin tool/prompt/job/command contribution assembly.
  - Changes: record a `skipped` runtime event when a plugin tool contribution collides with an existing tool name.
- Modify: `tests/commands/plugin.test.ts`
  - Responsibility: `/plugin` command behavior tests.
  - Changes: add regression coverage for unknown `disable`; update `registerPluginCommand()` calls.
- Modify: `tests/providers/registry.test.ts`
  - Responsibility: provider registry behavior tests.
  - Changes: remove `getContributedTaskProviderType()` imports/assertions and assert through `createProvider()`, `getTaskProviderDescriptor()`, or thrown unknown-provider errors.
- Modify: `tests/plugins/context.test.ts`
  - Responsibility: plugin context facade tests.
  - Changes: assert contributed provider registration through `getTaskProviderDescriptor()`.
- Modify: `tests/plugins/loader.test.ts`
  - Responsibility: plugin activation/deactivation tests.
  - Changes: assert contributed provider availability through `getTaskProviderDescriptor()` and `createProvider()`.
- Modify: `tests/plugins/contributions.test.ts`
  - Responsibility: contribution registry and tool assembly tests.
  - Changes: assert collisions create `skipped` runtime events.

## External References Checked

- TypeScript `noUnusedParameters`: underscore-prefixed parameters are exempt from unused-parameter checks, which explains why `_adminUserId` compiled. Source: TypeScript TSConfig `noUnusedParameters` documentation and TypeScript baseline tests.

---

### Task 1: Make `/plugin disable` Reject Unknown and Inactive Plugins

**Files:**

- Modify: `tests/commands/plugin.test.ts:15-16,68-70,340-419`
- Modify: `src/commands/plugin.ts:164-174`

- [ ] **Step 1: Write the failing regression test**

In `tests/commands/plugin.test.ts`, update the store import near the top from:

```ts
import { getPluginAdminState, isPluginEnabledForContext, recordRuntimeEvent } from '../../src/plugins/store.js'
```

to:

```ts
import {
  getPluginAdminState,
  getPluginContextState,
  isPluginEnabledForContext,
  recordRuntimeEvent,
} from '../../src/plugins/store.js'
```

Add this test immediately after `test('enables and disables an active plugin for a context', ...)`:

```ts
test('disable rejects an unknown plugin without writing context state', async () => {
  addAdmin('admin-user', 'test-instance')
  setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-1', platformInstanceId: 'test-instance' })

  const output = await runPluginCommand('disable typo-plugin ctx-1')

  expect(output).toContain('not found')
  expect(getPluginContextState('typo-plugin', 'ctx-1')).toBeUndefined()
})
```

Add this test immediately after the unknown-plugin test:

```ts
test('disable rejects a discovered but inactive plugin without writing context state', async () => {
  addAdmin('admin-user', 'test-instance')
  setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-1', platformInstanceId: 'test-instance' })
  const plugin = makePlugin('inactive-disable-plugin')
  pluginRegistry.registerDiscovered(plugin)

  const output = await runPluginCommand('disable inactive-disable-plugin ctx-1')

  expect(output).toContain('not active')
  expect(getPluginContextState('inactive-disable-plugin', 'ctx-1')).toBeUndefined()
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/commands/plugin.test.ts --preload ./tests/mock-reset.ts
```

Expected: FAIL. The unknown-plugin test receives `Plugin \`typo-plugin\` disabled.`or finds a persisted context-state row, because current`handleDisable()` writes unconditionally.

- [ ] **Step 3: Implement the minimal command validation**

Replace `handleDisable()` in `src/commands/plugin.ts` with:

```ts
async function handleDisable(
  pluginId: string,
  targetContextId: string,
  adminUserId: string,
  reply: ReplyFn,
): Promise<void> {
  const entry = pluginRegistry.getEntry(pluginId)
  if (entry === undefined) {
    await reply.text(`Plugin \`${pluginId}\` not found.`)
    return
  }
  if (entry.state !== 'active') {
    await reply.text(
      `Plugin \`${pluginId}\` is not active (state: ${entry.state}). It must be active before disabling.`,
    )
    return
  }

  setPluginEnabledForContext(pluginId, targetContextId, false)
  const enabledPluginCount = getEnabledPluginsForContext(targetContextId).length
  log.info({ pluginId, targetContextId, adminUserId, enabledPluginCount }, 'Plugin disabled for context via command')
  await reply.text(`⭕ Plugin \`${pluginId}\` disabled.`)
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
bun test tests/commands/plugin.test.ts --preload ./tests/mock-reset.ts
```

Expected: PASS for `tests/commands/plugin.test.ts`.

- [ ] **Step 5: Commit**

Run:

```bash
git add tests/commands/plugin.test.ts src/commands/plugin.ts
git commit -m "fix(plugins): reject invalid disable targets"
```

---

### Task 2: Remove `registerPluginCommand` Dead Parameter

**Files:**

- Modify: `tests/commands/plugin.test.ts:68-70,124-128`
- Modify: `src/commands/plugin.ts:263`
- Modify: `src/bot.ts:119`

- [ ] **Step 1: Update call sites first**

In `tests/commands/plugin.test.ts`, change `registerCommandForTest()` from:

```ts
function registerCommandForTest(): CommandHandler {
  const { provider, commandHandlers } = createMockChatWithCommandHandlers()
  registerPluginCommand(provider, 'admin-user')
  const handler = commandHandlers.get('plugin')
  if (handler === undefined) throw new Error('plugin command was not registered')
  return handler
}
```

to:

```ts
function registerCommandForTest(): CommandHandler {
  const { provider, commandHandlers } = createMockChatWithCommandHandlers()
  registerPluginCommand(provider)
  const handler = commandHandlers.get('plugin')
  if (handler === undefined) throw new Error('plugin command was not registered')
  return handler
}
```

In `tests/commands/plugin.test.ts`, change this direct registration inside `registers plugin management list command for bot admin` from:

```ts
registerPluginCommand(provider, 'admin-user')
```

to:

```ts
registerPluginCommand(provider)
```

In `src/bot.ts`, change:

```ts
registerPluginCommand(observedChat, adminUserId)
```

to:

```ts
registerPluginCommand(observedChat)
```

- [ ] **Step 2: Run typecheck to verify failure**

Run:

```bash
bun typecheck
```

Expected: FAIL with TypeScript errors like `Expected 2 arguments, but got 1` for `registerPluginCommand()` call sites.

- [ ] **Step 3: Remove the dead parameter from the function signature**

In `src/commands/plugin.ts`, change:

```ts
export function registerPluginCommand(chat: ChatProvider, _adminUserId: string): void {
```

to:

```ts
export function registerPluginCommand(chat: ChatProvider): void {
```

- [ ] **Step 4: Run targeted tests and typecheck**

Run:

```bash
bun test tests/commands/plugin.test.ts --preload ./tests/mock-reset.ts
```

Expected: PASS for `tests/commands/plugin.test.ts`.

Run:

```bash
bun typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add tests/commands/plugin.test.ts src/commands/plugin.ts src/bot.ts
git commit -m "chore(plugins): remove unused plugin command parameter"
```

---

### Task 3: Remove Provider Registry Test-Only Lookup and Redundant Alias

**Files:**

- Modify: `src/providers/registry.ts:16-58,157-160`
- Modify: `tests/providers/registry.test.ts:9-18,65-93,228-246`
- Modify: `tests/plugins/context.test.ts:1-20,193-230`
- Modify: `tests/plugins/loader.test.ts:1-20,280-305`

- [ ] **Step 1: Rewrite provider registry tests to use production APIs**

In `tests/providers/registry.test.ts`, remove `getContributedTaskProviderType` from the registry import:

```ts
import {
  createProvider,
  getCapabilitiesForTaskInstance,
  getTaskProviderDescriptor,
  getTaskProviderConfigValidator,
  listTaskProviderTypes,
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
```

Replace the three tests at the start of `describe('contributed task provider registry', ...)` with:

```ts
test('registers and resolves a contributed type', () => {
  mockLogger()
  registerContributedTaskProviderType('custom-tracker', entry)

  const descriptor = getTaskProviderDescriptor('custom-tracker')
  const provider = createProvider('custom-tracker', {})

  expect(descriptor).toBeDefined()
  expect(descriptor?.source).toEqual({ plugin: 'task-provider-kaneo' })
  expect(provider).toBe(fakeProvider)
})

test('first-wins: duplicate type from another plugin is skipped', () => {
  mockLogger()
  const otherProvider = createMockProvider({ name: 'other-plugin-provider' })
  registerContributedTaskProviderType('custom-tracker', entry)
  expect(() =>
    registerContributedTaskProviderType('custom-tracker', {
      pluginId: 'other-plugin',
      factory: (): TaskProvider => otherProvider,
      capabilities: new Set<TaskCapability>(),
      displayName: 'Other',
      configSchema: [] as const,
    }),
  ).not.toThrow()

  const descriptor = getTaskProviderDescriptor('custom-tracker')
  const provider = createProvider('custom-tracker', {})

  expect(descriptor?.source).toEqual({ plugin: 'task-provider-kaneo' })
  expect(provider).toBe(fakeProvider)
})

test('unregister by pluginId removes its types', () => {
  mockLogger()
  registerContributedTaskProviderType('custom-tracker', entry)
  unregisterContributedTaskProviderType('task-provider-kaneo')

  expect(getTaskProviderDescriptor('custom-tracker')).toBeUndefined()
  expect(() => createProvider('custom-tracker', {})).toThrow('Unknown provider: custom-tracker')
})
```

In the `registerContributedTaskProviderType duplicates` test, replace:

```ts
expect(getContributedTaskProviderType('dup')?.pluginId).toBe('plugin-a')
```

with:

```ts
expect(getTaskProviderDescriptor('dup')?.source).toEqual({ plugin: 'plugin-a' })
```

- [ ] **Step 2: Rewrite plugin context tests to use descriptors**

In `tests/plugins/context.test.ts`, remove `getContributedTaskProviderType` from the registry import and keep `unregisterContributedTaskProviderType`:

```ts
import { getTaskProviderDescriptor, unregisterContributedTaskProviderType } from '../../src/providers/registry.js'
```

Replace this assertion:

```ts
expect(getContributedTaskProviderType('custom-tracker')?.pluginId).toBe('test-plugin')
```

with:

```ts
expect(getTaskProviderDescriptor('custom-tracker')?.source).toEqual({ plugin: 'test-plugin' })
```

Replace this block:

```ts
const contributed = getContributedTaskProviderType('custom-tracker')
expect(contributed?.instanceConfigSchema?.map((field) => field.key)).toEqual(['base_url'])
expect(contributed?.contextConfigSchema?.map((field) => field.key)).toEqual(['token'])
```

with:

```ts
const descriptor = getTaskProviderDescriptor('custom-tracker')
expect(descriptor?.instanceConfigSchema.map((field) => field.key)).toEqual(['base_url'])
expect(descriptor?.contextConfigSchema.map((field) => field.key)).toEqual(['token'])
```

- [ ] **Step 3: Rewrite plugin loader tests to use descriptors and provider creation**

In `tests/plugins/loader.test.ts`, remove `getContributedTaskProviderType` from the registry import and add `createProvider` plus `getTaskProviderDescriptor`:

```ts
import { createProvider, getTaskProviderDescriptor } from '../../src/providers/registry.js'
```

Replace this block:

```ts
await activatePlugins([plugin])
expect(getContributedTaskProviderType('demo')?.pluginId).toBe('provider-plugin')

await deactivateAllPlugins()
expect(getContributedTaskProviderType('demo')).toBeUndefined()
```

with:

```ts
await activatePlugins([plugin])
expect(getTaskProviderDescriptor('demo')?.source).toEqual({ plugin: 'provider-plugin' })
expect(() => createProvider('demo', {})).not.toThrow()

await deactivateAllPlugins()
expect(getTaskProviderDescriptor('demo')).toBeUndefined()
expect(() => createProvider('demo', {})).toThrow('Unknown provider: demo')
```

- [ ] **Step 4: Run tests to verify failure before source cleanup**

Run:

```bash
bun test tests/providers/registry.test.ts tests/plugins/context.test.ts tests/plugins/loader.test.ts --preload ./tests/mock-reset.ts
```

Expected: PASS at runtime because the source still exports `getContributedTaskProviderType()`, but this step confirms the test suite no longer depends on that export.

Run:

```bash
bun typecheck
```

Expected: PASS before deleting source, confirming tests compile through production APIs.

- [ ] **Step 5: Delete the test-only export and inline the redundant alias**

In `src/providers/registry.ts`, delete:

```ts
type ProviderFactory = TaskProviderFactory
```

Change:

```ts
const createKaneoProvider: ProviderFactory = (config) => {
```

to:

```ts
const createKaneoProvider: TaskProviderFactory = (config) => {
```

Change:

```ts
const createYouTrackProvider: ProviderFactory = (config) => {
```

to:

```ts
const createYouTrackProvider: TaskProviderFactory = (config) => {
```

Change:

```ts
const providers = new Map<string, ProviderFactory>([
```

to:

```ts
const providers = new Map<string, TaskProviderFactory>([
```

Delete the exported lookup function:

```ts
/** Look up a contributed task provider entry by type. */
export function getContributedTaskProviderType(type: string): ContributedTaskProviderEntry | undefined {
  return pluginContributedTaskProviderFactories.get(type)
}
```

- [ ] **Step 6: Run targeted tests and typecheck**

Run:

```bash
bun test tests/providers/registry.test.ts tests/plugins/context.test.ts tests/plugins/loader.test.ts --preload ./tests/mock-reset.ts
```

Expected: PASS for all three test files.

Run:

```bash
bun typecheck
```

Expected: PASS with no imports of `getContributedTaskProviderType`.

- [ ] **Step 7: Confirm no remaining references**

Run:

```bash
rg "getContributedTaskProviderType|ProviderFactory" src tests
```

Expected: no output.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts tests/plugins/context.test.ts tests/plugins/loader.test.ts
git commit -m "chore(providers): remove test-only registry lookup"
```

---

### Task 4: Record Tool Name Collisions as Runtime Events

**Files:**

- Modify: `tests/plugins/contributions.test.ts:13-22,932-951`
- Modify: `src/plugins/contributions.ts:6-20,262-265`

- [ ] **Step 1: Write the failing runtime-event test**

In `tests/plugins/contributions.test.ts`, add `getRecentRuntimeEvents` to the plugin store import list. The import block should include:

```ts
import { getRecentRuntimeEvents, setPluginEnabledForContext } from '../../src/plugins/store.js'
```

Replace the existing collision test in `describe('buildPluginToolSet', ...)` with:

```ts
test('skips tools that collide with existing tool names and records a runtime event', () => {
  const manifest = makeManifest()
  contributionRegistry.register(
    'test-plugin',
    {
      tools: [
        {
          name: 'my_tool',
          description: 'A test tool',
          execute: (): Promise<unknown> => Promise.resolve('ok'),
        },
      ],
      promptFragments: [],
    },
    manifest,
  )
  const existing = new Set(['plugin_test_plugin__my_tool'])

  const tools = buildPluginToolSet(['test-plugin'], existing, makeRuntime())
  const events = getRecentRuntimeEvents('test-plugin', 1)

  expect(Object.keys(tools)).toHaveLength(0)
  expect(events[0]?.eventType).toBe('skipped')
  expect(events[0]?.message).toBe(
    "Tool contribution 'plugin_test_plugin__my_tool' skipped because the name already exists",
  )
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bun test tests/plugins/contributions.test.ts --preload ./tests/mock-reset.ts
```

Expected: FAIL because `events[0]` is `undefined`; current collision handling only logs a warning.

- [ ] **Step 3: Record a skipped runtime event when collisions occur**

In `src/plugins/contributions.ts`, add this import near the other plugin imports:

```ts
import { recordRuntimeEvent } from './store.js'
```

Replace the collision branch inside `buildPluginToolSet()` from:

```ts
if (usedNames.has(namespacedName)) {
  log.warn({ pluginId, toolName: namespacedName }, 'Plugin tool name collision — skipping')
  continue
}
```

to:

```ts
if (usedNames.has(namespacedName)) {
  const message = `Tool contribution '${namespacedName}' skipped because the name already exists`
  log.warn({ pluginId, toolName: namespacedName }, 'Plugin tool name collision — skipping')
  recordRuntimeEvent(pluginId, 'skipped', message)
  continue
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
bun test tests/plugins/contributions.test.ts --preload ./tests/mock-reset.ts
```

Expected: PASS for `tests/plugins/contributions.test.ts`.

- [ ] **Step 5: Verify `/plugin info` already exposes the event**

Review `src/commands/plugin.ts:102-109`. It already appends recent runtime events to `/plugin info <id>` using `getRecentRuntimeEvents(pluginId, 3)`:

```ts
const recentEvents = getRecentRuntimeEvents(pluginId, 3)
if (recentEvents.length > 0) {
  lines.push('Recent events:')
  for (const event of recentEvents) {
    const detail = event.message === null ? '' : ` — ${event.message}`
    lines.push(`- ${event.occurredAt}: ${event.eventType}${detail}`)
  }
}
```

Expected: no source change in `src/commands/plugin.ts` for this task.

- [ ] **Step 6: Commit**

Run:

```bash
git add tests/plugins/contributions.test.ts src/plugins/contributions.ts
git commit -m "fix(plugins): surface tool collisions in runtime events"
```

---

### Task 5: Final Verification

**Files:**

- Verify only; no source files should be edited in this task.

- [ ] **Step 1: Run focused plugin/provider tests**

Run:

```bash
bun test tests/commands/plugin.test.ts tests/plugins/contributions.test.ts tests/providers/registry.test.ts tests/plugins/context.test.ts tests/plugins/loader.test.ts --preload ./tests/mock-reset.ts
```

Expected: PASS for all listed test files.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun typecheck
```

Expected: PASS.

- [ ] **Step 3: Run lint on touched source and tests**

Run:

```bash
bun lint:agent-strict -- src/commands/plugin.ts src/bot.ts src/providers/registry.ts src/plugins/contributions.ts tests/commands/plugin.test.ts tests/plugins/contributions.test.ts tests/providers/registry.test.ts tests/plugins/context.test.ts tests/plugins/loader.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run formatting check on touched files**

Run:

```bash
bun format:check src/commands/plugin.ts src/bot.ts src/providers/registry.ts src/plugins/contributions.ts tests/commands/plugin.test.ts tests/plugins/contributions.test.ts tests/providers/registry.test.ts tests/plugins/context.test.ts tests/plugins/loader.test.ts
```

Expected: PASS. If formatting fails, run `bun format` once, inspect the diff, then rerun this step.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff -- src/commands/plugin.ts src/bot.ts src/providers/registry.ts src/plugins/contributions.ts tests/commands/plugin.test.ts tests/plugins/contributions.test.ts tests/providers/registry.test.ts tests/plugins/context.test.ts tests/plugins/loader.test.ts
```

Expected: diff only contains the changes described in Tasks 1-4.

- [ ] **Step 6: Commit verification-only fixes if formatter changed files**

If Step 4 required `bun format` and produced file changes, run:

```bash
git add src/commands/plugin.ts src/bot.ts src/providers/registry.ts src/plugins/contributions.ts tests/commands/plugin.test.ts tests/plugins/contributions.test.ts tests/providers/registry.test.ts tests/plugins/context.test.ts tests/plugins/loader.test.ts
git commit -m "chore: format plugin review follow-up fixes"
```

Expected: commit is created only if there are formatting changes after Task 4.

---

## Self-Review Notes

Spec coverage:

- Finding #1 is covered by Task 1.
- Finding #2 is covered by Task 2.
- Findings #3 and #4 are covered by Task 3.
- Finding #8 is covered by Task 4.
- Finding #5 is not changed because current `/config` only lists active plugins.
- Finding #6 is not changed because the compatibility shim is intentional.
- Finding #7 is not changed because current startup order already activates plugins before chat start and pollers.

Placeholder scan:

- The plan contains exact paths, code snippets, commands, and expected outcomes for each implementation task.

Type consistency:

- `registerPluginCommand(chat: ChatProvider): void` is used consistently in tests and `src/bot.ts`.
- Provider registry tests use existing production APIs: `createProvider()`, `getTaskProviderDescriptor()`, `registerContributedTaskProviderType()`, and `unregisterContributedTaskProviderType()`.
- Collision observability uses the existing `recordRuntimeEvent(pluginId, 'skipped', message)` signature.
