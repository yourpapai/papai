<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0167: Provider Abstraction Leaks Fix

## Status

Implemented

## Date

2026-03-30 – 2026-04-XX

## Context

papai's `TaskProvider` interface (`src/providers/types.ts`) was designed to
decouple consumer code from specific task-tracker implementations (Kaneo,
YouTrack). In practice, provider-specific details leaked through the
abstraction boundary into core modules:

1. `llm-orchestrator.ts` imported `KaneoClassifiedError` and
   `YouTrackClassifiedError` directly, duplicating error-handling branches.
2. `commands/admin.ts` imported `provisionAndConfigure` from the Kaneo provider,
   hardcoding a single provider's provisioning flow.
3. `src/users.ts` exported `getKaneoWorkspace`/`setKaneoWorkspace` —
   provider-prefixed functions in a module that should be provider-agnostic.
4. `scheduler.ts` used the same Kaneo-specific workspace getter and logged
   provider-specific messages.
5. `wizard/steps.ts` hardcoded provider names in prompt strings.
6. The provider factory (`src/providers/factory.ts`) called
   `getKaneoWorkspace`.

These leaks violated the abstraction boundary: any new task provider required
changes in unrelated core files, and the codebase could not reason about
providers generically.

The implementation plan
(`docs/archive/2026-03-30-fix-provider-abstraction-leaks.md`) was executed
task-by-task with TDD enforcement.

## Decision Drivers

- **Abstraction integrity**: Code outside `src/providers/` must not import
  provider-specific symbols. The `TaskProvider` interface is the sole contract.
- **Extensibility**: Adding a new task provider (e.g. Linear, Jira) must not
  require edits to `llm-orchestrator`, `scheduler`, `users`, or `commands`.
- **Graceful degradation**: Providers that do not support a capability (e.g.
  provisioning) must be handled generically, not via provider-name checks.
- **Backward compatibility**: Existing call sites and config keys must continue
  to work during the transition; deprecated wrappers bridge the gap.
- **Single responsibility**: Workspace ID management, error classification, and
  provisioning are provider concerns and belong behind the interface.

## Considered Options

### Option A: Move all provider code into plugins (full extraction)

Migrate Kaneo and YouTrack entirely into `plugins/task-provider-kaneo/` and
`plugins/task-provider-youtrack/`, eliminating `src/providers/kaneo/` and
`src/providers/youtrack/` altogether.

- **Pros**: Cleanest boundary; provider code fully isolated; aligns with plugin
  system architecture.
- **Cons**: Massive migration; providers are core infrastructure with deep
  integration (factory, migrations, config seeding); plugin activation ordering
  becomes critical; exceeds the scope of a leak-fix pass.

### Option B: Fix leaks in-place, keep providers in `src/providers/` (chosen)

Add missing interface methods (`provisionUser`, `metadata`), replace
provider-specific imports with interface calls, rename provider-specific
workspace functions to generic terms. Providers remain under `src/providers/`
as first-party modules.

- **Pros**: Minimal scope; each leak is an independent, testable fix; no
  migration or activation-order risk; deprecated wrappers preserve compat.
- **Cons**: Provider implementations still live in `src/` rather than plugins;
  future extraction remains a separate effort.

### Option C: Adapter/facade layer over providers

Introduce an intermediate adapter module that wraps each provider and exposes
only generic methods, keeping provider-specific code behind the adapter.

- **Pros**: Providers can evolve independently; adapter centralizes
  provider-specific logic.
- **Cons**: Adds indirection without fixing the root cause (leaky imports);
  adapter would need to know about every provider anyway; does not eliminate
  `instanceof` checks on provider-specific error classes.

## Decision

**Option B** with the following subsidiary decisions:

| Topic               | Decision                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ------------------------------------- |
| Error handling      | Remove `KaneoClassifiedError`/`YouTrackClassifiedError` imports from `llm-orchestrator.ts`; use the base `ProviderClassifiedError` exclusively.              |
| Provisioning        | Add `provisionUser?()` to the `TaskProvider` interface as an optional method gated by the `provisioning` capability. Kaneo implements it; YouTrack does not. |
| ProvisioningResult  | Discriminated union: `{ status: 'provisioned' }                                                                                                              | { status: 'registration_disabled' } | { status: 'failed'; error: string }`. |
| Workspace functions | Add `getWorkspaceId()`/`setWorkspaceId()` to `users.ts`; deprecate `getKaneoWorkspace`/`setKaneoWorkspace` as thin wrappers.                                 |
| Factory/scheduler   | Replace `getKaneoWorkspace` calls with `getWorkspaceId`.                                                                                                     |
| Provider metadata   | Add `ProviderMetadata` type and `readonly metadata` field to `TaskProvider`; wizard uses `metadata.authPrompt`/`tokenLabel` instead of hardcoded strings.    |
| Admin commands      | Remove direct `provisionAndConfigure` import; provisioning goes through `provider.provisionUser()` or is deferred.                                           |
| Backward compat     | Deprecated workspace functions remain exported; no config-key renames at this stage.                                                                         |

## Consequences

### Positive

- No file outside `src/providers/` imports a provider-specific symbol. Adding a
  new provider requires zero changes to core modules.
- Error handling in `llm-orchestrator.ts` is a single `instanceof
ProviderClassifiedError` branch, not a growing `||` chain per provider.
- Provisioning is capability-gated: providers that do not support it are
  handled via a single `undefined` check, not a provider-name switch.
- Generic workspace functions make `users.ts` usable for any current or future
  provider.
- Wizard prompts are derived from `metadata`, not hardcoded provider names.

### Negative

- Deprecated workspace functions (`getKaneoWorkspace`, `setKaneoWorkspace`) add
  a thin indirection layer until all call sites migrate.
- `ProviderMetadata` is a static record; dynamic i18n of prompt strings is not
  addressed.
- Provider implementations remain in `src/providers/` rather than plugins; the
  full extraction (Option A) is deferred.

### Risks

- If a deprecated wrapper is accidentally used by new code, the leak
  reappears. Mitigation: wrappers log a `debug` deprecation notice; lint rules
  could flag the old names.
- `provisionUser` is optional, so callers must always check for `undefined`.
  A missed check results in a runtime `TypeError`. Mitigation: the
  `provisioning` capability and the optional method are checked together in
  `maybeAutoProvision`.

## Implementation Notes

Key changes by module:

| File                              | Change                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/providers/types.ts`          | Added `ProvisioningResult`, `provisionUser?()`, `ProviderMetadata`, `metadata` field.                                                  |
| `src/providers/kaneo/index.ts`    | Added `provisionUser()` method, `metadata`, `provisioning` capability.                                                                 |
| `src/providers/youtrack/index.ts` | Added `metadata`.                                                                                                                      |
| `src/llm-orchestrator.ts`         | Removed provider-specific error imports; single `ProviderClassifiedError` branch; `maybeAutoProvision` replaces `maybeProvisionKaneo`. |
| `src/users.ts`                    | Added `getWorkspaceId()`/`setWorkspaceId()`; deprecated `getKaneoWorkspace`/`setKaneoWorkspace`.                                       |
| `src/providers/factory.ts`        | Uses `getWorkspaceId` instead of `getKaneoWorkspace`.                                                                                  |
| `src/scheduler.ts`                | Uses `getWorkspaceId`; generic log messages.                                                                                           |
| `src/wizard/steps.ts`             | Derives prompts from `PROVIDER_CONFIGS` lookup instead of hardcoded provider names.                                                    |
| `src/commands/admin.ts`           | Removed `provisionAndConfigure` import; provisioning deferred to provider method.                                                      |

New tests: `tests/providers/provisioning-capability.test.ts`,
`tests/providers/kaneo/provision.test.ts`,
`tests/users-workspace.test.ts`,
`tests/llm-orchestrator-error-handling.test.ts`.

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — the long-term home for extracted
  provider code (Option A from this decision).
- ADR-0009: Multi-Provider Task Tracker Support — the original provider
  capability model that this decision strengthens.
- ADR-0014: Multi-Chat Provider Abstraction — analogous chat-provider
  boundary; the same leak-fix discipline applies.
