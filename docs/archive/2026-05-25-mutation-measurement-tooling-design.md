<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Measurement Tooling — Design

**Date:** 2026-05-25
**Status:** Approved (brainstorming) — ready for implementation planning
**Source research:** `docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md`

## 1. Problem

`bun test:mutate:full` reports a headline mutation score of **23.54%**, failing the
configured `break: 40` gate. The research findings prove this number is a **measurement
artifact**, not a quality deficit:

- The `@hughescr/stryker-bun-runner` coverage-preload eager-imports every mutated module
  while `strykerGlobal.currentTestId` is `undefined`, so all module-level mutant hits land in
  the `static` bucket (research A2 §3).
- `ignoreStatic: true` then discards the entire static bucket — **77.2% of all 10,410
  instrumented mutants (8,032) are dropped before scoring** (research A1). The 23.54% is
  computed over only the surviving 16.1%.
- A representative file scores **0% under the current config but 66.7% with
  `ignoreStatic: false`** (research A3 vs A6), confirming the existing tests actively kill
  mutants once the static filter is lifted.

The runner cannot be upgraded out of the problem: the installed `1.2.2` is the latest
published version (verified 2026-05-25). The accurate mode (`ignoreStatic: false`) is correct
but, run naively, re-executes the full ~4,817-test suite for every static mutant — estimated at
many hours repo-wide (research A6, C3 Area 1). That cost is why the research deferred the fix.

## 2. Goal & success criteria

Build accurate **and** fast mutation measurement, then use it to fix genuinely weak tests.

Done looks like:

1. We can run mutation testing on any file (or set of files) and get a **true** kill score, not
   the artifact-deflated one.
2. The run is fast enough to use routinely — seconds-to-minutes per file, not hours.
3. The quality gate (`break`) stops failing for the wrong reason (the measurement artifact) and
   starts protecting against real regressions.
4. The genuinely weak test files the research identified get strengthened.

### Out of scope

- Forking or patching `@hughescr/stryker-bun-runner` (no newer version exists; a fork is heavy
  maintenance — research C3 Area 1, option 1c).
- Rewriting stable tests purely for DI-style conformance (repo convention forbids churn-only
  rewrites — research B3). The `factory.ts` `mock.module()` over-mocking remains a known,
  separately-tracked secondary suppressor (research B2), not part of this effort.
- A full repo-wide `ignoreStatic: false` calibration run (research C3 Area 3) — may be revisited
  later but is not required to deliver this design.

## 3. Core mechanism — fast + accurate per-file measurement

The runner exposes `bun.testFiles`, allowing the **test set** to be scoped per run — not just
the `mutate` set. The research's cost estimates all assumed the full suite runs per mutant; this
mechanism removes that assumption.

For a target source file:

1. Resolve its companion test file via the existing `.hooks/tdd/test-resolver.mjs`
   `findTestFile(impl, projectRoot)` helper (reused, not reinvented).
2. Generate a throwaway Stryker config that:
   - mutates **only this file** (`mutate: [file]`),
   - runs **only its companion test(s)** (`bun.testFiles`),
   - turns the artifact **off** (`ignoreStatic: false`),
   - keeps the rest of the base `stryker.config.json` (checkers, tsconfig, reporters → JSON).
3. Run it and collect the per-file JSON report.

Because only the file's own tests run (not all 4,817), the run is fast **and** the score is
real. A wrapper does this for a list of files and merges the per-file JSON reports into one
combined score.

### Cross-cutting coverage caveat (handled explicitly)

A file's companion test is usually where its real coverage lives, but some files are partly
exercised by other tests (integration/cross-cutting). For those, a companion-only run reads a
score **lower** than a full-suite run would. To keep the number honest rather than silently
optimistic:

- Allow a target to declare **extra test files** to include in `bun.testFiles` (e.g. a small
  per-file override map for known cross-cutting modules), and/or
- Fall back to a wider test set for declared cross-cutting modules.

The default (companion-only) is the conservative case; overrides only ever widen the test set.

## 4. Delivery — three layers over one core

- **Core: paired-config generator** (e.g. `scripts/mutation/paired-run.ts`). Given a list of
  source files, builds the throwaway per-file configs, runs Stryker, and merges reports into one
  score. Everything else calls this.
- **Layer A — on-demand campaigns.** `bun test:mutate:file <path...>` to accurately measure any
  file while working on it. Drives the Section 6 quality fixes.
- **Layer B — changed-files gate.** A CI / pre-push entry point that runs the generator over the
  files changed vs `master`. Accurate, bounded by diff size — only touched code is measured.

**Deferred:** rewiring `.hooks/tdd/session-mutation.mjs` (which currently inherits the broken
`ignoreStatic: true` config, so its new-survivor blocking is also blind to ~84% of mutants).
Once Layers A and B are proven, optionally point the hook at the same core so the live TDD
signal becomes accurate too. Kept out of the initial scope.

## 5. Gate / threshold policy

- Leave the legacy full-repo config (`ignoreStatic: true`) in place but **stop treating its
  score as a gate** — it remains informational only.
- The **real gate lives in the changed-files paired run (Layer B)**, with a threshold on
  accurately-measured mutants.
- Start lenient (warn-only or a low `break`) for a short calibration period, then ratchet up
  once real numbers are observed.
- Do not commit to a hard repo-wide absolute number until enough files are measured to know what
  "good" means in this codebase.

## 6. Test-quality fixes (follow-up plan)

Using Layer A to measure accurately, fix the real offenders the research flagged (research B4,
C2), in priority order:

1. `src/tools/update-status.ts` — 18 survived / 6 killed: weak assertions on params/edge cases.
2. `src/providers/kaneo/label-resource.ts` — 16 survived / 1 killed: thin assertions despite a
   459-line test file.
3. `src/providers/kaneo/update-label.ts` and `src/providers/kaneo/update-project.ts` — no
   main-suite unit test at all; add focused unit tests.

Per file: measure with Layer A → inspect surviving mutants → add/strengthen assertions →
re-measure to confirm kills. This is a **separate follow-up plan** executed after the
measurement tooling lands, since it cannot be done credibly until real survivors are visible.

## 7. Testing the tooling itself

The generator is `src`-adjacent logic and gets unit tests:

- config generation produces correct `mutate`, `bun.testFiles`, and `ignoreStatic: false`;
- report merging / score math is correct;
- the cross-cutting test-set override / fallback behaves as specified (Section 3);
- `findTestFile` resolution is reused from `.hooks/tdd/test-resolver.mjs`, not duplicated.

## 8. Sequencing

1. Build and unit-test the core generator + Layer A (`bun test:mutate:file`).
2. Add Layer B (changed-files gate) and wire it into CI as warn-only; calibrate.
3. Ratchet the Layer B threshold once real numbers are observed.
4. (Follow-up plan) Strengthen the weak test files in Section 6 using Layer A.
5. (Optional, later) Re-point `.hooks/tdd/session-mutation.mjs` at the core generator.
