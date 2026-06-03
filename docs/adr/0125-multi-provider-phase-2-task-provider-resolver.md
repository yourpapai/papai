<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0125: Multi-Provider Phase 2: Task Provider Resolver

## Status

Implemented

## Date

2026-04-13 – 2026-05-23

## Context

After Phase 1 introduced the instance data model (`task_instances`, `platform_instances`, `context_settings`) and env-to-DB bootstrap, the bot still resolved task providers from the global `TASK_PROVIDER` environment variable via `src/providers/factory.ts`'s `buildProviderForUser(userId)`. This meant only one task-tracker type could be active per process, and the `CONFIG_KEYS` constant offered a single fixed set of visible config keys regardless of which provider a context was assigned. Multiple task-tracker types could coexist in the DB but not in the runtime.

The parent multi-provider router design (`docs/archive/2026-04-13-multi-provider-router-design.md`) called for a resolver that turns a storage context into a `TaskProvider`, so that each context can use a different task instance. Phase 2 covers this resolver and per-context config keys while the bot still runs a single chat adapter (Phase 3 adds per-message `platformInstanceId`).

Spec: `docs/archive/2026-04-13-multi-provider-phase-2-task-provider-resolver.md`
Plan: `docs/archive/2026-05-23-multi-provider-phase-2-task-provider-resolver-plan.md`

## Decision Drivers

- **Multi-provider coexistence**: Multiple task-tracker types must be usable in one process simultaneously, each bound to a different context.
- **No global provider env at runtime**: `TASK_PROVIDER` must not gate runtime behavior after first-run bootstrap; the DB is the source of truth.
- **Per-context config surface**: Users should only see config keys relevant to their assigned task instance (e.g. `youtrack_token` for YouTrack, `kaneo_apikey` for Kaneo), not a flat union of all provider keys.
- **Graceful degradation**: When a context has no assignment, an inactive instance, or missing credentials, the resolver returns `null` and the bot replies with setup guidance rather than crashing.
- **DI testability**: The resolver and config-key helper must support dependency injection for deterministic unit tests without env or global state.

## Considered Options

### Option A: Keep global `TASK_PROVIDER` and add per-context overrides

Retain `buildProviderForUser` as the default path, with per-context overrides read from `context_settings` when present.

- **Pros**: Smaller migration surface; backward-compatible with existing env-driven deployments.
- **Cons**: Two code paths (env default + per-context override) diverge and age differently; `CONFIG_KEYS` remains a static union; the global env var is still required at startup.

### Option B: Replace global factory with context-assigned resolver (chosen)

Introduce `TaskProviderResolver` as the single runtime path from `contextId` to `TaskProvider | null`. Replace `CONFIG_KEYS` with `getConfigKeysForContext(contextId)`. Delete the factory.

- **Pros**: One code path; DB is the single source of truth after bootstrap; config surface adapts automatically per context; clean deletion of `providers/factory.ts`.
- **Cons**: Larger migration surface (all callers must switch); requires setup flows to assign a task instance before credentials can be collected.

### Option C: Resolver returns a tagged union instead of `null`

`resolve()` returns `{ status: 'ok', provider } | { status: 'missing_assignment' } | { status: 'inactive' } | { status: 'missing_credentials' }`.

- **Pros**: Callers can give more specific error messages.
- **Cons**: Explodes the return type; callers already have enough context to derive the reason from `context_settings` and `getConfigKeysForContext()`; `resolveStrict()` covers the throw-with-guidance case.

## Decision

**Option B**, with the following subsidiary decisions:

| Topic                      | Decision                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Resolver interface         | `TaskProviderResolver.resolve(contextId) → TaskProvider                                                                                                                    | null`; `resolveStrict(contextId) → TaskProvider` (throws "Context X needs /setup") |
| Resolution flow            | `context_settings` → `task_instances` (active check) → normalize `url`/`baseUrl` → merge per-context credentials → `createProvider(type, config)`                          |
| Credential model           | Unchanged: per-context credentials in `user_config` keyed by storage `contextId`. Kaneo session-cookie detection via `isKaneoSessionCookie()`.                             |
| Config keys                | `getConfigKeysForContext(contextId)` returns `['timezone']` for unassigned contexts, plus the assigned provider's visible key. `kaneo_workspace_id` remains internal.      |
| Setup flow                 | `/setup` assigns a task instance before the credential wizard starts. Single active instance auto-picks; no instances aborts with guidance.                                |
| Config editor validation   | Rejects edits for keys outside the per-context allow-list with "Config key X is not valid for this context."                                                               |
| `TASK_PROVIDER` at runtime | Removed from required env validation. Retained only in `bootstrapInstancesFromEnv()` for first-run seeding and `admin-system.ts` for status display.                       |
| Callsite migration         | All `buildProviderForUser` callers → `resolve(contextId)`: `llm-orchestrator`, `scheduler`, `deferred-prompts/poller`, `context-tool-resolution`, `index.ts` admin warmup. |
| Null handling              | LLM orchestrator replies "I need /setup before I can do that."; scheduler and poller skip with a WARN; admin warmup logs WARN and continues.                               |
| Factory deletion           | `src/providers/factory.ts` deleted after all callers are migrated (Task 9).                                                                                                |

## Consequences

### Positive

- Multiple task-tracker types coexist in one process, each bound to a different context.
- `TASK_PROVIDER` is no longer required at runtime; first-run bootstrap seeds the DB and the env var is optional thereafter.
- Config surface adapts automatically: YouTrack contexts never see `kaneo_apikey`, and vice versa.
- Config editor rejects cross-provider edits, preventing credential confusion.
- Single resolver path eliminates the divergent env-default + per-context override code paths.
- DI-based resolver allows deterministic unit tests without env or global state.

### Negative

- Setup flow adds a task-instance selection step before credential collection, lengthening first-run UX for multi-instance deployments.
- Resolver returns `null` for several distinct failure reasons (no assignment, inactive instance, missing credentials); callers must derive the specific reason from surrounding state.
- `admin-system.ts` still reads `TASK_PROVIDER` for status display, creating a minor inconsistency until Phase 4 dashboard CRUD lands.

### Risks

- The resolver performs synchronous DB reads on every LLM turn. If `context_settings` or `task_instances` lookups become hot paths, caching may be needed. Current single-digit QPS makes this acceptable.
- Task-instance selection state is held in-process (in-memory `Map`). A process restart during selection loses the pending session, forcing the user to re-enter `/setup`. This matches the existing wizard session behavior.

## Implementation Notes

Key modules:

| File                                   | Role                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/providers/resolver.ts`            | `TaskProviderResolver` class with `resolve()` / `resolveStrict()`; DI via `TaskProviderResolverDeps` |
| `src/config-keys.ts`                   | `getConfigKeysForContext(contextId)` — derives visible keys from context assignment                  |
| `src/setup/task-instance-selection.ts` | Setup-step state machine for task-instance pick, auto-pick, and abort                                |
| `src/setup/platform-instance.ts`       | Resolves the single active platform instance for `CHAT_PROVIDER` during Phase 2 setup                |

Callsite migrations: `src/llm-orchestrator.ts`, `src/scheduler.ts`, `src/deferred-prompts/poller.ts`, `src/commands/context-tool-resolution.ts`, `src/index.ts`. All replaced `buildProviderForUser(userId)` with `resolve(contextId)`.

Deleted: `src/providers/factory.ts` after all callers migrated.

Tests: `tests/providers/resolver.test.ts`, `tests/config-keys.test.ts`, `tests/setup/task-instance-selection.test.ts`, plus updated fixtures in orchestrator, scheduler, and poller test suites.

## Related Decisions

- ADR-0009: Multi-Provider Task Tracker Support — the provider capability model and normalized interface that the resolver builds on.
- ADR-0123: Trusted-Local Plugin System — plugin eligibility gating per context also reads `context_settings`.
- Phase 1 (instance data model & bootstrap) — introduced `task_instances`, `platform_instances`, `context_settings` tables and `bootstrapInstancesFromEnv()`.
- Phase 3 (ChatRouter) — will replace the Phase 2 `resolveCurrentPlatformInstanceId()` single-adapter lookup with per-message `platformInstanceId`.
