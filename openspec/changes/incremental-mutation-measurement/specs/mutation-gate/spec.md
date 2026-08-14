<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Defines the per-file mutation PR gate's coverage contract: which files it evaluates, when it may
reuse a score measured by an earlier run instead of re-measuring, and what it must never let
pass. The gate evaluates the whole branch against master while measuring only what changed since
the previous run.

## ADDED Requirements

### Requirement: Whole-branch gate coverage

The gate SHALL evaluate every gateable file in the branch diff against the base branch on every
run, regardless of which files that run actually measured. A file's score SHALL come from this
run's measurement when it was measured, and otherwise from a carried-over score recorded by an
earlier run on the same branch. A file in the branch diff for which neither exists SHALL be
measured.

#### Scenario: A regression from an earlier commit keeps failing

- **WHEN** commit A drops file `X` below its recorded baseline, and commit B changes only an
  unrelated file `Y` whose score is fine
- **THEN** the run for commit B measures only `Y`, still evaluates both `X` and `Y`, and exits
  non-zero naming `X` with its carried-over score and its baseline floor

#### Scenario: A file reverted to the base branch's content leaves the gate

- **WHEN** a file's content is restored to match the base branch
- **THEN** it is absent from the branch diff and is neither measured nor gated

#### Scenario: No carried-over scores available

- **WHEN** no earlier run's scores can be recovered (first run on the branch, or the store was
  evicted)
- **THEN** every file in the branch diff is measured, and the gate's verdict is unchanged from
  measuring everything

### Requirement: Fingerprint-guarded score reuse

A carried-over score SHALL be consumed only when its fingerprint exactly matches a fingerprint
recomputed from current state. The fingerprint SHALL cover the source file's contents, the paths
and contents of its candidate test set, and a toolchain hash over the Stryker configuration,
the test-set overrides, the lockfile, the mutation scripts and the mutation runner versions. It
SHALL NOT depend on file modification times, absolute paths, commit identifiers, or the recorded
baseline. Any mismatch SHALL cause the file to be re-measured.

#### Scenario: Unchanged file reuses its score

- **WHEN** a file in the branch diff, its candidate tests and the toolchain are all byte-identical
  to when a carried-over score was recorded
- **THEN** that score is reused and the file is not re-measured

#### Scenario: A weakened test forces re-measurement

- **WHEN** a test in a file's candidate test set is edited, added or removed
- **THEN** that file's fingerprint changes and the file is re-measured

#### Scenario: A toolchain change invalidates every carried-over score

- **WHEN** the Stryker configuration, the overrides file, the lockfile, or any mutation script
  changes
- **THEN** no carried-over score matches and every file in the branch diff is re-measured

#### Scenario: A fresh checkout still matches

- **WHEN** the same content is checked out again on a different machine, so every file
  modification time differs
- **THEN** the fingerprints are identical and carried-over scores are still reused

#### Scenario: A raised baseline is enforced against a carried-over score

- **WHEN** the recorded baseline for a file rises after its score was carried over
- **THEN** the carried-over score is compared against the new, higher floor and fails if it is
  below it

### Requirement: Unmeasurable outcomes are never carried over

The gate SHALL NOT record a carried-over score for a file whose mutation run errored or which
was skipped for lack of a test set. Such files SHALL be re-measured on the next run, and an
errored file SHALL continue to fail the gate.

#### Scenario: An errored file is retried, not remembered

- **WHEN** a file's Stryker run fails before producing a report
- **THEN** the run exits non-zero naming that file, nothing is recorded for it, and the next run
  measures it again rather than reusing anything

#### Scenario: Scores survive a failing run

- **WHEN** a run measures several files and then fails the gate
- **THEN** the scores it measured are still recorded, so the next run does not re-measure them

### Requirement: The committed baseline is seeded only from fresh measurements

Baseline seeding SHALL disable score reuse entirely, so no carried-over score can become a
recorded floor. Operators SHALL be able to disable reuse for any run.

#### Scenario: Master seeding measures fresh

- **WHEN** the baseline seed runs after a merge to the base branch
- **THEN** every file it seeds was measured in that run, and no carried-over score contributes

#### Scenario: Operator forces a full re-measure

- **WHEN** a run is invoked with reuse disabled
- **THEN** every file in the branch diff is measured even where a matching carried-over score
  exists

### Requirement: Auditable measured-versus-reused reporting

Each run SHALL report the size of the whole-branch target set, which files it measured, and
which files it reused — with each reused file's score and when it was measured — before the gate
verdict, so a green run cannot be mistaken for a partial one.

#### Scenario: The run summary distinguishes measured from reused

- **WHEN** a run measures 3 of 22 branch-diff files and reuses 19
- **THEN** it reports all three counts and lists each reused file with its score and measurement
  time before reporting the verdict
