<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0151: Multi-Provider Phase 3: Provider Catalog Refactor

## Status

Implemented

## Date

2026-05-26 – 2026-06-02

## Context

Phase 2 left task provider type listing as a static catalog (`listTaskProviderTypes()`)
that no longer instantiates providers to read capabilities, but the descriptor shape
was still a legacy single `configSchema` without instance/context splitting or
traits. Platform providers had no catalog at all — the admin UI hard-coded
`telegram`, `mattermost`, and `discord` choices and accepted raw JSON config.
Tool assembly still gated provider-specific behavior by `provider.name` string
comparisons rather than explicit capabilities or traits. Plugin-contributed task
providers could declare instance config but had no way to collect per-context
credentials through the existing config flow. Instance config keys were
inconsistent (`url` vs `baseUrl`), and config masking relied on key-name regex
heuristics rather than schema declarations.

The spec (`docs/archive/2026-05-26-multi-provider-phase-3-provider-catalog-refactor.md`)
stated the goal plainly: make adding the next provider boring.

## Decision Drivers

- **Descriptor-driven, not name-driven**: Provider metadata, credentials, masking,
  setup, config, and tool gating must come from structured descriptors, not from
  `provider.name` checks or hard-coded unions.
- **Instance vs context separation**: Base URLs and bot tokens belong to the
  instance; user tokens and workspace IDs belong to the context. A single flat
  `configSchema` cannot express this correctly.
- **Plugin provider parity**: Plugin task providers must use the same resolver
  path and credential model as built-in providers.
- **Admin UI from catalog**: Both platform and task instance forms must render
  from descriptor schemas, eliminating raw JSON config editing.
- **Safe defaults for unknowns**: Masking and error handling must default to
  safe behavior when a descriptor is unavailable.

## Considered Options

### Option A: Extend legacy `configSchema` with scope annotations

Add `scope` to existing `ProviderConfigRequirement` fields without splitting the
array. Catalog and API remain flat; clients filter by scope.

- **Pros**: Minimal type/API churn; backward-compatible.
- **Cons**: Clients must filter; instance and context schemas are semantically
  distinct and should be first-class; `storageKey` mapping remains implicit.

### Option B: Split schemas with traits (chosen)

Replace the flat `configSchema` with separate `instanceConfigSchema` and
`contextConfigSchema`, add `traits: ReadonlySet<string>` to descriptors, and
introduce a parallel platform provider catalog.

- **Pros**: Clean separation of concerns; traits replace provider-name checks;
  platform and task catalogs mirror each other; admin UI can render both from
  descriptors.
- **Cons**: API response shape changes; all catalog consumers need migration.

### Option C: Trait-based traits on the provider runtime object only

Add traits to `TaskProvider` at runtime but keep the catalog API unchanged.

- **Pros**: No API migration.
- **Cons**: Tool assembly still needs provider-name checks at construction time
  before the runtime provider exists; catalog cannot express traits for setup
  or admin UI decisions.

## Decision

**Option B** with the following subsidiary decisions:

| Topic                      | Decision                                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Descriptor shape           | `instanceConfigSchema` + `contextConfigSchema` + `traits` on both platform and task descriptors. `ProviderConfigField` carries `scope`, `storageKey`, and `sensitive`.                                                    |
| Platform catalog           | New `ChatProviderDescriptor` type and `listPlatformProviderTypes()` in `src/chat/registry.ts`. New `GET /api/platform-provider-types` route.                                                                              |
| API migration              | `GET /api/task-provider-types` updated to emit split schemas and traits. Legacy `configSchema` dropped after clients migrate in the same phase.                                                                           |
| Trait-driven tools         | `provider.name` checks replaced by `provider.traits.has(...)` checks. Provider-specific tools gated by traits + capabilities, not names. Provider names remain identifiers for logging only.                              |
| Plugin context credentials | `providerContextConfigSchema` added to plugin manifests. Context fields stored as `plugin:<pluginId>:provider:<key>` in `user_config`. Resolver reads them through the same descriptor-driven path as built-in providers. |
| Config field model         | New `ConfigField` type (`key`, `storageKey`, `label`, `required`, `sensitive`, `kind`) replaces closed `ConfigKey` unions for provider context config. Core preference keys remain on `ConfigKey`.                        |
| Config key standardization | `baseUrl` for all URL-bearing providers. Migration `045_provider_base_url` backfills `url` to `baseUrl`. Bootstrap writes `baseUrl` only. Runtime reads `baseUrl` with `url` compatibility fallback.                      |
| Schema-driven masking      | Instance config masking uses descriptor `instanceConfigSchema.sensitive` fields. Unknown providers mask all config fields by default. Key-name regex remains only as defense-in-depth.                                    |
| Resolver path              | Unified: load instance → load descriptor → validate instance config → validate context config from `user_config` → merge into factory input. Built-in and plugin providers follow the same path.                          |

## Consequences

### Positive

- Adding a new provider is a descriptor registration + factory, no core file edits.
- Plugin providers have full credential parity with built-in providers.
- Admin UI renders both platform and task forms from catalog schemas — no raw
  JSON editing for platform instances.
- Tool behavior is explicit and safe against provider-name spoofing.
- Masking is schema-declared and safe-by-default for unknown providers.

### Negative

- API response shape for `/api/task-provider-types` changes; all consumers
  must migrate in the same phase.
- `ConfigField` model adds a second config key system alongside `ConfigKey`
  until the remaining closed-union callers are migrated.
- One migration (`045_provider_base_url`) touches persisted config rows.

### Risks

- The `url` → `baseUrl` compatibility fallback must be removed in a future
  release; leaving it too long creates two code paths.
- Plugin `providerContextConfigSchema` extends the trusted-plugin manifest
  surface — any manifest change clears admin approval, which is the correct
  safety behavior but may surprise plugin authors who add context fields.

## Implementation Notes

Key changes by module:

| Module                                          | Change                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/providers/domain-types.ts`                 | `ProviderConfigField` with `scope`, `storageKey`, `sensitive`                             |
| `src/providers/registry.ts`                     | `TaskProviderTypeDescriptor` with `instanceConfigSchema`, `contextConfigSchema`, `traits` |
| `src/providers/resolver.ts`                     | Descriptor-driven context field reading; namespaced `plugin:` storage keys                |
| `src/providers/task-traits.ts`                  | `TaskProviderTrait` union type                                                            |
| `src/chat/types.ts`                             | `ChatProviderDescriptor` with parallel shape                                              |
| `src/chat/registry.ts`                          | `listPlatformProviderTypes()` and static platform descriptors                             |
| `src/debug/platform-provider-type-routes.ts`    | New `GET /api/platform-provider-types`                                                    |
| `src/debug/task-provider-type-routes.ts`        | Updated to split schemas + traits                                                         |
| `src/debug/instance-routes.ts`                  | Descriptor-aware masking for both platform and task instances                             |
| `src/config-keys.ts`                            | `ConfigField` model and `getConfigFieldsForContext()`                                     |
| `src/plugins/types.ts`                          | `providerContextConfigSchema` in manifests                                                |
| `src/plugins/context.ts`                        | Register plugin context fields into contributed descriptors                               |
| `src/tools/tools-builder.ts`                    | Trait-gated tool assembly                                                                 |
| `src/tools/kaneo-label-helpers.ts`              | `usesSeparateLabelReadApi()` via trait                                                    |
| `src/instances/bootstrap.ts`                    | Writes `baseUrl` only                                                                     |
| `src/db/migrations/045_provider_base_url.ts`    | Backfills `url` → `baseUrl`                                                               |
| `client/admin/sections/InstancesSection.svelte` | Descriptor-driven platform instance forms                                                 |
| `client/admin/instance-fetchers.ts`             | `fetchPlatformProviderTypes()`                                                            |

Migration: `045_provider_base_url` copies `url` to `baseUrl` for both
`platform_instances` and `task_instances`.

## Related Decisions

- ADR-0009: Multi-Provider Task Tracker Support — original provider capability
  model that traits extend.
- ADR-0014: Multi-Chat Provider Abstraction — chat provider model that the
  platform catalog formalizes.
- ADR-0123: Trusted-Local Plugin System — plugin manifest and context API that
  `providerContextConfigSchema` builds on.
- Phase 1 hardening and Phase 2 DB integrity: prerequisites for this refactor.
