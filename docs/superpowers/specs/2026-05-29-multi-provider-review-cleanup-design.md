<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Review Cleanup Design

**Date:** 2026-05-29
**Status:** Approved for planning
**Parent:** [`2026-05-25-multi-provider-stabilization-design.md`](./2026-05-25-multi-provider-stabilization-design.md)

## Summary

Clean up the remaining multi-provider review findings in staged, reviewable phases. The first priority is runtime correctness: DB-backed platform instance changes must have a complete and explicit path into the live `ChatRouter`. Later phases harden validation, align plugin-contributed task providers with their manifest metadata, and remove transitional compatibility surfaces that no longer serve production behavior.

The design preserves the existing DB-first admin model. Ordinary instance API mutations persist desired state. `POST /api/platform-instances/apply` remains the operator-controlled runtime synchronization point, but it becomes a full reconciliation operation rather than an additive start/missing/remove helper.

## Goals

- Reconcile live chat adapters with persisted platform instance state, including active config rotation.
- Keep instance API route handlers focused on HTTP parsing, validation, persistence, masking, and cache invalidation.
- Return clear, non-misleading errors for duplicate instance creates and invalid task instance config.
- Make contributed task provider manifest metadata effective at runtime.
- Retire production-unused compatibility surfaces only after replacement tests cover the supported path.
- Preserve existing encrypted config handling and avoid exposing raw secrets through runtime snapshots or API responses.

## Non-Goals

- Automatic hot-apply on every platform instance mutation.
- Changing the dashboard into a real-time instance control plane.
- Rolling back DB state when a runtime adapter fails to restart.
- Removing compatibility code that still protects persisted production data.
- Redesigning the whole plugin system or adding untrusted third-party plugin sandboxing.

## Findings Covered

This spec covers the validated review findings:

- Active platform config/token edits have no runtime effect until process restart because `/apply` does not recreate running instances.
- Platform delete and status changes mutate DB state only; runtime synchronization is incomplete until `/apply`, and `/apply` cannot reconcile config changes.
- Cache invalidation side effects are inconsistently placed across stores and routes.
- Duplicate platform/task create can surface as a generic `500 { error: "config unreadable" }` if the preflight existence check races a primary-key insert.
- Task provider config validators run through admin routes but not through `TaskProviderResolver.resolve()`.
- Plugin provider manifest metadata is incomplete or inert: manifest-declared validator names are not wired, storage aliases are dropped by the facade, and provider traits cannot be declared through the manifest-backed registration path.
- Transitional compatibility surfaces remain in production or test-only paths: env-shaped adapter construction, `url` to `baseUrl` fallbacks after migration 045, legacy combined `configSchema`, scope `'user'` remapping, manual cascade helpers superseded by FK cascade, and default adapter instance IDs intended only for tests.

Some review items are intentionally downgraded:

- `ChatRouter.stopInstance()` not persisting DB status is not by itself a production bug because router lifecycle stop is a runtime operation. Admin status changes are the desired-state source.
- Missing context assignment to non-existent task/platform instances is protected by foreign keys when SQLite `PRAGMA foreign_keys=ON` is active. Stopped-instance assignment remains a UX/admin validation concern.
- Descriptor capabilities and live provider capabilities have different valid consumers. Core tool gating uses the live provider; plugin compatibility uses descriptors.

## Architecture

### Phase 1: Complete Platform Runtime Reconciliation

Introduce a single reconciliation boundary for platform instances. Route handlers continue to persist desired DB state. `POST /api/platform-instances/apply` compares desired DB rows with live `ChatRouter` snapshots and performs the minimum runtime lifecycle changes required to match desired state.

Desired DB state is all active platform instances from `listActivePlatformInstances()`. Runtime state is `router.listInstances()` plus private metadata retained by the router for comparison. Reconciliation handles these cases:

- Runtime instance missing and DB row active: add and start it.
- Runtime instance present and DB row removed or stopped: remove it from the router, which stops the adapter first.
- Runtime instance present, DB row active, runtime status stopped: start it.
- Runtime instance present, DB row active, type or config fingerprint changed: remove it, recreate it with the DB config, then start it.
- Runtime instance present and matching desired state: leave it unchanged.

The router must retain enough metadata to compare runtime instances without exposing raw secrets. A stable config fingerprint is sufficient. `listInstances()` may expose status, id, type, and non-secret comparison metadata such as `configFingerprint`; API responses must not include raw config from runtime state.

The `/apply` response should be more informative than `{ applied: number }`:

```typescript
type ApplyInstancesResult = {
  applied: number
  started: string[]
  // Adapter stop was requested, including stop-before-remove and stop-before-recreate.
  stopped: string[]
  // Runtime instance was removed from the router map.
  removed: string[]
  recreated: string[]
  unchanged: string[]
  failed: Array<{ id: string; action: string; error: string }>
}
```

The endpoint returns `503` only when the runtime router is unavailable. Per-instance lifecycle failures are reported in `failed` while unrelated instances continue reconciling.

### Phase 2: Validation And API Error Hardening

Centralize instance config validation so route-facing and resolver-facing behavior stay consistent.

- Platform instance routes validate descriptor-required fields before insert/patch, as they do today.
- Task instance routes validate descriptor-required fields and contributed validators before insert/patch.
- `TaskProviderResolver.resolve()` validates contributed task instance config before calling `createProvider()`. Validation failure logs a warning and returns `null`, matching the resolver's existing degraded behavior for missing or stopped instances.
- Duplicate create errors are caught at the insert boundary and mapped to `409 { error: "instance_exists", id }`, even when the earlier existence check races.
- SQLite constraint handling must distinguish primary-key/unique violations from unrelated DB failures. Unknown DB errors remain `500` and are logged.

Validation does not need to call remote provider APIs for built-in providers unless a built-in validator already exists. The main goal is to prevent known invalid contributed configs or descriptor-missing fields from reaching provider construction.

### Phase 3: Plugin Provider Metadata Alignment

Make manifest-backed provider contributions equivalent to direct registry registration where the manifest declares metadata.

The plugin manifest path should support:

- `providerConfigValidator`: a validated identifier naming an exported validator function from the plugin entry module. During activation, the loader resolves that export and passes it to `ctx.registration.registerTaskProviderType()` as `validateConfig`.
- Provider config storage aliases: manifest provider config fields may carry `storageKey` where supported by the provider field schema, and `toProviderConfigField()` preserves it.
- Provider traits: add a manifest-level `providerTraits` field constrained to known `TaskProviderTrait` values. The facade passes those traits into `registerContributedTaskProviderType()` instead of hardcoding an empty set.

The direct `registerContributedTaskProviderType()` path remains the registry primitive. The plugin facade becomes a metadata-preserving adapter over it, not a second semantic contract.

### Phase 4: Transitional Compatibility Cleanup

Remove compatibility surfaces only when tests and migrations prove the supported path is stable.

Candidates:

- `configToEnv` and env-shaped adapter constructor handoff. Built-in adapters should accept typed instance config or a small adapter-specific config object. Env bootstrap remains outside adapter construction.
- `url` to `baseUrl` fallbacks after migration 045 coverage proves persisted instance config is normalized.
- Legacy combined `configSchema` on task provider descriptors, after tests and UI/config flows read `instanceConfigSchema` and `contextConfigSchema` directly.
- `LegacyProviderConfigField.scope: 'user'` remapping if no production or plugin manifest path can emit it.
- Manual cascade helpers such as `deleteContextsByTaskInstance`, `deleteContextsByPlatformInstance`, and `deleteAdminsByPlatformInstance` if FK cascade plus explicit cache invalidation covers all production callers.
- Adapter default instance IDs such as `telegram-default`, `discord-default`, and `mattermost-default` in constructors. If tests still need them, test factories should provide explicit IDs instead of production constructors silently inventing IDs.

Each cleanup item requires a local replacement test before removal. If a compatibility path protects persisted data, keep it until a migration or explicit support window removes that risk.

## Component Boundaries

### `src/chat/router.ts`

Owns live adapter lifecycle and runtime metadata. It should provide explicit, narrow methods for reconciliation support, such as:

- `listInstances()` returning safe snapshots.
- `getInstance(id)` for internal router-aware callers.
- `removeInstance(id)`, `startInstance(id)`, and `addInstance(id, type, config)` as today.
- Optional `replaceInstance(id, type, config)` if it makes config-change reconciliation atomic and easier to test.

The router does not read from DB and does not decide desired state.

### `src/debug/instance-route-support.ts`

Coordinates `/apply`. It receives dependencies for `getRuntimeChatRouter()` and `listActivePlatformInstances()`, computes desired vs actual state, runs bounded-concurrency lifecycle operations, and returns the detailed apply result.

### `src/debug/instance-routes.ts`

Remains the HTTP boundary. It parses request bodies, authorizes through the existing debug-server/session gate, validates config, persists rows, masks returned config, and clears affected tool caches. It delegates runtime synchronization only to `/apply`.

Platform `PATCH`, status update, and `DELETE` should clear affected context caches consistently when their changes can alter source platform capabilities or assignments. Task route cache invalidation remains tied to referencing contexts.

### `src/debug/instance-config-validation.ts`

Owns route-facing config validation for descriptor-required fields and delegates contributed validators through the provider registry. Shared helper functions should be reusable from resolver validation without constructing HTTP `Response` objects.

### `src/providers/resolver.ts`

Builds effective provider config from descriptor fields, validates contributed provider config, and creates the provider. It should keep returning `null` on configuration failures and log enough context for operators without logging secrets.

### `src/plugins/context.ts` And `src/providers/registry.ts`

`registry.ts` remains the canonical contributed task provider registry. `context.ts` maps manifest/provider activation metadata into that registry without dropping validator, storage alias, or trait information.

## Runtime Data Flow

1. An admin writes desired platform/task instance state through the instance API.
2. Routes validate and persist encrypted config in SQLite.
3. Routes clear affected caches when task or platform assignment semantics can change.
4. Platform runtime remains unchanged until the admin calls `/api/platform-instances/apply`.
5. `/apply` reads active DB platform instances, compares them with router snapshots, and performs lifecycle operations.
6. The response reports per-instance changes and failures without leaking secrets.
7. Future inbound messages are handled by the reconciled runtime adapter set.

Task instances have no long-lived adapter, so task edits take effect on the next resolver/tool assembly after cache invalidation.

## Error Handling

- Router unavailable during `/apply`: return `503 { error: "router not initialised" }`.
- Individual adapter start/stop/recreate failure: keep reconciling other instances and include `{ id, action, error }` in `failed`.
- Failed recreate after config rotation: DB remains desired state. Runtime either has no active instance or a stopped failed instance. Later `/apply` can retry after config correction.
- Duplicate create race: return `409 { error: "instance_exists", id }` for platform and task instances.
- Invalid descriptor config: return `400` with missing or invalid URL fields.
- Invalid contributed task config in admin route: return `400 { error: "invalid_task_instance_config", reason }`.
- Invalid contributed task config in resolver: log `WARN`, return `null`, and let existing setup/unavailable-provider handling respond to the user.
- Secret-bearing values must not be logged. Logs include instance IDs, provider type, action, and normalized error messages only.

## Testing Strategy

### Phase 1 Tests

- `/apply` starts active DB instances missing from runtime.
- `/apply` removes runtime instances absent from active DB state.
- `/apply` starts stopped runtime instances whose DB rows are active.
- `/apply` stops and removes runtime instances whose DB rows are stopped, while preserving the stopped DB row as desired state.
- Active config rotation recreates the runtime adapter on `/apply`.
- Active type change recreates the runtime adapter on `/apply`.
- `/apply` reports partial failures and continues unrelated instances.
- Runtime snapshots do not expose raw config secrets.
- Platform `PATCH`, status update, and `DELETE` clear relevant context tool caches consistently.

### Phase 2 Tests

- Concurrent or simulated duplicate platform create returns `409`.
- Concurrent or simulated duplicate task create returns `409`.
- Route validators preserve existing config on failed patch.
- Resolver rejects invalid contributed task config before `createProvider()`.
- Resolver still returns `null` for missing, stopped, unknown, or invalid instances without throwing to callers.

### Phase 3 Tests

- Manifest `providerConfigValidator` resolves to an exported validator and is invoked on task instance create/patch.
- Missing or non-function validator export fails plugin activation with a clear runtime event.
- Manifest provider config fields preserve `storageKey` into descriptors and resolver config lookup.
- Manifest `providerTraits` appear in descriptors and on created contributed providers.
- Direct registry registration and plugin-facade registration produce equivalent descriptor/runtime metadata for the same declaration.

### Phase 4 Tests

- Adapter construction receives explicit typed instance config and platform instance ID.
- Env bootstrap still seeds DB rows, but adapters no longer read env fallbacks for DB-managed construction.
- Split `instanceConfigSchema` and `contextConfigSchema` cover all production UI/config/wizard consumers before `configSchema` removal.
- Normalized `baseUrl` data is sufficient after migration 045; legacy `url` fallback removal does not break migrated DB tests.
- FK cascade tests cover context/admin/user cleanup before manual cascade helpers are removed.

## Rollout Plan

Ship the phases in order. Phase 1 is the release-blocking correctness fix. Phase 2 should follow before declaring the admin instance surface reliable. Phase 3 is required before plugin-contributed task providers can be considered equivalent to built-ins. Phase 4 can be split into smaller cleanup PRs if any compatibility removal proves risky.

Each phase should update or remove tests that encode old behavior. In particular, the current test asserting platform delete does not remove runtime until `/apply` remains valid, but the `/apply` expectations must expand to full reconciliation and config-change recreation.

## Acceptance Criteria

- Rotating an active platform token/config in DB and calling `/apply` replaces the live adapter without process restart.
- Deleting or stopping a platform instance in DB and calling `/apply` stops live ingestion for that instance.
- Instance API duplicate creates return `409`, not a misleading config-read error.
- Contributed task provider config can be rejected on both admin write and resolver dispatch paths.
- Manifest-declared provider validator, storage aliases, and traits affect contributed provider descriptors and runtime provider objects.
- Cleanup removes only compatibility paths that are demonstrably production-unused or migration-safe.
