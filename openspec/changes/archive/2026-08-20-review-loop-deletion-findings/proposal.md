<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Let the reviewer report over-engineering, without letting it outrank a defect

## Why

The loop is asymmetric. Its fixer was taught to reach for the smallest thing that works
(`MINIMALITY_LADDER`, shipped in `8d22c58`), but its reviewer cannot report that the code
*already there* is over-built. `buildReviewPrompt` (`prompt-templates.ts:70`) scopes findings
to "bugs, security, error-handling gaps, plan-conformance, and violations of the repo
conventions in AGENTS.md", and explicitly puts "correct but I would write it differently"
out of scope. A single-implementation interface, a hand-rolled reimplementation of something
`zod` or the standard library ships, or a helper with no caller are none of the admitted
kinds and are all plainly not style preferences.

So the ladder only ever shrinks fixes the loop was already making. Nothing it reads gets
smaller.

## What Changes

- **A bounded deletion vocabulary.** The reviewer may report five kinds — `delete`,
  `stdlib`, `native`, `yagni`, `shrink` — and each finding must name what replaces the cut.
  A finding that cannot name a replacement is not reportable, the same discipline the
  exposure rule already imposes by demanding a cited caller rather than a rating.
- **A `kind` on every issue.** `defect` (everything the reviewer reports today) or
  `cleanup` (the five above). The reviewer sets it; the fixer never changes it.
- **Ordering becomes kind-first.** `orderByExposure` (`issue-processor.ts:185`) sorts on
  exposure alone today, so a cleanup with a cited caller would be dispatched *ahead of* a
  critical bug whose caller nobody found. Every defect is dispatched before any cleanup;
  exposure orders within each group, exactly as it does now.
- **Cleanups are capped at `medium` severity.** Severity grades what happens if the code
  is reached; an abstraction with one implementation does not crash.
- **A run that stops early loses cleanups first**, which is the intended behaviour rather
  than a regression: `runTimeoutMs` and `SIGINT` stop the loop between issues, and ordering
  is the whole of what a stopped run spends.

## Capabilities

### New Capabilities

- `review-loop-deletion-findings`: what the reviewer may report as over-engineering, the
  evidence a cleanup finding must carry, and how cleanups are ordered against defects.

### Modified Capabilities

None. `review-loop-fix-quality` (in `openspec/changes/review-loop-fix-proportionality/`)
governs what the *fixer* is told; nothing there changes. The fixer's existing "edit only
what is necessary — no drive-by refactors; scope edits to targetFiles" already contains a
cleanup correctly: for these findings the cleanup *is* the necessary edit.

## Impact

`review-loop/src/`: `prompt-templates.ts` (`buildReviewPrompt`), `issue-schema.ts` (the
`kind` field), `issue-processor.ts` (ordering), `issue-ledger.ts`, `loop-trace.ts` and
`summary.ts` (per-kind tallies). Tests under `tests/review-loop/`. Docs:
`review-loop/CLAUDE.md`.

`issue-schema.ts` is read by the fixer result path and the ledger, which persists across
`--resume-run`; `kind` must be optional-with-default on read so a ledger written before
this change still loads. See `design.md`.

**Scope impact: none.** Local developer tooling — no platform instance, no task instance,
and no per-user, group-shared or thread-isolated state.

## Non-goals

- **A repo-wide audit command.** `knip` already finds unused exports and `jscpd` runs at a
  zero-tolerance duplication threshold; a third, weaker, LLM-driven sweep over the same
  ground earns nothing.
- **Auto-applying deletions outside the review loop**, or any batch "delete everything
  flagged" mode. A cleanup goes through the same verify/fix/build path as a defect.
- **Letting a cleanup consume the `needs_human` budget differently.** `MAX_ATTEMPTS = 2`
  is unified deliberately (ADR-0303); a second rejection is `needs_human` for both kinds.
- **Blocking a merge on cleanup count**, or any gate derived from it.
- **Making the fixer hunt for cleanups on its own.** It fixes the issue it was given.
- Diff-size measurement, already rejected with a named counter-example in
  `review-loop-fix-proportionality`'s non-goals.
