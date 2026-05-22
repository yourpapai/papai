<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0053: LLM Trace Detail Modal for Debug Dashboard

## Status

Accepted

## Date

2026-04-05

## Context

The papai debug dashboard was already capturing LLM (Large Language Model) interaction data through the instrumentation layer (`src/debug/state-collector.ts`), including:

- Model names and token usage
- Tool call invocations with timing
- Step counts and duration
- Error states

However, this data was only displayed in a compact list view showing basic summary information (model, duration, steps, token count). When debugging complex multi-step LLM interactions or investigating tool call failures, developers needed to see the full details including:

- **Per-step breakdown**: Individual steps with their tool calls and token usage
- **Tool call arguments and results**: What parameters were passed and what was returned
- **Generated response text**: The full assistant response
- **Response metadata**: Response IDs, actual models used, finish reasons
- **Error details**: Complete error messages and stack traces

The existing architecture already supported modals for session details and log entries, establishing a pattern that could be extended for LLM traces.

## Decision Drivers

- **Must provide complete observability** — Debug failures without adding console logs
- **Must follow existing patterns** — Use established modal architecture from session/log modals
- **Must display nested data** — Tool calls have arguments, results, and errors
- **Should handle large responses** — Support text that exceeds modal viewport
- **Must validate data integrity** — Use Zod schemas for runtime validation
- **Should preserve existing functionality** — Don't break current trace list view

## Considered Options

### Option 1: Expandable Inline Rows (Rejected)

Replace the trace list with expandable rows that show details when clicked.

**Pros:**

- No modal complexity
- Quick scanning possible

**Cons:**

- Cluttered UI with multiple expanded rows
- Hard to compare tool calls across steps
- Doesn't handle large generated text well
- Breaks established modal pattern

### Option 2: Dedicated Trace Page (Rejected)

Navigate to a separate page for trace details.

**Pros:**

- Unlimited space for data
- Deep linking possible

**Cons:**

- Loses context of other traces
- Requires routing complexity
- Overkill for debugging workflow
- Breaks established modal pattern

### Option 3: Modal Detail View (Selected)

Add a modal that opens when clicking a trace row, displaying all available data in sections.

**Pros:**

- Follows existing session/log modal pattern
- Maintains context (traces visible behind modal)
- Clean separation of summary vs detail views
- Supports rich formatting (code blocks, grids)
- Modal can be dismissed to return to trace list

**Cons:**

- Requires careful CSS for scrolling content
- Modal must handle varying data shapes

## Decision

Implement a **modal detail view for LLM traces** following the established pattern from session and log detail modals.

### Implementation Approach

1. **HTML Structure**: Add trace modal to `client/debug/dashboard.html` alongside existing modals
2. **Type Extension**: Extend `LlmTrace` type with full LLM response data fields
3. **Schema Updates**: Add `ToolCallDetailSchema` and `StepDetailSchema` for Zod validation
4. **Rendering Module**: Create `client/debug/trace-detail.ts` with sectioned rendering functions
5. **Event Wiring**: Add click handlers to trace rows that open the modal
6. **CSS Styling**: Add trace-specific styles following existing dashboard aesthetic
7. **Data Emission**: Update LLM orchestrator to emit complete trace data

### Key Design Decisions

**Sectioned Layout:**

- Basic Info (model, duration, steps, finish reason, response ID)
- Token Usage (input/output breakdown)
- Generated Response (full assistant text)
- Steps Detail (per-step tool calls and usage)
- Tool Calls (detailed arguments, results, errors)

**Data Fields Captured:**

- `responseId` — Provider response identifier
- `actualModel` — Model actually used (may differ from requested)
- `finishReason` — Why generation stopped
- `messageCount` — Messages in context
- `toolCount` — Available tools count
- `generatedText` — Complete assistant response
- `stepsDetail` — Per-step breakdown with tool calls
- `toolCalls[].args` — Tool call arguments
- `toolCalls[].result` — Tool call results
- `toolCalls[].error` — Tool call errors

**Pattern Consistency:**

- Modal closes on × button click or backdrop click
- Escape key support (handled by existing modal infrastructure)
- Consistent styling with session/log modals
- Grid layout for key-value pairs
- JSON formatting for structured data

## Consequences

### Positive

- **Complete debugging visibility**: Can trace through multi-step LLM conversations without code changes
- **Tool call inspection**: See exactly what arguments were passed and what was returned
- **Token usage analysis**: Understand per-step token consumption
- **Error diagnosis**: Full error messages and context available
- **Pattern reinforcement**: Consistent with existing modal architecture

### Negative

- **Modal complexity**: Additional modal to maintain alongside session/log modals
- **Data volume**: Large traces can generate significant data (mitigated by pagination/scrolling)
- **Performance**: More data emitted from orchestrator (minimal overhead, async)

### Risks

- **Data privacy**: LLM traces may contain sensitive user data (mitigated by existing debug server authentication)
- **Storage growth**: Extended trace data increases memory usage (mitigated by trace limit in state collector)

## Implementation Notes

### Files Changed

**New Files:**

- `client/debug/trace-detail.ts` — Modal rendering module
- `tests/client/debug/trace-detail.test.ts` — Modal rendering tests

**Modified Files:**

- `client/debug/dashboard.html` — Added trace modal HTML
- `client/debug/dashboard.css` — Added trace detail styles
- `src/debug/schemas.ts` — Extended `LlmTraceSchema` with full data
- `src/debug/state-collector.ts` — Extended `LlmTrace` type and handlers
- `src/llm-orchestrator.ts` — Emit full trace data with callbacks

### Testing Strategy

- Unit tests for `renderTraceDetail` with various data shapes
- Schema validation tests for extended trace structure
- Integration tests via debug dashboard manual verification
- All existing tests continue to pass (no breaking changes)

### Future Considerations

- **Export functionality**: Could add button to export trace as JSON
- **Trace comparison**: Side-by-side trace comparison for regression testing
- **Filtering**: Filter traces by model, tool name, or error status
- **Search**: Search within trace text and tool call arguments

## Related Decisions

- ADR-0037: Debug Server Session1 — Initial debug server architecture
- ADR-0038: Pino Log Pipeline Session2 — Logging infrastructure
- ADR-0039: Debug Instrumentation Session3 — Event emission patterns
- ADR-0040: Debug Dashboard HTML Session4 — Dashboard UI foundation
- ADR-0049: Client Build Pipeline — Build system for dashboard

## References

- Plan: `docs/superpowers/plans/2026-04-05-llm-trace-detail-modal.md`
- Vercel AI SDK: https://sdk.vercel.ai/docs
- Existing modal pattern: `client/debug/session-detail.ts`
