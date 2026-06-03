<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0157: Plugin Review Follow-Up Fixes

## Status

Implemented

## Date

2026-05-29 – 2026-06-02

## Context

After the task-provider-as-plugin migration (ADR-0123, phases 3–5) landed, a
review of the plugin command surface, provider registry, and contribution
assembly revealed four pre-existing issues that were not blocking the migration
but warranted correction:

1. `/plugin disable` wrote context state unconditionally for any plugin ID,
   including typos and non-active plugins, creating ghost rows.
2. `registerPluginCommand()` accepted an unused `adminUserId` parameter
   (underscore-prefixed to suppress lint) that no call site needed.
3. The provider registry exported `getContributedTaskProviderType()` solely for
   tests, and a module-private `ProviderFactory` type alias duplicated
   `TaskProviderFactory`.
4. Tool-name collisions in `buildPluginToolSet()` were logged as warnings but
   left no auditable record; `/plugin info` could not surface them.

A separate design spec (`docs/archive/2026-05-29-task-provider-plugin-followups.md`)
captured broader deferred follow-ups (core→plugin provisioning decoupling,
descriptor-driven config pre-check, sensitive-key masking, E2E coverage); those
remain unscheduled and are out of scope for this ADR.

## Decision Drivers

- **Command correctness**: Admin commands must validate their targets before
  mutating state, matching the validation already applied to `/plugin enable`.
- **Dead-code hygiene**: Unused parameters and test-only exports add cognitive
  load and widen the public API surface without benefit.
- **Operational observability**: Plugin tool collisions are rare but confusing
  when they occur; runtime diagnostics must capture them without introducing a
  new alerting surface.
- **Minimal diff**: Each fix stays local to the responsible module; no new
  tables, routes, or UI surfaces.

## Considered Options

### Option A: Status quo — leave all four issues as-is

- **Pros**: Zero effort; no regression risk from touching working paths.
- **Cons**: Ghost state rows accumulate on typoed disable commands; unused API
  remains; collisions stay invisible.

### Option B: Fix all four issues (chosen)

- **Pros**: Command validation matches enable parity; dead code removed;
  collisions visible via existing `/plugin info` diagnostics.
- **Cons**: Small blast radius across command, registry, and contribution
  modules; requires coordinated test updates.

### Option C: Fix command validation only, defer remainder

- **Pros**: Addresses the only user-facing bug.
- **Cons**: Leaves test-only export and invisible collisions; cleanup cost does
  not decrease with time.

## Decision

**Option B.** Four targeted fixes:

| Finding                                             | Decision                                                                                              | File(s)                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `/plugin disable` ghost-write                       | Validate target exists and is `active` before writing, mirroring `/plugin enable` gating.             | `src/commands/plugin.ts`               |
| Unused `adminUserId` parameter                      | Remove from signature and both call sites (`src/bot.ts`, test helper).                                | `src/commands/plugin.ts`, `src/bot.ts` |
| Test-only `getContributedTaskProviderType()` export | Delete; rewrite tests to use `getTaskProviderDescriptor()` and `createProvider()`.                    | `src/providers/registry.ts`            |
| Redundant `ProviderFactory` alias                   | Inline `TaskProviderFactory` at the three usage sites.                                                | `src/providers/registry.ts`            |
| Tool-name collision invisibility                    | Record a `skipped` runtime event via `recordRuntimeEvent()` so `/plugin info` surfaces the collision. | `src/plugins/contributions.ts`         |

### What was explicitly not changed

- **Startup race**: `src/index.ts` already awaits `activatePlugins()` before
  chat/scheduler/poller startup; no fix needed.
- **`TaskProviderTypeDescriptor.configSchema` compatibility**: intentional
  backward-compat shim; not dead code.
- **`/config` inactive-vs-disabled wording**: `/config` filters to active
  plugins; inactive plugins are absent rather than mislabeled.

## Consequences

### Positive

- `/plugin disable` no longer creates phantom context-state rows for unknown or
  inactive plugin IDs; admin gets immediate feedback (`not found` / `not active`).
- Narrower public API: one fewer export from the provider registry; no unused
  parameter in the plugin command registration.
- Tool collisions are inspectable via `/plugin info <id>` recent events without
  adding any new UI surface or database table.
- Tests assert through production-facing APIs (`getTaskProviderDescriptor`,
  `createProvider`) rather than a test-only lookup function.

### Negative

- Slightly stricter `/plugin disable`: a plugin that was active but
  deactivated mid-session cannot be disabled per-context until next startup
  re-activates it. This is consistent with how `enable` already works.
- Collision runtime events accumulate in `plugin_runtime_events`; no auto-prune
  exists (same as existing `error`/`activated` events).

### Risks

- Low: each fix is local and independently testable; the widest change (registry
  test rewrite) replaces one assertion style with another over the same
  underlying data.

## Implementation Notes

- `handleDisable()` in `src/commands/plugin.ts` now checks
  `pluginRegistry.getEntry(pluginId)` and `entry.state !== 'active'` before
  calling `setPluginEnabledForContext()`.
- `registerPluginCommand(chat: ChatProvider): void` — single parameter;
  `src/bot.ts` call site updated.
- `src/providers/registry.ts`: deleted `getContributedTaskProviderType()` and
  `type ProviderFactory = TaskProviderFactory`; inlined `TaskProviderFactory` at
  the three consumer sites.
- `src/plugins/contributions.ts`: collision branch in `buildPluginToolSet()`
  calls `recordRuntimeEvent(pluginId, 'skipped', message)` before `continue`.
- No new migrations, routes, or UI surfaces.

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — the plugin model these fixes refine.
- ADR-0009: Multi-Provider Task Tracker Support — provider registry that lost a
  test-only export.
- `docs/archive/2026-05-29-task-provider-plugin-followups.md` — deferred
  follow-ups (core→plugin provisioning decoupling, descriptor-driven config
  check, sensitive-key masking, E2E coverage) not addressed here.
