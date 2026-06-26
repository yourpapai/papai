<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Long-Term Memory Design

**Date:** 2026-06-11
**Status:** Approved for implementation planning

## Problem

papai already has useful memory primitives, but they are not a complete long-term memory system:

| Layer                                   | Current behavior                                                           | Gap                                                    |
| --------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------ |
| Conversation history + `memory_summary` | Stores recent turns and a compacted low-trust summary                      | Mostly short-term narrative context                    |
| `memory_facts`                          | Stores recently accessed task/project entities with staleness and eviction | Entity pointers only, not learned knowledge            |
| `memos`                                 | Explicit user notes with FTS5 and optional embeddings                      | User/tool initiated, not automatic background learning |
| `user_instructions`                     | Explicit durable instructions                                              | Not implicit preferences, decisions, or shared context |

The missing capability is a default-on, controllable long-term memory layer that learns durable personal and group context in the background, keeps that context organized, makes it easy for agents to retrieve, and prevents stale memories from polluting every turn.

## Goals

- Capture durable memory in the background after conversations without delaying replies.
- Support both personal memory and group memory.
- Share long-term group memory across threads inside the same group chat.
- Keep default prompt context small and trust-labelled.
- Make deeper memory easy to retrieve through tools.
- Track timestamps, confidence, evidence pointers, status, and decay metadata.
- Provide clear controls to view, correct, delete, clear, and disable memory.
- Fit papai's existing SQLite, settings UI, tool permission, and context-scoping model.

## Non-Goals

- Do not adopt an external memory platform for the first implementation.
- Do not build a full temporal knowledge graph in this phase.
- Do not share private personal memory into groups by default.
- Do not store raw message text as evidence for generated memories.
- Do not replace existing memos, instructions, summary, or entity memory in the first pass.

## Research Summary

The selected architecture follows a hybrid pattern common across current agent-memory systems:

- **mem0-style layered memory:** memory is scoped by user/session-like identifiers and retrieved by metadata rather than injected wholesale.
- **LangMem-style memory managers:** separates semantic, episodic, and procedural memory, with application-owned schemas and background extraction.
- **Letta-style core + archival memory:** small always-visible core memory plus larger searchable archival memory.
- **Zep-style temporal facts:** memories benefit from validity and expiration timestamps, but a full graph engine is not necessary for papai's next step.
- **Anthropic context-engineering guidance:** keep default context bounded and use just-in-time retrieval for deeper knowledge.

References:

- mem0 memory types: <https://docs.mem0.ai/core-concepts/memory-types>
- LangMem concepts: <https://langchain-ai.github.io/langmem/concepts/conceptual_guide/>
- Letta memory blocks: <https://docs.letta.com/guides/core-concepts/memory/memory-blocks>
- Letta archival memory: <https://docs.letta.com/guides/core-concepts/memory/archival-memory/>
- Zep concepts: <https://help.getzep.com/concepts>
- Zep facts: <https://help.getzep.com/facts>
- Anthropic context engineering: <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>

## Chosen Approach

Use a **hybrid profile + memory records** design.

Each memory scope has:

1. **Pinned profile** — a small, always-injected projection of the most important stable context.
2. **Memory records** — individual typed, timestamped, searchable long-term memories that are recalled by tools or a bounded relevance pass.

This gives agents immediate access to high-signal context while keeping detailed memory out of the prompt until it is relevant.

Rejected alternatives:

- **Pinned profile only:** too likely to either grow noisy or lose important detail.
- **Temporal graph memory:** powerful, but overbuilt for the first version and expensive to design correctly.

## Scope Model

Long-term memory uses normalized memory scopes, not raw conversation context IDs in every case.

| Conversation                | Long-term memory scope           |
| --------------------------- | -------------------------------- |
| Personal DM                 | The personal user/context scope  |
| Telegram group thread/topic | The parent group chat scope      |
| Mattermost group thread     | The parent group chat scope      |
| Discord group/channel       | The existing group/channel scope |

Telegram and Mattermost may keep thread-scoped short-term conversation history, but long-term group memory intentionally rolls up to the parent group chat. A decision learned in one thread should be available in another thread in the same group.

No cross-scope recall happens implicitly:

- A group turn does not read private personal memory.
- A personal DM turn does not read group memory.
- Future cross-scope recall would require explicit design and user-visible controls.

## Data Model

### `memory_profiles`

One pinned profile per normalized memory scope.

Fields:

- `scope_id`: normalized personal or parent-group memory scope.
- `scope_type`: `personal` or `group`.
- `profile`: small markdown or structured text block.
- `updated_at`: ISO timestamp.
- `version`: integer for future optimistic updates or profile regeneration tracking.

The profile is not the source of truth. It is a compact projection synthesized from active records plus recent conversation.

### `memory_records`

Individual searchable long-term memories.

Fields:

- `id`: UUID.
- `scope_id`: normalized memory scope.
- `scope_type`: `personal` or `group`.
- `kind`: one of `preference`, `fact`, `decision`, `project_context`, `person_context`, `procedure`, `episode`, `reference`.
- `content`: concise natural-language memory.
- `summary`: optional one-line display and retrieval text.
- `tags`: JSON array.
- `confidence`: number from `0.0` to `1.0`.
- `status`: `active`, `stale`, `archived`, or `contradicted`.
- `source`: `background`, `explicit`, `tool_result`, or `admin_edit`.
- `evidence`: compact JSON containing message IDs, timestamps, actor IDs, and source context where available.
- `created_at`, `updated_at`, `last_seen_at`: ISO timestamps.
- `valid_from`, `valid_until`: optional validity window.
- `expires_at`: optional hard expiration timestamp.
- `embedding`: optional blob, following the existing memo embedding pattern.

Indexes:

- `(scope_id, status, last_seen_at)`
- `(scope_id, kind, status)`
- FTS5 over `content`, `summary`, and serialized tags.
- Optional embedding lookup by current `scope_id`, with in-app cosine similarity.

SQLite + FTS5 + in-app cosine is sufficient for the initial scale. A vector database or graph database should be reconsidered only if memory volume grows beyond the current memo-search assumptions or cross-scope semantic retrieval becomes a product requirement.

## Decay And Retirement

Records gradually lose authority before they disappear.

Default staleness windows:

| Kind              | Stale after unseen |
| ----------------- | ------------------ |
| `preference`      | 180 days           |
| `procedure`       | 180 days           |
| `decision`        | 90 days            |
| `project_context` | 90 days            |
| `person_context`  | 90 days            |
| `episode`         | 45 days            |
| `reference`       | 45 days            |
| `fact`            | 90 days            |

Explicit memories do not auto-expire unless the user sets an expiry or deletes them.

Maintenance should run periodically and:

- mark records stale after their kind-specific window;
- archive records whose `expires_at` has passed;
- leave explicit memories alone unless expired or deleted;
- regenerate pinned profiles from active records when profile drift is likely.

Hard deletion is only for explicit user/admin deletion or full clear operations.

## Background Capture

Memory capture runs after the assistant has replied and never blocks the user-facing response.

The extractor receives:

- recent conversation window;
- current pinned profile;
- a small set of relevant existing records;
- normalized memory scope metadata;
- current date/time;
- author and message metadata where available.

It returns a structured patch:

- profile rewrite or unchanged;
- new records;
- updates to existing records;
- records to mark stale, contradicted, or archived;
- confidence and evidence metadata.

Extraction should be conservative:

- Personal memory captures stable user identity, expertise, preferences, communication style, recurring defaults, and long-running personal context.
- Group memory captures shared decisions, project context, group conventions, recurring references, and collaboration norms.
- It should skip transient chatter, one-off trivia, secrets, credentials, sensitive private details, and unverified gossip.

The runner should have an in-flight guard per normalized memory scope, similar to `runTrimInBackground`, so back-to-back turns do not race profile rewrites and record updates.

## Retrieval

Retrieval has two paths.

### Default Context Injection

Each turn gets a bounded memory block when memory exists:

- pinned profile;
- up to three fresh, high-confidence records relevant to the current turn;
- trust and staleness guidance.

The block must be labelled as compacted, possibly stale background context. The current user message always outranks memory when they conflict.

### Agent Tools

Expose memory tools through the existing tool permission system:

- `search_memory(query, scope?, kind?, include_stale?)`
- `remember_memory(content, kind, scope?, expiry?)`
- `forget_memory(memory_id | query, scope?)`
- `list_memory(kind?, status?, scope?)`

Defaults:

- In DMs, memory tools operate on personal memory.
- In groups, memory tools operate on the parent group memory scope.
- Cross-scope access is not implicit.

Explicit requests like "remember this" or "forget that" should write immediately through hot-path tools. Implicit learning remains background-only.

## Controls

Memory is default-on for personal and group scopes, so controls are mandatory.

Personal settings:

- view profile;
- search/list records;
- inspect kind, status, source, confidence, and timestamps;
- edit, archive, delete individual records;
- clear all personal memory;
- disable capture.

Group settings for authorized group admins:

- same controls for group memory;
- changes apply to the parent group memory scope shared across threads.

Chat-facing controls:

- "what do you remember about me/us?";
- "forget X";
- "do not remember this";
- explicit remember/save flows.

Every displayed memory should show whether it came from background capture, explicit save, tool result, or admin edit.

## Safety

- Profile and memory record content must never be logged.
- Evidence stores pointers and metadata, not full raw message text.
- Secrets, credentials, sensitive private health/financial details, and one-off gossip are not captured.
- Prompt-injection-shaped memory content is rendered as data, not instructions.
- Stale records are labelled and should be verified before use.
- Background extractor failures are logged and swallowed.
- Group memory writes to the parent group memory scope and never imports private DM memory by default.
- Settings and tool access must respect the existing authorization and tool-permission model.

## Testing

Core tests:

- scope normalization: Telegram and Mattermost threads write long-term memory to the parent group scope;
- personal/group isolation;
- background extraction does not block replies;
- in-flight guard prevents concurrent background memory writes for one scope;
- profile injection stays bounded;
- relevant-record injection respects limit, scope, status, and staleness;
- `search_memory` respects scope, kind, status, and stale flags;
- `remember_memory` writes immediately;
- `forget_memory` marks records archived or deleted according to the requested action;
- maintenance marks records stale and archives expired records;
- prompt-injection-shaped memory content remains data;
- settings/admin controls mutate only authorized scopes.

Existing areas likely to receive tests:

- `tests/conversation.test.ts`
- `tests/memory*.test.ts`
- `tests/tools/*memory*.test.ts`
- `tests/db/migrations/*memory*.test.ts`
- `tests/settings/*` or matching settings-route tests
- group context tests covering parent group scope normalization

## Implementation Notes

The implementation plan should decide exact module boundaries, but the design expects these units:

- scope normalization helper for long-term memory scope IDs;
- profile store;
- record store with FTS and optional embeddings;
- background extraction runner;
- memory patch parser/validator;
- bounded context builder;
- memory tools;
- settings routes and UI controls;
- scheduled maintenance pass.

The first implementation should keep the graph door open by preserving evidence, timestamps, validity windows, and record kinds, but it should not build graph traversal or relationship storage yet.
