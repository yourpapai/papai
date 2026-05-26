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

Replace `providers/factory.ts`'s `buildProviderForUser(userId)` with a `TaskProviderResolver` that resolves the task provider for a context from `context_settings` + per-context credentials. Make the user-visible config-key list per-context dynamic so `/setup`, `/config`, the config editor, and auto-started setup flows show only the keys relevant to the assigned task instance. After this phase, multiple task-tracker types coexist in one process, even though chat still flows through one adapter.

## Requirements

- One callable resolver that takes a `contextId` and returns `TaskProvider | null`
- Strict mode that throws when resolution fails (used by orchestrator paths that cannot tolerate `null`)
- All existing `buildProviderForUser` callers switch to the resolver: `llm-orchestrator`, `scheduler`, `deferred-prompts/poller`, `commands/context-tool-resolution`, and `index.ts` admin warmup
- The `CONFIG_KEYS` module-level constant is replaced by `getConfigKeysForContext(contextId)` everywhere runtime code needs the visible per-context allow-list
- `/setup` wizard gains a first step that requires the user to pick an active task instance
- Config editor validation is per-context: editing `kaneo_apikey` on a YouTrack-assigned context is rejected
- `/config` lists keys derived from the context's assigned task instance type
- Remaining runtime uses of `process.env.TASK_PROVIDER` are removed outside env bootstrap and compatibility/status display paths

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

1. `getContextSettings(contextId)` → if `null`, return `null`
2. `getTaskInstance(settings.taskInstanceId)` → if `null`, return `null` (log a warning — the assignment refers to a removed instance)
3. If the task instance status is not `active`, return `null` and log a warning
4. Normalize instance `config.url` to provider registry key `baseUrl` (`baseUrl` is also accepted for dashboard-created rows)
5. Merge instance config + per-context credentials:
   - kaneo: `{baseUrl, apiKey | sessionCookie, workspaceId}` where the credential comes from `getConfig(contextId, 'kaneo_apikey')`, session-cookie detection uses `isKaneoSessionCookie()`, and `workspaceId` comes from `getKaneoWorkspace(contextId)`
   - youtrack: `{baseUrl, token}` where `token` comes from `getConfig(contextId, 'youtrack_token')`
6. If the merged config is missing a required credential, base URL, or Kaneo workspace ID, return `null`
7. Call `createProvider(instance.type, config)` from `src/providers/registry.ts`

### Credential model

Unchanged from current shape: per-context credentials are stored in `user_config`, keyed by storage `contextId`.

## Section 2: Dynamic Config Keys

### `getConfigKeysForContext(contextId)`

Replaces the module-level `CONFIG_KEYS` constant. Logic:

1. Read `context_settings` for `contextId`
2. If absent → return `['timezone']` (preferences only; the user has not picked a task tracker yet)
3. Resolve `task_instances.type`
4. If the assigned task instance is missing or inactive → return `['timezone']`
5. Return type-specific visible keys plus preferences:
   - `kaneo` → `['kaneo_apikey', 'timezone']`
   - `youtrack` → `['youtrack_token', 'timezone']`

`ALL_CONFIG_KEYS` and `isConfigKey` stay as-is because they describe the universe of legal keys, not the per-context allow-list. `kaneo_workspace_id` remains a legal internal key but is not user-visible.

### Callers to update

| File                               | Change                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| `src/config.ts` (getAllConfig)     | Iterate `getConfigKeysForContext(contextId)` instead of the constant                  |
| `src/wizard/engine.ts`             | Prompt only for the assigned provider's visible keys after the task instance is bound |
| `src/wizard/steps.ts`              | Remove global-provider assumptions from step/summary generation                       |
| `src/commands/setup.ts`            | Assign a task instance before starting the credential wizard                          |
| `src/commands/config.ts`           | Render only the per-context keys + the existing Plugins section                       |
| `src/config-editor/handlers.ts`    | Reject callback/text edits for keys outside the per-context allow-list                |
| `src/bot.ts`                       | Auto-start setup from the context assignment instead of `process.env.TASK_PROVIDER`   |
| `src/llm-orchestrator-config.ts`   | Compute required keys from the context assignment instead of `TASK_PROVIDER`          |
| `src/providers/kaneo/provision.ts` | Auto-provision only when the assigned task instance type is `kaneo`                   |

## Section 3: Callsite Migrations

### `llm-orchestrator.ts`

- `LlmOrchestratorDeps.buildProviderForUser` → `LlmOrchestratorDeps.resolve: (contextId) => TaskProvider | null`
- After `const provider = deps.resolve(configId)`, add an early-return that replies "I need /setup before I can do that." when `provider === null`
- Drop the `buildProviderForUser` import from `providers/factory.js`; import `defaultTaskProviderResolver` from `providers/resolver.js` instead
- `checkRequiredProviderConfig()` must stop reading `TASK_PROVIDER`; it should derive missing provider keys from `getConfigKeysForContext(configId)` and let the resolver handle base URL / workspace / inactive-instance failures.

### `providers/kaneo/provision.ts`

- `maybeProvisionKaneo()` stops reading `TASK_PROVIDER`
- It reads the context assignment and only auto-provisions when the assigned task instance exists, is active, and has type `kaneo`
- Unassigned contexts return without provisioning; `/setup` owns task-instance assignment

### `scheduler.ts`

- `SchedulerDeps.buildProviderForUser` → `SchedulerDeps.resolve`
- Per-task resolution skips tasks whose context resolves to `null` with a warning; the task row stays in DB so re-setup re-enables it

### `deferred-prompts/poller.ts`

- `BuildProviderFn` becomes `(contextId: string) => TaskProvider | null`
- Same null-skip-with-warning behavior

### `commands/context-tool-resolution.ts`

- `safeBuildProvider(contextId)` uses `defaultTaskProviderResolver.resolve(contextId)` and keeps the existing degraded cached-tool fallback when resolution returns `null`

### `src/index.ts`

- Admin warmup uses `defaultTaskProviderResolver.resolve(adminUserId)`; `null` is logged at WARN and skipped, not fatal
- `startPollers(...)` accepts the resolver-shaped `BuildProviderFn`
- Startup no longer requires `TASK_PROVIDER` or provider-specific task env vars once `bootstrapInstancesFromEnv()` is the task-instance source of truth. `CHAT_PROVIDER` and `ADMIN_USER_ID` remain required until Phase 3.

### Delete `src/providers/factory.ts`

No callers should remain after the migrations above. The deletion is the verification step.

## Section 4: `/setup` Wizard Step

When the wizard starts for a context whose assignment is absent:

1. Render a numbered list of active task instances (`id`, `type`, `created_at`)
2. Wait for the user to pick by `id` (text or inline button — adapter-dependent)
3. Persist via `setContextSettings({contextId, taskInstanceId, platformInstanceId})`
   - During Phase 2, `platformInstanceId` is the single active platform instance for the current `CHAT_PROVIDER`; Phase 3 replaces this with per-message `platformInstanceId` from the ChatRouter.
4. Continue into the existing credential-prompt step using `getConfigKeysForContext(contextId)`

If only one active task instance exists, the wizard auto-picks it and logs `info`.

If no active task instances exist, the wizard replies `No task trackers are configured. Ask a super-admin to add one in the dashboard.` and aborts.

## Section 5: Error Handling

| Condition                                      | Behavior                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| Context has no assignment                      | Resolver returns `null`; bot tells the user to `/setup`                     |
| Assignment refers to a removed task instance   | Resolver returns `null` and logs WARN; user re-runs `/setup`                |
| Assignment refers to an inactive task instance | Resolver returns `null` and logs WARN; user re-runs `/setup`                |
| Credentials missing for the assigned instance  | Resolver returns `null`; `/setup` flow already covers this                  |
| Config editor on an unsupported key            | Reject with `Config key "x" is not valid for this context.`                 |
| Strict resolver called and resolution fails    | Throw a clear `Context <id> needs /setup`; callers should prefer non-strict |

## Section 6: Testing Strategy

- **`tests/providers/resolver.test.ts`** — DM/group resolution, missing assignment, missing creds, removed instance, strict throw
- **`tests/config-keys.test.ts`** — assignment-driven key derivation
- **`tests/commands/setup.test.ts`** — task-instance pick step, single-instance auto-pick, no-instances abort
- **`tests/commands/config.test.ts`** — render the dynamic keys + Plugins section
- **`tests/config-editor/handlers.test.ts`** — per-context allow-list rejection for unsupported editor keys
- Existing **`tests/llm-orchestrator.test.ts`**, **`tests/scheduler.test.ts`**, **`tests/deferred-prompts/poller.test.ts`** — rename `buildProviderForUser` fixtures to `resolve`

## Section 7: Out of Scope

- Plugin-aware capability gating per context → Phase 5
- ChatRouter / multi-chat-instance → Phase 3
- Dashboard CRUD on task instances → Phase 4
