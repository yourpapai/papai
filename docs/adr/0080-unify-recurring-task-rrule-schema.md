# ADR-0080: Unify Recurring Task and Deferred Prompt Recurrence Schemas

## Status

Accepted

## Context

The `create_recurring_task` and `update_recurring_task` tools currently used a semantic schedule object: `{ frequency, time, days_of_week, day_of_month }`.

Simultaneously, the `deferred-prompt` tools were already using a standardized RRULE-based input schema (`rruleInputSchema`).

This discrepancy led to:

- Inconsistent LLM prompt instructions (different vocabulary for similar concepts).
- Duplicate translation logic in the codebase (`semanticScheduleToCompiled` vs `recurrenceSpecToRrule`).
- Higher maintenance burden when updating recurrence capabilities.

## Decision Drivers

- **Consistency**: LLM tools should share a single, predictable interface for similar features.
- **Code Reuse**: Leverage the existing, robust `rruleInputSchema` and `recurrenceSpecToRrule` logic.
- **Maintainability**: Reduce dead code and consolidate translation paths.
- **Reduced Prompt Complexity**: A single set of instructions for "recurrence" across all tool families.

## Considered Options

### Option 1: Maintain separate schemas

- **Pros**: No immediate change to existing tool integrations; zero risk of breaking current LLM behaviors.
- **Cons**: High technical debt; inconsistent LLM interface; duplicated translation logic; harder to add new RRULE-based features.

### Option 2: Unify under RRULE-based schema (Chosen)

- **Pros**: Single source of truth for recurrence; unified LLM prompt vocabulary; elimination of dead code; easier future extensions.
- **Cons**: Requires updating tool implementation, test suites, and system prompts.

## Decision

We will replace the semantic schedule object in the recurring task tools with the `rruleInputSchema` used by deferred-prompt tools.

## Rationale

Unification provides a cleaner, more professional API for the LLM. By using the standard RRULE-based schema, we align the recurring task tools with the modern "deferred prompt" pattern, reducing the surface area for errors and making the system more predictable for agentic workers.

## Consequences

### Positive

- **Unified API**: A single, well-defined schema for all recurrence-related tool calls.
- **Reduced Complexity**: Removal of the `SemanticSchedule` type and `semanticScheduleToCompiled` translation logic.
- **Improved LLM Performance**: A consistent vocabulary (freq, byDay, etc.) makes it easier for the LLM to generate correct schedules.
- **Cleaner Codebase**: Consolidates recurrence logic into `src/recurrence.ts`.

### Negative

- **Migration Effort**: Requires updates to implementation, tests, and system prompts (completed).
- **Breaking Change**: The tool schema changed, which would impact any external integrations or existing prompts (not applicable to internal agentic usage).

### Risks

- **Prompt Regressions**: Changes to the system prompt might affect how the LLM understands recurrence.
- **Mitigation**: Comprehensive test coverage (unit and integration) was implemented to ensure correct translation of RRULE inputs.

## Implementation Notes

- The `dtstart` value is now injected synthetically at call time using `new Date().toISOString()`.
- `src/utils/datetime.ts` was refactored to remove dead code.
- System prompt was updated to reflect the new RRULE vocabulary.

## Related Decisions

- ADR-0030: Deferred Prompts System

## References

- `src/tools/create-recurring-task.ts`
- `src/tools/update-recurring-task.ts`
- `src/deferred-prompts/types.ts`
- `src/recurrence.ts`
