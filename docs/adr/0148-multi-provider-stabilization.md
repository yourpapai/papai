<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0148: Multi-Provider Stabilization

## Status

Implemented

## Date

2026-05-25 – 2026-06-02

## Context

After the multi-provider router (ADR-0124 through ADR-0128) shipped, review
revealed six cross-instance isolation, data-loss, and wrong-instance routing
gaps that must close before multi-provider support is considered complete:

1. **Critical** — Raw context/storage keys (`user_config`, `conversation_history`,
   `memory_summary`, `memory_facts`, `context_settings`, `authorized_groups`,
   `group_members`, `recurring_tasks`, deferred prompts, `task_snapshots`,
   plugin context state) can collide across platform instances. Two active
   instances emitting the same native ID can see each other's memory, config,
   authorization, or delivery routes — a cross-tenant isolation defect.

2. **High** — Telegram and Mattermost staged file downloads use process-global
   singleton fetchers. The last-constructed or last-started instance wins,
   causing downloads to fail or fetch through another instance's credentials.

3. **High** — `/user remove` deletes recurring-task data by raw
   `platform_user_id`, which can destroy recurring templates for the same user
   ID on another platform instance.

4. **High** — Repeated `/user add @username` creates duplicate placeholder rows.
   First real login then updates every matching row to the same primary key,
   breaking authorization.

5. **Medium-High** — Kaneo auto-provisioning reads `KANEO_CLIENT_URL` from env
   instead of the assigned task instance config, breaking DB-only and
   multi-Kaneo-instance provisioning.

6. **Medium-High** — Proactive delivery checks instance existence but not
   active status, wasting LLM/task work on stopped adapters.

The central invariant: every runtime or persisted operation is either
explicitly global, or it is scoped by `platformInstanceId` plus the
platform-native context identifier.

## Decision Drivers

- **Isolation correctness**: Same native IDs on different platform instances
  must never share storage, config, or authorization state.
- **Data safety**: Migration must not lose or misattribute existing rows;
  ambiguous rows are preserved, not guessed.
- **Instance-local routing**: Staged downloads and proactive delivery must
  route through the exact source or target instance, not global singletons.
- **Backward compatibility**: Single-instance deployments must work unchanged
  after migration.
- **Minimal interface changes**: No large `ChatProvider`/`TaskProvider` interface
  redesigns beyond small routing helpers.

## Considered Options

### Option A: Namespace tables by adding `platform_instance_id` columns everywhere

Add a `platform_instance_id` foreign key to every context-owned table and
enforce composite uniqueness.

- **Pros**: Relational integrity; queryable without decoding.
- **Cons**: Pervasive schema change; every query site needs a new column;
  migration complexity is very high; composite keys everywhere.

### Option B: Scoped context ID encoding (chosen)

Introduce a deterministic `platformInstanceId + nativeContextId` composite
encoded into the existing text primary key. Format:
`pi:<base64url(platformInstanceId)>:ctx:<base64url(nativeContextId)>`, with an
optional `:thread:<base64url(threadId)>` suffix.

- **Pros**: No schema column additions for context-owned tables; existing
  text primary keys absorb the new scope naturally; single-instance migration
  is a deterministic value rewrite.
- **Cons**: Encoded keys are less human-readable; decoding needed for
  diagnostics; migration must backfill existing rows.

### Option C: Hybrid — scoped IDs for new rows, dual-read for legacy

Write scoped IDs going forward, read both scoped and raw at runtime until
legacy rows are gone.

- **Pros**: No migration downtime.
- **Cons**: Dual-read paths are complex and error-prone; hard to know when
  legacy rows are truly gone; testing surface doubles.

## Decision

**Option B** for storage identity, with these subsidiary decisions:

| Topic                    | Decision                                                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scoped context helper    | `src/chat/scoped-context.ts` exports `toScopedContextId()` and `toScopedThreadContextId()`. Base64url-encoded components with `pi:`/`:ctx:`/`:thread:` delimiters.                 |
| Migration strategy       | Migration `043_scoped_context_ids` rewrites legacy rows when exactly one platform instance exists. Ambiguous multi-instance rows are preserved unchanged.                          |
| Auth runtime contract    | `checkAuthorizationExtended()` receives `platformInstanceId` and computes `storageContextId`/`configContextId` using the scoped helper.                                            |
| Command storage          | Group auth and membership use `auth.configContextId` for persistence; provider label rendering keeps native `msg.contextId`.                                                       |
| Attachment routing       | Staged file metadata carries `sourcePlatformInstanceId`. `ChatRouter.downloadFileFromInstance()` routes to the exact adapter instance.                                             |
| User cleanup             | `removeUser()` deletes recurring tasks by scoped owner context ID only. Same user on another instance is untouched.                                                                |
| Username idempotency     | Partial unique index on `(platform_instance_id, username) WHERE username IS NOT NULL`. `addUser()` reuses existing placeholder; `resolveUserByUsername()` updates exactly one row. |
| Kaneo provisioning       | `maybeProvisionKaneo()` derives URLs from the assigned task instance config, not env. Env remains a bootstrap-only input.                                                          |
| Proactive delivery guard | `ChatRouter.isInstanceActive()` checks managed instance status. Stopped targets are skipped before send; rows remain for reactivation.                                             |

## Consequences

### Positive

- Cross-tenant isolation: same native IDs on different platform instances
  cannot see each other's storage, config, or authorization.
- Single-instance deployments migrate deterministically with no data loss.
- Staged attachment downloads route through the correct credentials.
- User removal no longer deletes recurring data belonging to another instance.
- Username placeholder idempotency prevents authorization breakage from
  repeated admin adds.
- Kaneo provisioning works in DB-only multi-instance configurations.
- Proactive delivery avoids wasted work on stopped adapters.

### Negative

- Encoded scoped IDs are less human-readable in logs and DB inspection.
- Migration is a one-way value rewrite; rollback requires a separate
  down-migration.
- Every new storage call site must use the scoped helper; forgetting to do so
  reintroduces the isolation gap.
- Partial unique index on usernames is SQLite-specific.

### Risks

- If a future code path writes a raw context ID instead of a scoped one, the
  isolation guarantee silently breaks. Mitigation: `toScopedContextId()` is
  the single entry point; migration normalizes legacy data.
- Multi-instance deployments with ambiguous legacy data must be manually
  inspected before relying on the scoped rows. The migration preserves
  unattributable rows unchanged and logs a warning.

## Implementation Notes

Key modules:

| File                                         | Role                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/chat/scoped-context.ts`                 | `toScopedContextId()`, `toScopedThreadContextId()` — canonical scoped ID encoder  |
| `src/db/migrations/043_…`                    | Single-instance backfill, staged file source column, username dedup, unique index |
| `src/auth.ts`                                | `getThreadScopedStorageContextId()` platform-aware overload                       |
| `src/attachments/staged.ts`                  | Persists and reads `sourcePlatformInstanceId`                                     |
| `src/attachments/staged-download.ts`         | Routes downloads through `ChatRouter.downloadFileFromInstance()`                  |
| `src/chat/router.ts`                         | `isInstanceActive()`, `downloadFileFromInstance()`                                |
| `src/users.ts`                               | Scoped removal, username idempotency                                              |
| `src/providers/kaneo/provision.ts`           | `ProvisionConfig` explicit URL input, task-instance-derived config                |
| `src/deferred-prompts/proactive-delivery.ts` | Active-instance guard before send                                                 |

Integration points: `src/bot.ts` (auth call sites), `src/commands/group.ts`
(storage context), `src/setup/task-instance-selection.ts` (scoped context
IDs), `src/bot-attachments.ts` (source instance propagation), adapter
`downloadFile()` methods on Telegram/Mattermost providers.

## Related Decisions

- ADR-0124: Multi-Provider Phase 1 — Instance Data Model
- ADR-0125: Multi-Provider Phase 2 — Task Provider Resolver
- ADR-0126: Multi-Provider Phase 3 — Chat Router
- ADR-0127: Multi-Provider Phase 4 — Admin and Dashboard
- ADR-0128: Multi-Provider Phase 5 — Plugin Alignment
- ADR-0009: Multi-Provider Task Tracker Support — provider capability model
