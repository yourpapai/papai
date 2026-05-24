<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Measurement & Test-Suite Quality — Investigation Design

**Date:** 2026-05-24
**Status:** Approved for planning
**Author:** Dmitriy Lazarev (with Claude Code)
**Type:** Investigation / research only — **no source or test changes**

## Summary

`bun test:mutate:full` reports a **23.54%** mutation score and fails the `break: 40`
threshold. Initial discovery shows this is **not** primarily a "we lack tests" problem:
the score is computed over only **16.1%** of instrumented mutants, because **77.2%
(8,032 of 10,410)** are silently discarded as _"Static mutant (and ignoreStatic was
enabled)."_

This document specifies a **research-only investigation**. Its product is a single,
well-organized **findings report** that:

1. **proves or disproves** the root cause of the discarded-mutant measurement defect, and
2. **assesses the organization and quality** of the test infrastructure — suite preloads,
   mocking strategy, dependency injection (DI), and overall test quality — including how
   those choices interact with and degrade mutation measurement.

The investigation makes **no changes to `src/` or `tests/`**. It ends with a clearly
labeled, **deferred** options section to inform a later, separately approved remediation
effort.

## Goals / Non-Goals

### Goals

- Establish, with evidence, the true cause(s) of the 77% static-discard and the real
  mutation score that the existing suite would produce under correct attribution.
- Produce a defensible quality assessment of the suite's preloads, mocking, and DI, with
  concrete metrics (e.g. blast radius of `mock.module()`, DI-adherence vs. the repo's
  stated preference, over-mocking and assertion-strength signals).
- Deliver one coherent, well-structured research document with reproducible evidence.
- Capture deferred remediation options with trade-offs (not executed).

### Non-Goals

- **No** edits to `src/` or `tests/` (no new tests, no test refactors, no production-code
  changes).
- **No** committed configuration changes. Scoped Stryker experiments use **ephemeral
  throwaway configs** (e.g. under `/tmp`) and must not modify committed files.
- No execution of any remediation; options are recorded for a future, separate plan.
- Not bound by a fixed timebox — breadth and proof quality take precedence over speed.

## Decisions (locked)

1. **Investigation only.** The deliverable is a research/findings document; no code or test
   changes are planned or made.
2. **Wider scope.** Beyond the mutation-measurement root cause, the investigation also
   evaluates how well suite preloads, mocks, DI, and related test infrastructure are
   organized — and whether they are a cause of the measurement defect.
3. **Findings + deferred options.** The report records evidence and conclusions, then a
   clearly labeled "Options for a future effort" section with trade-offs. Nothing is acted
   on now.

## Preliminary Evidence (already gathered)

These findings seed the investigation; the plan must independently confirm or refute each.

### Mutant status breakdown (`reports/mutation.json`, current config)

| Status                         | Count  | Notes                                          |
| ------------------------------ | ------ | ---------------------------------------------- |
| Ignored (static, ignoreStatic) | 8,032  | 77.2% of all instrumented mutants — discarded  |
| CompileError                   | 704    | Filtered by the newly-added TypeScript checker |
| NoCoverage                     | 667    | No attributed test executes the mutant         |
| Survived                       | 613    | A test runs but assertions are too weak        |
| Killed                         | 392    | —                                              |
| Timeout                        | 2      | Counts as killed                               |
| **Total instrumented**         | 10,410 | Valid (scored) = 1,674 = 16.1% of total        |

Score math: `(392 + 2) / (392 + 2 + 613 + 667) = 394 / 1674 = 23.54%`.

### Observations

- `@hughescr/stryker-bun-runner` (installed `1.2.2`, the latest on npm) **eager-imports
  every mutated module at preload, before any test runs**, and attributes a mutant to a
  test only if it fires while a `testId` is active; otherwise it lands in the **static**
  bucket, which `ignoreStatic: true` then drops.
- `bun test tests/providers/kaneo/column-resource.test.ts --coverage` proves `list()` **is
  executed**, yet the mutation report marks `column-resource.ts` **0 killed / 0 survived /
  12 no-cov**; a scoped `ignoreStatic:false` run instrumented **85 mutants, 69 (81%)
  static** in that one file.
- `bunfig.toml` preloads `./tests/setup.ts` and `./tests/mock-reset.ts`. `mock-reset.ts`
  installs a **global `beforeEach`** and `mock.module()`s a large set of modules
  process-wide; individual test files add their own `beforeEach` and `mock.restore()`.
  `config.ts` and `memory.ts` are both in the mutate scope and are the kind of module that
  gets `mock.module()`'d.
- `tests/providers/kaneo/test-resources.ts` is a pure re-export barrel of real source
  modules (rules out "tests import a copy" as the cause).
- The uncommitted `stryker.config.json` change (adds `@stryker-mutator/typescript-checker`)
  correctly reclassifies invalid mutants as `CompileError`; it does not change the score.

## Investigation Tracks

### Track A — Mutation-measurement root cause

Prove or disprove, with reproducible scoped experiments and raw coverage dumps:

- **A1.** That static-bucket discard (via `ignoreStatic`) is the dominant reason the score
  is low — i.e. quantify how many discarded mutants would be killed by the existing suite.
- **A2.** _Why_ coverage lands in the static bucket. Compete the hypotheses:
  - hook ordering/race between the runner's injected test-ID `beforeEach` and the suite's
    global `beforeEach` (`mock-reset.ts`) and per-file `mock.restore()`;
  - `mock.module()` swapping instrumented modules out, so tests execute un-instrumented
    mocks (no `perTest` coverage) — especially for in-scope modules;
  - Stryker process-level `concurrency: 8` vs. the runner's required sequential coverage;
  - preload ordering of `setup.ts` / `mock-reset.ts` vs. the runner's coverage preload.
- **A3.** The **true valid-mutant population** and the score the existing suite produces
  under corrected attribution (e.g. via `ignoreStatic:false` scoped runs, accepting cost).

### Track B — Test-infrastructure quality & organization

Assess and quantify, primarily through static analysis (grep/AST), targeted reads, and
read-only coverage/mutation measurements:

- **B1. Preload architecture.** What `tests/setup.ts` and `tests/mock-reset.ts` do; their
  process-wide effects; ordering assumptions; coupling and leakage risks; the robustness
  and cost of the "capture originals at startup, restore in a global `beforeEach`" pattern.
- **B2. Mocking strategy.** Prevalence and blast radius of `mock.module()` across the
  suite; process-wide leakage between files; which **in-scope** modules are mocked (and
  therefore have their instrumentation defeated during mutation).
- **B3. DI adherence.** The repo states a preference for DI over `mock.module()` "where the
  module already supports it" (`tests/CLAUDE.md`). Catalog where DI is used vs. where
  `mock.module()` is used; identify gaps and the highest-impact divergences.
- **B4. Test-quality signals.** Use mutation data as evidence: survived mutants as an
  assertion-strength proxy; no-coverage clusters as an over-mocking / unit-stubbed-away
  proxy; test-to-source mapping patterns (e.g. the `test-resources.ts` barrel).
- **B5. Interaction with mutation testing.** Explicitly connect B1–B4 to Track A: how the
  current preload/mock/DI organization helps or harms accurate mutation measurement.

### Track C — Synthesis & deferred options

- **C1.** A single root-cause statement supported by Track A evidence.
- **C2.** A prioritized quality assessment from Track B with metrics.
- **C3.** A clearly labeled **"Options for a future effort"** section: remediation paths
  (e.g. config adjustments, preload/mock restructuring, DI adoption, scope or threshold
  policy) with trade-offs. **Deferred — not executed.**

## Methodology & Constraints

- **Read-only and ephemeral.** Evidence comes from scoped Stryker runs driven by
  **throwaway configs outside the repo** (e.g. `/tmp/stryker.exp.json`), `bun test
--coverage`, `reports/mutation.json` analysis, and static analysis of test files. No
  committed file is modified.
- **One variable at a time.** Hypothesis tests in Track A toggle a single factor
  (`concurrency`, preload set, ordering, `ignoreStatic`) per scoped run and record the
  static-share and score deltas.
- **Reproducibility.** Every claim in the report cites the exact command and observed
  output so a reader can re-run it.
- **Honest uncertainty.** Where a hypothesis cannot be conclusively proven within practical
  cost (e.g. a full `ignoreStatic:false` run is prohibitively slow), the report states the
  partial evidence and the residual uncertainty rather than overclaiming.

## Deliverable

A single research document committed to `docs/research/` (proposed filename
`2026-05-24-mutation-measurement-and-test-quality-findings.md`), structured as:

1. Executive summary and the headline number(s).
2. Track A — measurement root cause, with experiments and raw evidence.
3. Track B — test-infrastructure quality assessment, with metrics.
4. Track C — synthesis and deferred options.
5. Appendix — commands, raw outputs, and data tables for reproducibility.

This design spec itself lives under `docs/superpowers/specs/`.

## Risks & Mitigations

- **A full `ignoreStatic:false` run is very slow** (static mutants run against the whole
  suite). Mitigation: scope experiments to representative files/areas; extrapolate with
  stated uncertainty rather than forcing a full run.
- **Root cause may be partly inherent to the pinned runner** (eager-import by design).
  Mitigation: the report distinguishes "fixable in our test setup" from "inherent to the
  tool," which is itself a useful finding.
- **Scope creep into remediation.** Mitigation: Track C options are explicitly deferred;
  no `src/`/`tests/` changes are made.

## Out of Scope

- Any `src/` or `tests/` modification; any committed config change.
- Executing remediation or raising/lowering the `break` threshold.
- Replacing the test runner or migrating off Stryker.
