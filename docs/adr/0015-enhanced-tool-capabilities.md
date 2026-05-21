<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0015: Enhanced Tool Capabilities (Phase 02)

## Status

Accepted

## Date

2026-03-20

## Context

After the initial tool set was built against the Kaneo provider, several correctness and cross-provider parity gaps were identified:

1. All tool descriptions and field descriptions in `src/tools/` contained the string "Kaneo", making them provider-specific. The LLM was exposed to internal provider terminology ("frontmatter", "Kaneo label", "Kaneo task ID"), which is incorrect when the active provider is YouTrack.
2. `YouTrackProvider` declared the `tasks.relations` capability but did not implement `updateRelation`, causing a runtime crash when the LLM called `update_task_relation` against a YouTrack deployment.
3. `get_task` described the task's content but did not instruct the LLM to also call `get_comments` when the user requested "full details", resulting in incomplete responses.

These gaps meant the system was functionally broken for YouTrack `update_task_relation` calls and produced suboptimal LLM behaviour in other cases.

## Decision Drivers

- Tool descriptions are the LLM's only interface to the task tracker; provider-specific terminology leaking into descriptions produces incorrect model behaviour for non-Kaneo deployments
- A runtime crash in YouTrack's `updateRelation` must be resolved before the feature is usable
- Fixing descriptions is a string-replacement exercise with no logic changes, minimising risk
- Test assertions that hardcode old description strings must be updated in the same diff to avoid CI breakage

## Considered Options

### Option 1: Fix `updateYouTrackRelation` as remove + add (chosen for G2)

- **Pros**: Uses existing tested primitives (`removeYouTrackRelation`, `addYouTrackRelation`); consistent result; no new API endpoints
- **Cons**: Two API round trips; non-atomic — if `removeYouTrackRelation` succeeds but `addYouTrackRelation` fails, the relation is left in a deleted state

### Option 2: Split `tasks.relations` capability into sub-capabilities (`tasks.relations.add`, `.remove`, `.update`)

- **Pros**: Semantically precise; YouTrack could advertise `.add` and `.remove` without `.update` and never register `update_task_relation`
- **Cons**: Breaking change to the `Capability` union type and `makeTools`; more invasive than the immediate fix needed

### Option 3: Provider-conditional tool descriptions

- **Pros**: Each provider could show a perfectly tailored description
- **Cons**: Adds conditional logic to every tool file (20+); increases maintenance burden; the simplest solution (generic language) makes provider-specific branching unnecessary

## Decision

1. **G1/G4/G5/G7 (tool description coupling)**: Replace all hardcoded "Kaneo" strings, "frontmatter" references, and provider-specific labels in `src/tools/` with generic terms ("task tracker", "task", "task ID"). Update corresponding test assertions.
2. **G2 (YouTrack `updateRelation` crash)**: Implement `updateYouTrackRelation` in `src/providers/youtrack/relations.ts` as a sequential `removeYouTrackRelation` + `addYouTrackRelation` call. Wire it into `YouTrackProvider.updateRelation`. Document the non-atomic caveat with a code comment.
3. **G3 (full task details guidance)**: Update `get_task` description to explicitly state that comments are retrieved separately via `get_comments`.

## Rationale

Generic tool descriptions decouple the LLM's mental model from any specific task tracker. The remove-then-add approach for `updateYouTrackRelation` is the minimal correct fix; the capability sub-splitting refactor is deferred to a future capabilities overhaul. Both changes are verifiable with grep assertions and unit tests.

## Consequences

### Positive

- No occurrences of "Kaneo", "frontmatter", or "archived label" remain in tool `description` strings
- `update_task_relation` no longer crashes for YouTrack users
- LLM consistently calls `get_comments` alongside `get_task` when full task details are requested
- Tests that previously asserted on provider-specific strings now assert on generic strings, making them provider-agnostic

### Negative

- `updateYouTrackRelation` is non-atomic: a failure after remove but before add leaves a missing relation; this is documented in the implementation but not auto-recovered
- Tool descriptions are now generic and lose the precision that came from naming the provider explicitly (acceptable trade-off for cross-provider correctness)

## Implementation Status

**Status**: Implemented

Evidence:

- `src/tools/` — grep for "Kaneo" returns zero matches across all tool description strings; `add-task-relation.ts` no longer mentions "frontmatter"; `archive-task.ts` no longer mentions "archived label"
- `src/tools/get-task.ts` line 13 — description reads: `'Fetch complete details of a single task including description, status, priority, assignee, due date, and relations. For a full picture including comments, also call get_comments with the same task ID.'`
- `src/providers/youtrack/relations.ts` lines 19–35 — `updateYouTrackRelation` implemented as remove + add
- `src/providers/youtrack/index.ts` line 164 — `updateRelation` method delegates to `updateYouTrackRelation`
- Tests in `tests/tools/` and `tests/providers/youtrack/` updated to assert on provider-neutral strings

## Related Plans

- `/Users/ki/Projects/experiments/papai/docs/plans/done/2026-03-20-phase-02-enhanced-tool-capabilities.md`
