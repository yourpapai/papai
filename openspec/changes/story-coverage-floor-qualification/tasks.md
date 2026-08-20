<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Restore the Tier 0 floor and record its baseline

## 1. Capture the input

- [ ] 1.1 Record the below-floor report as the task input:
      `bun test:stories:coverage`. Confirm exit code 1, the
      `T0 uncovered production files:` block, and that
      `scripts/story/coverage-floor.json` is unmodified.
      Verify: report captured under `reports/stories/`

## 2. Analytics story coverage

- [ ] 2.1 Stories for the aggregate-lane snapshot path
      (`src/analytics/jobs/snapshot.ts`, `snapshot-copy.ts`,
      `src/analytics/governance/snapshot-consumer.ts`), two oracles each.
      Verify: `bun test:stories` and `bun test:stories:coverage` (lines and
      functions both strictly above the previous run)
- [ ] 2.2 Stories for `src/analytics/governance/preference-store.ts` and
      `src/analytics/storage/event-store.ts`, including retention and the
      denial paths.
      Verify: `bun test:stories:coverage`
- [ ] 2.3 Stories for `src/analytics/jobs/derive.ts`,
      `src/analytics/derive/write.ts`, `src/analytics/jobs/backfill.ts`, and
      the denial branches of `src/analytics/governance/collection-store.ts`
      reachable without a granted eligibility ref. Do not seed
      `setEligibilityState` from a story.
      Verify: `bun test:stories:coverage`

## 3. Chat entrypoint coverage

- [ ] 3.1 Stories for `src/chat/mattermost/link-resolver.ts`,
      `src/chat/discord/index.ts`, and `src/chat/telegram/index.ts` as needed
      to clear both floors.
      Verify: `bun test:stories:coverage` exits 0 with lines >= 71.00% and
      functions >= 70.00%

## 4. Catalog and ledger records

- [ ] 4.1 Register each new story in `tests/stories/catalog/coverage.ts` and
      add its behavior-ledger entry in `tests/stories/catalog/behaviors.ts`;
      no `blocked:missing-implementation` or `retired` entry is used as
      evidence.
      Verify: `bun test:stories:contracts`

## 5. Record the qualification baseline

- [ ] 5.1 Verify the full foundation: `bun test:stories:contracts`,
      `bun test:stories:coverage`, `bun test:stories:manifest`; confirm
      `reports/stories/manifest.json` has a non-empty `treeHash`. Commit the
      frozen input set (`tests/stories`, `scripts/story`, `scripts/coverage`,
      `bunfig.toml`, `tests/setup.ts`, `tests/mock-reset.ts`,
      `tests/utils/test-helpers.ts`, `tests/utils/logger-mock.ts`) with
      nothing unrelated staged. That commit is the baseline candidate.
      Verify: all three commands exit 0
- [ ] 5.2 Append a `## Foundation baseline` section to
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
