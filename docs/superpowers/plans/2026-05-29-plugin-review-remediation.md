<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the confirmed high- and medium-severity plugin review defects so approval, activation, config UX, validation, and runtime behavior all follow the same actual plugin contract.

**Architecture:** Keep the plugin MVP shape intact and make the smallest coherent fixes around its existing boundaries. Discovery owns approval hashing and MCP-only shape validation, the loader owns activation commit semantics and manifest-owned validator exports, `/config` and eligibility share one config-resolution model, and tool preferences gain a coarse plugin-tool domain instead of bespoke UI.

**Tech Stack:** Bun test runner (`bun:test`), TypeScript strict mode, SQLite/Drizzle-backed plugin/config stores, Zod v4, existing debug instance routes, existing plugin registry and loader modules.

---

## File Structure

- Modify: `src/plugins/discovery.ts`
  - Responsibility: plugin discovery, approval hashing, entrypoint handling.
  - Changes: hash imported local files, reject unresolved local dynamic imports, support explicit MCP-only manifests without reading `index.ts`.
- Modify: `src/plugins/types.ts`
  - Responsibility: manifest schema and plugin types.
  - Changes: make manifest schemas strict, tighten semver regex, validate MCP-only shape, validate `contributes.configKeys` against `configRequirements`, remove manifest/runtime drift around `providerConfigValidator`.
- Modify: `src/plugins/loader.ts`
  - Responsibility: import plugin modules, activate plugins, publish contributions.
  - Changes: introduce staged activation commit semantics, resolve manifest-owned provider config validator exports, fail activation on duplicate contributed provider type.
- Modify: `src/plugins/context.ts`
  - Responsibility: activation-time plugin context and registration facade.
  - Changes: stage provider-type registrations instead of mutating global registry immediately; remove ad hoc validator argument from plugin-facing provider registration.
- Modify: `src/plugins/runtime-types.ts`
  - Responsibility: runtime tool context contract.
  - Changes: add live admin-config accessor for tool execution.
- Modify: `src/plugins/tool-runtime.ts`
  - Responsibility: runtime context construction for plugin tools.
  - Changes: expose live admin-config accessor through runtime context.
- Modify: `src/plugins/registry-context-eligibility.ts`
  - Responsibility: per-context eligibility and missing-config detection.
  - Changes: centralize required-config resolution by scope for shared use.
- Modify: `src/chat/plugin-interaction-handler.ts`
  - Responsibility: `/config` plugin enable/disable interactions.
  - Changes: reuse shared missing-config resolver so admin keys read from admin store.
- Modify: `src/commands/config.ts`
  - Responsibility: render `/config` output and buttons.
  - Changes: render plugin-owned context config fields in the editable field list instead of just showing requirement text, and reuse shared missing-config resolution for status rendering.
- Modify: `src/config-keys.ts`
  - Responsibility: config field generation for `/config`.
  - Changes: merge plugin-owned context-editable fields into the existing field pipeline.
- Modify: `src/types/config.ts`
  - Responsibility: shared config field typing.
  - Changes: widen `ConfigField.kind` so plugin-owned context fields can flow through the existing config editor safely.
- Modify: `src/config.ts`
  - Responsibility: config read/write helpers.
  - Changes: no schema change expected, but the plan uses the existing namespaced plugin config helpers from this file when wiring `/config` editing.
- Modify: `src/config-editor/handlers.ts`
  - Responsibility: config edit write path.
  - Changes: persist plugin-owned context config edits through `setPluginConfig(...)` when the selected field is plugin-owned.
- Modify: `src/config-editor/validation.ts`
  - Responsibility: input validation for `/config` field writes.
  - Changes: ensure plugin-owned config fields reuse the existing field validation path.
- Modify: `src/debug/instance-config-validation.ts`
  - Responsibility: task-instance config validation before persist.
  - Changes: invoke contributed provider validator resolved from the manifest export.
- Modify: `src/plugins/provider-runtime.ts`
  - Responsibility: plugin outbound HTTP runtime.
  - Changes: reject `http:` URLs and redirects.
- Modify: `src/tools/tool-metadata.ts`
  - Responsibility: tool classification for preferences.
  - Changes: classify `plugin_` names into a new `plugin` domain.
- Modify: `tests/plugins/discovery.test.ts`
  - Responsibility: discovery and hash coverage tests.
  - Changes: add imported-file hashing, dynamic import rejection, and MCP-only acceptance coverage.
- Modify: `tests/plugins/manifest-schema.test.ts`
  - Responsibility: manifest schema behavior.
  - Changes: add strict-object, semver, MCP-only, and `configKeys`/`configRequirements` cross-validation tests.
- Modify: `tests/plugins/loader.test.ts`
  - Responsibility: activation and lifecycle semantics.
  - Changes: add staged timeout behavior, late-registration rejection, validator-export resolution, and duplicate contributed-type activation failure coverage.
- Modify: `tests/plugins/context.test.ts`
  - Responsibility: activation-time plugin context contract.
  - Changes: update provider registration API expectations to match manifest-owned validators and staged registration.
- Modify: `tests/plugins/tool-runtime.test.ts`
  - Responsibility: plugin tool runtime context.
  - Changes: add live admin-config accessor tests.
- Modify: `tests/plugins/registry-context-eligibility.test.ts`
  - Responsibility: missing-config resolution.
  - Changes: cover shared admin/context missing-key behavior.
- Modify: `tests/chat/plugin-interaction-handler.test.ts`
  - Responsibility: `/config` plugin toggle interactions.
  - Changes: verify admin-scoped required keys are satisfied from admin storage.
- Modify: `tests/commands/config.test.ts`
  - Responsibility: `/config` rendering and button behavior.
  - Changes: verify plugin-owned context fields become editable fields and still render masked values.
- Modify: `tests/debug/instance-routes.test.ts`
  - Responsibility: task-instance route validation.
  - Changes: verify manifest-owned provider config validator blocks invalid task-instance writes.
- Modify: `tests/plugins/provider-runtime.test.ts`
  - Responsibility: plugin runtime fetch policy.
  - Changes: add explicit plain-HTTP and HTTP-redirect rejection tests.
- Modify: `tests/tools/tool-preferences.test.ts`
  - Responsibility: tool preference classification and toggles.
  - Changes: verify plugin tools fall into the new plugin domain and can be disabled by domain or override.

---

### Task 1: Fix Discovery Hash Coverage And Explicit MCP-Only Discovery

**Files:**

- Modify: `tests/plugins/discovery.test.ts`
- Modify: `src/plugins/discovery.ts`

- [ ] **Step 1: Write the failing discovery tests**

Append these tests to `tests/plugins/discovery.test.ts` inside the `describe('discoverPlugins', ...)` block:

```ts
test('manifest hash changes when an imported local helper changes', () => {
  const root = makeTempDir()
  const pluginDir = join(root, 'hash-imported-helper')
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({
      id: 'hash-imported-helper',
      name: 'Hash Imported Helper',
      version: '1.0.0',
      description: 'hash imported helpers',
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

  const first = discoverPlugins(root)
  expect(first.errors).toEqual([])
  const firstHash = first.plugins[0]?.manifestHash
  expect(typeof firstHash).toBe('string')

  writeFileSync(join(pluginDir, 'helper.ts'), 'export const value = 2\n', 'utf-8')

  const second = discoverPlugins(root)
  expect(second.errors).toEqual([])
  expect(second.plugins[0]?.manifestHash).not.toBe(firstHash)
})

test('rejects plugin-owned dynamic imports that cannot be resolved deterministically', () => {
  const root = makeTempDir()
  writePlugin(
    root,
    'dynamic-import-plugin',
    { main: 'index.ts' },
    "export default function createPlugin(){ return { async activate(){ const name = './helper.ts'; await import(name) } } }",
  )

  const result = discoverPlugins(root)

  expect(result.plugins).toEqual([])
  expect(result.errors).toHaveLength(1)
  expect(result.errors[0]?.reason).toContain('dynamic import')
})

test('accepts explicit mcp-only plugins without reading index.ts', () => {
  const root = makeTempDir()
  const pluginDir = join(root, 'mcp-only-plugin')
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({
      id: 'mcp-only-plugin',
      name: 'MCP Only Plugin',
      version: '1.0.0',
      description: 'mcp only',
      apiVersion: 1,
      contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [], taskProviderTypes: [] },
      mcp: { transport: 'streamable-http', url: 'https://mcp.example.com' },
    }),
    'utf-8',
  )

  const result = discoverPlugins(root)

  expect(result.errors).toEqual([])
  expect(result.plugins).toHaveLength(1)
  expect(result.plugins[0]?.manifest.id).toBe('mcp-only-plugin')
  expect(result.plugins[0]?.entryPoint).toBe('')
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/plugins/discovery.test.ts
```

Expected: FAIL. The imported-helper hash does not change, the dynamic-import case is not rejected explicitly, and the MCP-only plugin still trips entrypoint handling.

- [ ] **Step 3: Implement deterministic local-source hashing and MCP-only discovery**

In `src/plugins/discovery.ts`, replace the single-file hash flow with a local helper graph walk. Add these helpers near `computeManifestHash(...)`:

```ts
const STATIC_IMPORT_RE = /(?:import\s+(?:[^'";]+\s+from\s+)?|export\s+[^'";]*\s+from\s+)(['"])(\.[^'"]+)\1/gu
const DYNAMIC_IMPORT_RE = /import\s*\(([^)]+)\)/gu

function readPluginSourceGraph(entryPoint: string, pluginDir: string): string[] {
  const pending = [entryPoint]
  const visited = new Set<string>()
  const ordered: string[] = []

  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || visited.has(current)) continue
    visited.add(current)
    ordered.push(current)

    const source = readFileSync(current, 'utf-8')
    for (const match of source.matchAll(DYNAMIC_IMPORT_RE)) {
      const raw = match[1]?.trim()
      if (raw === undefined) continue
      if (!raw.startsWith("'") && !raw.startsWith('"')) {
        throw new Error(`Unresolvable plugin dynamic import in ${current}`)
      }
      const specifier = raw.slice(1, -1)
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue
      pending.push(resolveEntryImport(current, pluginDir, specifier))
    }

    for (const match of source.matchAll(STATIC_IMPORT_RE)) {
      const specifier = match[2]
      if (specifier === undefined) continue
      pending.push(resolveEntryImport(current, pluginDir, specifier))
    }
  }

  return ordered.sort()
}

function resolveEntryImport(fromFile: string, pluginDir: string, specifier: string): string {
  const candidate = resolve(join(dirname(fromFile), specifier))
  const allowedPrefix = resolve(pluginDir) + '/'
  if (!candidate.startsWith(allowedPrefix)) {
    throw new Error(`Plugin import resolves outside plugin directory: ${specifier}`)
  }
  const withExtension = ['.ts', '.js', '/index.ts', '/index.js']
    .map((suffix) => (candidate.endsWith('.ts') || candidate.endsWith('.js') ? candidate : `${candidate}${suffix}`))
    .find((path) => existsSync(path))
  if (withExtension === undefined) {
    throw new Error(`Imported plugin file not found: ${specifier}`)
  }
  return withExtension
}

function computePluginManifestHash(manifestContent: string, sourceFiles: readonly string[]): string {
  const hash = createHash('sha256')
  hash.update(`${manifestContent.length}:`).update(manifestContent)
  for (const filePath of sourceFiles) {
    const content = readFileSync(filePath, 'utf-8')
    hash.update(`${filePath.length}:`).update(filePath)
    hash.update(`${content.length}:`).update(content)
  }
  return hash.digest('hex')
}
```

Also update `src/plugins/discovery.ts` to:

```ts
import { dirname, join, resolve } from 'node:path'
```

Then replace `resolveAndReadEntryPoint(...)` with a shape that treats explicit MCP-only manifests specially:

```ts
function resolveEntrypointForDiscovery(
  pluginDir: string,
  main: string | undefined,
  isMcpOnly: boolean,
): { entryPoint: string; sourceFiles: string[] } | DiscoveryError {
  if (isMcpOnly) {
    return { entryPoint: '', sourceFiles: [] }
  }
  if (main === undefined) {
    return { directoryName: '', reason: 'Non-MCP plugin must declare a main entry point' }
  }
  const entryPoint = resolveEntryPoint(pluginDir, main)
  if (entryPoint === null) {
    return { directoryName: '', reason: `Entry point "${main}" resolves outside the plugin directory` }
  }
  try {
    const sourceFiles = readPluginSourceGraph(entryPoint, pluginDir)
    return { entryPoint, sourceFiles }
  } catch (error) {
    return {
      directoryName: '',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}
```

Finally update `discoverOne(...)` to stop keying MCP-only off the raw-object absence of `main`, and instead key it off the parsed manifest shape after Task 2 makes `main` genuinely optional for MCP-only manifests. Use:

```ts
const isMcpOnly = manifest.mcp !== undefined && manifest.main === undefined
const ep = resolveEntrypointForDiscovery(pluginDir, manifest.main, isMcpOnly)
if ('reason' in ep) {
  return { ...ep, directoryName: dirName }
}

return {
  manifest,
  pluginDir: resolve(pluginDir),
  entryPoint: ep.entryPoint,
  manifestHash: computePluginManifestHash(manifestContent, ep.sourceFiles),
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
bun test tests/plugins/discovery.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/plugins/discovery.test.ts src/plugins/discovery.ts
git commit -m "fix(plugins): hash imported sources and support mcp-only discovery"
```

---

### Task 2: Make Manifest Validation Strict And Align MCP-Only / Config-Key Contracts

**Files:**

- Modify: `tests/plugins/manifest-schema.test.ts`
- Modify: `src/plugins/types.ts`

- [ ] **Step 1: Write the failing manifest-schema tests**

Append these tests to `tests/plugins/manifest-schema.test.ts`:

```ts
test('rejects unknown top-level manifest keys', () => {
  const result = pluginManifestSchema.safeParse({
    id: 'strict-top-level',
    name: 'Strict Top Level',
    version: '1.0.0',
    description: 'strict',
    apiVersion: 1,
    unexpected: true,
  })

  expect(result.success).toBe(false)
})

test('rejects semver strings with trailing junk', () => {
  const result = pluginManifestSchema.safeParse({
    id: 'bad-semver',
    name: 'Bad Semver',
    version: '1.0.0-beta trailing',
    description: 'strict semver',
    apiVersion: 1,
  })

  expect(result.success).toBe(false)
})

test('rejects configKeys without matching context-scoped config requirement', () => {
  const result = pluginManifestSchema.safeParse({
    id: 'bad-config-keys',
    name: 'Bad Config Keys',
    version: '1.0.0',
    description: 'bad config key mapping',
    apiVersion: 1,
    contributes: { configKeys: ['api_token'] },
    configRequirements: [{ key: 'other_key', label: 'Other', required: true, scope: 'context' }],
  })

  expect(result.success).toBe(false)
})

test('rejects admin-scoped configKeys entries', () => {
  const result = pluginManifestSchema.safeParse({
    id: 'admin-config-key',
    name: 'Admin Config Key',
    version: '1.0.0',
    description: 'admin config key mismatch',
    apiVersion: 1,
    contributes: { configKeys: ['api_token'] },
    configRequirements: [{ key: 'api_token', label: 'API Token', required: true, scope: 'admin' }],
  })

  expect(result.success).toBe(false)
})

test('accepts explicit mcp-only manifests without main', () => {
  const result = pluginManifestSchema.safeParse({
    id: 'mcp-only-schema',
    name: 'MCP Only Schema',
    version: '1.0.0',
    description: 'mcp only schema',
    apiVersion: 1,
    contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [], taskProviderTypes: [] },
    mcp: { transport: 'streamable-http', url: 'https://mcp.example.com' },
  })

  expect(result.success).toBe(true)
  expect(result.data?.main).toBeUndefined()
})

test('rejects mcp manifests that also declare runtime contributions without main', () => {
  const result = pluginManifestSchema.safeParse({
    id: 'mixed-mcp-runtime',
    name: 'Mixed MCP Runtime',
    version: '1.0.0',
    description: 'mixed runtime',
    apiVersion: 1,
    contributes: {
      tools: ['search'],
      promptFragments: [],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: [],
    },
    mcp: { transport: 'streamable-http', url: 'https://mcp.example.com' },
  })

  expect(result.success).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/plugins/manifest-schema.test.ts
```

Expected: FAIL. Unknown keys are stripped today, semver is prefix-only, `configKeys` cross-validation is absent, and `main` still defaults to `index.ts`.

- [ ] **Step 3: Make the schema strict and add explicit cross-field validation**

In `src/plugins/types.ts`, change the schema builders to strict objects and tighten semver. Replace these declarations:

```ts
const pluginContributesSchema = z.object({
```

```ts
const configRequirementBaseSchema = z.object({
```

```ts
export const pluginManifestSchema = z
  .object({
```

with:

```ts
const pluginContributesSchema = z.strictObject({
```

```ts
const configRequirementBaseSchema = z.strictObject({
```

```ts
export const pluginManifestSchema = z
  .strictObject({
```

Tighten the version line to:

```ts
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/u, 'version must be semver (major.minor.patch)'),
```

Change `main` to be optional without a default:

```ts
    main: mainPathSchema.optional(),
```

Then append these refinements after the existing `provider.task` refinement:

```ts
  .refine((m) => {
    const configKeys = new Set(m.contributes.configKeys)
    if (configKeys.size === 0) return true
    return [...configKeys].every((key) =>
      m.configRequirements.some((requirement) => requirement.key === key && requirement.scope === 'context'),
    )
  }, {
    message: 'Every contributes.configKeys entry must match a context-scoped configRequirements entry',
    path: ['contributes', 'configKeys'],
  })
  .refine((m) => {
    const runtimeContributionCount =
      m.contributes.tools.length +
      m.contributes.promptFragments.length +
      m.contributes.commands.length +
      m.contributes.jobs.length +
      m.contributes.taskProviderTypes.length
    const isMcpOnly = m.mcp !== undefined && runtimeContributionCount === 0 && m.providerConfigValidator === undefined
    if (isMcpOnly) return m.main === undefined
    return m.main !== undefined
  }, {
    message: 'main is required unless the manifest is an explicit MCP-only plugin',
    path: ['main'],
  })
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
bun test tests/plugins/manifest-schema.test.ts tests/plugins/discovery.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/plugins/manifest-schema.test.ts tests/plugins/discovery.test.ts src/plugins/types.ts src/plugins/discovery.ts
git commit -m "fix(plugins): make manifest validation strict"
```

---

### Task 3: Stage Activation Side Effects And Fail Duplicate Provider Plugins Honestly

**Files:**

- Modify: `tests/plugins/loader.test.ts`
- Modify: `tests/plugins/context.test.ts`
- Modify: `src/plugins/context.ts`
- Modify: `src/plugins/loader.ts`

- [ ] **Step 1: Write the failing loader tests**

Add these tests to `tests/plugins/loader.test.ts` after `activation timeout cleans framework-owned partial contributions`:

```ts
test('timeout plugin does not publish late provider registration after activation failure', async () => {
  const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) {
            setTimeout(() => {
              ctx.registration.registerTaskProviderType('late-timeout-provider', {
                factory: () => ({})
              })
            }, 150)
            return new Promise(() => {})
          },
        }
      }
    `)
  const plugin = makePlugin('late-timeout-plugin', entryPoint, {
    activationTimeoutMs: 100,
    permissions: ['provider.task'],
    contributes: {
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: ['late-timeout-provider'],
    },
  })
  approvePlugin(plugin)

  await activatePlugins([plugin])
  await new Promise((resolve) => setTimeout(resolve, 200))

  expect(pluginRegistry.getEntry('late-timeout-plugin')?.state).toBe('error')
  expect(getTaskProviderDescriptor('late-timeout-provider')).toBeUndefined()
})

test('duplicate contributed provider type fails later plugin activation', async () => {
  const firstEntry = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTaskProviderType('duplicate-provider', { factory: () => ({}) })
          },
        }
      }
    `)
  const secondEntry = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTaskProviderType('duplicate-provider', { factory: () => ({}) })
          },
        }
      }
    `)
  const firstPlugin = makePlugin('first-duplicate-provider-plugin', firstEntry, {
    permissions: ['provider.task'],
    contributes: {
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: ['duplicate-provider'],
    },
  })
  const secondPlugin = makePlugin('second-duplicate-provider-plugin', secondEntry, {
    permissions: ['provider.task'],
    contributes: {
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: ['duplicate-provider'],
    },
  })
  approvePlugin(firstPlugin)
  approvePlugin(secondPlugin)

  await activatePlugins([firstPlugin, secondPlugin])

  expect(pluginRegistry.getEntry('first-duplicate-provider-plugin')?.state).toBe('active')
  expect(pluginRegistry.getEntry('second-duplicate-provider-plugin')?.state).toBe('error')
})
```

Update the provider-registration API expectation in `tests/plugins/context.test.ts` by replacing:

```ts
ctx.registration.registerTaskProviderType('custom-tracker', { factory: stubProviderFactory })
```

with:

```ts
ctx.registration.registerTaskProviderType('custom-tracker', stubProviderFactory)
```

Do the same replacement for the second `registerTaskProviderType('custom-tracker', ...)` call and for the two `.toThrow(...)` registration calls later in the file.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/plugins/loader.test.ts tests/plugins/context.test.ts
```

Expected: FAIL. Late timeout registration can still mutate the provider registry, and the old registration API shape still matches the current implementation.

- [ ] **Step 3: Change plugin registration to stage provider types instead of mutating the global registry**

In `src/plugins/context.ts`, change the registration signature from:

```ts
  registerTaskProviderType(
    type: string,
    descriptor: { factory: TaskProviderFactory; validateConfig?: TaskProviderConfigValidator },
  ): void
```

to:

```ts
  registerTaskProviderType(type: string, factory: TaskProviderFactory): void
```

Then change `buildRegisterTaskProviderType(...)` so it no longer calls `registerContributedTaskProviderType(...)` immediately. Replace its body with:

```ts
function buildRegisterTaskProviderType(
  manifest: PluginManifest,
  collected: PluginContributions,
): (type: string, factory: TaskProviderFactory) => void {
  return function registerTaskProviderType(type: string, factory: TaskProviderFactory): void {
    if (!manifest.permissions.includes('provider.task')) {
      throw new Error(`Plugin ${manifest.id} cannot register a task provider type without 'provider.task'`)
    }
    const declared = manifest.contributes.taskProviderTypes
    if (declared.length !== 1 || declared[0] !== type) {
      throw new Error(
        `Task provider type '${type}' is not declared in plugin manifest contributes.taskProviderTypes (declared: [${declared.join(', ')}])`,
      )
    }
    collected.taskProviderRegistration = {
      type,
      factory,
      capabilities: new Set(manifest.providerCapabilities),
      displayName: manifest.name,
      instanceConfigSchema: manifest.providerConfigSchema.map((field) => toProviderConfigField(field, 'instance')),
      contextConfigSchema: (manifest.providerContextConfigSchema ?? []).map((field) =>
        toProviderConfigField(field, 'context'),
      ),
      traits: new Set(),
    }
  }
}
```

Also update the `PluginContributions` type in `src/plugins/runtime-types.ts` to include:

```ts
  taskProviderRegistration?: {
    type: string
    factory: TaskProviderFactory
    capabilities: ReadonlySet<TaskCapability>
    displayName: string
    instanceConfigSchema: readonly ProviderConfigField[]
    contextConfigSchema: readonly ProviderConfigField[]
    traits: ReadonlySet<TaskProviderTrait>
  }
```

and update `buildRegistration(...)` to call `buildRegisterTaskProviderType(manifest, collected)`.

- [ ] **Step 4: Publish staged provider registrations only after successful activation**

In `src/plugins/loader.ts`, after `await Promise.race(...)` and before `contributionRegistry.register(...)`, insert this commit step:

```ts
if (collected.taskProviderRegistration !== undefined) {
  const { type, ...entry } = collected.taskProviderRegistration
  const before = getTaskProviderDescriptor(type)
  registerContributedTaskProviderType(type, {
    pluginId: manifest.id,
    factory: entry.factory,
    capabilities: entry.capabilities,
    displayName: entry.displayName,
    instanceConfigSchema: entry.instanceConfigSchema,
    contextConfigSchema: entry.contextConfigSchema,
    traits: entry.traits,
  })
  const after = getTaskProviderDescriptor(type)
  if (
    before !== undefined ||
    after?.source === undefined ||
    after.source === 'builtin' ||
    after.source.plugin !== manifest.id
  ) {
    throw new Error(`Task provider type '${type}' could not be registered for plugin '${manifest.id}'`)
  }
}
```

Add imports at the top of `src/plugins/loader.ts`:

```ts
import { getTaskProviderDescriptor, registerContributedTaskProviderType } from '../providers/registry.js'
```

This makes duplicate-provider collisions surface as activation errors instead of silent partial activation.

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
bun test tests/plugins/loader.test.ts tests/plugins/context.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/plugins/loader.test.ts tests/plugins/context.test.ts src/plugins/context.ts src/plugins/loader.ts src/plugins/runtime-types.ts
git commit -m "fix(plugins): stage activation side effects"
```

---

### Task 4: Resolve Provider Validators From Manifest-Owned Named Exports

**Files:**

- Modify: `tests/plugins/loader.test.ts`
- Modify: `tests/debug/instance-routes.test.ts`
- Modify: `src/plugins/loader.ts`
- Modify: `src/debug/instance-config-validation.ts`

- [ ] **Step 1: Write the failing validator tests**

Add this test to `tests/plugins/loader.test.ts` after the duplicate-provider test from Task 3:

```ts
test('manifest providerConfigValidator resolves named export and invalid export shape fails activation', async () => {
  const badEntryPoint = writeTempPluginModule(`
      export const validateConfig = 'not-a-function'
      export default function createPlugin() {
        return {
          activate(ctx) {
            ctx.registration.registerTaskProviderType('bad-validator-provider', () => ({}))
          },
        }
      }
    `)
  const plugin = makePlugin('bad-validator-plugin', badEntryPoint, {
    permissions: ['provider.task'],
    contributes: {
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: ['bad-validator-provider'],
    },
    providerConfigValidator: 'validateConfig',
  })
  approvePlugin(plugin)

  await activatePlugins([plugin])

  expect(pluginRegistry.getEntry('bad-validator-plugin')?.state).toBe('error')
  expect(getRecentRuntimeEvents('bad-validator-plugin', 1)[0]?.message).toContain('providerConfigValidator')
})
```

Add this test to `tests/debug/instance-routes.test.ts` near the existing task-instance POST validation tests:

```ts
test('POST /api/task-instances rejects provider config when contributed validator returns not ok', async () => {
  registerContributedTaskProviderType('validated-plugin-provider', {
    pluginId: 'validated-plugin',
    factory: () => createMockProvider(),
    capabilities: new Set(),
    displayName: 'Validated Plugin Provider',
    instanceConfigSchema: [{ key: 'baseUrl', label: 'Base URL', required: true, sensitive: false, scope: 'instance' }],
    contextConfigSchema: [],
    validateConfig: async () => ({ ok: false, reason: 'validator rejected config' }),
    traits: new Set(),
  })

  const res = expectResponse(
    await route('/api/task-instances', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        id: 'validated-provider',
        type: 'validated-plugin-provider',
        config: { baseUrl: 'https://example.com' },
      }),
    }),
  )

  expect(res.status).toBe(400)
  expect(await readJson(res)).toEqual({
    error: 'invalid_task_instance_config',
    type: 'validated-plugin-provider',
    reason: 'validator rejected config',
  })

  unregisterContributedTaskProviderType('validated-plugin')
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/plugins/loader.test.ts tests/debug/instance-routes.test.ts
```

Expected: FAIL. Loader does not resolve named validator exports, and task-instance route validation ignores contributed validators.

- [ ] **Step 3: Resolve named provider validators during module import**

In `src/plugins/loader.ts`, change `importPluginModule(...)` from returning only a `PluginInstance` to returning both the instance and the imported module value. Replace it with:

```ts
async function importPluginModule(entryPoint: string): Promise<{ instance: PluginInstance; moduleValue: unknown }> {
  const mod: unknown = await import(entryPoint)
  const candidate = typeof mod === 'object' && mod !== null && 'default' in mod ? mod.default : mod
  if (!isPluginFactory(candidate)) {
    throw new Error('Invalid plugin module contract: default export must be a factory function')
  }
  const instance = candidate()
  if (!isPluginInstance(instance)) {
    throw new Error('Invalid plugin module contract: factory must return an object with activate(ctx)')
  }
  return { instance, moduleValue: mod }
}
```

Then add this helper near it:

```ts
function resolveProviderConfigValidatorExport(
  manifest: DiscoveredPlugin['manifest'],
  moduleValue: unknown,
): TaskProviderConfigValidator | undefined {
  if (manifest.providerConfigValidator === undefined) return undefined
  if (typeof moduleValue !== 'object' || moduleValue === null) {
    throw new Error(`providerConfigValidator '${manifest.providerConfigValidator}' was not exported`)
  }
  const candidate = (moduleValue as Record<string, unknown>)[manifest.providerConfigValidator]
  if (typeof candidate !== 'function') {
    throw new Error(`providerConfigValidator '${manifest.providerConfigValidator}' must export a function`)
  }
  return candidate as TaskProviderConfigValidator
}
```

Update `activateOne(...)` to unpack the new import result and store the validator onto `collected.taskProviderRegistration` before commit:

```ts
  const imported = await importPluginModule(entryPoint).catch((err: unknown) => {
```

and later:

```ts
if (imported === null) return false
const { instance, moduleValue } = imported
```

and before provider registration commit:

```ts
const resolvedValidator = resolveProviderConfigValidatorExport(manifest, moduleValue)
if (collected.taskProviderRegistration !== undefined) {
  collected.taskProviderRegistration = {
    ...collected.taskProviderRegistration,
    validateConfig: resolvedValidator,
  }
} else if (resolvedValidator !== undefined) {
  throw new Error(
    `providerConfigValidator '${manifest.providerConfigValidator}' requires a contributed task provider type`,
  )
}
```

Also extend the `taskProviderRegistration` type from Task 3 with:

```ts
    validateConfig?: TaskProviderConfigValidator
```

and pass it through the `registerContributedTaskProviderType(...)` call.

- [ ] **Step 4: Invoke contributed provider validators during task-instance route validation**

In `src/debug/instance-config-validation.ts`, import `getTaskProviderConfigValidator`:

```ts
import { getTaskProviderConfigValidator, getTaskProviderDescriptor } from '../providers/registry.js'
```

Then replace `validateTaskInstanceRouteConfig(...)` with:

```ts
export const validateTaskInstanceRouteConfig = async (
  type: string,
  config: InstanceConfig,
): Promise<Response | null> => {
  const descriptorConfigError = validateTaskDescriptorInstanceConfig(type, config)
  if (descriptorConfigError !== null) return descriptorConfigError

  const routeConfigError = await validateTaskInstanceConfig(type, config)
  if (routeConfigError !== null) return routeConfigError

  const validator = getTaskProviderConfigValidator(type)
  if (validator === undefined) return null
  const result = await validator(config)
  if (result.ok) return null
  return jsonResponse({ error: 'invalid_task_instance_config', type, reason: result.reason }, { status: 400 })
}
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
bun test tests/plugins/loader.test.ts tests/debug/instance-routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/plugins/loader.test.ts tests/debug/instance-routes.test.ts src/plugins/loader.ts src/debug/instance-config-validation.ts src/plugins/runtime-types.ts
git commit -m "fix(plugins): resolve manifest-owned provider validators"
```

---

### Task 5: Make Admin-Scoped Plugin Config Live At Tool Runtime

**Files:**

- Modify: `tests/plugins/tool-runtime.test.ts`
- Modify: `tests/plugins/synthetic-web-search.test.ts`
- Modify: `src/plugins/runtime-types.ts`
- Modify: `src/plugins/tool-runtime.ts`
- Modify: `plugins/synthetic-web-search/index.ts`

- [ ] **Step 1: Write the failing runtime tests**

Add this test to `tests/plugins/tool-runtime.test.ts`:

```ts
test('tool runtime exposes admin config getter for declared admin-scoped keys', () => {
  setPluginAdminConfig('test-plugin', 'api_key', 'live-key', 'admin-user')
  const ctx = buildPluginToolRuntimeContext(
    'test-plugin',
    makeManifest({
      configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
    }),
    makeRuntime(),
  )

  expect(ctx.adminConfig.get('api_key')).toBe('live-key')
  expect(ctx.adminConfig.get('missing')).toBeUndefined()
})
```

Add this test to `tests/plugins/synthetic-web-search.test.ts`:

```ts
test('reads updated admin api key at execution time without restart', async () => {
  const mockHttpFetch = mock().mockResolvedValue(
    new Response(
      JSON.stringify({
        results: [{ url: 'https://example.com/1', title: 'Result 1', text: 'Text 1' }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  )

  const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch, apiKey: undefined })
  const instance = factory()
  void instance.activate(ctx)
  const tool = registeredTool.value!
  const runtimeCtx = {
    ...createMockRuntimeContext(),
    adminConfig: { get: (key: string) => (key === 'api_key' ? 'fresh-key' : undefined) },
  }

  const result = await tool.execute({ query: 'latest' }, runtimeCtx, createMockOptions())

  expect(result).toEqual({
    results: [{ url: 'https://example.com/1', title: 'Result 1', text: 'Text 1', published: undefined }],
  })
  expect(mockHttpFetch).toHaveBeenCalledWith(
    'https://api.synthetic.new/v2/search',
    expect.objectContaining({
      headers: {
        Authorization: 'Bearer fresh-key',
        'Content-Type': 'application/json',
      },
    }),
  )
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/plugins/tool-runtime.test.ts tests/plugins/synthetic-web-search.test.ts
```

Expected: FAIL. Tool runtime has no `adminConfig`, and the synthetic plugin still closes over the activation-time API key.

- [ ] **Step 3: Add live admin-config accessor to plugin tool runtime**

In `src/plugins/runtime-types.ts`, update `PluginToolRuntimeContext` to include:

```ts
  adminConfig: {
    get(key: string): string | undefined
  }
```

In `src/plugins/tool-runtime.ts`, import `getPluginAdminConfig` from the store and add this helper:

```ts
function buildRuntimeAdminConfig(pluginId: string, manifest: PluginManifest): PluginToolRuntimeContext['adminConfig'] {
  const adminKeys = new Set(manifest.configRequirements.filter((req) => req.scope === 'admin').map((req) => req.key))
  return Object.freeze({
    get(key: string): string | undefined {
      if (!adminKeys.has(key)) return undefined
      return getPluginAdminConfig(pluginId, key)
    },
  })
}
```

Then add it to the returned runtime object:

```ts
    adminConfig: buildRuntimeAdminConfig(pluginId, manifest),
```

- [ ] **Step 4: Make the synthetic plugin read admin config at execution time**

In `plugins/synthetic-web-search/index.ts`, change the execute helper signature from:

```ts
async function executeSearch(
  input: unknown,
  runtimeContext: PluginToolRuntimeContext,
  apiKey: string | undefined,
  httpFetch: ((url: string, init?: RequestInit) => Promise<Response>) | undefined,
): Promise<unknown> {
```

to:

```ts
async function executeSearch(
  input: unknown,
  runtimeContext: PluginToolRuntimeContext,
  httpFetch: ((url: string, init?: RequestInit) => Promise<Response>) | undefined,
): Promise<unknown> {
```

Then change the early config read inside that function to:

```ts
const apiKey = runtimeContext.adminConfig.get('api_key')
```

and change the plugin factory body from:

```ts
  let apiKey: string | undefined
  let httpFetch: ((url: string, init?: RequestInit) => Promise<Response>) | undefined

  return {
    activate(ctx: PluginContext): void {
      apiKey = ctx.adminConfig.get('api_key')
      httpFetch = ctx.providerRuntime?.httpFetch
```

to:

```ts
  let httpFetch: ((url: string, init?: RequestInit) => Promise<Response>) | undefined

  return {
    activate(ctx: PluginContext): void {
      httpFetch = ctx.providerRuntime?.httpFetch
```

and update the registered tool execute callback to:

```ts
        execute: (input: unknown, runtimeContext: PluginToolRuntimeContext) =>
          executeSearch(input, runtimeContext, httpFetch),
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
bun test tests/plugins/tool-runtime.test.ts tests/plugins/synthetic-web-search.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/plugins/tool-runtime.test.ts tests/plugins/synthetic-web-search.test.ts src/plugins/runtime-types.ts src/plugins/tool-runtime.ts plugins/synthetic-web-search/index.ts
git commit -m "fix(plugins): read admin config at tool runtime"
```

---

### Task 6: Unify Missing-Config Resolution And Fix `/config` Plugin Toggle Checks

**Files:**

- Modify: `tests/plugins/registry-context-eligibility.test.ts`
- Modify: `tests/chat/plugin-interaction-handler.test.ts`
- Modify: `tests/commands/config.test.ts`
- Modify: `src/plugins/registry-context-eligibility.ts`
- Modify: `src/chat/plugin-interaction-handler.ts`
- Modify: `src/commands/config.ts`

- [ ] **Step 1: Write the failing missing-config tests**

Add this test to `tests/plugins/registry-context-eligibility.test.ts`:

```ts
test('admin-scoped required keys are satisfied from admin plugin config', () => {
  const pluginId = 'admin-config-eligibility-plugin'
  const plugin = makePlugin({
    manifest: {
      ...makePlugin().manifest,
      id: pluginId,
      name: 'Admin Config Eligibility Plugin',
      defaultEnabled: true,
      configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
    },
    manifestHash: 'hash-admin-config-eligibility',
  })
  pluginRegistry.registerDiscovered(plugin)
  pluginRegistry.approve(pluginId, 'admin', 'hash-admin-config-eligibility')
  pluginRegistry.markActive(pluginId)
  setPluginAdminConfig(pluginId, 'api_key', 'configured', 'admin-user')

  expect(getPluginContextEligibility(pluginId, 'ctx-1')).toEqual({ eligible: true })
})
```

Add this test to `tests/chat/plugin-interaction-handler.test.ts`:

```ts
test('enable interaction accepts admin-scoped required config from admin store', async () => {
  const pluginId = 'admin-scoped-toggle-plugin'
  registerActivePlugin(
    makePlugin(pluginId, {
      configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
    }),
  )
  setPluginAdminConfig(pluginId, 'api_key', 'configured', 'admin-user')

  const { reply, textCalls } = createMockReply()
  await handlePluginInteraction(
    createInteraction({ callbackData: `plg:enable:${pluginId}:${Buffer.from('ctx-1').toString('base64url')}` }),
    reply,
  )

  expect(textCalls.some((text) => text.includes('enabled'))).toBe(true)
})
```

Add this test to `tests/commands/config.test.ts` near the existing plugin status rendering tests:

```ts
test('plugin rows treat admin-scoped required config as satisfied when admin config exists', async () => {
  const pluginId = 'config-admin-scope-plugin'
  registerActivePlugin(
    makePlugin(pluginId, {
      name: 'Admin Scoped Config Plugin',
      defaultEnabled: true,
      configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
    }),
  )
  setPluginAdminConfig(pluginId, 'api_key', 'configured', 'admin-user')

  const { reply, buttonCalls } = createMockReply()
  await renderConfigForTarget(reply, USER_ID, true)

  expect(buttonCalls[0]).toContain('Admin Scoped Config Plugin')
  expect(buttonCalls[0]).not.toContain('unavailable (missing config)')
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/plugins/registry-context-eligibility.test.ts tests/chat/plugin-interaction-handler.test.ts tests/commands/config.test.ts
```

Expected: FAIL. The interaction path and `/config` plugin status rendering still check admin-scoped required keys in context storage.

- [ ] **Step 3: Centralize required-config resolution by scope**

In `src/plugins/registry-context-eligibility.ts`, replace `getMissingRequiredConfigKeys(...)` with these exports:

```ts
export type MissingPluginRequirement = {
  key: string
  label: string
}

export function getMissingRequiredPluginRequirements(
  plugin: DiscoveredPlugin,
  contextId: string,
): readonly MissingPluginRequirement[] {
  return plugin.manifest.configRequirements
    .filter((requirement) => requirement.required)
    .filter((requirement) => {
      if (requirement.scope === 'admin') {
        const value = getPluginAdminConfig(plugin.manifest.id, requirement.key)
        return value === undefined || value.trim() === ''
      }
      const value = getPluginConfig(contextId, plugin.manifest.id, requirement.key)
      return value === null || value.trim() === ''
    })
    .map((requirement) => ({ key: requirement.key, label: requirement.label }))
}

function getMissingRequiredConfigKeys(plugin: DiscoveredPlugin, contextId: string): readonly string[] {
  return getMissingRequiredPluginRequirements(plugin, contextId).map((requirement) => requirement.key)
}
```

- [ ] **Step 4: Reuse the shared resolver in the interaction handler**

In `src/chat/plugin-interaction-handler.ts`, remove `getPluginConfig` import and add:

```ts
import { getMissingRequiredPluginRequirements } from '../plugins/registry-context-eligibility.js'
```

Then replace `getMissingRequiredConfigLabels(...)` with:

```ts
function getMissingRequiredConfigLabels(entry: PluginRegistryEntry, contextId: string): readonly string[] {
  return getMissingRequiredPluginRequirements(entry.discoveredPlugin, contextId).map((requirement) => requirement.label)
}
```

In `src/commands/config.ts`, import the shared helper:

```ts
import { getMissingRequiredPluginRequirements } from '../plugins/registry-context-eligibility.js'
```

Then change `formatPluginStatus(...)` to compute missing requirements first:

```ts
const missingRequirements = getMissingRequiredPluginRequirements(entry.discoveredPlugin, targetContextId)
if (missingRequirements.length > 0) return 'unavailable (missing config)'

const eligibility = getPluginContextEligibility(entry.discoveredPlugin.manifest.id, targetContextId)
if (eligibility.eligible) return `enabled${source}`
if (eligibility.reason === 'capability_missing') {
  return `unavailable (missing capability: ${eligibility.missingCapabilities.join(', ')})`
}
return 'disabled'
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
bun test tests/plugins/registry-context-eligibility.test.ts tests/chat/plugin-interaction-handler.test.ts tests/commands/config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/plugins/registry-context-eligibility.test.ts tests/chat/plugin-interaction-handler.test.ts tests/commands/config.test.ts src/plugins/registry-context-eligibility.ts src/chat/plugin-interaction-handler.ts src/commands/config.ts
git commit -m "fix(plugins): unify required config resolution"
```

---

### Task 7: Make Plugin-Owned Context Config Editable In `/config`

**Files:**

- Modify: `tests/commands/config.test.ts`
- Modify: `src/types/config.ts`
- Modify: `src/config-keys.ts`
- Modify: `src/commands/config.ts`
- Modify: `src/config-editor/handlers.ts`

- [ ] **Step 1: Write the failing `/config` field test**

Add this test to `tests/commands/config.test.ts` near the existing plugin config rendering tests:

```ts
test('plugin-owned context config appears as an editable config button', async () => {
  const pluginId = 'editable-plugin-config'
  registerActivePlugin(
    makePlugin(pluginId, {
      name: 'Editable Plugin Config',
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: ['api_token'],
        taskProviderTypes: [],
      },
      configRequirements: [{ key: 'api_token', label: 'API Token', required: true, sensitive: true, scope: 'context' }],
    }),
  )

  const { reply, buttonCalls } = createMockReply()
  await renderConfigForTarget(reply, USER_ID, true)

  expect(buttonCalls[0]).toContain('API Token')
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/commands/config.test.ts
```

Expected: FAIL. Plugin requirement text is shown, but no editable field button is generated.

- [ ] **Step 3: Merge plugin-owned context fields into config-field generation**

In `src/types/config.ts`, widen `ConfigField.kind` from:

```ts
  readonly kind: 'preference' | 'provider-context'
```

to:

```ts
  readonly kind: 'preference' | 'provider-context' | 'plugin-context'
```

Then update `src/config-keys.ts`.

In `src/config-keys.ts`, add these imports:

```ts
import { pluginRegistry } from './plugins/registry.js'
```

Then add this helper above `getConfigFieldsForContext(...)`:

```ts
function getPluginConfigFieldsForContext(contextId: string): readonly ConfigField[] {
  return pluginRegistry
    .getAllEntries()
    .filter((entry) => entry.state === 'active')
    .flatMap((entry) =>
      entry.discoveredPlugin.manifest.contributes.configKeys.flatMap((configKey) => {
        const requirement = entry.discoveredPlugin.manifest.configRequirements.find(
          (candidate) => candidate.key === configKey && candidate.scope === 'context',
        )
        if (requirement === undefined) return []
        return [
          {
            key: requirement.key,
            storageKey: `plugin:${entry.discoveredPlugin.manifest.id}:${requirement.key}`,
            label: requirement.label,
            required: requirement.required,
            sensitive: requirement.sensitive,
            kind: 'plugin-context' as const,
          },
        ]
      }),
    )
}
```

Then change the final return in `getConfigFieldsForContext(...)` from:

```ts
return [...providerFields, ...PREFERENCE_FIELDS]
```

to:

```ts
return [...providerFields, ...getPluginConfigFieldsForContext(contextId), ...PREFERENCE_FIELDS]
```

- [ ] **Step 4: Route plugin-owned config writes through `setPluginConfig(...)`**

In `src/config-editor/handlers.ts`, locate the branch that persists field edits after validation. Replace the direct config write with:

```ts
if (field.kind === 'plugin-context') {
  const pluginPrefix = 'plugin:'
  const withoutPrefix = field.storageKey.slice(pluginPrefix.length)
  const separator = withoutPrefix.indexOf(':')
  const pluginId = withoutPrefix.slice(0, separator)
  const key = withoutPrefix.slice(separator + 1)
  setPluginConfig(targetContextId, pluginId, key, text)
} else {
  setConfigValue(targetContextId, field.storageKey, text)
}
```

Also add the import:

```ts
import { setPluginConfig } from '../config.js'
```

If the file currently imports `setConfigValue` from `../config.js`, update that line to import both.

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
bun test tests/commands/config.test.ts tests/chat/config-editor-integration.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/commands/config.test.ts src/types/config.ts src/config-keys.ts src/commands/config.ts src/config-editor/handlers.ts
git commit -m "feat(plugins): expose plugin context config in config ui"
```

---

### Task 8: Restrict Plugin Runtime Fetch To HTTPS Only

**Files:**

- Modify: `tests/plugins/provider-runtime.test.ts`
- Modify: `src/plugins/provider-runtime.ts`

- [ ] **Step 1: Write the failing HTTPS-only tests**

Add these tests to `tests/plugins/provider-runtime.test.ts`:

```ts
test('rejects plain http urls before SSRF validation or fetch', async () => {
  mockLogger()
  const { fetchSpy, assertSpy, ...deps } = makeDeps()
  const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), deps)

  await expect(runtime.httpFetch('http://api.kaneo.io/v1/tasks')).rejects.toThrow(
    'Plugin provider httpFetch requires https',
  )
  expect(assertSpy).not.toHaveBeenCalled()
  expect(fetchSpy).not.toHaveBeenCalled()
})

test('rejects redirects that downgrade to http', async () => {
  mockLogger()
  const { fetchSpy, assertSpy, ...deps } = makeDeps()
  fetchSpy.mockResolvedValueOnce(
    new Response(null, { status: 302, headers: { location: 'http://api.kaneo.io/insecure' } }),
  )
  const runtime = buildProviderRuntime(['api.kaneo.io'], makeLogger(), deps)

  await expect(runtime.httpFetch('https://api.kaneo.io/v1/tasks')).rejects.toThrow(
    'Plugin provider httpFetch requires https',
  )
  expect(fetchSpy).toHaveBeenCalledTimes(1)
  expect(assertSpy).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/plugins/provider-runtime.test.ts
```

Expected: FAIL. The current runtime allows `http:` as long as the host is allowlisted and public.

- [ ] **Step 3: Enforce HTTPS in plugin runtime**

In `src/plugins/provider-runtime.ts`, add this helper above `validateHop(...)`:

```ts
function assertHttps(url: URL): void {
  if (url.protocol !== 'https:') {
    throw new Error('Plugin provider httpFetch requires https')
  }
}
```

Then update `validateHop(...)` to:

```ts
async function validateHop(
  url: URL,
  hostSet: ReadonlySet<string>,
  assertPublicUrl: (url: URL) => Promise<void>,
): Promise<void> {
  assertHttps(url)
  if (!hostSet.has(url.hostname.toLowerCase())) {
    throw new Error(`Host '${url.hostname}' is not in the plugin providerAllowedHosts allowlist`)
  }
  await assertPublicUrl(url)
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
bun test tests/plugins/provider-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/plugins/provider-runtime.test.ts src/plugins/provider-runtime.ts
git commit -m "fix(plugins): require https for provider runtime fetch"
```

---

### Task 9: Bring Plugin Tools Into Tool Preferences

**Files:**

- Modify: `tests/tools/tool-preferences.test.ts`
- Modify: `src/tools/tool-metadata.ts`

- [ ] **Step 1: Write the failing tool-preference tests**

Add these tests to `tests/tools/tool-preferences.test.ts`:

```ts
test('classifies plugin tools into the plugin domain', () => {
  expect(getToolMetadata('plugin_synthetic_web_search__search')).toEqual({
    domain: 'plugin',
    operation: 'read',
    risk: 'open-world',
  })
})

test('plugin tool domain can be disabled through tool preferences', () => {
  const prefs = parseToolPrefs(JSON.stringify({ disabledDomains: ['plugin'], toolOverrides: {} }))
  expect(isToolEnabled(prefs, 'plugin_synthetic_web_search__search')).toBe(false)
})

test('plugin tool override can force a plugin tool back on', () => {
  const prefs = parseToolPrefs(
    JSON.stringify({ disabledDomains: ['plugin'], toolOverrides: { plugin_synthetic_web_search__search: true } }),
  )
  expect(isToolEnabled(prefs, 'plugin_synthetic_web_search__search')).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/tools/tool-preferences.test.ts
```

Expected: FAIL. `getToolMetadata(...)` returns `undefined` for `plugin_` tools today.

- [ ] **Step 3: Add plugin tool classification**

In `src/tools/tool-metadata.ts`, add `'plugin'` to the `ToolDomain` union:

```ts
  | 'plugin'
```

Then update `getToolMetadata(...)` to classify plugin names before the final `return undefined`:

```ts
if (toolName.startsWith('plugin_')) {
  return { domain: 'plugin', operation: 'read', risk: 'open-world' }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
bun test tests/tools/tool-preferences.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/tools/tool-preferences.test.ts src/tools/tool-metadata.ts
git commit -m "fix(tools): classify plugin tools in preferences"
```

---

### Task 10: Run Focused Verification And Final Cleanup

**Files:**

- Modify: `docs/plugins/developer-guide.md`
- Modify: `plugins/synthetic-web-search/plugin.json`
- Modify: `plugins/synthetic-web-search/index.ts`

- [ ] **Step 1: Update plugin docs to match the runtime contract**

In `docs/plugins/developer-guide.md`, make these exact text changes:

Replace:

```md
| `contributes.configKeys` | Plugin-owned context config keys shown by docs and admin UX. |
```

with:

```md
| `contributes.configKeys` | Plugin-owned context config keys exposed in `/config`. Each key must have a matching context-scoped `configRequirements` entry. |
```

Replace:

```md
| `providerConfigValidator` | Optional exported validator function name for provider instance and context config. |
```

with:

```md
| `providerConfigValidator` | Optional named export for validating contributed provider config before task-instance writes are persisted. |
```

Replace:

```md
Prompt fragments are synchronous strings or synchronous functions returning strings. Async prompt fragments are not supported. Fragments are delimited in the system prompt and budgeted at 2,000 characters per fragment and 8,000 characters total across active plugins.
```

with:

```md
Prompt fragments are synchronous strings or synchronous functions returning strings. Async prompt fragments are not supported. Fragments are delimited in the system prompt and budgeted at 2,000 characters of plugin content per fragment and 8,000 characters total across active plugins.
```

Add this paragraph under the config/eligibility section:

```md
Admin-scoped plugin config stays in the admin UI. Context-scoped plugin config declared through `contributes.configKeys` appears in `/config` and is written to the per-context plugin config store under the plugin's namespace.
```

- [ ] **Step 2: Align the synthetic plugin manifest with the explicit context/admin split**

In `plugins/synthetic-web-search/plugin.json`, insert an explicit empty `configKeys` declaration so the example manifest shows the intended contract:

```json
  "contributes": {
    "tools": ["search"],
    "promptFragments": ["web-search-hint"],
    "configKeys": []
  },
```

- [ ] **Step 3: Run focused final verification**

Run:

```bash
bun test tests/plugins/discovery.test.ts tests/plugins/manifest-schema.test.ts tests/plugins/loader.test.ts tests/plugins/context.test.ts tests/plugins/tool-runtime.test.ts tests/plugins/synthetic-web-search.test.ts tests/plugins/registry-context-eligibility.test.ts tests/chat/plugin-interaction-handler.test.ts tests/commands/config.test.ts tests/debug/instance-routes.test.ts tests/plugins/provider-runtime.test.ts tests/tools/tool-preferences.test.ts
```

Expected: PASS.

Run:

```bash
bun typecheck
```

Expected: PASS.

Run:

```bash
bun lint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/plugins/developer-guide.md plugins/synthetic-web-search/plugin.json plugins/synthetic-web-search/index.ts src/plugins/discovery.ts src/plugins/types.ts src/plugins/context.ts src/plugins/loader.ts src/plugins/runtime-types.ts src/plugins/tool-runtime.ts src/plugins/registry-context-eligibility.ts src/chat/plugin-interaction-handler.ts src/config-keys.ts src/commands/config.ts src/config-editor/handlers.ts src/debug/instance-config-validation.ts src/plugins/provider-runtime.ts src/tools/tool-metadata.ts tests/plugins/discovery.test.ts tests/plugins/manifest-schema.test.ts tests/plugins/loader.test.ts tests/plugins/context.test.ts tests/plugins/tool-runtime.test.ts tests/plugins/synthetic-web-search.test.ts tests/plugins/registry-context-eligibility.test.ts tests/chat/plugin-interaction-handler.test.ts tests/commands/config.test.ts tests/debug/instance-routes.test.ts tests/plugins/provider-runtime.test.ts tests/tools/tool-preferences.test.ts
git commit -m "fix(plugins): align review remediation with runtime contract"
```
