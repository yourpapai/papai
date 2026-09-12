<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Shape review-loop fixes toward the minimum, and measure when they are not

## Why

The review loop has no notion of a fix being *bigger than the problem*. `filterActionable`
(`review-round.ts:47`) admits on ledger **status**, never worth, and the inspector that follows
is a relevance gate [ADR-0303](../../../docs/adr/0303-review-loop-parallel-fixes-inspector.md)
deliberately scoped away from quality. Nothing shapes a fix toward the smallest thing that
works, or notices when one lands with no check behind it.

PR #272 is the cost made visible. Of 17 fix commits, **6 shipped no test** in a repo whose hook
mandates test-first; one (`42413ce`) fixed a logging gap with a module-scope `pino` logger in a
fully DI-seamed package; and one (`0c372ce`) wrote an architecture paragraph that `b3fc19a`
invalidated two hours on. All passed every gate: they built, and addressed the issue. That doc
claim is uncorrected on PR #272: no actor sees two fixes, and the terminal round's are never
reviewed.

## What Changes

- **Prompt-side (prevention).** `buildFixPrompt` and the two retry prompts gain a minimality
  ladder applied *after* the fixer understands the problem — must it exist, is it already
  here, can it be one line — and a standing requirement that non-trivial logic leaves
  **one runnable check** behind, resolved against the repo's TDD test-path mapping. The
  existing "do NOT edit the plan/spec" prohibition extends to architecture prose: report a doc
  gap, do not write one.
- **Orchestrator-side (measurement).** One **advisory** boolean per accepted fix: did the diff
  touch a test path? It exists to measure whether the check-behind rule works. `measureDiffSince`
  (`diff-stats.ts`) already runs `git diff --numstat` and discards the paths; this reads what is
  collected, and annotates the ledger, summary, and `metrics.json`.
- **The signal never blocks a merge or consumes retry budget.**

## Capabilities

### New Capabilities

- `review-loop-fix-quality`: the instruction contract the loop gives a fixer, and the per-fix
  signal recorded with the result.

### Modified Capabilities

None.

## Impact

`review-loop/src/`: `prompt-templates.ts`, `diff-stats.ts`, `issue-processor-attempts.ts`,
`commit-attempt.ts`, `summary.ts`, `trace-log.ts`; tests under `tests/review-loop/`. Docs:
`review-loop/CLAUDE.md`, plus an ADR on why the inspector was rejected as host.

`diff-stats.ts` is **shared** with `mutation-improve` (`merge-stats.ts`, `pipeline.ts`), whose
`reportMergeDiff` swallows failures — a breaking change there degrades silently. The path read
must be additive, never a changed `DiffStats` shape.

**Scope impact: none.** Local developer tooling — no platform instance, no task instance, and
no per-user, group-shared, or thread-isolated state.

## Non-goals

- **Putting proportionality in the inspector.** Its unified `MAX_ATTEMPTS = 2`
  (`issue-processor-attempts.ts:190-204`) turns a second rejection into `needs_human`: a
  correct-but-oversized fix would be **discarded**, and a build retry spent on it.
- **Separate retry budgets** — ADR-0303 Option 3, already rejected.
- **Diff-size, new-dependency and new-migration flags** — they measure no rule adopted here, and
  would have flagged `ddb7951`, the run's best commit.
- **Machinery to detect cross-fix incoherence** — the prose prohibition removes the class instead.
- A reachability/exposure admission gate; the `mutation-improve` workspace.
