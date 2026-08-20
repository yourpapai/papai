<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Re-record the Tier 0 floor and its baseline

## 1. Capture the input

- [x] 1.1 Record the below-floor report as the task input:
      `bun test:stories:coverage`. Confirm exit code 1, the
      `T0 uncovered production files:` block, and that
      `scripts/story/coverage-floor.json` is unmodified.
      Verify: report captured under `reports/stories/`

## 2. Size the deficit

- [x] 2.1 Convert the gap to file-units against the gate's own scope
      (`scopeLcov` + `discoverScopedSourceFiles`) and record the result in
      proposal.md: one covered file is worth 1/N of the mean, so the deficit is
      a file count, not a percentage. Compare it against the total headroom in
      the diagnostic-named files plus every never-loaded file.
      Verify: the recorded deficit exceeds that combined headroom, which is why
      the floor is re-recorded rather than climbed
- [x] 2.2 Establish why the mean fell: compare the scoped source-file count at
      the commit that last raised the floor against HEAD, and confirm no story
      files were removed.
      Verify: both counts and the story-file delta recorded in proposal.md

## 3. Re-record the floor

- [x] 3.1 Write `scripts/story/coverage-floor.json` with the values the
      ratchet's own `nextFloor` epsilon convention yields for the measured run
      (`floor((measured - 0.005) * 100) / 100`): lines 0.68, functions 0.65.
      No change to `meanMetric`, `story-scope.ts`, or any story file.
      Verify: `bun test:stories:coverage` exits 0
- [x] 3.2 Confirm the ratchet still refuses to lower on its own, so the new
      value can only regress by another reviewed edit.
      Verify: `bun coverage:ratchet:stories` reports the floor unchanged

## 4. Hand off the climb

- [x] 4.1 Record the residual coverage work as its own OpenSpec change, sized
      against the measured function deficit and naming the files that hold the
      headroom. Point the archived foundation plan's residual section at it.
      Verify: `openspec validate <successor> --strict` exits 0

## 5. Record the qualification baseline

- [x] 5.1 Verify the full foundation: `bun test:stories:contracts`,
      `bun test:stories:coverage`, `bun test:stories:manifest`; confirm
      `reports/stories/manifest.json` has a non-empty `treeHash`. Commit the
      frozen input set (`tests/stories`, `scripts/story`, `scripts/coverage`,
      `bunfig.toml`, `tests/setup.ts`, `tests/mock-reset.ts`,
      `tests/utils/test-helpers.ts`, `tests/utils/logger-mock.ts`) with
      nothing unrelated staged. That commit is the baseline candidate.
      Verify: all three commands exit 0
- [x] 5.2 Append a `## Foundation baseline` section to
      `docs/superpowers/specs/2026-08-04-global-refactor-behavior-coverage-roadmap-design.md`
      with the literal baseline SHA, the literal frozen tree hash, and the
      verified command list. No shell variable names remain in the document.
      Verify: `grep -n '\$' ` on the added section returns nothing
- [ ] 5.3 Prove compatibility:
      `BASE_REF=<baselineSha> bun test:stories:compat --manifest-only` then
      `BASE_REF=<baselineSha> bun test:stories:compat`.
      Verify: both exit 0

## 6. Close out

- [ ] 6.1 Run `bun test`, `bun run typecheck`, `bun run lint`, and
      `bun run check:full`; update `docs/architecture/commands.md` if the
      recorded baseline changes how the compat commands are invoked.
      Verify: all commands exit 0
