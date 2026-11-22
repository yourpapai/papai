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

### Requirement: Steering text is delivered at the next step boundary

The system SHALL deliver accepted steering text to the model at the next tool-step boundary of the active run, preserving the order in which messages arrived.

#### Scenario: Delivery after the current step

- **WHEN** steering text is accepted during a step
- **THEN** the run continues and the text reaches the model after that step's tool activity completes

#### Scenario: Ordering

- **WHEN** two steering messages arrive in order
- **THEN** the model receives them in the same order, each as a user message

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
