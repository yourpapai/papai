# Design — exclude-research-poc-tests

Small, measurement-backed change; this design records the two real decisions (exclusion
mechanism and scope) and the frozen-file sequencing. Motivation and measurements:
[`proposal.md`](proposal.md) and `docs/research/2026-08-26-test-suite-speedup-methods.md`.

## Context

Bun's test discovery is cwd-wide — it picks up any filename containing `.test`/`_test`/`.spec`/`_spec`
anywhere in the repository (proven empirically during `test-consolidation-speed-evidence`: a
`reports/**/*.test.ts` probe was discovered and run). The 16 poc files under
`docs/research/analytics-metrics/poc/` cost 37.9 s serial per full run. `bunfig.toml` already carries
`pathIgnorePatterns` for four lanes (e2e, client, visual, stories), so the mechanism exists and is
the established one.

Constraint: `bunfig.toml` is byte-frozen during story-refactor qualifications (`tests/CLAUDE.md`,
refactor-qualification freeze list). This change is therefore **master-only sequencing**: land it
between qualifications, never on a qualification branch.

## Goals / Non-Goals

**Goals:**

- Default full run no longer discovers `docs/**` test files.
- The poc self-checks remain runnable through one documented command.
- Full-run case-count delta is exactly the 53 poc cases, provable from the persisted run report.

**Non-Goals:**

- No file renames or relocations in the poc tree (churning a documented research tree for a lane
  concern; also renames would break the `tests/analytics/intent/taxonomy.test.ts` import path).
- No per-file exclusion list — tree-level, so future research docs can't reintroduce the accident.

## Decisions

### D1 — `pathIgnorePatterns += "docs/**"` over renaming files

Alternatives considered:

- **Rename fixtures out of discovery** (e.g. `*.fixture-check.ts`) + explicit-path script: avoids
  touching the frozen `bunfig.toml` but churns 16 filenames in a research tree that other docs
  reference, and leaves the door open to the *next* `docs/**/*.test.ts` landing in discovery again.
- **Move the poc under `tests/` as a named lane**: restructures a research artifact; rejected.

The bunfig entry is one line, tree-scoped, self-documenting (the comment there names the lanes), and
matches how every other non-default lane is excluded. The freeze cost is sequencing, not design.

### D2 — `test:research` script runs them explicitly

`bun test` executes any filename when given an explicit `./`-prefixed path (the mechanism
`test:operational` and the speed-evidence benchmark both already use). The script enumerates the poc
directory explicitly (`bun test ./docs/research/analytics-metrics/poc/` with the directory argument,
verified to pick up discovered-name files under it) so no per-file list is maintained.

### D3 — Evidence of the delta

Before/after proof is a read against persisted artifacts, not a re-run: `reports/test/last-run.json`
file count drops by exactly 16, case total by exactly 53, and the junit in-test total drops by the
poc's measured 37.9 s (± run noise). Tasks require citing those numbers.

## Risks / Trade-offs

- [Frozen `bunfig.toml` conflicts with an in-flight qualification] → sequencing rule in the tasks:
  land on master when no qualification branch is active; a qualification rebase that hits the
  conflict treats the bunfig addition as the candidate's to keep (it changes runner *lane config*,
  not story-harness bytes — outside the qualification's frozen-inputs proof).
- [Someone relies on `bun test` running poc self-checks implicitly] → no evidence of such a caller;
  the PoC's own docs describe self-checks as on-demand. The `test:research` script is the discoverable
  replacement and lands in the same commit.

## Migration Plan

1. Add the bunfig entry (with a comment naming the lane) and the `test:research` script.
2. Full `bun run test`; verify the delta from `last-run.json` (16 files, 53 cases, ~38 s).
3. `bun run test:research` green; `bun run test:audit` case totals drop by the poc's count only.
4. `bun check` before commit; land on master between story-refactor qualifications.

Rollback: revert the two-line diff; discovery resumes picking the files up.

## Open Questions

- None blocking. Whether to ever wire `test:research` into CI is a separate decision tied to the
  PoC's future, recorded as a non-goal.
