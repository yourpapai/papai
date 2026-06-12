<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0128: Multi-Provider Phase 5: Plugin Alignment

## Status

Implemented

## Date

2026-05-24 – 2026-05-24

## Context

After Phase 4, `ChatRouter` manages active platform instances and
`TaskProviderResolver` resolves task providers per context. Plugin
compatibility and eligibility were still evaluated globally at startup
against a single admin-context provider (`defaultTaskProviderResolver.resolve(adminUserId)`)
and aggregate `chatProvider.capabilities`. A plugin declaring
`requiredTaskCapabilities: ['workItems.list']` would be marked
incompatible if the admin's provider happened to lack that capability,
even when other contexts' assigned providers supported it.

Per-context eligibility (`getPluginContextEligibility`) recognized
`inactive`, `disabled`, and `config_missing` failure reasons but not
`capability_missing`. Scheduled jobs ran for every enabled context
without checking eligibility or whether a task provider could be
resolved, allowing execution against contexts where the plugin could not
function.

No DB schema changes were needed; plugin alignment is purely a runtime
and registry concern.

Plan: `docs/archive/2026-05-24-multi-provider-phase-5-plugin-alignment-plan.md`.

## Decision Drivers

- **Multi-instance correctness**: Plugin compatibility must reflect all
  active instance capability sets, not just the admin's single provider.
- **Per-context precision**: A plugin whose required capabilities are
  missing in one context but present in another must be eligible for the
  capable context and excluded from the incapable one.
- **No schema change**: The plugin storage model is stable; alignment
  must not require a migration.
- **Operator visibility**: Admin-facing surfaces (`/plugin info`,
  `/config`) must display missing capability details so operators can
  diagnose why a plugin is unavailable in a context.
- **Scheduled job safety**: Jobs must not execute in contexts where the
  plugin is ineligible or where a required task provider cannot be
  resolved.

## Considered Options

### Option A: Global compatibility with per-context capability override

Keep startup compatibility as a single global check. Override at
per-context eligibility time if the assigned provider differs.

- **Pros**: Minimal startup change.
- **Cons**: A plugin globally marked `incompatible` will not activate,
  so per-context override is never reached. This reproduces the Phase 4
  problem.

### Option B: Cross-instance startup compatibility + per-context capability eligibility (chosen)

Evaluate startup compatibility across all active task/chat instance
capability pairs. A plugin remains `approved` if any pair satisfies its
requirements. Per-context eligibility adds `capability_missing` when the
assigned instance lacks a required capability.

- **Pros**: Correct global and per-context behavior; no schema change;
  operator surfaces expose missing capability details.
- **Cons**: Startup must enumerate all active instances; per-context
  eligibility gains one more check path.

### Option C: Defer all capability checks to per-context time

Remove startup compatibility evaluation entirely. Every plugin with
admin approval activates; capability gating happens only when tools or
prompt fragments are assembled for a specific context.

- **Pros**: Simplest startup path.
- **Cons**: An approved plugin with no satisfiable instance activates
  uselessly; logging and diagnostics are weaker at startup.

## Decision

**Option B** with the following subsidiary decisions:

| Topic                   | Decision                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup compatibility   | `evaluateCompatibilityAcrossInstances()` replaces the single-provider check. A plugin stays `approved` if any active instance pair satisfies its requirements; otherwise it becomes `incompatible`.                                                                                                                                       |
| Compatibility instances | `PluginCompatibilityInstance` bundles a `ReadonlySet<TaskCapability>` and `ReadonlySet<ChatCapability>`. `collectStartupCompatibilityInstances()` builds the cross-product from active task and platform instances.                                                                                                                       |
| Per-context eligibility | `PluginContextEligibility` gains `capability_missing` with a `missingCapabilities` array. Checked after existing `inactive`/`disabled`/`config_missing` gates.                                                                                                                                                                            |
| Capability lookup       | `getCapabilitiesForTaskInstance()` in the provider registry creates a provider with dummy credentials to read its capability set. `ChatRouter.getPlatformInstanceCapabilities()` returns capabilities for a managed platform instance.                                                                                                    |
| Scheduled jobs          | `runPluginScheduledJob()` checks `getPluginContextEligibility()` before executing. For plugins with task-related permissions, it also calls `resolveTaskProvider(contextId)` and skips contexts where resolution returns `null`. Job execution errors are caught per-context so one failure does not prevent other contexts from running. |
| Operator surfaces       | `/plugin info` lists required task/chat capabilities and per-context missing capabilities. `/config` plugin rows show `unavailable (missing capability: ...)`.                                                                                                                                                                            |
| Tool runtime            | `PluginToolRuntimeContext` shape is unchanged. Plugin tool assembly already receives the context-resolved provider; the eligibility check prevents incompatible plugins from appearing in the tool set at all.                                                                                                                            |
| No migration            | Phase 5 adds no DB schema changes. All alignment is in-memory runtime logic.                                                                                                                                                                                                                                                              |

## Consequences

### Positive

- A plugin declaring `requiredTaskCapabilities` is no longer blocked by
  the admin provider's capabilities; it activates if any active instance
  satisfies the requirement.
- Per-context `capability_missing` gives precise diagnostics at the
  point of use rather than a misleading global `incompatible` label.
- Scheduled jobs no longer silently execute in contexts where the
  plugin cannot function.
- Operator commands surface missing capability details, reducing
  troubleshooting friction.

### Negative

- Startup compatibility enumeration is O(active task instances × active
  platform instances); in practice this is small (single-digit) but is
  no longer a constant-time lookup.
- `getCapabilitiesForTaskInstance()` instantiates a provider with dummy
  credentials to read capabilities; this is a minor overhead at startup.
- Per-context eligibility adds one more branch to the eligibility path,
  increasing the test surface.

### Risks

- If a provider's capability set depends on credentials (not just
  provider type), the dummy-credential lookup may under-report
  capabilities. Current providers (Kaneo, YouTrack) have type-determined
  capabilities, so this risk is theoretical today.
- Mitigation: capability sets are defined at provider construction time
  from the provider type, not from credential validation responses.

## Implementation Notes

Key modules changed or created:

| File                                   | Change                                                                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/plugins/registry.ts`              | Added `PluginCompatibilityInstance`, `evaluateCompatibilityAcrossInstances()`, `capability_missing` to `PluginContextEligibility`, `getMissingRequiredCapabilities()` |
| `src/plugins/startup-compatibility.ts` | New: `collectStartupCompatibilityInstances()` and `buildCompatibilityInstances()`                                                                                     |
| `src/providers/registry.ts`            | Added `getCapabilitiesForTaskInstance()`                                                                                                                              |
| `src/chat/router.ts`                   | Added `getPlatformInstanceCapabilities()`                                                                                                                             |
| `src/index.ts`                         | Replaced single-provider compatibility call with `evaluateCompatibilityAcrossInstances()`                                                                             |
| `src/plugins/contributions.ts`         | `runPluginScheduledJob()` now checks eligibility and resolver guards                                                                                                  |
| `src/commands/plugin.ts`               | `/plugin info` shows required and missing capabilities                                                                                                                |
| `src/commands/config.ts`               | `/config` plugin rows show `capability_missing` status                                                                                                                |

No migration was added. No plugin tool runtime or `PluginToolSetRuntime`
contract changed.

Plan file:
`docs/archive/2026-05-24-multi-provider-phase-5-plugin-alignment-plan.md`

## Related Decisions

- ADR-0009: Multi-Provider Task Tracker Support — provider capability
  model that plugin compatibility evaluation builds on.
- ADR-0123: Trusted-Local Plugin System — plugin registry, eligibility,
  and contribution architecture that Phase 5 extends.
- ADR-0124: Multi-Provider Phase 1 — instance data model and
  `TaskProviderResolver` that Phase 5 consumes.
- ADR-0125 through ADR-0127: Multi-Provider Phases 2–4 — context
  assignment and `ChatRouter` runtime that Phase 5 aligns with.
