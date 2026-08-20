<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Incremental mutation measurement with a whole-branch gate

## Why

The `mutation-testing` PR gate runs `bun test:mutate:changed --base=origin/master` on every
push. That re-mutates **every** file in the branch diff from scratch, every time: 39m13s
observed on a large PR against a 90-minute job ceiling. Run 31741632357 is the cost made
visible — 22 files, 25 minutes, then a failure on one file whose Stryker dry run errored;
fixing that one file re-mutates all 22.

The obvious fix — measure only what changed since the previous push — is also the wrong one on
its own. If commit A drops file `X` below its baseline and commit B touches only `Y`, a
since-last-push gate sees a clean `Y` and goes green while `X`'s regression is still in the
branch. The gate must stay whole-branch even as measurement stops being whole-branch.

## What Changes

- New `scripts/mutation/score-cache.ts`: a content-addressed per-file score cache at
  `reports/paired/score-cache.json`, fail-open like `coverage-cache.ts`.
- New `scripts/mutation/score-fingerprint.ts`: a fingerprint over the source file's contents,
  its candidate test set's paths and contents, and a per-run toolchain hash
  (`stryker.config.json`, `overrides.json`, `bun.lock`, `scripts/mutation/**`, runner versions).
- New `scripts/mutation/incremental-run.ts`: splits branch-diff targets into *measure now* and
  *reuse*, then combines both into one gate input.
- `scripts/mutation/changed-files.ts` runs `pairedRun` on the measure-now subset only and gates
  over the union; `resolveErroredGate` / `reportGates` move to a new `scripts/mutation/gates.ts`
  (the file is at 297 of oxlint's 300-line `max-lines`).
- `scripts/mutation/score-merger.ts` gains `combineMergedScores` (pooled counts, not averaged
  scores) and `isMergedScore`.
- `.github/workflows/ci.yml`: `actions/cache` restore/save around the PR job, saving with
  `if: always()` so a failing run still persists what it measured.

Scope impact: none. This touches CI tooling only — no platform instance, no task instance, no
per-user, group-shared or thread-isolated state. The ratchet contract of
[ADR-0342](../../../docs/adr/0342-mutation-gate-pure-regression-ratchet.md) is unchanged: this
changes *when* a score is measured, never *what* the gate compares it to.

## Non-goals

- Changing ratchet or threshold semantics, the `baseline.json` format, or `resolveRatchet`.
- Fingerprinting transitive `src/` dependency changes (see design.md — an accepted hole).
- Giving the master `mutation-baseline` job a score cache; it keeps measuring fresh, which is
  what keeps the committed baseline trustworthy.
- Parallelising `pairedRun`, or touching the full-run path `scripts/mutation/all-files.ts`.
- Caching skipped or errored outcomes.
