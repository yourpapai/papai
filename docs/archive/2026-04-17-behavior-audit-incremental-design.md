<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Behavior Audit Incremental Audit Design

**Date:** 2026-04-17
**Status:** Proposed
**Scope:** Add manifest-based incremental reruns to `scripts/behavior-audit.ts` so repeated runs only revisit tests whose audit inputs drifted since the last run start.

## Summary

Add a durable incremental-selection layer to the existing behavior-audit pipeline. The current script can resume an in-flight run through `reports/progress.json`, but every new run still starts from the full test set. This design adds a second state file, `reports/incremental-manifest.json`, that records `lastStartCommit`, per-test dependency paths, and per-phase fingerprints. On each new run, the script computes the set of changed files since `lastStartCommit`, combines that with local staged, unstaged, and untracked changes, and reruns only the affected tests or behaviors.

This design intentionally uses a manifest-based approach rather than Bun-native changed-test selection. Bun currently documents watch-mode reruns for affected tests during a live session, but it does not provide a documented persisted changed-since-baseline selector suitable for long-running offline audits.

## Motivation

The first full behavior-audit run is expensive and may take too long to finish. Waiting for a fully successful run before establishing an incremental baseline is a bad fit for this workflow. The incremental system must therefore capture a baseline at run start, not only at run completion.

The system must also handle more than test-file drift. Audit output can become stale when any of the following change:

- the test file itself
- the mirrored implementation file derived from the test path
- Phase 1 extractor prompts, parser logic, audit tools, or model/config inputs
- Phase 2 evaluator prompts, persona definitions, or model/config inputs
- output-generation logic in the report writer

## Goals

- Make repeated behavior-audit runs incremental by default.
- Establish an incremental baseline immediately at run start using `lastStartCommit`.
- Reuse the existing `progress.json` active-run resume behavior unchanged where possible.
- Detect drift from test files, mirrored implementation files, and audit-script phase inputs.
- Keep the first implementation small, deterministic, and easy to reason about.

## Non-Goals

- Do not build a full dependency graph between source files and tests.
- Do not track every file an agent reads during extraction or evaluation.
- Do not add Bun watch-mode integration.
- Do not infer affected tests through import-graph fan-out beyond the mirrored `tests/...` -> `src/...` path.
- Do not change the user-visible markdown report format in this phase.

## Existing State

Today the behavior-audit system has one durable state file:

- `reports/progress.json` — active-run resume state for Phase 1 and Phase 2

`progress.json` is correct for resumability within a run, but it is not sufficient for selecting a narrow rerun set across distinct runs. It answers "what has been completed in this run?" but not "what is stale compared to the current repo state?"

## Proposed Architecture

The incremental system adds one new durable file and one new run-selection step.

```text
scripts/behavior-audit.ts
  ├── discover test files
  ├── load incremental manifest (new)
  ├── capture current HEAD as lastStartCommit (new)
  ├── compute changed files since previous lastStartCommit (new)
  ├── choose affected Phase 1 / Phase 2 items (new)
  ├── load or initialize progress.json (existing)
  ├── run Phase 1 on selected tests/files (updated)
  ├── run Phase 2 on selected behaviors (updated)
  └── update manifest entries as items complete (new)
```

### Durable Files

- `reports/progress.json`
  - active-run resume state
  - cleared or overwritten according to current run behavior
- `reports/incremental-manifest.json`
  - stable cross-run selection state
  - updated at run start and after successful item completion

## Manifest Schema

The manifest must be explicit, versioned, and small enough to inspect manually.

```typescript
interface IncrementalManifest {
  readonly version: 1
  readonly lastStartCommit: string | null
  readonly lastStartedAt: string | null
  readonly lastCompletedAt: string | null
  readonly phaseVersions: {
    readonly phase1: string
    readonly phase2: string
    readonly reports: string
  }
  readonly tests: Record<string, ManifestTestEntry>
}

interface ManifestTestEntry {
  readonly testFile: string
  readonly testName: string
  readonly dependencyPaths: readonly string[]
  readonly phase1Fingerprint: string | null
  readonly phase2Fingerprint: string | null
  readonly extractedBehaviorPath: string | null
  readonly domain: string
  readonly lastPhase1CompletedAt: string | null
  readonly lastPhase2CompletedAt: string | null
}
```

### Keying

Each manifest entry is keyed by the same stable identifier already used in the audit pipeline:

```text
<testFile>::<fullTestPath>
```

Example:

```text
tests/tools/create-task.test.ts::create task > creates a task with required fields
```

This keeps manifest identity aligned with Phase 1 extraction, Phase 2 evaluation, and progress-tracking keys.

## Baseline Capture

### Why `lastStartCommit`

The baseline must be useful even when the current run is interrupted before completion. For that reason, the manifest stores `lastStartCommit`, not only `lastSuccessfulCommit`.

### Run-Start Rules

At the beginning of every run:

1. Read the previous manifest, if present.
2. Save the previous `lastStartCommit` in memory for changed-file computation.
3. Capture the current commit with:

```bash
git rev-parse --verify HEAD
```

4. Immediately write the manifest back with:
   - `lastStartCommit = current HEAD`
   - `lastStartedAt = now`
   - unchanged test entries until individual items are updated later

This ensures that even an interrupted first run leaves behind a useful baseline for the next run.

### Completion Rule

At the end of a fully completed run, update only:

- `lastCompletedAt = now`

The next run still compares against the previously recorded `lastStartCommit`, which by then represents the commit seen at the beginning of the prior run.

## Dependency Scope

The first implementation tracks exactly two dependency classes per test entry:

1. the test file itself
2. the mirrored implementation path derived by replacing:
   - `tests/` -> `src/`
   - `.test.ts` -> `.ts`

The mirrored path is included only if that file exists at manifest-update time.

Example:

- `tests/tools/create-task.test.ts`
- mirrored dependency: `src/tools/create-task.ts`

This is intentionally narrow. It catches the most important drift without introducing dynamic agent trace capture or import-graph analysis.

## Phase Version Hashes

Some changes should invalidate broad parts of the audit even if no individual test dependency changed. To support that, the manifest stores phase version hashes.

### Phase 1 Version Inputs

`phaseVersions.phase1` is a hash over the contents or identifiers of:

- `scripts/behavior-audit/test-parser.ts`
- `scripts/behavior-audit/extract.ts`
- `scripts/behavior-audit/tools.ts`
- `scripts/behavior-audit/config.ts`
- Phase 1 system prompt string
- model identifier used for extraction

### Phase 2 Version Inputs

`phaseVersions.phase2` is a hash over:

- `scripts/behavior-audit/evaluate.ts`
- `scripts/behavior-audit/evaluate-agent.ts`
- `scripts/behavior-audit/personas.ts`
- `scripts/behavior-audit/config.ts`
- Phase 2 system prompt string
- model identifier used for evaluation

### Report Version Inputs

`phaseVersions.reports` is a hash over:

- `scripts/behavior-audit/report-writer.ts`

This allows output regeneration without forcing model reruns.

## Per-Test Fingerprints

Each manifest test entry stores two fingerprints.

### Phase 1 Fingerprint

`phase1Fingerprint` is a hash of:

- full test key
- test file content hash
- test case source string
- mirrored source file content hash when present
- `phaseVersions.phase1`

If this fingerprint changes, Phase 1 must rerun for that test, and the downstream Phase 2 result for that test is also invalid.

### Phase 2 Fingerprint

`phase2Fingerprint` is a hash of:

- full test key
- extracted behavior text
- extracted context text
- `phaseVersions.phase2`

If this fingerprint changes while Phase 1 remains valid, rerun only Phase 2 for that test.

## Changed-File Computation

The run computes the changed-file set as the union of four git-derived sources.

### 1. Committed Changes Since Previous Run Start

If the previous manifest had `lastStartCommit`, compute:

```bash
git diff --name-only <previousLastStartCommit>...HEAD
```

This uses Git's merge-base semantics and captures branch changes since the prior run baseline.

If no previous manifest exists, treat the run as a cold start and select all tests.

### 2. Staged Changes

```bash
git diff --name-only --cached
```

### 3. Unstaged Working Tree Changes

```bash
git diff --name-only
```

### 4. Untracked Files

```bash
git ls-files --others --exclude-standard
```

The final changed-file set is the union of all four command outputs.

## Selection Algorithm

### Cold Start

If there is no manifest:

- select all discovered tests for Phase 1
- select all behaviors for Phase 2 after extraction

### Incremental Run

For each manifest test entry, determine whether it is affected.

#### Direct Dependency Drift

Select the test for Phase 1 if any path in `dependencyPaths` is in the changed-file set.

#### Phase 1 Version Drift

If `phaseVersions.phase1` differs from the newly computed Phase 1 version hash:

- all tests are selected for Phase 1
- all Phase 2 entries become invalid because behavior output may change

#### Phase 2 Version Drift

If `phaseVersions.phase2` differs but `phaseVersions.phase1` matches:

- no tests are forced back through Phase 1 solely for this reason
- all tests with stored extracted behaviors are selected for Phase 2 rerun

#### Report Writer Drift

If only `phaseVersions.reports` differs:

- no model calls are required
- rebuild markdown reports from stored Phase 1 / Phase 2 results

#### New or Deleted Tests

- newly discovered tests absent from the manifest: select for Phase 1 and Phase 2
- manifest entries whose test file no longer exists: remove them from the manifest during reconciliation

### Derived Sets

The script should materialize three sets:

1. `phase1SelectedTestKeys`
2. `phase2SelectedTestKeys`
3. `reportRebuildOnly`

Where:

- every Phase 1 selection implies Phase 2 selection downstream
- Phase 2 selection can exist without Phase 1 selection
- report rebuild can happen with both sets empty when only report-writer drift occurred

## Run Behavior Changes

### Phase 1

Phase 1 should no longer iterate every discovered test blindly. It should:

- parse all discovered test files only as needed to identify selected test cases
- skip unselected tests cleanly
- continue to use `progress.json` for in-run resume
- update the manifest immediately after each successful extraction

Manifest updates after successful Phase 1 completion for a test:

- ensure dependency paths are current
- store `phase1Fingerprint`
- clear stale `phase2Fingerprint` if Phase 1 output changed
- store updated extracted behavior path and domain
- set `lastPhase1CompletedAt`

### Phase 2

Phase 2 should operate on the selected test keys rather than all behavior files.

It should:

- reuse stored extracted behavior data when Phase 1 was not rerun
- rerun only selected evaluations
- update the manifest after each successful evaluation with:
  - `phase2Fingerprint`
  - `lastPhase2CompletedAt`

### Reports

Report generation should be decoupled from model execution.

Given stored extracted and evaluated results, the script must be able to regenerate:

- `reports/behaviors/**/*.behaviors.md`
- `reports/stories/<domain>.md`
- `reports/stories/index.md`

without forcing Phase 1 or Phase 2 model calls.

## Failure Semantics

### Interrupted Run

If a run stops midway:

- `progress.json` remains the source of truth for in-flight resume
- `incremental-manifest.json` still retains the run-start baseline through `lastStartCommit`
- successfully completed items already written to the manifest remain valid candidates for incremental reuse on the next run

### Partial Success

If some tests complete and others fail:

- completed manifest entries remain updated
- failed items remain candidates for the next incremental run if still selected by drift or if their stored fingerprints are absent

### Missing Git State

If git commands fail or `HEAD` cannot be resolved:

- log a clear warning
- fall back to full-run selection
- do not write a bogus `lastStartCommit`

## Verification Strategy

Add regression coverage for the incremental layer.

### Manifest Baseline Tests

- first run writes `lastStartCommit` before Phase 1 begins
- interrupted run still leaves a usable manifest baseline
- subsequent run compares against the previous `lastStartCommit`, not the newly captured one

### Selection Tests

- changed test file selects only that test file's test cases
- changed mirrored source file selects tests whose dependency paths include that source file
- unchanged tests with matching fingerprints are skipped
- newly added tests are selected
- deleted tests are removed from the manifest

### Phase Invalidation Tests

- Phase 1 version drift selects all tests for Phase 1 and invalidates Phase 2
- Phase 2 version drift reruns only Phase 2
- report-writer drift triggers report regeneration only

### Integration Tests

- manifest updates incrementally as Phase 1 items complete
- manifest updates incrementally as Phase 2 items complete
- incremental rerun after partial prior run reuses completed entries correctly

## File Changes

Expected file additions or updates for implementation:

| File                                      | Responsibility                                           |
| ----------------------------------------- | -------------------------------------------------------- |
| `scripts/behavior-audit.ts`               | run-start baseline capture and incremental selection     |
| `scripts/behavior-audit/config.ts`        | manifest path constant                                   |
| `scripts/behavior-audit/progress.ts`      | no major role change; remains active-run resume state    |
| `scripts/behavior-audit/extract.ts`       | Phase 1 selection and manifest entry updates             |
| `scripts/behavior-audit/evaluate.ts`      | Phase 2 selection and manifest entry updates             |
| `scripts/behavior-audit/report-writer.ts` | report regeneration from stored results                  |
| `scripts/behavior-audit/incremental.ts`   | manifest schema, hashing, changed-file computation       |
| `tests/scripts/behavior-audit*.test.ts`   | manifest, invalidation, selection, and integration tests |

## Acceptance Criteria

This design is complete when all of the following are true:

- every run records `lastStartCommit` immediately after startup git inspection
- a run interrupted before completion still establishes the next incremental baseline
- unchanged tests with unchanged phase fingerprints are skipped on later runs
- changes to a test file or its mirrored source file rerun only the affected test entries
- Phase 1, Phase 2, and report-writer drift invalidate the correct scopes
- stored results are sufficient to regenerate reports without mandatory model reruns

## Trade-Offs

### Why Not Track All Agent-Read Files Now

That would improve precision, but it requires instrumenting tool calls and treating dynamic agent exploration as durable dependency data. This is useful later, but it adds complexity to the first implementation and makes correctness harder to reason about.

### Why Not Use Only `lastSuccessfulCommit`

Because the first complete run is too expensive. Capturing `lastStartCommit` at run start yields a practical baseline immediately and is the only approach that helps after interrupted runs.

### Why Keep `progress.json` Separate From The Manifest

The two files have different jobs:

- `progress.json` answers active-run resumability
- `incremental-manifest.json` answers cross-run staleness and invalidation

Keeping them separate preserves clarity and avoids overloading one file with conflicting semantics.
