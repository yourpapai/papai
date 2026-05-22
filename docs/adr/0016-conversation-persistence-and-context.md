<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0016: Conversation Persistence and Context Management (Phase 03)

## Status

Accepted

## Date

2026-03-20

## Context

papai is a conversational bot that manages tasks over potentially long sessions. Without persistence, every bot restart or cache eviction wiped the conversation, forcing users to re-explain their context. With long conversations (50+ messages), the LLM's context window became a bottleneck, and the cost of sending the full history on every request grew prohibitively.

The infrastructure — SQLite tables for `conversation_history`, `memory_summary`, and `memory_facts`, plus in-memory caching with write-back — was substantially built in prior work. The outstanding gaps identified in Phase 03 were correctness and coverage issues rather than net-new features:

- The history cache had no "loaded" guard, causing redundant DB queries for users with empty history
- `buildMemoryContextMessage` and `TRIM_PROMPT` in `src/memory.ts` hardcoded "Kaneo" in strings injected into the LLM's context, producing incorrect branding for YouTrack users
- `extractFactsFromSdkResults` skipped read tools (`get_task`, `list_projects`), so entities accessed only via reads were forgotten after cache eviction
- `src/conversation.ts` had no unit tests for `shouldTriggerTrim`, `buildMessagesWithMemory`, or `runTrimInBackground`
- No acceptance-criteria-level tests verified the end-to-end persistence round-trip

## Decision Drivers

- A service restart must not cause visible memory loss for the user
- Users must be able to reference entities from earlier in the same session and across sessions
- The LLM context window cost must be bounded; unbounded history is not viable
- Memory layer strings injected into LLM prompts must be provider-neutral
- All non-trivial functions must have unit test coverage before the phase closes

## Considered Options

### Option 1: SQLite-backed history + in-memory cache with lazy DB load and write-back (chosen)

- **Pros**: Survives restarts; fast read path (in-memory after first load); write-back via `queueMicrotask` keeps the hot path non-blocking; well-understood persistence model
- **Cons**: Cache invalidation must be managed carefully (e.g., `history_loaded` flag must be cleared on `clearHistory`); in-memory state is lost on restart (by design, DB is the source of truth)

### Option 2: Load history from DB on every `processMessage` call (no in-memory cache)

- **Pros**: Always consistent; no cache invalidation complexity
- **Cons**: Unacceptable latency on every message; SQLite I/O on every turn defeats the purpose of the in-memory layer

### Option 3: External persistent store (Redis, Postgres)

- **Pros**: Horizontally scalable; survives process crashes cleanly
- **Cons**: Adds operational complexity; papai is designed as a single-process Bun application; SQLite is sufficient for the deployment model

### Option 4: Sliding window trim without LLM summarisation

- **Pros**: Simpler implementation
- **Cons**: Drops exact message text that may contain important context; LLM-assisted summarisation preserves semantic content that a sliding window discards

## Decision

The existing architecture is confirmed and the following gaps are closed:

1. **G1 (history cache guard)**: Add a `history_loaded` flag to `cache.config` in `getCachedHistory`, mirroring the pattern used by `getCachedSummary` and `getCachedFacts`. `clearHistory` must call `cache.config.delete('history_loaded')` to allow the next cold load.
2. **G2/G3 (provider-neutral strings)**: Replace `"Recently accessed Kaneo entities:"` with `"Recently accessed entities:"` and `"Kaneo issues"` with `"tasks and projects"` in `src/memory.ts`. Update the corresponding test assertion.
3. **G4 (read-tool fact extraction)**: Extend `extractFactsFromSdkResults` to process `get_task` results (single task) and `list_projects` results (array, capped at 10) alongside existing mutation-tool processing.
4. **G5 (conversation.ts tests)**: Create `tests/conversation.test.ts` covering `shouldTriggerTrim`, `buildMessagesWithMemory`, and `runTrimInBackground` with mocked `ai` module.
5. **G7 (acceptance criteria tests)**: Create `tests/persistence-ac.test.ts` validating the end-to-end persistence round-trip (save → cold cache → reload) for history, summary, and facts.

## Rationale

The `history_loaded` flag fix prevents silent performance regressions for users with empty history (the common case after `/clear`). Provider-neutral strings are a correctness fix, not cosmetic — strings injected into LLM prompts that name a specific provider can confuse the model when using a different backend. Extending fact extraction to read tools closes the most common case where a user accesses but never mutates a task or project, then references it later after cache eviction.

The `conversation.ts` test gap (`G5`) was the highest-priority item in the plan because `shouldTriggerTrim` and `runTrimInBackground` are the critical path for history management, yet had zero coverage.

## Consequences

### Positive

- Empty-history users no longer trigger a DB query on every message after the first load
- LLM context injected by `buildMemoryContextMessage` and `TRIM_PROMPT` is provider-neutral
- Entities accessed via `get_task` and `list_projects` are persisted as facts and survive cache eviction
- `shouldTriggerTrim`, `buildMessagesWithMemory`, and `runTrimInBackground` have unit test coverage
- End-to-end persistence round-trip is validated by acceptance criteria tests

### Negative

- The `history_loaded` flag must be explicitly deleted on `clearHistory` and any other path that empties the cache; omitting this in a future change silently breaks cold-start recall
- Extending fact extraction to `list_projects` introduces a cap (10 entries) that may silently drop projects in workspaces with many projects
- `runTrimInBackground` is non-atomic by design: messages added during the async trim are appended to the trimmed list, but a crash mid-trim could leave the DB and cache in a partially updated state

## Implementation Status

**Status**: Implemented

Evidence:

- `src/cache.ts` lines 76, 89, 246 — `history_loaded` flag added to `getCachedHistory`; set after first load; deleted on `clearHistory`
- `src/memory.ts` line 245 — `"Recently accessed entities:\n..."` (no "Kaneo")
- `src/memory.ts` line 156 — `TRIM_PROMPT` reads `"active unresolved tasks and projects"` (no "Kaneo")
- `src/memory.ts` lines 107, 131–132 — `extractFactsFromSdkResults` processes `get_task` (line 107) and `list_projects` (lines 131–132) in addition to mutation tools
- `tests/conversation.test.ts` — present; tests `shouldTriggerTrim`, `buildMessagesWithMemory`, `runTrimInBackground` using mocked `ai` module
- `tests/persistence-ac.test.ts` — present; validates save → cold cache → reload round-trip for history, summary, and facts

## Related Plans

- `/Users/ki/Projects/experiments/papai/docs/plans/done/2026-03-20-phase-03-persistence-context.md`
