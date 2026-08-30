<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## MODIFIED Requirements

### Requirement: Foreground waiter

The invocation that reaches a gate-pending park SHALL determine the attach policy: `start` SHALL park and exit — reporting the parked reason, the gate file's path, and the resume command that attends — and `resume` SHALL remain alive in a foreground waiter polling the gate file and the steer file; a deadline-armed wait rides an attached waiter. A hand-edited file settles only after its content is stable across consecutive polls and parses as answered. A steer directive landing at a parked gate SHALL be translated to its answer equivalent, with extend-at-final-gate rejected as invalid. External settlement (another process answered it) SHALL exit the waiter cleanly. Calm-stop against a gate-pending run SHALL be a no-op.

#### Scenario: Start parks and exits at a gate

- **WHEN** a `start` invocation drives a run that presents a gate and parks gate-pending
- **THEN** the process exits without polling, and its summary names the parked reason, the gate file's path, and the resume command

#### Scenario: Resume attaches at a gate

- **WHEN** a `resume` invocation finds the run parked gate-pending
- **THEN** the process remains alive in the foreground waiter until the gate settles, exiting cleanly on external settlement

#### Scenario: Stable hand-edit settles

- **WHEN** the gate file changes to an answered shape and stays byte-identical across the stability window
- **THEN** the waiter settles through the seam and the run continues per outcome

#### Scenario: Steer extend at final gate skipped

- **WHEN** an extend steer directive lands at a final-mode parked gate
- **THEN** it is skipped with a warning and the gate stays pending
