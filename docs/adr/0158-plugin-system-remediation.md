<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0158: Plugin System Remediation

## Status

Implemented

## Date

2026-05-28 – 2026-06-02

## Context

The plugin system MVP (ADR-0123) and its first remediation pass (ADR-0156)
closed approval hashing, activation staging, config consistency, and manifest
validation gaps. A follow-up architecture review on 2026-05-28 identified
remaining lifecycle, eligibility, and documentation defects that do not widen
plugin capabilities but leave the system fragile at the boundaries between
provider resolution, plugin eligibility, startup ordering, command gating, and
contributed provider cleanup.

Confirmed defects:

- Unknown or removed contributed task-provider types throw through
  conversations instead of returning an unavailable state, crashing the LLM
  pipeline for any context whose assigned task instance references a provider
  type no longer registered.
- Plugin eligibility (`getPluginContextEligibility`) and startup compatibility
  collection abort when they encounter an unknown provider type, rather than
  degrading gracefully.
- Startup activates plugins after command registration and chat-provider start,
  so contributed plugin commands are invisible on the first boot.
- Plugin command handlers execute without checking per-context eligibility; a
  disabled or ineligible plugin's commands still run.
- Deactivating a plugin that contributed a provider type leaves dependent active
  task instances orphaned; the instances remain `active` but the provider
  factory is gone.
- Default-enabled scheduled jobs only enumerate explicitly enabled context
  rows, missing all configured contexts that have not opted out.
- Plugin tool runtime does not expose the identity facade even for plugins that
  declare `identity` permission and a single contributed provider type.
- Plugin interaction handlers and tool-toggle handlers duplicate a local
  target-context authorization helper instead of sharing the one in
  `plugin-auth.ts`. Disable interactions write ghost rows for unknown plugins.
- Prompt fragment assembly propagates a throwing fragment, failing the entire
  prompt section for all plugins. The provider runtime's `Object.freeze(new
Set())` comment claims immutability, but `Set` entries are not frozen.
- The single-instance `evaluateCompatibility()` method remains on the registry
  despite being superseded by `evaluateCompatibilityAcrossInstances()`; tests
  still call the stale API.
- Plugin developer documentation and `CLAUDE.md` permissions list are stale
  relative to the current runtime surface.

## Decision Drivers

- **Fail closed**: Unknown or removed provider types must degrade to
  unavailable, not throw through the conversation pipeline.
- **No orphaned state**: Deactivating a contributed provider plugin must stop
  dependent task instances before unregistering the factory.
- **Commands are visible on first boot**: Plugin activation must precede
  command registration so contributed commands are present.
- **Eligibility gates commands**: Plugin commands must check context
  eligibility at execution time, not just at registration time.
- **Default-enabled jobs must run**: A `defaultEnabled` plugin's scheduled jobs
  must execute for all configured contexts that have not explicitly opted out.
- **Minimal scope**: Fix confirmed defects without redesigning the plugin
  system or changing the trust model.

## Considered Options

### Option A: Provider-type registry health monitor

Add a background process that continuously reconciles task instances with
registered provider types and stops orphans automatically.

- **Pros**: Decouples cleanup from deactivation; handles unexpected factory
  removal.
- **Cons**: Adds a long-running daemon; over-engineered for a startup-only
  concern; race conditions between monitor and deactivation.

### Option B: Targeted remediation at existing boundaries (chosen)

Make the smallest coherent fixes: resolver returns `null` for unknown types,
eligibility and compatibility skip unknown types, deactivation stops
dependencies, startup reorders activation before bot setup, commands gate on
eligibility, default-enabled jobs enumerate configured contexts, identity
facade is exposed when declared, shared authorization prevents ghost rows,
prompt fragments are isolated, stale API is removed, and docs are updated.

- **Pros**: Each fix is independently testable; preserves the MVP shape; no
  schema changes beyond existing plugin tables.
- **Cons**: Lower-severity items (prompt budget approximation, partial permission
  enforcement gaps) remain unfixed.

### Option C: Remove contributed provider types entirely

Stop supporting `contributes.taskProviderTypes` until the plugin system is more
mature.

- **Pros**: Eliminates the entire class of orphaned-provider defects.
- **Cons**: Already-deployed Kaneo and YouTrack provider plugins depend on this
  surface; removal is a breaking change.

## Decision

**Option B**, organized into six workstreams:

| Workstream                      | Decisions                                                                                                                                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fail closed                     | `TaskProviderResolver.resolve()` returns `null` with a warning when the provider type is unknown. Eligibility returns `capability_missing` instead of throwing. Startup compatibility skips unknown types rather than aborting.                                                                               |
| Contributed provider lifecycle  | `unregisterContributedTaskProviderType()` returns the list of removed types. A new `deactivateContributedTaskProviderTypes()` helper stops active task instances whose type belongs to the deactivating plugin, then unregisters the factories. Loader calls this before removing contributions.              |
| Startup ordering & command gate | Plugin discovery, evaluation, and activation move before `setupBot()` and `chatProvider.start()`. Command handlers check `getPluginContextEligibility` at execution time and reply with a formatted denial message for ineligible contexts. A new `formatPluginEligibilityMessage()` helper centralizes that. |
| Default-enabled jobs            | Scheduled jobs enumerate runnable contexts as the union of configured context settings (minus explicit opt-outs) plus explicit enabled rows, instead of only explicit enabled rows. A new `listContextSettings()` helper and `getContextStatesForPlugin()` helper support this.                               |
| Identity facade                 | `PluginToolRuntimeContext` gains an optional `identity` field. `buildRuntimeIdentity()` returns the facade when `identity` permission and exactly one `contributes.taskProviderTypes` entry are present. Provider-runtime `allowedHosts` comment is corrected: security comes from a private closed-over set. |
| Shared auth & isolation         | `canManageInteractionTargetContext()` in `plugin-auth.ts` is the single shared target-context authorization helper. Plugin interaction handlers refuse unknown plugins instead of writing ghost disable rows. Prompt fragment failures are caught and the bad fragment is skipped; other fragments remain.    |
| Stale API removal               | Single-instance `evaluateCompatibility()` is removed; all tests migrate to `evaluateCompatibilityAcrossInstances()`. `CLAUDE.md` and `docs/plugins/developer-guide.md` are updated to reflect current permissions, contributed provider surface, identity runtime, and command eligibility behavior.          |

## Consequences

### Positive

- Unknown provider types degrade gracefully; the LLM pipeline is not disrupted
  for contexts whose assigned provider type was removed.
- Deactivating a contributed-provider plugin cleanly stops dependent task
  instances; no orphaned active instances remain.
- Plugin commands are visible on first boot and gated by eligibility at
  execution time.
- Default-enabled scheduled jobs now run for all configured contexts, not just
  those with explicit enable rows.
- Identity facade is available to provider plugins that declare the `identity`
  permission, completing the declared runtime surface.
- Single shared authorization helper eliminates code duplication and prevents
  ghost disable rows for unknown plugins.
- A throwing prompt fragment fails one plugin, not the entire prompt section.
- Stale `evaluateCompatibility()` API is removed, preventing future misuse.

### Negative

- Resolver returning `null` for unknown providers means a context with a
  removed provider type has no task functionality until the admin reassigns the
  task instance or reinstates the plugin.
- Stopping task instances on deactivation is immediate; no grace period for
  in-flight tool calls against the contributed provider.
- Default-enabled job enumeration reads all context settings on each job run,
  adding a DB query per scheduled execution.

### Risks

- A context with a removed provider type will silently lose task capabilities
  until an admin intervenes. Mitigation: the resolver logs a `WARN` with the
  context and instance details; the eligibility reason `capability_missing` is
  visible in the settings UI.
- The `capability_missing` eligibility reason for unknown provider types is
  identical to a legitimate capability gap. Mitigation: the resolver warning
  distinguishes "type not registered" from "capability missing" in logs.

## Implementation Notes

Modules changed (`src/plugins/`):

| File                              | Changes                                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `task-provider-lifecycle.ts`      | New helper: stops active task instances for a deactivating plugin, then unregisters provider types                    |
| `eligibility-message.ts`          | New helper: formats `PluginContextEligibility` into user-facing denial text                                           |
| `registry-context-eligibility.ts` | `safeTaskCapabilities()` wraps unknown provider reads; returns `emptyTaskCapabilities()` on error                     |
| `command-contributions.ts`        | Command handler checks eligibility before executing; replies with formatted denial                                    |
| `contributions.ts`                | `getScheduledJobContextIds()` replaces `getEnabledContextsForPlugin()` for default-enabled enumeration                |
| `store.ts`                        | `getContextStatesForPlugin()` returns explicit enabled/disabled rows for a plugin                                     |
| `runtime-types.ts`                | `PluginToolRuntimeContext` gains optional `identity?: PluginIdentityFacade`                                           |
| `tool-runtime.ts`                 | `buildRuntimeIdentity()` attaches identity facade when `identity` permission and one provider type are declared       |
| `prompt-contributions.ts`         | Try/catch around fragment content resolution; bad fragments are skipped with a warning                                |
| `provider-runtime.ts`             | Private enforcement `hostSet` closed over by `httpFetch`; exposed set is a diagnostic copy                            |
| `loader.ts`                       | Calls `deactivateContributedTaskProviderTypes()` before unregistering contributions                                   |
| `registry.ts`                     | Removes `evaluateCompatibility()`; `unregisterContributedTaskProviderType()` returns removed types; adds owner lookup |

Other modules:

| File                                          | Changes                                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/providers/resolver.ts`                   | Returns `null` with a warning when provider creation fails for an unknown type                                 |
| `src/providers/registry.ts`                   | `listContributedTaskProviderTypesForPlugin()`; `unregisterContributedTaskProviderType()` returns removed types |
| `src/plugins/startup-compatibility.ts`        | `activeTaskCapabilitySets()` skips unknown provider types instead of aborting                                  |
| `src/instances/context-store.ts`              | `listContextSettings()` for default-enabled job enumeration                                                    |
| `src/commands/plugin-auth.ts`                 | `canManageInteractionTargetContext()` shared helper                                                            |
| `src/chat/plugin-interaction-handler.ts`      | Uses shared auth; refuses unknown plugins before writing ghost rows                                            |
| `src/chat/tool-toggle-interaction-handler.ts` | Uses shared auth helper                                                                                        |
| `src/index.ts`                                | Plugin activation moves before `setupBot()` and `chatProvider.start()`                                         |
| `CLAUDE.md`                                   | Updated permissions, contributed provider surface, identity runtime docs                                       |
| `docs/plugins/developer-guide.md`             | Updated permissions, identity runtime, command eligibility, provider manifest fields                           |

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — the MVP this remediation closes gaps
  in.
- ADR-0156: Plugin Review Remediation — first remediation pass (approval
  hashing, activation staging, config consistency).
- ADR-0009: Multi-Provider Task Tracker Support — provider capability model
  that contributed provider-type registration builds on.
- ADR-0036: Centralized Scheduler Utility — scheduler integration point for
  plugin job contributions.
