<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Task-Provider-as-Plugin — Phases 3–5 Design

**Date:** 2026-05-28
**Status:** Draft
**Related:** [`2026-05-23-task-provider-as-plugin-design.md`](./2026-05-23-task-provider-as-plugin-design.md) (parent spec — Sections 5, 7), [`2026-05-26-task-provider-plugin-prerequisites-design.md`](./2026-05-26-task-provider-plugin-prerequisites-design.md) (config-scope model + dangling Phase-2 items), [`2026-05-24-task-provider-as-plugin-phase-1.md`](../plans/2026-05-24-task-provider-as-plugin-phase-1.md), [`2026-05-25-task-provider-as-plugin-phase-2.md`](../plans/2026-05-25-task-provider-as-plugin-phase-2.md), [`2026-05-26-task-provider-plugin-prerequisites-plan.md`](../plans/2026-05-26-task-provider-plugin-prerequisites-plan.md)

## Summary

Complete the task-provider-as-plugin migration in one combined design covering parent-spec rollout steps 3, 4, and 5. Phases 3–4 relocate the two built-in task providers (Kaneo, YouTrack) from `src/providers/` into `plugins/`, leaving the contributed-plugin path as the single registration mechanism. Phase 5 retires both vestigial back-compat fields that the prerequisites work kept alive for transition (`TaskProvider.configRequirements` and `TaskProviderTypeDescriptor.configSchema` + its `legacyConfigSchema` helper).

With the prerequisites work landed — config-scope model, `papai/plugin-types` alias, `validateConfig` wiring, first-wins-with-log duplicate registration, descriptor-driven resolver — this is largely a code-move plus targeted core cleanups. Three deliberate decisions diverge from the parent spec's outline:

1. **No env-driven task-instance bootstrap.** `TASK_PROVIDER`, `KANEO_CLIENT_URL`, `KANEO_INTERNAL_URL`, `YOUTRACK_URL` are removed from first-run bootstrap. Task instances are created exclusively through `/admin#instances`. The parent spec's `BOOTSTRAP_ENV_MAP` contract is dropped.
2. **No auto-approval seed.** Operators must run `/plugin approve task-provider-kaneo` (and/or `task-provider-youtrack`) once after upgrade. The parent spec's `seedBuiltinProviderPlugins()` is not implemented. A startup `WARN` lists pending approvals so the operator sees the required commands.
3. **Phase 5 retires both vestigial fields.** Not just `TaskProvider.configRequirements` (parent spec §7.5), but also `TaskProviderTypeDescriptor.configSchema` and `legacyConfigSchema` from the prerequisites compatibility surface.

## Goals

- Collapse to one registration path for task providers (contributed-plugin path).
- Make the resolver fully descriptor-driven: zero per-type branches.
- Keep the operator experience for an already-bootstrapped deployment effectively unchanged except for a one-time `/plugin approve` per provider after upgrade.

## Non-Goals

- Identity hub-and-spoke / proof-of-ownership challenge (separate phase, parent spec §6).
- Per-context credential-model changes (already shipped in prerequisites).
- Third-party provider trust tier (research doc, separate track).
- Adopting `ctx.providerRuntime.httpFetch` in the migrated providers. First-party trusted plugins retain their existing `client.ts` fetch paths; the facade exists for a future third-party trust tier.
- Removing the legacy `users.kaneo_workspace_id` column. Phase 3 picks `user_config[kaneo_workspace_id]` as the single source of truth and deprecates the column; the actual column drop is a follow-on migration.
- Changing the chat reply that fires when a context's task provider is unresolvable. Today it says "needs /setup". A follow-on UX change can distinguish "plugin not approved" from "no instance assigned".

## Current State (post-prerequisites, verified on `master`, 2026-05-28)

- `papai/plugin-types` alias is wired: `tsconfig.json` `paths`, `package.json` `exports`, and `src/providers/public-types.ts` re-exports `TaskProvider`, `TaskCapability`, `ProviderConfigRequirement`, `AppError` and its constructors.
- Built-in descriptor seeds live in `src/providers/builtin-descriptors.ts` and already declare scope-tagged config fields with `storageKey` mappings:
  - Kaneo: instance-scoped `baseUrl`, `internalUrl`; context-scoped `credential` (`storageKey: 'kaneo_apikey'`), `workspaceId` (`storageKey: 'kaneo_workspace_id'`).
  - YouTrack: instance-scoped `baseUrl`; context-scoped `token` (`storageKey: 'youtrack_token'`).
- `TaskProviderResolver` (`src/providers/resolver.ts`) uses generic descriptor-driven config assembly via `buildConfigFromDescriptor`. One residual per-type branch remains: `readContextScopedField` falls back to `getKaneoWorkspace(contextId)` for `(kaneo, workspaceId)` instead of `getConfig(contextId, 'kaneo_workspace_id')`.
- `validateConfig` is wired through `registerTaskProviderType` (`src/plugins/context.ts:60,137,140,154`) and stored on `ContributedTaskProviderEntry`.
- Duplicate-type registration is first-wins-with-log (`src/providers/registry.ts:107-119`); built-in-shadow rejection still throws.
- Bootstrap (`src/instances/bootstrap.ts`) still hardcodes `BuiltinTaskType = 'kaneo' | 'youtrack'`, `TASK_ENV_REQUIREMENTS = { kaneo: ['KANEO_CLIENT_URL'], youtrack: ['YOUTRACK_URL'] }`, and a `buildTaskConfig` switch.
- Vestigial fields still present:
  - `TaskProvider.configRequirements` in `src/providers/types.ts:86`, implemented in `KaneoProvider` (`src/providers/kaneo/index.ts:61`) and `YouTrackProvider` (`src/providers/youtrack/index.ts:87`).
  - `TaskProviderTypeDescriptor.configSchema` and `legacyConfigSchema` helper in `src/providers/registry.ts`; `ContributedTaskProviderEntry.configSchema` legacy single-list fallback used by `contributedInstanceFields`/`contributedContextFields`.

## Phase 3 — Kaneo Migration

### 3.1 Plugin layout

```
plugins/task-provider-kaneo/
  plugin.json            (manifest; §3.2)
  index.ts               (default-export factory; activate() registers type; §3.3)
  provider.ts            (former src/providers/kaneo/index.ts — KaneoProvider class)
  constants.ts           (ALL_CAPABILITIES, KANEO_TRAITS — moved from src/providers/kaneo/constants.ts)
  client.ts              (direct fetch path, unchanged)
  classify-error.ts
  identity-resolver.ts
  provision.ts           (workspace provisioning; writes user_config[kaneo_workspace_id]; §3.6)
  operations/            (former src/providers/kaneo/operations/*)
  schemas/               (former src/providers/kaneo/schemas/*)
  validate-config.ts     (referenced by manifest.providerConfigValidator)
```

The plugin imports `TaskProvider`, `TaskCapability`, `ProviderConfigRequirement`, and `AppError`/`providerError` from `papai/plugin-types`. Internal core APIs the plugin still needs (config reads for workspace ID, identity-store writes for provisioning) reach the plugin through the `PluginContext` facade — never via deep `src/` imports.

### 3.2 Manifest

```jsonc
{
  "id": "task-provider-kaneo",
  "name": "Kaneo",
  "version": "1.0.0",
  "description": "Kaneo task-tracker integration.",
  "apiVersion": 1,
  "permissions": ["provider.task", "identity"],
  "contributes": {
    "taskProviderTypes": ["kaneo"],
  },
  "providerCapabilities": [
    /* ALL_CAPABILITIES — every TaskCapability the plugin supports */
  ],
  "providerConfigSchema": [
    { "key": "baseUrl", "label": "Kaneo URL", "required": true, "sensitive": false, "scope": "instance" },
    { "key": "internalUrl", "label": "Kaneo Internal URL", "required": false, "sensitive": false, "scope": "instance" },
    {
      "key": "credential",
      "label": "Kaneo API Key",
      "required": true,
      "sensitive": true,
      "scope": "context",
      "storageKey": "kaneo_apikey",
    },
    {
      "key": "workspaceId",
      "label": "Workspace ID",
      "required": true,
      "sensitive": false,
      "scope": "context",
      "storageKey": "kaneo_workspace_id",
    },
  ],
  "providerAllowedHosts": [],
  "providerConfigValidator": "validateConfig",
  "defaultEnabled": false,
}
```

Notes:

- `providerAllowedHosts: []` because Kaneo is self-hosted; the plugin opts out of `ctx.providerRuntime.httpFetch` and keeps its existing client (§3.7).
- `defaultEnabled: false` is deliberate (decision 2): activation is per-context via `/plugin enable`, gated behind `/plugin approve`.
- The `providerConfigSchema` block is a direct port of the current `builtinDescriptorSeeds[kaneo]` declarations from `src/providers/builtin-descriptors.ts`.

### 3.3 Entry-point factory

```ts
// plugins/task-provider-kaneo/index.ts
import type { PluginContext, TaskProvider } from 'papai/plugin-types'
import { KaneoProvider, type KaneoConfig } from './provider.js'
import { isKaneoSessionCookie } from './client.js'
import { validateConfig } from './validate-config.js'

const buildKaneoConfig = (config: Record<string, string>): KaneoConfig =>
  isKaneoSessionCookie(config.credential)
    ? { baseUrl: config.baseUrl, internalUrl: config.internalUrl, sessionCookie: config.credential }
    : { baseUrl: config.baseUrl, internalUrl: config.internalUrl, apiKey: config.credential }

export default () => ({
  activate(ctx: PluginContext) {
    ctx.registration.registerTaskProviderType('kaneo', {
      factory: (config): TaskProvider => new KaneoProvider(buildKaneoConfig(config), config.workspaceId),
      validateConfig,
    })
  },
})
```

`buildKaneoConfig` — the API-key-vs-session-cookie branch via `isKaneoSessionCookie` — moves from `src/providers/registry.ts` lines 41–45 into the plugin's entry point. `validateConfig` runs the existing healthcheck path against the supplied base URL and credential.

### 3.4 Core deletions

- `src/providers/kaneo/` — entire directory.
- `src/providers/registry.ts`:
  - inline `createKaneoProvider` and the `'kaneo'` entry in the `providers` map.
  - `import { isKaneoSessionCookie, KaneoProvider, type KaneoConfig }`.
- `src/providers/builtin-descriptors.ts` — kaneo seed (`builtinDescriptorSeeds` becomes single-entry after Phase 3 lands, then empty after Phase 4).
- `src/providers/resolver.ts` — the `if (descriptor.type === 'kaneo' && field.key === 'workspaceId') return deps.getKaneoWorkspace(contextId)` branch (lines 47-48). Subject to §3.6 audit.
- `src/types/config.ts`:
  - `KANEO_WORKSPACE_CONFIG_KEY` and `TaskProviderConfigKey` remain (they are used by the existing config-store path the plugin reads from via `ctx.kv`/`ctx.adminConfig`).
- `tests/providers/kaneo/*` — moved to `tests/plugins/task-provider-kaneo/` or co-located under the plugin per repo convention.

### 3.5 Bootstrap removal (decision 1)

- Delete `BuiltinTaskType`, `parseTaskType`, `TASK_ENV_REQUIREMENTS`, and `buildTaskConfig` from `src/instances/bootstrap.ts`.
- `bootstrapInstancesFromEnv()` seeds only the platform instance and the admin row. The transaction shrinks accordingly.
- `BootstrapResult` loses `taskInstanceId`.
- `parseEnv` drops `TASK_PROVIDER`; `collectMissing` drops `TASK_PROVIDER` and the task env-var loop.
- `src/index.ts` startup logging that mentions seeded task instance ID is updated.
- Operator workflow for a fresh deployment:
  1. Set chat-provider env vars (unchanged) + `ADMIN_USER_ID`.
  2. Boot; bootstrap seeds the platform instance only.
  3. Admin opens `/admin#instances` and creates a task instance (e.g. `kaneo-main`).
  4. Admin runs `/plugin approve task-provider-kaneo` (DM).
  5. Admin assigns the task instance to the context via `/setup` or `/admin#instances`.

### 3.6 Kaneo workspaceId — dual-store reconciliation (decision: single source of truth)

The descriptor declares `storageKey: 'kaneo_workspace_id'`, but the resolver currently special-cases this field, reading it via `getKaneoWorkspace(contextId)` → `users.kaneo_workspace_id` column through the `getCachedWorkspace` cache layer. Removing the special-case requires the config-store key to be authoritative.

**Resolution: `user_config[kaneo_workspace_id]` is the single source of truth.** The `users.kaneo_workspace_id` column is deprecated and a follow-on migration (out of scope here) will drop it.

Concrete changes:

- The plugin's `provision.ts` writes only `user_config[kaneo_workspace_id]`. The existing `setKaneoWorkspace` writer (`src/users.ts:181`) is removed; callsites switch to a `ctx.kv`-or-`setConfig`-style core helper exposed via the plugin context.
- Resolver's special-case branch (§3.4) is deleted; `readContextScopedField` falls through to the generic `getConfig(contextId, 'kaneo_workspace_id')` path.
- The implementation plan must audit:
  - `src/providers/kaneo/provision.ts:233` — moves into the plugin; rewrites to write the config key.
  - Setup-wizard / `/config` editor writers (`src/wizard/steps.ts:94` and friends).
  - Any reader of `getKaneoWorkspace` outside the resolver — replace with a `getConfig` read.
- Migration `042_user_workspace_config_backfill.ts` already backfilled existing rows; ongoing dual-write is what must end.
- `getKaneoWorkspace`/`setKaneoWorkspace`/`getCachedWorkspace`/`setCachedWorkspace` and the cache table itself become dead code post-Phase-3 (file-level deletion can land in the same PR or as a small follow-on).

If the audit discovers a writer that cannot be retargeted in Phase 3, fall back to a transitional write-both-read-config-key step, but commit to a follow-on PR that completes the migration before Phase 5 lands.

### 3.7 First-party trust note

The migrated provider plugins are trusted, in-repo code. They:

- do **not** request the `http` permission;
- declare `providerAllowedHosts: []`;
- do **not** use `ctx.providerRuntime.httpFetch`;
- keep their existing `client.ts` direct-fetch path.

The `providerRuntime` facade exists exclusively for a future third-party trust tier, where the SSRF guard plus manifest host allowlist becomes load-bearing. For self-hosted providers (any base URL the admin enters), a static allowlist is the wrong shape anyway. Documenting this here prevents reviewers from flagging it as a missed permission.

### 3.8 Upgrade procedure (decision 2)

Existing deployments hold task_instance rows of type `'kaneo'`. After Phase 3 lands, the built-in `'kaneo'` provider is gone; resolution succeeds only when the plugin is approved and active. Without auto-approval (decision 2), an unapproved deployment falls into the existing "no provider" path: `resolver.resolve()` returns `null`, and the chat reply is "needs /setup" (unchanged; UX improvement deferred).

To make the requirement visible without changing chat behavior:

- Startup check in `src/index.ts` (or a new `src/instances/health.ts`): after plugin activation, scan `task_instances` for types whose contributed provider is **not registered** (either no matching plugin discovered, plugin discovered but not approved, or plugin approved but activation failed). Log a single `WARN` listing pending approvals plus the exact `/plugin approve <id>` command per missing plugin.
- `/admin#instances` row decoration: instances whose type cannot be resolved render with an "unresolvable: plugin not active" label, sourced from a new server-side `unresolvedReason` field on the instance view. The same code path will later cover plugin-deactivation orphaning.
- Release notes (release that ships Phase 3): "**Action required after upgrade.** Run `/plugin approve task-provider-kaneo` (DM, super admin) if your deployment uses Kaneo. Until approved, Kaneo-backed contexts will reply 'needs /setup'."

### 3.9 Documentation updates

- `CLAUDE.md`: remove `TASK_PROVIDER`, `KANEO_CLIENT_URL`, `KANEO_INTERNAL_URL` from "Required Environment Variables"; add a short "removed env vars" paragraph for upgrade clarity.
- `src/providers/CLAUDE.md`: rewrite to reflect plugin-only provider model — built-in registration path is gone; `createProvider` only delegates to contributed factories.
- `docs/plugins/developer-guide.md`: add Kaneo as a worked example of a provider plugin (manifest, factory, identity-resolver port, validateConfig).
- The remaining migration phases land their own docs deltas; Phase 4 amends `YOUTRACK_URL`, Phase 5 amends the public type re-exports.

### 3.10 Testing

- Move existing `tests/providers/kaneo/*` into `tests/plugins/task-provider-kaneo/` (or co-located, matching the repo's plugin-test convention) — content largely unchanged, imports retargeted at the plugin module.
- `tests/providers/resolver.test.ts`: replace the workspaceId-special-case test with a generic descriptor-driven test exercising `kaneo` via the contributed-factory branch (set up via `registerContributedTaskProviderType`).
- `tests/plugins/loader.test.ts`: add a case verifying the kaneo plugin activates and registers its type.
- `tests/integration/task-provider-plugin-migration.test.ts`: existing `task_instances` row of type `'kaneo'` resolves once the plugin is approved (test helper that simulates `pluginRegistry.approve` in setup).
- `tests/instances/bootstrap.test.ts`: drop tests asserting task-instance seeding; add a regression test confirming task-related env vars are ignored.
- `tests/e2e/`: the Kaneo Docker harness must call the plugin-approval helper in test setup; failure mode is loud ("no provider"). Adjust `tests/e2e/bun-test-setup.ts` accordingly.
- New: `tests/instances/health.test.ts` (or extension of an existing health test) covers the §3.8 startup `WARN` for unapproved providers referenced by `task_instances`.

## Phase 4 — YouTrack Migration (delta from Phase 3)

Follows the Phase 3 pattern. Only the differences:

- **Manifest.** `permissions: ["provider.task", "identity"]`; `providerConfigSchema` is just:
  ```jsonc
  [
    { "key": "baseUrl", "label": "YouTrack URL", "required": true, "sensitive": false, "scope": "instance" },
    {
      "key": "token",
      "label": "YouTrack Permanent Token",
      "required": true,
      "sensitive": true,
      "scope": "context",
      "storageKey": "youtrack_token",
    },
  ]
  ```
  No `internalUrl`, no `workspaceId`. `providerCapabilities` is `YOUTRACK_CAPABILITIES`; the manifest does not need a separate traits field beyond the descriptor's `traits` set (`YOUTRACK_TRAITS`), which the contributed entry carries via the registration call.
- **Factory.** Trivial — `(config) => new YouTrackProvider({ baseUrl: config.baseUrl, token: config.token })`.
- **No workspace dual-store concern.** `'youtrack_token'` already flows through the generic `getConfig` path; nothing to reconcile.
- **No resolver special-case to delete.** Kaneo carried the only one.
- **Bootstrap.** `YOUTRACK_URL` cleanup is already done in Phase 3's §3.5 rewrite — bootstrap is provider-agnostic after Phase 3 lands. Phase 4 only needs to confirm no stray `YOUTRACK_URL` reads remain (`grep`).
- **Core deletions.** `src/providers/youtrack/` directory, `'youtrack'` entries in `src/providers/registry.ts` and `src/providers/builtin-descriptors.ts`, kaneo+youtrack imports the latter file no longer needs.
- **Upgrade procedure.** Identical pattern: `/plugin approve task-provider-youtrack`. Release notes add a parallel line.
- **Docs.** Remove `YOUTRACK_URL` from `CLAUDE.md`. Update `docs/plugins/developer-guide.md` if Phase 3's worked example needs a second-provider comparison (optional, only if it improves the guide).
- **Tests.** Mirror of §3.10: move `tests/providers/youtrack/*`, add a contributed-factory resolver case, add bootstrap regression for `YOUTRACK_URL`, add a Kaneo+YouTrack co-resolution integration test.

Phase 4 has no ordering dependency on Phase 3 (each provider stands alone). Sequencing Phase 3 → Phase 4 is the recommended PR order for review-size reasons; parallel branches are acceptable. Phase 5 is hard-blocked on both.

## Phase 5 — Retire vestigial back-compat fields

After Phases 3 and 4 land, no built-in providers remain. Both vestigial fields have zero callers outside the providers themselves and can be removed in one mechanical pass.

### 5.1 Removals

- `src/providers/types.ts:86` — `readonly configRequirements: readonly ProviderConfigRequirement[]` field on `TaskProvider`.
- `src/providers/registry.ts`:
  - `TaskProviderTypeDescriptor.configSchema` field.
  - `legacyConfigSchema` helper and its invocations inside `listTaskProviderTypes()`.
  - `ContributedTaskProviderEntry.configSchema` (legacy single-list variant) plus the `contributedInstanceFields`/`contributedContextFields` fallback branches that read it. Post-Phase-5, contributed entries must carry `instanceConfigSchema` and `contextConfigSchema` explicitly. (Phase 3 and Phase 4 already write both; the fallback exists only for any never-realized older shape.)
- `src/providers/public-types.ts` — drop `ProviderConfigRequirement` if no live consumer remains after the field is deleted; otherwise keep. The descriptor surface uses `ProviderConfigField` (with `scope`/`storageKey`); `ProviderConfigRequirement` was only kept alive for the removed `TaskProvider.configRequirements`.

### 5.2 Callsite audit

- `src/debug/task-provider-type-routes.ts` — view serializer must not reference `descriptor.configSchema`.
- `client/admin/instance-fetcher-schemas.ts` — `TaskProviderTypeViewSchema` must drop the combined `configSchema` field if it still carries one.
- `client/shared/api-types.ts` — `TaskProviderTypeView` must source from `instanceConfigSchema`/`contextConfigSchema`.
- `client/admin/sections/InstancesSection.svelte` — config-form rendering must source from `instanceConfigSchema` only (instance-scoped fields are the only ones the admin form edits; context-scoped fields are per-user and entered via `/setup`/`/config`).
- Test fixtures and helpers in `tests/providers/`, `tests/plugins/`, and `tests/client/admin/` that hand-build descriptor or contributed-entry objects.

### 5.3 Ordering inside Phase 5

1. Change the `TaskProvider` interface (remove `configRequirements`).
2. Delete `KaneoProvider`/`YouTrackProvider` implementations of it — but at this point both classes already live in plugins and own their type's manifest schema; the field implementations in the plugin classes can be dropped at the same time.
3. Fix server serialization (`task-provider-type-routes.ts`).
4. Fix client schema and component.
5. Delete `legacyConfigSchema` and `ContributedTaskProviderEntry.configSchema` fallback.
6. Knip / typecheck / tests; clean up any now-unused re-exports.

### 5.4 Hard prerequisite

Phase 5 lands strictly **after** both Phase 3 and Phase 4. Landing it earlier deletes back-compat fields the in-progress migrations still rely on.

## Risks & Mitigations

- **R1 — Upgrade break for in-use providers.** A deployment with `kaneo` task_instances rows falls to "needs /setup" until an admin runs `/plugin approve`. **Mitigation:** the startup `WARN` (§3.8), the unresolvable-instance label in `/admin#instances`, and explicit release notes. Not eliminated by design (decision 2).
- **R2 — Removed env vars confuse upgraders.** Deployments still setting `TASK_PROVIDER`, `KANEO_CLIENT_URL`, `KANEO_INTERNAL_URL`, `YOUTRACK_URL` see no functional change (bootstrap no-ops once `task_instances` is non-empty), but the env vars become inert. **Mitigation:** removal from `CLAUDE.md` plus a "removed env vars" section in release notes.
- **R3 — Kaneo workspaceId dual-store drift.** If the §3.6 writer audit misses a callsite, post-migration resolution silently reads a stale value. **Mitigation:** the audit is a named deliverable of the Phase 3 implementation plan; CI grep guard `grep -r "setKaneoWorkspace\|getKaneoWorkspace" src/` must return only the dead-code removals.
- **R4 — `ctx.identity` facade gaps surface late.** Phase 3 is the first real consumer (identity-resolver port). If the facade lacks a primitive (e.g. `recordVerifiedClaim`), Phase 3 discovery cascades into a facade extension. **Mitigation:** implementation plan front-loads the identity-resolver port so gaps surface in the first task.
- **R5 — E2E harness boots the built-in.** `tests/e2e/bun-test-setup.ts` currently expects the built-in `kaneo` factory path. **Mitigation:** §3.10 requires the plugin-approval helper in E2E setup; CI fail mode is the loud "no provider" path.
- **R6 — Operator runs `/plugin approve` for the wrong plugin id.** The id is `task-provider-kaneo` (kebab-case, full prefix), not `kaneo`. **Mitigation:** the §3.8 startup `WARN` emits the exact command; `/plugin list` shows the id.

## Rollout sequencing

**Recommended order:** Phase 3 → Phase 4 → Phase 5, one PR per phase.

- Phase 3 carries the bootstrap rewrite (§3.5), the resolver special-case removal (§3.6), the startup-warn (§3.8), and the `/admin#instances` label (§3.8). Phase 4 inherits these and is mechanically smaller.
- Phase 5 is hard-blocked on both 3 and 4.
- **Acceptable alternative:** Phase 3 and Phase 4 in parallel branches if review bandwidth allows. Merge order does not matter; both are independent code moves once the bootstrap rewrite from §3.5 is consolidated into whichever phase ships first (move §3.5 into a small shared prerequisite PR if both phases run in parallel).
- **Not acceptable:** any ordering that lands Phase 5 before both providers are migrated.

## Open follow-ons (not in scope here)

- Drop the `users.kaneo_workspace_id` column once Phase 3 deprecates writers (separate small migration).
- UX: distinguish "plugin not approved" from "needs /setup" in the chat reply when `resolver.resolve()` returns `null`.
- Optional: extend the `/admin#instances` unresolvable-reason machinery to cover plugin-deactivated cases uniformly.
- Identity hub-and-spoke + proof-of-ownership (parent spec §6).
- Third-party trust tier (research doc) — when this lands, the migrated plugins become a reference for how to scope `providerAllowedHosts` for non-self-hosted providers.
