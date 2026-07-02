<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin and MCP Tool Permissions in the Settings UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make plugin-registered and MCP-sourced tools visible and per-tool editable (`allow`/`ask`/`deny`) in the settings-UI Tools section, grouped per plugin / per MCP server, with group bulk actions.

**Architecture:** The settings route stops using the sync builtin-only `buildTools()` and instead enumerates tool names with the same async assemblers the runtime uses (`buildToolDescriptors` / `buildProviderlessToolDescriptors`), so the displayed surface is exactly the runtime surface (spec approach C). A new `tool-grouping.ts` module derives a display `group` from the namespaced tool name; a new `kind: 'group'` toggle bulk-writes per-tool overrides. The admin defaults route's catalog becomes per-request and gains active plugins' native tool names. The client gains an optional `group` field, a grouping lib, and sub-group rendering in `ToolsSection.svelte`.

**Tech Stack:** Bun, TypeScript (strict, `.js` import extensions), Zod v4, Svelte 5 (settings SPA), bun:test.

**Spec:** `docs/superpowers/specs/2026-07-02-plugin-tool-permissions-design.md`

---

## File map

- Create: `src/debug/settings/tool-grouping.ts` — group derivation + group→tools resolution (server display concern, shared by both routes)
- Modify: `src/debug/settings/tools-routes.ts` — async runtime-accurate enumeration, `group` field in view, `kind: 'group'` toggle
- Modify: `src/debug/settings/admin/tool-defaults-routes.ts` — per-request catalog incl. native plugin tools, `kind: 'group'`
- Modify: `client/settings/fetcher-schemas-tools.ts` — `group` field on `ToolEntrySchema`
- Modify: `client/settings/fetchers.ts`, `client/settings/admin-fetchers.ts` — group-toggle input variants
- Create: `client/settings/lib/group-tools.ts` — pure grouping/summary helpers for the UI
- Modify: `client/settings/sections/ToolsSection.svelte` — sub-group rendering + group bulk button
- Modify: `client/settings/sections/ToolsSection.stories.svelte` — grouped story
- Tests: create `tests/debug/settings/tool-grouping.test.ts`, `tests/debug/settings/tools-routes-plugin.test.ts`, `tests/debug/settings/tools-routes-mcp.test.ts`, `tests/client/settings/group-tools.test.ts`; modify `tests/debug/settings/tools-routes.test.ts`, `tests/debug/settings/admin/tool-defaults-routes.test.ts`, `tests/client/settings/fetcher-schemas-tools.test.ts`
- Docs: `docs/architecture/tools.md`, `docs/architecture/plugins.md`

Conventions that apply to every task: every new `.ts` file starts with the 4-line SPDX header (copy it from any neighboring file); import paths use the `.js` extension; never add lint-disable comments. The pre-commit hook runs lint/typecheck/format/license-headers on staged files automatically.

---

### Task 1: Server grouping module

**Files:**

- Create: `src/debug/settings/tool-grouping.ts`
- Test: `tests/debug/settings/tool-grouping.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings/tool-grouping.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  activePluginSegmentMap,
  deriveToolGroup,
  resolveGroupTools,
} from '../../../src/debug/settings/tool-grouping.js'
import { pluginRegistry } from '../../../src/plugins/registry.js'
import { PLUGIN_API_VERSION, type DiscoveredPlugin } from '../../../src/plugins/types.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

const PLUGIN_ID = 'audio-transcribe'

function makeDiscoveredPlugin(id: string): DiscoveredPlugin {
  return {
    manifest: {
      id,
      name: `Plugin ${id}`,
      version: '1.0.0',
      description: 'Test plugin',
      apiVersion: PLUGIN_API_VERSION,
      main: 'index.ts',
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: [],
        attachmentTransformers: [],
      },
      permissions: [],
      defaultEnabled: false,
      activationTimeoutMs: 5000,
      requiredTaskCapabilities: [],
      requiredChatCapabilities: [],
      configRequirements: [],
      providerCapabilities: [],
      providerTraits: [],
      providerConfigSchema: [],
      providerContextConfigSchema: [],
      providerAllowedHosts: [],
    },
    pluginDir: `/tmp/${id}`,
    entryPoint: `/tmp/${id}/index.ts`,
    manifestHash: `hash-${id}`,
  }
}

describe('tool-grouping', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    pluginRegistry.clearForTesting()
  })

  afterEach(() => {
    pluginRegistry.clearForTesting()
  })

  test('deriveToolGroup returns undefined for builtin names', () => {
    expect(deriveToolGroup('create_task', new Map())).toBeUndefined()
    expect(deriveToolGroup('web_fetch', new Map())).toBeUndefined()
  })

  test('deriveToolGroup extracts the mcp server segment', () => {
    expect(deriveToolGroup('mcp_search-server__fetch_page', new Map())).toBe('search-server')
  })

  test('deriveToolGroup splits at the FIRST double underscore', () => {
    expect(deriveToolGroup('mcp_srv__tool__with__underscores', new Map())).toBe('srv')
  })

  test('deriveToolGroup maps sanitized plugin segments back to the real plugin id', () => {
    const segments = new Map([
      ['audio_transcribe', 'audio-transcribe'],
      ['audio-transcribe', 'audio-transcribe'],
    ])
    // native plugin tool naming (sanitizePluginId: '-' → '_')
    expect(deriveToolGroup('plugin_audio_transcribe__transcribe', segments)).toBe('audio-transcribe')
    // plugin-declared MCP tool naming (sanitizeServerId: kebab-case)
    expect(deriveToolGroup('plugin_audio-transcribe__remote_tool', segments)).toBe('audio-transcribe')
  })

  test('deriveToolGroup falls back to the raw segment for unknown plugins', () => {
    expect(deriveToolGroup('plugin_unknown_seg__t', new Map())).toBe('unknown_seg')
  })

  test('activePluginSegmentMap contains both sanitized forms of each active plugin id', () => {
    pluginRegistry.registerDiscovered(makeDiscoveredPlugin(PLUGIN_ID))
    pluginRegistry.markActive(PLUGIN_ID)
    const map = activePluginSegmentMap()
    expect(map.get('audio_transcribe')).toBe(PLUGIN_ID)
    expect(map.get('audio-transcribe')).toBe(PLUGIN_ID)
  })

  test('resolveGroupTools filters names by domain and derived group', () => {
    pluginRegistry.registerDiscovered(makeDiscoveredPlugin(PLUGIN_ID))
    pluginRegistry.markActive(PLUGIN_ID)
    const names = [
      'create_task',
      'plugin_audio_transcribe__transcribe',
      'plugin_audio_transcribe__list_jobs',
      'plugin_other__t',
      'mcp_srv__fetch',
    ]
    expect(resolveGroupTools(names, 'plugin', 'audio-transcribe')).toEqual([
      'plugin_audio_transcribe__transcribe',
      'plugin_audio_transcribe__list_jobs',
    ])
    expect(resolveGroupTools(names, 'mcp', 'srv')).toEqual(['mcp_srv__fetch'])
    expect(resolveGroupTools(names, 'plugin', 'nope')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/settings/tool-grouping.test.ts`
Expected: FAIL — `Cannot find module '../../../src/debug/settings/tool-grouping.js'`

- [ ] **Step 3: Write the implementation**

Create `src/debug/settings/tool-grouping.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sanitizeServerId } from '../../mcp/types.js'
import { sanitizePluginId } from '../../plugins/contribution-names.js'
import { pluginRegistry } from '../../plugins/registry.js'
import { getToolMetadata, type ToolDomain } from '../../tools/tool-metadata.js'

const NAMESPACED_TOOL_RE = /^(plugin|mcp)_(.+?)__/u

/**
 * Map from every sanitized form of an active plugin id to the real plugin id.
 * Native plugin tools sanitize with '-' → '_' (`sanitizePluginId`), while
 * plugin-declared MCP tools sanitize via `sanitizeServerId` (kebab-case), so
 * both forms are registered.
 */
export function activePluginSegmentMap(): Map<string, string> {
  const map = new Map<string, string>()
  for (const plugin of pluginRegistry.getActivePlugins()) {
    const id = plugin.manifest.id
    map.set(sanitizePluginId(id), id)
    map.set(sanitizeServerId(id), id)
  }
  return map
}

/**
 * Display group for a namespaced tool name: the real plugin id (when the
 * sanitized segment matches an active plugin) or the MCP server id.
 * Undefined for builtin tool names.
 */
export function deriveToolGroup(name: string, segmentMap: ReadonlyMap<string, string>): string | undefined {
  const match = NAMESPACED_TOOL_RE.exec(name)
  if (match === null) return undefined
  const prefix = match[1]
  const segment = match[2]
  if (prefix === undefined || segment === undefined) return undefined
  if (prefix === 'plugin') return segmentMap.get(segment) ?? segment
  return segment
}

/** All names whose tool-metadata domain and derived group both match. */
export function resolveGroupTools(names: readonly string[], domain: ToolDomain, group: string): string[] {
  const segmentMap = activePluginSegmentMap()
  return names.filter((name) => {
    const meta = getToolMetadata(name)
    return meta !== undefined && meta.domain === domain && deriveToolGroup(name, segmentMap) === group
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/settings/tool-grouping.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/tool-grouping.ts tests/debug/settings/tool-grouping.test.ts
git commit -m "feat(settings): tool group derivation for plugin/MCP namespaced names"
```

---

### Task 2: Runtime-accurate tool enumeration in the settings route

The route currently enumerates with the sync builtin-only `buildTools()`; plugin/MCP tools never appear and provider-less contexts get an empty list. Switch to the async runtime assemblers. Two existing tests assert the old (empty) provider-less behavior and must be updated to the new intended behavior — this is the spec'd behavior change, not test gaming.

**Files:**

- Modify: `src/debug/settings/tools-routes.ts:27-41` (the `availableToolNames` function)
- Test: `tests/debug/settings/tools-routes.test.ts`

- [ ] **Step 1: Update the two provider-less tests to the new expected behavior**

In `tests/debug/settings/tools-routes.test.ts`, replace the test `'GET returns three-state domains (empty when no provider configured)'` with:

```typescript
test('GET returns the providerless tool surface when no provider is configured', async () => {
  const url = new URL('https://x/settings/api/tools')
  const res = await handleToolsRoutes(new Request(url, { headers: authHeaders(session) }), url, '/settings/api/tools')
  expect(res.status).toBe(200)
  const body = DomainsResponseSchema.parse(await res.json())
  // Providerless builtins (e.g. get_current_time in the 'time' domain, memos) are now listed.
  const domainNames = body.domains.map((d) => d.domain)
  expect(domainNames).toContain('time')
  expect(domainNames).toContain('memo')
})
```

Replace the test `'toggle sets tool permission to deny for known tool'` (which asserted 422 without a provider) with:

```typescript
test('toggle sets tool permission to deny for a providerless builtin', async () => {
  const url = new URL('https://x/settings/api/tools/toggle')
  const res = await handleToolsRoutes(
    new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'tool', tool: 'get_current_time', permission: 'deny' }),
    }),
    url,
    '/settings/api/tools/toggle',
  )
  expect(res.status).toBe(200)
  const updatedPrefs = getToolPrefs(personalContextId)
  expect(updatedPrefs.toolOverrides['get_current_time']).toBe('deny')
})

test('toggle still rejects a tool not exposed in this context with 422', async () => {
  const url = new URL('https://x/settings/api/tools/toggle')
  const res = await handleToolsRoutes(
    new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      // create_task requires a task provider, which this context does not have
      body: JSON.stringify({ kind: 'tool', tool: 'create_task', permission: 'deny' }),
    }),
    url,
    '/settings/api/tools/toggle',
  )
  expect(res.status).toBe(422)
})
```

- [ ] **Step 2: Run tests to verify the updated ones fail**

Run: `bun test tests/debug/settings/tools-routes.test.ts`
Expected: FAIL — the new providerless-surface test finds no `time`/`memo` domains; the deny-toggle test gets 422 instead of 200. (The untouched tests still pass.)

- [ ] **Step 3: Rewrite `availableToolNames`**

In `src/debug/settings/tools-routes.ts`, change the imports: remove `import { buildTools } from '../../tools/tools-builder.js'` and add:

```typescript
import { buildProviderlessToolDescriptors, buildToolDescriptors, type MakeToolsOptions } from '../../tools/index.js'
```

Replace the whole `availableToolNames` function (lines 27–41) with:

```typescript
/**
 * Computed tool names for a context, mirroring the runtime surface exactly:
 * builtins + user MCP tools + plugin tools + plugin-declared MCP tools, with
 * runtime capability/eligibility/collision rules. MCP connections are pooled
 * and best-effort — a downed server degrades to "tools absent", never an error.
 */
async function availableToolNames(
  contextId: string,
  actorUserId: string,
  contextType: 'dm' | 'group',
): Promise<string[]> {
  const provider = await safeBuildProvider(contextId)
  // NOTE: `chatParticipantResolver` is intentionally omitted here — the settings-UI
  // tool surface has no live ChatRouter-bound resolver available outside a chat turn,
  // so `resolve_chat_participant` is absent from the displayed tool list even when it
  // would be exposed during a real group turn. This is a known display-only discrepancy.
  const options: MakeToolsOptions = {
    storageContextId: contextId,
    chatUserId: actorUserId,
    mode: 'normal',
    contextType,
  }
  const toolset =
    provider === null ? await buildProviderlessToolDescriptors(options) : await buildToolDescriptors(provider, options)
  return Object.keys(toolset).filter((name) => getToolMetadata(name) !== undefined)
}
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `bun test tests/debug/settings/tools-routes.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Run the neighboring suites to catch regressions**

Run: `bun test tests/debug/settings/ tests/tools/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/tools-routes.ts tests/debug/settings/tools-routes.test.ts
git commit -m "feat(settings): enumerate the runtime tool surface (plugins, MCP, providerless) in tools routes"
```

---

### Task 3: `group` field in the domain view + plugin tools listed/togglable end-to-end

**Files:**

- Modify: `src/debug/settings/tools-routes.ts` (the `buildDomainView` function, currently lines 55–67)
- Test: `tests/debug/settings/tools-routes-plugin.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings/tools-routes-plugin.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { handleToolsRoutes } from '../../../src/debug/settings/tools-routes.js'
import { contributionRegistry } from '../../../src/plugins/contributions.js'
import { pluginRegistry, setPluginEnabledForContext } from '../../../src/plugins/registry.js'
import { PLUGIN_API_VERSION, type DiscoveredPlugin } from '../../../src/plugins/types.js'
import { getToolPrefs } from '../../../src/tools/tool-preferences.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const PLATFORM_INSTANCE_ID = 'pi-1'
const USER_ID = 'u-1'
const PLUGIN_ID = 'settings-perm-plugin'
const NAMESPACED_ECHO = 'plugin_settings_perm_plugin__echo_ctx'
const NAMESPACED_PING = 'plugin_settings_perm_plugin__ping'

const ToolEntrySchema = z.object({
  name: z.string(),
  permission: z.enum(['allow', 'ask', 'deny']),
  risk: z.enum(['read', 'write', 'destructive', 'open-world']),
  group: z.string().optional(),
})
const DomainsResponseSchema = z.object({
  contextId: z.string(),
  domains: z.array(
    z.object({
      domain: z.string(),
      summary: z.enum(['allow', 'ask', 'deny', 'partial']),
      tools: z.array(ToolEntrySchema),
    }),
  ),
})

const discoveredPlugin: DiscoveredPlugin = {
  manifest: {
    id: PLUGIN_ID,
    name: 'Settings Perm Plugin',
    version: '1.0.0',
    description: 'Providerless-safe plugin used in settings tools route tests',
    apiVersion: PLUGIN_API_VERSION,
    main: 'index.ts',
    contributes: {
      tools: ['echo_ctx', 'ping'],
      promptFragments: [],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: [],
      attachmentTransformers: [],
    },
    permissions: [],
    defaultEnabled: false,
    activationTimeoutMs: 5000,
    requiredTaskCapabilities: [],
    requiredChatCapabilities: [],
    configRequirements: [],
    providerCapabilities: [],
    providerTraits: [],
    providerConfigSchema: [],
    providerContextConfigSchema: [],
    providerAllowedHosts: [],
  },
  pluginDir: `/tmp/${PLUGIN_ID}`,
  entryPoint: `/tmp/${PLUGIN_ID}/index.ts`,
  manifestHash: `hash-${PLUGIN_ID}`,
}

describe('settings tools routes — plugin tools', () => {
  let session: SettingsSession
  let personalContextId: string

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    pluginRegistry.clearForTesting()
    contributionRegistry.deregister(PLUGIN_ID)
    seedTestPlatformInstance({ id: PLATFORM_INSTANCE_ID })
    addUser({ userId: USER_ID, platformInstanceId: PLATFORM_INSTANCE_ID, addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: PLATFORM_INSTANCE_ID, platformUserId: USER_ID })
    personalContextId = toScopedContextId({ platformInstanceId: PLATFORM_INSTANCE_ID, nativeContextId: USER_ID })

    pluginRegistry.registerDiscovered(discoveredPlugin)
    pluginRegistry.approve(PLUGIN_ID, 'admin', discoveredPlugin.manifestHash)
    pluginRegistry.markActive(PLUGIN_ID)
    setPluginEnabledForContext(PLUGIN_ID, personalContextId, true)
    contributionRegistry.register(
      PLUGIN_ID,
      {
        tools: [
          {
            name: 'echo_ctx',
            description: 'Echo the runtime context',
            execute: (): Promise<unknown> => Promise.resolve('ok'),
          },
          {
            name: 'ping',
            description: 'Ping',
            execute: (): Promise<unknown> => Promise.resolve('pong'),
          },
        ],
        promptFragments: [],
        commands: [],
        jobs: [],
        attachmentTransformers: [],
      },
      discoveredPlugin.manifest,
    )
  })

  afterEach(() => {
    pluginRegistry.clearForTesting()
    contributionRegistry.deregister(PLUGIN_ID)
  })

  async function getDomains(): Promise<z.infer<typeof DomainsResponseSchema>> {
    const url = new URL('https://x/settings/api/tools')
    const res = await handleToolsRoutes(new Request(url, { headers: authHeaders(session) }), url, '/settings/api/tools')
    expect(res.status).toBe(200)
    return DomainsResponseSchema.parse(await res.json())
  }

  test('GET lists plugin tools under the plugin domain with the plugin id as group', async () => {
    const body = await getDomains()
    const pluginDomain = body.domains.find((d) => d.domain === 'plugin')
    expect(pluginDomain).toBeDefined()
    const names = pluginDomain!.tools.map((t) => t.name)
    expect(names).toContain(NAMESPACED_ECHO)
    expect(names).toContain(NAMESPACED_PING)
    for (const tool of pluginDomain!.tools) {
      expect(tool.group).toBe(PLUGIN_ID)
      expect(tool.risk).toBe('open-world')
    }
  })

  test('builtin tools carry no group field', async () => {
    const body = await getDomains()
    const timeDomain = body.domains.find((d) => d.domain === 'time')
    expect(timeDomain).toBeDefined()
    for (const tool of timeDomain!.tools) {
      expect(tool.group).toBeUndefined()
    }
  })

  test('toggle kind:tool on a plugin tool persists an override (no longer 422)', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'tool', tool: NAMESPACED_ECHO, permission: 'deny' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(200)
    const prefs = getToolPrefs(personalContextId)
    expect(prefs.toolOverrides[NAMESPACED_ECHO]).toBe('deny')
  })

  test('toggle kind:tool on a plugin tool from a disabled plugin is 422', async () => {
    setPluginEnabledForContext(PLUGIN_ID, personalContextId, false)
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'tool', tool: NAMESPACED_ECHO, permission: 'deny' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(422)
  })
})
```

- [ ] **Step 2: Run test to verify the group assertions fail**

Run: `bun test tests/debug/settings/tools-routes-plugin.test.ts`
Expected: FAIL — the plugin tools are listed (Task 2) and the per-tool toggle passes, but `tool.group` is `undefined` in the first test.

- [ ] **Step 3: Add the `group` field to `buildDomainView`**

In `src/debug/settings/tools-routes.ts`, add the import:

```typescript
import { activePluginSegmentMap, deriveToolGroup } from './tool-grouping.js'
```

Replace the `buildDomainView` function with:

```typescript
export function buildDomainView(names: readonly string[], prefs: ToolPrefs): unknown[] {
  const grouped = groupByDomain(names)
  const segmentMap = activePluginSegmentMap()
  return [...grouped.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([domain, domainTools]) => ({
      domain,
      summary: getDomainSummary(prefs, domain, domainTools),
      tools: [...domainTools].toSorted().map((name) => {
        const meta = getToolMetadata(name)
        const group = deriveToolGroup(name, segmentMap)
        return {
          name,
          permission: resolveToolPermission(prefs, name),
          risk: meta?.risk ?? 'read',
          ...(group === undefined ? {} : { group }),
        }
      }),
    }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/debug/settings/tools-routes-plugin.test.ts tests/debug/settings/tools-routes.test.ts tests/debug/settings/admin/tool-defaults-routes.test.ts`
Expected: PASS (the admin suite also consumes `buildDomainView`; its loose `z.unknown()` domains schema tolerates the extra field)

- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/tools-routes.ts tests/debug/settings/tools-routes-plugin.test.ts
git commit -m "feat(settings): per-plugin group field on tool entries; plugin tools togglable"
```

---

### Task 4: `kind: 'group'` bulk toggle + MCP tools end-to-end

**Files:**

- Modify: `src/debug/settings/tools-routes.ts` (the `ToggleBodySchema` and `handleToggle`)
- Test: `tests/debug/settings/tools-routes-mcp.test.ts` (new file), additions to `tests/debug/settings/tools-routes-plugin.test.ts`

- [ ] **Step 1: Write the failing group-toggle tests (plugin side)**

Append inside the `describe` block of `tests/debug/settings/tools-routes-plugin.test.ts`:

```typescript
test('toggle kind:group sets overrides for every tool of the plugin', async () => {
  const url = new URL('https://x/settings/api/tools/toggle')
  const res = await handleToolsRoutes(
    new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'group', domain: 'plugin', group: PLUGIN_ID, permission: 'ask' }),
    }),
    url,
    '/settings/api/tools/toggle',
  )
  expect(res.status).toBe(200)
  const prefs = getToolPrefs(personalContextId)
  expect(prefs.toolOverrides[NAMESPACED_ECHO]).toBe('ask')
  expect(prefs.toolOverrides[NAMESPACED_PING]).toBe('ask')
})

test('toggle kind:group with an unknown group is 422', async () => {
  const url = new URL('https://x/settings/api/tools/toggle')
  const res = await handleToolsRoutes(
    new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'group', domain: 'plugin', group: 'no-such-plugin', permission: 'ask' }),
    }),
    url,
    '/settings/api/tools/toggle',
  )
  expect(res.status).toBe(422)
})

test('toggle kind:group with an unknown domain is 422', async () => {
  const url = new URL('https://x/settings/api/tools/toggle')
  const res = await handleToolsRoutes(
    new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'group', domain: 'not-a-domain', group: PLUGIN_ID, permission: 'ask' }),
    }),
    url,
    '/settings/api/tools/toggle',
  )
  expect(res.status).toBe(422)
})
```

- [ ] **Step 2: Write the failing MCP test file**

MCP tool listing requires a live server at build time, so this suite mocks the `src/mcp/index.js` module boundary (the established pattern from `tests/tools/mcp-integration.test.ts`). It lives in its own file so the `mock.module` stays isolated to one test worker.

Create `tests/debug/settings/tools-routes-mcp.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ToolSet } from 'ai'
import { jsonSchema } from 'ai'
import { z } from 'zod'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { getToolPrefs } from '../../../src/tools/tool-preferences.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const PLATFORM_INSTANCE_ID = 'pi-1'
const USER_ID = 'u-1'
const MCP_TOOL = 'mcp_search-server__fetch_page'

const buildMcpToolSetSpy = mock((_contextId: string): Promise<ToolSet> => Promise.resolve({}))
const buildPluginMcpToolSetSpy = mock(
  (_ids: string[], _desc: unknown, _pool: unknown): Promise<ToolSet> => Promise.resolve({}),
)

// The tools assembler imports { adaptMcpPool, buildMcpToolSet, buildPluginMcpToolSet }
// from src/mcp/index.js — all three must be provided by the mock.
void mock.module('../../../src/mcp/index.js', () => ({
  buildMcpToolSet: buildMcpToolSetSpy,
  buildPluginMcpToolSet: buildPluginMcpToolSetSpy,
  adaptMcpPool: mock(() => ({})),
}))

const { handleToolsRoutes } = await import('../../../src/debug/settings/tools-routes.js')

const DomainsResponseSchema = z.object({
  contextId: z.string(),
  domains: z.array(
    z.object({
      domain: z.string(),
      summary: z.string(),
      tools: z.array(z.object({ name: z.string(), permission: z.string(), group: z.string().optional() })),
    }),
  ),
})

describe('settings tools routes — MCP tools', () => {
  let session: SettingsSession
  let personalContextId: string

  beforeEach(async () => {
    mockLogger()
    void mock.module('../../../src/mcp/index.js', () => ({
      buildMcpToolSet: buildMcpToolSetSpy,
      buildPluginMcpToolSet: buildPluginMcpToolSetSpy,
      adaptMcpPool: mock(() => ({})),
    }))
    await setupTestDb()
    seedTestPlatformInstance({ id: PLATFORM_INSTANCE_ID })
    addUser({ userId: USER_ID, platformInstanceId: PLATFORM_INSTANCE_ID, addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: PLATFORM_INSTANCE_ID, platformUserId: USER_ID })
    personalContextId = toScopedContextId({ platformInstanceId: PLATFORM_INSTANCE_ID, nativeContextId: USER_ID })
    buildMcpToolSetSpy.mockClear()
    buildMcpToolSetSpy.mockResolvedValue({
      [MCP_TOOL]: {
        description: 'Fetch a page via MCP',
        inputSchema: jsonSchema({ type: 'object' as const, properties: {} }),
        execute: () => Promise.resolve('result'),
      },
    })
  })

  test('GET lists MCP tools under the mcp domain with the server id as group', async () => {
    const url = new URL('https://x/settings/api/tools')
    const res = await handleToolsRoutes(new Request(url, { headers: authHeaders(session) }), url, '/settings/api/tools')
    expect(res.status).toBe(200)
    const body = DomainsResponseSchema.parse(await res.json())
    const mcpDomain = body.domains.find((d) => d.domain === 'mcp')
    expect(mcpDomain).toBeDefined()
    expect(mcpDomain!.tools.map((t) => t.name)).toContain(MCP_TOOL)
    expect(mcpDomain!.tools[0]!.group).toBe('search-server')
  })

  test('toggle kind:tool on an MCP tool persists an override', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'tool', tool: MCP_TOOL, permission: 'ask' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(200)
    expect(getToolPrefs(personalContextId).toolOverrides[MCP_TOOL]).toBe('ask')
  })

  test('toggle kind:group on an MCP server group persists overrides', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'group', domain: 'mcp', group: 'search-server', permission: 'deny' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(200)
    expect(getToolPrefs(personalContextId).toolOverrides[MCP_TOOL]).toBe('deny')
  })

  test('MCP build failure degrades to no MCP tools without erroring the route', async () => {
    buildMcpToolSetSpy.mockRejectedValueOnce(new Error('MCP connection failed'))
    const url = new URL('https://x/settings/api/tools')
    const res = await handleToolsRoutes(new Request(url, { headers: authHeaders(session) }), url, '/settings/api/tools')
    expect(res.status).toBe(200)
    const body = DomainsResponseSchema.parse(await res.json())
    expect(body.domains.find((d) => d.domain === 'mcp')).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run tests to verify the group-toggle tests fail**

Run: `bun test tests/debug/settings/tools-routes-plugin.test.ts tests/debug/settings/tools-routes-mcp.test.ts`
Expected: FAIL — `kind: 'group'` bodies are rejected with 422 (schema), while the MCP GET/tool-toggle tests already pass from Task 2/3.

- [ ] **Step 4: Add the group variant to the toggle schema and handler**

In `src/debug/settings/tools-routes.ts`, extend the import from `./tool-grouping.js`:

```typescript
import { activePluginSegmentMap, deriveToolGroup, resolveGroupTools } from './tool-grouping.js'
```

Add a new member to `ToggleBodySchema`'s `discriminatedUnion` array (after the `'tool'` member):

```typescript
  z.object({
    kind: z.literal('group'),
    permission: z.enum(['allow', 'ask', 'deny']),
    domain: z.string(),
    group: z.string(),
    contextId: z.string().optional(),
  }),
```

In `handleToggle`, add a branch after the `body.data.kind === 'tool'` branch (before the final `else` that handles presets):

```typescript
  } else if (body.data.kind === 'group') {
    const domain = body.data.domain
    if (!isToolDomain(domain)) return settingsJson(422, { error: 'unknown tool domain' })
    const groupTools = resolveGroupTools(names, domain, body.data.group)
    if (groupTools.length === 0) return settingsJson(422, { error: 'unknown tool group' })
    let next = prefs
    for (const name of groupTools) next = setToolPermission(next, name, body.data.permission)
    setToolPrefs(scope.scope.contextId, next)
    log.info(
      {
        contextId: scope.scope.contextId,
        domain,
        group: body.data.group,
        tools: groupTools.length,
        permission: body.data.permission,
      },
      'Settings tool group permission set',
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/debug/settings/`
Expected: PASS (all settings route suites)

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/tools-routes.ts tests/debug/settings/tools-routes-plugin.test.ts tests/debug/settings/tools-routes-mcp.test.ts
git commit -m "feat(settings): kind:group bulk toggle; MCP tools listed and togglable"
```

---

### Task 5: Admin defaults — dynamic catalog with native plugin tools + group kind

**Files:**

- Modify: `src/debug/settings/admin/tool-defaults-routes.ts`
- Test: `tests/debug/settings/admin/tool-defaults-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe` block of `tests/debug/settings/admin/tool-defaults-routes.test.ts`. Add these imports at the top of the file:

```typescript
import { contributionRegistry } from '../../../../src/plugins/contributions.js'
import { pluginRegistry } from '../../../../src/plugins/registry.js'
import { PLUGIN_API_VERSION, type DiscoveredPlugin } from '../../../../src/plugins/types.js'
```

Add this fixture above the `describe` block:

```typescript
const ADMIN_PLUGIN_ID = 'admin-catalog-plugin'
const ADMIN_PLUGIN_TOOL = 'plugin_admin_catalog_plugin__do_thing'

const adminCatalogPlugin: DiscoveredPlugin = {
  manifest: {
    id: ADMIN_PLUGIN_ID,
    name: 'Admin Catalog Plugin',
    version: '1.0.0',
    description: 'Plugin used in admin tool-defaults catalog tests',
    apiVersion: PLUGIN_API_VERSION,
    main: 'index.ts',
    contributes: {
      tools: ['do_thing'],
      promptFragments: [],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: [],
      attachmentTransformers: [],
    },
    permissions: [],
    defaultEnabled: false,
    activationTimeoutMs: 5000,
    requiredTaskCapabilities: [],
    requiredChatCapabilities: [],
    configRequirements: [],
    providerCapabilities: [],
    providerTraits: [],
    providerConfigSchema: [],
    providerContextConfigSchema: [],
    providerAllowedHosts: [],
  },
  pluginDir: `/tmp/${ADMIN_PLUGIN_ID}`,
  entryPoint: `/tmp/${ADMIN_PLUGIN_ID}/index.ts`,
  manifestHash: `hash-${ADMIN_PLUGIN_ID}`,
}

function registerAdminCatalogPlugin(): void {
  pluginRegistry.registerDiscovered(adminCatalogPlugin)
  pluginRegistry.markActive(ADMIN_PLUGIN_ID)
  contributionRegistry.register(
    ADMIN_PLUGIN_ID,
    {
      tools: [
        { name: 'do_thing', description: 'Do the thing', execute: (): Promise<unknown> => Promise.resolve('ok') },
      ],
      promptFragments: [],
      commands: [],
      jobs: [],
      attachmentTransformers: [],
    },
    adminCatalogPlugin.manifest,
  )
}
```

In the existing `beforeEach`, add as the first lines after `await setupTestDb()`:

```typescript
pluginRegistry.clearForTesting()
contributionRegistry.deregister(ADMIN_PLUGIN_ID)
```

Add an `afterEach` (import `afterEach` from `bun:test`):

```typescript
afterEach(() => {
  pluginRegistry.clearForTesting()
  contributionRegistry.deregister(ADMIN_PLUGIN_ID)
})
```

Add these tests:

```typescript
test('GET catalog includes native tool names of active plugins', async () => {
  registerAdminCatalogPlugin()
  const url = new URL('https://x/settings/api/admin/tool-defaults')
  const res = await handleAdminToolDefaultsRoutes(
    new Request(url, { headers: authHeaders(adminSession) }),
    url,
    '/settings/api/admin/tool-defaults',
  )
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    domains: Array<{ domain: string; tools: Array<{ name: string; group?: string }> }>
  }
  const pluginDomain = body.domains.find((d) => d.domain === 'plugin')
  expect(pluginDomain).toBeDefined()
  expect(pluginDomain!.tools.map((t) => t.name)).toContain(ADMIN_PLUGIN_TOOL)
  expect(pluginDomain!.tools[0]!.group).toBe(ADMIN_PLUGIN_ID)
})

test('POST kind:group sets overrides for the plugin group in the admin defaults context', async () => {
  registerAdminCatalogPlugin()
  const url = new URL('https://x/settings/api/admin/tool-defaults')
  const res = await handleAdminToolDefaultsRoutes(
    new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'group', domain: 'plugin', group: ADMIN_PLUGIN_ID, permission: 'ask' }),
    }),
    url,
    '/settings/api/admin/tool-defaults',
  )
  expect(res.status).toBe(200)
  const prefs = getToolPrefs(adminToolDefaultsContextId('pi-1'))
  expect(prefs.toolOverrides[ADMIN_PLUGIN_TOOL]).toBe('ask')
})

test('POST kind:group with an unknown group is 422', async () => {
  const url = new URL('https://x/settings/api/admin/tool-defaults')
  const res = await handleAdminToolDefaultsRoutes(
    new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'group', domain: 'plugin', group: 'no-such-plugin', permission: 'ask' }),
    }),
    url,
    '/settings/api/admin/tool-defaults',
  )
  expect(res.status).toBe(422)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/debug/settings/admin/tool-defaults-routes.test.ts`
Expected: FAIL — catalog contains no plugin names; `kind: 'group'` is rejected with 422 (schema).

- [ ] **Step 3: Implement the dynamic catalog and group kind**

In `src/debug/settings/admin/tool-defaults-routes.ts`:

Add imports:

```typescript
import { namespacedToolName } from '../../../plugins/contribution-names.js'
import { contributionRegistry } from '../../../plugins/contributions.js'
import { resolveGroupTools } from '../tool-grouping.js'
```

Replace `const CATALOG_NAMES: readonly string[] = Object.keys(TOOL_METADATA)` with:

```typescript
/**
 * Catalog: static builtin metadata keys + native tool names of all active
 * plugins (context-agnostic — admin defaults have no live context to gate
 * against). MCP-sourced names are inherently not enumerable here: they
 * require per-context config and credentials; admin defaults govern them via
 * the mcp/plugin domain rows and the open-world risk tier.
 */
function catalogNames(): string[] {
  const names = new Set<string>(Object.keys(TOOL_METADATA))
  for (const pluginId of contributionRegistry.getActivePluginIds()) {
    const contributions = contributionRegistry.getContributions(pluginId)
    if (contributions === undefined) continue
    for (const pluginTool of contributions.tools) names.add(namespacedToolName(pluginId, pluginTool.name))
  }
  return [...names]
}
```

In `view()`, change `buildDomainView(CATALOG_NAMES, prefs)` to `buildDomainView(catalogNames(), prefs)`.

Add a new member to `ToggleBodySchema`'s `discriminatedUnion` array (after the `'tool'` member):

```typescript
  z.object({
    kind: z.literal('group'),
    permission: z.enum(['allow', 'ask', 'deny']),
    domain: z.string(),
    group: z.string(),
  }),
```

In `handlePost`, add a branch after the `body.data.kind === 'tool'` branch (before the final `else`):

```typescript
  } else if (body.data.kind === 'group') {
    if (!isToolDomain(body.data.domain)) return settingsJson(422, { error: 'unknown tool domain' })
    const groupTools = resolveGroupTools(catalogNames(), body.data.domain, body.data.group)
    if (groupTools.length === 0) return settingsJson(422, { error: 'unknown tool group' })
    let next = prefs
    for (const name of groupTools) next = setToolPermission(next, name, body.data.permission)
    setToolPrefs(ctx, next)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/debug/settings/admin/tool-defaults-routes.test.ts tests/debug/settings/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/admin/tool-defaults-routes.ts tests/debug/settings/admin/tool-defaults-routes.test.ts
git commit -m "feat(settings): admin tool-defaults catalog includes native plugin tools; group kind"
```

---

### Task 6: Client schema, fetchers, and grouping lib

**Files:**

- Modify: `client/settings/fetcher-schemas-tools.ts` (`ToolEntrySchema`)
- Modify: `client/settings/fetchers.ts:145-149` (`setToolPermission` input union)
- Modify: `client/settings/admin-fetchers.ts:203-209` (`setToolDefault` input union)
- Create: `client/settings/lib/group-tools.ts`
- Test: `tests/client/settings/fetcher-schemas-tools.test.ts`, `tests/client/settings/group-tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/client/settings/fetcher-schemas-tools.test.ts` (inside the `ToolsResponseSchema` describe):

```typescript
test('parses an optional group field on tool entries', () => {
  const parsed = ToolsResponseSchema.parse({
    contextId: 'user:1',
    domains: [
      {
        domain: 'plugin',
        summary: 'allow',
        tools: [
          { name: 'plugin_acp__start_session', permission: 'allow', risk: 'open-world', group: 'acp' },
          { name: 'get_current_time', permission: 'allow', risk: 'read' },
        ],
      },
    ],
  })
  expect(parsed.domains[0]!.tools[0]!.group).toBe('acp')
  expect(parsed.domains[0]!.tools[1]!.group).toBeUndefined()
})
```

Create `tests/client/settings/group-tools.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ToolEntry } from '../../../client/settings/fetcher-schemas-tools.js'
import { groupSummary, groupToolEntries } from '../../../client/settings/lib/group-tools.js'

const entry = (name: string, permission: ToolEntry['permission'], group?: string): ToolEntry => ({
  name,
  permission,
  risk: 'open-world',
  ...(group === undefined ? {} : { group }),
})

describe('groupToolEntries', () => {
  test('puts ungrouped tools first, then groups sorted by label', () => {
    const groups = groupToolEntries([
      entry('plugin_b__t', 'allow', 'b-plugin'),
      entry('get_current_time', 'allow'),
      entry('plugin_a__t', 'allow', 'a-plugin'),
      entry('plugin_a__u', 'ask', 'a-plugin'),
    ])
    expect(groups.map((g) => g.group)).toEqual([null, 'a-plugin', 'b-plugin'])
    expect(groups[1]!.tools.map((t) => t.name)).toEqual(['plugin_a__t', 'plugin_a__u'])
  })

  test('omits the ungrouped bucket when every tool has a group', () => {
    const groups = groupToolEntries([entry('plugin_a__t', 'allow', 'a-plugin')])
    expect(groups.map((g) => g.group)).toEqual(['a-plugin'])
  })

  test('returns a single ungrouped bucket for builtin-only domains', () => {
    const groups = groupToolEntries([entry('get_current_time', 'allow')])
    expect(groups.map((g) => g.group)).toEqual([null])
  })
})

describe('groupSummary', () => {
  test('returns the shared permission when uniform', () => {
    expect(groupSummary([entry('a', 'ask', 'g'), entry('b', 'ask', 'g')])).toBe('ask')
  })

  test('returns partial when permissions diverge', () => {
    expect(groupSummary([entry('a', 'allow', 'g'), entry('b', 'deny', 'g')])).toBe('partial')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test:client`
Expected: FAIL — `group` is stripped by the schema (first test) and `client/settings/lib/group-tools.js` does not exist.

- [ ] **Step 3: Implement**

In `client/settings/fetcher-schemas-tools.ts`, replace the `ToolEntrySchema` line with:

```typescript
export const ToolEntrySchema = z.object({
  name: z.string(),
  permission: ToolPermissionSchema,
  risk: ToolRiskSchema,
  group: z.string().optional(),
})
```

In `client/settings/fetchers.ts`, replace the `setToolPermission` declaration with:

```typescript
export const setToolPermission = (
  input:
    | { kind: 'domain'; domain: string; permission: 'allow' | 'ask' | 'deny'; contextId: string }
    | { kind: 'tool'; tool: string; permission: 'allow' | 'ask' | 'deny'; contextId: string }
    | { kind: 'group'; domain: string; group: string; permission: 'allow' | 'ask' | 'deny'; contextId: string },
): Promise<ToolsResponse> => writeJson('/settings/api/tools/toggle', 'POST', input, (b) => ToolsResponseSchema.parse(b))
```

In `client/settings/admin-fetchers.ts`, replace the `setToolDefault` declaration with:

```typescript
export const setToolDefault = (
  input:
    | { kind: 'domain'; domain: string; permission: 'allow' | 'ask' | 'deny'; contextId: string }
    | { kind: 'tool'; tool: string; permission: 'allow' | 'ask' | 'deny'; contextId: string }
    | { kind: 'group'; domain: string; group: string; permission: 'allow' | 'ask' | 'deny'; contextId: string },
): Promise<ToolsResponse> =>
  writeJson('/settings/api/admin/tool-defaults', 'POST', input, (b) => ToolsResponseSchema.parse(b))
```

(The admin route's Zod schema strips the client's dummy `contextId` — same as the existing `domain`/`tool` kinds.)

Create `client/settings/lib/group-tools.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolDomainSummary, ToolEntry } from '../fetcher-schemas-tools.js'

export type ToolGroup = { group: string | null; tools: ToolEntry[] }

/** Split a domain's tools into an ungrouped bucket (first, when non-empty) plus per-group buckets sorted by label. */
export function groupToolEntries(tools: readonly ToolEntry[]): ToolGroup[] {
  const ungrouped: ToolEntry[] = []
  const grouped = new Map<string, ToolEntry[]>()
  for (const tool of tools) {
    if (tool.group === undefined) {
      ungrouped.push(tool)
      continue
    }
    const list = grouped.get(tool.group)
    if (list === undefined) grouped.set(tool.group, [tool])
    else list.push(tool)
  }
  const groups: ToolGroup[] = [...grouped.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([group, groupTools]) => ({ group, tools: groupTools }))
  return ungrouped.length > 0 ? [{ group: null, tools: ungrouped }, ...groups] : groups
}

/** Uniform permission of a group's tools, or 'partial' when they diverge. */
export function groupSummary(tools: readonly ToolEntry[]): ToolDomainSummary {
  const set = new Set(tools.map((tool) => tool.permission))
  const only = [...set][0]
  if (set.size === 1 && only !== undefined) return only
  return 'partial'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test:client && bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/settings/fetcher-schemas-tools.ts client/settings/fetchers.ts client/settings/admin-fetchers.ts client/settings/lib/group-tools.ts tests/client/settings/fetcher-schemas-tools.test.ts tests/client/settings/group-tools.test.ts
git commit -m "feat(settings-client): tool group field, group toggle fetchers, grouping lib"
```

---

### Task 7: ToolsSection UI — sub-groups with bulk buttons + story

No component test exists for `ToolsSection` (coverage is stories + the lib tests from Task 6); follow that local pattern.

**Files:**

- Modify: `client/settings/sections/ToolsSection.svelte`
- Modify: `client/settings/sections/ToolsSection.stories.svelte`

- [ ] **Step 1: Add the group handler and imports to the script block**

In `client/settings/sections/ToolsSection.svelte`, add to the imports:

```typescript
import { groupSummary, groupToolEntries } from '../lib/group-tools.js'
```

Add this handler next to `onSetDomainPermission`:

```typescript
async function onSetGroupPermission(domain: string, group: string, summary: ToolDomainSummary): Promise<void> {
  error = null
  const permission = nextDomainPermission(summary)
  try {
    const res = await setToolPermissionFn({ kind: 'group', domain, group, permission, contextId })
    domains = res.domains
    activePreset = res.activePreset
    storedDefaults = res.hasStoredDefaults
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }
}
```

(`setToolPermissionFn`'s prop type is `Parameters<typeof setToolPermission>[0]`, so the new union member from Task 6 flows through automatically.)

- [ ] **Step 2: Replace the flat tool list markup with grouped rendering**

Replace the expanded-domain block

```svelte
          {#if expanded[domain.domain]}
            <ul class="settings-tools__list">
              {#each domain.tools as tool (tool.name)}
                ...existing <li class="settings-tools__tool">...
              {/each}
            </ul>
          {/if}
```

with:

```svelte
          {#if expanded[domain.domain]}
            <ul class="settings-tools__list">
              {#each groupToolEntries(domain.tools) as toolGroup (toolGroup.group ?? '')}
                {#if toolGroup.group !== null}
                  {@const summary = groupSummary(toolGroup.tools)}
                  <li class="settings-tools__group-head" data-testid={`group-head-${toolGroup.group}`}>
                    <span class="settings-tools__group-name">{toolGroup.group}</span>
                    <Pill tone={summaryTone(summary)}>{#snippet children()}{summary}{/snippet}</Pill>
                    <span class="settings-tools__group-toggle">
                      <Btn
                        variant="ghost"
                        size="sm"
                        testid={`group-toggle-${toolGroup.group}`}
                        onClick={() => void onSetGroupPermission(domain.domain, toolGroup.group!, summary)}>
                        {#snippet children()}{summary === 'deny' ? 'Allow all' : summary === 'ask' ? 'Deny all' : summary === 'allow' ? 'Ask all' : 'Allow all'}{/snippet}
                      </Btn>
                    </span>
                  </li>
                {/if}
                {#each toolGroup.tools as tool (tool.name)}
                  <li class="settings-tools__tool" class:settings-tools__tool--grouped={toolGroup.group !== null}>
                    <span class="settings-tools__name">{tool.name}</span>
                    <Pill tone={riskTone(tool.risk)}>{#snippet children()}{tool.risk}{/snippet}</Pill>
                    <div class="settings-tools__perm">
                      <SegmentedControl
                        options={PERM_OPTIONS}
                        value={tool.permission}
                        ariaLabel={`Permission for ${tool.name}`}
                        onChange={(p) => void onSetToolPermission(tool.name, p as ToolPermission)}
                        testidPrefix={`tool-perm-${tool.name}`} />
                    </div>
                  </li>
                {/each}
              {/each}
            </ul>
          {/if}
```

Add to the `<style>` block:

```css
.settings-tools__group-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}
.settings-tools__group-name {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg2);
}
.settings-tools__group-toggle {
  margin-left: auto;
}
.settings-tools__tool--grouped {
  padding-left: 14px;
}
```

- [ ] **Step 3: Add a grouped story**

In `client/settings/sections/ToolsSection.stories.svelte`, add to the module script after `presetResponse`:

```typescript
const grouped: ToolsResponse = {
  contextId: CONTEXT_ID,
  activePreset: null,
  hasStoredDefaults: false,
  domains: [
    {
      domain: 'plugin',
      summary: 'partial',
      tools: [
        { name: 'plugin_acp__start_session', permission: 'ask', risk: 'open-world', group: 'acp' },
        { name: 'plugin_acp__list_sessions', permission: 'allow', risk: 'open-world', group: 'acp' },
        {
          name: 'plugin_audio_transcribe__transcribe',
          permission: 'allow',
          risk: 'open-world',
          group: 'audio-transcribe',
        },
      ],
    },
    {
      domain: 'mcp',
      summary: 'ask',
      tools: [{ name: 'mcp_search-server__fetch_page', permission: 'ask', risk: 'open-world', group: 'search-server' }],
    },
    {
      domain: 'time',
      summary: 'allow',
      tools: [{ name: 'get_current_time', permission: 'allow', risk: 'read' }],
    },
  ],
}
const fetchGrouped = (): Promise<ToolsResponse> => Promise.resolve(grouped)
```

Add alongside the existing stories:

```svelte
<Story name="Grouped" args={{ contextId: CONTEXT_ID, fetchToolsFn: fetchGrouped }} />
```

- [ ] **Step 4: Verify visually via the screenshot pipeline**

Per `docs/architecture/storybook-screenshots.md`: start Storybook (`bun storybook`, keep it running), then:

```bash
bun shoot:gen
bun shoot -g ToolsSection
```

Read the produced ToolsSection PNGs (the shoot output lists their paths) and confirm: group headers render inside expanded `plugin`/`mcp` domains with a summary pill and bulk button; grouped tools are indented; the `time` domain renders flat with no group header.

- [ ] **Step 5: Run checks and commit**

Run: `bun test:client && bun run typecheck && bun run lint`
Expected: PASS

```bash
git add client/settings/sections/ToolsSection.svelte client/settings/sections/ToolsSection.stories.svelte
git commit -m "feat(settings-client): per-plugin/per-server sub-groups with bulk toggles in ToolsSection"
```

(If `bun shoot` regenerated snapshot files under version control, include them in the commit.)

---

### Task 8: Documentation + full check

**Files:**

- Modify: `docs/architecture/tools.md`
- Modify: `docs/architecture/plugins.md`

- [ ] **Step 1: Update `docs/architecture/tools.md`**

In the paragraph starting `**Admin default tool permissions**`, replace the final sentence

> MCP/plugin tools are covered by the `open-world` risk tier via presets.

with:

> The admin catalog lists builtins plus native tool names of all active plugins; MCP-sourced tool names are not enumerable context-agnostically (they need per-context config/credentials), so admin defaults govern them via the `mcp`/`plugin` domain rows and the `open-world` risk tier.

In the paragraph starting `The system prompt`, replace the sentence

> MCP-sourced tools (`mcp_<server>__<tool>` for user endpoints, `plugin_<server>__<tool>` for plugin-sourced) are subject to the same per-context permissions.

with:

> MCP-sourced tools (`mcp_<server>__<tool>` for user endpoints, `plugin_<server>__<tool>` for plugin-sourced) are subject to the same per-context permissions, and the settings Tools section lists them individually: the route enumerates the exact runtime surface (async `buildToolDescriptors`/`buildProviderlessToolDescriptors`, so provider-less contexts see their providerless surface and a downed MCP server temporarily drops its tools from the list), groups plugin/MCP entries per plugin id / server id via a derived `group` field, and supports per-group bulk toggles (`kind: 'group'`, written as per-tool overrides).

- [ ] **Step 2: Update `docs/architecture/plugins.md`**

In the `**Admin**` bullet, append the sentence:

> Plugin tools (native and MCP-declared) also appear individually in the settings Tools section per context, grouped per plugin, with `allow`/`ask`/`deny` editable per tool or per group.

- [ ] **Step 3: Run the full check suite**

Run: `bun check:full`
Expected: all checks pass. Fix anything that fails before committing.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/tools.md docs/architecture/plugins.md
git commit -m "docs(tools): document plugin/MCP tool permission editing in the settings UI"
```

---

## Verification checklist (post-implementation)

- Settings Tools section of a context with an enabled plugin shows a `plugin` domain with per-plugin sub-groups; each tool has a working allow/ask/deny segmented control.
- Setting a plugin tool to `deny` removes it from the next LLM turn's toolset; `ask` gates it (existing runtime behavior, now reachable from the UI).
- A context with configured MCP endpoints shows an `mcp` domain grouped per server.
- A context with no task instance shows the providerless tool surface instead of an empty section.
- Admin "Default tool permissions" lists native plugin tools and accepts per-tool/per-group toggles on them.
