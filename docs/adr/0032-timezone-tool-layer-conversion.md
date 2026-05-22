<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0032: Timezone Tool-Layer Conversion

## Status

Accepted

## Context

The papai chatbot accepts natural language datetime expressions from users ("tomorrow at 5pm", "next Monday", "end of day") and must convert these to UTC for storage while presenting local times back to the LLM.

**Previous Architecture:**

- System prompt disclosed the user's timezone and instructed the LLM to perform all timezone conversions
- LLM provided UTC ISO 8601 strings to tools
- This violated separation of concerns and created cognitive overhead for the LLM

**Problems with Previous Approach:**

1. **LLM complexity**: The LLM had to understand timezone math and IANA timezone identifiers
2. **Inconsistency risk**: Different LLM models handle timezone conversion with varying accuracy
3. **Prompt bloat**: Detailed timezone instructions consumed prompt tokens
4. **Schema mismatch**: Raw ISO strings are less structured than semantic objects

**Requirements:**

- Move all timezone-aware conversion to the tool layer
- Accept structured local datetime objects from the LLM
- Store UTC in the provider layer (unchanged)
- Return local times to the LLM for consistent display
- Support semantic schedules ("daily at 9am", "weekdays at 5pm") for recurring tasks

## Decision Drivers

- **Separation of concerns**: Tools should handle domain-specific logic (timezones), not the LLM
- **LLM simplicity**: Structured inputs are easier for LLMs than raw UTC calculations
- **Consistency**: All datetime fields seen by the LLM should be in the user's local time
- **Testability**: Pure utility functions are easier to unit test than prompt-based logic
- **Maintainability**: Centralized timezone logic reduces duplication

## Considered Options

### Option 1: Keep LLM-Based Conversion (Status Quo)

- **Pros**: No code changes needed; works today
- **Cons**: LLM burden, inconsistency across models, prompt complexity

### Option 2: Tool-Layer Conversion with Structured Inputs (Selected)

- **Pros**: Clean separation, consistent behavior, easier LLM prompting, testable utilities
- **Cons**: Requires schema changes across multiple tools, more code to maintain

### Option 3: UTC-Only Storage with Local Time Metadata

- **Pros**: Simple storage, no conversion logic
- **Cons**: LLM still needs timezone awareness for input; doesn't solve the core problem

### Option 4: Middleware Conversion Layer

- **Pros**: Transparent to tools, centralized
- **Cons**: Adds architectural complexity, harder to trace data flow

## Decision

Implement **Option 2**: Move all timezone conversion to a dedicated utility layer (`src/utils/datetime.ts`) and update tool schemas to accept structured local datetime objects.

### Key Components

1. **New utility module** (`src/utils/datetime.ts`):
   - `localDatetimeToUtc()` - converts local date+time to UTC ISO string
   - `utcToLocal()` - converts UTC ISO string to local datetime for LLM display
   - `semanticScheduleToCron()` - converts user-friendly schedule objects to cron expressions

2. **Tool schema updates**:
   - `dueDate` field changes from `z.string()` to structured `{ date: string, time?: string }`
   - `schedule` field replaces raw `cronExpression` for recurring tasks
   - `fire_at` field changes from ISO string to structured object for deferred prompts

3. **Bidirectional conversion**:
   - Input: local → UTC (before calling provider)
   - Output: UTC → local (before returning to LLM)

4. **Simplified system prompt**:
   - Remove timezone disclosure and conversion instructions
   - Provide only current local date/time for reference
   - Document structured input formats with examples

## Rationale

This architecture achieves:

1. **True separation of concerns**: The LLM expresses intent in natural terms; tools handle implementation details
2. **Reduced LLM cognitive load**: No timezone math required in the LLM layer
3. **Type safety**: Zod schemas enforce structured inputs at the boundary
4. **Consistency**: All tool inputs/outputs use the same local time representation
5. **Testability**: Pure utility functions have comprehensive unit tests (24 tests in `datetime.test.ts`)

## Consequences

### Positive

- **Simpler LLM prompting**: Removed ~15 lines of timezone instructions from system prompt
- **Consistent UX**: LLM always sees and provides local times
- **Better test coverage**: 24 tests for datetime utilities + 50+ tests for tool integration
- **DST handling**: `date-fns-tz` handles daylight saving time transitions correctly
- **Extensible**: Easy to add new semantic schedule types

### Negative

- **Schema migration**: Breaking change to tool input schemas (versioned via deployment)
- **Tool complexity**: Each datetime field now requires lookup of user's timezone from config
- **More code**: ~270 lines of new utility code plus modifications to 10+ tool files

### Risks

| Risk                           | Mitigation                                                     |
| ------------------------------ | -------------------------------------------------------------- |
| Invalid timezone identifiers   | `localDatetimeToUtc()` falls back to UTC on unparseable input  |
| DST edge cases                 | Test coverage includes `America/New_York` winter dates (UTC-5) |
| LLM confusion with new schemas | Clear schema descriptions + examples in system prompt          |
| Performance overhead           | Config lookup is cached; conversion is O(1)                    |

## Implementation

### Files Created

- `src/utils/datetime.ts` - Core datetime utilities
- `tests/utils/datetime.test.ts` - Unit tests

### Files Modified

- `src/tools/create-task.ts` - Structured dueDate input
- `src/tools/update-task.ts` - Structured dueDate input
- `src/tools/get-task.ts` - UTC→local conversion on output
- `src/tools/list-tasks.ts` - UTC→local conversion on output
- `src/tools/create-recurring-task.ts` - Semantic schedule input
- `src/tools/update-recurring-task.ts` - Semantic schedule input
- `src/tools/list-recurring-tasks.ts` - UTC→local conversion
- `src/tools/resume-recurring-task.ts` - UTC→local conversion
- `src/tools/skip-recurring-task.ts` - UTC→local conversion
- `src/deferred-prompts/tools.ts` - Structured fire_at input
- `src/tools/index.ts` - Thread userId through tool creation
- `src/system-prompt.ts` - Remove timezone instructions

### Dependencies Added

- `date-fns@^4.x` - Peer dependency of date-fns-tz
- `date-fns-tz@^3.x` - Timezone-aware datetime conversion

### Test Coverage

```
1456 tests passing across 78 files
- datetime.test.ts: 24 tests (UTC, UTC±5, UTC−8, DST, invalid TZ)
- task-tools.test.ts: 50 tests (local→UTC, UTC→local)
- recurring-tools.test.ts: 52 tests (semantic schedule, nextRun conversion)
- deferred-prompts/tools.test.ts: 22 tests (fire_at conversion)
```

## Related Decisions

- **ADR-0019: Recurring Task Automation** - This ADR supersedes the cronExpression approach in ADR-0019 with semantic schedules
- **ADR-0030: Deferred Prompts System** - Updated to use structured datetime inputs

## References

- Implementation Plan: `docs/plans/done/2026-03-24-timezone-tool-layer-conversion.md`
- Code Review: Completed via subagent review (session: ses_2db99c204ffeJkh9luV0U5hY70)
- `date-fns-tz` documentation: https://github.com/marnusw/date-fns-tz
- Merged: `74ae338..e3c766f` (timezone implementation + system prompt fix)

## Implementation Status

**Implemented** — All components verified present in codebase:

- ✅ `src/utils/datetime.ts` with `localDatetimeToUtc()`, `utcToLocal()`, `semanticScheduleToCron()`
- ✅ All task tools updated with structured dueDate
- ✅ All recurring task tools using semantic schedules
- ✅ Deferred prompts using structured fire_at
- ✅ System prompt simplified (timezone disclosure removed)
- ✅ 1456 tests passing
