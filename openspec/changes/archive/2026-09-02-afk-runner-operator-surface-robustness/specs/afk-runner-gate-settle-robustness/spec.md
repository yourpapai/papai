<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## MODIFIED Requirements

### Requirement: Settle failures become feedback, never waiter death

Operator-input settle failures — unparseable responses, artifact-integrity failures, unreadable integrity sidecars — SHALL be contained: the waiter SHALL stay alive, surface the rejection reason to the operator (a sibling response-error artifact next to the gate file and the waiter's output stream), and SHALL NOT re-attempt the settle until the gate file's content digest changes. The containment SHALL cover every settle producer the waiter drives — the hand-edited gate file and the steer path alike: a steer directive whose translated answer throws inside the settle seam (for example an item veto addressing an id the gate does not declare) SHALL become the same contained feedback, with the steer file consumed, never waiter death. Failures of machine producers SHALL remain crash-shaped.

#### Scenario: Malformed hand edit keeps the waiter alive

- **WHEN** the operator's hand-edited response fails to parse
- **THEN** the waiter records the reason in the sibling error artifact, keeps waiting, and does not re-attempt until the file changes again

#### Scenario: Poisoned gate file does not crash-loop

- **WHEN** a resumed waiter finds a gate file whose content already failed a settle attempt and is unchanged
- **THEN** the waiter does not re-attempt the settle and stays alive

#### Scenario: Rejection message hints at missing expected content

- **WHEN** a settle is rejected because an item id the operator addressed is not declared and the gate's expected content is empty
- **THEN** the rejection reason notes that the expected content is empty, suggesting a missing sidecar

#### Scenario: Thrown steer settle stays contained

- **WHEN** a steer item-veto names an id the gate's expected content does not declare and the translated settle throws during render or preflight
- **THEN** the waiter records the thrown reason as the contained feedback artifact, consumes the steer file, and keeps waiting — the attending process survives
