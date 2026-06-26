<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin Review Validated Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the validated plugin-system remediation so lifecycle state is correct, runtime boundaries are honest, provisioning no longer leaks plugin internals into core, operator surfaces tell the truth, and the developer contract matches the real trusted-plugin model.

**Architecture:** Keep the existing plugin-system shape and tighten its invariants. Loader, registry, discovery, runtime facades, and provider registry stay the framework-owned boundaries; the work removes inconsistent edge cases rather than redesigning the plugin host. The biggest shape change is adding a real scheduled-job runtime context and a provider-descriptor provisioning hook so plugin behavior flows through explicit framework contracts instead of ad hoc imports.

**Tech Stack:** Bun test runner (`bun:test`), TypeScript strict mode, SQLite/Drizzle plugin state store, existing plugin registry and provider registry modules, existing first-party Kaneo provider plugin.

---

## Recommended Scope

Implement in this pass:

- Fix duplicate activation-order recording and remove the redundant lifecycle `pLimit(1)` wrapper.
- Bind plugin identity claims to the current runtime actor.
- Add a scheduled-job runtime context and stop resolving unused providers.
- Replace direct Kaneo provisioning imports in core with a provider-descriptor provisioning hook.
- Enforce `commands` and `scheduler` as real permissions and remove `chat.send` from the manifest contract.
- Persist operator-visible runtime plugin state transitions.
- Make discovery fail closed on `realpathSync()` verification failures.
- Make approval hashing cover plugin-owned local source and reject bare-module imports in plugin entry graphs.
- Remove dead `config_missing` registry state.
- Make `/config` and admin-system provider reporting more truthful.
- Escape wildcard characters in plugin KV prefix listing.
- Scope collision-event suppression state to the contribution registry lifecycle.
- Extract the duplicated MCP pool adapter helper.
- Update developer docs to describe the actual trusted in-process plugin model.

Do not implement in this pass:

- deactivation timeout enforcement
- sandboxing or stronger isolation guarantees
- broader plugin API redesign beyond the validated findings
- unrelated admin UI redesign

## File Structure

- Modify: `src/plugins/loader.ts`
  - Responsibility: activation/deactivation lifecycle, activation order bookkeeping, activation sequencing.
  - Changes: remove double activation-order push, delete redundant `pLimit(1)` wrapper, preserve existing best-effort deactivation behavior.
- Modify: `src/plugins/identity-facade.ts`
  - Responsibility: framework-owned identity facade exposed to plugins.
  - Changes: change `recordClaim(...)` to actor-bound write semantics.
- Modify: `src/plugins/runtime-types.ts`
  - Responsibility: public plugin runtime surface types.
  - Changes: add a scheduled-job runtime context type and update job execute signatures.
- Modify: `src/plugins/tool-runtime.ts`
  - Responsibility: framework-owned runtime context builders for plugin execution.
  - Changes: bind identity facade to `chatUserId`; add shared provider-facade builder reusable by jobs.
- Modify: `src/plugins/contributions.ts`
  - Responsibility: active contribution registry, job dispatch, tool-collision diagnostics.
  - Changes: build scheduled-job runtime context, stop resolving unused providers, scope/reset collision suppression state.
- Modify: `src/plugins/registration-support.ts`
  - Responsibility: activation-time registration validation.
  - Changes: enforce `commands` and `scheduler` permissions at registration time.
- Modify: `src/plugins/context.ts`
  - Responsibility: plugin activation context and provider-type registration contract.
  - Changes: extend `registerTaskProviderType()` to accept provisioning metadata for provider plugins.
- Modify: `src/plugins/types.ts`
  - Responsibility: plugin manifest schema and public plugin types.
  - Changes: remove `chat.send`, remove dead `config_missing` state, refine manifest validation for commands/jobs permissions.
- Modify: `src/plugins/manifest-validation.ts`
  - Responsibility: shared manifest validation helpers.
  - Changes: add any command/job permission helper that is needed by the manifest schema refines.
- Modify: `src/plugins/registry.ts`
  - Responsibility: in-memory plus persisted plugin state transitions.
  - Changes: persist `active`, `error`, and deactivation-to-`approved`; remove dead state vocabulary.
- Modify: `src/plugins/registry-context-eligibility.ts`
  - Responsibility: per-context eligibility decisions.
  - Changes: eliminate duplicate context-state query.
- Modify: `src/plugins/discovery.ts`
  - Responsibility: plugin discovery, path containment, approval hashing.
  - Changes: fail closed on `realpathSync()` errors, reject bare-module imports in plugin entry graphs, include local source graph files in the approval hash.
- Modify: `src/plugins/store.ts`
  - Responsibility: plugin state persistence and KV behavior.
  - Changes: escape `%` and `_` in `kvList()` prefix matching.
- Modify: `src/providers/registry.ts`
  - Responsibility: provider descriptors and contributed provider registration.
  - Changes: add optional provisioning hook to contributed provider descriptors and surface it through provider lookup.
- Modify: `src/commands/start.ts`
  - Responsibility: `/start` command behavior.
  - Changes: delegate auto-provision through generic provider provisioning instead of Kaneo plugin import.
- Modify: `src/commands/setup.ts`
  - Responsibility: `/setup` flow and first-time group provisioning.
  - Changes: delegate provider provisioning through the generic provider descriptor path.
- Modify: `src/llm-orchestrator.ts`
  - Responsibility: message orchestration and DM auto-provision entrypoint.
  - Changes: replace `maybeProvisionKaneo` dependency with generic provisioning dependency.
- Modify: `src/llm-orchestrator-types.ts`
  - Responsibility: orchestrator dependency types.
  - Changes: rename/reshape provisioning dependency.
- Create: `src/providers/auto-provision.ts`
  - Responsibility: generic provider provisioning dispatch used by core flows.
  - Changes: one framework-owned helper that resolves the context provider descriptor and invokes optional provisioning hooks.
- Modify: `plugins/task-provider-kaneo/index.ts`
  - Responsibility: Kaneo provider plugin registration.
  - Changes: register the Kaneo auto-provision hook on the contributed provider descriptor.
- Modify: `plugins/task-provider-kaneo/provision.ts`
  - Responsibility: Kaneo-specific provisioning logic.
  - Changes: adapt exported helpers to the new provider-descriptor provisioning hook shape without leaking core imports.
- Modify: `src/debug/admin-system.ts`
  - Responsibility: admin system summary reporting.
  - Changes: derive task-provider reporting from active instances/descriptors instead of a hardcoded allowlist.
- Modify: `src/commands/config.ts`
  - Responsibility: `/config` rendering.
  - Changes: show `inactive` and `error` distinctly from `disabled`.
- Create: `src/mcp/plugin-pool-adapter.ts`
  - Responsibility: shared adapter for plugin MCP pool access.
  - Changes: move duplicated adapter code out of `src/tools/index.ts` and `src/chat/tool-toggle-live-tools.ts`.
- Modify: `src/tools/index.ts`
  - Responsibility: tool and plugin-MCP tool assembly.
  - Changes: use the shared MCP adapter helper.
- Modify: `src/chat/tool-toggle-live-tools.ts`
  - Responsibility: live tool listing for config interactions.
  - Changes: use the shared MCP adapter helper.
- Modify: `docs/plugins/developer-guide.md`
  - Responsibility: plugin developer contract documentation.
  - Changes: describe trusted in-process code accurately, update identity/job/permission behavior, remove `chat.send`, document approval coverage and bare-module import rejection.
- Modify: `CLAUDE.md`
  - Responsibility: repo-level plugin-system contract documentation.
  - Changes: align trust-model and permission wording with the implemented behavior.

- Modify tests:
- `tests/plugins/loader.test.ts`
- `tests/plugins/discovery.test.ts`
- `tests/plugins/contributions.test.ts`
- `tests/plugins/registry.test.ts`
- `tests/plugins/context.test.ts`
- `tests/providers/registry.test.ts`
- `tests/debug/admin-system.test.ts`
- `tests/commands/config.test.ts`
- `tests/commands/start.test.ts`
- `tests/commands/setup.test.ts`
- `tests/llm-orchestrator.test.ts`
- `tests/plugins/task-provider-kaneo/activation.test.ts`
- `tests/plugins/task-provider-youtrack/activation.test.ts`

## External References Checked

- Node.js `fs.realpathSync()` throws on filesystem errors and does not silently validate paths; swallowing those errors weakens any symlink/path-containment check. Source: Node.js FS API documentation (`fs.realpathSync.native` / `fsPromises.realpath`) plus Node error docs.

---

### Task 1: Fix Loader Activation Order and Remove Redundant Lifecycle Concurrency Wrapper

**Files:**

- Modify: `tests/plugins/loader.test.ts`
- Modify: `src/plugins/loader.ts`

- [x] **Step 1: Write the failing loader regression tests**

In `tests/plugins/loader.test.ts`, add these tests near the other activation-order and deactivation behavior tests:

```ts
test('records each activated plugin only once', async () => {
  const firstEntry = writeTempPluginModule(`
    export default function createPlugin() {
      return { activate() {} }
    }
  `)
  const secondEntry = writeTempPluginModule(`
    export default function createPlugin() {
      return { activate() {} }
    }
  `)
  const first = makePlugin('once-a', firstEntry)
  const second = makePlugin('once-b', secondEntry)
  approvePlugin(first)
  approvePlugin(second)

  await activatePlugins([first, second])

  expect(getActivatedPluginIds()).toEqual(['once-a', 'once-b'])
})

test('deactivates each plugin only once even after multiple activations', async () => {
  const entryPoint = writeTempPluginModule(`
    export default function createPlugin() {
      return {
        activate() {},
        deactivate() {
          globalThis.papaiDeactivateOrder = [...(globalThis.papaiDeactivateOrder ?? []), 'single-pass']
        },
      }
    }
  `)
  const plugin = makePlugin('single-pass', entryPoint)
  approvePlugin(plugin)

  await activatePlugins([plugin])
  await deactivateAllPlugins()

  expect(globalThis.papaiDeactivateOrder).toEqual(['single-pass'])
})
```

- [x] **Step 2: Run the loader tests to verify failure**

Run:

```bash
bun test tests/plugins/loader.test.ts --preload ./tests/mock-reset.ts
```

Expected: FAIL because `getActivatedPluginIds()` currently returns duplicate IDs and the deactivation test sees duplicate iteration through `activationOrder`.

- [x] **Step 3: Implement the minimal lifecycle fix**

In `src/plugins/loader.ts`:

1. Remove the import of `p-limit` and delete `PLUGIN_LIFECYCLE_CONCURRENCY`.
2. Keep the existing `activationOrder.push(manifest.id)` inside `finalizeSuccessfulActivation(...)`.
3. Remove the bulk append at the end of `activatePlugins(...)`.
4. Replace the current `Promise.all(plugins.map((p) => limit(() => activateOne(p))))` with straight sequential activation so the code shape matches the already-effective concurrency of `1`.

Change `activatePlugins(...)` to:

```ts
export async function activatePlugins(plugins: DiscoveredPlugin[]): Promise<void> {
  if (plugins.length === 0) {
    log.debug('No plugins to activate')
    return
  }

  let activated = 0
  let failed = 0

  for (const plugin of plugins) {
    if (await activateOne(plugin)) activated += 1
    else failed += 1
  }

  log.info({ activated, failed, total: plugins.length }, 'Plugin activation complete')
}
```

- [x] **Step 4: Run the loader tests to verify pass**

Run:

```bash
bun test tests/plugins/loader.test.ts --preload ./tests/mock-reset.ts
```

Expected: PASS for `tests/plugins/loader.test.ts`.

- [x] **Step 5: Commit**

Run:

```bash
git add tests/plugins/loader.test.ts src/plugins/loader.ts
git commit -m "fix(plugins): dedupe activation lifecycle order"
```

---

### Task 2: Bind Identity Claims to the Current Runtime Actor

**Files:**

- Modify: `tests/plugins/contributions.test.ts`
- Modify: `src/plugins/identity-facade.ts`
- Modify: `src/plugins/tool-runtime.ts`
- Modify: `src/plugins/runtime-types.ts`
- Modify: `docs/plugins/developer-guide.md`

- [x] **Step 1: Write the failing identity-facade regression tests**

In `tests/plugins/contributions.test.ts`, add a focused tool-runtime test near the existing plugin tool runtime coverage:

```ts
test('identity claims are bound to the runtime chat user', async () => {
  const manifest = makeManifest({
    permissions: ['identity', 'provider.task'],
    contributes: {
      tools: ['my_tool'],
      promptFragments: [],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: ['test-provider'],
    },
  })

  contributionRegistry.register(
    'test-plugin',
    {
      tools: [
        {
          name: 'my_tool',
          description: 'Claims current actor identity',
          execute: async (_input, runtime) => {
            runtime.identity!.recordClaim('provider-user', 'provider-login', 'Display Name')
            return 'ok'
          },
        },
      ],
      promptFragments: [],
    },
    manifest,
  )

  const tools = buildPluginToolSet(['test-plugin'], new Set(), makeRuntime({ chatUserId: 'actor-1' }))
  const result = await getToolExecutor(tools['plugin_test_plugin__my_tool'])({})

  expect(result).toBe('ok')
  const { getIdentityMapping } = await import('../../src/identity/mapping.js')
  expect(getIdentityMapping('actor-1', 'test-provider')?.providerUserId).toBe('provider-user')
  expect(getIdentityMapping('victim-1', 'test-provider')).toBeNull()
})
```

- [x] **Step 2: Run the focused plugin-contribution tests to verify failure**

Run:

```bash
bun test tests/plugins/contributions.test.ts --preload ./tests/mock-reset.ts
```

Expected: FAIL because `recordClaim(...)` currently expects an arbitrary `chatUserId` parameter and the runtime still exposes that broader write surface.

- [x] **Step 3: Implement the minimal actor-bound facade change**

In `src/plugins/identity-facade.ts`:

1. Change the public type to:

```ts
export type PluginIdentityFacade = {
  lookupForChatUser(chatUserId: string): { providerUserId: string; providerLogin: string; verified: boolean } | null
  recordClaim(providerUserId: string, providerLogin: string, displayName?: string): void
}
```

2. Change `buildIdentityFacade(...)` to accept `chatUserId`:

```ts
export function buildIdentityFacade(
  providerName: string,
  chatUserId: string,
  deps: IdentityFacadeDeps = defaultDeps,
): PluginIdentityFacade {
```

3. Change the implementation to write `contextId: chatUserId` from the closure.

In `src/plugins/tool-runtime.ts`, change `buildRuntimeIdentity(...)` to accept `runtime.chatUserId` and call the new signature.

In `src/plugins/runtime-types.ts`, keep `identity?: PluginIdentityFacade` but let the new signature flow from the exported type.

In `docs/plugins/developer-guide.md`, update the identity section so `recordClaim(...)` no longer documents a caller-supplied chat-user target.

- [x] **Step 4: Run the focused tests to verify pass**

Run:

```bash
bun test tests/plugins/contributions.test.ts --preload ./tests/mock-reset.ts
```

Expected: PASS for the new identity-claim regression coverage.

- [x] **Step 5: Commit**

Run:

```bash
git add tests/plugins/contributions.test.ts src/plugins/identity-facade.ts src/plugins/tool-runtime.ts src/plugins/runtime-types.ts docs/plugins/developer-guide.md
git commit -m "fix(plugins): bind identity claims to runtime actor"
```

---

### Task 3: Add Scheduled Job Runtime Context and Remove Unused Provider Resolution

**Files:**

- Modify: `tests/plugins/contributions.test.ts`
- Modify: `src/plugins/runtime-types.ts`
- Modify: `src/plugins/tool-runtime.ts`
- Modify: `src/plugins/contributions.ts`
- Modify: `docs/plugins/developer-guide.md`

- [x] **Step 1: Write the failing scheduled-job runtime tests**

In `tests/plugins/contributions.test.ts`, add these tests near the existing `runPluginScheduledJob(...)` coverage:

```ts
test('jobs with task permissions receive a task-provider facade', async () => {
  seedTestPlatformInstance('platform-a')
  seedTestTaskInstance('task-a', 'kaneo')
  setContextSettings({ contextId: 'ctx-job', platformInstanceId: 'platform-a', taskInstanceId: 'task-a' })

  const provider = createMockProvider()
  const searchCalls: string[] = []
  provider.searchTasks = async (params) => {
    searchCalls.push(String(params.query ?? ''))
    return []
  }

  const manifest = makeManifest({
    permissions: ['tasks.read'],
    contributes: {
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: ['sync'],
      configKeys: [],
      taskProviderTypes: [],
    },
    defaultEnabled: true,
  })
  markPluginActive(manifest)
  contributionRegistry.register(
    'test-plugin',
    {
      tools: [],
      promptFragments: [],
      jobs: [
        {
          name: 'sync',
          intervalMs: 60_000,
          execute: async (runtime) => {
            await runtime.taskProvider!.searchTasks({ query: 'jobs-can-read' })
          },
        },
      ],
    },
    manifest,
  )

  await runPluginScheduledJob('test-plugin', 'sync', { resolveTaskProvider: () => provider })

  expect(searchCalls).toEqual(['jobs-can-read'])
})

test('jobs without task permissions do not resolve a provider', async () => {
  seedTestPlatformInstance('platform-a')
  seedTestTaskInstance('task-a', 'kaneo')
  setContextSettings({ contextId: 'ctx-job', platformInstanceId: 'platform-a', taskInstanceId: 'task-a' })

  let resolveCalls = 0
  const manifest = makeManifest({
    contributes: {
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: ['sync'],
      configKeys: [],
      taskProviderTypes: [],
    },
    defaultEnabled: true,
  })
  markPluginActive(manifest)
  contributionRegistry.register(
    'test-plugin',
    {
      tools: [],
      promptFragments: [],
      jobs: [
        {
          name: 'sync',
          intervalMs: 60_000,
          execute: async (runtime) => {
            expect('taskProvider' in runtime).toBe(false)
          },
        },
      ],
    },
    manifest,
  )

  await runPluginScheduledJob('test-plugin', 'sync', {
    resolveTaskProvider: () => {
      resolveCalls += 1
      return createMockProvider()
    },
  })

  expect(resolveCalls).toBe(0)
})
```

- [x] **Step 2: Run the contribution tests to verify failure**

Run:

```bash
bun test tests/plugins/contributions.test.ts --preload ./tests/mock-reset.ts
```

Expected: FAIL because `PluginScheduledJob.execute(...)` still receives only `contextId` and job dispatch still resolves providers even when the job cannot use them.

- [x] **Step 3: Implement the minimal runtime-context change**

In `src/plugins/runtime-types.ts`, add:

```ts
export type PluginScheduledJobRuntimeContext = {
  pluginId: string
  contextId: string
} & Partial<{
  taskProvider: PluginTaskProviderFacade
}>
```

Change the job type to:

```ts
export type PluginScheduledJob = {
  name: string
  intervalMs: number
  execute: (runtime: PluginScheduledJobRuntimeContext) => Promise<void> | void
}
```

In `src/plugins/tool-runtime.ts`, extract the shared provider-facade builder so both tool runtime and job runtime can use it.

In `src/plugins/contributions.ts`:

1. Build a small helper like `buildPluginScheduledJobRuntimeContext(...)`.
2. Resolve the provider only when the manifest actually has `tasks.read` or `tasks.write`.
3. Pass `job.execute({ pluginId, contextId, ...(taskProvider === undefined ? {} : { taskProvider }) })`.
4. Export a reset helper for collision suppression state while you are in the same file, for use in a later cleanup task.

Update the docs in `docs/plugins/developer-guide.md` so jobs are documented as `execute(runtime)` rather than `execute(contextId)`.

- [x] **Step 4: Run the contribution tests to verify pass**

Run:

```bash
bun test tests/plugins/contributions.test.ts --preload ./tests/mock-reset.ts
```

Expected: PASS for the new scheduled-job runtime coverage.

- [x] **Step 5: Commit**

Run:

```bash
git add tests/plugins/contributions.test.ts src/plugins/runtime-types.ts src/plugins/tool-runtime.ts src/plugins/contributions.ts docs/plugins/developer-guide.md
git commit -m "feat(plugins): add scheduled job runtime context"
```

---

### Task 4: Enforce `commands` and `scheduler` Permissions and Remove `chat.send`

**Files:**

- Modify: `tests/plugins/context.test.ts`
- Modify: `tests/plugins/contributions.test.ts`
- Modify: `src/plugins/registration-support.ts`
- Modify: `src/plugins/types.ts`
- Modify: `src/plugins/manifest-validation.ts`
- Modify: `docs/plugins/developer-guide.md`
- Modify: `CLAUDE.md`

- [x] **Step 1: Write the failing permission enforcement tests**

In `tests/plugins/context.test.ts`, add registration-time failures:

```ts
test('registerCommand requires commands permission', () => {
  const { ctx } = buildPluginContext(
    {
      ...makeManifest(),
      contributes: { ...makeManifest().contributes, commands: ['sync'] },
      permissions: [],
    },
    '__system__',
  )

  expect(() =>
    ctx.registration.registerCommand({
      name: 'sync',
      description: 'sync',
      execute: () => {},
    }),
  ).toThrow("Plugin test-plugin cannot register commands without 'commands'")
})

test('registerScheduledJob requires scheduler permission', () => {
  const { ctx } = buildPluginContext(
    {
      ...makeManifest(),
      contributes: { ...makeManifest().contributes, jobs: ['daily'] },
      permissions: [],
    },
    '__system__',
  )

  expect(() =>
    ctx.registration.registerScheduledJob({
      name: 'daily',
      intervalMs: 60_000,
      execute: () => {},
    }),
  ).toThrow("Plugin test-plugin cannot register scheduled jobs without 'scheduler'")
})
```

In `tests/plugins/contributions.test.ts`, add manifest-validation coverage for the schema:

```ts
test('manifest rejects commands without commands permission', () => {
  const parsed = pluginManifestSchema.safeParse({
    id: 'cmd-plugin',
    name: 'Cmd Plugin',
    version: '1.0.0',
    description: 'test',
    apiVersion: 1,
    main: 'index.ts',
    contributes: { commands: ['sync'] },
  })

  expect(parsed.success).toBe(false)
})

test('manifest rejects jobs without scheduler permission', () => {
  const parsed = pluginManifestSchema.safeParse({
    id: 'job-plugin',
    name: 'Job Plugin',
    version: '1.0.0',
    description: 'test',
    apiVersion: 1,
    main: 'index.ts',
    contributes: { jobs: ['daily'] },
  })

  expect(parsed.success).toBe(false)
})
```

- [x] **Step 2: Run the targeted plugin tests to verify failure**

Run:

```bash
bun test tests/plugins/context.test.ts tests/plugins/contributions.test.ts --preload ./tests/mock-reset.ts
```

Expected: FAIL because registration and manifest parsing currently allow those declarations without corresponding permissions.

- [x] **Step 3: Implement the minimal permission contract changes**

In `src/plugins/types.ts`:

1. Remove `'chat.send'` from `PLUGIN_PERMISSIONS`.
2. Remove `'config_missing'` from `PluginState` while you are touching the schema-owned state vocabulary.
3. Add refinements:

```ts
.refine((m) => m.contributes.commands.length === 0 || m.permissions.includes('commands'), {
  message: "Declaring contributes.commands requires the 'commands' permission",
  path: ['permissions'],
})
.refine((m) => m.contributes.jobs.length === 0 || m.permissions.includes('scheduler'), {
  message: "Declaring contributes.jobs requires the 'scheduler' permission",
  path: ['permissions'],
})
```

In `src/plugins/registration-support.ts`, add permission-aware guards to command and job registration builders. Use explicit messages:

```ts
if (!manifest.permissions.includes('commands')) {
  throw new Error(`Plugin ${manifest.id} cannot register commands without 'commands'`)
}
```

and

```ts
if (!manifest.permissions.includes('scheduler')) {
  throw new Error(`Plugin ${manifest.id} cannot register scheduled jobs without 'scheduler'`)
}
```

Update `docs/plugins/developer-guide.md` and `CLAUDE.md` so `commands` and `scheduler` are described as enforced permissions and `chat.send` is removed from lists/examples.

- [x] **Step 4: Run the targeted tests to verify pass**

Run:

```bash
bun test tests/plugins/context.test.ts tests/plugins/contributions.test.ts --preload ./tests/mock-reset.ts
```

Expected: PASS for the new permission-contract tests.

- [x] **Step 5: Commit**

Run:

```bash
git add tests/plugins/context.test.ts tests/plugins/contributions.test.ts src/plugins/registration-support.ts src/plugins/types.ts src/plugins/manifest-validation.ts docs/plugins/developer-guide.md CLAUDE.md
git commit -m "fix(plugins): enforce command and scheduler permissions"
```

---

### Task 5: Persist Honest Runtime Plugin State and Remove Dead Registry State

**Files:**

- Modify: `tests/plugins/registry.test.ts`
- Modify: `src/plugins/registry.ts`
- Modify: `src/plugins/types.ts`

- [x] **Step 1: Write the failing registry persistence tests**

In `tests/plugins/registry.test.ts`, add:

```ts
test('markActive persists active state to plugin_admin_state', () => {
  const plugin = makePlugin()
  registry.registerDiscovered(plugin)
  registry.approve('test-plugin', 'admin', 'hash-abc')

  registry.markActive('test-plugin')

  expect(getPluginAdminState('test-plugin')?.state).toBe('active')
})

test('markError persists error state and reason to plugin_admin_state', () => {
  const plugin = makePlugin()
  registry.registerDiscovered(plugin)
  registry.approve('test-plugin', 'admin', 'hash-abc')

  registry.markError('test-plugin', 'activation failed')

  expect(getPluginAdminState('test-plugin')?.state).toBe('error')
  expect(getPluginAdminState('test-plugin')?.compatibilityReason).toBe('activation failed')
})

test('markDeactivated persists approved state after active runtime', () => {
  const plugin = makePlugin()
  registry.registerDiscovered(plugin)
  registry.approve('test-plugin', 'admin', 'hash-abc')
  registry.markActive('test-plugin')

  registry.markDeactivated('test-plugin')

  expect(getPluginAdminState('test-plugin')?.state).toBe('approved')
})
```

- [x] **Step 2: Run the registry tests to verify failure**

Run:

```bash
bun test tests/plugins/registry.test.ts --preload ./tests/mock-reset.ts
```

Expected: FAIL because `markActive()`, `markError()`, and `markDeactivated()` currently mutate only in-memory state.

- [x] **Step 3: Implement the minimal persisted-state fix**

In `src/plugins/types.ts`, ensure `PluginState` no longer includes `'config_missing'`.

In `src/plugins/registry.ts`:

1. Remove `'config_missing'` from `VALID_PLUGIN_STATES`.
2. In `markActive(...)`, call `updatePluginAdminStateField(pluginId, { state: 'active', compatibilityReason: null })` when the entry exists.
3. In `markError(...)`, call `updatePluginAdminStateField(pluginId, { state: 'error', compatibilityReason: reason })`.
4. In `markDeactivated(...)`, call `updatePluginAdminStateField(pluginId, { state: 'approved', compatibilityReason: null })` when transitioning from `active`.

- [x] **Step 4: Run the registry tests to verify pass**

Run:

```bash
bun test tests/plugins/registry.test.ts --preload ./tests/mock-reset.ts
```

Expected: PASS for `tests/plugins/registry.test.ts`.

- [x] **Step 5: Commit**

Run:

```bash
git add tests/plugins/registry.test.ts src/plugins/registry.ts src/plugins/types.ts
git commit -m "fix(plugins): persist runtime registry state"
```

---

### Task 6: Fail Closed on Discovery Verification Errors and Reject Bare-Module Imports in Plugin Entry Graphs

**Files:**

- Modify: `tests/plugins/discovery.test.ts`
- Modify: `src/plugins/discovery.ts`
- Modify: `docs/plugins/developer-guide.md`
- Modify: `plugins/task-provider-kaneo/index.ts`
- Modify: `plugins/task-provider-kaneo/**/*.ts` as needed to eliminate bare imports from the discovered plugin-owned source graph
- Modify: `plugins/task-provider-youtrack/index.ts`
- Modify: `plugins/task-provider-youtrack/**/*.ts` as needed to eliminate bare imports from the discovered plugin-owned source graph
- Modify: `plugins/synthetic-web-search/index.ts`
- Modify: `plugins/synthetic-web-search/**/*.ts` as needed to eliminate bare imports from the discovered plugin-owned source graph

- [x] **Step 1: Write the failing discovery-path and import-policy tests**

In `tests/plugins/discovery.test.ts`, add:

```ts
test('rejects plugin when imported path realpath throws', () => {
  const root = makeTempDir()
  const pluginDir = join(root, 'realpath-fails')
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({
      id: 'realpath-fails',
      name: 'Realpath Fails',
      version: '1.0.0',
      description: 'test',
      apiVersion: 1,
      main: 'index.ts',
    }),
    'utf-8',
  )
  writeFileSync(join(pluginDir, 'helper.ts'), 'export const value = 1\n', 'utf-8')
  writeFileSync(
    join(pluginDir, 'index.ts'),
    "import { value } from './helper.ts'\nexport default function createPlugin(){ return { activate(){ return value } } }\n",
    'utf-8',
  )

  const realFs = await import('node:fs')
  const realpathSpy = mock(realFs, 'realpathSync', (path) => {
    if (String(path).endsWith('helper.ts')) throw Object.assign(new Error('loop'), { code: 'ELOOP' })
    return realFs.realpathSync(path)
  })

  try {
    const result = discoverPlugins(root)
    expect(result.plugins).toEqual([])
    expect(result.errors[0]?.reason).toContain('helper.ts')
  } finally {
    realpathSpy.mockRestore()
  }
})

test('rejects bare-module imports from plugin entry graph', () => {
  const root = makeTempDir()
  writePlugin(
    root,
    'bare-import-plugin',
    {},
    "import 'left-pad'\nexport default function createPlugin(){ return { activate() {} } }",
  )

  const result = discoverPlugins(root)

  expect(result.plugins).toEqual([])
  expect(result.errors[0]?.reason).toContain('Bare-module imports are not allowed in plugin entry graphs')
})
```

- [x] **Step 2: Run the discovery tests to verify failure**

- [x] **Step 3: Implement the minimal fail-closed discovery policy**

In `src/plugins/discovery.ts`:

1. Add a small helper:

```ts
function resolveRealPathInsidePlugin(pluginDir: string, candidatePath: string, specifier: string): string {
  const realPluginDir = realpathSync(pluginDir)
  const realCandidatePath = realpathSync(candidatePath)
  if (!isPathInsideDirectory(realPluginDir, realCandidatePath)) {
    throw new Error(`Plugin import resolves outside plugin directory: ${specifier}`)
  }
  return realCandidatePath
}
```

2. In `resolveEntryImport(...)`, replace the current `try/catch` with fail-closed behavior. Re-throw the sentinel outside-directory error and wrap other `realpathSync()` failures as explicit discovery failures such as:

```ts
throw new Error(
  `Failed to verify plugin import path for ${specifier}: ${error instanceof Error ? error.message : String(error)}`,
)
```

3. In `resolveEntryPoint(...)`, stop returning the unresolved path from the catch block. Return `null` or throw an explicit verification error so discovery rejects the plugin.
4. In `readPluginSourceGraph(...)`, reject any static or dynamic import specifier that does not start with `./` or `../` with the message `Bare-module imports are not allowed in plugin entry graphs: ${specifier}`.

Update `docs/plugins/developer-guide.md` to document the bare-module import rejection policy.

- [x] **Step 4: Run the discovery tests to verify pass**

Run:

```bash
bun test tests/plugins/discovery.test.ts --preload ./tests/mock-reset.ts
```

Expected: PASS for `tests/plugins/discovery.test.ts`.

- [x] **Step 5: Commit**

Run:

```bash
git add tests/plugins/discovery.test.ts src/plugins/discovery.ts docs/plugins/developer-guide.md
git commit -m "fix(plugins): harden discovery path verification"
```

- [ ] **Step 6: Write the failing built-in plugin discovery regression tests**

In `tests/plugins/discovery.test.ts`, add repo-real coverage that proves strict discovery still allows Papai's built-in plugins to be discovered after migration. Cover at least:

```ts
test('discovers built-in task-provider plugins under strict relative-only entry-graph rules', () => {
  const result = discoverPlugins(join(process.cwd(), 'plugins'))

  expect(result.errors).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ directoryName: 'task-provider-kaneo' }),
      expect.objectContaining({ directoryName: 'task-provider-youtrack' }),
      expect.objectContaining({ directoryName: 'synthetic-web-search' }),
    ]),
  )
  expect(result.plugins.map((plugin) => plugin.manifest.id)).toEqual(
    expect.arrayContaining(['task-provider-kaneo', 'task-provider-youtrack', 'synthetic-web-search']),
  )
})
```

If a repo-real test proves too brittle, use a temp fixture that mirrors the current built-in plugin import shapes closely enough to catch regressions in the strict-migration work.

- [ ] **Step 7: Run the discovery tests to verify failure against the current built-in plugins**

Run:

```bash
bun test tests/plugins/discovery.test.ts --preload ./tests/mock-reset.ts
bun -e "import { discoverPlugins } from './src/plugins/discovery.js'; const result = discoverPlugins('./plugins'); console.log(JSON.stringify({ pluginIds: result.plugins.map((p) => p.manifest.id), errors: result.errors }, null, 2));"
```

Expected: FAIL because the current built-in plugin entry graphs still contain bare imports such as `papai/plugin-types` and `zod`, so strict discovery now rejects them.

- [ ] **Step 8: Migrate the built-in plugin entry graphs to full strict relative-only imports**

Keep the strict Task 6 policy. Do not add allowlists or special cases.

1. Replace `papai/plugin-types` imports in built-in plugin source reachable from discovered entry points with relative imports.
2. Eliminate direct bare runtime imports such as `zod` from built-in plugin source reachable from discovered entry points by moving that code behind relative-only plugin-owned modules or other framework-owned seams as needed.
3. Preserve runtime behavior; this is a strict-import migration, not a functional redesign.
4. Update `docs/plugins/developer-guide.md` so it no longer tells plugin authors to use `papai/plugin-types` in discovered plugin entry graphs.

- [x] **Step 9: Run the discovery tests and repo-real discovery check to verify pass**

Run:

```bash
bun test tests/plugins/discovery.test.ts --preload ./tests/mock-reset.ts
bun -e "import { discoverPlugins } from './src/plugins/discovery.js'; const result = discoverPlugins('./plugins'); console.log(JSON.stringify({ pluginIds: result.plugins.map((p) => p.manifest.id), errors: result.errors }, null, 2));"
```

Expected: PASS for `tests/plugins/discovery.test.ts`, and `discoverPlugins('./plugins')` should again report the built-in plugins as discovered instead of rejected for bare imports.

- [x] **Step 10: Commit**

Run:

```bash
git add tests/plugins/discovery.test.ts src/plugins/discovery.ts docs/plugins/developer-guide.md plugins/task-provider-kaneo plugins/task-provider-youtrack plugins/synthetic-web-search
git commit -m "fix(plugins): complete strict discovery migration"
```

- [ ] **Step 11: Write the failing approval-hash regression tests for plugin-local runtime bridges**

In `tests/plugins/discovery.test.ts`, add focused coverage proving that plugin-local relative `import.meta.require('./...')` targets remain part of discovery approval coverage. Cover at least one temp plugin where changing a local require target changes `manifestHash`, for example by requiring `./runtime.js` or `./helper.js` from a plugin-owned bridge module.

- [ ] **Step 12: Run the discovery tests to verify failure for plugin-local require hashing**

Run:

```bash
bun test tests/plugins/discovery.test.ts --preload ./tests/mock-reset.ts
```

Expected: FAIL because discovery currently hashes only files reached through static imports, export-from, and literal dynamic `import()`, not plugin-local relative `import.meta.require('./...')` targets.

- [ ] **Step 13: Extend strict discovery approval coverage to plugin-local relative require targets**

In `src/plugins/discovery.ts` and `src/plugins/discovery-imports.ts` as needed:

1. Detect plugin-local relative `import.meta.require('./...')` calls in plugin-owned source.
2. Reject non-relative `import.meta.require(...)` specifiers under the same strict bare-module policy when they are part of the discovered plugin-owned graph.
3. Include relative require targets in the walked source graph so local runtime bridge modules and the local files they require participate in `manifestHash`.
4. Preserve the existing strict rule for static imports and literal dynamic imports.
5. Update `docs/plugins/developer-guide.md` so approval coverage language stays honest for plugin-local runtime bridges.

- [ ] **Step 14: Run the discovery tests and repo-real discovery check to verify pass**

Run:

```bash
bun test tests/plugins/discovery.test.ts --preload ./tests/mock-reset.ts
bun -e "import { discoverPlugins } from './src/plugins/discovery.js'; const result = discoverPlugins('./plugins'); console.log(JSON.stringify({ pluginIds: result.plugins.map((p) => p.manifest.id), errors: result.errors }, null, 2));"
```

Expected: PASS for `tests/plugins/discovery.test.ts`, and built-in plugins remain discoverable while local runtime-bridge files now participate in approval hashing.

- [ ] **Step 15: Commit**

Run:

```bash
git add tests/plugins/discovery.test.ts src/plugins/discovery.ts src/plugins/discovery-imports.ts docs/plugins/developer-guide.md
git commit -m "fix(plugins): hash local runtime bridge imports"
```

---

### Task 7: Add Generic Provider Auto-Provision Hook and Remove Core-to-Kaneo Imports

**Files:**

- Modify: `tests/providers/registry.test.ts`
- Modify: `tests/commands/start.test.ts`
- Modify: `tests/commands/setup.test.ts`
- Modify: `tests/llm-orchestrator.test.ts`
- Modify: `src/providers/registry.ts`
- Create: `src/providers/auto-provision.ts`
- Modify: `src/commands/start.ts`
- Modify: `src/commands/setup.ts`
- Modify: `src/llm-orchestrator.ts`
- Modify: `src/llm-orchestrator-types.ts`
- Modify: `src/plugins/context.ts`
- Modify: `plugins/task-provider-kaneo/index.ts`
- Modify: `plugins/task-provider-kaneo/provision.ts`

- [ ] **Step 1: Write the failing provider-hook and core-callsite tests**

In `tests/providers/registry.test.ts`, add a descriptor coverage test:

```ts
test('contributed provider descriptor can expose autoProvision hook', async () => {
  const autoProvision = mock(async () => undefined)

  registerContributedTaskProviderType('auto-provider', {
    pluginId: 'auto-plugin',
    factory: () => createMockProvider({ name: 'auto-provider' }),
    capabilities: new Set(),
    displayName: 'Auto Provider',
    autoProvision,
  })

  expect(getTaskProviderDescriptor('auto-provider')?.source).toEqual({ plugin: 'auto-plugin' })
  expect(typeof getTaskProviderDescriptor('auto-provider')?.autoProvision).toBe('function')
})
```

In `tests/commands/start.test.ts`, add a DI-style seam so `/start` can assert it calls generic auto-provision rather than the Kaneo-specific helper.

In `tests/commands/setup.test.ts`, add a DI seam for generic provider provisioning dispatch in the group setup path.

In `tests/llm-orchestrator.test.ts`, change the orchestrator dependency name from `maybeProvisionKaneo` to `maybeAutoProvision` and add a test that verifies the generic hook is used for DM provisioning.

- [ ] **Step 2: Run the targeted tests to verify failure**

Run:

```bash
bun test tests/providers/registry.test.ts tests/commands/start.test.ts tests/commands/setup.test.ts tests/llm-orchestrator.test.ts --preload ./tests/mock-reset.ts
```

Expected: FAIL because the provider descriptor has no provisioning hook and the core files still import Kaneo provisioning directly.

- [ ] **Step 3: Implement the minimal generic provisioning path**

In `src/providers/registry.ts`:

1. Add an `AutoProvisionContext` type:

```ts
export type TaskProviderAutoProvisionContext = {
  contextId: string
  chatUserId: string
  username: string | null
  reply: ReplyFn
}
```

2. Extend `ContributedTaskProviderEntry` and `TaskProviderTypeDescriptor` with:

```ts
autoProvision?: (context: TaskProviderAutoProvisionContext) => Promise<void>
```

3. Carry that field through `registerContributedTaskProviderType(...)` and `listTaskProviderTypes()`.

In `src/plugins/context.ts`, extend `registerTaskProviderType(...)` to accept either the current `(type, factory)` form or an object form with `factory` and optional `autoProvision`. Update the collected provider registration shape accordingly.

In `src/providers/auto-provision.ts`, add a helper shaped like:

```ts
export async function maybeAutoProvisionProvider(
  reply: ReplyFn,
  contextId: string,
  chatUserId: string,
  username: string | null,
): Promise<void> {
  const settings = getContextSettings(contextId)
  if (settings === null) return
  const taskInstance = getTaskInstance(settings.taskInstanceId)
  if (taskInstance === null || taskInstance.status !== 'active') return
  const descriptor = getTaskProviderDescriptor(taskInstance.type)
  if (descriptor?.autoProvision === undefined) return
  await descriptor.autoProvision({ contextId, chatUserId, username, reply })
}
```

In `src/commands/start.ts`, `src/commands/setup.ts`, and `src/llm-orchestrator.ts` / `src/llm-orchestrator-types.ts`, replace direct Kaneo provisioning imports and dependency names with the generic helper.

In `plugins/task-provider-kaneo/index.ts`, change registration to the object form:

```ts
ctx.registration.registerTaskProviderType('kaneo', {
  factory: (config): TaskProvider => new KaneoProvider(buildKaneoConfig(config), config['workspaceId'] ?? ''),
  autoProvision: ({ reply, contextId, username }) => maybeProvisionKaneo(reply, contextId, username),
})
```

Export or re-use `maybeProvisionKaneo(...)` from `plugins/task-provider-kaneo/provision.ts` as the hook implementation.

- [ ] **Step 4: Run the targeted tests to verify pass**

Run:

```bash
bun test tests/providers/registry.test.ts tests/commands/start.test.ts tests/commands/setup.test.ts tests/llm-orchestrator.test.ts --preload ./tests/mock-reset.ts
```

Expected: PASS for the updated provider-hook and core-dispatch coverage.

- [ ] **Step 5: Commit**

Run:

```bash
git add tests/providers/registry.test.ts tests/commands/start.test.ts tests/commands/setup.test.ts tests/llm-orchestrator.test.ts src/providers/registry.ts src/providers/auto-provision.ts src/commands/start.ts src/commands/setup.ts src/llm-orchestrator.ts src/llm-orchestrator-types.ts src/plugins/context.ts plugins/task-provider-kaneo/index.ts plugins/task-provider-kaneo/provision.ts
git commit -m "refactor(providers): route auto provision through descriptors"
```

---

### Task 8: Make `/config`, Admin Reporting, Eligibility, KV Prefixes, and MCP Helper Behavior Honest

**Files:**

- Modify: `tests/commands/config.test.ts`
- Modify: `tests/debug/admin-system.test.ts`
- Modify: `tests/plugins/registry.test.ts`
- Modify: `tests/plugins/contributions.test.ts`
- Modify: `src/commands/config.ts`
- Modify: `src/debug/admin-system.ts`
- Modify: `src/plugins/registry-context-eligibility.ts`
- Modify: `src/plugins/store.ts`
- Create: `src/mcp/plugin-pool-adapter.ts`
- Modify: `src/tools/index.ts`
- Modify: `src/chat/tool-toggle-live-tools.ts`

- [ ] **Step 1: Write the failing operator-surface and cleanup tests**

In `tests/commands/config.test.ts`, add coverage that an active-but-ineligible plugin reports `inactive` or `error` distinctly instead of plain `disabled`.

Add a test like:

```ts
test('renders plugin error state distinctly from disabled', async () => {
  const plugin = makePlugin('error-plugin')
  pluginRegistry.registerDiscovered(plugin)
  pluginRegistry.approve(plugin.manifest.id, 'admin', plugin.manifestHash)
  pluginRegistry.markError(plugin.manifest.id, 'activation failed')

  const { reply, buttonCalls } = createMockReply()
  await renderConfigForTarget(reply, USER_ID, true)

  expect(buttonCalls[0]).toContain('error')
})
```

In `tests/debug/admin-system.test.ts`, replace the current custom-provider expectation with descriptor-driven truthfulness:

```ts
test('reports a single custom active task provider type by name', async () => {
  insertTaskInstance({
    id: 'linear-main',
    type: 'linear',
    config: { baseUrl: 'https://linear.invalid' },
    status: 'active',
  })

  const res = handleAdminSystem()
  const body = await readJson(res)

  expect(pick(body, 'taskProvider')).toBe('linear')
})
```

In `tests/plugins/registry.test.ts`, add a small regression for single-query enabled-state logic if needed.

In `tests/plugins/contributions.test.ts`, add a reset-state assertion for collision suppression if Task 3 introduced the reset helper.

Add a KV prefix test in a store-focused suite if there is one local to plugins; otherwise add it near other plugin-store assertions:

```ts
test('kvList treats wildcard characters literally in prefixes', () => {
  kvSet('plugin-a', 'ctx-1', 'literal%key', 'one')
  kvSet('plugin-a', 'ctx-1', 'literalXkey', 'two')

  expect(kvList('plugin-a', 'ctx-1', 'literal%').map((row) => row.key)).toEqual(['literal%key'])
})
```

- [ ] **Step 2: Run the targeted tests to verify failure**

Run:

```bash
bun test tests/commands/config.test.ts tests/debug/admin-system.test.ts tests/plugins/registry.test.ts tests/plugins/contributions.test.ts --preload ./tests/mock-reset.ts
```

Expected: FAIL because `/config` still collapses states, admin reporting is hardcoded, collision suppression is process-global, and KV prefix matching still treats `%` and `_` as wildcards.

- [ ] **Step 3: Implement the minimal operator-surface and helper cleanup**

In `src/commands/config.ts`, make `formatPluginStatus(...)` distinguish:

```ts
if (!selected) return 'disabled'
if (entry.state === 'error') return 'error'
if (entry.state !== 'active') return `inactive (${entry.state})`
```

before checking per-context eligibility.

In `src/debug/admin-system.ts`, remove `TASK_PROVIDERS` and `isTaskProvider(...)`; derive `taskProvider` from the active task-instance types directly with `singleKnownProvider(...)`.

In `src/plugins/registry-context-eligibility.ts`, replace the `isPluginEnabledForContext(...)` call with `contextState.enabled` when `contextState` is already loaded.

In `src/plugins/store.ts`, add a small LIKE-escape helper and change `kvList(...)` to use an escaped prefix.

Create `src/mcp/plugin-pool-adapter.ts` with the shared `PluginPoolAdapter` type and `adaptMcpPool()` helper copied from the existing implementations.

Update both `src/tools/index.ts` and `src/chat/tool-toggle-live-tools.ts` to import the shared helper and delete the duplicated local implementations.

If Task 3 exposed a collision-suppression reset function, add a `resetForTesting()` style helper on the contribution registry or module-level state and use it in the affected tests.

- [ ] **Step 4: Run the targeted tests to verify pass**

Run:

```bash
bun test tests/commands/config.test.ts tests/debug/admin-system.test.ts tests/plugins/registry.test.ts tests/plugins/contributions.test.ts --preload ./tests/mock-reset.ts
```

Expected: PASS for the updated operator-surface and cleanup coverage.

- [ ] **Step 5: Commit**

Run:

```bash
git add tests/commands/config.test.ts tests/debug/admin-system.test.ts tests/plugins/registry.test.ts tests/plugins/contributions.test.ts src/commands/config.ts src/debug/admin-system.ts src/plugins/registry-context-eligibility.ts src/plugins/store.ts src/mcp/plugin-pool-adapter.ts src/tools/index.ts src/chat/tool-toggle-live-tools.ts
git commit -m "fix(plugins): align operator surfaces with runtime state"
```

---

### Task 9: Update Repo-Level and Plugin Developer Docs to Match the Trusted In-Process Model

**Files:**

- Modify: `docs/plugins/developer-guide.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the failing doc assertions as a review checklist in the commit message draft**

Before editing, confirm the docs currently say all of the following and need correction:

```text
- identity facade docs still show recordClaim(chatUserId, ...)
- scheduled job docs still show execute(contextId)
- permission docs still list chat.send
- trust-model docs imply stronger isolation than trusted in-process code actually provides
- approval docs do not describe bare-module import rejection in plugin entry graphs
```

This is a documentation task, so there is no automated failing test. Treat the diff review itself as the red/green cycle.

- [ ] **Step 2: Update the plugin developer guide**

In `docs/plugins/developer-guide.md`:

1. Change the identity section so `recordClaim(...)` documents only provider identity inputs, not an arbitrary chat-user target.
2. Change the scheduled job section from `execute(contextId)` to `execute(runtime)` and describe the optional task-provider facade.
3. Update the permission table so `commands` and `scheduler` are enforced permissions and `chat.send` is removed.
4. Rewrite the trust-model wording so it explicitly says plugins are trusted in-process code and that the framework API surface is restricted even though the process is not sandboxed.
5. Document that local plugin-owned imports are included in approval coverage and bare-module imports from plugin entry graphs are unsupported.

- [ ] **Step 3: Update repo-level plugin-system guidance**

In `CLAUDE.md`, update the Plugin System section to match the implemented runtime contract:

```md
- Plugins are trusted local in-process code. The framework does not expose raw DB/chat/provider/env APIs, but this is not a sandbox guarantee.
- `commands` and `scheduler` are enforced permissions.
- `chat.send` is not part of the current plugin permission vocabulary.
- Scheduled jobs execute with a framework-owned runtime context, not bare `contextId` only.
```

- [ ] **Step 4: Run format check on the edited docs**

Run:

```bash
bun format:check
```

Expected: PASS. If formatting fails, run `bun format` and then rerun `bun format:check`.

- [ ] **Step 5: Commit**

Run:

```bash
git add docs/plugins/developer-guide.md CLAUDE.md
git commit -m "docs(plugins): align docs with trusted runtime model"
```

---

### Task 10: Run Focused Verification and Full Repository Gate

**Files:**

- No code changes required unless verification exposes a missed gap.

- [ ] **Step 1: Run focused plugin-system verification**

Run:

```bash
bun test tests/plugins/loader.test.ts tests/plugins/discovery.test.ts tests/plugins/contributions.test.ts tests/plugins/context.test.ts tests/plugins/registry.test.ts --preload ./tests/mock-reset.ts
```

Expected: PASS for all targeted plugin suites.

- [ ] **Step 2: Run focused core-surface verification**

Run:

```bash
bun test tests/providers/registry.test.ts tests/commands/start.test.ts tests/commands/setup.test.ts tests/commands/config.test.ts tests/debug/admin-system.test.ts tests/llm-orchestrator.test.ts --preload ./tests/mock-reset.ts
```

Expected: PASS for the touched provider, command, debug, and orchestrator suites.

- [ ] **Step 3: Run static quality checks for touched files**

Run:

```bash
bun lint && bun typecheck && bun format:check
```

Expected: PASS for lint, typecheck, and formatting.

- [ ] **Step 4: Run the full release gate**

Run:

```bash
bun check:full
```

Expected: PASS with all repo checks green.

- [ ] **Step 5: Commit the final verification checkpoint**

Run:

```bash
git add -A
git commit -m "chore(plugins): complete validated remediation pass"
```

---

## Self-Review Checklist

## Drift Log

| Date       | Category           | Item                                                         | Decision                                                                  |
| ---------- | ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 2026-05-30 | In-plan, accurate  | Tasks 1-5                                                    | Marked completed to match implemented and reviewed branch state           |
| 2026-05-30 | In-plan, divergent | Task 6 strict discovery hardening landed but broke built-ins | Rewrite Task 6 to continue with full strict migration of built-in plugins |

Spec coverage:

- loader lifecycle fix: Task 1
- actor-bound identity writes: Task 2
- scheduled-job runtime context: Task 3
- generic provider provisioning hook: Task 7
- enforced `commands` / `scheduler` permissions and removed `chat.send`: Task 4
- persisted runtime state and dead `config_missing` cleanup: Task 5
- fail-closed discovery and approval coverage policy: Task 6
- `/config` truthfulness, admin provider reporting, duplicate eligibility query, collision suppression scope, KV prefix escape, shared MCP helper: Task 8
- doc and contract corrections: Task 9
- end-to-end verification: Task 10

Placeholder scan:

- no `TODO`, `TBD`, or “implement later” placeholders remain
- every code-changing task names exact files and concrete commands

Type consistency:

- `recordClaim(...)` is consistently planned as actor-bound
- `PluginScheduledJob.execute(...)` is consistently planned as `execute(runtime)`
- provider provisioning is consistently planned as an optional provider-descriptor hook named `autoProvision`
