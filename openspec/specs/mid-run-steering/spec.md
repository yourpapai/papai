# mid-run-steering Specification

## Purpose

Defines how a non-command message joins a live agent turn: which run it targets, when it reaches the model, what the user sees, and how undelivered text is preserved.

## Requirements

### Requirement: Mid-run messages target the active run in the same thread

The system SHALL route a non-command message to the active run keyed by the message's storage context id, and SHALL NOT steer a run in another thread, context, or platform instance.

#### Scenario: Active run in the same thread

- **WHEN** a non-command message arrives while a run is active for the same storage context id
- **THEN** the message is accepted as steering text for that run and no new turn is enqueued

#### Scenario: No active run in the thread

- **WHEN** a non-command message arrives with no active run for its storage context id
- **THEN** the message follows the normal queued-turn path, even if another thread has an active run

#### Scenario: Commands bypass steering

- **WHEN** the message is a command such as `/stop`
- **THEN** it is not treated as steering text

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

### Requirement: Steering is acknowledged immediately

The system SHALL acknowledge an accepted steering message immediately with the localized steer acknowledgement, and SHALL NOT delay or replace that acknowledgement while the run continues.

#### Scenario: Acknowledged before delivery

- **WHEN** steering text is accepted
- **THEN** the user receives the steer acknowledgement even if the run ends before the next step boundary

### Requirement: Undelivered steering text is preserved

The system SHALL distinguish delivered from undelivered steering text and SHALL re-enqueue undelivered text as a fresh turn instead of dropping it. The fresh turn carries no originating message ids.

#### Scenario: Run finishes before delivery

- **WHEN** the run ends before the steering text reaches a step boundary
- **THEN** the undelivered text is replayed as one fresh turn

#### Scenario: Delivery confirmed

- **WHEN** the run reports that the steering text was delivered
- **THEN** no fresh turn is created for that text

#### Scenario: Stop, abort, or failure

- **WHEN** the run stops, aborts, or fails before delivery
- **THEN** the undelivered text is replayed as one fresh turn rather than lost

### Requirement: Steering state is thread-isolated and in-memory

The system SHALL keep steering state per storage context id and SHALL NOT persist it or share it across threads, config contexts, users, or platform instances.

#### Scenario: Thread isolation

- **WHEN** two threads have runs at the same time
- **THEN** each run accepts only its own thread's steering text

#### Scenario: Config-context independence

- **WHEN** a steering message is accepted in one config context
- **THEN** no durable config, tool_prefs, guest-mode setting, or task-instance state changes

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
