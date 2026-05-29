<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Validated Findings Remediation Design

**Date:** 2026-05-29
**Status:** Approved for planning
**Parent:** [`2026-05-29-multi-provider-review-cleanup-design.md`](./2026-05-29-multi-provider-review-cleanup-design.md)

## Summary

This design covers all validated findings from the multi-provider architectural review verification. It extends the existing multi-provider review cleanup work with the security, startup resilience, runtime correctness, validation, abstraction, and dead-code fixes that were confirmed against the current branch.

The remediation is layered by risk and subsystem. The highest-risk work protects encrypted instance credentials and prevents startup-wide failure from one bad row. Later layers tighten router reconciliation semantics, align task-provider validation across admin and resolver paths, remove obsolete compatibility seams, and clean up dead code or misleading observability.

## Goals

- Remove the public constant fallback encryption key risk for instance credentials.
- Use a password-based KDF for non-hex `INSTANCE_CONFIG_KEY` values.
- Prevent one unreadable encrypted instance row from crashing process startup.
- Make `/api/platform-instances/apply` report desired pending/stopped removals and failure actions accurately.
- Make `ChatRouter` lifecycle methods preserve truthful runtime state.
- Close the task-provider validation gap between admin writes and resolver-time context config.
- Fix plugin manifest type optionality that contradicts Zod defaults.
- Remove env-shaped adapter construction fallbacks and default IDs from production paths.
- Fix the Kaneo workspace user/context abstraction leak.
- Remove or fix validated dead code and stale observability gaps.

## Non-Goals

- Redesigning the full instance data model.
- Changing the encrypted payload format for existing rows.
- Automatically applying runtime platform changes after every DB mutation.
- Introducing a new plugin sandbox or provider marketplace model.
- Replacing SQLite, Drizzle, or the existing admin dashboard API surface.
- Solving multi-context Kaneo beyond the specific workspace lookup leak identified here.

## Scope And Phasing

### Phase 1: Secret Safety And Startup Resilience

Fix instance-config key derivation and row decoding failure isolation.

`src/instances/encryption.ts` remains the only instance-config encryption module. It should expose enough non-secret metadata to distinguish explicit-key, passphrase-derived, and fallback modes for tests and warnings. AES-256-GCM remains the cipher. The existing payload layout stays readable because the key derivation changes only how the 32-byte key is produced before encrypt/decrypt.

Preferred production mode remains a 64-hex `INSTANCE_CONFIG_KEY`. Non-hex values are treated as passphrases and derived with Node's `scrypt` or `scryptSync`, using a stable product salt of at least 16 bytes. Node crypto documentation describes `scrypt` as a memory-hard password-based KDF and recommends unique salts of at least 16 bytes. This is materially better than bare SHA-256 for passphrase inputs.

Missing `INSTANCE_CONFIG_KEY` must no longer use the public constant `sha256('papai:instance-config:fallback')`. To preserve local-development and first-run bootstrap behavior, the fallback policy is a true host-local key derived from host-specific material plus a product salt. The warning text must be factual: copied DB files are not portable under the fallback, and production deployments must set `INSTANCE_CONFIG_KEY`. Tests must prove two different host identifiers derive different keys.

`src/instances/platform-store.ts` and `src/instances/task-store.ts` should gain safe row decoding helpers. Bulk list operations used by startup and admin diagnostics should decode rows one by one, return valid decoded instances, and return per-row failures containing only id, type when available, table name, and error message. Raw encrypted payloads and decrypted config values must never be logged.

Startup should use the safe active platform list. A corrupt or re-keyed row logs a warning or error and is skipped. Valid active rows still start.

### Phase 2: Runtime Reconciliation Correctness

Keep `ChatRouter` runtime-only. It still does not read DB state. `POST /api/platform-instances/apply` remains the desired-vs-actual reconciliation boundary.

The current `/apply` desired set is only active DB rows, which makes pending/stopped DB rows appear as unexplained runtime surplus. Reconciliation should load enough platform instance state to distinguish these cases:

- Runtime id has an active desired DB row: reconcile normally.
- Runtime id has a stopped desired DB row: stop and remove runtime instance, report removal with `desiredStatus: 'stopped'`.
- Runtime id has a pending desired DB row: stop and remove runtime instance, report removal with `desiredStatus: 'pending'`.
- Runtime id has no DB row: stop and remove runtime instance, report removal with `desiredStatus: null` or `reason: 'deleted'`.

The response can extend the existing `removed` and `failed` arrays with structured details while preserving simple id arrays if the admin client depends on them. Failure actions must be accurate. A failed `removeRuntimeInstance()` must report action `'remove'`, not `'stop'`.

`ChatRouter.startInstance(id)` should be idempotent for already-active instances. It should log debug-level information and return without invoking `provider.start()` again.

`ChatRouter.stopInstance(id)` should not mark the instance stopped until `provider.stop()` succeeds. If stop fails, the instance remains in its previous status and the caller sees the failure. This keeps runtime snapshots truthful and allows retry logic to make correct decisions.

Recreate remains remove-then-add for this remediation. The brief message-drop window is accepted and explicitly documented as non-atomic behavior. A future atomic `replaceInstance()` can be considered separately if runtime loss during config rotation becomes unacceptable.

### Phase 3: Task-Provider Validation And Schema Alignment

Centralize validation around provider descriptors and make each call site explicit about whether it has context-scoped values.

Admin task-instance create/patch receives only instance-scoped config. It must validate `descriptor.instanceConfigSchema` and provider validators that can run on instance-only config. It must not pretend to validate context-required fields, because no context id is known at instance-write time.

Resolver-time validation has a context id and builds effective config from instance fields plus `descriptor.contextConfigSchema`. It must validate the merged logical config before constructing a provider. This is the authoritative validation path for context-scoped required fields and plugin storage-key aliases.

The design should update naming and documentation so plugin authors understand the split:

- Instance validators run on admin writes and receive normalized instance fields only.
- Effective config validators run during resolver dispatch and receive instance plus context fields.

The current single `providerConfigValidator` is treated as effective-config validation. Admin routes validate descriptor instance fields only. Resolver validation enforces the full merged config before provider construction.

`PluginManifest` should use the Zod output type directly for defaulted fields such as `providerTraits` and `providerContextConfigSchema`. Manual re-optionalization should be removed so downstream code can rely on parsed manifests matching runtime defaults.

### Phase 4: Abstraction Cleanup

Remove production env-shaped adapter construction paths after tests prove all runtime construction uses explicit DB instance config.

Built-in chat adapters should require typed constructor config containing the platform instance id and provider-specific credential fields. They should not read `process.env` internally. Env bootstrap remains in `src/instances/bootstrap.ts`, where environment variables are transformed into encrypted DB rows. Tests that need env-like setup should call bootstrap or provide explicit constructor config.

Default adapter instance IDs such as `kontur-talk-default` must not be produced inside adapter constructors. Default ids belong only to env bootstrap seeding, where the id is visible and unique constraints are handled by the instance stores.

The live-adapter `configRequirements` metadata and registry descriptor schemas currently use different key spaces. The remediation should avoid two divergent contracts for the same provider. The registry descriptor becomes the source for DB-managed platform config fields. Adapter metadata is derived from the descriptor and no longer carries env variable names.

The same principle applies to task-provider metadata. Built-in provider `configRequirements` and descriptor seeds should not disagree on keys such as `youtrack_url` versus `baseUrl`. Descriptor fields are the DB/admin contract. Live provider requirements should be derived, deprecated, or limited to legacy setup flows until removed.

Fix the Kaneo workspace abstraction leak by renaming or replacing `getKaneoWorkspace(userId)` with a context-aware API. Resolver code should call a method whose parameter name and storage behavior match context-scoped config. Scheduler and setup paths should use the same context-aware naming so future group or thread contexts do not rely on the current coincidence that DM context id equals user id.

### Phase 5: Dead-Code And Observability Cleanup

Remove validated dead code only after replacement tests cover the supported path.

`ChatRouter.removeInstance()` is non-strict, error-swallowing, and unreferenced by reconciliation. Remove it if no production caller exists after code index and grep verification. Keep `removeInstanceStrict()` or rename it to `removeInstance()` only if call sites need the strict behavior as the single public method.

The bootstrap type-narrowing branch after `collectMissing()` is unreachable in runtime terms. Replace it with an assertion helper if TypeScript needs narrowing, or restructure `collectMissing()` so no dead branch is needed.

`closeDrizzleDb()` must close the underlying `bun:sqlite` `Database`, not just clear the Drizzle wrapper reference. Store the raw sqlite handle next to the Drizzle wrapper so shutdown and tests can close it and allow WAL checkpoint behavior.

Migration `045_provider_base_url` should emit a completion log consistent with nearby migrations. The spec also notes that migration `041` lacks logging, so `045` should not be described as uniquely inconsistent unless the implementation chooses to add logging to both.

The stale cleanup-plan references to `configToEnv`, legacy combined `configSchema`, `scope: 'user'`, and manual cascade helpers should be removed from future plans or marked already completed. Do not spend implementation effort removing code that no longer exists.

## Traceability

| Finding                                      | Disposition                   | Phase | Acceptance Evidence                                                                   |
| -------------------------------------------- | ----------------------------- | ----- | ------------------------------------------------------------------------------------- |
| `S1` public constant fallback key            | Fix                           | 1     | Missing-key mode is not decryptable from source-known constant; warnings are factual. |
| `DD1` bare SHA-256 for passphrases           | Fix                           | 1     | Non-hex key path uses `scrypt`/memory-hard KDF tests.                                 |
| `M1` startup decrypt crash                   | Fix                           | 1     | Bad row skipped and logged; valid rows still start.                                   |
| `M2` pending rows silently killed            | Fix                           | 2     | `/apply` reports desired pending/stopped removal reason.                              |
| `M3` env fallbacks in adapters               | Fix                           | 4     | Adapters require explicit config; env bootstrap remains outside adapters.             |
| `M4` admin validation ignores context schema | Clarify and fix resolver path | 3     | Admin validates instance fields; resolver validates merged effective config.          |
| `B1` removal failure action says stop        | Fix                           | 2     | Failed removal reports action `'remove'`.                                             |
| `B2` double-start possible                   | Fix                           | 2     | Starting active instance is a no-op.                                                  |
| `B3` failed stop leaves false stopped status | Fix                           | 2     | Failed stop preserves previous status.                                                |
| `N1` recreate is non-atomic                  | Document                      | 2     | Spec and code comments identify remove-then-add behavior.                             |
| `N2` migration 045 missing log               | Fix                           | 5     | Migration logging is consistent across `041` and `045`.                               |
| `D1` Mattermost env fallback dead            | Fix                           | 4     | Mattermost constructor no longer reads env fallback.                                  |
| `D2` unreferenced router remove              | Fix                           | 5     | Dead method removed or strict behavior becomes sole method.                           |
| `D3` unreachable bootstrap branch            | Fix                           | 5     | Branch removed or replaced with assertion/narrowing helper.                           |
| `D4` Drizzle close leaks handle              | Fix                           | 5     | Close test proves sqlite handle close is called.                                      |
| `D5` stale plan items already gone           | Document cleanup              | 5     | New spec/plan omits already-removed work.                                             |
| `L1` Kaneo user/context leak                 | Fix                           | 4     | Resolver uses context-aware workspace API.                                            |
| `L2` duplicate config-schema systems         | Fix targeted seam             | 4     | DB/admin descriptors are single source for managed config keys.                       |
| `L3` plugin manifest optionality mismatch    | Fix                           | 3     | Parsed manifest type keeps defaulted arrays non-optional.                             |

## Component Boundaries

### `src/instances/encryption.ts`

Owns key derivation, AES-GCM encryption, AES-GCM decryption, masking helpers, and non-secret key-mode diagnostics. It should not know about platform/task tables or admin routes.

### `src/instances/platform-store.ts` And `src/instances/task-store.ts`

Own encrypted row persistence and row decoding. Safe list helpers should isolate decrypt failures and return diagnostics. Store code should not start chat providers or decide runtime desired state.

### `src/index.ts`

Owns startup sequencing. It should load valid active platform instances through safe decoding, log per-row failures, and continue starting valid instances.

### `src/chat/router.ts`

Owns live adapter lifecycle and safe runtime snapshots. It should expose idempotent start and truthful stop behavior. It does not read DB state or env provider credentials.

### `src/debug/instance-route-support.ts`

Coordinates `/apply` desired-vs-actual reconciliation. It receives store/router dependencies, computes actions, runs bounded lifecycle operations, and returns detailed results without secrets.

### `src/debug/instance-routes.ts`

Remains the HTTP boundary for admin APIs. It parses requests, authenticates writes, validates instance-scope config, persists encrypted rows, masks responses, clears caches, and delegates runtime sync only to `/apply`.

### `src/providers/config-validation.ts`

Owns provider descriptor validation semantics. It should make instance-only and effective-config validation modes explicit enough that admin routes and resolver code cannot accidentally validate different shapes without naming that choice.

### `src/providers/resolver.ts`

Owns context-aware task-provider config assembly and effective-config validation. It returns `null` and logs `WARN` on invalid config rather than throwing through message processing.

### `src/plugins/types.ts` And `src/plugins/context.ts`

Own manifest schema output and conversion into provider registry entries. Parsed manifest defaults should be visible in TypeScript types.

## Runtime Data Flow

1. First-run env bootstrap reads provider env vars and writes explicit encrypted DB rows.
2. Admin route writes validate instance-scoped config, encrypt config, persist DB rows, mask responses, and invalidate affected caches.
3. Runtime platform adapters do not change until `/api/platform-instances/apply` is called.
4. `/apply` reads active, pending, and stopped platform desired state through safe store helpers.
5. `/apply` compares desired state with safe router snapshots and performs start, remove, restart, or recreate operations.
6. Task provider edits take effect on next resolver/tool assembly, where context-scoped config is merged and validated.
7. Startup reads active platform rows safely, skips unreadable rows, and starts valid instances.

## Error Handling

- Missing explicit key with secret-bearing writes: use the documented host-local fallback and log the production warning once per process.
- Invalid encrypted payload during startup: log row id/table/type if known, skip row, continue startup.
- Invalid encrypted payload during admin list: return readable diagnostics without raw config or encrypted payload leakage.
- Router unavailable during `/apply`: return existing `503 { error: 'router not initialised' }` behavior.
- Per-instance start/remove/recreate failure: continue unrelated instances and include accurate `{ id, action, error }` failure details.
- Failed stop: preserve previous runtime status and propagate the error to reconciliation.
- Instance-only admin validation failure: return `400` with missing/invalid instance fields.
- Effective resolver validation failure: log warning with context id, instance id, provider type, and validation kind; return `null`.
- Dead-code removal ambiguity: keep code and document rationale if a production or persisted-data compatibility need is found.

## Testing Strategy

### Phase 1 Tests

- Explicit 64-hex key encrypts and decrypts existing payload format.
- Non-hex passphrase path derives a stable 32-byte key through `scrypt` and round-trips config.
- Missing-key host-local fallback is enforced and warning text matches actual behavior.
- Secret-bearing config cannot be persisted under an unsafe public constant fallback.
- Safe platform list skips one corrupted encrypted row and returns valid rows.
- Startup logs unreadable active row diagnostics and starts other valid active instances.

### Phase 2 Tests

- `/apply` removes runtime instances whose DB rows are pending and reports pending as the desired status.
- `/apply` removes runtime instances whose DB rows are stopped and reports stopped as the desired status.
- `/apply` removes runtime instances whose DB rows are deleted and reports deleted/no desired row distinctly.
- Failed removal reports action `'remove'`.
- `startInstance()` on an active instance does not call provider start again.
- Failed `stopInstance()` preserves the previous status.
- Config/type recreation remains covered by existing apply tests and documents remove-then-add behavior.

### Phase 3 Tests

- Admin task-instance validation accepts valid instance-only config without requiring context-scoped fields.
- Resolver validation rejects missing required context-scoped fields after effective config assembly.
- Resolver validation respects plugin `storageKey` aliases.
- Parsed plugin manifests expose `providerTraits` and `providerContextConfigSchema` as defaulted arrays in type-level and runtime tests.

### Phase 4 Tests

- Telegram, Discord, Mattermost, and Kontur Talk constructors reject missing explicit typed config and do not read env fallbacks.
- Env bootstrap still seeds explicit DB config rows for first-run setup.
- No adapter constructor creates default platform instance ids.
- Registry platform descriptors are the source for DB-managed provider config keys.
- Task-provider descriptor and live requirement metadata no longer disagree for built-ins used by admin/setup flows.
- Kaneo workspace lookup uses context-aware naming and resolver tests cover non-DM context ids.

### Phase 5 Tests

- No production references remain before removing non-strict `ChatRouter.removeInstance()`.
- Bootstrap partial-env narrowing no longer contains an unreachable return branch.
- `closeDrizzleDb()` closes the underlying sqlite handle.
- Migration logging expectations cover both `045` and `041` so observability is consistent across nearby migrations.

## Rollout Plan

Ship phases in order. Phase 1 is release-blocking because it addresses credential exposure and startup availability. Phase 2 follows because it corrects operator-facing runtime behavior. Phase 3 should land before declaring plugin-contributed task providers equivalent to built-ins. Phase 4 can be split by provider or metadata seam to keep reviews small. Phase 5 is safe cleanup and observability work once tests prove no production paths depend on the removed code.

Each phase should update the existing implementation plan or create a new one that references this spec. If any validated finding turns out to protect persisted production data, retain the compatibility code and update this spec with the explicit rationale before implementation proceeds.

## Acceptance Criteria

- A DB copy from an install without explicit `INSTANCE_CONFIG_KEY` is not decryptable with a public source-known constant key.
- Non-hex `INSTANCE_CONFIG_KEY` values use a password-based KDF instead of bare SHA-256.
- One corrupt or re-keyed instance row cannot crash whole-process startup.
- `/apply` reports pending/stopped/deleted desired-state removals clearly and uses accurate failure actions.
- Router lifecycle snapshots remain truthful after start/stop edge cases.
- Admin and resolver validation semantics for task-provider config are explicit and tested.
- Plugin manifest parsed types match Zod default behavior.
- Runtime chat adapter construction no longer reads env credentials or invents default instance ids.
- Kaneo workspace lookup is context-aware.
- Validated dead code is removed or retained only with documented production compatibility rationale.
