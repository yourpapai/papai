<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Restore the Tier 0 coverage floor and record its qualification baseline

## Why

`bun test:stories:coverage` is red on this branch: lines 68.76% against a
71.00% floor, functions 65.87% against 70.00%. The floor was not lowered — the
master merge added production files the frozen story lane never loads, and
`meanMetric` (`scripts/coverage/ratchet-lib.ts`) is an unweighted mean of
per-file ratios, so file count alone moved the number. The twelve worst files
are entirely `src/analytics/**` and three chat adapter entrypoints, all at 0
covered functions.

Separately, the coverage foundation shipped its diagnostics, behavior ledger,
and catalog cross-check, but never recorded the qualification baseline the
foundation exists to produce. Without a recorded `baselineSha` and frozen
`treeHash`, `test:stories:compat` has no immutable reference, so no future
global refactor can be qualified against the harness — the foundation's whole
purpose is unrealised.

## What Changes

- Add durable Tier 0 stories for the uncovered runtime boundaries the
  diagnostic report names, each asserting one user-visible oracle and one
  system oracle, until `bun test:stories:coverage` passes at the existing
  floors. Do not lower `scripts/story/coverage-floor.json`.
- Verify the full foundation on the resulting commit
  (`test:stories:contracts`, `test:stories:coverage`, `test:stories:manifest`),
  then record the literal `baselineSha` and `treeHash` plus verified commands
  in `docs/superpowers/specs/2026-08-04-global-refactor-behavior-coverage-roadmap-design.md`.
- Prove compatibility against the recorded baseline with
  `BASE_REF=<sha> bun test:stories:compat --manifest-only` and the full
  `test:stories:compat`.

## Capabilities

### New Capabilities

- `story-coverage-floor-qualification` — the recorded, immutable Tier 0
  qualification baseline plus the restored floor it is recorded at. Without it
  the story lane stays red and `test:stories:compat` has no reference commit,
  so refactor branches cannot be qualified at all.

### Modified Capabilities

None. `openspec/specs/` has no entry for the story coverage lane.

## Non-goals

- Lowering either floor value, or reweighting `meanMetric` to hide the merge
  dilution — declined: the mean is the agreed metric and the dilution is real
  uncovered code.
- Tier 1–4 lane coverage, adapter scenarios, or CI lane-admission mapping —
  those are separate follow-on changes (`tier3-chat-adapter-coverage` covers
  the Tier 3 slice).
- Closing the analytics collection-eligibility production gap that blocks
  canonical-event stories — declined here, tracked as
  `analytics-collection-eligibility-grant`; this change routes around it by
  covering analytics paths that do not require a granted eligibility ref.
- Any production behavior change. Stories are added; runtime code is not.

## Impact

- **Tests:** new/extended `tests/stories/**/*.story.test.ts` plus additive
  records in `tests/stories/catalog/coverage.ts` and
  `tests/stories/catalog/behaviors.ts`.
- **Production code / DB / deps / scope model:** none.
- **Platform instances:** none directly; the uncovered chat entrypoints
  (`src/chat/discord/index.ts`, `src/chat/telegram/index.ts`,
  `src/chat/mattermost/link-resolver.ts`) gain story coverage without
  behavior change.
- **Docs:** baseline evidence appended to
  `docs/superpowers/specs/2026-08-04-global-refactor-behavior-coverage-roadmap-design.md`.
- **Legacy:** adopts the residual Tasks 2 and 5 of
  `docs/archive/2026-08-04-global-refactor-coverage-foundation.md`
  (delete-on-adopt, same commit); Tasks 1, 3, and 4 already shipped.
