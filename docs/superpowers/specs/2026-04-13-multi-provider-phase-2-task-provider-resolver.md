<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Router — Phase 2: TaskProviderResolver & Per-Context Config

**Date:** 2026-04-13
**Status:** Approved
**Parent:** [`2026-04-13-multi-provider-router-design.md`](./2026-04-13-multi-provider-router-design.md)
**Depends on:** Phase 1 (Instance Data Model & Bootstrap)
**Ships independently:** Yes — the bot still runs through a single chat adapter; only task-provider resolution changes.

## Summary

Replace `providers/factory.ts`'s `buildProviderForUser(userId)` with a `TaskProviderResolver` that resolves the task provider for a context from the `context_settings` assignment + per-context credentials. Make `CONFIG_KEYS` per-context dynamic so `/setup`, `/config`, and `/set` show only the keys relevant to the assigned task instance. After this phase, multiple task-tracker types coexist in one process, even though chat still flows through one adapter.

## Requirements

- One callable resolver that takes a `contextId` and returns `TaskProvider | null`
- Strict mode that throws when resolution fails (used by orchestrator paths that cannot tolerate `null`)
- All existing `buildProviderForUser` callers switch to the resolver: `llm-orchestrator`, `scheduler`, `deferred-prompts/poller`, `index.ts` admin warmup
- `CONFIG_KEYS` module-level constant is replaced by `getConfigKeysForContext(contextId)` everywhere
- `/setup` wizard gains a first step that requires the user to pick an active task instance
- `/set` validation is per-context: `/set kaneo_apikey` on a YouTrack-assigned context is rejected
- `/config` lists keys derived from the context's assigned task instance type

## Section 1: `TaskProviderResolver`

### Interface

```typescript
class TaskProviderResolver {
  resolve(contextId: string): TaskProvider | null
  resolveStrict(contextId: string): TaskProvider // throws on null
}

export const defaultTaskProviderResolver: TaskProviderResolver
```

No `userId` parameter — `contextId` (storageContextId) is the correct scope for both the instance lookup and the credential lookup.

### Resolution flow

1. `getContextAssignment(contextId)` → if `undefined`, return `null`
2. `getTaskInstance(assignment.taskInstanceId)` → if `undefined`, return `null` (log a warning — the assignment refers to a removed instance)
3. Merge instance `config` + per-context credentials:
   - kaneo: `{...instance.config, apiKey: getConfig(contextId, 'kaneo_apikey')}`
   - youtrack: `{...instance.config, token: getConfig(contextId, 'youtrack_token')}`
4. If the merged config is missing a required credential, return `null`
5. Call `createProvider(instance.type, config)` from `src/providers/registry.ts`

### Credential model

Unchanged from current shape: per-context credentials are stored in `user_config`, keyed by storage `contextId`.

## Section 2: Dynamic Config Keys

### `getConfigKeysForContext(contextId)`

Replaces the module-level `CONFIG_KEYS` constant. Logic:

1. Read `context_settings` assignment for `contextId`
2. If absent → return `['timezone']` (preferences only; the user has not picked a task tracker yet)
3. Resolve `task_instances.type`
4. Return type-specific keys plus preferences:
   - `kaneo` → `['kaneo_apikey', 'timezone']`
   - `youtrack` → `['youtrack_token', 'timezone']`

`ALL_CONFIG_KEYS` and `isConfigKey` stay as-is because they describe the universe of legal keys, not the per-context allow-list.

### Callers to update

| File                           | Change                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `src/config.ts` (seeding loop) | Iterate `getConfigKeysForContext(contextId)` instead of the constant           |
| `src/commands/setup.ts`        | Prompt only for the per-context keys after the task instance is bound          |
| `src/commands/config.ts`       | Render only the per-context keys + the existing Plugins section                |
| `src/commands/set.ts`          | Reject keys outside the per-context allow-list and outside `plugin.<id>.<key>` |

## Section 3: Callsite Migrations

### `llm-orchestrator.ts`

- `LlmOrchestratorDeps.buildProviderForUser` → `LlmOrchestratorDeps.resolve: (contextId) => TaskProvider | null`
- After `const provider = deps.resolve(configId)`, add an early-return that replies "I need /setup before I can do that." when `provider === null`
- Drop the `buildProviderForUser` import from `providers/factory.js`; import `defaultTaskProviderResolver` from `providers/resolver.js` instead

### `scheduler.ts`

- `SchedulerDeps.buildProviderForUser` → `SchedulerDeps.resolve`
- Per-task resolution skips tasks whose context resolves to `null` with a warning; the task row stays in DB so re-setup re-enables it

### `deferred-prompts/poller.ts`

- `BuildProviderFn` becomes `(contextId: string) => TaskProvider | null`
- Same null-skip-with-warning behavior

### `src/index.ts`

- Admin warmup uses `defaultTaskProviderResolver.resolve(adminUserId)`; `null` is logged at WARN and skipped, not fatal
- `startPollers(...)` accepts the resolver-shaped `BuildProviderFn`

### Delete `src/providers/factory.ts`

No callers should remain after the migrations above. The deletion is the verification step.

## Section 4: `/setup` Wizard Step

When the wizard starts for a context whose assignment is absent:

1. Render a numbered list of active task instances (`id`, `type`, `created_at`)
2. Wait for the user to pick by `id` (text or inline button — adapter-dependent)
3. Persist via `assignContext({contextId, taskInstanceId, platformInstanceId: msg.platformInstanceId})`
4. Continue into the existing credential-prompt step using `getConfigKeysForContext(contextId)`

If only one active task instance exists, the wizard auto-picks it and logs `info`.

If no active task instances exist, the wizard replies `No task trackers are configured. Ask a super-admin to add one in the dashboard.` and aborts.

## Section 5: Error Handling

| Condition                                     | Behavior                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| Context has no assignment                     | Resolver returns `null`; bot tells the user to `/setup`                     |
| Assignment refers to a removed task instance  | Resolver returns `null` and logs WARN; user re-runs `/setup`                |
| Credentials missing for the assigned instance | Resolver returns `null`; `/setup` flow already covers this                  |
| `/set` on an unsupported key                  | Reject with `Config key "x" is not valid for this context.`                 |
| Strict resolver called and resolution fails   | Throw a clear `Context <id> needs /setup`; callers should prefer non-strict |

## Section 6: Testing Strategy

- **`tests/providers/resolver.test.ts`** — DM/group resolution, missing assignment, missing creds, removed instance, strict throw
- **`tests/types/config-dynamic.test.ts`** — assignment-driven key derivation
- **`tests/commands/setup.test.ts`** — task-instance pick step, single-instance auto-pick, no-instances abort
- **`tests/commands/set.test.ts`** — per-context allow-list, plugin-key allowance
- **`tests/commands/config.test.ts`** — render the dynamic keys + Plugins section
- Existing **`tests/llm-orchestrator.test.ts`**, **`tests/scheduler.test.ts`**, **`tests/deferred-prompts/poller.test.ts`** — rename `buildProviderForUser` fixtures to `resolve`

## Section 7: Out of Scope

- Plugin-aware capability gating per context → Phase 5
- ChatRouter / multi-chat-instance → Phase 3
- Dashboard CRUD on task instances → Phase 4
