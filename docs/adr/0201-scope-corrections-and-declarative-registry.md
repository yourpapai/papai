<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0201: Scope Corrections and Declarative Registry

## Status

Implemented

## Date

2026-06-16

## Context

The papai scope model splits group chats into thread-isolated _live conversation_ state (history, short-term summary/facts) and group-shared _durable assets and config_. That split is mostly correct, but two concrete scope choices were wrong and one DX hazard made the whole model fragile.

First, **attachments were unreachable across sibling threads.** A file uploaded in thread A could not be listed or searched from thread B of the same group, because `list_files`/`search_staged_files` filtered on the exact thread-scoped `storageContextId`. Group members share one audience, so this was reuse friction with no privacy benefit.

Second, **the `web_rate_limit` quota was pooled per-group.** `makeWebFetchTool` was wired with the group-stripped `storageOwnerId` as the rate-limit actor, so one heavy user could starve the entire group's fetch budget and the limit did not actually bound an actor. The plumbing already supported a per-user actor (`actorId = input.actorUserId ?? input.storageContextId`); only the wiring was wrong.

Third, **effective scope was smeared across four hand-synced places** — the `threadScoped` flag in `CONTEXT_OWNED_COLUMNS`, the runtime strip helpers (`getStorageOwnerId`, `getConfigContextIdFromStorageContextId`), the migration-046 backfill allowlist, and `PARENT_SHARED_USER_CONFIG_KEYS`. This is what had mislabeled `user_identity_mappings` (effectively per-user), `web_rate_limit` (effectively per-group), and `memos`/`recurring_tasks`/`user_instructions` (effectively group) relative to their raw `threadScoped:true` flags. The 2026-06-16 spec (`docs/superpowers/specs/2026-06-16-cross-thread-memory-and-context-scope-design.md` §5–§6) is the source of truth for the architecture described here; this plan is "Plan 3 of 3" of that spec and was the last plan referencing it.

## Decision Drivers

- **Correctness of scope:** attachments and the web-fetch quota must reflect their real effective scope, not the raw column shape.
- **No privacy change:** group-wide attachment reads are safe because a group is one audience; DMs must stay unaffected.
- **Single source of truth:** effective scope should be declared once and mechanically enforced, not hand-synced across four files.
- **Minimal blast radius:** existing reads that filter on `status='active'` and exact `context_id` must keep working; the new column is additive and nullable.
- **Behavior-preserving refactor:** where scope is not intentionally changed, the registry is a routing change, not a semantic one.

## Considered Options

### Option A: Denormalized `group_context_id` column on attachments/staged_files (chosen)

- **Pros:** read widening is a single indexed `OR` predicate; populated once at ingest so every caller benefits without API changes; backfill is a one-time `UPDATE`; DM path is untouched (column stays `NULL`).
- **Cons:** a new nullable column + two indexes on hot tables; the column must be kept in sync with `context_id` at every write site.

### Option B: Runtime-only strip on read (no new column)

- **Pros:** no schema change; no denormalization to keep in sync.
- **Cons:** read queries cannot `OR` a derived group id against an indexed column without a full scan or a computed-column equivalent that SQLite does not support; would require stripping every row's `context_id` at query time, which is unindexed and slow on large tables.

### Option C: Declarative `ENTITY_SCOPES` registry reconciled by a consistency test (chosen)

- **Pros:** one registry declares effective scope and raw column behavior; a unit test fails if `rawThreadScoped` disagrees with `CONTEXT_OWNED_COLUMNS.threadScoped` or if any owned column is undeclared; new code routes through `getScopeKey`.
- **Cons:** the registry is a second declaration alongside `CONTEXT_OWNED_COLUMNS` until the latter is fully retired; the consistency test is the only thing preventing drift, so it must stay in the suite.

## Decision

Six coordinated changes implement the corrections and the registry.

### 1. Migration 057 — `group_context_id` columns

`src/db/migrations/057_attachment_group_context.ts` adds nullable `group_context_id TEXT` to `attachments` and `staged_files`, plus `idx_attachments_group(group_context_id, is_active)` and `idx_staged_group(group_context_id, status)`. `columnExists` guards make it idempotent. Registered in `src/db/index.ts` as `migration057AttachmentGroupContext`.

### 2. Drizzle schema columns

`src/db/attachments-schema.ts` and `src/db/staged-schema.ts` each gain `groupContextId: text('group_context_id')` placed after `contextId`.

### 3. Populate at ingest

`group_context_id` is computed at the lowest write point via `getConfigContextIdFromStorageContextId(contextId)` so all callers benefit without API changes: `saveAttachment` in `src/attachments/store.ts` and the staged insert in `src/attachments/staged.ts`. Writes stay thread-scoped (`context_id` keeps the full `storageContextId`); only the denormalized parent is recorded.

### 4. Group-discoverable reads (group contexts only)

`listActiveAttachments` (`src/attachments/workspace.ts`) and `searchStagedFiles` (`src/attachments/staged.ts`) accept an optional `{ groupContextId }` and widen the `where` to `context_id = current OR group_context_id = <group>` when present. `resolveStagedFile` is unchanged — it requires an exact `stagedId`, so group widening does not apply. `src/tools/workspace-files.ts` (`makeListFilesTool`) and `src/tools/staged-tools.ts` (`makeSearchStagedFilesTool`) thread the group id through. `src/tools/provider-independent-tools-builder.ts` computes `groupReadContextId` only when `contextType === 'group'` and `contextId` is defined, passing it to the file tools inside the `isS3Configured()` block; DMs never widen.

### 5. `web_fetch` quota → per-user

`provider-independent-tools-builder.ts` wires `makeWebFetchTool(contextId, chatUserId, contextType)` instead of the group-stripped `storageOwnerId`. The rate-limit primitive was already per-actor-id; the change is which id the tool passes. Window-based rows age out; no migration.

### 6. Declarative `ENTITY_SCOPES` registry + consistency test

`src/chat/context-scope.ts` exports `EffectiveScope` (`'thread' | 'group' | 'group+threadOverride' | 'user'`), `EntityScope` (with `scope` and `rawThreadScoped`), `ScopeKeyContext`, `getScopeKey(scope, ctx)`, and `ENTITY_SCOPES` — the single source of truth for every context-owned entity's effective scope and raw column behavior. `getScopeKey('group', …)` resolves to `getConfigContextIdFromStorageContextId(storageContextId)`; `'thread'` returns the full storage id; `'user'` returns `chatUserId`; `'group+threadOverride'` strips the thread (reserved for the deferred per-thread `user_instructions` override, base behavior unchanged).

`getStorageOwnerId` in `provider-independent-tools-builder.ts` is reimplemented to delegate to `getScopeKey('group', …)`, routing the thread strip through the single source of truth (behavior-identical for its three consumers: memos, recurring tasks, instructions).

`tests/chat/context-scope-consistency.test.ts` reconciles the registry against `CONTEXT_OWNED_COLUMNS`: `rawThreadScoped` must match `threadScoped` for every shared `(table, column)`; every effective-`thread` entity must be `rawThreadScoped`; every `CONTEXT_OWNED_COLUMNS` entry must be declared in the registry. A mismatch is the test doing its job — the registry is reconciled, not silenced.

## Consequences

### Positive

- Attachments uploaded in one group thread are listable and searchable from sibling threads of the same group; cross-thread file reuse friction is gone with no privacy change.
- The `web_fetch` quota now bounds the actual actor, so one heavy user cannot starve a group's fetch budget.
- Effective scope is declared once in `ENTITY_SCOPES`; the consistency test makes a silent mislabel impossible — a declared `group` entity can no longer carry `threadScoped:true` without failing the suite.
- New code has a single resolver (`getScopeKey`) instead of ad-hoc strips scattered across the codebase.
- All changes are additive and behavior-preserving outside the two intentional corrections; existing `status='active'` / exact-`context_id` reads are unaffected.

### Negative

- A new nullable `group_context_id` column and two indexes land on `attachments` and `staged_files`; the column must be populated at every future write site or the group-read widening silently misses rows.
- The registry is a second declaration alongside `CONTEXT_OWNED_COLUMNS` until the latter is fully retired; drift is prevented only by the consistency test staying in the suite.
- `resolveStagedFile` keeps exact-match semantics, so the staged-file _resolution_ path (as opposed to _search_) remains thread-scoped by design — a deliberate asymmetry callers must remember.

### Risks

- A future write site that forgets to set `group_context_id` will produce rows invisible to group-widened reads; the consistency test covers the registry, not column population at arbitrary new call sites.
- Full migration of all `getConfigContextIdFromStorageContextId` call sites to `getScopeKey` was intentionally out of scope; Task 6 wires only the generic `getStorageOwnerId` helper and establishes enforcement so new code uses `getScopeKey` going forward.

## Related Decisions

- ADR-0161: Storage Context Sharing (Group Thread Entities) — the thread-vs-group split this registry codifies.
- ADR-0193: Long-Term Memory — the group-shared durable fact store whose scope model this registry reconciles.
- ADR-0199: Memory Foundation — Provisional Store, Capture, and Semantic Search — the cross-thread memory bridge (Plans 1–2 of the same spec) whose scope corrections land here.
- ADR-0200: Recall Cascade and Promotion — the `search_memory`/`recall` cascade that depends on consistent scope resolution.

## Implementation Notes

Key files confirming the architecture is in place:

- `src/db/migrations/057_attachment_group_context.ts` — adds `group_context_id` to `attachments` + `staged_files` with indexes; registered as `migration057AttachmentGroupContext` in `src/db/index.ts`.
- `src/db/attachments-schema.ts`, `src/db/staged-schema.ts` — `groupContextId` Drizzle columns.
- `src/attachments/store.ts` — `saveAttachment` populates `groupContextId` via `getConfigContextIdFromStorageContextId`; `listActiveAttachments` accepts `{ groupContextId }` and widens the `where` with `or(...)`.
- `src/attachments/staged.ts` — staged insert populates `groupContextId`; `searchStagedFiles` widens via the `buildStagedScopeCondition` helper (a refactor of the plan's inline `or(...)`, behavior-identical); `resolveStagedFile` unchanged.
- `src/attachments/workspace.ts` — `listActiveAttachments(contextId, { groupContextId? })` widens the read for group contexts.
- `src/tools/workspace-files.ts`, `src/tools/staged-tools.ts` — `makeListFilesTool` / `makeSearchStagedFilesTool` forward the group id.
- `src/tools/provider-independent-tools-builder.ts` — computes `groupReadContextId` for group contexts; wires `web_fetch` with `chatUserId`; `getStorageOwnerId` delegates to `getScopeKey('group', …)`.
- `src/chat/context-scope.ts` — `EffectiveScope`, `EntityScope`, `ScopeKeyContext`, `getScopeKey`, `ENTITY_SCOPES`.
- `tests/chat/context-scope.test.ts` — `getScopeKey` per-scope unit test.
- `tests/chat/context-scope-consistency.test.ts` — reconciles `ENTITY_SCOPES.rawThreadScoped` against `CONTEXT_OWNED_COLUMNS.threadScoped` and asserts full declaration.
