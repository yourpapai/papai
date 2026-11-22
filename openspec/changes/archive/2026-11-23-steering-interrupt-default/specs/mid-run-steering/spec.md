<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: Steering text is delivered at the next step boundary`
- TO: `### Requirement: Steering text is delivered as early as the run can act on it`

## MODIFIED Requirements

### Requirement: Steering text is delivered as early as the run can act on it

The system SHALL deliver accepted steering text as early as the run can act on it: when a model call is in flight, the run's interrupt budget allows, and no graceful stop has been requested, it SHALL request cancellation of that call and redo the same step with the text; otherwise it SHALL deliver the text at the next tool-step boundary. Arrival order SHALL be preserved.

#### Scenario: Interrupt before the step acts

- **WHEN** steering text is accepted while a model call is in flight, the run's interrupt budget allows, and no stop has been requested
- **THEN** the in-flight call is cancelled, the same step is redone with the text, and no tool call from the cancelled attempt runs

#### Scenario: Delivery after the current step

- **WHEN** steering text is accepted while no model call can be interrupted — tools are running, no call is in flight, or the interrupt budget is exhausted
- **THEN** the run continues and the text reaches the model at the next tool-step boundary without interrupting a running tool

#### Scenario: Stop already requested

- **WHEN** steering text is accepted after the first `/stop` has requested a graceful stop
- **THEN** no interrupt is requested, the stop condition ends the run at the boundary, and the text follows the undelivered-text replay path

#### Scenario: Ordering

- **WHEN** two steering messages arrive in order
- **THEN** the model receives them in the same order, each as a user message, whether the step is redone or the text waits for the next boundary

#### Scenario: Every platform instance

- **WHEN** a qualifying mid-run message arrives on any configured platform instance
- **THEN** the same run registry and delivery rule apply, and the immediate acknowledgement is unchanged

## ADDED Requirements

### Requirement: Interrupt requests are bounded per run

The system SHALL request at most three interrupts per run, counted when the text is accepted. After the maximum, accepted text SHALL be delivered without an interrupt request. A cancelled model call SHALL NOT count as a step; it may still be billed by the provider and is excluded from recorded usage. The count SHALL be in-memory, keyed by storage context id, and reset when the next run begins.

#### Scenario: Within the budget

- **WHEN** qualifying text is accepted while a model call is in flight and the run has requested fewer than three interrupts
- **THEN** the text is passed with an interrupt request

#### Scenario: Budget exhausted

- **WHEN** qualifying text is accepted after the run has requested three interrupts
- **THEN** the text is delivered at the next step boundary, still receives the immediate acknowledgement, and produces no user-visible error

#### Scenario: New run resets the count

- **WHEN** a new run begins for the same storage context id
- **THEN** its interrupt count starts at zero

#### Scenario: Threads keep independent counts

- **WHEN** two threads have runs at the same time
- **THEN** each run counts its own interrupts and cannot consume the other's budget

#### Scenario: Cancelled attempts do not consume steps

- **WHEN** an interrupt cancels a model call and the step is redone
- **THEN** the cancelled attempt does not consume a step and the turn continues within its existing step allowance

#### Scenario: Guest messages share the run budget

- **WHEN** a guest sends a qualifying mid-run message in a guest-mode group
- **THEN** the existing steering authorization applies and the message counts against the same run's interrupt budget

### Requirement: After-task text has no separate delivery mode

The system SHALL treat a mid-run message that asks for work after the current task as steering text. It SHALL NOT start a separate turn, queue entry, reply, or command flow for that text. The model instructions SHALL tell the model to finish the current task before handling such a request and never to drop it.

#### Scenario: After-task request while a run is active

- **WHEN** a qualifying mid-run message asks for work after the current task
- **THEN** it is accepted as steering text, no new turn or system-generated reply is created, and the model is instructed to sequence it after the current task

#### Scenario: No command to learn

- **WHEN** a mid-run message reads as a correction, an addition, or an after-task request
- **THEN** the same steering path handles it without a command or message prefix

#### Scenario: No active run

- **WHEN** such a message arrives with no active run for its storage context id
- **THEN** it follows the normal queued-turn path
