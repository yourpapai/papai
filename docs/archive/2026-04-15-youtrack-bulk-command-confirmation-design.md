<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# YouTrack Bulk Command Safety Boundary Design

## Summary

Constrain `apply_youtrack_command` to single-issue use only. If a caller passes more than one issue ID, the tool must not execute the provider command and must instead return a normal tool failure result stating that bulk YouTrack commands are disabled for safety.

## Context

`apply_youtrack_command` is a provider-specific escape hatch for YouTrack-native command workflows that do not fit the structured tools. Its current single-issue behavior is acceptable, but bulk execution introduces a higher-risk path:

- one command can mutate many issues at once
- command strings are free-form and composable
- confirmation messaging for bulk commands introduces additional prompt-safety complexity because tool outputs are fed back into the LLM loop

Rather than building a more complex bulk confirmation system now, the safer product decision is to disallow bulk command execution entirely.

## Decision

If `taskIds.length > 1`, `apply_youtrack_command` must reject the request with a normal tool failure result and must not call `provider.applyCommand(...)`.

## Goals

- Prevent all bulk execution through `apply_youtrack_command`.
- Keep single-issue YouTrack command behavior unchanged.
- Avoid expanding the confirmation UX or adding a special bulk preview path.
- Keep the implementation local and easy to reason about.

## Non-Goals

- No new `/confirm` or `/reject` command flow.
- No new confirmation path for bulk commands.
- No provider-layer transport changes.
- No changes to `src/tools/confirmation-gate.ts`.
- No changes to tool exposure in `src/tools/tools-builder.ts`.

## Scope

Files in scope:

- `src/tools/apply-youtrack-command.ts`
- `tests/tools/youtrack-command.test.ts`

Files out of scope unless unexpected evidence appears during implementation:

- `src/providers/youtrack/operations/commands.ts`
- `src/tools/confirmation-gate.ts`
- `src/tools/tools-builder.ts`

## Design

### Execution Behavior

`apply_youtrack_command` continues to support single-issue execution only.

The tool must take this branch order:

1. If `provider.applyCommand` is unavailable, throw the existing unsupported error.
2. If `taskIds.length > 1`, return a normal tool failure result and stop.
3. Otherwise, continue with the existing single-issue confirmation and execution flow.

This means bulk requests do not enter the confirmation path at all.

### Failure Shape

The multi-issue rejection should use the repo’s normal tool-failure style rather than `confirmation_required`.

The failure message should be explicit and actionable. It should tell the model and user that:

- bulk YouTrack commands are disabled for safety
- structured tools should be used when possible
- otherwise the command must be run one issue at a time

The exact wording can be implementation-level, but it must communicate all three points clearly.

### Single-Issue Behavior

Single-issue behavior remains unchanged:

- allowlisted safe commands may still run immediately
- non-allowlisted commands may still use the existing confirmation gate
- `comment` and `silent` still use the current single-issue safeguards

### Internal Structure

Keep the change local to `src/tools/apply-youtrack-command.ts`.

Do not add new abstractions for bulk confirmation. The simplest correct implementation is an early guard that rejects multi-issue input before the existing confirmation logic runs.

## Testing Strategy

Follow TDD for the change.

Add or update focused tests in `tests/tools/youtrack-command.test.ts` for at least these cases:

1. multi-issue input returns a structured tool failure result
2. the failure message states that bulk commands are disabled for safety
3. `provider.applyCommand` is not called for multi-issue input
4. single-issue allowlisted behavior still works unchanged
5. single-issue guarded behavior for non-allowlisted commands, comments, and `silent` still works unchanged

No provider-layer test changes are expected because the provider contract does not change.

## Risks And Mitigations

### Risk: bulk callers may assume confirmation still exists

Mitigation:

- return a clear failure message instead of `confirmation_required`
- state explicitly that bulk commands are disabled, not awaiting confirmation

### Risk: implementation accidentally changes single-issue behavior

Mitigation:

- keep existing single-issue regression tests intact
- add one explicit bulk-vs-single contrast in the tool test suite

## Acceptance Criteria

- Any `apply_youtrack_command` call with `taskIds.length > 1` returns a normal tool failure result.
- Bulk requests do not call `provider.applyCommand`.
- Bulk requests do not return `confirmation_required`.
- Single-issue behavior remains unchanged.
- Focused tool tests cover the new bulk-disabled boundary.
