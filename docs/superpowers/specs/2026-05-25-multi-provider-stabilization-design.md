<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Stabilization Design

**Date:** 2026-05-25
**Status:** Draft
**Parent:** [`2026-04-13-multi-provider-router-design.md`](./2026-04-13-multi-provider-router-design.md)

## Summary

Stabilize the implemented multi-provider router by closing the remaining cross-instance isolation, data-loss, and runtime-routing gaps found during review. The central invariant is: every runtime or persisted operation is either explicitly global, or it is scoped by the source `platformInstanceId` plus the platform-native context identifier.

This spec covers six findings:

- Critical: raw context/storage keys can collide across platform instances.
- High: Telegram and Mattermost staged file downloads use process-global fetchers.
- High: `/user remove` can delete recurring-task data for the same user ID on another platform instance.
- High: duplicate username placeholders can break first-login authorization.
- Medium-High: Kaneo auto-provisioning still reads env URLs instead of the assigned task instance config.
- Medium-High: proactive delivery can target stopped chat instances.

## Severity Re-Evaluation

### Critical: context and storage key collisions

Multi-provider support requires separate identities per platform. Current storage paths still use raw `contextId`, `userId`, or `groupId` for `user_config`, conversation history, memory, `context_settings`, authorized groups, and group members. If two active platform instances emit the same native ID, one user or group can see another instance's memory, config, authorization, task assignment, or delivery route. This is a cross-tenant isolation issue and is release-blocking.

### High: process-global attachment fetchers

Telegram and Mattermost staged downloads use one singleton fetcher per provider type. In a multi-instance process, the last constructed or started instance wins. This can fail downloads or attempt file fetches through another instance's credentials. It is high severity because files are user content and attachment relay is a supported task workflow.

### High: recurring-task deletion crosses platform scope

`removeUser(identifier, platformInstanceId)` deletes the scoped `users` row, then deletes recurring tasks by raw `platform_user_id`. Same user IDs on different platform instances can lose unrelated recurring task templates and occurrences. This is high severity data loss.

### High: duplicate username placeholders

`/user add @alice` creates random placeholder IDs. Without a unique `(platform_instance_id, username)` constraint or idempotent placeholder reuse, repeated adds can create multiple rows. First real login then updates every matching username row to the same `(platform_instance_id, platform_user_id)` primary key and can fail authorization. This is high severity because a normal admin action can create a persistent login failure.

### Medium-High: Kaneo provisioning source of truth

Auto-provisioning checks context assignment but still reads `KANEO_CLIENT_URL` / `KANEO_INTERNAL_URL`. DB-managed instances are intended to be the runtime source of truth after bootstrap, and multiple Kaneo instances may coexist. This is not usually a data leak, but it breaks DB-only and multi-instance provisioning.

### Medium-High: stopped-instance proactive delivery

Proactive delivery currently checks instance existence, not active status. Deferred prompts, recurring notifications, and announcements can spend LLM/task work and then fail delivery against stopped adapters. This is medium-high operational risk and cost leakage.

## Goals

- Make storage and authorization context IDs platform-instance-safe.
- Preserve existing single-instance data through deterministic migration.
- Route staged attachment downloads through the exact source chat instance.
- Prevent scoped user removal from touching data owned by another platform instance.
- Make username placeholder authorization idempotent per platform instance.
- Make Kaneo provisioning use assigned task instance config.
- Skip proactive sends unless the router target is active.

## Non-Goals

- Cross-platform account linking.
- Redesigning plugin storage schema.
- Replacing every historical table key that is intentionally global.
- Changing the public `ChatProvider` or `TaskProvider` interfaces beyond small helper methods needed for safe routing.
- Building new dashboard UX beyond exposing errors that already pass through existing routes.

## Architecture

### Scoped Context Identity

Introduce a small identity helper in `src/chat/scoped-context.ts`:

```typescript
type PlatformScopedContext = {
  platformInstanceId: string
  nativeContextId: string
}

function toScopedContextId(input: PlatformScopedContext): string
function toScopedThreadContextId(input: PlatformScopedContext & { threadId?: string }): string
```

The encoded value must be deterministic, reversible enough for diagnostics, and safe for existing text primary keys. Use a delimiter format that cannot collide with current thread IDs by escaping components, for example `pi:<encodedPlatformInstanceId>:ctx:<encodedNativeContextId>` and `...:thread:<encodedThreadId>`.

All new storage context IDs passed to config, history, memory, context settings, group auth, group members, recurring/deferred setup, and tool resolution use this helper. Message display and provider API calls continue to use native IDs.

### Migration Strategy

Add a migration that backfills single-instance legacy rows into scoped IDs when the mapping is unambiguous:

1. If exactly one platform instance exists, rewrite legacy raw context IDs to the scoped form for tables that store context-owned state.
2. If multiple platform instances exist and a legacy row cannot be attributed, preserve it unchanged and log or expose an operator-visible warning through tests/logging. Do not guess.
3. Do not mutate plugin tables directly. Plugins remain keyed by the storage context ID supplied by runtime paths; once runtime paths emit scoped IDs, plugin context state follows naturally for new and migrated contexts.

Candidate tables for migration and runtime updates:

- `context_settings.context_id`
- `user_config.user_id`
- `conversation_history.user_id`
- `memory_summary.user_id`
- `memory_facts.user_id`
- `authorized_groups.group_id`
- `group_members.group_id`
- `recurring_tasks.user_id`, because current code treats it as the owning storage context for scheduled recurrence ownership
- `scheduled_prompts.created_by_user_id` and `scheduled_prompts.delivery_context_id`
- `alert_prompts.created_by_user_id` and `alert_prompts.delivery_context_id`
- `task_snapshots.user_id`; external provider task IDs in `task_snapshots.task_id` are not rewritten

### Runtime Context Flow

`checkAuthorizationExtended()` and helper functions must receive or derive `platformInstanceId` when computing `storageContextId` and `configContextId`. DMs use the scoped user ID. Groups use the scoped group ID, plus scoped thread ID when thread storage is enabled.

Command handlers that need native provider IDs continue reading `msg.contextId`. Code that persists context-owned state uses `auth.storageContextId` or `auth.configContextId` after those values become scoped.

### Attachment Download Routing

Staged file metadata must carry enough source-instance information to select the exact downloader. Required shape:

```typescript
type StagedFileRef = {
  sourceProvider: AttachmentSourceProvider
  sourcePlatformInstanceId: string
  platformFileId: string
}
```

Telegram and Mattermost adapters must expose instance-local file download through the provider object or a router helper, not global singleton state. The staged downloader resolves `(sourcePlatformInstanceId, sourceProvider)` through `ChatRouter.getInstance(id)` and calls that instance's fetcher. If the instance is missing or stopped, return `null` and log a warning.

Discord currently does not create file candidates, so no Discord staged downloader is required.

### Scoped User Removal

User removal must delete only data owned by the specific `(platformInstanceId, platformUserId)` row. Recurring task cleanup must be constrained to scoped context ownership, not raw user ID alone.

`recurring_tasks.user_id` currently stores the owning storage context ID. The fix must migrate existing single-instance values to scoped IDs, write scoped IDs for all new rows, and delete recurring rows by scoped ID only.

### Username Placeholder Idempotency

Enforce one username placeholder per platform instance:

- Add a partial unique SQLite index on `(platform_instance_id, username)` where `username IS NOT NULL`.
- Make `/user add @username` idempotent: if a placeholder or resolved row already exists for `(platformInstanceId, username)`, reuse it and report authorized instead of inserting a new placeholder.
- Make `resolveUserByUsername()` update exactly one placeholder row and handle already-resolved rows without broad updates.

Before adding the unique constraint, migration must deduplicate duplicate placeholders deterministically, preferring non-placeholder real user rows over placeholders, then oldest placeholder over newer placeholders.

### Kaneo Provisioning

Change provisioning orchestration so assigned task instance config supplies the external URL and optional internal URL. Proposed instance config keys:

- `url` or `baseUrl`: user-facing Kaneo URL.
- `internalUrl`: optional internal bot-to-Kaneo URL.

`maybeProvisionKaneo(contextId)` already loads the assigned active Kaneo task instance. It must pass that config into `provisionAndConfigure()`. Env values may remain bootstrap inputs only; runtime provisioning must not require `KANEO_CLIENT_URL`.

### Proactive Delivery Guard

Add `ChatRouter.isInstanceActive(platformInstanceId)`. `resolveProactivePlatformInstanceId()` returns `null` unless the target instance exists and `isInstanceActive()` returns true.

Unknown or stopped targets should log and skip without running delivery. Scheduler/poller behavior should keep rows in place so reactivation can resume delivery.

## Data Flow

1. Adapter receives a native message and sets `platformInstanceId` plus native `contextId`.
2. Bot authorization computes scoped storage/config IDs from `platformInstanceId`, native context ID, and optional thread ID.
3. Setup writes `context_settings` under the scoped context ID.
4. Resolver, config, memory, group membership, recurring tasks, deferred prompts, plugins, and tool assembly read the scoped context ID.
5. Provider API calls and replies continue using native IDs from the incoming message or persisted delivery target.
6. Proactive delivery resolves scoped context settings to `platformInstanceId`, verifies active runtime instance, then sends to the native delivery target through the router.

## Error Handling

- Missing scoped context assignment: keep existing setup guidance behavior.
- Ambiguous migration rows: preserve row, log warning, and do not guess a platform instance.
- Duplicate username rows during migration: deduplicate deterministically and retain at most one row per `(platform_instance_id, username)`.
- Missing attachment source instance: skip download and log `WARN` with instance ID and source provider.
- Stopped proactive target: skip delivery and log `WARN` with target context and platform instance.
- Kaneo task instance missing URL: provisioning returns failed outcome with a clear setup/admin message.

## Testing Strategy

- Scoped identity unit tests for stable encoding, thread scoping, and delimiter safety.
- Migration tests for single-instance backfill, ambiguous multi-instance preservation, duplicate username deduplication, and scoped group/context tables.
- Auth and bot tests proving two platform instances with the same native user/group IDs do not share config, history, group membership, or context settings.
- Resolver/setup tests proving context assignments use scoped IDs while provider calls still use native IDs.
- Attachment tests proving Telegram/Mattermost staged downloads select the source instance and do not use global fetchers.
- User tests proving `/user remove` deletes recurring data only for the scoped platform instance.
- Username tests proving repeated `/user add @name` is idempotent and first login updates exactly one row.
- Kaneo provisioning tests proving runtime provisioning uses task instance `url/baseUrl/internalUrl` and does not require `KANEO_CLIENT_URL` after bootstrap.
- Proactive delivery tests proving stopped or missing router instances are skipped before send.
- Run focused suites plus `bun typecheck`, `bun lint:agent-strict` on touched files, and the curated `bun test` if the migration touches shared schemas.

## Rollout Notes

This should ship before declaring multi-provider support complete. The highest-risk implementation area is data migration: tests must cover existing single-instance deployments and already-partial multi-provider DBs. If the migration cannot safely attribute a row, preserving it is safer than assigning it to the wrong platform instance.

## Completeness Target

After this stabilization work, multi-provider support should meet the approved router design's core isolation and routing requirements. Remaining work, if any, should be limited to dashboard polish or provider-specific feature parity rather than correctness blockers.
