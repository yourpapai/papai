## Purpose

A lifecycle graph kernel for the afk-runner workspace: pipeline stages, transitions, and guards declared as data, whose authoritative state is derived exclusively by folding the append-only event log. This makes crash resume, audit, and conformance testing all the same operation — replay.

## ADDED Requirements

### Requirement: Machine as data

The lifecycle graph SHALL be declared as data (states, transitions, guards, per-state metadata) separate from the code that executes it. Adding a state or transition SHALL NOT require editing procedural control flow in an orchestrator.

#### Scenario: New state without control-flow edits

- **WHEN** a state and its transitions are added to the graph declaration
- **THEN** the orchestrator executes it without changes to its own branching logic

### Requirement: Log is truth

The kernel's current state SHALL be derivable solely from the append-only `events.ndjson` log by folding events through the graph. No persisted state pointer SHALL be authoritative. Folding the same log twice SHALL produce identical state.

#### Scenario: Deterministic re-fold

- **WHEN** the same event log is folded twice from an empty initial state
- **THEN** both folds produce the identical derived state

#### Scenario: Crash resume by replay

- **WHEN** a process driving a run dies and a new process re-folds the run's event log
- **THEN** the new process observes the same state the dead process last observed, with no persisted pointer consulted

### Requirement: Append-only event log

The kernel SHALL NOT mutate or rewrite previously appended events. New information is recorded only by appending. Edge work (agent spawns, schema validation, file predicates) SHALL complete before its triggering event is appended; the log records only validated transitions.

#### Scenario: Validation precedes the event

- **WHEN** an async validation (e.g. artifact schema check) runs at the live edge
- **THEN** the corresponding transition event is appended only after validation succeeds, and a failed validation appends nothing

### Requirement: Pure transitions with sync guards

Graph transitions SHALL be evaluated as pure functions of (current state, event). Guards SHALL be synchronous predicates over already-derived state. Async validation SHALL happen at the edge before an event exists, not inside a guard.

#### Scenario: Guard without side effects

- **WHEN** a transition's guard is evaluated during a fold
- **THEN** no I/O occurs and the fold result depends only on the input state and event

### Requirement: Closed action vocabulary

Work scheduled by transitions SHALL be expressible in a closed, tiny action vocabulary (emit event, schedule edge work). The interpreter for this vocabulary SHALL be the only place the graph causes effects.

#### Scenario: Replayed actions are inert

- **WHEN** historical events are re-folded (replay, parity harness, tests)
- **THEN** no actions execute and no agents or side effects are triggered

### Requirement: Golden replay parity

Historical `sdd-runner` run logs SHALL replay through the kernel to a derived stage map equivalent to the legacy replay fold (`ReplayState.stages`). Unknown-to-the-graph events in a log SHALL be tolerated by the fold without failing the replay.

#### Scenario: Historical log parity

- **WHEN** an existing `sdd-runner` run's `events.ndjson` is folded through the kernel
- **THEN** the resulting stage statuses match the legacy `replayEvents` output for the same log

#### Scenario: Tolerant replay

- **WHEN** a log contains event types the graph does not transition on
- **THEN** the fold skips them without error and retains the state derived from recognized events
