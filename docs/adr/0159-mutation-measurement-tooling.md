<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0159: Mutation Measurement Tooling

## Status

Implemented

## Date

2026-05-25 – 2026-05-29

## Context

`bun test:mutate:full` reports a headline mutation score of 23.54%, failing the
configured `break: 40` gate. The research findings
(`docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md`)
prove this number is a measurement artifact, not a quality deficit:

- The `@hughescr/stryker-bun-runner` coverage-preload eager-imports every
  mutated module while `strykerGlobal.currentTestId` is `undefined`, so all
  module-level mutant hits land in the `static` bucket.
- `ignoreStatic: true` then discards the entire static bucket — 77.2% of all
  10,410 instrumented mutants (8,032) are dropped before scoring. The 23.54%
  is computed over only the surviving 16.1%.
- A representative file scores 0% under the current config but 66.7% with
  `ignoreStatic: false`, confirming the existing tests actively kill mutants
  once the static filter is lifted.

The runner cannot be upgraded out of the problem (the installed `1.2.2` is the
latest published version). The accurate mode (`ignoreStatic: false`) is correct
but, run naively, re-executes the full ~4,817-test suite for every static
mutant — estimated at many hours repo-wide. That cost made the fix impractical
without a different execution strategy.

The design spec
(`docs/archive/2026-05-25-mutation-measurement-tooling-design.md`) and
implementation plan
(`docs/archive/2026-05-29-mutation-measurement-tooling.md`) defined a
per-file paired Stryker runner as the core mechanism.

## Decision Drivers

- **Measurement accuracy**: The mutation score must reflect real test quality,
  not a runner artifact that silently discards 77% of mutants.
- **Runtime cost**: Mutation testing must be fast enough for routine use —
  seconds per file, not hours repo-wide.
- **No runner forking**: Patching `@hughescr/stryker-bun-runner` is maintenance
  overhead for a problem solvable at the config level.
- **Incremental adoption**: The quality gate must start lenient (warn-only) and
  ratchet up after real numbers are observed; no premature hard threshold.
- **Companion-test reuse**: The existing `.hooks/tdd/test-resolver.mjs`
  `findTestFile` helper already resolves companion tests; reuse it, do not
  duplicate the logic.
- **Cross-cutting coverage**: Some source files are partly exercised by
  integration tests outside their companion; the tool must handle this
  explicitly rather than silently over- or under-counting.

## Considered Options

### Option A: Full-repo `ignoreStatic: false` with no test scoping

Run the entire repo under accurate mode, accepting the multi-hour cost.

- **Pros**: Simplest config change; one command.
- **Cons**: Estimated many hours per run (research A6, C3 Area 1); impractical
  for CI or developer workflow; no incremental path.

### Option B: Per-file paired runner with `bun.testFiles` scoping (chosen)

For each target source file, generate a throwaway Stryker config that mutates
only that file, runs only its companion test(s) via `bun.testFiles`, and forces
`ignoreStatic: false`. Merge per-file JSON reports into one aggregated score.

- **Pros**: Fast (tiny test set per file) and accurate (no static-bucket
  discard); supports on-demand, changed-files, and full-repo modes; reuses
  existing test-resolver logic.
- **Cons**: Cross-cutting modules need manual override entries; per-file
  overhead from Stryker startup/teardown.

### Option C: Patch `@hughescr/stryker-bun-runner` to fix eager-import preload

Fork or monkey-patch the runner to defer the eager import until after
`strykerGlobal.currentTestId` is set.

- **Pros**: Fixes the root cause for the whole repo at once.
- **Cons**: Fork maintenance burden; no newer published version exists; the
  runner's internal architecture makes the fix non-trivial; explicitly deferred
  in the research (C3 Area 1, option 1c).

### Option D: Replace Stryker with an alternative mutation framework

Switch to a different mutation testing tool that does not exhibit the static-bucket
artifact under Bun.

- **Pros**: Eliminates the artifact entirely.
- **Cons**: No viable Bun-native alternative exists; migration cost is high;
  the paired-runner approach fixes the measurement with the existing tool.

## Decision

**Option B** — per-file paired Stryker runner with `bun.testFiles` scoping.

| Topic               | Decision                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Core mechanism      | Per-file ephemeral Stryker config: `ignoreStatic: false`, `mutate: [singleFile]`, `bun.testFiles: [companion + overrides]`. |
| Config generation   | Pure function `buildPairedConfig()` in `scripts/mutation/config-builder.ts`.                                                |
| Test-set resolution | Companion test via `findTestFile` + declarative overrides in `scripts/mutation/overrides.json`.                             |
| Score aggregation   | Pure function `mergeReports()` in `scripts/mutation/score-merger.ts`; standard Stryker scoring math.                        |
| Layer A CLI         | `bun test:mutate:file <paths...>` — on-demand per-file measurement.                                                         |
| Layer B CLI         | `bun test:mutate:changed` / `bun test:mutate:changed-paired` — diff vs `origin/master`, then paired-run.                    |
| Full-repo CLI       | `bun test:mutate` — paired-run over all in-scope files (via `scripts/mutation/all-files.ts`).                               |
| CI gate             | Layer B job, `continue-on-error: true` during calibration; threshold to be ratcheted later.                                 |
| Legacy config       | `stryker.config.json` with `ignoreStatic: true` retained as informational only; not a gate.                                 |
| Overrides           | `scripts/mutation/overrides.json` — per-file extra-test map; companion always first, extras deduped after.                  |
| Skip behavior       | Files with no companion and no override are skipped with a logged reason.                                                   |
| Threshold CLI       | `--threshold=N` on both Layer A and Layer B; exit 1 if scored mutants fall below threshold.                                 |

## Consequences

### Positive

- Mutation score now measures real test quality: 77% of previously-discarded
  mutants are visible and scored.
- Per-file runs complete in seconds to minutes instead of hours; developers can
  measure while working.
- CI gate is bounded by diff size — only touched code is measured, keeping
  feedback fast on small PRs.
- Declarative overrides handle cross-cutting coverage without special-casing in
  the runner logic.
- Legacy whole-repo config preserved for historical comparison; no forced
  migration.

### Negative

- Per-file Stryker startup/teardown overhead accumulates for large file sets;
  full-repo paired run is slower than a single whole-repo Stryker invocation
  would be (if it were accurate).
- Cross-cutting modules require manual override entries in `overrides.json`;
  absent an override, their paired score is conservatively low.
- Two parallel mutation-command families (`test:mutate` vs `test:mutate:file`
  and `test:mutate:changed`) may confuse new developers until the legacy
  config is retired.

### Risks

- The calibration period (`continue-on-error: true`) means CI does not block
  on mutation regressions yet; a weak threshold could be merged before the
  ratchet is set.
- Mitigation: the ratchet is explicitly a follow-up step; real baseline
  numbers must be observed before tightening.
- Stryker's `static` bucket root cause remains unfixed upstream; if a future
  runner version changes the behavior, the paired runner's `ignoreStatic: false`
  remains correct but the urgency decreases.

## Implementation Notes

Key modules (`scripts/mutation/`):

| File                | Role                                                                   |
| ------------------- | ---------------------------------------------------------------------- |
| `config-builder.ts` | Pure: builds ephemeral per-file Stryker config from base + src + tests |
| `test-overrides.ts` | Pure: loads `overrides.json`, resolves companion + override test set   |
| `score-merger.ts`   | Pure: aggregates per-file JSON reports into one `MergedScore`          |
| `paired-run.ts`     | Layer A orchestrator: per-file config → Stryker → report → merge       |
| `changed-files.ts`  | Layer B: `git diff` → gateable filter → paired-run                     |
| `all-files.ts`      | Full-repo: discover all in-scope files → paired-run                    |
| `stryker-run.ts`    | Extracted Stryker CLI invocation with DI-friendly deps                 |
| `json-readers.ts`   | Shared Stryker JSON report readers                                     |
| `process-error.ts`  | Stryker non-zero exit handling (survived mutants → report still valid) |
| `overrides.json`    | Declarative per-file extra-test map                                    |

All pure modules use DI for testability; orchestrators accept injected `deps`
for `runStryker`, `runGit`, `readReport`, etc.

Package scripts: `test:mutate:file`, `test:mutate:changed`,
`test:mutate:changed-paired`, `test:mutate`.

Companion-test resolution reuses `.hooks/tdd/test-resolver.mjs` `findTestFile`
and `isGateableImplFile` — no duplication.

## Related Decisions

- ADR-0009: Multi-Provider Task Tracker Support — the provider capability model
  that mutation testing validates.
- This ADR's design spec:
  `docs/archive/2026-05-25-mutation-measurement-tooling-design.md`.
- This ADR's implementation plan:
  `docs/archive/2026-05-29-mutation-measurement-tooling.md`.
