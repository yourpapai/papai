<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Task-Provider-as-Plugin Phase 2 (Type Catalog + Admin UX) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make task-provider _types_ a queryable catalog (built-in + plugin-contributed) and drive the `/admin#instances` create/edit task-instance form dynamically from each type's config schema, so plugin-contributed provider types become creatable as task instances without code changes to the admin surface.

**Architecture:** Add a `TaskProviderTypeDescriptor` + `listTaskProviderTypes()` to `src/providers/registry.ts` that merges static built-in descriptors with plugin-contributed entries (entries gain `displayName`/`configSchema`, captured from the manifest at registration). Open the `TaskInstanceType` union to `string` and teach `TaskProviderResolver` to pass `task_instances.config` straight through for non-built-in types. Expose the catalog via `GET /api/task-provider-types`; validate task-instance `type` against it. Rework `InstancesSection.svelte` to populate the type dropdown from the catalog and render per-type config fields (password input for `sensitive` keys).

**Tech Stack:** Bun + strict TypeScript (`.js` import paths), Zod v4, Svelte 5 runes (`$state`/`$derived`/`$effect`), `bun:test` with `happy-dom` for client tests.

---

## Context for the implementer (read once)

The Multi-Provider Router is already on `master`. Relevant current state, verified on disk:

- `src/providers/registry.ts` already has `createProvider()` consulting the plugin-contributed map and `getCapabilitiesForTaskInstance()`. Built-in factories live in a `providers` map keyed `'kaneo'`/`'youtrack'`. The contributed map is `pluginContributedTaskProviderFactories: Map<string, ContributedTaskProviderEntry>` where the entry is `{ pluginId, factory, capabilities }`.
- `src/providers/resolver.ts` — `TaskProviderResolver.resolve(contextId)` reads `getContextSettings` → `getTaskInstance` → builds config via `buildKaneoConfig`/`buildYouTrackConfig` and calls `this.deps.createProvider(instance.type, config)`. **Credentials are per-user** (`getConfig(contextId,'kaneo_apikey')`, `'youtrack_token'`); `task_instances.config` carries only the base URL (`config['baseUrl'] ?? config['url']`).
- `src/plugins/context.ts` — `buildRegisterTaskProviderType(manifest)` calls `registerContributedTaskProviderType(type, { pluginId: manifest.id, factory: descriptor.factory, capabilities: new Set(manifest.providerCapabilities) })`.
- `src/instances/types.ts` — `TaskInstanceType = 'kaneo' | 'youtrack'`; `InstanceConfig = Record<string,string>`.
- `src/instances/encryption.ts` — `maskConfig(config)` masks values whose **key** matches `/token|key|secret|password|cookie/iu`. `task_instances.config` is AES-256-GCM encrypted at rest; admin GET responses are masked through `maskConfig`.
- `src/debug/instance-routes.ts` — `taskInstanceSchema = z.object({ id, type: z.enum(['kaneo','youtrack']), config: instanceConfigSchema })`; route gating via `INSTANCE_API_PREFIXES`; `authorizeWrite` gates POST/DELETE only (GET stays open). `jsonResponse` helper exists.
- `client/shared/api-types.ts` — `TaskInstanceView.type: 'kaneo' | 'youtrack'`, `InstanceConfigView = Record<string,string>`.
- `client/admin/instance-fetcher-schemas.ts:23` — `TaskInstanceViewSchema = InstanceViewBaseSchema.extend({ ... })`.
- `client/admin/fetchers.ts` — `CreateTaskInstanceInput.type = TaskInstanceView['type']`; `createTaskInstance`/`fetchTaskInstances` use `TaskInstanceViewSchema`.
- `client/admin/sections/InstancesSection.svelte` — task form is a hardcoded `<select>` (kaneo/youtrack) + a single `task-config-input` JSON textbox; `createTask()` posts `requireConfig(taskConfig)`.

### Key design decisions (do not deviate without flagging)

1. **Built-in descriptor `configSchema` reflects what the resolver actually reads from `task_instances.config`** — i.e. the base URL only. Per-user credentials (`kaneo_apikey`, `youtrack_token`, Kaneo `workspaceId`) stay in user config and are **not** part of the instance descriptor. This intentionally diverges from the spec's illustrative Kaneo `configSchema` (which listed `apiKey`/`workspaceId`); moving credentials into per-instance config is a separate future change, out of scope here. Use config key `baseUrl` (the resolver already prefers `baseUrl`, falling back to `url`, so existing `{ url }` rows keep resolving).
2. **`sensitive` drives client rendering only** (password input + masked display). Server-side masking remains key-pattern-based in `maskConfig`. A `sensitive` key whose name doesn't match the pattern will render masked in the client but is **not** additionally masked server-side; that gap is acceptable for built-ins (only `baseUrl`, non-sensitive) and noted for future hardening.
3. **Duplicate-type registration keeps today's throw behavior** (`registry.ts` `registerContributedTaskProviderType`). Spec's "first-wins-with-log" is out of scope for Phase 2.
4. **No DB/schema migration.** `task_instances` columns are unchanged.

### Lint/gate reality

- The enforced gate is `bun lint` + `bun typecheck` + `bun format:check` (pre-commit). `bun lint:agent-strict` is advisory and NOT a gate — optional params (`sensitive?: boolean`) and `deps = defaultDeps` default params are the established, gate-passing pattern.
- Never add `eslint-disable`/`oxlint-disable`/`@ts-ignore`/`@ts-nocheck` (hook-blocked). No `as never`/unsafe casts (`no-unsafe-type-assertion`). Use `.js` import extensions.
- TDD hooks run a targeted test per edited `src/`/`client/` file; `client/foo.ts` maps to `tests/client/foo.test.ts`. Svelte components map to `tests/client/admin/sections/<Name>.test.ts`.

### Commands

- Targeted test: `bun test tests/providers/registry.test.ts`
- Client test: `bun test:client tests/client/admin/sections/InstancesSection.test.ts`
- Full gate before finishing: `bun check:verbose`

---

## Task 1: Descriptor type + `listTaskProviderTypes()` for built-ins; add `sensitive` to `ProviderConfigRequirement`

**Files:**

- Modify: `src/providers/types.ts:77` (add `sensitive?: boolean`)
- Modify: `src/providers/registry.ts` (add `TaskProviderTypeDescriptor`, built-in descriptor seeds, `listTaskProviderTypes()`)
- Test: `tests/providers/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/providers/registry.test.ts` (inside the file, new `describe`):

```typescript
import { listTaskProviderTypes } from '../../src/providers/registry.js'

describe('listTaskProviderTypes (built-in catalog)', () => {
  test('includes kaneo and youtrack as built-in descriptors', () => {
    const types = listTaskProviderTypes()
    const kaneo = types.find((descriptor) => descriptor.type === 'kaneo')
    const youtrack = types.find((descriptor) => descriptor.type === 'youtrack')

    expect(kaneo).toBeDefined()
    expect(kaneo?.source).toBe('builtin')
    expect(kaneo?.displayName).toBe('Kaneo')
    expect(kaneo?.configSchema).toEqual([{ key: 'baseUrl', label: 'Kaneo URL', required: true, sensitive: false }])
    expect(kaneo?.capabilities.size).toBeGreaterThan(0)

    expect(youtrack?.source).toBe('builtin')
    expect(youtrack?.configSchema[0]?.key).toBe('baseUrl')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/providers/registry.test.ts`
Expected: FAIL — `listTaskProviderTypes` is not exported.

- [ ] **Step 3: Implement**

In `src/providers/types.ts`, change line 77:

```typescript
/** Configuration keys that a provider requires to function. */
export type ProviderConfigRequirement = { key: string; label: string; required: boolean; sensitive?: boolean }
```

In `src/providers/registry.ts`, after the `pluginContributedTaskProviderFactories` declaration and after `createProvider`/`getCapabilitiesForTaskInstance` (anywhere below them is fine), add:

```typescript
import type { ProviderConfigRequirement } from './types.js'

export type TaskProviderTypeDescriptor = {
  type: string
  displayName: string
  configSchema: readonly ProviderConfigRequirement[]
  capabilities: ReadonlySet<TaskCapability>
  source: 'builtin' | { plugin: string }
}

type BuiltinDescriptorSeed = {
  type: string
  displayName: string
  configSchema: readonly ProviderConfigRequirement[]
}

const builtinDescriptorSeeds: readonly BuiltinDescriptorSeed[] = [
  {
    type: 'kaneo',
    displayName: 'Kaneo',
    configSchema: [{ key: 'baseUrl', label: 'Kaneo URL', required: true, sensitive: false }],
  },
  {
    type: 'youtrack',
    displayName: 'YouTrack',
    configSchema: [{ key: 'baseUrl', label: 'YouTrack URL', required: true, sensitive: false }],
  },
]

/** Merge built-in and plugin-contributed task provider types into a static catalog. */
export function listTaskProviderTypes(): TaskProviderTypeDescriptor[] {
  const builtin: TaskProviderTypeDescriptor[] = builtinDescriptorSeeds.map((seed) => ({
    type: seed.type,
    displayName: seed.displayName,
    configSchema: seed.configSchema,
    capabilities: createProvider(seed.type, {}).capabilities,
    source: 'builtin',
  }))
  return builtin
}
```

> Note: `createProvider(seed.type, {})` constructs a throwaway provider with empty config purely to read its static `capabilities` getter — the built-in constructors perform no I/O, exactly as `getCapabilitiesForTaskInstance` already relies on.

`ProviderConfigRequirement` is the existing import target; if `registry.ts` does not already import it, add `import type { ProviderConfigRequirement } from './types.js'` to the existing type-import group (it already imports `TaskProvider` from `./types.js` — extend that import instead of adding a duplicate line).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/providers/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/types.ts src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat(providers): add TaskProviderTypeDescriptor + listTaskProviderTypes for built-ins"
```

---

## Task 2: Contributed entries carry `displayName`/`configSchema`; catalog merges them

**Files:**

- Modify: `src/providers/registry.ts` (`ContributedTaskProviderEntry`, `listTaskProviderTypes`)
- Modify: `src/plugins/context.ts` (`buildRegisterTaskProviderType` passes manifest name + configSchema)
- Test: `tests/providers/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/providers/registry.test.ts` inside the existing `describe('contributed task provider registry', ...)` block (it already imports `registerContributedTaskProviderType`/`unregisterContributedTaskProviderType` and has an `afterEach` cleanup — reuse them; register under a unique pluginId and unregister in the test):

```typescript
test('listTaskProviderTypes includes contributed descriptors with displayName and configSchema', () => {
  registerContributedTaskProviderType('demo-tracker', {
    pluginId: 'task-provider-demo',
    factory: () => createMockProvider(),
    capabilities: new Set<TaskCapability>(['comments.read']),
    displayName: 'Demo Tracker',
    configSchema: [{ key: 'baseUrl', label: 'Demo URL', required: true, sensitive: false }],
  })

  const descriptor = listTaskProviderTypes().find((entry) => entry.type === 'demo-tracker')
  expect(descriptor).toBeDefined()
  expect(descriptor?.displayName).toBe('Demo Tracker')
  expect(descriptor?.source).toEqual({ plugin: 'task-provider-demo' })
  expect(descriptor?.configSchema).toEqual([{ key: 'baseUrl', label: 'Demo URL', required: true, sensitive: false }])
})
```

Add to the imports at the top of the test file if missing: `import { createMockProvider } from '../tools/mock-provider.js'` and ensure `TaskCapability` type import exists (`import type { TaskCapability } from '../../src/providers/task-capability.js'`). Check the file's existing imports first and only add what's absent.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/providers/registry.test.ts`
Expected: FAIL — `ContributedTaskProviderEntry` has no `displayName`/`configSchema`; descriptor not found.

- [ ] **Step 3: Implement**

In `src/providers/registry.ts`, extend the entry type and the catalog:

```typescript
export type ContributedTaskProviderEntry = {
  pluginId: string
  factory: TaskProviderFactory
  capabilities: ReadonlySet<TaskCapability>
  displayName: string
  configSchema: readonly ProviderConfigRequirement[]
}
```

Update `listTaskProviderTypes()` to append contributed descriptors:

```typescript
export function listTaskProviderTypes(): TaskProviderTypeDescriptor[] {
  const builtin: TaskProviderTypeDescriptor[] = builtinDescriptorSeeds.map((seed) => ({
    type: seed.type,
    displayName: seed.displayName,
    configSchema: seed.configSchema,
    capabilities: createProvider(seed.type, {}).capabilities,
    source: 'builtin',
  }))
  const contributed: TaskProviderTypeDescriptor[] = [...pluginContributedTaskProviderFactories.entries()].map(
    ([type, entry]) => ({
      type,
      displayName: entry.displayName,
      configSchema: entry.configSchema,
      capabilities: entry.capabilities,
      source: { plugin: entry.pluginId },
    }),
  )
  return [...builtin, ...contributed]
}
```

In `src/plugins/context.ts`, update `buildRegisterTaskProviderType` so the `registerContributedTaskProviderType` call also passes `displayName` and `configSchema` sourced from the manifest:

```typescript
registerContributedTaskProviderType(type, {
  pluginId: manifest.id,
  factory: descriptor.factory,
  capabilities: new Set(manifest.providerCapabilities),
  displayName: manifest.name,
  configSchema: manifest.providerConfigSchema,
})
```

> `manifest.providerConfigSchema` items are `{ key, label, required, sensitive }` (Zod default `sensitive: false`), structurally assignable to `ProviderConfigRequirement`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/providers/registry.test.ts tests/plugins/context.test.ts`
Expected: PASS (context.ts `registerTaskProviderType` tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/providers/registry.ts src/plugins/context.ts tests/providers/registry.test.ts
git commit -m "feat(providers): contributed task provider types expose displayName and configSchema in catalog"
```

---

## Task 3: Open `TaskInstanceType` to `string`; resolver passthrough for contributed types

**Files:**

- Modify: `src/instances/types.ts:9` (`TaskInstanceType = string`)
- Modify: `src/providers/resolver.ts` (three-way branch; passthrough for non-built-in types)
- Test: `tests/providers/resolver.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/providers/resolver.test.ts` a test that a contributed type resolves by passing `instance.config` straight to `createProvider`. Match the file's existing DI style (it constructs `new TaskProviderResolver(partialDeps)`; inspect the top of the file for the existing `makeDeps`/stub pattern and reuse it). Skeleton:

```typescript
test('resolves a contributed provider type by passing instance config through unchanged', () => {
  const created: Array<{ type: string; config: Record<string, string> }> = []
  const resolver = new TaskProviderResolver({
    getContextSettings: () => ({ contextId: 'ctx-1', taskInstanceId: 'demo-1', platformInstanceId: 'p-1' }),
    getTaskInstance: () => ({
      id: 'demo-1',
      type: 'demo-tracker',
      config: { baseUrl: 'https://demo.invalid', region: 'eu' },
      status: 'active',
      createdAt: '2026-05-25T00:00:00.000Z',
    }),
    createProvider: (type, config) => {
      created.push({ type, config })
      return createMockProvider()
    },
  })

  const provider = resolver.resolve('ctx-1')

  expect(provider).not.toBeNull()
  expect(created).toEqual([{ type: 'demo-tracker', config: { baseUrl: 'https://demo.invalid', region: 'eu' } }])
})
```

Ensure `createMockProvider` is imported (`import { createMockProvider } from '../tools/mock-provider.js'`) — check existing imports first.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/providers/resolver.test.ts`
Expected: FAIL — current `resolve` routes any non-`kaneo` type into `buildYouTrackConfig`, which reads `youtrack_token` and returns `null`, so `provider` is `null`.

- [ ] **Step 3: Implement**

In `src/instances/types.ts` change line 9:

```typescript
export type TaskInstanceType = string
```

In `src/providers/resolver.ts`, replace the two-way config branch in `resolve()` (currently `instance.type === 'kaneo' ? buildKaneoConfig(...) : buildYouTrackConfig(...)`) with:

```typescript
const config =
  instance.type === 'kaneo'
    ? buildKaneoConfig(contextId, instance, this.deps)
    : instance.type === 'youtrack'
      ? buildYouTrackConfig(contextId, instance, this.deps)
      : { ...instance.config }
```

> For contributed types the plugin factory receives the instance config verbatim — that is the plugin model. Built-in types keep their per-user-credential assembly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/providers/resolver.test.ts`
Expected: PASS (existing kaneo/youtrack resolution tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/instances/types.ts src/providers/resolver.ts tests/providers/resolver.test.ts
git commit -m "feat(instances): open TaskInstanceType union and resolve contributed types via instance config"
```

---

## Task 4: Server — validate task-instance `type` against the catalog + `GET /api/task-provider-types`

**Files:**

- Modify: `src/debug/instance-routes.ts` (open `taskInstanceSchema.type`, validate against catalog on POST, add catalog route + view mapper + prefix)
- Test: `tests/debug/instance-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/debug/instance-routes.test.ts` (inside `describe('instance API routes', ...)`; reuse its existing `route(...)`/`expectResponse(...)` helpers and `DEBUG_TOKEN` setup — read the top of the file to match the exact harness):

```typescript
test('GET /api/task-provider-types returns the built-in catalog', async () => {
  const res = expectResponse(await route('/api/task-provider-types'))
  expect(res.status).toBe(200)
  const body = (await res.json()) as Array<{
    type: string
    displayName: string
    capabilities: string[]
    source: unknown
  }>
  const types = body.map((descriptor) => descriptor.type)
  expect(types).toContain('kaneo')
  expect(types).toContain('youtrack')
  const kaneo = body.find((descriptor) => descriptor.type === 'kaneo')
  expect(kaneo?.source).toBe('builtin')
  expect(Array.isArray(kaneo?.capabilities)).toBe(true)
})

test('POST /api/task-instances rejects an unknown provider type', async () => {
  const res = expectResponse(
    await route('/api/task-instances', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'mystery-1', type: 'mystery', config: { baseUrl: 'https://x.invalid' } }),
    }),
  )
  expect(res.status).toBe(400)
  const body = (await res.json()) as { error: string }
  expect(body.error).toBe('unknown_task_provider_type')
})
```

> The existing valid-create test posts `type: 'kaneo'` and must still pass.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/debug/instance-routes.test.ts`
Expected: FAIL — no `/api/task-provider-types` route (404), and unknown type currently rejected by the enum as a generic `invalid_request`, not `unknown_task_provider_type`.

- [ ] **Step 3: Implement**

In `src/debug/instance-routes.ts`:

1. Import the catalog:

```typescript
import { listTaskProviderTypes, type TaskProviderTypeDescriptor } from '../providers/registry.js'
```

2. Open the task schema `type` to a non-empty string:

```typescript
const taskInstanceSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  config: instanceConfigSchema,
})
```

3. Add the prefix so the route is recognized:

```typescript
const INSTANCE_API_PREFIXES = [
  '/api/admins',
  '/api/platform-instances',
  '/api/task-instances',
  '/api/task-provider-types',
] as const
```

4. Add a view mapper near the other `*View` helpers:

```typescript
const taskProviderTypeView = (
  descriptor: TaskProviderTypeDescriptor,
): {
  readonly type: string
  readonly displayName: string
  readonly configSchema: readonly { key: string; label: string; required: boolean; sensitive: boolean }[]
  readonly capabilities: readonly string[]
  readonly source: 'builtin' | { readonly plugin: string }
} => ({
  type: descriptor.type,
  displayName: descriptor.displayName,
  configSchema: descriptor.configSchema.map((field) => ({
    key: field.key,
    label: field.label,
    required: field.required,
    sensitive: field.sensitive ?? false,
  })),
  capabilities: [...descriptor.capabilities],
  source: descriptor.source,
})
```

5. In `handleTaskInstances`, validate the type against the catalog inside the POST branch (after `parseBody` succeeds, before `insertTaskInstance`):

```typescript
if (url.pathname === '/api/task-instances' && req.method === 'POST') {
  const body = await parseBody(req, taskInstanceSchema)
  if (body instanceof Response) return body
  if (!listTaskProviderTypes().some((descriptor) => descriptor.type === body.type)) {
    return jsonResponse({ error: 'unknown_task_provider_type', type: body.type }, { status: 400 })
  }
  insertTaskInstance({ ...body, status: 'active' })
  const instance = getTaskInstance(body.id)
  return jsonResponse(instance === null ? null : maskedTaskInstance(instance), { status: 201 })
}
```

6. Add the catalog GET route. Add a small handler and wire it in `routeInstanceApi`:

```typescript
const handleTaskProviderTypes = (req: Request, url: URL): Response | null => {
  if (url.pathname === '/api/task-provider-types' && req.method === 'GET') {
    return jsonResponse(listTaskProviderTypes().map((descriptor) => taskProviderTypeView(descriptor)))
  }
  return null
}
```

In `routeInstanceApi`, add before the `task-instances` check:

```typescript
if (url.pathname.startsWith('/api/task-provider-types')) return handleTaskProviderTypes(req, url)
```

> `insertTaskInstance({ ...body, status: 'active' })` now receives `type: string`; with `TaskInstanceType = string` (Task 3) this type-checks. The catalog GET is a read route, so `authorizeWrite` (POST/DELETE only) leaves it open, consistent with other read routes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/debug/instance-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/instance-routes.ts tests/debug/instance-routes.test.ts
git commit -m "feat(admin): serve task provider type catalog and validate instance type against it"
```

---

## Task 5: Client API types, schema, and fetcher for the catalog; open `TaskInstanceView.type`

**Files:**

- Modify: `client/shared/api-types.ts` (`TaskInstanceView.type` → string; add `TaskProviderTypeView`, `ProviderConfigRequirementView`)
- Modify: `client/admin/instance-fetcher-schemas.ts` (open the task type; add `TaskProviderTypeViewSchema`)
- Modify: `client/admin/fetchers.ts` (`CreateTaskInstanceInput.type` → string; `fetchTaskProviderTypes()`)
- Test: `tests/client/admin/fetchers.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/client/admin/fetchers.test.ts` (match the file's `setMockFetch`/`restoreFetch` pattern):

```typescript
test('fetchTaskProviderTypes parses the catalog', async () => {
  setMockFetch(() =>
    Promise.resolve(
      Response.json([
        {
          type: 'kaneo',
          displayName: 'Kaneo',
          configSchema: [{ key: 'baseUrl', label: 'Kaneo URL', required: true, sensitive: false }],
          capabilities: ['comments.read'],
          source: 'builtin',
        },
      ]),
    ),
  )
  const types = await fetchTaskProviderTypes()
  expect(types[0]?.type).toBe('kaneo')
  expect(types[0]?.configSchema[0]?.key).toBe('baseUrl')
  restoreFetch()
})
```

Import `fetchTaskProviderTypes` from `../../../client/admin/fetchers.js` (match the file's existing import path style).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/admin/fetchers.test.ts`
Expected: FAIL — `fetchTaskProviderTypes` is not exported.

- [ ] **Step 3: Implement**

In `client/shared/api-types.ts`:

```typescript
export type ProviderConfigRequirementView = {
  readonly key: string
  readonly label: string
  readonly required: boolean
  readonly sensitive: boolean
}

export type TaskProviderTypeView = Readonly<{
  type: string
  displayName: string
  configSchema: readonly ProviderConfigRequirementView[]
  capabilities: readonly string[]
  source: 'builtin' | { readonly plugin: string }
}>
```

And change `TaskInstanceView.type` from `'kaneo' | 'youtrack'` to `string`.

In `client/admin/instance-fetcher-schemas.ts`:

- In `TaskInstanceViewSchema` (the `.extend({...})` at line 23), change the `type` field from the kaneo/youtrack enum to `z.string()`.
- Add a catalog schema (place near the other instance schemas):

```typescript
export const TaskProviderTypeViewSchema = z.object({
  type: z.string(),
  displayName: z.string(),
  configSchema: z.array(
    z.object({ key: z.string(), label: z.string(), required: z.boolean(), sensitive: z.boolean() }),
  ),
  capabilities: z.array(z.string()),
  source: z.union([z.literal('builtin'), z.object({ plugin: z.string() })]),
})
```

In `client/admin/fetchers.ts`:

- Change `CreateTaskInstanceInput.type` to `string` (it currently aliases `TaskInstanceView['type']`, which now is `string` — verify it resolves to `string`; no edit needed if it still aliases the view type).
- Add the import of `TaskProviderTypeViewSchema` to the schema import group and `TaskProviderTypeView` to the type import group.
- Add the fetcher:

```typescript
export const fetchTaskProviderTypes = async (): Promise<TaskProviderTypeView[]> => {
  const res = await fetch('/api/task-provider-types')
  const body = await readBody(res)
  return z.array(TaskProviderTypeViewSchema).parse(body)
}
```

(Match the exact shape of the neighboring `fetchTaskInstances` — it uses `readBody`/`requireOk` or direct `.json()`; mirror whichever the file uses.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test:client tests/client/admin/fetchers.test.ts tests/client/admin/fetcher-schemas.test.ts`
Expected: PASS. If `fetcher-schemas.test.ts` snapshots the task type enum, update it to accept a string.

- [ ] **Step 5: Commit**

```bash
git add client/shared/api-types.ts client/admin/instance-fetcher-schemas.ts client/admin/fetchers.ts tests/client/admin/fetchers.test.ts
git commit -m "feat(admin-client): add task provider type catalog fetcher and open task instance type"
```

---

## Task 6: Rework `InstancesSection.svelte` — dynamic type dropdown + per-type config form

**Files:**

- Modify: `client/admin/sections/InstancesSection.svelte`
- Test: `tests/client/admin/sections/InstancesSection.test.ts`

- [ ] **Step 1: Update the test (Red)**

In `tests/client/admin/sections/InstancesSection.test.ts`:

1. Add the catalog to the mock router `responseFor`:

```typescript
if (method === 'GET' && url === '/api/task-provider-types')
  return jsonResponse([
    {
      type: 'kaneo',
      displayName: 'Kaneo',
      configSchema: [{ key: 'baseUrl', label: 'Kaneo URL', required: true, sensitive: false }],
      capabilities: ['comments.read'],
      source: 'builtin',
    },
    {
      type: 'youtrack',
      displayName: 'YouTrack',
      configSchema: [{ key: 'baseUrl', label: 'YouTrack URL', required: true, sensitive: false }],
      capabilities: ['comments.read'],
      source: 'builtin',
    },
  ])
```

2. Update the "creates task instances and confirms task deletes" test: instead of typing JSON into `task-config-input`, type into the per-field input and assert the assembled body. The initial GET calls now include `/api/task-provider-types`, so the create POST is no longer `calls[3]` — assert by **matching the POST call** rather than a fixed index:

```typescript
enterValue(input(target, 'task-id-input'), 'kaneo-main')
enterValue(input(target, 'task-config-baseUrl'), 'https://kaneo.invalid')
click(target, 'task-create-button')
await drain()

const taskPost = calls.find((call) => call.method === 'POST' && call.url === '/api/task-instances')
expect(expectCall(taskPost, 0).body).toBe(
  JSON.stringify({ id: 'kaneo-main', type: 'kaneo', config: { baseUrl: 'https://kaneo.invalid' } }),
)
```

3. In the "does not delete task instances when confirmation is cancelled" test and any other test asserting the exact initial `callNames(...)` equals the three-GET array, add `'GET /api/task-provider-types'` to the expected list (the component now loads the catalog on mount). Update those `toEqual([...])` assertions accordingly.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/admin/sections/InstancesSection.test.ts`
Expected: FAIL — `task-config-baseUrl` input missing; catalog GET not issued.

- [ ] **Step 3: Implement the component**

In `client/admin/sections/InstancesSection.svelte`:

1. Import the new fetcher and type:

```typescript
import type { TaskProviderTypeView } from '../../shared/api-types.js'
import { /* existing imports */, fetchTaskProviderTypes } from '../fetchers.js'
```

2. Replace the task type/config state:

```typescript
let taskProviderTypes: TaskProviderTypeView[] = $state([])
let taskId = $state('')
let taskType = $state('')
let taskConfigFields: Record<string, string> = $state({})

const selectedTaskType = $derived(taskProviderTypes.find((descriptor) => descriptor.type === taskType))
```

(Remove `let taskType: TaskType = $state('kaneo')`, `let taskConfig = $state('{}')`, and the `TaskType` alias if now unused.)

3. Load the catalog and pick a default type. Add a loader and call it from `refreshAll`:

```typescript
async function loadTaskProviderTypes(): Promise<void> {
  taskProviderTypes = await fetchTaskProviderTypes()
  if (taskType === '' && taskProviderTypes.length > 0) taskType = taskProviderTypes[0]!.type
}
```

Add `loadTaskProviderTypes()` to the `Promise.all([...])` in `refreshAll`.

4. Reset config fields when the type changes (keeps stale keys out of the POST body):

```typescript
$effect(() => {
  const schema = selectedTaskType?.configSchema ?? []
  const next: Record<string, string> = {}
  for (const field of schema) next[field.key] = taskConfigFields[field.key] ?? ''
  taskConfigFields = next
})
```

5. Build config from declared fields in `createTask`:

```typescript
async function createTask(): Promise<void> {
  try {
    const schema = selectedTaskType?.configSchema ?? []
    const config: Record<string, string> = {}
    for (const field of schema) {
      const value = (taskConfigFields[field.key] ?? '').trim()
      if (field.required && value === '') throw new Error(`${field.label} is required`)
      if (value !== '') config[field.key] = value
    }
    await createTaskInstance({ id: taskId.trim(), type: taskType, config })
    taskId = ''
    taskConfigFields = {}
    await loadTaskInstances()
    setSuccess('Task instance created.')
  } catch (err) {
    setError(err)
  }
}
```

6. Replace the task form markup (the `<label>Type</label>` select and the `task-config-input` label) with a dynamic dropdown + per-field inputs:

```svelte
<label>
  <span>Type</span>
  <select data-testid="task-type-input" bind:value={taskType}>
    {#each taskProviderTypes as descriptor (descriptor.type)}
      <option value={descriptor.type}>{descriptor.displayName}</option>
    {/each}
  </select>
</label>
{#each selectedTaskType?.configSchema ?? [] as field (field.key)}
  <label>
    <span>{field.label}{field.required ? ' *' : ''}</span>
    {#if field.sensitive}
      <input data-testid={`task-config-${field.key}`} type="password" bind:value={taskConfigFields[field.key]} />
    {:else}
      <input data-testid={`task-config-${field.key}`} bind:value={taskConfigFields[field.key]} />
    {/if}
  </label>
{/each}
```

> Keep `data-testid="task-type-input"` so existing dropdown-targeting tests keep working. The config inputs use `task-config-<key>`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test:client tests/client/admin/sections/InstancesSection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/admin/sections/InstancesSection.svelte tests/client/admin/sections/InstancesSection.test.ts
git commit -m "feat(admin-client): drive task instance form from the provider type catalog"
```

---

## Final Verification

- [ ] **Step 1: Full gate**

Run: `bun check:verbose`
Expected: lint, typecheck, format:check, knip, tests, duplicates all pass.

- Watch for **knip**: `listTaskProviderTypes`, `TaskProviderTypeDescriptor`, `fetchTaskProviderTypes`, `TaskProviderTypeView(Schema)` must each have a real consumer. With Task 4 (server) consuming `listTaskProviderTypes`/`TaskProviderTypeDescriptor` and Task 6 (component) consuming the client fetcher/types, all are consumed. If knip flags any as unused, the wiring in Tasks 4/6 is incomplete — fix the wiring, do not add to `knip.jsonc`.
- Watch for **bundle isolation**: none of this is dev-only harness code, so `bun check:bundle-isolation` is unaffected; run it if `bun check:verbose` does not.

- [ ] **Step 2: Confirm client build**

Run: `bun build:client`
Expected: bundles the admin UI without errors (the Svelte changes compile).

- [ ] **Step 3: Manual sanity (optional, not committed)**

Confirm the merged catalog shape:

Run: `bun -e "import('./src/providers/registry.js').then((m) => console.log(JSON.stringify(m.listTaskProviderTypes().map((d) => ({ type: d.type, displayName: d.displayName, source: d.source, caps: d.capabilities.size })))))"`
Expected: a JSON array containing `kaneo` and `youtrack` with `source: "builtin"` and non-zero `caps`.

---

## Out of scope (later phases / steps)

- Migrating Kaneo/YouTrack into `plugins/` packages, `seedBuiltinProviderPlugins()`, `BOOTSTRAP_ENV_MAP`, the `papai/plugin-types` stable import alias (rollout steps 3–4).
- Moving per-user credentials (`kaneo_apikey`, `youtrack_token`, Kaneo `workspaceId`) into per-instance config.
- Server-side masking by descriptor `sensitive` flag (today masking is key-pattern-based).
- First-wins-with-log duplicate-type behavior (currently throws).
- Removing instance-level `TaskProvider.configRequirements` (rollout step 5).
