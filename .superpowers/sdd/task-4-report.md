# Task 4 Report — Promote The Three Callback Records And Register The Lane

**Status:** Complete. RED observed, GREEN reached, committing on `hermetic-stories-continue`.

## What was delivered

Promoted the three Tier-3 callback scenarios from `needs-seam` pending audit
records to executable `provingTier: '3'` catalog records, registered them in the
platform lane registry, wired their scenario files into the runner, and refreshed
every exact catalog total. The two scenario files
(`discord-callback-routing.platform.ts`, `telegram-callback-routing.platform.ts`)
and their fakes were committed by Tasks 2 and 3 and were not touched; this task
owns only the registry / aggregator / crosscheck / catalog-contract layer.

The three records moved out of `AUDIT_RECORDS` (state `needs-seam`,
seam `platform-adapter-fakes`, `unblockedByTier '3'`) into
`EXECUTABLE_STORY_MAPPINGS` with `provingTier: '3'`, story ids derived as
`${file}#${title}` (byte-identical to each scenario's `title('SCN-*')` marker).
Their `catalogStatus` stays `forward-only` — they join `SCN-http-mattermost-action`
as forward-only-but-executable records, so the frozen interaction-status array is
unchanged. All 22 `blocked` pending records are preserved verbatim.

## Files

Code / contracts (6):

- `tests/platform/scenarios/catalog.ts` — added `DISCORD_CALLBACK_ROUTING` /
  `TELEGRAM_CALLBACK_ROUTING` file constants, registered the three ids in
  `PLATFORM_STORIES` with byte-exact titles, appended the three callback source
  modules to `PLATFORM_COVERAGE_FILES`.
- `tests/platform/run-platform.ts` — imported the two new `.platform.ts` files.
- `tests/platform/catalog-crosscheck.test.ts` — `t3` length `8 → 11`, added the
  three ids to the required-membership list, `PLATFORM_COVERAGE_FILES` expectation
  extended by the three modules.
- `tests/stories/catalog/coverage.ts` — moved the three records into
  `EXECUTABLE_STORY_MAPPINGS` (`verifiedAt 2026-08-02`, `provingTier '3'`);
  removed the three `needs()` entries from `AUDIT_RECORDS`; removed the now-dead
  `needs` helper and the orphaned `// F8` section header.
- `tests/stories/harness/catalog-coverage.test.ts` — executable `198 → 201`
  (two sites), pending `25 → 22`, `needs-seam 3 → 0`, seam-pending projection
  `[…] → []`, plus an explicit assertion that no `SCN-interaction-*` id remains
  pending.
- `tests/scripts/story-coverage-totals.test.ts` — downstream catalog-totals
  contract refreshed (see Deviation note).

Plus this report.

## Records promoted (registry id → catalog story id)

- `SCN-interaction-discord-router-wrapped` →
  `tests/platform/scenarios/discord-callback-routing.platform.ts#routes a Discord permission callback through ChatRouter and production setupBot`
- `SCN-interaction-discord-standalone-fallback` →
  `tests/platform/scenarios/discord-callback-routing.platform.ts#defers an unmatched Discord callback to the standalone message fallback`
- `SCN-interaction-telegram-callback` →
  `tests/platform/scenarios/telegram-callback-routing.platform.ts#routes a Telegram permission callback through ChatRouter and production setupBot`

Titles were copied byte-for-byte from the `SCENARIO_TITLES` maps committed in
Tasks 2 / 3; the crosscheck's `title('SCN-*')` file-marker test and the
one-to-one `PLATFORM_STORY_IDS` mapping both pass against them.

## Totals (before → after)

| metric                  | before | after |
| ----------------------- | ------ | ----- |
| total catalog ids       | 223    | 223   |
| executable              | 198    | 201   |
| pending                 | 25     | 22    |
| needs-seam              | 3      | 0     |
| blocked                 | 22     | 22    |
| executable T3           | 8      | 11    |
| pending unblocked-by T3 | 3      | 0     |

`executableByTier` is now `{0:152, 1:29, 2:8, 3:11, 4:1}` (sum 201); pending 22
= 0 + 0 + 22; 201 + 22 = 223.

## TDD evidence — RED

Wrote the target assertions first. Both contracts failed for the expected
reasons (registry / catalog data still at the old counts), not for typos:

```
$ bun test tests/platform/catalog-crosscheck.test.ts
 1 pass
 3 fail   # t3 length 8≠11; 3 unregistered markers; PLATFORM_COVERAGE_FILES missing 3
 11 expect() calls

$ bun test --path-ignore-patterns='' tests/stories/harness/catalog-coverage.test.ts
 20 pass
 5 fail   # executable 198≠201 (×2); pending 25≠22; seam projection […]≠[]; needs-seam 3≠0
 432 expect() calls
```

(`bunfig.toml` ignores `tests/stories/**`; the brief's override clears it. The
correct flag spelling is `--path-ignore-patterns=''`.)

## TDD evidence — GREEN

After registering the lane and moving the records:

```
$ bun test tests/platform/catalog-crosscheck.test.ts
 4 pass
 0 fail
 47 expect() calls

$ bun test --path-ignore-patterns='' tests/stories/harness/catalog-coverage.test.ts
 25 pass
 0 fail
 434 expect() calls
```

## Verification (per brief Steps 4–6 + Final Verification)

```
$ bun run test:platform                      # runs run-platform.ts (now imports 7 files)
 11 pass
 0 fail
 42 expect() calls                            # 8 original + 3 new callback scenarios

$ bun run test:stories:contracts
 426 pass
 0 fail
 1702 expect() calls

$ bun run typecheck                          # tsgo --noEmit — clean
$ bun run lint                               # oxlint — clean

$ bun test tests/smoke/catalog-crosscheck.test.ts \   # @2 crosscheck (T2=8, unchanged)
            tests/operational/catalog-crosscheck.test.ts \  # @4 crosscheck (T4=1, unchanged)
            tests/platform/catalog-crosscheck.test.ts \      # @3 crosscheck
            tests/scripts/story-coverage-totals.test.ts      # totals contract
 12 pass
 0 fail
 86 expect() calls
```

Default-discovery check (brief Step 5): `bun test --list` yields no
`tests/platform/scenarios/*.platform.ts` path — the `.platform.ts` suffix stays
non-discovered, so the default `bun test` never boots the Docker-free lane.

Mutation gate (brief Step 6): the step is conditioned on production-adjacent
source changing. Task 4's working-tree diff is entirely under `tests/`
(`git diff --name-only HEAD | rg '^(src|plugins)/'` → 0 files), so there is no
implementation source for `test:mutate:changed` to mutate on Task 4's behalf.
(Note: `scripts/mutation/changed-files.ts` diffs `origin/master...HEAD`, which on
this long-lived branch spans 15 impl files from prior tasks — not a Task-4 gate;
the Task-4 invariant is verified directly above instead.)

## Deviation — expanded `git add` by one totals contract

The brief's file list and Step-7 `git add` cover five files. A sixth file,
`tests/scripts/story-coverage-totals.test.ts`, is a direct catalog-totals
contract: it imports the live `catalogCoverage` and asserts the aggregated
executable / pending / per-tier / format-string totals. The 3-record promotion
necessarily flips those totals (198→201 executable, 25→22 pending, T3 8→11,
needs-seam 3→0), so leaving it untouched would break the default `bun test`
suite. It is not a scenario, fake, or production `src` file (the only categories
the brief prohibits), and bumping it on every catalog-count change is the
repo's established convention — documented across multiple approved plans (e.g.
`docs/superpowers/plans/2026-07-24-tier1b-e2e-parity-retrofit.md:59`, whose
per-task steps explicitly list this file among the "six literal sites" to bump).
It is therefore staged alongside the five listed files. Separately, removing the
3 `needs()` audit records left the local `needs` helper unused; per the
no-lint-disable policy the helper was deleted (typecheck + lint would otherwise
fail on `TS6133`).

## Concerns

- **Scope expansion.** One file beyond the literal five-list was edited
  (`tests/scripts/story-coverage-totals.test.ts`), for the reasons above. The
  change is mechanical and total-preserving; flagged only because it is outside
  the brief's enumerated set.
- **Mutation gate not run branch-wide.** A literal `bun run test:mutate:changed`
  invocation is not Task-4-scoped on `hermetic-stories-continue` (it would
  re-mutate 15 prior-task impl files against `origin/master`). The Step-6 intent
  — confirm Task 4 changed no production source — was verified directly via
  `git diff`; no `src/`/`plugins/` file is in the commit.
- **`verifiedAt` date.** The three new executable records are stamped
  `2026-08-02` (today, matching the Phase-4 records already on the branch). No
  contract asserts a `verifiedAt` for Tier-3 records.
