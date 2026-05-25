<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Router — Phase 5: Plugin System Alignment

**Date:** 2026-04-13
**Status:** Approved
**Parent:** [`2026-04-13-multi-provider-router-design.md`](./2026-04-13-multi-provider-router-design.md)
**Depends on:** Phase 1 (Instance Data Model), Phase 2 (Resolver), Phase 3 (ChatRouter)
**Ships independently:** Yes — without this phase plugins still work; capability checks just stay global.

## Summary

Make plugin compatibility multi-provider-aware. At startup, `checkPluginCompatibility` is evaluated against the union of all active task and chat instances; a plugin is only marked `incompatible` if no active instance satisfies its requirements. At request time, `getPluginContextEligibility(pluginId, contextId)` adds a `capability_missing` reason that fires when the context's resolved task or platform instance lacks a required capability. Plugin scheduled jobs use the resolver per enabled context and skip cleanly when the resolver returns null.

## Requirements

- `checkPluginCompatibility` continues to take a single task / chat capability set (no breaking signature change)
- A new `evaluateCompatibilityAcrossInstances(instances)` method on `PluginRegistry` accepts an array of `{taskCapabilities, chatCapabilities}` and marks `approved` plugins `incompatible` only when **no** entry satisfies the manifest requirements
- `PluginContextEligibility` gains a `capability_missing` discriminant that includes a list of missing capability strings
- `runPluginScheduledJob` iterates `getEnabledContextsForPlugin(pluginId)`, calls `resolver.resolve(contextId)` when the plugin needs a task provider, and skips with a warning when resolution returns null
- The plugin tool runtime still consumes `runtime.provider` — only the caller switches from `buildProviderForUser` to `resolver.resolve(contextId)`
- No DB schema changes — plugin tables (`plugin_admin_state`, `plugin_context_state`, `plugin_kv`, `plugin_runtime_events`) stay as-is

## Section 1: Startup Compatibility Across Instances

```typescript
class PluginRegistry {
  evaluateCompatibilityAcrossInstances(
    instances: ReadonlyArray<{
      taskCapabilities: ReadonlySet<TaskCapability>
      chatCapabilities: ReadonlySet<ChatCapability>
    }>,
  ): void
}
```

Logic per approved entry:

1. If any `instances[i]` satisfies `checkPluginCompatibility(manifest, ...)`, the plugin stays `approved`.
2. Otherwise the entry transitions to `incompatible` with reason `'No active instance satisfies required capabilities'`.

`src/index.ts` collects capability sets by listing `listActivePlatformInstances()` and `listTaskInstances()` (status `active`), instantiating each via the existing provider/adapter constructors to read `.capabilities`, and passing the array in. Activation is then attempted only for plugins still in `approved` state.

## Section 2: Per-Context `capability_missing`

```typescript
export type PluginContextEligibility =
  | { eligible: true }
  | {
      eligible: false
      reason: 'inactive' | 'disabled' | 'config_missing'
      missingKeys?: readonly string[]
    }
  | { eligible: false; reason: 'capability_missing'; missingCapabilities: readonly string[] }
```

`getPluginContextEligibility(pluginId, contextId)` performs the existing checks (`inactive` → `disabled` → `config_missing`) and then, if all pass:

1. Read `getContextAssignment(contextId)`. If absent, skip the capability check — the context is pre-setup and the existing setup-driven UX already covers it.
2. Resolve the assigned `task_instances` row and read its `capabilities` set.
3. Resolve the assigned `platform_instances` row through the `ChatRouter` and read its `capabilities` set.
4. If any `manifest.requiredTaskCapabilities` or `requiredChatCapabilities` is missing, return `{eligible: false, reason: 'capability_missing', missingCapabilities: [...]}`.
5. Otherwise, return `{eligible: true}`.

Helpers added:

- `getCapabilitiesForTaskInstance(instance: TaskInstance): ReadonlySet<TaskCapability>` (lives in `src/providers/registry.ts`; constructs a transient provider or reads a static map keyed by `instance.type`)
- `getPlatformInstanceCapabilities(id: string): ReadonlySet<ChatCapability>` (lives in `src/chat/router.ts`; reads from the running `ChatRouter`)

Both helpers return empty sets when the instance is unknown (defensive — `capability_missing` will fire for any required capability).

### Surface effects

- `getPluginsForContext(contextId)` already filters by eligibility — once the new reason is added, capability-missing plugins disappear from that context's tool set and prompt fragments.
- `/plugin info <id>` and the `/admin#instances` Plugins surface (added in Phase 4 if planned, otherwise existing `/plugin` UX) report the missing capabilities so the operator knows what to add.

## Section 3: Plugin Scheduled Jobs

```typescript
export async function runPluginScheduledJob(pluginId: string, jobName: string): Promise<void> {
  const contributions = contributionRegistry.getContributions(pluginId)
  const job = contributions?.jobs.find((j) => j.name === jobName)
  if (job === undefined) return

  for (const contextId of getEnabledContextsForPlugin(pluginId)) {
    if (!getPluginContextEligibility(pluginId, contextId).eligible) {
      log.warn({ pluginId, jobName, contextId }, 'Plugin job skipping context — not eligible')
      continue
    }
    try {
      await job.execute(contextId)
    } catch (err) {
      log.error({ pluginId, jobName, contextId, err }, 'Plugin job execute threw')
    }
  }
}
```

Eligibility check folds in capability and config-missing — one branch, one rule.

## Section 4: Tool Runtime Plumbing

`buildPluginToolSet(activePluginIds, existingToolNames, runtime)` continues to accept a `PluginToolSetRuntime`:

```typescript
type PluginToolSetRuntime = {
  provider: TaskProvider
  storageContextId: string
  chatUserId: string
}
```

The only change is the caller (currently `src/tools/...`): construct `runtime.provider` via `defaultTaskProviderResolver.resolve(contextId)` instead of `buildProviderForUser`. The plugin tool runtime context (`buildPluginToolRuntimeContext`) is untouched — the per-permission facades remain identical in shape.

## Section 5: Out of Scope

- Provider-as-plugin migration (the optional Phase 3 of the original plugin design) is **not** included. Providers stay in `src/providers/` and `src/chat/`. A separate future spec can layer that on without revisiting the contracts here.
- Per-context plugin approval — approval stays global because plugins are repository-local and trusted.
- Cross-context plugin KV sharing — KV remains `(pluginId, contextId, key)`-scoped.

## Section 6: Testing Strategy

- **`tests/plugins/registry.test.ts`** — `evaluateCompatibilityAcrossInstances` with multiple instances; `capability_missing` returned per context
- **`tests/plugins/contributions.test.ts`** — `runPluginScheduledJob` skips contexts whose resolver returns null and skips ineligible contexts
- **`tests/plugins/integration.test.ts`** — end-to-end: enable plugin requiring `comments.read` on a Kaneo context (lacks capability) → tool list excludes the plugin tool; same plugin on a YouTrack context (has capability) → tool list includes it
- No new test infrastructure needed; existing fixtures already cover plugin manifests with required capabilities

## Section 7: Migration Steps

This phase ships as a single PR with these atomic commits:

1. Add `evaluateCompatibilityAcrossInstances` (no callers) + tests
2. Wire `src/index.ts` to call it during startup
3. Add `capability_missing` to `PluginContextEligibility` union and `getPluginContextEligibility`
4. Update `runPluginScheduledJob` to use the eligibility check
5. Update plugin tool-runtime callsite to use the resolver
