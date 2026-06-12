<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0132: Task-Provider-as-Plugin Phase 3 Prerequisites

## Status

Implemented

## Date

2026-05-26 – 2026-06-02

## Context

The parent Task-Provider-as-Plugin spec defines a 5-step rollout. Steps 1–2
(plugin API foundation; registry catalog + schema-driven admin UX) shipped in
Phase 2. Step 3 (migrate Kaneo into `plugins/`) was blocked by one unsolved
architectural prerequisite plus a set of dangling Phase-2 items.

The load-bearing blocker: the parent spec's `providerConfigSchema` lists
credentials (`apiKey`, `workspaceId`, `token`) as instance-level config, but
the live system supplies those credentials **per chat context** (`user_config`
keyed by `contextId`, plus a dedicated Kaneo workspace store). A
plugin-contributed factory has the contract `(instanceConfig) => TaskProvider`
and therefore cannot see per-context credentials at all.

Additionally, several Phase-2 contract gaps remained open: the
`providerConfigValidator` declared in manifests was never invoked at persist
time; config masking used a name-pattern heuristic instead of descriptor
metadata; plugin-vs-plugin duplicate registration threw instead of following
the documented first-wins policy; and no stable import alias existed for
future in-repo provider plugins.

## Decision Drivers

- **Preserve per-context credentials**: per-user task attribution and identity
  mapping depend on per-context credential storage; moving to shared
  instance-level service accounts is a product regression.
- **Uniform factory contract**: built-in and plugin-contributed providers must
  share one resolution path so a plugin factory receives everything it needs
  without raw DB/config/env access.
- **No data migration**: existing `user_config` rows and the Kaneo workspace
  store remain unchanged.
- **Descriptor as single source of truth**: capabilities, sensitivity, scope,
  and required-status all come from the type descriptor, eliminating
  special-case code paths.
- **Phase-3 readiness**: after these prerequisites, migrating a built-in
  provider into `plugins/` is a pure code-move with no architectural changes.

## Considered Options

### Option A: Instance-shared service accounts

Move credentials to `task_instances.config` so the factory contract is trivial.

- **Pros**: Simplest factory contract; no scope concept needed.
- **Cons**: Product regression — loses per-user attribution and identity
  mapping; breaks existing per-context credential workflows.

### Option B: Config-scope concept with descriptor-driven merge (chosen)

Tag each config field as `instance` or `user` scoped. The resolver reads
instance-scoped fields from `task_instances.config` and user-scoped fields
from per-context config through a read adapter, merges them into one flat
record, and passes it to the unchanged `(config) => TaskProvider` factory.

- **Pros**: Preserves per-context model; uniform factory contract; plugin and
  built-in providers share one code path; no data migration.
- **Cons**: Introduces a scope concept and a per-type read adapter that
  core owns; the adapter must be updated if storage keys change.

### Option C: Dual-config factory contract

Change the factory signature to `(instanceConfig, userConfig) => TaskProvider`.

- **Pros**: Explicit scope at the factory boundary.
- **Cons**: Breaks every existing factory; plugins must understand two config
  shapes; leaks scope awareness to plugin authors.

## Decision

**Option B** for the config model, with the following subsidiary decisions:

| Topic                      | Decision                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config scope               | `ProviderConfigRequirement` gains `scope?: 'instance' \| 'user'` (default `instance`). Instance fields from `task_instances.config`; user fields from per-context config.             |
| Resolver merge             | Delete `buildKaneoConfig`/`buildYouTrackConfig`. Generic `buildConfigFromDescriptor` merges both scopes into one flat `Record<string, string>`. Contributed and built-in paths unify. |
| Read adapter               | `readUserScopedField` maps descriptor keys to per-context storage (`kaneo_apikey`, `youtrack_token`, `kaneo_workspace_id`). This is the single mapping point in core.                 |
| Kaneo credential branching | Moves from the resolver into the Kaneo factory. The resolver delivers a single `credential` key; the factory performs `isKaneoSessionCookie` branching internally.                    |
| Capabilities               | Sourced from descriptor seeds for built-ins (eliminates dummy-credential provider construction); contributed types already use their descriptor.                                      |
| Config masking             | `maskConfig` accepts an explicit sensitive-key set derived from the descriptor's instance-scoped `sensitive: true` fields. Falls back to `SECRET_KEY_PATTERN` for unknown types.      |
| Duplicate registration     | Plugin-vs-plugin duplicate type: log error and skip (first-wins). Built-in-shadow: still a hard throw.                                                                                |
| Provider config validator  | `validateConfig` threaded through registration; invoked in task-instance create route before persist. Absent validator → persist as-is.                                               |
| Import alias               | `papai/plugin-types` re-exports types and error constructors from `src/providers/public-types.ts`. No implementation code on the runtime surface.                                     |
| Deferred to Phase 3        | `seedBuiltinProviderPlugins()`, `BOOTSTRAP_ENV_MAP`, and resolving `providerConfigValidator` from a plugin module's named export. These require the migrated plugin packages.         |

## Consequences

### Positive

- A plugin-contributed provider factory now receives a fully-merged flat config
  with per-context credentials included — the Phase-3 blocker is resolved.
- One generic config merge replaces two special-cased build functions; the
  resolver has zero provider-specific conditionals.
- The read adapter isolates storage-key mapping in one place; plugins never
  inherit the Kaneo workspace quirk.
- Descriptor-driven masking is precise: only fields declared `sensitive` and
  `instance`-scoped are masked, with a safe pattern fallback for unknown types.
- First-wins duplicate registration prevents one misbehaving plugin from
  crashing another's activation.
- The `providerConfigValidator` gate prevents invalid instance configs from
  reaching the encrypted store.
- The `papai/plugin-types` alias gives future plugin authors a stable import
  path decoupled from internal module layout.

### Negative

- The read adapter is a core-maintained mapping that must be updated if
  per-context storage keys change. This is documented as the single mapping
  point.
- Kaneo's `credential` key replaces `apiKey`/`sessionCookie` in the merged
  config shape; any caller that constructs Kaneo via `createProvider('kaneo', …)`
  must pass `credential`.
- The scope concept adds a mental model that all future provider descriptor
  authors must understand.

### Risks

- A `providerConfigValidator` that requires user-scoped fields would always
  fail at instance-create time. Mitigated by contract: validators run only
  over instance-scoped fields; tests assert this constraint.
- Descriptor-driven masking falls back to the name pattern for unknown types,
  so an unrecognized type cannot accidentally expose a value the old pattern
  would have masked.

## Implementation Notes

Key modules changed:

| File                                     | Change                                                                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/providers/types.ts`                 | `ProviderConfigRequirement` gains `scope` field                                                                                                                                   |
| `src/plugins/types.ts`                   | `pluginConfigRequirementSchema` gains `scope` Zod field                                                                                                                           |
| `src/providers/registry.ts`              | Complete built-in descriptors with scoped fields; `getTaskProviderDescriptor`; descriptor-sourced capabilities; first-wins duplicate; `TaskProviderConfigValidator` type + lookup |
| `src/providers/resolver.ts`              | Generic `buildConfigFromDescriptor` + `readUserScopedField`/`readInstanceScopedField`; remove `buildKaneoConfig`/`buildYouTrackConfig`                                            |
| `src/providers/kaneo/index.ts`           | Factory accepts `credential` key; `isKaneoSessionCookie` branching in factory                                                                                                     |
| `src/debug/task-provider-type-routes.ts` | Filter catalog to instance-scoped fields                                                                                                                                          |
| `src/instances/encryption.ts`            | `maskConfig` accepts explicit sensitive-key set                                                                                                                                   |
| `src/debug/instance-routes.ts`           | Descriptor-driven masking; invoke `providerConfigValidator` before persist                                                                                                        |
| `src/plugins/context.ts`                 | Thread `validateConfig` through `registerTaskProviderType`                                                                                                                        |
| `src/providers/public-types.ts`          | New: stable re-export surface for `papai/plugin-types`                                                                                                                            |
| `package.json` / `tsconfig.json`         | `papai/plugin-types` export alias + path mapping                                                                                                                                  |

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — plugin API foundation that this
  prerequisite builds on.
- ADR-0009: Multi-Provider Task Tracker Support — provider capability model
  extended by descriptor-sourced capabilities.
- ADR-0014: Multi-Chat Provider Abstraction — chat provider model; plugins do
  not receive raw chat providers.
