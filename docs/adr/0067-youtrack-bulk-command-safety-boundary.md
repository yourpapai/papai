<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0067: YouTrack Bulk Command Safety Boundary

## Status

Implemented

## Date

2026-04-15

## Context

`apply_youtrack_command` is a YouTrack-specific escape-hatch tool that lets the LLM execute native YouTrack command strings (e.g. `for me`, `State In Progress`). The tool was introduced in ADR-0052 alongside the full YouTrack API implementation.

The tool accepted an array of issue IDs (`taskIds`), allowing a single command to mutate multiple issues at once. This created an elevated risk surface:

- **Free-form command strings are composable** — one command can change state, assign, tag, and comment across many issues simultaneously
- **Bulk confirmation UX adds prompt-safety complexity** — tool outputs are fed back into the LLM loop, so a bulk confirmation prompt becomes additional context that could be exploited
- **Structured tools already cover multi-issue workflows** — `update_task`, `add_task_label`, etc. can be called repeatedly with per-issue validation

Rather than building a more complex bulk confirmation system, the safer product decision was to disallow bulk command execution entirely and constrain the tool to single-issue use only.

## Decision Drivers

- **Must prevent bulk execution** through `apply_youtrack_command` — one command affecting many issues is too risky for an LLM-driven escape hatch
- **Must not change single-issue behavior** — allowlisted safe commands (`for me`, `vote`, `star`, etc.) and the existing confirmation gate for non-allowlisted commands must remain unchanged
- **Must not expand the confirmation UX** — no new bulk preview or multi-issue confirmation path
- **Must keep the change local** — only `src/tools/apply-youtrack-command.ts` and its test file should be affected
- **Must not touch provider transport or tool exposure** — no changes to provider operations or `tools-builder.ts`

## Considered Options

### Option 1: Reject bulk requests at the tool layer (chosen)

Add an early guard in `apply_youtrack_command` that rejects any request with `taskIds.length > 1` before entering the confirmation path.

**Pros:**

- Simplest correct implementation — one early-return branch
- Bulk requests never reach the confirmation gate or provider
- Failure message is actionable: tells the model to use structured tools or run commands one issue at a time
- No new abstractions needed

**Cons:**

- Removes a capability that could be useful in rare batch workflows
- Users who previously relied on bulk commands must issue individual calls

### Option 2: Add bulk confirmation with preview

Show the user a preview of all affected issues and require explicit confirmation before executing.

**Pros:**

- Preserves bulk capability
- User has visibility into scope

**Cons:**

- Confirmation prompts in tool outputs feed back into the LLM context, adding prompt-safety complexity
- Requires new UX patterns for bulk preview
- Significantly more implementation surface for an escape-hatch tool

### Option 3: Allow bulk only for allowlisted safe commands

Permit bulk execution for safe commands (`for me`, `vote`, `star`) but reject for all others.

**Pros:**

- Retains the most common safe use case

**Cons:**

- Safety boundary is harder to reason about — "safe" is per-command, not per-call
- Even safe commands can have unintended effects at scale
- Increases the surface area for future safe-command additions

## Decision

Implement **Option 1**: Add an early bulk-request guard in `apply_youtrack_command` that throws a `ProviderClassifiedError` for any request with `taskIds.length > 1`. The tool wrapper (`wrapToolExecution` in `src/tools/index.ts`) converts thrown failures into structured tool-failure payloads returned to the LLM.

The guard:

1. Checks `taskIds.length > 1` after the `applyCommand` availability check
2. Logs a structured warning with the query and task count
3. Throws `ProviderClassifiedError` with a clear message stating bulk commands are disabled for safety
4. Single-issue behavior continues unchanged through the existing confirmation flow

## Rationale

Bulk YouTrack commands combine two risk factors: free-form command strings and multi-issue mutation. The structured tools (`update_task`, `add_task_label`, etc.) already provide safe per-issue operations with proper validation. The escape-hatch tool should be constrained to its simplest safe form — single-issue commands — rather than expanding its capability surface.

The early-guard approach is the minimum viable safety boundary. It prevents the risk entirely rather than trying to manage it through additional confirmation complexity.

## Consequences

### Positive

- Eliminates bulk-mutation risk through the YouTrack command escape hatch
- Single-issue command behavior remains fully functional
- No new confirmation UX or provider transport changes
- Clear, actionable failure message guides the LLM toward structured tools

### Negative

- Bulk workflows that previously worked through command strings now require individual tool calls
- Slightly higher LLM token usage for multi-issue operations (separate tool calls vs. one bulk command)

### Risks

- **False sense of security**: The tool only guards `apply_youtrack_command`; other tools can still mutate multiple issues through repeated calls. Mitigation: this is by design — structured tools have per-call validation.
- **Future demand for bulk commands**: If bulk YouTrack commands become a frequent request, the rejection can be revisited with a proper bulk confirmation design. The early guard is easy to remove or modify.

## Implementation Notes

### File Structure

| File                                   | Change                                                              |
| -------------------------------------- | ------------------------------------------------------------------- |
| `src/tools/apply-youtrack-command.ts`  | Added `rejectBulkCommand()` helper, early guard before confirmation |
| `tests/tools/youtrack-command.test.ts` | Replaced bulk-confirmation test with bulk-rejection test            |

### Integration Point

In `execute()` at line 79 of `src/tools/apply-youtrack-command.ts`:

```typescript
if (taskIds.length > 1) {
  rejectBulkCommand(query, taskIds.length)
}
```

The `rejectBulkCommand` helper throws `ProviderClassifiedError` rather than returning a result object. The tool wrapper normalizes this into a structured failure payload.

### Divergence from Plan

The plan specified returning `{ success: false, message }` directly. The implementation throws a `ProviderClassifiedError` instead, which aligns with the repo's tool-failure convention: tool code throws, `wrapToolExecution` converts thrown failures into structured outputs via `buildToolFailureResult()`.

## Verification

- `bun test tests/tools/youtrack-command.test.ts` passes
- `bun test tests/providers/youtrack/operations/commands.test.ts` passes
- `bun test tests/providers/youtrack/tools-integration.test.ts` passes
- No regressions in broader YouTrack test suite

## Related Decisions

- ADR-0052: YouTrack Full API Implementation (introduced `apply_youtrack_command`)
- ADR-0058: Provider Capability Architecture (capability model governing tool exposure)
- ADR-0056: Missing Tool Results Error Prevention (tool-failure normalization pattern)

## References

- Spec: `docs/superpowers/specs/2026-04-15-youtrack-bulk-command-confirmation-design.md`
- Plan: `docs/superpowers/plans/2026-04-15-youtrack-bulk-command-safety-boundary.md`
- Implementation: `src/tools/apply-youtrack-command.ts`
- Confirmation gate: `src/tools/confirmation-gate.ts`
