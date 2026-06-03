<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0161: Storage Context Sharing (Group Thread Entities)

## Status

Implemented

## Date

2026-05-28 – 2026-06-02

## Context

papai uses `storageContextId` to scope per-conversation state in SQLite. Group
threads (e.g. Telegram forum topics, Mattermost thread replies) receive a
scoped identifier like `group:thread:<id>`, which is distinct from the parent
group context `group:<id>`. Before this change, every entity created in a group
thread — including durable shared entities like memos, recurring tasks,
instructions, and deferred prompts — was stored under the thread-scoped ID.

This caused two problems:

1. **Duplicate configuration effort**: An instruction saved in a group thread
   was invisible to other threads in the same group. The same memo, recurring
   task, or instruction had to be recreated per thread.
2. **Inconsistent tool exposure**: Tool preferences, MCP endpoints, and plugin
   prompt fragments were read from the thread context, so a tool disabled for
   the parent group could still appear in a thread turn.

Meanwhile, conversation-local data — LLM history, memory summaries/facts,
attachments, staged files, message metadata, and usage telemetry — must remain
thread-isolated so threads maintain independent conversation state.

The existing `getConfigContextIdFromStorageContextId()` resolver already stripped
the thread suffix to produce a parent group config context ID. The decision was
to reuse this resolver as the canonical owner key for durable group-level
entities while preserving the thread-scoped `storageContextId` for
conversation-local state.

## Decision Drivers

- **Shared group intent**: Memos, instructions, and recurring tasks created in a
  thread reflect group-level intent and should be visible group-wide.
- **Thread conversation independence**: Each thread must retain its own LLM
  history, memory, attachments, and metadata.
- **Minimal abstraction**: Reuse the existing parent-context resolver rather
  than introducing a new ownership layer.
- **Migration safety**: Existing thread-owned durable rows must be promoted to
  the parent group without data loss or duplicate-key conflicts.
- **Deferred prompt delivery fidelity**: A prompt created in a thread must still
  deliver back to that thread even after its ownership key moves to the parent.

## Considered Options

### Option A: Full context unification (no thread scope for any entity)

Use the parent group context ID for all storage, including history and memory.

- **Pros**: Simplest model; no per-entity scoping logic.
- **Cons**: Thread conversations would share LLM history and memory, destroying
  thread isolation. Unacceptable UX regression.

### Option B: Per-entity ownership split (chosen)

Use the parent group context as the owner key for durable shared entities and
the thread context for conversation-local state.

- **Pros**: Shared group intent preserved; thread conversation independence
  maintained; reuses existing resolver; small, focused migration.
- **Cons**: Two ownership paths in the tool builder; future developers must know
  which entities are shared vs thread-local.

### Option C: Duplicate storage with sync layer

Write durable entities under both thread and parent contexts with a sync
mechanism.

- **Pros**: Backwards-compatible reads from either context.
- **Cons**: Sync layer is complex and error-prone; duplicates storage; no clear
  source of truth.

### Option D: Thread-only with cross-thread query

Keep thread-scoped ownership but add queries that search across sibling threads
of the same parent group.

- **Pros**: No ownership migration; no write-path changes.
- **Cons**: Expensive cross-thread queries on every read; no single owner for
  deduplication; deferred prompts become ambiguous.

## Decision

**Option B** with the following subsidiary decisions:

| Topic                        | Decision                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable shared entities      | `user_instructions`, `memos`, `recurring_tasks`, `plugin_context_state`, `plugin_kv` owned by parent group context.                                                       |
| Deferred prompt ownership    | `scheduled_prompts.created_by_user_id` and `alert_prompts.created_by_user_id` move to parent; `delivery_context_id` stays thread-scoped.                                  |
| Thread-isolated entities     | `conversation_history`, `memory_summary`, `memory_facts`, `attachments`, `staged_files`, `message_metadata`, `llm_usage_events`, `tool_call_events` remain thread-scoped. |
| Tool builder routing         | `src/tools/tools-builder.ts` uses `getConfigContextIdFromStorageContextId()` as the owner for durable tools; attachment/history/staged tools keep the raw thread context. |
| Tool preferences             | `src/tools/index.ts` evaluates `tool_prefs` against the parent group context for thread turns.                                                                            |
| System prompt                | `src/system-prompt.ts` loads instructions, tool preference unavailability line, and plugin prompt fragments from parent group context.                                    |
| LLM orchestrator             | `src/llm-orchestrator.ts` reads AI output visibility settings from parent group context.                                                                                  |
| Web fetch quota              | Rate-limit actor uses parent group context so a thread cannot bypass group-level quotas.                                                                                  |
| MCP and plugin tool assembly | `src/tools/index.ts` resolves MCP endpoints and plugin eligibility against parent group context.                                                                          |
| Migration                    | `044_parent_shared_context_entities` promotes existing thread-owned durable rows; plugin tables resolve parent-key conflicts by keeping the parent row.                   |

## Consequences

### Positive

- Memos, instructions, and recurring tasks created in any thread are visible
  group-wide; no per-thread duplication needed.
- Tool preferences, MCP endpoints, and plugin settings inherit from the parent
  group, ensuring consistent tool exposure across threads.
- Web fetch quotas are enforced at the group level, preventing per-thread quota
  bypass.
- Deferred prompts still deliver to their origin thread, preserving per-thread
  notification fidelity.
- No new storage abstractions; reuses the existing parent-context resolver.

### Negative

- The tool builder now has two ownership paths (shared owner vs thread-local);
  future developers must consult the scope rules to determine which context a
  given tool uses.
- Migration `044` must handle parent-key conflicts for plugin tables where both
  a thread row and a parent row already exist.
- Thread-scoped custom instructions created before migration are promoted to
  the parent group, which may change their visibility intent.

### Risks

- If a future entity is added without consulting the scope rules, it may
  accidentally use the wrong ownership context.
- Mitigation: the scope rules are documented in the migration, tool builder,
  and this ADR; the two-path pattern in `tools-builder.ts` makes the split
  explicit.

## Implementation Notes

Key changes:

| File                         | Change                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/tools/tools-builder.ts` | Routes durable tool factories to parent group context via `getConfigContextIdFromStorageContextId()`; keeps attachment/staged/history tools on thread context. |
| `src/tools/index.ts`         | Evaluates tool preferences, MCP endpoints, and plugin eligibility against parent group context for thread turns.                                               |
| `src/system-prompt.ts`       | Loads instructions, tool preference unavailability line, and plugin prompt fragments from parent group context.                                                |
| `src/llm-orchestrator.ts`    | Reads AI output visibility settings from parent group context; exports `resolveAiOutputSettingsContextId`.                                                     |
| `src/db/migrations/044_*.ts` | Promotes thread-owned durable rows to parent group; resolves plugin table conflicts by keeping parent rows.                                                    |

Scope rules after this change:

- **Thread-isolated**: `conversation_history`, `memory_summary`, `memory_facts`,
  `attachments`, `staged_files`, `message_metadata`, `llm_usage_events`,
  `tool_call_events`.
- **Shared at parent group**: `user_instructions`, `memos`, `recurring_tasks`,
  `scheduled_prompts.created_by_user_id`, `alert_prompts.created_by_user_id`,
  `plugin_context_state`, `plugin_kv`, `web_rate_limit.actor_id`, tool
  preferences, MCP endpoints, AI output settings, plugin config.

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — plugin context state and KV are among
  the entities promoted by migration `044`.
- ADR-0009: Multi-Provider Task Tracker Support — provider capability model
  inherited through the parent context by thread turns.
- ADR-0014: Multi-Chat Provider Abstraction — chat provider context scoping
  that introduced the `group:thread:` storage context pattern.
