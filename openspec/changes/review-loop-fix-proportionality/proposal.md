<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Shape review-loop fixes toward the minimum, and measure when they are not

## Why

The review loop has no notion of a fix being *bigger than the problem*. Its only admission
gate, `filterActionable` (`review-loop/src/review-round.ts:47`), filters on ledger **status**,
never on worth; the inspector that follows is a relevance gate whose prompt is deliberately
scoped away from quality by [ADR-0303](../../../docs/adr/0303-review-loop-parallel-fixes-inspector.md)
("explicit anti-scope-creep language"). So nothing shapes a fix toward the smallest thing that
works, and nothing notices when one lands with no check behind it.

PR #272's review run is the cost made visible. Of 17 fix commits, **6 shipped no test at all**
in a repo whose Write/Edit hook mandates test-first, and one (`42413ce`) resolved a logging gap
by adding a module-scope `pino` logger to a package whose stated design is fully DI-seamed. Both
passed every gate: they built, and they addressed the issue.

## What Changes

- **Prompt-side (prevention).** `buildFixPrompt` and the two retry prompts in
  `prompt-templates.ts` gain a minimality ladder applied *after* the fixer understands the
  problem — does this need to exist, is it already in the codebase, can it be one line — and a
  standing requirement that non-trivial logic leaves **one runnable check** behind, resolved
  against the repo's existing TDD test-path mapping.
- **Orchestrator-side (measurement).** A mechanical, **advisory** proportionality signal per
  accepted fix: diff size, new-file/new-dependency/new-migration flags, and whether a test path
  was touched. `measureDiffSince` (`diff-stats.ts`) already runs `git diff --numstat` and
  discards the file paths; this reads what is already collected. The signal annotates the
  ledger, the run summary, and `metrics.json`.
- **The signal never blocks a merge or consumes retry budget.**

## Capabilities

### New Capabilities

- `review-loop-fix-quality`: the instruction contract the review loop gives a fixer, and the
  per-fix proportionality signal the orchestrator records alongside the result.

### Modified Capabilities

None. No existing capability under `openspec/specs/` changes.

## Impact

`review-loop/src/`: `prompt-templates.ts`, `diff-stats.ts`, `issue-processor-attempts.ts`,
`commit-attempt.ts`, `summary.ts`, `trace-log.ts`; tests under `tests/review-loop/`. Docs:
`review-loop/CLAUDE.md`, plus a new ADR recording why the inspector was rejected as the host.

**Scope impact: none.** This is local developer tooling — no platform instance, no task
instance, and no per-user, group-shared, or thread-isolated state.

## Non-goals

- **Putting proportionality in the inspector.** Its unified `MAX_ATTEMPTS = 2`
  (`issue-processor-attempts.ts:190-204`) turns a second rejection into `needs_human`, so a
  correct-but-oversized fix would be **discarded** and the build-retry budget spent on it.
- **Separate retry budgets** — ADR-0303 Option 3, already rejected.
- **A reachability/exposure admission gate** — the larger half of the PR #272 finding, and its
  own change.
- Cross-fix documentation coherence; the `mutation-improve` workspace.
