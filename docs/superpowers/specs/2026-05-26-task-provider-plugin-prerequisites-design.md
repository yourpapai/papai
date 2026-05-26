<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Task-Provider-as-Plugin — Phase 3 Prerequisites Design

**Date:** 2026-05-26
**Status:** Draft
**Related:** [`2026-05-23-task-provider-as-plugin-design.md`](./2026-05-23-task-provider-as-plugin-design.md) (parent spec — Sections 4, 5, 8), [`2026-05-25-task-provider-as-plugin-phase-2.md`](../plans/2026-05-25-task-provider-as-plugin-phase-2.md) (completed Phase 2 plan)

## Summary

The parent Task-Provider-as-Plugin spec defines a 5-step rollout. Steps 1–2 (plugin API foundation; registry catalog + schema-driven admin UX) are complete and shipping. Step 3 (migrate Kaneo into `plugins/`) is blocked by **one unsolved architectural prerequisite plus a set of dangling Phase-2 items**. This spec resolves all of them so a Phase-3 plan can be written.

The load-bearing blocker: the parent spec's `providerConfigSchema` lists credentials (`apiKey`, `workspaceId`, `token`) as **instance-level** config, but the live system supplies those credentials **per chat context** (`user_config` keyed by `contextId`, plus the dedicated Kaneo workspace store). A plugin-contributed factory has the contract `(instanceConfig) => TaskProvider` and therefore cannot see per-context credentials at all. This spec keeps the per-context credential model and makes per-context values reach the factory through a **config-scope** concept, so the generic factory path delivers everything a provider needs — proven through the built-in providers before any plugin exists.

## Goals

- Preserve the per-context credential model (per-user task attribution and identity mapping stay intact). No data migration of existing `user_config`.
- Make per-context credentials reach a contributed provider factory without granting plugins raw DB / config / env access.
- Collapse the special-cased `buildKaneoConfig` / `buildYouTrackConfig` into one generic, descriptor-driven config assembler, so built-in and plugin-contributed providers share exactly one resolution path.
- Close the dangling Phase-2 items: wire `providerConfigValidator`, switch to descriptor-`sensitive` masking, make plugin-vs-plugin duplicate registration first-wins, and add the `papai/plugin-types` import alias.
- Define (but do not implement) the contracts for the Phase-3-coupled migration infrastructure (`seedBuiltinProviderPlugins`, `BOOTSTRAP_ENV_MAP`).

## Non-Goals

- Moving credentials to instance-shared service accounts (rejected — product regression on per-user attribution).
- Creating the `plugins/task-provider-kaneo` / `plugins/task-provider-youtrack` packages (Step 3/4).
- Implementing `seedBuiltinProviderPlugins()` or `BOOTSTRAP_ENV_MAP` against plugin packages that do not yet exist (deferred to Phase 3 — see §6).
- Removing the instance-level `TaskProvider.configRequirements` field (Step 5).
- The hub-and-spoke identity model and proof-of-ownership challenge (parent spec Section 6 — separate phase).

## Current State (verified against `master`, 2026-05-26)

- `ProviderConfigRequirement` (`src/providers/types.ts:77`) is `{ key, label, required, sensitive? }` — no scope field.
- Built-in descriptor seeds (`src/providers/registry.ts:150-161`) declare **only** `baseUrl`. Per-context credential fields (`apiKey`/`token`/`workspaceId`) are absent from the catalog.
- `TaskProviderResolver.resolve` (`src/providers/resolver.ts:111-116`) special-cases `kaneo`/`youtrack` via `buildKaneoConfig` / `buildYouTrackConfig`, which read per-context credentials from `getConfig(contextId, 'kaneo_apikey' | 'youtrack_token')` and the Kaneo workspace from `getKaneoWorkspace(contextId)`. The contributed-type branch passes `{ ...instance.config }` verbatim — no per-context values.
- Kaneo credential is a single `kaneo_apikey` user-config value interpreted as either an API key or a session cookie via `isKaneoSessionCookie` inside `buildKaneoConfig`.
- The Kaneo workspace lives under config key `kaneo_workspace_id` but through a dedicated cache/sync path (`src/cache.ts:22,170-194`, `getCachedWorkspace`/`setCachedWorkspace`), not the generic `user_config` store.
- `registerContributedTaskProviderType` (`src/providers/registry.ts:107-119`) **throws** on a plugin-vs-plugin duplicate (lines 112-116), contradicting its own "First-wins on duplicate type" doc-comment. The built-in-shadow rejection (lines 108-110) is intentional and recent.
- `maskConfig` (`src/instances/encryption.ts:74-80`) masks by `SECRET_KEY_PATTERN` over key names, applied only to `task_instances.config` via `src/debug/instance-routes.ts`.
- `providerConfigValidator` is schema-validated in the manifest (`src/plugins/types.ts`) but never invoked.
- No `papai/plugin-types` alias in `package.json` / `tsconfig`.

## Section 1: Config-Scope Model

Extend `ProviderConfigRequirement` (`src/providers/types.ts`):

```typescript
export type ProviderConfigRequirement = {
  key: string
  label: string
  required: boolean
  sensitive?: boolean
  scope?: 'instance' | 'user' // default 'instance'
}
```

Scope semantics:

- `instance` — entered in `/admin#instances`; stored in `task_instances.config` (encrypted at rest, shared by every context assigned to the instance).
- `user` — entered per-context in `/setup` / `/config`; stored in per-context config; **never** instance-shared.

Default is `instance` so every existing descriptor and the plugin `providerConfigSchema` shape remain valid without edits.

### Built-in descriptors gain their user-scoped fields

The built-in descriptor seeds (`src/providers/registry.ts`) become complete:

**Kaneo:**

| key           | scope    | required | sensitive |
| ------------- | -------- | -------- | --------- |
| `baseUrl`     | instance | yes      | no        |
| `internalUrl` | instance | no       | no        |
| `credential`  | user     | yes      | yes       |
| `workspaceId` | user     | yes      | no        |

**YouTrack:**

| key       | scope    | required | sensitive |
| --------- | -------- | -------- | --------- |
| `baseUrl` | instance | yes      | no        |
| `token`   | user     | yes      | yes       |

The `credential` and `workspaceId` keys above are the **merged-config field names** handed to the factory, not the underlying per-context storage keys (which stay `kaneo_apikey` / `youtrack_token` / `kaneo_workspace_id`). The storage mapping lives in the read adapter (§2.3).

## Section 2: Descriptor-Driven Resolver Merge

`buildKaneoConfig` and `buildYouTrackConfig` are deleted. `TaskProviderResolver.resolve` builds the final flat config record generically for every type:

1. Look up the resolved instance type's descriptor (`listTaskProviderTypes()` / a descriptor lookup helper).
2. For each `instance`-scoped field: read from `instance.config`.
3. For each `user`-scoped field: read from per-context config through the **read adapter** (§2.3).
4. Merge into one flat `Record<string, string>`.
5. If any `required` field (either scope) is missing, return `null` and emit the existing structured `warn` (now generic, listing the missing keys). The current per-provider warn shape is preserved in spirit.
6. Call `createProvider(type, merged)`.

The contributed-type branch and the built-in branch are now the same code. A plugin factory receives a fully-merged flat record and never knows which scope a value came from.

### 2.1 Kaneo credential duality moves into the factory

The resolver delivers the raw per-context credential under the single `credential` key. The **Kaneo provider factory** performs the `isKaneoSessionCookie` branching internally, producing `{ apiKey }` or `{ sessionCookie }` for its client. Rationale: keep the resolver provider-agnostic; the apiKey-vs-cookie distinction is a Kaneo implementation detail and must travel with Kaneo when it migrates to `plugins/`.

### 2.2 Required-field semantics

A descriptor field marked `required: true` must be present and non-empty regardless of scope. Optional fields (`internalUrl`) are omitted from the merged record when absent rather than passed as empty strings.

### 2.3 Per-context read adapter

User-scoped fields are read through a small per-type adapter that maps a descriptor key to its per-context source:

- **Default source** (all plugins, YouTrack `token`): generic per-context config via `getConfig(contextId, <storageKey>)`.
- **Kaneo `workspaceId`**: routed to `getKaneoWorkspace(contextId)` (the dedicated `kaneo_workspace_id` cache/sync path).
- **Kaneo `credential`**: `getConfig(contextId, 'kaneo_apikey')`.
- **YouTrack `token`**: `getConfig(contextId, 'youtrack_token')`.

The adapter is the _only_ place that knows storage-key ↔ field-name mappings and the workspace special case. Plugins always use the default source, so they never inherit the workspace quirk. The adapter keeps the resolver body itself free of provider conditionals.

### 2.4 Capability resolution cleanup

`getCapabilitiesForTaskInstance` (`src/providers/registry.ts:100-104`) currently builds a dummy-credential config (`capabilityConfigForTaskInstance`, lines 88-98) to construct a transient provider just to read `.capabilities`. With capabilities sourced from the descriptor for built-ins (as already done for contributed types), the dummy-cred construction for built-ins is removed. Capabilities for both built-in and contributed types come from a static descriptor without constructing an instance.

## Section 3: Provider Config Validator Wiring

`manifest.providerConfigValidator` (and a parallel optional validator for built-ins, if any) names an exported `validateConfig(config) => Promise<{ ok: true } | { ok: false; reason: string }>`.

- The `/admin#instances` create/edit handlers (`src/debug/instance-routes.ts`) call the resolved type's validator **before persisting**.
- Validation runs only over **instance-scoped** fields. User-scoped credentials are not present at instance-create time, so the validator must not require them.
- On `{ ok: false, reason }`, return a 4xx with the reason and do not write. Absent a validator, persist as-is (current behavior).

## Section 4: Descriptor-Sensitive Masking

Replace `maskConfig`'s `SECRET_KEY_PATTERN` name-matching (`src/instances/encryption.ts:74-80`) with descriptor-driven masking:

- A `task_instances.config` key is masked iff its descriptor field has `sensitive: true` **and** `scope: 'instance'`.
- When no descriptor is found for the type (defensive / unknown type), fall back to the existing `SECRET_KEY_PATTERN`.
- User-scoped credentials are never in `task_instances.config`, so this change governs only instance-scoped sensitive fields (none today for the built-ins; relevant once a contributed type declares one).

The masked value remains the existing sentinel (`***`).

## Section 5: First-Wins Duplicate Registration

Change `registerContributedTaskProviderType` (`src/providers/registry.ts:112-116`):

- Plugin-vs-plugin duplicate `type`: **log an error and skip** the second registration (keep the first). Do not throw. This matches the existing doc-comment and parent spec §8.
- Built-in-shadow (`registry.ts:108-110`): **unchanged** — still a hard error.
- The skipped duplicate is surfaced in `/plugin info` for the losing plugin (a compatibility/runtime note).

## Section 6: Phase-3-Coupled Infrastructure (Contracts Only)

`seedBuiltinProviderPlugins()` and `BOOTSTRAP_ENV_MAP` reference plugin packages that do not yet exist (`plugins/task-provider-kaneo`, `plugins/task-provider-youtrack`). They cannot be built or tested end-to-end before those directories exist, so their **implementation is deferred to Phase 3**. This spec records their contracts:

- **`seedBuiltinProviderPlugins()`** — a startup step that writes `plugin_admin_state` approval rows for the migrated built-in plugins on first run **iff** no approval row exists, with `approved_by = '__migration__'` and the current manifest hash. Idempotent via a migration-state guard row so it is a no-op after one successful seed.
- **`BOOTSTRAP_ENV_MAP`** — a `Record<string, string>` exported from each migrated plugin's entry point mapping env var → config key (e.g. `KANEO_CLIENT_URL → baseUrl`, `KANEO_INTERNAL_URL → internalUrl`). `bootstrap()` (`src/instances/bootstrap.ts`) consults it **only** at first-run seeding, never at runtime. Phase 3 also replaces `bootstrap.ts`'s hardcoded `BuiltinTaskType`-guarded env mapping so a plugin-contributed type can seed.

## Section 7: `papai/plugin-types` Import Alias

Add a stable public import surface so a future in-repo provider plugin imports `papai/plugin-types` instead of deep internal paths.

- Re-exports: `TaskProvider`, the normalized domain types (`Task`, `Project`, `Comment`, `Label`, `Status`, …), `TaskCapability`, `ProviderConfigRequirement`, and the `AppError` union + its constructors.
- Pure re-export module; no runtime behavior change.
- Wired through `package.json` (exports/imports map) + `tsconfig` `paths`.
- A bundle-isolation-style assertion verifies the alias pulls in only type/constructor surface, not unrelated implementation code.

## Section 8: Testing

Reuses `mockDrizzle`, `createMockProvider`, and existing helpers (`tests/CLAUDE.md`). No new test infrastructure.

| Test                       | Covers                                                                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| resolver (extend existing) | descriptor-driven merge combines instance + user fields; missing-required (either scope) → `null` + warn; Kaneo credential delivered under `credential`; workspace read via adapter |
| registry (extend)          | catalog exposes full per-type schema incl. user-scoped fields; descriptor-sourced capabilities (no dummy-cred construct); first-wins duplicate skip; built-in-shadow still throws   |
| encryption / masking       | sensitive instance-scoped fields masked; user-scoped and non-sensitive untouched; fallback to pattern when no descriptor                                                            |
| instance-routes            | `providerConfigValidator` invoked pre-persist over instance-scoped fields; `{ ok: false }` blocks write with reason; absent validator persists                                      |
| `papai/plugin-types` alias | re-export surface present and importable; bundle-isolation: no implementation code pulled in                                                                                        |

## Section 9: Rollout

Each step ships independently; the system stays green throughout.

1. Add `scope` to `ProviderConfigRequirement`; complete the built-in descriptors with their user-scoped fields. Additive — resolver still on the old build functions.
2. Replace `buildKaneoConfig`/`buildYouTrackConfig` with the descriptor-driven merge + read adapter; move Kaneo credential normalization into the factory; remove the dummy-cred capability construct for built-ins.
3. Descriptor-`sensitive` masking + first-wins duplicate registration + `providerConfigValidator` wiring.
4. `papai/plugin-types` alias + bundle-isolation assertion.

`seedBuiltinProviderPlugins` and `BOOTSTRAP_ENV_MAP` implementation land in Phase 3 alongside the plugin packages they reference (§6).

## Section 10: Risks & Mitigations

- **Workspace storage divergence:** the Kaneo workspace's dedicated store is isolated behind the read adapter; no data migration, and plugins never touch it. Risk: a future change to the workspace store must update the adapter — documented as the single mapping point.
- **Required-field regressions:** the generic merge must reproduce the exact null-and-warn behavior of the deleted build functions. Mitigated by extending the existing resolver tests to assert each missing-field path before deleting the old functions.
- **Masking fallback:** descriptor-driven masking falls back to the name pattern for unknown types, so an unrecognized type cannot accidentally expose a value that the old pattern would have masked.
- **Validator over-reach:** a validator that requires user-scoped fields would always fail at instance-create time; the contract restricts validation to instance-scoped fields and tests assert a user-scoped-only config still validates.
