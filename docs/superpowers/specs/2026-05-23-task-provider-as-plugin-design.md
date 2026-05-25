<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Task-Provider-as-Plugin Design

**Date:** 2026-05-23
**Status:** Draft
**Related:** [`2026-03-30-plugin-system-design.md`](./2026-03-30-plugin-system-design.md) (original Phase 3 "Optional Provider Migration"), [`2026-04-13-multi-provider-router-design.md`](./2026-04-13-multi-provider-router-design.md) (Phases 1–5), [`2026-05-23-chat-provider-as-plugin-design.md`](./2026-05-23-chat-provider-as-plugin-design.md) (sibling spec), [`2026-05-23-3rd-party-provider-trust-tier-research.md`](./2026-05-23-3rd-party-provider-trust-tier-research.md) (future trust tier)

## Summary

Task providers (`kaneo`, `youtrack`) are currently hardcoded in `src/providers/registry.ts` and constructed by `src/providers/factory.ts` / the Phase 2 resolver. This spec makes task providers contributable through the existing plugin system: a plugin declares a single task-provider **type**, the manifest carries the type's static capabilities and per-instance config schema, and the plugin's `activate()` registers a **factory** that the existing `createProvider(type, config)` registry calls once per `task_instances` row. The two built-in providers migrate into `plugins/` as the proof of the API, with a backward-compatible auto-approval seed so existing deployments keep working without admin intervention.

Trust model is unchanged: provider plugins remain trusted, first-party, in-repo code. A separate research document covers a potential 3rd-party trust tier; it is out of scope here.

## Goals

- Let a new task-tracker integration ship as a `plugins/<id>/` package without editing core registries.
- Reuse the existing plugin machinery: discovery, admin approval, per-context enable/disable, capability-aware eligibility (Phase 5), and the `/plugin` command.
- Align with the Multi-Provider Router data model: plugins contribute **types**; admins create **instances** of those types (`task_instances` rows) with per-instance config.
- Migrate Kaneo and YouTrack into plugins so there is exactly one registration path.

## Non-Goals

- 3rd-party / externally-authored provider plugins, sandboxing, signing, install-from-URL — see the trust-tier research doc.
- Chat-provider-as-plugin — sibling spec.
- Making `TaskCapability` an open/extensible enum — it stays a closed union; revisit only if a real third-party provider needs a capability the union lacks.
- Moving the core `identity_mappings` table into per-plugin storage — Section 6 keeps it in core behind a facade.

## Dependencies & Prerequisite Status

> **Important — read before scheduling this work.** This spec assumes the Multi-Provider Router is implemented. As of this writing it is **in active development** on branch `claude/multi-provider-phase-1-plan-8kqwN`, not yet merged to `master`. Verified against `master` on 2026-05-24:
>
> - No `task_instances` / `platform_instances` / `context_settings` tables (Phase 1 not implemented).
> - No `src/providers/resolver.ts` / `defaultTaskProviderResolver` (Phase 2 not implemented).
> - No `ChatRouter` (Phase 3 not implemented).
> - No `getCapabilitiesForTaskInstance` / `capability_missing` eligibility (Phase 5 not implemented; its spec has been moved to `docs/archive/`).
> - The live model is still single-provider: `buildProviderForUser(userId, strict)` in `src/providers/factory.ts`, keyed by the `TASK_PROVIDER` env var and per-user `kaneo_apikey` / `youtrack_token` config.
>
> **This spec therefore depends on, at minimum, Multi-Provider Router Phases 1–2 landing first** (instance tables + the task-provider resolver), plus the capability-resolution behavior originally specced as Phase 5. Where this document says "the existing resolver", "the encrypted `task_instances.config`", or "Phase 5's capability check", read it as "the resolver/table/check introduced by those prerequisite phases", not as current code.
>
> An alternative that drops the multi-provider prerequisite — plugins contribute a single provider keyed by the existing `TASK_PROVIDER` env var, no instances — was considered and rejected per the brainstorming decision to align with the instances data model. The router is being built now (branch above), so this spec should be scheduled to follow the router phases it depends on rather than restructured around the env-var fallback.
>
> **Identity (Section 6) is sequenced separately.** The hub-and-spoke identity model and the proof-of-ownership challenge described there are their own phase, landing with/after the router. This migration ships against the `ctx.identity` facade interface from day one; the facade is backed by the current flat identity store until the hub/challenge phase lands.

Recently-landed refactors this spec already accounts for: `TaskProviderPhaseFive` has been merged into `TaskProvider`, and `TaskCapability` now lives in its own module `src/providers/task-capability.ts` (commit `9184f3e8`).

## Section 1: Manifest & Contribution Model

The manifest gains one contribution slot, one permission, and provider-type metadata fields.

```jsonc
{
  "id": "task-provider-kaneo",
  "name": "Kaneo Task Provider",
  "version": "1.0.0",
  "description": "Kaneo task-tracker integration.",
  "apiVersion": 1,
  "permissions": ["provider.task"], // NEW permission
  "contributes": {
    "taskProviderTypes": ["kaneo"], // NEW — exactly one type per plugin
  },
  "providerCapabilities": [
    // NEW — TaskCapability[] this type supports
    "comments.create",
    "comments.read",
    "labels.list",
    "projects.list",
  ],
  "providerConfigSchema": [
    // NEW — per-instance config the admin enters
    { "key": "baseUrl", "label": "Kaneo URL", "required": true, "sensitive": false },
    { "key": "apiKey", "label": "Kaneo API key", "required": true, "sensitive": true },
    { "key": "workspaceId", "label": "Workspace ID", "required": true, "sensitive": false },
  ],
  "providerAllowedHosts": ["api.kaneo.io"], // NEW — egress allowlist for ctx.providerRuntime.httpFetch
  "providerConfigValidator": "validateConfig", // NEW (optional) — entry-point export name
}
```

Rules:

- **Exactly one provider type per plugin** (`contributes.taskProviderTypes.length === 1`). Keeps approval reasoning and capability resolution simple, and matches how an integration is normally shipped. Validated by the manifest schema.
- `providerCapabilities`, `providerConfigSchema`, `providerAllowedHosts` are **static** (manifest-declared, available before any instance exists). The factory is **dynamic** (one call per `task_instances` row).
- `provider.task` permission is required. Without it, `registerTaskProviderType` throws and the manifest is rejected if it declares `taskProviderTypes` without the permission.
- A provider plugin **may also** contribute tools, prompt fragments, and scheduled jobs through the existing slots. This is the reason for extending the existing plugin system rather than introducing a separate "provider kind": a single plugin (e.g. a hypothetical `jira`) can ship both a `jira` task provider and a `jira_sprint_burndown` tool, declared and approved together.

### Manifest schema changes (`src/plugins/types.ts`)

- Add `'provider.task'` to `PLUGIN_PERMISSIONS`.
- Add `taskProviderTypes: z.array(...).max(1)` to `pluginContributesSchema`.
- Add `providerCapabilities`, `providerConfigSchema`, `providerAllowedHosts`, `providerConfigValidator` to `pluginManifestSchema`.
- `providerConfigSchema` reuses the existing `pluginConfigRequirementSchema` shape (`key`, `label`, `required`, `sensitive`).
- Cross-field validation: if `contributes.taskProviderTypes` is non-empty, `permissions` must include `provider.task`; otherwise reject.

### Registration API (`src/plugins/context.ts`)

```typescript
type TaskProviderFactory = (instanceConfig: Record<string, string>) => TaskProvider

export type PluginRegistration = {
  // ... existing register* methods ...
  registerTaskProviderType(type: string, descriptor: { factory: TaskProviderFactory }): void
}
```

`registerTaskProviderType` throws if:

- the plugin lacks `provider.task`,
- `type` is not the single value in `contributes.taskProviderTypes`,
- the same `type` was already registered by another active plugin (first-wins, second logs an error and is skipped).

## Section 2: Plugin Context Surface

Provider plugins need a narrowly wider runtime than tool plugins, gated by `provider.task`.

```typescript
export type PluginContext = {
  // ... existing fields ...
  /** Present only when 'provider.task' (or 'provider.chat') is held. */
  readonly providerRuntime?: {
    /** Safe-fetch surface (src/web/safe-fetch.ts); enforces the manifest host allowlist. No raw fetch. */
    readonly httpFetch: (url: string, init?: RequestInit) => Promise<Response>
    /** Manifest-declared providerAllowedHosts, validated at approval. */
    readonly allowedHosts: ReadonlySet<string>
    /** Convenience scoped logger (same child as ctx.log). */
    readonly logger: PluginLogger
  }
}
```

Constraints (all enforced by what the context does and does not expose):

- **No raw `fetch`.** `httpFetch` rejects any host not in `providerAllowedHosts` before opening a connection, reusing the existing `src/web/safe-fetch.ts` SSRF-guarded fetch path that powers `web_fetch`.
- **No raw DB access.** Per-instance state (caches, refresh tokens, the Kaneo workspace cache) uses `ctx.kv`, scoped to `(plugin_id, '__system__:instance:<task-instance-id>', key)`.
- **No raw env access.** Per-instance config arrives only as the `instanceConfig` argument to the factory, sourced from `task_instances.config` (the Phase 1 encrypted-at-rest column).

`ctx.providerRuntime` is `undefined` for plugins without the permission; TypeScript and a runtime guard both enforce this.

## Section 3: Lifecycle & Resolver Integration

Provider-type registration happens at activation. Provider **instances** are constructed lazily by the existing resolver.

### Activation (startup)

1. `discoverPlugins()` finds the plugin and validates the manifest.
2. If admin-approved, the plugin enters `active` and `activate(ctx)` runs.
3. `activate` calls `ctx.registration.registerTaskProviderType('kaneo', { factory })`.
4. A new in-memory map in `src/providers/registry.ts` records the factory:

```typescript
type ContributedTaskProviderEntry = {
  pluginId: string
  factory: TaskProviderFactory
  capabilities: ReadonlySet<TaskCapability>
}
const pluginContributedTaskProviderFactories = new Map<string, ContributedTaskProviderEntry>()
```

The plugin loader calls a registry setter (`registerContributedTaskProviderType(type, entry)`); the public `ctx.registration.registerTaskProviderType` is the plugin-facing wrapper that performs permission/declaration checks before delegating to it.

### Construction (request time)

`createProvider(type, config)` is extended to consult both maps:

```typescript
export function createProvider(name: string, config: Record<string, string>): TaskProvider {
  const builtin = builtinProviders.get(name)
  if (builtin !== undefined) return builtin(config)

  const contributed = pluginContributedTaskProviderFactories.get(name)
  if (contributed !== undefined) {
    log.debug({ name, pluginId: contributed.pluginId }, 'Creating plugin-contributed provider')
    return contributed.factory(config)
  }

  throw new Error(
    `Unknown provider: ${name}. Available: ${[...builtinProviders.keys(), ...pluginContributedTaskProviderFactories.keys()].join(', ')}`,
  )
}
```

`defaultTaskProviderResolver.resolve(contextId)` (Phase 2) and the Phase 5 capability checks **do not change** — they already call `createProvider(task_instances.type, task_instances.config)`, and the registry now returns plugin-contributed providers transparently.

### Phase 5 capability source

The capability-resolution helper introduced by the prerequisite Phase 5 work (`getCapabilitiesForTaskInstance(instance)`, intended to live in `src/providers/registry.ts`) reads a task instance's supported capabilities. When implemented alongside this spec, it must also read `pluginContributedTaskProviderFactories.get(type)?.capabilities`. For plugin types the capability set comes from `manifest.providerCapabilities` (recorded into the entry at registration), so capability resolution works without constructing a transient instance. (Phase 5 is not yet implemented — see Dependencies.)

### Deactivation

When a plugin's manifest hash changes (clears approval) or it is rejected, its factory is removed from the registry. Existing `task_instances` rows of that type remain in the DB but become unresolvable: `resolver.resolve()` returns `null`, and the existing Phase 2 "no provider" handling applies. The admin `/admin#instances` surface shows the row as **"unresolvable: plugin not active"**.

### Provider-aware tools from the same plugin

A provider plugin's own tools/jobs use the existing slots unchanged. Tools that should appear only when one of this plugin's instances is the active task instance for the context are already filtered by Phase 5's `requiredTaskCapabilities` → `capability_missing` mechanism. No new gating is required.

## Section 4: Per-Instance Config — Declaration & Admin UX

Today, per-instance config requirements live on the `TaskProvider` **instance** (`configRequirements`). That is a chicken-and-egg problem for plugin providers: the create-instance form must render before any instance exists.

**Resolution:** declare config at the **type** level. Plugins use `manifest.providerConfigSchema` (Section 1). Built-in providers expose a parallel static descriptor.

```typescript
// src/providers/registry.ts
export type TaskProviderTypeDescriptor = {
  type: string
  displayName: string
  configSchema: readonly ProviderConfigRequirement[]
  capabilities: ReadonlySet<TaskCapability>
  source: 'builtin' | { plugin: string }
}

export function listTaskProviderTypes(): TaskProviderTypeDescriptor[]
```

`listTaskProviderTypes()` merges built-in registrations with plugin-contributed entries. The admin `/admin#instances` surface sources its type catalog from this helper and renders the per-type create/edit form dynamically from `configSchema`. The same code path serves Kaneo, YouTrack, and any plugin-contributed type.

- **Sensitive values:** `configSchema[*].sensitive: true` fields are stored encrypted inside `task_instances.config` (Phase 1 encrypts the whole column) and rendered masked (`••••••••`) with an edit affordance — the pattern `/admin#system` already uses for `llm_apikey`.
- **Optional validation:** a plugin may export `validateConfig(config) => Promise<{ ok: true } | { ok: false; reason: string }>`, named via `manifest.providerConfigValidator`. The admin UI calls it before persisting (e.g. a quick authenticated `GET` against the entered URL/token). Absent a validator, config is saved as-is.

### Built-in migration impact

`KaneoProvider.configRequirements` and `YouTrackProvider.configRequirements` (instance-level today) move to static `TaskProviderTypeDescriptor` exports registered by the type registry. The instance-level `configRequirements` field stays on the `TaskProvider` interface for one release of overlap, then is removed (Section 7, phase 5).

## Section 5: Migrating Kaneo and YouTrack

The two built-in task providers move into `plugins/`. This proves the API and removes the dual registration path.

### Layout after migration

```text
plugins/
  task-provider-kaneo/
    plugin.json
    index.ts                 # activate()/deactivate(); registers the type + BOOTSTRAP_ENV_MAP export
    provider.ts              # former src/providers/kaneo/index.ts
    operations/              # former src/providers/kaneo/operations/*
    schemas/                 # former src/providers/kaneo/schemas/*
    client.ts
    classify-error.ts
    identity-resolver.ts
  task-provider-youtrack/
    plugin.json
    index.ts
    provider.ts              # former src/providers/youtrack/index.ts
    operations/
    schemas/
    client.ts
    classify-error.ts

src/providers/
  types.ts                   # KEEP — TaskProvider interface, domain types
  task-capability.ts         # KEEP — TaskCapability union
  domain-types.ts            # KEEP
  errors.ts                  # KEEP
  registry.ts                # MODIFIED — merged built-in + plugin-contributed factory lookup; listTaskProviderTypes()
  factory.ts                 # MODIFIED — delegate to the resolver/registry lookup
  # kaneo/ and youtrack/ directories removed
```

### Backward compatibility

- **Auto-approval seed:** a startup `seedBuiltinProviderPlugins()` step writes `plugin_admin_state` approval rows for the two plugins on first run **if** no approval row exists, with `approved_by = '__migration__'` and the current manifest hash. It is a no-op after one successful seed (guarded by a migration-state row).
- **`defaultEnabled: true`** in both manifests means existing `task_instances` rows of type `kaneo`/`youtrack` keep working without admin intervention.
- **Config data:** existing `task_instances.config` rows already match the config schema (`baseUrl`/`apiKey`/`workspaceId` for Kaneo; `baseUrl`/`token` for YouTrack). No data migration.

### Env-var bootstrap mapping

Phase 1's `bootstrap()` seeds the first `task_instances` row from env vars. After migration it must know which env var maps to which config key. Each plugin exports a bootstrap-only map from its entry point:

```typescript
// plugins/task-provider-kaneo/index.ts
export const BOOTSTRAP_ENV_MAP: Record<string, string> = {
  KANEO_CLIENT_URL: 'baseUrl',
  KANEO_INTERNAL_URL: 'internalUrl',
}
```

`bootstrap()` reads this map only at first-run seeding, never at runtime.

### `KANEO_INTERNAL_URL`

Read from `process.env` directly inside Kaneo client code today. After migration it becomes an optional `internalUrl` config key, seeded from the env var via `BOOTSTRAP_ENV_MAP`. Deployments setting the env var keep working.

## Section 6: Identity Resolver, Prompt Addendum & Other Hooks

`TaskProvider` has hooks beyond CRUD: `identityResolver`, `getPromptAddendum()`, `buildTaskUrl`/`buildProjectUrl`, `classifyError`, `normalizeDueDateInput`/`formatDueDateOutput`/`normalizeListTaskParams`, `preferredUserIdentifier`. These are methods/properties on the instance the factory returns — the plugin returns the same shape, so most need no new infrastructure.

### Identity resolver (decision: keep identity in core, behind a facade)

Kaneo's identity resolver persists to the core identity store, which is also consumed by `src/identity/` and the `set_my_identity` core tool. Moving it per-plugin would break cross-provider reuse and put a security-sensitive surface inside untrusted-tier code later. Identity stays in core, exposed to plugins only through a permission-gated facade (`identity` permission). Plugins never touch the tables, so the **storage shape is invisible to plugin code** and can evolve without any plugin change.

**Target model: hub-and-spoke with proof-of-ownership.** Today's store is flat connections keyed by `(context_id, provider_name)` — one chat context linked to one provider user, with no canonical "person" node and weak trust-on-claim verification (`set_my_identity` links any login that merely _exists_ in the provider; no proof of control). The target the facade is designed against:

- **Hub (`identity`)** — a canonical person node. Chat accounts and provider accounts attach as **spokes** (`kind`, `ref`, `verified`, `method`, `confidence`). Resolving `me` = chat spoke → identity → provider spoke for the active provider. This is what enables one human to span multiple chat platforms and multiple providers with carry-over trust — squarely a multi-provider-router concern.
- **Proof-of-ownership** — a spoke reaches `verified` only via evidence of control (provider-side token entry in DM, or a bot-written one-time code read back from the provider account). Trust-on-claim becomes `unverified` (`method: 'manual_nl'`, low confidence) and never silently links a person across the hub. **This — not the hub shape — is what closes the impersonation gap.** The hub only propagates a proof to a person's other links; with weak spokes it would propagate risk instead, so proof is the load-bearing piece.

**Facade interface (stable from day one):**

```typescript
// PluginContext, gated by permission 'identity'
readonly identity?: {
  // Resolve the verified provider account for the current chat user, if any.
  lookupForChatUser(chatUserId: string): { providerUserId: string; providerLogin: string; verified: boolean } | null
  // Record an unverified claim (method 'manual_nl'); never marks verified.
  recordClaim(chatUserId: string, providerUserId: string, providerLogin: string): void
  // Begin a proof-of-ownership challenge; provider-gated (requires the
  // provider's identityResolver to implement a proof step). Returns the
  // challenge handle the core verified-DM flow drives to completion.
  beginVerification?(chatUserId: string, providerLogin: string): Promise<IdentityChallenge>
}
```

A plugin's `identityResolver` can use `ctx.identity` for persistence/verification, or run pure-API lookups without persisting (no permission needed). Core code keeps owning the tables and the challenge interaction.

**Sequencing.** The hub migration (schema + merge/split machinery) and the challenge flow (a new verified-DM interaction, and an `identityResolver` proof primitive) are larger than the provider-as-plugin migration and overlap the multi-provider-router track (`claude/multi-provider-phase-1-plan-8kqwN`), since cross-provider identity is exactly what the router needs. They land as their **own phase, with/after the router**. The provider-as-plugin migration ships against the facade interface above from day one; until the hub/challenge phase lands, the facade is backed by the existing flat store and `verified` reflects today's (weak) reality. No plugin code changes when the backing store is upgraded.

### Prompt addendum

`getPromptAddendum()` is already called by `buildSystemPrompt()` on the resolved provider instance. Plugin-contributed providers return their addendum the same way. No change.

### Error classification & stable import path

`classifyError(error)` returns an `AppError` from `src/errors.ts`. To avoid forcing plugin authors to deep-import internal modules, expose a stable import alias `papai/plugin-types` that re-exports: the `TaskProvider` interface, domain types, `TaskCapability`, `ProviderConfigRequirement`, the `AppError` union, and its constructors. No runtime behavior change — only a stable public surface.

### Pure functions

URL builders and date normalizers are pure functions on the instance. No infrastructure change.

## Section 7: Testing & Rollout

### Testing

| Test file                                                  | Covers                                                                                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `tests/plugins/task-provider-registration.test.ts`         | `registerTaskProviderType` validates declared type, requires `provider.task`, rejects duplicate type across plugins   |
| `tests/plugins/task-provider-registry-merge.test.ts`       | `createProvider` resolves built-in, plugin-contributed, and unknown types                                             |
| `tests/plugins/task-provider-resolver.test.ts`             | `defaultTaskProviderResolver.resolve` returns plugin-contributed providers; null path when plugin unapproved/rejected |
| `tests/plugins/task-provider-config-schema.test.ts`        | `listTaskProviderTypes()` merges descriptors; sensitive-field masking                                                 |
| `tests/plugins/task-provider-fetch-allowlist.test.ts`      | `httpFetch` rejects out-of-allowlist hosts; allowlist sourced from manifest                                           |
| `tests/integration/task-provider-plugin-migration.test.ts` | Existing `kaneo` `task_instances` row resolves after seed; `seedBuiltinProviderPlugins` idempotent                    |

Reuses `mockDrizzle` and `createMockProvider` (`tests/CLAUDE.md`). No new test infrastructure.

### Rollout (one PR per phase; system runs end-to-end at every step)

1. Plugin API extensions: `provider.task` permission, `taskProviderTypes` contribution, `providerCapabilities`/`providerConfigSchema`/`providerAllowedHosts`/`providerConfigValidator` manifest fields, `registerTaskProviderType`, `ctx.providerRuntime` + `ctx.identity` facades, `papai/plugin-types` alias. No callers.
2. Registry extensions: `createProvider` consults the plugin-contributed map; `listTaskProviderTypes()`; admin UI swaps to schema-driven rendering; Phase 5 capability source reads plugin capabilities.
3. Kaneo migration: `plugins/task-provider-kaneo/` created; hardcoded factory removed; `seedBuiltinProviderPlugins` added with idempotency guard; `internalUrl` config key.
4. YouTrack migration: same pattern.
5. Remove the now-unused instance-level `TaskProvider.configRequirements` after a release of overlap.

## Section 8: Risks & Mitigations

- **Duplicate type registration** (two plugins claim `kaneo`): first-wins, second logged as error and skipped; surfaced in `/plugin info`.
- **Unresolvable instances after deactivation:** existing Phase 2 null-provider handling applies; admin UI labels the row clearly.
- **Bootstrap env mapping drift:** `BOOTSTRAP_ENV_MAP` is the single source for env→config mapping; documented per plugin; read only at first-run.
- **Hidden `process.env` reads in migrated code:** the migration must replace every direct `process.env` read in Kaneo/YouTrack with a config key (audited during phases 3–4); `ctx.providerRuntime` provides no env access, so a missed read fails loudly in tests rather than silently working.
