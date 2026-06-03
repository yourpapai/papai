<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0131: Task-Provider-as-Plugin Phase 2: Type Catalog & Admin UX

## Status

Implemented

## Date

2026-05-25 – 2026-05-28

## Context

Phase 1 (ADR-0130) established that plugins can contribute task provider types
via `registerContributedTaskProviderType`. However, the admin surface remained
hardcoded: the instance-creation form presented a static `<select>` with only
`kaneo`/`youtrack`, and the task-config section was a single JSON textarea.
Plugin-contributed provider types were invisible to the admin UI and could not
be created as task instances without code changes to the form.

The `TaskInstanceType` union (`'kaneo' | 'youtrack'`) and the Zod enum in the
instance-route schema both blocked creation of any other type. The resolver
only knew how to build config for the two built-in types, routing anything
else into `buildYouTrackConfig` and failing.

## Decision Drivers

- **Plugin-contributed types must be creatable**: An admin who approves a
  plugin that contributes a provider type should be able to create a task
  instance of that type from the admin UI without a code deploy.
- **Catalog-driven form**: The admin form must render per-type config fields
  dynamically from each type's declared schema, not from hardcoded markup.
- **No DB migration**: The `task_instances` schema is unchanged; the `type`
  column already stores strings.
- **Built-in credential model preserved**: Per-user credentials
  (`kaneo_apikey`, `youtrack_token`) stay in user config; moving them into
  per-instance config is out of scope.

## Considered Options

### Option A: Hardcode each new type in the admin form as plugins land

Add a new `<option>` and config section per plugin, gated behind build-time
feature flags.

- **Pros**: Minimal initial change.
- **Cons**: Every new provider type requires admin-client code changes; does
  not satisfy the core goal of plugin-driven extensibility.

### Option B: Queryable type catalog + dynamic admin form (chosen)

Add `listTaskProviderTypes()` merging built-in and plugin-contributed
descriptors. Open `TaskInstanceType` to `string`. The admin form fetches the
catalog and renders config fields from each type's `configSchema`.

- **Pros**: Plugin-contributed types become immediately creatable after
  approval; no client code changes per type.
- **Cons**: The resolver must pass contributed-type config verbatim (no
  built-in credential assembly); server-side masking relies on key patterns
  rather than the descriptor's `sensitive` flag.

### Option C: Full provider plugin migration first

Migrate Kaneo/YouTrack into `plugins/` packages before building the catalog.

- **Pros**: Eliminates the two-tier built-in/contributed split.
- **Cons**: Massive scope; blocks the admin UX improvement; belongs in a
  later phase.

## Decision

**Option B**, with the following subsidiary decisions:

| Topic                | Decision                                                                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog API          | `listTaskProviderTypes()` in `src/providers/registry.ts` merges built-in descriptor seeds with plugin-contributed entries from `pluginContributedTaskProviderFactories`. Each entry carries `type`, `displayName`, `configSchema`, `capabilities`, and `source`. |
| Type union           | `TaskInstanceType` changed from `'kaneo' \| 'youtrack'` to `string`. The Zod enum in `instance-routes.ts` likewise changed to `z.string().min(1)`.                                                                                                               |
| Type validation      | POST `/api/task-instances` validates `type` against the catalog; unknown types return `400 unknown_task_provider_type`.                                                                                                                                          |
| Resolver passthrough | `TaskProviderResolver.resolve()` uses a three-way branch: built-in types keep their dedicated config builders; all other types pass `instance.config` through unchanged to `createProvider`.                                                                     |
| Config schema        | `ProviderConfigRequirement` gains an optional `sensitive` boolean. `sensitive` drives client-side rendering only (password input); server-side masking remains key-pattern-based in `maskConfig`.                                                                |
| HTTP endpoint        | `GET /api/task-provider-types` returns the catalog as a JSON array of view objects. Read-only; no `authorizeWrite` gate.                                                                                                                                         |
| Client types         | `TaskProviderTypeView`, `ProviderConfigRequirementView` in `client/shared/api-types.ts`; `fetchTaskProviderTypes()` in `client/admin/fetchers.ts`.                                                                                                               |
| Admin form           | `InstancesSection.svelte` replaces the hardcoded `<select>` and JSON textarea with a catalog-driven type dropdown and per-field inputs (password for `sensitive` keys).                                                                                          |
| Duplicate types      | Existing throw-on-duplicate behavior is retained; "first-wins-with-log" deferred to a later phase.                                                                                                                                                               |
| DB schema            | No migration. The `task_instances` columns are unchanged.                                                                                                                                                                                                        |

## Consequences

### Positive

- Plugin-contributed provider types become creatable as task instances
  immediately after plugin approval, with zero client code changes.
- The admin form is self-documenting: each type's `displayName` and
  `configSchema` labels appear directly in the UI.
- `sensitive` flag renders password inputs, preventing credential display
  in the admin form.
- The catalog endpoint is available for future use (e.g., CLI tooling,
  settings UI provider selection).
- Opening `TaskInstanceType` to `string` removes a recurring source of
  type-narrowing friction as new providers are added.

### Negative

- The resolver's passthrough path means contributed-type plugins receive
  raw `instance.config` with no built-in credential assembly. Plugin
  authors must handle credential resolution themselves or declare
  credentials as config-schema fields.
- `sensitive` only affects client rendering; server-side `maskConfig`
  still relies on key-name patterns. A `sensitive` key whose name does
  not match the regex will render masked in the client but appear
  unmasked in server responses. This gap is acceptable for built-in
  types (only `baseUrl`, non-sensitive) and noted for future hardening.
- No duplicate-type recovery: a second plugin registering an already-
  registered type still throws.

### Risks

- If a plugin declares a `configSchema` that diverges from what its
  factory actually reads, the admin form will present misleading fields.
  Mitigation: plugin authoring docs should stress schema/factory
  consistency; the manifest schema validates shape but not semantics.
- Opening `TaskInstanceType` to `string` removes compile-time exhaustiveness
  checks for built-in types. Mitigation: runtime catalog validation on
  POST catches unknown types; built-in descriptor seeds are the source of
  truth for built-in type strings.

## Implementation Notes

Key changes:

| File                                            | Change                                                                                                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/providers/types.ts`                        | `sensitive?: boolean` on `ProviderConfigRequirement`                                                                                                              |
| `src/providers/registry.ts`                     | `TaskProviderTypeDescriptor` type, `builtinDescriptorSeeds`, `listTaskProviderTypes()`, `ContributedTaskProviderEntry` extended with `displayName`/`configSchema` |
| `src/plugins/context.ts`                        | `buildRegisterTaskProviderType` passes `manifest.name` and `manifest.providerConfigSchema` to registration                                                        |
| `src/instances/types.ts`                        | `TaskInstanceType = string`                                                                                                                                       |
| `src/providers/resolver.ts`                     | Three-way config branch (kaneo / youtrack / passthrough)                                                                                                          |
| `src/debug/instance-routes.ts`                  | `GET /api/task-provider-types` route, catalog-based type validation on POST, `taskInstanceSchema.type` opened                                                     |
| `client/shared/api-types.ts`                    | `TaskProviderTypeView`, `ProviderConfigRequirementView`, `TaskInstanceView.type` → `string`                                                                       |
| `client/admin/instance-fetcher-schemas.ts`      | `TaskProviderTypeViewSchema`, task type opened                                                                                                                    |
| `client/admin/fetchers.ts`                      | `fetchTaskProviderTypes()`                                                                                                                                        |
| `client/admin/sections/InstancesSection.svelte` | Dynamic type dropdown, per-field config inputs, `sensitive` → password input                                                                                      |

## Related Decisions

- ADR-0130: Task-Provider-as-Plugin Phase 1 — contributed provider
  registration that this catalog surfaces.
- ADR-0123: Trusted-Local Plugin System — the plugin trust model and
  approval flow that gates which provider types appear in the catalog.
- ADR-0132: Task-Provider-as-Plugin Prerequisites — the multi-provider
  resolver and instance model that Phase 2 builds on.
