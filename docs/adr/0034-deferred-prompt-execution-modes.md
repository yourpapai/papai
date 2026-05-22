<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0034: Deferred Prompt Execution Modes

## Status

Accepted

## Context

The deferred prompts system (ADR-0030) provides a unified abstraction for scheduled and alert-based prompts. However, every deferred prompt — whether a simple "remind me to drink water" or a complex "check overdue tasks and reassign them" — goes through the same heavy execution path: full conversation history, full system prompt, task provider instantiation, all capability-gated tools, and up to 25 tool-use steps. This is expensive and unnecessary for simple prompts.

This inefficiency manifests in:

- **Resource waste**: Lightweight reminders still load full provider and tool set
- **Latency**: Simple prompts wait for unnecessary provider initialization
- **LLM costs**: Even basic reminders invoke the heavy `main_model` with all tools
- **Operational overhead**: All prompts consume full memory and context window

We needed a way to classify prompts at creation time so that fire-time resource loading scales with prompt complexity.

## Decision Drivers

- **Resource efficiency**: Simple prompts should use minimal resources
- **Cost optimization**: Prefer smaller models for simple tasks
- **Speed**: Lightweight prompts should fire faster
- **Backward compatibility**: Existing prompts must continue working
- **Flexible classification**: LLM at creation time determines execution needs

## Considered Options

### Option 1: Provider-level optimization

- **Pros**: Centralized, no schema changes needed
- **Cons**: Runtime detection adds latency, cannot optimize for prompt complexity
- **Verdict**: Rejected — detection at fire time defeats the purpose

### Option 2: Three execution modes with creation-time classification

- **Pros**: Precise resource allocation, creation-time metadata capture, scalable
- **Cons**: Requires schema change, LLM must classify correctly
- **Verdict**: Accepted — best balance of efficiency and flexibility

### Option 3: Continuous spectrum (numeric weights)

- **Pros**: Granular control over resource allocation
- **Cons**: Over-complicated, hard to reason about, no clear boundaries
- **Verdict**: Rejected — simpler is better for LLM classification

## Decision

Introduce three execution modes that control what resources are loaded at fire time. The creating LLM classifies each prompt at creation time and enriches it with a delivery brief and optional context snapshot.

### Execution Modes

| Resource         | Lightweight                  | Context      | Full                       |
| ---------------- | ---------------------------- | ------------ | -------------------------- |
| Model            | `small_model` → `main_model` | `main_model` | `main_model`               |
| System prompt    | Minimal                      | Minimal      | Full (`buildSystemPrompt`) |
| History          | No                           | Yes          | Yes                        |
| Context snapshot | If present                   | If present   | If present                 |
| Delivery brief   | Yes                          | Yes          | Yes                        |
| Tools            | No                           | No           | Yes (capability-gated)     |
| Provider         | No                           | No           | Yes                        |
| Fact extraction  | No                           | No           | Yes                        |
| History append   | Yes                          | Yes          | Yes                        |

**Lightweight**: Simple reminders, facts, nudges. No task tracker data or conversation context needed at fire time. Uses `small_model` if configured.

**Context**: Lightweight plus history. Requires understanding of conversation flow but no live data lookup. Uses `main_model`.

**Full**: Requires live task tracker operations (search, create, update, check status) at fire time. Current behavior. Uses `main_model` with full tools.

### Data Model Change

Add `execution_metadata` JSON column to both `scheduled_prompts` and `alert_prompts` tables:

```typescript
type ExecutionMetadata = {
  mode: 'lightweight' | 'context' | 'full'
  delivery_brief: string
  context_snapshot: string | null
}
```

Column definition: `execution_metadata TEXT NOT NULL DEFAULT '{}'`

Default `{}` handles backward compatibility — existing rows without metadata are treated as `full` mode.

### Creation-Time Enrichment

The `create_deferred_prompt` and `update_deferred_prompt` tools gain a nested `execution` parameter:

```typescript
execution: {
  mode: 'lightweight' | 'context' | 'full',
  delivery_brief: string,
  context_snapshot?: string
}
```

**LLM classification guidance:**

- `lightweight`: simple reminders, facts, nudges. No task tracker data or conversation context needed.
- `context`: requires understanding of conversation flow but no live data lookup.
- `full`: requires live task tracker operations at fire time.

### Execution-Time Dispatch

A dispatcher reads `execution_metadata.mode` and routes to the appropriate function:

```typescript
async function dispatchExecution(
  mode: ExecutionMode,
  userId: string,
  type: 'scheduled' | 'alert',
  prompt: string,
  metadata: ExecutionMetadata,
  buildProviderFn: BuildProviderFn
): Promise<string> {
  switch (mode) {
    case 'lightweight': return invokeLightweight(...)
    case 'context':     return invokeWithContext(...)
    case 'full':        return invokeFull(...)
  }
}
```

### Message Construction

All modes wrap the prompt in `===DEFERRED_TASK===` delimiters and inject the delivery brief as a system message. Context snapshot is added as a system message only when present.

**Lightweight mode messages:**

```typescript
;[
  { role: 'system', content: minimalSystemPrompt },
  { role: 'system', content: `[DELIVERY BRIEF]\n${metadata.delivery_brief}` },
  // only if context_snapshot:
  { role: 'system', content: `[CONTEXT FROM CREATION TIME]\n${metadata.context_snapshot}` },
  { role: 'user', content: `===DEFERRED_TASK===\n${prompt}\n===END_DEFERRED_TASK===` },
]
```

## Implementation

### Database Migration (016)

```sql
ALTER TABLE scheduled_prompts ADD COLUMN execution_metadata TEXT NOT NULL DEFAULT '{}';
ALTER TABLE alert_prompts ADD COLUMN execution_metadata TEXT NOT NULL DEFAULT '{}';
```

### Domain Types

```typescript
export const EXECUTION_MODES = ['lightweight', 'context', 'full'] as const
export type ExecutionMode = (typeof EXECUTION_MODES)[number]

export const executionMetadataSchema = z.object({
  mode: z.enum(EXECUTION_MODES),
  delivery_brief: z.string(),
  context_snapshot: z.string().nullable().default(null),
})

export type ExecutionMetadata = z.infer<typeof executionMetadataSchema>
```

### Three Execution Functions

**`invokeLightweight`**: Minimal resources, no provider/tools/history, uses `small_model` fallback.

**`invokeWithContext`**: Loads history, minimal system prompt, no tools/provider.

**`invokeFull`**: Full system prompt, tools, provider, fact extraction, trim trigger.

### Tool Schema Updates

The `create_deferred_prompt` and `update_deferred_prompt` tools accept:

```typescript
execution: z.object({
  mode: z.enum(['lightweight', 'context', 'full']),
  delivery_brief: z.string(),
  context_snapshot: z.string().optional(),
})
```

## Consequences

### Positive

- **Resource efficiency**: Lightweight prompts use minimal resources (no provider, no tools)
- **Cost optimization**: Can use smaller models for simple reminders
- **Faster execution**: Lightweight mode skips history loading and provider instantiation
- **Better scalability**: Resource usage proportional to prompt complexity
- **Backward compatible**: Default `full` mode preserves existing behavior
- **Flexible**: Context snapshot works across all modes
- **Clear boundaries**: Three distinct modes are easy to reason about and document

### Negative

- **Schema migration**: New column required on both prompt tables
- **Classification burden**: Creating LLM must correctly classify prompts
- **Complexity**: Three execution paths instead of one
- **Misclassification risk**: Wrong mode could cause missing context or excessive resource use

### Mitigations

- Default to `full` mode when uncertain (safest)
- Clear LLM guidance in tool descriptions
- Validation at creation time rejects invalid modes
- Parse failures default to `full` mode

## Related Decisions

- **ADR-0030: Deferred Prompts System** — This ADR extends the deferred prompts system with execution mode classification
- **ADR-0029: Custom Instructions System** — Shared configuration patterns for user preferences
- **ADR-0016: Conversation Persistence** — History loading patterns reused in context/full modes

## Migration Notes

Non-destructive migration adds column with default `'{}'`. Existing rows treated as `full` mode. No data migration needed.

Rollback: Column addition is non-destructive. Older code ignores the column if present.

## References

- Design document: `docs/plans/2026-03-26-deferred-prompt-execution-modes-design.md`
- Implementation plan: `docs/plans/2026-03-26-deferred-prompt-execution-modes-implementation.md`
- Schema: `src/db/schema.ts` (scheduledPrompts, alertPrompts)
- Migration: `src/db/migrations/016_execution_metadata.ts`
- Types: `src/deferred-prompts/types.ts`
- Execution: `src/deferred-prompts/proactive-llm.ts`
