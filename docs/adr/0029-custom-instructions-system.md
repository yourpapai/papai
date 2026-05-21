<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0029: Custom Instructions System

## Status

Accepted

## Context

Users frequently express behavioral preferences to papai like:

- "Always reply in Spanish"
- "Use high priority by default for my tasks"
- "Never use emoji in responses"

Previously, these preferences were ephemeral - lost at the end of each conversation. Users would need to repeat preferences in every session, leading to frustration and inconsistent behavior.

We needed a way for users to teach the bot persistent behavioral preferences via natural language, stored per context and injected into every system prompt.

## Decision Drivers

- **Must persist across sessions** - preferences survive conversation resets
- **Must be per-context** - different users/groups can have different preferences
- **Must prevent duplicates** - similar instructions should not pile up
- **Must be manageable** - users need to list and delete instructions
- **Should have limits** - prevent abuse or excessive token usage

## Considered Options

### Option 1: Static configuration via /set command

- **Pros**: Simple to implement, explicit control
- **Cons**: Not natural language, limited to predefined keys, poor UX
- **Verdict**: Rejected - too rigid for natural preference expression

### Option 2: Per-user config table expansion

- **Pros**: Uses existing config infrastructure
- **Cons**: Key-value only, no natural language, no deduplication
- **Verdict**: Rejected - doesn't support the natural language requirement

### Option 3: Dedicated instructions table with LLM tools

- **Pros**: Natural language input, deduplication via Jaccard similarity, full CRUD via tools
- **Cons**: Additional table, more complex cache layer
- **Verdict**: Accepted - best UX and flexibility

## Decision

Implement a custom instructions system with:

1. SQLite table `user_instructions` (id, context_id, text, created_at)
2. In-memory cache layer for fast access
3. Three LLM tools: `save_instruction`, `list_instructions`, `delete_instruction`
4. Jaccard similarity detection (80% threshold) to prevent duplicates
5. System prompt injection as `=== Custom instructions ===` block
6. Cap of 20 instructions per context to limit token usage

## Implementation

### Database Schema

```sql
CREATE TABLE user_instructions (
  id TEXT PRIMARY KEY,
  context_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')) NOT NULL
)
```

### Cache Layer

Instructions are cached in the existing `UserCache` with lazy loading from DB on first access. Changes are synced to SQLite via `queueMicrotask` to avoid blocking.

### Duplicate Detection

Uses tokenization + Jaccard similarity:

- Tokenize by splitting on non-word characters
- Calculate intersection/union ratio
- Reject if similarity >= 0.8

Example: "Always reply in Spanish" and "Always reply in spanish language" are detected as duplicates.

### System Prompt Integration

```
=== Custom instructions ===
- Always reply in Spanish
- Use high priority by default

[prompt continues...]
```

The instructions block appears before STATIC_RULES so the LLM sees preferences early.

### LLM Tool Integration

Three new tools available unconditionally:

- `save_instruction(text)` - saves preference with duplicate detection
- `list_instructions()` - returns all instructions for context
- `delete_instruction(id)` - removes by ID

The system prompt includes guidance for when to call these tools:

- Call `save_instruction` when user says "always", "never", "from now on", "remember to"
- Call `list_instructions` when user asks to see preferences
- Call `delete_instruction` after `list_instructions` to find ID

## Consequences

### Positive

- Users can teach persistent preferences naturally
- Deduplication prevents instruction spam
- Per-context isolation respects boundaries
- Fast access via cache layer
- Full CRUD via natural language

### Negative

- Additional database table
- Token usage increases with many instructions
- Jaccard similarity may have false positives/negatives
- 20-instruction cap may be limiting for power users

### Mitigations

- Cap can be increased if needed (data migration)
- Jaccard threshold tunable via constant
- Cache TTL prevents memory bloat

## Related Decisions

- ADR-0026: Proactive Assistance (same per-context pattern)
- ADR-0016: Conversation Persistence (shared cache infrastructure)

## References

- Implementation plan: `docs/plans/done/2026-03-22-custom-instructions-implementation.md`
- Schema: `src/db/schema.ts` (userInstructions table)
- Implementation: `src/instructions.ts`, `src/tools/instructions.ts`
