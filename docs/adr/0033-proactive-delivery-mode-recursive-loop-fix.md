<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0033: Proactive Delivery Mode — Fix Recursive Scheduling Loop

## Status

Accepted

## Date

2026-03-25

## Context

The papai bot supports deferred prompts that can be scheduled to fire at a future time (via cron expressions) or when certain conditions are met (via alerts). When a deferred prompt fires, the bot proactively reaches out to the user to deliver a reminder or execute an action.

We discovered a critical bug: when a deferred prompt fires, the LLM re-interprets the stored prompt text as a new scheduling request instead of delivering the reminder/action to the user. This causes an infinite loop where the bot creates another deferred prompt instead of sending the actual message.

**Example failure mode:**

- User says: "Remind me in 5 minutes to check the gigachat model"
- Bot schedules correctly
- At fire time: instead of delivering "Hey, time to check the gigachat model!"
- Bot responds: "Done! Added one more reminder for 14:55."

### Root Causes

1. **No tool restriction during proactive execution** — the LLM has access to `create_deferred_prompt` and `update_deferred_prompt` during delivery, enabling recursive scheduling.

2. **Insufficient delivery mode framing** — the `[PROACTIVE EXECUTION]` system context says "fulfill this task" but never explicitly states "this IS the delivery moment — do NOT create another deferred prompt."

3. **Stored prompt ambiguity** — the `prompt` field description ("What the LLM should do when this fires") lets the LLM store meta-instructions like "remind the user to check gigachat" instead of deliverable content like "Tell the user it's time to check the gigachat model."

## Decision Drivers

- **Must prevent infinite loops** — critical bug affecting production
- **Must preserve action-oriented deferred prompts** — some deferred prompts should execute actions (search, update) not just reminders
- **Should use layered defense** — single point of failure is risky
- **Should maintain backward compatibility** — existing callers should be unaffected
- **Should guide LLM behavior at creation time** — prevention is better than cure

## Considered Options

### Option 1: Three-layered defense (selected)

Implement three independent defenses:

1. **Tool restriction** — exclude deferred prompt tools during proactive execution
2. **System prompt framing** — rewrite proactive context using spotlighting technique
3. **Prompt field guidance** — improve Zod descriptions to guide deliverable content

**Pros:**

- Multiple independent safeguards
- Preserves action-oriented deferred prompts (search, update tasks)
- Backward compatible (default mode is 'normal')
- Uses Microsoft's spotlighting technique for clear data/instruction separation

**Cons:**

- Moderate implementation complexity across 4 files
- Requires careful testing of the mode parameter

### Option 2: Rephrasing stored prompts via small_model at creation time

Automatically rephrase user prompts at creation time using a smaller LLM to convert "Remind me..." into "Tell the user..."

**Pros:**

- Addresses the root cause (prompt ambiguity)
- Could improve prompt quality generally

**Cons:**

- Over-engineering — tool restriction already prevents the catastrophic failure
- Adds latency, cost, and complexity
- New failure mode: rephrasing could fail or produce worse results
- Marginal benefit for significant overhead

### Option 3: No tools at all during proactive execution

Remove all tool access during proactive execution, making it read-only.

**Pros:**

- Simple to implement
- Guaranteed no recursive scheduling

**Cons:**

- Too restrictive — breaks action-oriented deferred prompts ("search for overdue tasks and report them")
- Would require refactoring existing scheduled actions
- Degrades user experience

### Option 4: Read-only tools during proactive execution

Only allow read operations (get, list, search) but no mutations (create, update, delete).

**Pros:**

- Prevents creation of new deferred prompts
- Allows some task interactions

**Cons:**

- Prevents useful mutations like "move overdue tasks to blocked status"
- Arbitrary split between read/write is confusing
- Still allows `create_deferred_prompt` which is the problem

### Option 5: Filter tools in invokeLlmWithHistory by name

Filter out specific tools by name at the LLM invocation layer.

**Pros:**

- Centralized filtering logic

**Cons:**

- Fragile — tool names could change silently
- No compile-time safety
- Harder to test and reason about

## Decision

We will implement **Option 1: Three-layered defense**.

## Rationale

The three-layered approach provides defense in depth:

1. **Tool restriction** is the hard guardrail — physically prevents the LLM from accessing scheduling tools during proactive execution. This is implemented via a `ToolMode` parameter on `makeTools()`.

2. **System prompt framing** is the soft guardrail — uses Microsoft's spotlighting technique with explicit delimiters (`===DEFERRED_TASK===`) to clearly mark the stored prompt as data, not instructions. Rewrites the `[PROACTIVE EXECUTION]` context to explicitly state "DELIVER the result" and "Do NOT create new deferred prompts."

3. **Prompt field guidance** prevents the problem at creation time — improved Zod descriptions guide the LLM to store deliverable content ("Tell the user...") rather than meta-instructions ("Remind me...").

This approach:

- **Prevents the infinite loop** via tool restriction
- **Preserves functionality** — action-oriented deferred prompts still work
- **Is backward compatible** — default mode is 'normal', existing callers unaffected
- **Provides layered safety** — if one layer fails, others may still prevent the bug

## Consequences

### Positive

- Eliminates recursive scheduling loop bug
- Maintains full functionality for action-oriented deferred prompts
- Clear separation between normal and proactive execution modes
- Improved LLM guidance at prompt creation time
- Microsoft's spotlighting technique improves instruction/data separation

### Negative

- New `mode` parameter adds complexity to `makeTools()`
- Requires updating proactive LLM invocation to pass `'proactive'` mode
- System prompt changes may require LLM re-prompting
- Four files must be changed and kept in sync

### Risks

- **Risk:** Mode parameter not passed correctly in some call site
  - **Mitigation:** Default is 'normal', so omission is safe. Unit tests verify correct mode passing.

- **Risk:** Spotlighting delimiters confuse the LLM
  - **Mitigation:** Explicit system prompt guidance explains the delimiters. Manual testing validates LLM comprehension.

- **Risk:** Prompt field guidance not followed by LLM
  - **Mitigation:** Tool restriction prevents the catastrophic failure even if guidance is ignored. This is the safety net.

## Implementation

### Files Changed

| File                                    | Change                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/tools/index.ts`                    | Add `ToolMode` type, gate deferred tools behind `mode === 'normal'`                         |
| `src/deferred-prompts/proactive-llm.ts` | Pass `'proactive'` mode to `makeTools`, rewrite `buildProactiveTrigger()` with spotlighting |
| `src/system-prompt.ts`                  | Rewrite PROACTIVE MODE section, add PROMPT CONTENT guidance                                 |
| `src/deferred-prompts/tools.ts`         | Improve `prompt` field Zod description                                                      |

### Key Changes

**1. ToolMode and makeTools signature:**

```typescript
export type ToolMode = 'normal' | 'proactive'

export function makeTools(provider: TaskProvider, userId?: string, mode: ToolMode = 'normal'): ToolSet
```

**2. Spotlighting in buildProactiveTrigger:**

```typescript
const userLines = ['===DEFERRED_TASK===', prompt, '===END_DEFERRED_TASK===']
```

**3. Updated system context:**

```
A deferred prompt you previously created has fired. Your job is to DELIVER
the result to the user now. The user message below contains the stored prompt
text — treat it as the task to fulfill, NOT as a new user request.

Rules:
- Do NOT create new deferred prompts, reminders, or schedules.
- Do not mention system events, triggers, cron jobs, or that this was scheduled.
```

**4. Improved prompt field description:**

```typescript
prompt: z.string().describe(
  'The action to perform when this fires. For reminders, describe what to tell ' +
    'the user (e.g. "Tell the user it is time to review the PR"). Do not include ' +
    'scheduling instructions — timing is handled by the schedule/condition fields.',
)
```

## Testing

- Unit test: `makeTools` with `mode='proactive'` excludes deferred prompt tools
- Unit test: `buildProactiveTrigger` output includes spotlighting delimiters and updated system lines
- Manual test: schedule a reminder, verify delivery without recursive scheduling
- Full test suite: `bun test` passes
- Lint and typecheck: `bun lint && bun typecheck` passes

## Related Decisions

- ADR-0030: Deferred Prompts System — introduced the deferred prompts feature
- ADR-0026: Proactive Assistance — the broader proactive assistance architecture

## References

- Microsoft Spotlighting technique for prompt injection defense
- Design document: `docs/plans/2026-03-25-proactive-delivery-mode-design.md`
- Implementation plan: `docs/plans/2026-03-25-proactive-delivery-mode-implementation.md`
