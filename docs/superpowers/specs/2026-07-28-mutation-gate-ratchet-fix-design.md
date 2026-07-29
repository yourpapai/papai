<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation gate ratchet fix

**Date:** 2026-07-28
**Status:** Design approved, pending spec review

## Problem

The CI mutation gate (`bun test:mutate:changed`) blocked PR #200 with 15 files
below the 0.5 floor — but the failures are a workflow artifact, not a quality
regression. Three structural causes:

1. **File-set mismatch between the gate and the baseline.** The PR gate
   (`scripts/mutation/changed-files.ts`) mutates *any* changed impl file
   (`isGateableImplFile`). The master baseline job
   (`test:mutate --update-baseline`) only ever seeds entries for files in
   `stryker.config.json`'s `mutate` scope — which is deliberately narrow
   (`src/providers/**`, `src/tools/**`, `plugins/task-provider-*/**`, plus a few
   named files). So `baseline.json` has 137 `src/` entries vs 735 src impl files
   (~19%). Every file outside the narrow scope (e.g. `llm-orchestrator.ts`,
   `chat/**`, `message-edit/**`) is **perpetually "new to scope"** → held to the
   0.5 floor, no matter how old it is. The README's promise ("existing files are
   held to their own baseline") structurally cannot hold for files the baseline
   job never measures.

2. **Companion-only test selection undercounts integration-covered files.** The
   paired runner mutates each source file against only its same-named companion
   test (`scripts/mutation/test-overrides.ts`), plus manual `overrides.json`
   extras. Files whose real coverage lives in adapter/integration tests get
   devastating NoCoverage scores unless someone hand-adds an override. Example:
   `src/chat/mattermost/file-helpers.ts` measured **0.057** = `144 NoCoverage /
   9 Killed / 3 Survived` — Stryker ran the 62-line `file-helpers.test.ts`
   against all 8 functions, missing `tests/chat/mattermost/index.test.ts` that
   actually covers them. None of PR #200's 15 failing files had an
   `overrides.json` entry.

3. **The gate mutates whole files, not diffs.** A 3-line change surfaces a
   file's entire historical coverage debt (file-helpers: 156 mutants).

Net effect: broad PRs get blocked by the cliff the moment they touch core files
that have simply never been mutation-gated before. The "regressions" are
dominated by `NoCoverage` and a flat 0.5 floor, not by survivors.

A secondary issue: `baseline.ts:14`'s JSDoc claims the threshold is
`max(floor, baseline[file])`; the code (`baseline.ts:89`) does
`baseline[file] ?? floor`. Misleading doc.

## Goal

Make the gate a **pure regression ratchet** with **accurate, auto-discovered
test sets** and **durable seeding after merge** — so a file's recorded baseline
reflects its real coverage, the gate only fails on genuine regressions against
that baseline, and broad PRs stop hitting the first-touch cliff.

## Decisions (locked during brainstorm)

| Decision | Choice |
| --- | --- |
| Scope of fix | Structural gate fix (not a tactical unblock of one PR) |
| Gate policy | Regression-only: drop the 0.5 floor; first-touch warns and seeds; only baselined files can fail |
| Brand-new files | Also seed-only on the introducing PR (no floor anywhere) |
| Test selection | Auto-discover covering tests via an amortized coverage probe (replaces companion-only) |
| `overrides.json` | Superseded; kept as an additive escape hatch, no longer required |
| Seed persistence | Master CI `mutation-baseline` job measures changed-files (broad) and ratchet-merges into `baseline.json` after merge |
| PR gate writes baseline? | No — gate stays read-only |

## Architecture

### Section 1 — Gate behavior: regression-only, no floor

`resolveRatchet` (`scripts/mutation/baseline.ts`) drops the `?? floor` fallback.
A changed file with no baseline entry produces no `RatchetRegression` (warn
only, exit 0). A baselined file fails iff `score < baseline[file]`.

| Changed file is… | Gate action |
| --- | --- |
| In baseline | FAIL if `score < baseline[file]`; else pass |
| Not in baseline (first-touch — new OR never-baselined) | **WARN** only, exit 0: "first measurement for X: 0.NN — seeded; future PRs enforce ≥ this" |

The `--ratchet-floor` flag and `DEFAULT_RATCHET_FLOOR` become vestigial — remove
or repurpose.

**Accepted trade:** genuinely-new code lands unenforced on its *introducing*
PR; enforcement begins on the next change. This is the cost of a cliff-free
regression gate.

### Section 2 — Test selection: auto-discover covering tests

Replace companion-only selection with coverage-derived test sets. Per mutation
batch, run the suite with **per-test coverage attribution** once to build a map
`{ sourceFile → [testFiles that covered it] }`, then mutate each source file
against only its covering tests (same `bun.testFiles` narrowing as today).

- **Attribution mechanism** is the core plan-level task: for each candidate test
  file, run it with coverage and record which source files it touched, then
  invert. The full test suite is the candidate universe so coverage in unusual
  locations is caught.
- The discovery cost is **one coverage pass amortized over the batch**, not per
  file — so per-file mutation stays fast and `ignoreStatic:false`-accurate.
- `overrides.json` becomes an **additive** escape hatch (unioned onto the
  discovered set) for coverage gaps auto-discovery can't see (dynamic imports,
  runtime-eval'd paths). No longer required; the 105 existing entries may stay
  (harmless) or be pruned later.

First-touch seeds are only meaningful if they reflect real coverage. With
auto-discovery, `file-helpers.ts` would seed near its true score instead of
0.057, so the regression floor is honest.

**Cost trade:** the coverage probe makes each batch slower than today's
companion-only pairing (one full-suite coverage pass + attribution). For the
changed-files gate (~15 files/PR) and the master seed job, acceptable. The
original "tiny test set = cheap" design choice is traded for accuracy.

### Section 3 — Persistence: master CI job seeds after merge

The PR gate is **read-only** — never writes `baseline.json`, never mutates the
branch. First-touch scores are persisted by the existing master
`mutation-baseline` CI job, extended:

- **Today:** the job runs `test:mutate --update-baseline` (the *narrow* scope) →
  never seeds broad-scope files.
- **Change:** the job measures **changed-files since the last master commit**
  (the same broad `isGateableImplFile` set the gate uses, via
  `test:mutate:changed --base=<prev-master>`), with auto-discovered test sets,
  and `ratchetMerge`s results into `baseline.json` (per-key max — scores only
  rise), then commits — the same commit-on-master pattern it already has.

Lifecycle of a file:

1. PR #1 touches `message-edit/handle.ts` (unbaselined) → gate **warns**, exit 0.
2. PR #1 merges → master job measures `handle.ts` (real coverage via
   auto-discovery) → seeds `baseline.json["message-edit/handle.ts"] = 0.48` →
   commits.
3. PR #2 touches `handle.ts` → gate enforces `score ≥ 0.48`.

**Latency trade:** seeds appear only after merge; two PRs touching the same
unbaselined file before master re-baselines both warn. Edge case — the master
job runs per-push, so the window is one merge cycle.

### Section 4 — Edge cases, migration, doc fix

**Doc fix:** `baseline.ts:14` JSDoc corrected to match code (and after Section 1,
"baseline entries only; no floor").

**Existing artifact baselines self-heal:** `history.ts`'s 0.2105 was a
companion-only undercount. The master job re-measures it with auto-discovered
tests (including `history-edit.test.ts`) and `ratchetMerge` ratchets it *up*
toward its true score. Baselines only rise, and companion-only baselines were
undercounts, so no file's real score can fall below its recorded one — no
migration false-alarms.

**Phased rollout (each phase independently shippable):**

- **Phase A — unblock:** `resolveRatchet` drops the floor (first-touch warns);
  JSDoc fix. Immediately clears the cliff — PR #200's 14/15 unbaselined files
  become warn-only and mergeable. No master-job change yet (broad files stay
  warn-only until Phase B).
- **Phase B — accurate seeds:** master job measures changed-files (broad) with
  auto-discovery and commits seeds. First-touch files get honest, persisted
  baselines after merge.

**One-time catch-up:** the first master run after Phase B seeds every
currently-unbaselined file that has changed recently — a large `baseline.json`
diff. Expected and correct (the backfill that should have been happening).

**Other edge cases:**

- *Tiny files (few mutants):* coarse scores (0 / 0.33 / 0.66 / 1.0) make the
  floor jittery. `buildBaselineFromPerFile` already skips `scored === 0`; no
  extra handling.
- *Concurrent PRs before re-baseline:* both warn (Section 3 latency trade).

## Scope boundary

Changes confined to `scripts/mutation/*` + the master CI workflow +
`baseline.json`. The paired Stryker runner, `stryker.config.json`, and the
repo's tests are untouched. Gate/seeder scripts get unit tests for the no-floor
ratchet, the coverage-map build, and the seed merge.

## Out of scope

- Narrowing or broadening `stryker.config.json`'s curated `mutate` scope (the
  gate no longer depends on it once seeding is changed-files-based).
- Removing `overrides.json` outright (kept as additive escape hatch).
- Per-PR baseline writes or in-PR bot commits (gate stays read-only).
- Re-introducing any floor (regression-only by decision).
