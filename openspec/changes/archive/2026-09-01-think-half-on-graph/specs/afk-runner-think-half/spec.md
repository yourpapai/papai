## Purpose

Live think-half runs (intake → draft → review) driven by the afk-runner graph kernel: a generic drive loop executes work declared by state modules, the machine context owns all legacy-derived run state, and resume is replay. This capability covers the observable contract of starting, parking, and resuming such runs; gate settlement and tail stages belong to later capabilities.

## ADDED Requirements

### Requirement: Graph-driven execution

A live run SHALL be advanced by a generic loop that derives the next action solely from the folded machine state and the work declared by the active state's module. The loop itself SHALL NOT name pipeline stages or encode sequencing; adding a state with declared work and edges SHALL make it executable without loop changes.

#### Scenario: New state without control-flow edits

- **WHEN** a state module declaring work and a successor edge is composed into the machine
- **THEN** the drive loop executes that work and follows that edge without any edit to the loop

#### Scenario: Stage bracket is loop mechanics

- **WHEN** a state's work begins and later completes
- **THEN** the log contains a `stage_enter` for that state before any of its domain events and a `stage_exit` after, appended by the loop rather than by the work module

### Requirement: Full derived-state parity

Folding any historical run log through the kernel SHALL produce machine context equivalent to the legacy replay fold's full derived state — stage map, depth profile, round, per-round digests with last verdict, gate record, auto-decision records, and children — not only the stage map.

#### Scenario: Historical log parity beyond stages

- **WHEN** an existing sdd-runner run log containing depth, round, finding, convergence, gate, auto-decision, plan, and child events is folded
- **THEN** every derived field matches the legacy fold output for that log

#### Scenario: Tally accumulator parity

- **WHEN** a log's `finding` events resolve or dismiss items across multiple rounds before each `convergence`
- **THEN** the per-round digest records match the legacy fold's resolved/dismissed tallies exactly

### Requirement: Append boundary

The only writes to the run log SHALL pass edge validation first. A `stage_enter` that has no legal edge from the current folded position SHALL be refused: nothing is appended and the refusal surfaces as an error to the operator.

#### Scenario: Illegal enter refused

- **WHEN** a work module attempts to append a stage enter for which no edge exists from the current position
- **THEN** no event is appended, and the error names the refused event

#### Scenario: Log records validated transitions only

- **WHEN** the log is re-folded after a refusal
- **THEN** its state is unchanged from before the refused append

### Requirement: Think-half run lifecycle

A fresh run SHALL execute intake, draft, and review with real agent work and SHALL then park: after convergence it parks awaiting tail states; on round-cap exhaustion with open blockers or materials it appends `gate` presented and parks gate-pending. Parked runs SHALL report their parked reason as data, not as failures.

#### Scenario: Converged run parks

- **WHEN** the review loop converges
- **THEN** the run stops after `stage_exit(review)` with no further stage entered, and reports awaiting-tail

#### Scenario: Cap-hit run parks gate-pending

- **WHEN** the round cap is hit with open blockers or materials
- **THEN** a `gate` presented event is appended and the run reports gate-pending without proceeding

### Requirement: Resume by replay

Resuming a stopped or crashed think-half run SHALL be a function of the event log plus the session ledger: the new process re-folds the log, derives the resume point (stage, round, continuation session) from folded context, and re-enters the interrupted stage. No persisted state pointer SHALL be consulted for control-flow decisions.

#### Scenario: Crash mid-round

- **WHEN** a process dies between a round's `round_open` and its `convergence` and a new process resumes the run
- **THEN** the interrupted round re-runs from its recorded continuation session, if any, and the review stage's stage map reflects the re-entry exactly as the legacy fold would

#### Scenario: Memo is not truth

- **WHEN** the run's derived memo file is absent or stale
- **THEN** start, resume, and status behave identically, deriving everything from the log
