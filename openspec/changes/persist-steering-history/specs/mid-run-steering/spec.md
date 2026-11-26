<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Spec Delta

## ADDED Requirements

### Requirement: Delivered steering text is persisted in conversation history

The system SHALL persist every steering message the model received into the thread's conversation history, in delivery order, as a user message placed before the assistant and tool messages of the step that received it. Persistence SHALL include text delivered by interrupt and at a tool-step boundary, and SHALL NOT add a second copy of text a fresh-turn replay already stores.

#### Scenario: Boundary delivery is persisted in place

- **WHEN** steering text is delivered at a tool-step boundary
- **THEN** history contains it as one user message before that step's assistant and tool messages

#### Scenario: Interrupt delivery is persisted once

- **WHEN** an interrupt cancels a model call and the redo receives the steering text
- **THEN** the text is persisted once with the redone step, and the cancelled attempt adds no history entry

#### Scenario: Undelivered text is not written by the run

- **WHEN** steering text is not delivered and is replayed as a fresh turn
- **THEN** the finished run writes nothing for it and the replay persists it once as a user turn

#### Scenario: Threads stay isolated

- **WHEN** two threads have runs at the same time
- **THEN** each thread's history receives only its own delivered steering text

#### Scenario: Guest text persists like a member's

- **WHEN** a guest's steering text is delivered in a guest-mode group
- **THEN** it is persisted in that group thread's history under the existing steering authorization

#### Scenario: Later readers see the corrected context

- **WHEN** a turn completes with delivered steering text
- **THEN** the next turn, a resumed turn, background trimming, and memory extraction read history that includes that text

### Requirement: Rewritten edit corrections are not duplicated in history

The system SHALL persist a mid-run edit notice only when the edited message had no stored user turn for the baseline correction to rewrite. When the original user turn was rewritten, history SHALL contain the rewritten turn without a second copy of the correction.

#### Scenario: Edit of a stored message

- **WHEN** a W1 edit rewrites the original user turn and the synthetic edit notice is delivered mid-run
- **THEN** history contains the rewritten user turn only, not the synthetic notice

#### Scenario: Edit of a steer-only message

- **WHEN** a W1 edit targets a message that has no stored user turn
- **THEN** the synthetic edit notice is persisted so the correction is not lost
