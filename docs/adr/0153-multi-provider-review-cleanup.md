<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0153: Multi-Provider Review Cleanup

## Status

Implemented

## Date

2026-05-29 – 2026-06-02

## Context

After the multi-provider stabilization work (ADR-0148 parent), several review
findings remained unfixed. Active platform config/token edits had no runtime
effect until process restart because `POST /api/platform-instances/apply` was
additive only — it could not recreate running instances whose DB config had
changed. Cache invalidation side effects were inconsistently placed across
stores and routes. Duplicate instance creates could surface as a misleading
`500 { error: "config unreadable" }` if a preflight existence check raced a
primary-key insert. Task provider config validators ran through admin routes
but not through `TaskProviderResolver.resolve()`. Plugin manifest provider
metadata (validators, storage aliases, traits) was inert. Transitional
compatibility surfaces (env-shaped adapter construction, `url` fallbacks,
legacy combined `configSchema`, manual cascade helpers, default adapter
instance IDs) accumulated without removal paths.

The design spec
(`docs/archive/2026-05-29-multi-provider-review-cleanup-design.md`) defined
four ordered phases: (1) complete platform runtime reconciliation, (2)
validation and API error hardening, (3) plugin provider metadata alignment,
(4) transitional compatibility cleanup. Each phase ships before the next
begins.

## Decision Drivers

- **Runtime correctness**: DB-backed platform instance changes must reach the
  live `ChatRouter` without process restart.
- **Clear error semantics**: duplicate creates must return `409`, not a
  misleading `500`.
- **Validation consistency**: config validators must run on both the admin
  write path and the resolver dispatch path.
- **No secret leakage**: runtime snapshots and API responses must not expose
  raw config secrets; fingerprints suffice for comparison.
- **Incremental cleanup**: compatibility surfaces are removed only after
  replacement tests prove the supported path.
- **DB as source of truth**: route handlers persist desired state; `/apply`
  reconciles runtime to match; no automatic hot-apply on every mutation.

## Considered Options

### Option A: Automatic hot-apply on every platform instance mutation

Persist-and-apply in one request: every `PATCH`, `DELETE`, or status change
immediately reconciles the runtime.

- **Pros**: No operator step required; runtime always matches DB.
- **Cons**: Couples DB writes to async adapter lifecycle; a failed adapter
  restart could roll back or leave inconsistent state; increases request
  latency; operator loses control over when runtime changes take effect.

### Option B: Full `/apply` reconciliation (chosen)

`POST /api/platform-instances/apply` compares desired DB rows with live router
snapshots and performs the minimum lifecycle changes. Route handlers persist
state only; `/apply` is the explicit reconciliation boundary.

- **Pros**: Decouples persistence from lifecycle; operator controls timing;
  partial failures are reported per-instance; simpler error handling.
- **Cons**: Runtime drifts from DB until `/apply` is called; operator must
  remember to apply after config changes.

### Option C: Best-effort reconciliation with silent failures

Apply reconciles but silently swallows per-instance failures.

- **Pros**: Simpler response shape.
- **Cons**: Operator cannot discover which instances failed or why; defeats
  debugging.

### Option D: Keep transitional compatibility indefinitely

Never remove `configToEnv`, `url` fallbacks, legacy `configSchema`, or
default instance IDs.

- **Pros**: No migration risk; no test churn.
- **Cons**: Accumulates dead code; new contributors see conflicting patterns;
  dual paths mask bugs.

## Decision

**Option B** for runtime reconciliation, with the following subsidiary
decisions:

| Topic                     | Decision                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config fingerprinting     | Deterministic `Bun.hash` of sorted config entries + type, stored on `ManagedChatInstance.configFingerprint`. Raw config never exposed via snapshots.                                                                                                                                                        |
| `/apply` response shape   | `ApplyInstancesResult` with `started`, `stopped`, `removed`, `recreated`, `unchanged`, `failed` arrays. `503` only when router is unavailable; per-instance failures reported in `failed` while unrelated instances continue.                                                                               |
| Duplicate create handling | SQLite `SQLITE_CONSTRAINT` errors on insert are caught and mapped to `409 { error: "instance_exists", id }` for both platform and task instances.                                                                                                                                                           |
| Cache invalidation        | Platform `PATCH`, status update, and `DELETE` clear referencing context tool caches. Centralized via `clearToolCachesForContexts()` with context IDs collected before mutation.                                                                                                                             |
| Resolver validation       | `TaskProviderResolver.resolve()` calls contributed validators before `createProvider()`. Validation failure logs `WARN` and returns `null`, matching existing degraded behavior. May require async `resolve()` signature.                                                                                   |
| Plugin provider metadata  | Manifest `providerConfigValidator` resolves named export from plugin module during activation. `providerConfigSchema` fields may carry `storageKey`. `providerTraits` array passes known `TaskProviderTrait` values into registry registration.                                                             |
| Compatibility cleanup     | `configToEnv` removed; adapters accept typed config objects. `url` fallback removed after migration 045. Legacy `configSchema` replaced by split `instanceConfigSchema`/`contextConfigSchema`. Manual cascade helpers removed where FK cascade covers callers. Default adapter IDs moved to test factories. |

## Consequences

### Positive

- Rotating an active platform token in DB and calling `/apply` replaces the
  live adapter without process restart.
- Duplicate creates return `409` instead of misleading `500` errors.
- Contributed task provider config is validated on both admin write and
  resolver dispatch paths, preventing invalid configs from reaching provider
  construction.
- Plugin manifest metadata (validators, storage keys, traits) becomes
  effective at runtime, making plugin-contributed providers equivalent to
  built-ins.
- Transitional compatibility code is removed, reducing cognitive load and
  eliminating dual-path confusion.

### Negative

- Runtime drifts from DB until the operator calls `/apply`; forgetting to
  apply after a config change leaves stale adapters running.
- Resolver may need an async signature change, touching multiple call sites.
- Plugin activation now validates named export types; invalid validator
  exports fail activation with a clear error rather than being silently
  ignored.

### Risks

- If `Bun.hash` behavior changes across Bun versions, fingerprints could
  become unstable. Mitigation: fingerprint is only compared within a single
  process lifetime; DB never stores it.
- Removing `url` fallback assumes migration 045 has covered all production
  data. Mitigation: migration coverage is verified before removal.

## Implementation Notes

Key modules:

| File                                      | Role                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/chat/router-types.ts`                | `ManagedChatInstanceSnapshot` with `configFingerprint`                               |
| `src/chat/router.ts`                      | Deterministic `configFingerprint()` helper; fingerprint set on `addInstance()`       |
| `src/chat/router-helpers.ts`              | `managedInstanceSnapshots()` exposes `configFingerprint`                             |
| `src/debug/instance-route-support.ts`     | `applyPlatformInstances()` full reconciliation with `pLimit`-bounded lifecycle ops   |
| `src/debug/instance-routes.ts`            | `insertOrConflict()` for `409` mapping; cache invalidation on platform mutations     |
| `src/debug/instance-config-validation.ts` | `validateTaskInstanceConfigResult()` reusable by both routes and resolver            |
| `src/providers/resolver.ts`               | Contributed config validation before `createProvider()`                              |
| `src/plugins/types.ts`                    | Manifest `providerTraits`, `storageKey` on config schemas, `providerConfigValidator` |
| `src/plugins/loader.ts`                   | `resolveManifestProviderValidator()` maps manifest name to module export             |
| `src/plugins/context.ts`                  | `buildPluginContext()` preserves storage keys and traits in registration             |
| `src/chat/registry.ts`                    | Typed `instanceProviders` factory map; `configToEnv` removed                         |
| `client/shared/api-types.ts`              | Expanded `ApplyInstancesResult`                                                      |

## Related Decisions

- ADR-0148: Multi-Provider Stabilization — parent review that identified these
  findings.
- ADR-0123: Trusted-Local Plugin System — plugin context facade that this work
  extends with provider metadata.
- ADR-0009: Multi-Provider Task Tracker Support — provider capability model
  underlying trait and validator alignment.
- ADR-0014: Multi-Chat Provider Abstraction — chat provider model affected by
  typed adapter construction cleanup.
