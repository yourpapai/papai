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
**Depends on:** Phase 1 (Instance Data Model), Phase 2 (TaskProviderResolver), Phase 3 (ChatRouter), Phase 4 (admin/runtime router holder and instance dashboard API)
**Ships independently:** Yes — without this phase plugins still work; capability checks just stay global.

## Summary

Make plugin compatibility multi-provider-aware. At startup, `checkPluginCompatibility` is evaluated across active task instances and active chat instances; a plugin is only marked `incompatible` if no active task/chat capability combination satisfies its manifest requirements. At request time, `getPluginContextEligibility(pluginId, contextId)` adds a `capability_missing` reason that fires when the context's assigned task or platform instance lacks a required capability. Plugin scheduled jobs continue to receive only `execute(contextId)`, but the scheduler path checks eligibility and uses `TaskProviderResolver.resolve(contextId)` as a guard for plugins that need task-provider access.

## Requirements

- `checkPluginCompatibility` continues to take a single task / chat capability set (no breaking signature change)
- A new `evaluateCompatibilityAcrossInstances(instances)` method on `PluginRegistry` accepts an array of `{taskCapabilities, chatCapabilities}` and marks `approved` plugins `incompatible` only when **no** entry satisfies the manifest requirements
- `PluginContextEligibility` gains a `capability_missing` discriminant that includes a list of missing capability strings
- `runPluginScheduledJob` iterates `getEnabledContextsForPlugin(pluginId)`, checks `getPluginContextEligibility(pluginId, contextId)`, calls `resolver.resolve(contextId)` when the plugin manifest needs a task provider, and skips with a warning when resolution returns null
- The plugin tool runtime still consumes `runtime.provider`; Phase 2 already moved normal and proactive tool assembly to `TaskProviderResolver.resolve(contextId)`, so Phase 5 locks that behavior in with regression coverage instead of changing `PluginToolSetRuntime`
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

`src/index.ts` collects capability sets by reading active platform instances from the running `ChatRouter` and active task instances from `listTaskInstances().filter((instance) => instance.status === 'active')`. Task capability sets come from `getCapabilitiesForTaskInstance(instance)`. Chat capability sets come from `chatProvider.getPlatformInstanceCapabilities(instance.id)`. Startup then builds task/chat compatibility entries from the Cartesian product of active task capability sets and active chat capability sets; if either side is empty, it uses one empty capability set for that side so plugins with no requirements can still activate. Activation is then attempted only for plugins still in `approved` state. Startup no longer evaluates plugin compatibility against only the admin user's resolved task provider.

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

1. Read `getContextSettings(contextId)`. If absent, skip the capability check — the context is pre-setup and the existing setup-driven UX already covers it.
2. Resolve the assigned `task_instances` row with `getTaskInstance(settings.taskInstanceId)` and read its `capabilities` set. Missing or non-active task instances produce an empty set.
3. Resolve the assigned platform instance through the running `ChatRouter` and read its `capabilities` set. Missing runtime routers or missing platform instances produce an empty set.
4. If any `manifest.requiredTaskCapabilities` or `requiredChatCapabilities` is missing, return `{eligible: false, reason: 'capability_missing', missingCapabilities: [...]}`.
5. Otherwise, return `{eligible: true}`.

Helpers added:

- `getCapabilitiesForTaskInstance(instance: TaskInstance): ReadonlySet<TaskCapability>` (lives in `src/providers/registry.ts`; constructs a transient provider or reads a static map keyed by `instance.type`)
- `ChatRouter.getPlatformInstanceCapabilities(id: string): ReadonlySet<ChatCapability>` (lives in `src/chat/router.ts`; reads an existing managed instance)

`ChatRouter.getPlatformInstanceCapabilities()` returns an empty set when the instance is unknown. Context eligibility treats missing or inactive task instance rows as an empty task capability set, so `capability_missing` fires for any required capability.

### Surface effects

- `getPluginsForContext(contextId)` already filters by eligibility — once the new reason is added, capability-missing plugins disappear from that context's tool set and prompt fragments.
- `/plugin info <id>` reports the plugin's required task/chat capabilities and, for the command source context, reports `capability_missing` details when present.
- `/config` plugin rows report `unavailable (missing capability: ...)` when the selected target context lacks required capabilities.

## Section 3: Plugin Scheduled Jobs

```typescript
export async function runPluginScheduledJob(pluginId: string, jobName: string): Promise<void> {
  const contributions = contributionRegistry.getContributions(pluginId)
  const job = contributions?.jobs.find((j) => j.name === jobName)
  if (job === undefined || contributions === undefined) return

  for (const contextId of getEnabledContextsForPlugin(pluginId)) {
    const eligibility = getPluginContextEligibility(pluginId, contextId)
    if (!eligibility.eligible) {
      log.warn({ pluginId, jobName, contextId }, 'Plugin job skipping context — not eligible')
      continue
    }
    if (pluginNeedsTaskProvider(contributions.manifest) && defaultTaskProviderResolver.resolve(contextId) === null) {
      log.warn({ pluginId, jobName, contextId }, 'Plugin job skipping context — task provider unresolved')
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

Eligibility check folds in disabled, config-missing, and capability-missing states — one branch, one rule. The resolver guard is only for plugins whose manifest declares `tasks.read`, `tasks.write`, or required task capabilities; jobs without task-provider needs still run without resolving a task provider.

## Section 4: Tool Runtime Plumbing

`buildPluginToolSet(activePluginIds, existingToolNames, runtime)` continues to accept a `PluginToolSetRuntime`:

```typescript
type PluginToolSetRuntime = {
  provider: TaskProvider
  storageContextId: string
  chatUserId: string
}
```

The plugin tool runtime context (`buildPluginToolRuntimeContext`) is untouched — the per-permission facades remain identical in shape. Phase 2 already made the normal LLM/proactive call paths resolve task providers through `TaskProviderResolver`; Phase 5 adds regression coverage to ensure plugin tools receive the context-resolved provider and no legacy `buildProviderForUser` path is reintroduced.

## Section 5: Out of Scope

- Provider-as-plugin migration (the optional Phase 3 of the original plugin design) is **not** included. Providers stay in `src/providers/` and `src/chat/`. A separate future spec can layer that on without revisiting the contracts here.
- Per-context plugin approval — approval stays global because plugins are repository-local and trusted.
- Cross-context plugin KV sharing — KV remains `(pluginId, contextId, key)`-scoped.

## Section 6: Testing Strategy

- **`tests/plugins/registry.test.ts`** — `evaluateCompatibilityAcrossInstances` with multiple instances; `capability_missing` returned per context
- **`tests/plugins/startup-compatibility.test.ts`** — active task/platform capability collection and startup compatibility entry construction without loading plugins
- **`tests/plugins/contributions.test.ts`** — `runPluginScheduledJob` skips contexts whose resolver returns null and skips ineligible contexts
- **`tests/plugins/integration.test.ts`** — end-to-end: enable plugin requiring `workItems.list` on a context assigned to a task instance lacking that capability → tool list excludes the plugin tool; same plugin on a context assigned to a task instance with that capability → tool list includes it
- Existing fixtures already cover plugin manifests with required capabilities; new tests should use DB-backed context assignments rather than adding new schema or test infrastructure

## Section 7: Migration Steps

This phase ships as a single PR with these atomic commits:

1. Add `evaluateCompatibilityAcrossInstances` (no callers) + tests
2. Add task/chat capability lookup helpers and wire `src/index.ts` startup compatibility through them
3. Add `capability_missing` to `PluginContextEligibility` and surface it in `/plugin info` and `/config`
4. Update `runPluginScheduledJob` to use eligibility and resolver guards
5. Add plugin tool-runtime regression coverage proving context-resolved providers are used
