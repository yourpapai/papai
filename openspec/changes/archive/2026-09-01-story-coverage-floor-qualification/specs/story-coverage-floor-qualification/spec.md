<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Defines how the Tier 0 story coverage floor is recorded against the tree it
measures, and the immutable qualification baseline that `test:stories:compat`
measures refactor branches against.

## ADDED Requirements

### Requirement: The floor describes the tree it was measured on

The floor in `scripts/story/coverage-floor.json` SHALL be a recorded
measurement of the current scope, derived with the ratchet's epsilon
convention (`floor((measured - 0.005) * 100) / 100`). It SHALL be raised
automatically by `bun coverage:ratchet:stories` from a green run, and MAY be
re-recorded downward only by an explicit, reviewed edit that states the
measured scope. `meanMetric` aggregation and `story-scope.ts` membership SHALL
NOT be changed to move the number.

#### Scenario: Scope grows faster than coverage

- **WHEN** the scoped file count grows materially since the floor was recorded
  and the mean falls below it
- **THEN** the floor is re-recorded at the measured value with the scope size
  stated, rather than the metric being reweighted or the scope narrowed

#### Scenario: Ratchet cannot lower

- **WHEN** `bun coverage:ratchet:stories` runs against a measurement below the
  current floor
- **THEN** `nextFloor` leaves the floor unchanged, so any reduction is a
  deliberate committed edit and never a silent side effect of a script

#### Scenario: Gate below floor

- **WHEN** `bun test:stories:coverage` measures below either floor
- **THEN** it exits non-zero and prints the per-file uncovered diagnostics

### Requirement: Coverage is bought with contracts, not with loads

A story added to raise the floor SHALL assert one user-visible result and one
durable system result, and SHALL NOT use retries to stabilise evidence. A story
whose only effect is to import a module so it stops counting as 0% SHALL NOT be
used to move the metric.

#### Scenario: Denied action

- **WHEN** a story covers a rejection branch
- **THEN** it asserts both the user-visible reply and that the affected store
  gained no row

#### Scenario: Load-only story

- **WHEN** a proposed story reaches a module without asserting a behavior of it
- **THEN** it does not qualify as coverage, and the module stays counted at 0%

### Requirement: Recorded qualification baseline

The roadmap design doc SHALL carry a literal `baselineSha`, the frozen
`treeHash` read from `reports/stories/manifest.json`, and the list of verified
commands. Shell variable names SHALL NOT remain in the rendered document.

#### Scenario: Baseline recorded

- **WHEN** the foundation verifies green on a commit
- **THEN** that commit's SHA and manifest tree hash are written as literals in
  the same commit that records them

#### Scenario: Baseline is immutable

- **WHEN** a later change edits a frozen story input
  (`tests/stories/**`, `scripts/story/**`, `bunfig.toml`, `tests/setup.ts`,
  `tests/mock-reset.ts`, `tests/utils/test-helpers.ts`)
- **THEN** the recorded baseline no longer qualifies and a new baseline must be
  recorded before any refactor branch claims compatibility

### Requirement: Compatibility proven against the baseline

Both `BASE_REF=<baselineSha> bun test:stories:compat --manifest-only` and the
full `BASE_REF=<baselineSha> bun test:stories:compat` SHALL exit zero on the
recorded baseline commit.

#### Scenario: Compat run

- **WHEN** either compat command runs with the recorded `BASE_REF`
- **THEN** it exits zero and the full run executes the frozen suite from its
  immutable session

### Requirement: Ledger entries are evidence-bearing

A documented behavior SHALL qualify only through a ledger entry backed by an
executable record. `blocked:missing-implementation` and `retired` entries SHALL
NOT count as evidence, and a `partial` record SHALL NOT qualify a global
production refactor.

#### Scenario: Blocked entry offered as evidence

- **WHEN** a behavior's only ledger entry is `blocked:missing-implementation`
- **THEN** the behavior counts as uncovered
