<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0155: Multi-Provider Remediation

## Status

Implemented

## Date

2026-05-31 – 2026-06-02

## Context

Migrations `048_namespace_kaneo_config` and `049` renamed per-context provider
credential keys from flat literals (`kaneo_apikey`, `youtrack_token`) to
plugin-namespaced keys (`plugin:task-provider-kaneo:provider:credential`,
`plugin:task-provider-youtrack:provider:token`). The **data** was renamed but
multiple **readers** still key on the old literals, producing a cluster of
related defects:

- The onboarding guard (`checkRequiredProviderConfig`) filters against the old
  literals and always returns `[]`, so unconfigured users are never prompted to
  `/setup` — a release blocker.
- The hardcoded `SENSITIVE_KEYS` set, wizard prompt/validation branches, and
  `labelForStorageKey` all match the old flat keys and ignore the namespaced
  ones.
- `types/config.ts` enumerates `kaneo_apikey` / `youtrack_token` as canonical
  `ConfigKey` union members alongside the live namespaced keys.

A second cross-cutting defect affected the encrypted-instance resilience path:
migration `045_provider_base_url` runs `decryptInstanceConfig` per row without
isolation — one undecryptable row aborts `initDb()`. The runtime `*Safe` decode
pattern was never applied to this migration, nor to several production list
callsites. The `/apply` reconcile path tears down already-running instances when
their DB row fails to decrypt, and `removeInstanceStrict` leaves a wedged entry
if `provider.stop()` throws.

Additional dead code and leaked abstractions accumulated: the Discord adapter
reads `process.env['ADMIN_USER_ID']` into an unused `_adminUserId` param;
`bootstrap.ts` contains an unreachable narrowing branch; `removeInstanceStrict`
dead-names after its non-strict twin was deleted; `ApplyFailureAction` includes
a never-emitted `'stop'` member; the resolver builds an unused config object
for an unknown descriptor; and ADR-0009 still references deleted `src/providers/kaneo/`
and the removed `TASK_PROVIDER` env var.

Design spec: `docs/archive/2026-05-31-multi-provider-remediation-design.md`.
Implementation plan: `docs/archive/2026-05-31-multi-provider-remediation.md`.

## Decision Drivers

- **No hardcoded provider key literals**: Renaming keys in the DB must not
  silently break readers. All provider key resolution must be descriptor-driven.
- **Isolate + preserve**: One undecryptable encrypted row must never abort a
  migration, throw on a read path, or tear down a running instance.
- **No new abstractions**: Reuse existing `*Safe` decode helpers and descriptor
  machinery; add only a small `getRequiredProviderConfigKeysForContext` helper.
- **Release safety**: The dead onboarding guard is a release blocker; Track 1
  fixes must ship first.
- **Independently mergeable tracks**: Four tracks ordered by risk, each
  mergeable without the others.

## Considered Options

### Option A: Fix each finding in isolation

Patch each reader to use the new namespaced key literal directly.

- **Pros**: Minimal diff per finding; no shared helper needed.
- **Cons**: If keys are renamed again (e.g. a third provider), the same bug
  class recurs. Each patch is a one-off fix, not a root-cause closure.

### Option B: Descriptor-driven resolution + isolate-and-preserve (chosen)

Derive required/sensitive/label metadata from the live task-provider
descriptor. Make migrations and instance reads resilient to undecryptable rows.
Remove dead code.

- **Pros**: Permanently eliminates the stale-literal bug class. Resilience
  pattern applies uniformly. Dead code removal reduces maintenance surface.
- **Cons**: Slightly larger scope; descriptor helper must be tested under
  multiple provider types.

### Option C: Revert migrations 048/049 and restore the flat key names

Undo the namespace migration and keep flat keys everywhere.

- **Pros**: All existing readers resume working immediately.
- **Cons**: Reintroduces the collision risk that motivated 048/049. Plugin
  namespacing convention is abandoned. Future providers cannot coexist without
  key conflicts.

## Decision

**Option B** with the following subsidiary decisions:

| Topic                           | Decision                                                                                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Required-key resolution         | `getRequiredProviderConfigKeysForContext(contextId)` filters `getConfigFieldsForContext` to `required && kind !== 'preference'`, returning storage keys. No hardcoded provider key literals. |
| Sensitivity                     | `isSensitiveProviderStorageKey(key)` derives from `field.sensitive` on active provider descriptors, replacing `SENSITIVE_KEYS`.                                                              |
| Wizard prompts/validation       | Drive prompt text, labels, and validation from descriptor field metadata (`label`, `required`). Remove `BUILTIN_PROMPTS` provider branches and `validateApiKey`/`validateToken`.             |
| Config key type                 | `ConfigKey` union retains only static keys (`timezone`, `mcp_endpoints`). Provider keys are descriptor-derived runtime strings, not union members.                                           |
| Migration resilience            | Per-row try/catch in migration `045`; undecryptable rows are skipped with a `WARN`. Migration completes regardless.                                                                          |
| Instance read resilience        | Switch `admin-system`, `task-instance-selection`, and `task-provider-lifecycle` to `listTaskInstancesSafe` / `listPlatformInstancesSafe`.                                                    |
| Preserve running instances      | `/apply` excludes undecryptable-row ids from `runtimeIdsToRemove`; a running instance whose DB row is unreadable is left untouched and surfaced in diagnostics.                              |
| Remove instance on stop failure | `removeInstance` (renamed from `removeInstanceStrict`) uses try/finally so the map entry is cleared even when `provider.stop()` throws, enabling retry.                                      |
| Discord adapter                 | Remove `process.env['ADMIN_USER_ID']` read and dead `_adminUserId` threading. `isAdmin` continues to come from the interaction.                                                              |
| Bootstrap narrowing             | `collectMissing` returns a discriminated union (`{ ok: true, chatType, adminUserId }                                                                                                         | { ok: false, missing }`) so the success path has no second null-check. |
| Dead naming                     | `removeInstanceStrict` → `removeInstance`; `'stop'` removed from `ApplyFailureAction`.                                                                                                       |
| Resolver early return           | Return `null` early on `descriptor === undefined` with a `WARN`, skipping the unused config build and validator round-trip.                                                                  |
| Validator comments              | Corrected to state that resolver-time validation passes the merged config including context-scoped fields. Comment-only change.                                                              |
| ADR-0009                        | Updated Implementation Status to reflect plugin-contributed providers and resolver/descriptor flow; removed references to deleted `src/providers/kaneo/` and `TASK_PROVIDER`.                |

## Consequences

### Positive

- The onboarding guard is restored: unconfigured users are prompted to `/setup`
  again.
- A single undecryptable encrypted row no longer crashes startup, breaks the
  admin endpoint, or terminates a running instance.
- The stale-literal bug class is permanently closed — any future key rename
  flows through the descriptor automatically.
- Dead code removal (`SENSITIVE_KEYS`, `validateApiKey`/`validateToken`,
  `displayLabelForKey`, `labelForStorageKey`, `_adminUserId` threading,
  unreachable bootstrap branch, `'stop'` union member) reduces maintenance
  surface and eliminates misleading dead branches.
- ADR-0009 now matches the actual codebase.

### Negative

- The descriptor helper adds a thin runtime dependency on the active provider
  descriptor registry for config-key resolution. If no descriptor is registered
  for a context's task instance type, the helper returns no provider keys
  (correct behavior — same as the resolver returning `null`).
- `listTaskInstancesSafe` returns a `failures` diagnostics array that callers
  must ignore or surface; the three migrated callsites currently ignore it
  (admin-system could surface it in a future iteration).

### Risks

- If a new provider plugin is added with context-scoped required fields and its
  descriptor is not yet registered (e.g. during first-run bootstrap before
  approval), the onboarding guard will not prompt for those keys until the
  plugin is approved and activated. This is consistent with the plugin
  lifecycle: unapproved plugins are not eligible.
- The `providerRuntime` host allowlist enforcement (#15) and `internalUrl`
  config pipeline unification (#16) were identified as open questions in the
  spec and deferred to investigation-first tasks; they are not part of this
  ADR's decided scope.

## Implementation Notes

Four tracks, independently mergeable:

| Track | Focus                                        | Key files                                                                                                                               |
| ----- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Release blockers (guard + migration 045)     | `src/config-keys.ts`, `src/llm-orchestrator-config.ts`, `src/db/migrations/045_provider_base_url.ts`                                    |
| 2     | Descriptor-driven stale-key completion       | `src/config.ts`, `src/config-keys.ts`, `src/wizard/steps.ts`, `src/types/config.ts`                                                     |
| 3     | Instance resilience & lifecycle              | `src/debug/instance-route-support.ts`, `src/chat/router.ts`, `src/debug/admin-system.ts`, `src/instances/bootstrap.ts`, Discord adapter |
| 4     | Dead code / leaked abstractions / stale docs | `src/chat/router.ts`, `src/debug/instance-route-support.ts`, `src/providers/resolver.ts`, both `validate-config.ts`, `docs/adr/0009-*`  |

New helper: `getRequiredProviderConfigKeysForContext` in `src/config-keys.ts`.
New predicate: `isSensitiveProviderStorageKey` in `src/config-keys.ts`.

## Related Decisions

- ADR-0009: Multi-Provider Task Tracker Support — the original multi-provider
  decision whose Implementation Status was updated as part of this work.
- ADR-0123: Trusted-Local Plugin System — the plugin system that owns the
  descriptor registry and `storageKeyForProviderField` used by the
  descriptor-driven resolution.
- ADR-0014: Multi-Chat Provider Abstraction — the chat provider model; the
  Discord adapter cleanup removes a leaked env read violating its "no env in
  adapters" convention.
