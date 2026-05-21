<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0070: Silent PostToolUse + Stop-Gated Full Check

## Status

Accepted

## Date

2026-04-16

## Context

PostToolUse hooks send detailed test failure output, coverage regression reports, and API surface diffs back to the LLM on every file edit. This costs input tokens without proportional value — the LLM often fixes the issue on its own, or the same failure is reported multiple times as it iterates.

The existing PostToolUse pipeline runs `verifyTestsPass` (test execution + coverage regression) and `verifyNoNewSurface` (API surface diff) on every Write/Edit/MultiEdit. Each invocation:

1. Spawns a `bun test` process for the changed file
2. Compares coverage baselines
3. Diffs API surface snapshots
4. Returns detailed output to the LLM context window

For a typical multi-edit session this runs 5-15 times, each time consuming hundreds of input tokens with repetitive failure details.

## Decision Drivers

- Reduce per-edit token cost from PostToolUse hooks
- Maintain quality enforcement (lint, typecheck, format, tests, knip, duplicates)
- Provide a concise failure summary instead of raw output
- Allow user interrupt escape hatch when the LLM is blocked
- Keep PreToolUse fast static checks (write policy, TDD gate) unchanged
- Keep PostToolUse fast static checks (test-write tracking, test-import verification) unchanged

## Considered Options

### Option 1: Keep per-edit checks but reduce output verbosity

- **Pros**: Minimal change, existing pipeline preserved
- **Cons**: Still spawns test processes on every edit, token cost proportional to edit count, latency per edit

### Option 2: Batched periodic checks during session

- **Pros**: Fewer check invocations
- **Cons**: No natural trigger point mid-session, complex timing logic, unclear when to report results

### Option 3: Shift all enforcement to a single Stop hook (chosen)

- **Pros**: Zero per-edit cost, single comprehensive check, concise parsed summaries, natural trigger point (LLM finishing)
- **Cons**: LLM receives no feedback between edits, must fix all issues at once after Stop blocks

## Decision

PostToolUse no longer runs tests or diffs API surfaces. All quality enforcement shifts to a single `Stop` hook that runs `bun check:full` once when the LLM finishes responding.

### Session flag

A `needsRecheck` boolean stored in `SessionState` coordinates PreToolUse and Stop:

- **PreToolUse** sets `needsRecheck = true` — signals "LLM made changes, verify on next Stop"
- **Stop** reads the flag to decide behavior

### Stop flow

1. Read `needsRecheck` from session state
2. If `false` → LLM was blocked and did nothing → user interrupt → reset flag to `true`, allow stop
3. If `true` → run `bun check:full`
4. If check passes → allow stop
5. If check fails → set `needsRecheck = false`, block with a concise failure summary

### Failure message format

The Stop hook parses `check:full` output into a structured summary:

```
`bun check:full` found issues. Fix before stopping:

- lint: 2 files (src/foo.ts, src/bar.ts)
- typecheck: 1 file (src/qux.ts)

Run `bun check:full` for details.
```

### Escape hatch

The `needsRecheck` flag prevents infinite prompt loops. It can only be `false` across two consecutive Stop events if no PreToolUse fired in between — which only happens on user interrupt. Any LLM activity (PreToolUse) resets it to `true`.

## Rationale

Shifting enforcement to the Stop hook eliminates the N×token cost (where N is the number of edits) and replaces it with a single check. The LLM still receives feedback — just once at the end instead of per-edit. In practice, the LLM usually fixes issues on its own during iteration, making per-edit reports redundant.

The `needsRecheck` flag provides a clean state machine: PreToolUse writes `true`, Stop reads and conditionally writes `false`. The only path to two consecutive Stops with no intervening PreToolUse is a user interrupt, which should be allowed.

## Consequences

### Positive

- Per-edit PostToolUse cost drops to near-zero (only fast static checks remain)
- Single comprehensive `bun check:full` at session end catches everything
- Concise parsed summaries reduce token waste vs raw output
- User interrupt escape hatch prevents being locked in a block loop

### Negative

- LLM receives no incremental feedback between edits
- If multiple issues exist, the LLM must fix them all before Stop succeeds (no single-issue-at-a-time feedback)
- Adds a `Stop` hook dependency to `.claude/settings.json`
- Session state gains a new persistent field (`needsRecheck`)

### Risks

- **LLM may struggle with batch fixes**: Without per-edit feedback, the LLM might introduce cascading issues. Mitigation: the concise summary includes affected file paths to guide fixes.
- **Stop hook timeout**: `check:full` takes time; the 300s timeout should suffice but may need tuning for large codebases.

## Implementation Notes

### Files created

- `.hooks/tdd/checks/parse-check-output.mjs` — parser for `check:full` output
- `.claude/hooks/stop.mjs` — Stop hook orchestrator
- `.hooks/tests/tdd/checks/parse-check-output.test.ts` — parser tests
- `.hooks/tests/tdd/checks/check-full.test.ts` — formatCheckResult tests

### Files modified

- `.hooks/tdd/session-state.mjs` — `needsRecheck` field + getter/setter
- `.hooks/tdd/checks/check-full.mjs` — `formatCheckResult` export, uses parser
- `.claude/hooks/pre-tool-use.mjs` — removed baseline/surface, added `setNeedsRecheck(true)`
- `.claude/hooks/post-tool-use.mjs` — removed test run and surface diff
- `.claude/settings.json` — registered Stop hook

## Related Decisions

- **ADR-0043** (TDD Hooks Integration) — established the hook pipeline that this decision refines
- **ADR-0028** (Staged-Only Pre-Commit Checks) — pre-commit philosophy of running checks at the right time

## References

- Design: `docs/superpowers/specs/2026-04-16-silent-post-hooks-stop-gate-design.md`
- Plan: `docs/superpowers/plans/2026-04-16-silent-post-hooks-stop-gate.md`
