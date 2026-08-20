<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Defines the restored Tier 0 story coverage floor and the immutable
qualification baseline that `test:stories:compat` measures refactor branches
against.

## ADDED Requirements

### Requirement: Floors are met, never lowered

The Tier 0 coverage gate SHALL pass at the recorded floors in
`scripts/story/coverage-floor.json` by adding durable story coverage. Lowering
either floor value, or changing how `meanMetric` aggregates, SHALL NOT be used
to make the gate pass.

#### Scenario: Gate below floor

- **WHEN** `bun test:stories:coverage` measures below either floor
- **THEN** it exits non-zero and prints the per-file uncovered diagnostics,
  and the remedy is added coverage, not an edited floor file

#### Scenario: Merge dilutes the mean

- **WHEN** a merge adds production files the story lane never loads
- **THEN** those files are seeded at 0% and counted in the scope, so the mean
  drops and the gate goes red rather than silently ignoring them

### Requirement: Every added story carries two oracles

Each story added to restore the floor SHALL assert one user-visible result and
one durable system result, and SHALL NOT use retries to stabilise evidence.

#### Scenario: Denied action

- **WHEN** a story covers a rejection branch
- **THEN** it asserts both the user-visible reply and that the affected store
  gained no row

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
