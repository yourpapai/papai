<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 3 pure-helper stories design

Date: 2026-07-29
Status: approved

## Purpose

Design the first Phase 3 follow-up slice of hermetic Tier-0 user-story coverage
for exactly three pending catalog records:

- `SCN-memory-tool-pairing`
- `SCN-scheduler-execution-tracking`
- `SCN-changelog-version-section`

The Phase 3 catalog foundation already records all three as pending,
`executable-as-is` gaps. This slice describes the future coverage that may
promote only those records. It does not itself add a story, fixture, catalog
mapping, plan, or runtime change.

## Scope and non-goals

The future implementation adds one Tier-0 story file under
`tests/stories/pure-helpers/`, with exactly three independent literal
`scenario(...)` calls. Each scenario invokes its exported production helper
directly with in-memory values. It is a user-story-level statement of a
subsystem contract, without routing through a broader runtime flow.

Excluded from this slice:

- chat, task-provider, and LLM runtime composition;
- scheduler loops, timers, recurrence, and delivery;
- announcement drafting, humanization, database persistence, and delivery;
- filesystem access through `src/changelog-reader.ts`;
- new fixture APIs, dependency-injection seams, or test-only production code;
- any catalog promotion or claim for a sibling Phase 3 ID.

## Future scenario boundaries

| Catalog ID | Literal story boundary | Production entry point |
| --- | --- | --- |
| `SCN-memory-tool-pairing` | A memory-retention decision keeps valid tool exchanges intact and never leaves retained history starting with a tool result. | `resolveTrimmedIndices` and `isValidToolSequence` from `src/memory-tool-pairing.ts` |
| `SCN-scheduler-execution-tracking` | A scheduler's active-execution registry includes in-flight work and clears it after either fulfillment or rejection. | `trackSchedulerExecution` from `src/utils/scheduler.executions.ts` |
| `SCN-changelog-version-section` | Release-note lookup returns only the requested release's body, stops before the next release, and returns `null` for an absent version. | `extractChangelogSection` from `src/utils/changelog.ts` |

Each literal scenario is mapped only to its corresponding ID. Passing one
scenario must not make a catalog claim for either of the other two.

## Scenario behavior and edge cases

### Memory tool pairing

The story supplies model-message history and requested retained indices in
memory. It verifies that selecting only a tool call retains its matching result,
and selecting only a result retains its matching call. An orphan result or a
truncated exchange is excluded. Under a restrictive maximum, complete
exchanges are removed oldest-first rather than split. The resulting history must
pass `isValidToolSequence` and must not begin with a `tool` role message.

This is limited to retention normalization. It does not prove memory capture,
LLM selection, compaction, persistence, or message delivery.

### Scheduler execution tracking

The story uses an initially empty `Set<Promise<void>>` and manually controlled
promises. Tracking a pending execution must add it immediately and return the
same promise. One branch fulfills and one rejects; after observing settlement,
each must be absent from the active set. The rejection is explicitly observed
by the story so the hermetic runner does not report an unhandled rejection.

This does not prove task scheduling, retry policy, timer cleanup, or scheduler
shutdown. Those have broader runtime and operational boundaries.

### Changelog version section

The story supplies multi-version Markdown directly. A matching version returns
only its body, excluding the requested header and the subsequent release header
and body. A final release extends through end of content. A missing exact
version returns `null`. Matching remains the current helper contract of a
`## [<version>]` prefix; the story does not establish any new changelog grammar
or normalization policy.

`src/changelog-reader.ts` is related evidence only. Reading `CHANGELOG.md` is
intentionally outside this extraction scenario.

## Architecture and seams

No new seam is required. The production helpers already expose every input the
stories need:

- memory pairing takes history, selected indices, and bounds;
- scheduler tracking takes a promise and optional active-execution set;
- changelog extraction takes a version and content string.

Thus all state is deterministic and local to each scenario. Adding a harness
fixture or routing through announcements/scheduler consumers would introduce
unrelated I/O, runtime dependencies, or behavior claims. The existing Tier-0
scenario wrapper is sufficient for lifecycle and hermeticity; no application
world, transport, database, clock, filesystem, or environment setup is needed.

## Catalog and verification

The later implementation will add one executable Tier-0 mapping per literal
scenario and move only these three records from `AUDIT_RECORDS` pending status
to executable mappings, with its implementation verification date. It must not
broaden an existing ID or add mappings for adjacent helper consumers.

The implementation's verification sequence is:

1. Run the story-contract lane to validate the catalog census and literal
   mapping rules.
2. Run `bun test:stories:contracts`.
3. Run `bun test:stories` to execute the hermetic stories.
4. Follow the established frozen-story baseline and compatibility procedure
   after the change merges.

The story file and catalog mapping are frozen Tier-0 inputs, so compatibility
evidence is required for the eventual implementation. This design makes no
executable coverage claim.
