<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## MODIFIED Requirements

### Requirement: The floor describes the tree it was measured on

The floor in `scripts/story/coverage-floor.json` SHALL be a recorded
measurement of the current scope, derived with the ratchet's epsilon
convention (`floor((measured - 0.005) * 100) / 100`). It SHALL be raised
automatically by `bun coverage:ratchet:stories` from a green run, and MAY be
re-recorded downward only by an explicit, reviewed edit that states the
measured scope. `meanMetric` aggregation and `story-scope.ts` membership SHALL
NOT be changed to move the number.

The recorded floor SHALL reach lines 0.71 and functions 0.70, restoring the
values held before the scope grew, and SHALL be raised there by
`bun coverage:ratchet:stories` from a green run rather than written by hand.

#### Scenario: Floor restored

- **WHEN** added story coverage brings the measured mean to or above lines
  71.00% and functions 70.00%
- **THEN** `bun coverage:ratchet:stories` writes those values and the committed
  floor returns to 0.71/0.70

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

### Requirement: Recorded qualification baseline

The roadmap design doc SHALL carry a literal `baselineSha`, the frozen
`treeHash` read from `reports/stories/manifest.json`, and the list of verified
commands. Shell variable names SHALL NOT remain in the rendered document.

Raising the floor edits `scripts/story/coverage-floor.json`, and adding stories
edits `tests/stories/**`; both are frozen inputs. The baseline recorded before
the climb SHALL therefore be superseded, and a new baseline SHALL be recorded
on the commit that carries the restored floor.

#### Scenario: Climb retires the previous baseline

- **WHEN** the floor is raised and new stories land
- **THEN** the previously recorded `baselineSha` no longer qualifies, and no
  refactor branch may claim compatibility against it

#### Scenario: Baseline recorded

- **WHEN** the foundation verifies green on a commit
- **THEN** that commit's SHA and manifest tree hash are written as literals in
  the same commit that records them
