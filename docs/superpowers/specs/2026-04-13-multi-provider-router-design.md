<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Router Design

**Date:** 2026-04-13
**Status:** Approved
**Approach:** Multi-Provider Router (Approach B)

## Summary

Refactor papai to support multiple chat provider and task provider instances simultaneously from a single process. Chat and task provider instances are DB-stored and dashboard-managed. A `ChatRouter` wraps multiple `ChatProvider` instances behind the existing interface. A `TaskProviderResolver` resolves the correct task provider per context from DB-stored assignments.

## Requirements

- Single process serves multiple chat platforms and multiple task trackers simultaneously
- Chat and task provider instances are DB-stored, managed via the debug dashboard
- Staged apply: changes saved to DB, applied to running system via explicit "Apply" action
- Global super-admin + optional per-platform admins
- Per-context task provider selection: DMs pick per-user, groups pick per-group
- Explicit `/setup` required for task provider assignment (no auto-assignment)
- Separate user identities per platform (cross-platform linking deferred)
- Bootstrap from existing env vars on first run, then DB is source of truth

## Section 1: Data Model

### New tables

**`platform_instances`** — stores chat provider instance configurations.

| Column       | Type        | Description                                             |
| ------------ | ----------- | ------------------------------------------------------- |
| `id`         | TEXT PK     | Unique instance ID (e.g., `telegram-prod`, `mm-team-a`) |
| `type`       | TEXT        | Provider type: `telegram`, `mattermost`, `discord`      |
| `config`     | TEXT (JSON) | Encrypted provider-specific config (tokens, URLs)       |
| `status`     | TEXT        | `pending` / `active` / `stopped`                        |
| `created_at` | TEXT        | ISO timestamp                                           |

**`task_instances`** — stores task provider instance configurations.

| Column       | Type        | Description                                          |
| ------------ | ----------- | ---------------------------------------------------- |
| `id`         | TEXT PK     | Unique instance ID (e.g., `kaneo-prod`, `yt-team-b`) |
| `type`       | TEXT        | Provider type: `kaneo`, `youtrack`                   |
| `config`     | TEXT (JSON) | Instance-level config (base URLs, workspace IDs)     |
| `status`     | TEXT        | `pending` / `active` / `stopped`                     |
| `created_at` | TEXT        | ISO timestamp                                        |

**`context_settings`** — maps each conversation context to its task provider instance.

| Column                 | Type    | Description                                                                                                                                                                         |
| ---------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context_id`           | TEXT PK | Storage context ID (userId for DMs, groupId for groups)                                                                                                                             |
| `task_instance_id`     | TEXT FK | References `task_instances.id`                                                                                                                                                      |
| `platform_instance_id` | TEXT    | Which chat instance this context lives on. Required for outbound routing — scheduler and poller need to know which chat instance to send notifications through for a given context. |

**`admins`** — admin hierarchy.

| Column                 | Type | Description                                                               |
| ---------------------- | ---- | ------------------------------------------------------------------------- |
| `user_id`              | TEXT | Platform-scoped user ID                                                   |
| `platform_instance_id` | TEXT | `'__super__'` = super-admin, otherwise = platform admin for that instance |
| `created_at`           | TEXT | ISO timestamp                                                             |

PK: `(user_id, platform_instance_id)`

### What stays unchanged

- `user_config` table — per-context credentials (`kaneo_apikey`, `youtrack_token`, `llm_*`) remain keyed by storageContextId (userId in DMs, groupId in groups)
- `users` table — authorization stays per-platform-user, no cross-platform linking
- Conversation history, memos, facts, recurring tasks — all keyed by contextId, unchanged

### Config key changes

`CONFIG_KEYS` becomes dynamic — resolved from the context's assigned task instance type rather than a global env var. New function `getConfigKeysForContext(contextId)` replaces the module-level constant.

## Section 2: ChatRouter

The `ChatRouter` implements `ChatProvider` and delegates to multiple underlying instances. It is the single object passed to `setupBot()`.

### Interface

```typescript
interface ManagedChatInstance {
  id: string // e.g., "telegram-prod"
  type: string // "telegram" | "mattermost" | "discord"
  provider: ChatProvider // the actual adapter instance
  status: 'active' | 'stopped'
}

class ChatRouter implements ChatProvider {
  private instances: Map<string, ManagedChatInstance>

  // Lifecycle — called from dashboard "apply"
  addInstance(id: string, type: string, config: Record<string, string>): void
  removeInstance(id: string): Promise<void>
  startInstance(id: string): Promise<void>
  stopInstance(id: string): Promise<void>

  // ChatProvider interface — delegates to all active instances
  registerCommand(name, handler): void
  onMessage(handler): void
  sendMessage(userId, markdown, instanceId?): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>

  // Instance-specific queries
  getInstanceTraits(instanceId: string): ChatProviderTraits
}
```

### Message flow

1. Each underlying `ChatProvider` adapter calls its `onMessage` handler as today.
2. The router wraps each adapter's handler to inject `platformInstanceId` into the `IncomingMessage` before forwarding to the bot's handler.
3. The `ReplyFn` is already scoped to the correct platform by the adapter — no routing needed on the reply path.

### IncomingMessage change

```typescript
type IncomingMessage = {
  // ... existing fields ...
  platformInstanceId: string // NEW — set by ChatRouter, e.g., "mm-team-a"
}
```

### Command registration

When `registerCommand("help", handler)` is called, the router iterates all active instances and calls `instance.provider.registerCommand("help", handler)`. When a new instance is added later via `addInstance()`, all previously registered commands are replayed onto it. The router keeps a `registeredCommands: Map<string, CommandHandler>` for this replay.

### sendMessage routing

`sendMessage(userId, markdown, instanceId?)` routes to a specific instance when `instanceId` is provided. Without it, broadcasts to all instances (for super-admin announcements). This is a breaking change to the `ChatProvider` interface — the optional `instanceId` parameter is added to the `sendMessage` signature. Existing adapters ignore it (they only know their own instance); the router uses it for dispatch.

### Capabilities and traits

- `capabilities`: union of all instances' capabilities
- `traits`: not aggregated — handlers needing traits use `getInstanceTraits(instanceId)` via `platformInstanceId`

## Section 3: TaskProviderResolver

Replaces the current `buildProviderForUser()` function. Resolves the correct task provider from the context's assigned task instance.

### Interface

```typescript
interface TaskProviderResolver {
  resolve(contextId: string): TaskProvider | null
  resolveStrict(contextId: string): TaskProvider
}
```

No `userId` parameter. The `contextId` (storageContextId) is already the correct scope for both instance lookup and credential lookup — it's `userId` in DMs and `groupId` in groups.

### Resolution flow

1. Look up `context_settings` for `contextId` → get `taskInstanceId`
2. If no assignment → return null (needs `/setup`)
3. Look up `task_instances` for `taskInstanceId` → get instance `type` and `config` (base URL, workspace ID)
4. Look up credentials via `getConfig(contextId, ...)` — e.g., `kaneo_apikey` or `youtrack_token`
5. If credentials missing → return null (needs `/setup`)
6. Merge instance config + context credentials → `createProvider(type, mergedConfig)`

### Credential model

No changes to the existing `config.ts` / `user_config` table. Credentials are scoped by `storageContextId`:

- **DMs:** `getConfig(userId, 'kaneo_apikey')` → user's personal API key
- **Groups:** `getConfig(groupId, 'kaneo_apikey')` → group's shared API key

### What changes

- **`providers/factory.ts`** — deleted, replaced by `TaskProviderResolver`
- **`llm-orchestrator.ts`** — `deps.buildProviderForUser(contextId)` → `deps.resolve(contextId)`, `checkRequiredConfig()` becomes dynamic based on context's task instance type
- **`scheduler.ts`** — internal `buildProviderForUser()` replaced with `resolver.resolve(contextId)`
- **`deferred-prompts/poller.ts`** — `BuildProviderFn` becomes `(contextId: string) => TaskProvider | null`
- **`types/config.ts`** — `CONFIG_KEYS` module-level constant replaced by `getConfigKeysForContext(contextId)` function
- **`/setup` wizard** — gains a first step: "Select task provider instance" from available active instances

## Section 4: Admin Model

### Hierarchy

1. **Super-admin** — manages instances via dashboard, manages platform admins, can act as platform admin on any instance
2. **Platform admin** — manages users on their specific chat platform instance
3. **Group admin** — manages group-level settings (existing behavior, unchanged)

### Bootstrap

On first run, `ADMIN_USER_ID` env var creates:

- Super-admin entry: `(ADMIN_USER_ID, '__super__')`
- Platform admin entry: `(ADMIN_USER_ID, <bootstrapped-instance-id>)`

After bootstrap, `ADMIN_USER_ID` is ignored — `admins` table is the source of truth.

### Super-admin management

Exclusively through the dashboard. No chat commands for super-admin operations.

### Platform admin commands

Existing `/user add` and `/user remove` commands continue, scoped to the platform instance via `IncomingMessage.platformInstanceId`. Authorization check changes from string comparison to `isAdmin(userId, platformInstanceId)` — returns true for platform admins of that instance OR super-admins.

### User authorization

The `users` table gains a `platform_instance_id` column. Users are authorized per-instance — a user added on `mm-team-a` can't use `telegram-prod` unless separately added.

## Section 5: Dashboard Extensions

### New pages

**Platform Instances page:**

- Table: ID, type, status, created date
- "Add instance" form: type + ID + config (tokens, URLs)
- Per-instance actions: start, stop, remove
- "Apply changes" button: staged apply — DB changes only take effect on the ChatRouter when Apply is clicked
- Status indicator showing unapplied changes

**Task Instances page:**

- Same layout: table, add form, per-instance actions
- No "apply" needed — task instances are resolved on-demand per request
- Shows which contexts reference each instance

**Admin Management section:**

- List/add/remove super-admins
- Per platform instance: list/add/remove platform admins

### API endpoints

```
GET    /api/platform-instances
POST   /api/platform-instances              { id, type, config }
DELETE /api/platform-instances/:id
POST   /api/platform-instances/apply

GET    /api/task-instances
POST   /api/task-instances                   { id, type, config }
DELETE /api/task-instances/:id

GET    /api/admins
POST   /api/admins                           { userId, platformInstanceId? }
DELETE /api/admins/:userId/:instanceId
```

### Authentication

Localhost-only, trusting local access = super-admin (existing debug server model). Remote auth deferred.

### Config encryption

Platform instance configs (containing secrets) are encrypted in DB. Encryption key from `INSTANCE_CONFIG_KEY` env var; fallback to derived key if absent (logged as warning). Dashboard API never returns decrypted tokens — masked values only.

## Section 6: Bootstrap and Migration

### First-run behavior

**Empty DB + env vars present:**

1. Create platform instance `{type}-default` from `CHAT_PROVIDER` + provider-specific env vars, status `active`
2. Create task instance `{type}-default` from `TASK_PROVIDER` + provider-specific env vars, status `active`
3. Create super-admin + platform admin entries from `ADMIN_USER_ID`
4. Migrate existing `user_config`: for each user with credentials, create `context_settings` row pointing to the default task instance
5. Log: `"Bootstrapped from environment variables. DB is now the source of truth."`

**Non-empty DB:**

1. Skip env vars entirely — DB is source of truth
2. Load active platform instances, create ChatRouter, start normally

**Empty DB + no env vars:**

1. Start debug server unconditionally (not gated by `DEBUG_SERVER=true`)
2. Log: `"No instances configured. Use the dashboard to add platform and task instances."`
3. Bot runs but does nothing until instances are added

### Env var deprecation

After bootstrap, env vars are ignored. A notice is logged if both DB instances and env vars exist.

### Migration safety

Bootstrap is idempotent — if `platform_instances` has rows, env vars are never touched. Existing `user_config` rows are untouched.

## Section 7: Error Handling and Edge Cases

### Instance lifecycle errors

- **Chat instance fails to start:** Router catches error, sets status to `stopped`, returns error to dashboard. Other instances unaffected.
- **Chat instance disconnects at runtime:** Adapter's existing reconnection logic applies. If unrecoverable, router marks as `stopped`.
- **Task instance unreachable:** Existing error classification handles this — no change.

### Setup edge cases

- **Context without setup:** `resolve()` returns null → bot replies "needs /setup". Non-task features (memos, instructions, deferred prompts) still work.
- **Task instance removed with active references:** Dashboard warns about N contexts. If confirmed, `context_settings` rows deleted, contexts need `/setup` again.
- **Platform instance removed:** Apply stops gracefully (in-flight calls complete). `context_settings` rows for task instances are kept.

### Config key validation

- `/set` without task instance → only LLM keys and `timezone`
- `/set kaneo_apikey` on YouTrack context → rejected
- `/config` shows keys relevant to assigned task instance type

### Scheduler and poller resilience

If user's task instance removed, resolver returns null → scheduler skips task with warning. Recurring task stays in DB, resumes after re-setup.

## Section 8: Testing Strategy

### New test modules

- **`tests/instances/`** — instance CRUD, context_settings, bootstrap from env, idempotency
- **`tests/chat/router.test.ts`** — command fan-out, command replay, platformInstanceId injection, sendMessage routing, lifecycle, failure isolation
- **`tests/providers/resolver.test.ts`** — DM resolution, group resolution, missing settings, missing credentials, strict mode

### Modified test modules

- **`tests/bot.ts`** — `createDmMessage()`/`createGroupMessage()` gain `platformInstanceId` (default `'test-instance'`)
- **`tests/llm-orchestrator.test.ts`** — `deps.resolve` signature change
- **`tests/scheduler.test.ts`** and **`tests/deferred-prompts/poller.test.ts`** — provider build function signature change

### New test helpers

- `createTestPlatformInstance(overrides?)` — factory for platform instance rows
- `createTestTaskInstance(overrides?)` — factory for task instance rows
- `assignContextToTaskInstance(contextId, taskInstanceId)` — inserts context_settings
- `createTestRouter(instances?)` — ChatRouter with mock instances

### E2E

Existing E2E tests bootstrap a `kaneo-default` instance from env vars, continue working. Multi-instance E2E tests deferred.
