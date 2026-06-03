<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0130: Task-Provider-as-Plugin Phase 1: Plugin API Foundation

## Status

Implemented

## Date

2026-05-23 – 2026-05-24

## Context

Task providers (Kaneo, YouTrack) are hardcoded in `src/providers/registry.ts`.
Adding a new task-tracker integration requires editing core registry and factory
modules, creating merge conflicts and an opaque dual registration path. The
existing plugin system (ADR-0123) already supports tools, commands, and prompt
fragments — but it has no mechanism for a plugin to contribute a task-provider
type.

The full task-provider-as-plugin design (spec:
`docs/archive/2026-05-23-task-provider-as-plugin-design.md`) covers five rollout
phases: API foundation, registry integration, Kaneo migration, YouTrack
migration, and config-cleanup removal. This ADR covers Phase 1 only — the
router-independent plugin API surface that introduces the provider-contribution
model without wiring any consumers.

The Multi-Provider Router (branches `claude/multi-provider-phase-1-plan-8kqwN`,
not yet on `master`) introduces `task_instances`, the resolver, and per-instance
config. Phase 1 is deliberately independent of the router: it builds and ships on
`master` today, and Phase 2 consumes the contributed-provider map once the
router merges.

## Decision Drivers

- **Shippable increment**: the registry map and facades must be exercised by
  tests and the loader so Phase 2 builds on a stable, tested surface without
  rework — even though no core caller consumes the map yet.
- **Router independence**: changes must not depend on `task_instances`,
  `defaultTaskProviderResolver`, or any code not yet on `master`.
- **Security**: plugins must never receive raw `fetch`, raw DB handles, raw
  providers, or `process.env`. Network egress is allowlisted; identity
  persistence stays in core behind a facade.
- **Manifest staticity**: capabilities, config schema, and allowed hosts are
  manifest-declared (available before any instance exists); the factory is
  dynamic (one call per `task_instances` row in Phase 2).
- **Single type per plugin**: keeps approval reasoning and future capability
  resolution simple. Validated at the schema level.

## Considered Options

### Option A: Provider plugins as a separate registration path

Introduce a distinct `ProviderPlugin` kind with its own discovery, approval,
and lifecycle, separate from tool/command plugins.

- **Pros**: cleaner conceptual separation; provider-specific admin UX from day
  one.
- **Cons**: duplicates most of the plugin machinery; a provider plugin that
  also contributes tools would need two manifests; admin surface doubles.

### Option B: Extend the existing plugin system with provider contributions (chosen)

A single plugin can declare `contributes.taskProviderTypes` alongside tools,
commands, and prompt fragments. One manifest, one approval, one lifecycle.

- **Pros**: no new discovery/approval flow; a single integration (e.g.
  `jira`) ships both a task provider and a sprint-burndown tool together.
- **Cons**: the plugin manifest grows larger; provider plugins must be
  distinguished from tool-only plugins at runtime by permissions.

### Option C: Contribute provider types without the `provider.task` permission gate

Let any plugin declare `taskProviderTypes` and register a factory; rely on admin
approval alone for trust.

- **Pros**: simpler manifest; one fewer permission to manage.
- **Cons**: the permission gate is the runtime enforcement layer; approval is a
  one-time admin decision, but the permission is checked on every registration
  call, preventing accidental registration from a misconfigured tool-only plugin.

### Option D: Identity facade with proof-of-ownership from day one

Ship `beginVerification` in the `ctx.identity` interface in Phase 1, backed by
the current flat store.

- **Pros**: the full target interface is available immediately.
- **Cons**: the hub-and-spoke model and challenge flow overlap the
  multi-provider-router track; premature `beginVerification` would be a stub
  that misleads plugin authors. `verified` today reflects `matchMethod ===
'auto'` — a weak but honest signal.

## Decision

**Option B** for the contribution model, with the following subsidiary decisions:

| Topic                    | Decision                                                                                                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Permissions              | Add `provider.task` and `identity` to `PLUGIN_PERMISSIONS`. `provider.task` gates `registerTaskProviderType` and `ctx.providerRuntime`; `identity` + a declared type gates `ctx.identity`.                                                                                                             |
| Manifest contribution    | `contributes.taskProviderTypes` — max one entry. Cross-field refine requires `provider.task` when non-empty.                                                                                                                                                                                           |
| Provider metadata fields | `providerCapabilities` (static `TaskCapability[]`), `providerConfigSchema` (reuses `pluginConfigRequirementSchema`), `providerAllowedHosts` (hostname allowlist), `providerConfigValidator` (optional export name).                                                                                    |
| Registration API         | `registerTaskProviderType(type, { factory })` on `PluginRegistration`. Throws without `provider.task`, if `type` mismatches the declared one, or on duplicate type from another plugin.                                                                                                                |
| Contributed registry     | In-memory `Map<string, ContributedTaskProviderEntry>` in `src/providers/registry.ts`. Populated by `registerContributedTaskProviderType`; `unregisterContributedTaskProviderType(pluginId)` for teardown. Not consumed by `createProvider` yet (Phase 2).                                              |
| Provider runtime facade  | `ctx.providerRuntime` — present only with `provider.task`. `httpFetch` enforces the manifest host allowlist, then the existing `assertPublicUrl()` SSRF guard, then performs the real `fetch`. No raw fetch exposed.                                                                                   |
| Identity facade          | `ctx.identity` — present only with `identity` permission and exactly one declared task-provider type. `lookupForChatUser` reads the existing flat mapping store; `recordClaim` writes an unverified `manual_nl` claim. `verified` derives from `matchMethod === 'auto'`. `beginVerification` deferred. |
| Loader cleanup           | `unregisterContributedTaskProviderType(pluginId)` called in both `deactivateOne` paths and the `activateOne` catch block, so a deactivated or failed plugin's type is removed.                                                                                                                         |
| No consumers yet         | `createProvider`, `listTaskProviderTypes`, and Phase 5 capability reads are Phase 2. The map and facades are exercised by unit tests and the loader wiring — sufficient to ship a stable surface.                                                                                                      |

## Consequences

### Positive

- A plugin can now declare and register a task-provider type without editing
  core modules — the extension point the spec requires.
- The `providerRuntime.httpFetch` double-guard (allowlist + SSRF) ensures
  provider plugins can only reach their declared API hosts.
- `ctx.identity` keeps identity persistence in core, invisible to plugin code;
  the backing store can evolve (hub-and-spoke, proof-of-ownership) without any
  plugin change.
- Loader cleanup wiring prevents stale registrations from blocking a
  re-activated plugin's type.
- Phase 2 consumes the registry map without rework; the API surface is tested
  and frozen.

### Negative

- The contributed-provider map has no core caller yet; unused code ships to
  `master` temporarily.
- `providerCapabilities`, `providerConfigSchema`, and `providerAllowedHosts`
  are defaulted array fields on `PluginManifest`, forcing updates to every
  hand-built manifest literal in tests.
- `ctx.identity.recordClaim` writes unverified claims (`manual_nl`); the
  impersonation gap remains open until the proof-of-ownership phase lands.

### Risks

- Duplicate type registration from two plugins: first-wins, second throws.
  Surfaceable in `/plugin info`; acceptable because only first-party in-repo
  plugins exist.
- Unresolvable instances after deactivation: a Phase 2 concern (the resolver
  and `task_instances` do not exist yet); Phase 2 will apply the existing
  null-provider handling.
- Manifest field drift: `providerCapabilities` mirrors `TaskCapability` — a
  closed union. A new capability requires a manifest schema update. This is
  acceptable because capabilities are core-defined and version-bound.

## Implementation Notes

Key modules changed or created:

| File                              | Change                                                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/plugins/types.ts`            | Added `provider.task`/`identity` permissions; provider-type manifest fields + cross-field refine                                                   |
| `src/providers/registry.ts`       | Added contributed-provider `Map`, `registerContributedTaskProviderType`, `unregisterContributedTaskProviderType`, `getContributedTaskProviderType` |
| `src/plugins/provider-runtime.ts` | Created: `buildProviderRuntime(allowedHosts, logger, deps?)` — allowlisted `httpFetch` + SSRF guard                                                |
| `src/plugins/identity-facade.ts`  | Created: `buildIdentityFacade(providerName, deps?)` — `lookupForChatUser` + `recordClaim` over the existing mapping store                          |
| `src/plugins/context.ts`          | Added `registerTaskProviderType` to `PluginRegistration`; wired `providerRuntime` and `identity` into `PluginContext`                              |
| `src/plugins/loader.ts`           | Added `unregisterContributedTaskProviderType` calls in deactivation and activation-failure paths                                                   |

New test files: `tests/providers/contributed-registry.test.ts`,
`tests/plugins/provider-runtime.test.ts`,
`tests/plugins/identity-facade.test.ts`.

Updated test helpers: `baseManifest` in `tests/plugins/types.test.ts`;
`makeManifest` in `tests/plugins/context.test.ts`,
`tests/plugins/contributions.test.ts`, `tests/plugins/loader.test.ts`;
`makePluginCommandManifest` in `tests/bot.test.ts` — all updated with the new
defaulted manifest fields.

No database migrations; no router coupling.

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — the plugin infrastructure this
  extension builds on.
- ADR-0009: Multi-Provider Task Tracker Support — the provider capability model
  that `providerCapabilities` reflects.
- ADR-0014: Multi-Chat Provider Abstraction — chat provider model; not
  extended in this phase (sibling spec covers chat-provider-as-plugin).
- `docs/archive/2026-05-23-task-provider-as-plugin-design.md` — the full
  five-phase spec; this ADR covers Phase 1 (rollout step 1).
