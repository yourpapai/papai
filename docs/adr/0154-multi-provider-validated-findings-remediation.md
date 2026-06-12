<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0154: Multi-Provider Validated Findings Remediation

## Status

Implemented

## Date

2026-05-29 – 2026-06-02

## Context

The multi-provider architecture review (parent spec `2026-05-29-multi-provider-review-cleanup-design.md`) validated 15 findings across security, startup resilience, runtime reconciliation, validation semantics, abstraction leaks, and dead code. Several findings were release-blocking: the `INSTANCE_CONFIG_KEY` fallback used a public source-known constant (`sha256('papai:instance-config:fallback')`), non-hex passphrases were derived with bare SHA-256 instead of a memory-hard KDF, and a single unreadable encrypted instance row could crash whole-process startup. Runtime reconciliation reported incorrect failure actions, `ChatRouter` lifecycle methods did not preserve truthful state, task-provider validation conflated instance-only and effective config, and chat adapters still read `process.env` internally despite the DB-backed instance model being the authoritative config path.

The approved design spec (`docs/archive/2026-05-29-multi-provider-validated-findings-remediation-design.md`) prescribed a five-phase remediation ordered by risk: credential safety and startup resilience first, runtime reconciliation second, validation alignment third, abstraction cleanup fourth, dead code and observability last.

## Decision Drivers

- **Credential safety**: A public constant fallback key means any DB copy is decryptable from source. Non-hex passphrases need a memory-hard KDF, not bare SHA-256.
- **Startup resilience**: One corrupt or re-keyed encrypted row must not prevent the entire process from starting.
- **Reconciliation accuracy**: `/apply` must report the actual desired state of removed DB rows and accurate failure actions so operators can trust the admin UI.
- **Runtime truthfulness**: `ChatRouter` snapshots must reflect actual provider state — failed stops must not falsely report `stopped`, and double-starts must not invoke provider startup twice.
- **Validation correctness**: Admin writes and resolver dispatch validate different config shapes; the distinction must be explicit in code, not accidental.
- **Abstraction hygiene**: Adapters must not read `process.env` or invent default instance IDs; DB is the single source of truth after bootstrap.
- **Dead code removal**: Unreferenced methods, unreachable branches, and handle leaks accumulate risk without value.

## Considered Options

### Option A: Minimal hotfix for release-blocking findings only

Fix the public fallback key and startup crash; defer everything else.

- **Pros**: Smallest immediate diff; fastest path to addressing credential exposure.
- **Cons**: Leaves incorrect reconciliation reporting, broken router lifecycle, and validation gaps in production; findings reappear in the next review.

### Option B: Full five-phase remediation (chosen)

Address all 15 validated findings in risk-ordered phases.

- **Pros**: Closes the entire validated finding set; each phase builds on the previous; operator-facing behavior becomes correct and consistent.
- **Cons**: Larger diff; more test surface; requires careful phasing to avoid regressions between phases.

### Option C: Merge validation phases with abstraction cleanup

Combine Phases 3 and 4 into a single pass since both touch provider config paths.

- **Pros**: Fewer intermediate states; one combined review.
- **Cons**: Mixed risk levels in one diff; validation semantics changes and adapter constructor cleanup can interfere; harder to isolate regressions.

## Decision

**Option B**, with the following subsidiary decisions per phase:

| Topic                              | Decision                                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key derivation (Phase 1)           | Non-hex `INSTANCE_CONFIG_KEY` uses `scryptSync` with a stable product salt. Missing key derives a host-local fallback from `hostname` + `homedir` + product salt. Warning is factual. |
| Safe row decoding (Phase 1)        | Bulk list helpers decode rows individually; failures return `{ table, id, type, error }` diagnostics. Startup skips unreadable rows and continues.                                    |
| Apply desired state (Phase 2)      | `/apply` loads all platform rows (not just active) to distinguish `pending`/`stopped`/deleted removal reasons. `removedDetails` array added to response.                              |
| Failure actions (Phase 2)          | Failed `removeRuntimeInstance()` reports action `'remove'`, not `'stop'`.                                                                                                             |
| Router start idempotency (Phase 2) | `startInstance()` on an already-active instance logs debug and returns without calling `provider.start()`.                                                                            |
| Router stop truthfulness (Phase 2) | `stopInstance()` does not mark `stopped` until `provider.stop()` resolves. Failed stop preserves previous status and propagates the error.                                            |
| Validation split (Phase 3)         | Admin routes use `validateTaskInstanceConfigResult()` (instance fields only). Resolver uses `validateEffectiveTaskProviderConfigResult()` (instance + context fields).                |
| Plugin manifest types (Phase 3)    | `PluginManifest` uses `z.output<typeof pluginManifestSchema>` directly; manual re-optionalization of defaulted arrays removed.                                                        |
| Adapter construction (Phase 4)     | All chat adapters require explicit typed constructor config. No `process.env` reads for credentials. No default instance IDs. Env bootstrap remains outside adapters.                 |
| Metadata alignment (Phase 4)       | Adapter `configRequirements` keys match DB descriptor keys exactly. No `youtrack_url` vs `baseUrl` divergence.                                                                        |
| Kaneo workspace API (Phase 4)      | Rename `getKaneoWorkspace`/`setKaneoWorkspace` to `getKaneoWorkspaceForContext`/`setKaneoWorkspaceForContext` to match context-scoped storage.                                        |
| Dead `removeInstance` (Phase 5)    | Non-strict `ChatRouter.removeInstance()` removed; `removeInstanceStrict()` is the sole public removal method.                                                                         |
| Drizzle close (Phase 5)            | `closeDrizzleDb()` closes the underlying `bun:sqlite` handle, not just the Drizzle wrapper.                                                                                           |
| Bootstrap branch (Phase 5)         | Unreachable partial-env narrowing branch replaced with assertion helper.                                                                                                              |
| Migration logs (Phase 5)           | Migrations `041` and `045` both emit completion logs.                                                                                                                                 |

## Consequences

### Positive

- DB copies from installs without explicit `INSTANCE_CONFIG_KEY` are no longer decryptable from a public constant.
- Non-hex passphrases are memory-hard derived; offline brute-force cost is materially higher than bare SHA-256.
- One bad encrypted row cannot crash startup; valid instances start normally.
- `/apply` reports accurate desired-state reasons for removals and correct failure actions.
- Router runtime snapshots remain truthful after edge cases; retry logic can make correct decisions.
- Admin and resolver validation are explicit about which config shape they validate; no silent field-skipping.
- Plugin manifest types match Zod defaults; downstream code does not need `?? []` guards.
- Adapters no longer read `process.env`; DB is the single source of truth after bootstrap.
- Kaneo workspace API is context-aware; future group/thread contexts are not blocked by a userId coincidence.

### Negative

- Host-local fallback key is not portable; DB files copied between hosts are unreadable. This is by design and warned.
- `/apply` response shape grows with `removedDetails`; admin client must parse the extended shape.
- `scryptSync` is slower than SHA-256 for key derivation; impact is negligible (once per process).
- Removing `process.env` fallbacks from adapters means broken tests must provide explicit config; bootstrap is the only env path.

### Risks

- A host-local fallback key derived from `hostname` + `homedir` could be predictable on cloud instances with standard images. Mitigation: the fallback logs a `WARN` on first use; production deployments must set `INSTANCE_CONFIG_KEY`.
- Recreate (remove-then-add) is non-atomic; a brief message-drop window exists during config rotation. Documented as accepted; a future atomic `replaceInstance()` could address this if runtime loss becomes unacceptable.
- Safe row decoding returns per-row failure diagnostics to admin API consumers; `unreadable` arrays in list responses expose table/id/type/error metadata. Risk is low: no config values or encrypted payloads are included.

## Implementation Notes

Key changes by module:

| Module                                | Change                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/instances/encryption.ts`         | `resolveInstanceConfigKeyInfo()` returns mode, key, and warning; `scryptSync` derivation; host-local fallback          |
| `src/instances/types.ts`              | `InstanceDecodeFailure` and `InstanceDecodeResult<T>` shared types                                                     |
| `src/instances/platform-store.ts`     | `listPlatformInstancesSafe()`, `listActivePlatformInstancesSafe()` with per-row failure isolation                      |
| `src/instances/task-store.ts`         | `listTaskInstancesSafe()` with per-row failure isolation                                                               |
| `src/index.ts`                        | Startup uses `listActivePlatformInstancesSafe()`; skips unreadable rows                                                |
| `src/debug/instance-routes.ts`        | List responses include `unreadable` diagnostics when present                                                           |
| `src/debug/instance-route-support.ts` | `removedDetails` in apply result; `removeRuntimeInstance()` reports `'remove'` action; desired-state map from all rows |
| `src/chat/router.ts`                  | Idempotent `startInstance()`; truthful `stopInstance()`; dead `removeInstance()` removed                               |
| `src/providers/config-validation.ts`  | `validateEffectiveTaskProviderConfigResult()` for context-merged config                                                |
| `src/providers/resolver.ts`           | Uses effective-config validation and context-aware Kaneo workspace API                                                 |
| `src/plugins/types.ts`                | `PluginManifest` = `z.output<typeof pluginManifestSchema>` directly                                                    |
| Chat adapter constructors             | Require explicit typed config; no `process.env` reads; no default instance IDs                                         |
| `src/cache.ts`, `src/users.ts`        | Context-aware `getKaneoWorkspaceForContext`/`setKaneoWorkspaceForContext`                                              |
| `src/db/drizzle.ts`                   | Stores raw sqlite handle; `closeDrizzleDb()` closes it                                                                 |
| `src/instances/bootstrap.ts`          | Unreachable branch replaced with assertion helper                                                                      |
| Migrations `041`, `045`               | Completion logging added                                                                                               |

Implementation plan: `docs/archive/2026-05-29-multi-provider-validated-findings-remediation.md`.
Design spec: `docs/archive/2026-05-29-multi-provider-validated-findings-remediation-design.md`.

## Related Decisions

- ADR-0009: Multi-Provider Task Tracker Support — the task-provider validation model this remediation aligns.
- ADR-0014: Multi-Chat Provider Abstraction — the chat provider model; adapter constructors are corrected here.
- ADR-0123: Trusted-Local Plugin System — manifest type fix aligns plugin schema with Zod defaults.
