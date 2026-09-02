# afk-runner-recovery Specification

## Purpose

Declares agent failure as run facts, bounds retries behind a budget that escalates to a gate, gives operators an event-sourced give-up path, makes every park write an honest memo, and proves crash-resilience so an afk-runner run survives its agents and its own process dying.

## Requirements

### Requirement: Failure taxonomy with typed seams

The runner SHALL classify failures into three declared kinds — `exhausted` (an objective validator rejected the work after its in-work retries: artifact strict-validation, agent schema-validation), `precondition` (a structural dependency is missing and retry cannot help), and `infra` (the agent could not be reached or transported) — surfaced as typed errors at the work-module, agent-layer, and spawn seams. Any other error SHALL remain crash-shaped: no failure event, no memo change, uncaught — the refusal-alarm semantics for work-module bugs.

#### Scenario: Review agent exhausts schema validation

- **WHEN** a reviewer agent's output fails schema validation through the agent layer's retry loop in any stage including review and intake
- **THEN** the error is typed as exhaustion and becomes a declared failure, not a crash

#### Scenario: Precondition failure

- **WHEN** a stage cannot run because a structural dependency is missing (e.g. tasks.md absent before atomicity)
- **THEN** the thrown halt is typed `precondition`

#### Scenario: Untyped errors stay crashes

- **WHEN** a work module throws an error that carries no failure classification
- **THEN** nothing is appended, the process dies as today, and a later resume re-enters the stage as a crash

#### Scenario: Infra failure

- **WHEN** spawning or transporting to the agent fails
- **THEN** the error is typed as `infra` at the spawn seam and becomes a declared failure

### Requirement: stage_failed events as bookkeeping

When the drive loop catches a classified failure it SHALL append a `stage_failed` event carrying the stage, kind, reason text, and resume hint. The event SHALL be root-level bookkeeping only: the stage map is untouched (the failed stage stays active, no stage exit is appended), and the fold SHALL maintain a per-stage consecutive failure ledger as non-projected context cleared by that stage's successful exit. Historical logs contain no such events and SHALL fold unchanged.

#### Scenario: Halt lands as an event, bracket stays open

- **WHEN** a stage's work fails validation-exhaustion and the budget is not spent
- **THEN** the log gains a `stage_failed` event while the stage remains active in the map with no exit event

#### Scenario: Ledger clears on success

- **WHEN** a stage that previously failed completes successfully and exits
- **THEN** its failure ledger entry resets, and a later failure of the same stage starts a fresh count

### Requirement: Retry budget with immediate re-run

The runner SHALL bound free retries per stage by a compiled constant budget over consecutive declared failures (exhausted and infra counted; precondition escalates immediately). Under budget the loop SHALL re-run the stage's bracket immediately through the existing re-entry mechanics without human involvement; at or over budget it SHALL present an escalation gate instead. The budget SHALL be enforced identically by the live loop and by resume derivation through one pure check over the folded context, so a process death between failure and escalation presents the same gate on resume. A stage re-entry through the spawn seam whose (label, round) has a latest in-flight ledger entry with status `killed` SHALL continue that entry's opencode session (the continuation spawn path the cross-process resume uses) instead of rebuilding from a fresh session; with no in-flight `killed` entry the re-run SHALL spawn fresh.

#### Scenario: Under-budget retry is automatic

- **WHEN** a stage declares its first failure and the budget is not spent
- **THEN** the loop re-runs the same stage's work in the same process and the run keeps driving

#### Scenario: Resume counts prior failures

- **WHEN** a run whose log already carries N stage_failed events for the active stage is resumed and fails again past the budget
- **THEN** resume presents the escalation gate rather than re-entering work

#### Scenario: Retry continues the killed session

- **WHEN** a stage's spawn dies mid-flight (ledger entry settled `killed`) and the stage re-runs in the same process — watchdog retry, under-budget re-run, or escalation-approve re-entry
- **THEN** the retrying spawn continues the killed entry's opencode session id (continuation prompt, same session in the ledger) rather than minting a fresh session

#### Scenario: No killed entry spawns fresh

- **WHEN** a stage re-runs with no in-flight `killed` ledger entry for its (label, round)
- **THEN** the re-run spawns a fresh session, unchanged from the pre-change behavior

### Requirement: Escalation gate as a fourth mode

Budget exhaustion SHALL present an escalation gate as gate mode `escalation`, riding the existing gate machinery — one settle seam, one waiter, one claims protocol, inherited deadline behavior (expiry takes conservative branches only, re-arms once, never aborts). Presentation SHALL be interstitial: the presented event itself moves the machine into the gate compound while the failed stage stays active in the map, and the gate content SHALL be the failure ledger (each failure's kind and reason), the resume hint, budget math, and spend. Settlement outcomes SHALL be approve (retry: re-enter the failed stage), extend (grant fresh budget by clearing the stage's ledger, then re-enter), and abort (the existing abort edge); veto SHALL NOT be offered.

#### Scenario: Presentation parks with the failure visible

- **WHEN** the budget is exhausted at a stage
- **THEN** the machine parks in the gate compound awaiting settlement, the failed stage remains active in the map, and the gate file renders the failure ledger and resume hint

#### Scenario: Approve retries the stage

- **WHEN** an escalation gate settles approve
- **THEN** the mover re-enters the failed stage and its bracket re-runs

#### Scenario: Extend grants fresh budget

- **WHEN** an escalation gate settles extend
- **THEN** the stage's failure ledger is cleared, the mover re-enters the failed stage, and subsequent failures count from zero

#### Scenario: Abort terminates as failed

- **WHEN** an escalation gate settles abort
- **THEN** the machine reaches the aborted final and the memo records status `failed`

#### Scenario: Completion stays blocked

- **WHEN** any escalation settlement lands
- **THEN** the completed edge cannot fire from it (the failed stage is still active)

### Requirement: Escalation ladder rung and steer answerability

Every escalation presentation SHALL run the always-logging ladder and record its decision; when spend is over the configured cost ceiling or unknown, the rung SHALL attribute the gate to the reserved `R5` rule and suppress the extend offer. The steer surface SHALL accept `extend` and `abort` at an escalation gate (extend is invalid only at final gates), so an unattended watcher can answer without a terminal.

#### Scenario: Over-ceiling escalation attributes R5

- **WHEN** an escalation gate presents while spend exceeds the cost ceiling or cost is unknown
- **THEN** the logged auto-decision cites rule R5 and the extend directive is not offered in the rendered gate

#### Scenario: Steer answers an escalation gate

- **WHEN** a steer file containing `extend` (or `abort`) appears while an escalation gate is parked
- **THEN** the waiter settles through the seam accordingly and the run re-drives

### Requirement: Operator abort and session release

A stop command SHALL be the first producer of the calm-stop path for live runs (marker honored at the next boundary, run parks resumable) and, for runs with no live owner, SHALL append an operator abort event that reaches the aborted final from any non-terminal position, making the memo terminal and releasing the session id. An abort settled at an escalation gate SHALL memo as `failed`; every other abort SHALL memo as `aborted`.

#### Scenario: Stop on a dead run releases the slug

- **WHEN** the stop command targets a run whose holder is gone
- **THEN** an abort event lands, the run folds to aborted, the memo is terminal, and a new run may allocate the same session id

#### Scenario: Stop on a live run is calm

- **WHEN** the stop command targets a run with a live owner
- **THEN** a calm-stop marker is written and the run parks stopped at its next boundary, resumable

### Requirement: Honest memo on every park

Every drive exit path — including failure-driven parks — SHALL write the derived memo. An escalation-parked run SHALL memo as `running` with a gate record of mode `escalation`; the `failed` status SHALL be written exactly when a run terminates by abort at an escalation gate; no run SHALL keep a stale `running` memo after its process has parked or halted.

#### Scenario: Escalation park memos running with the gate

- **WHEN** a run parks at an escalation gate
- **THEN** the memo says running and carries the escalation gate's mode and version

#### Scenario: No stale running after failure

- **WHEN** a run's process exits after appending a failure event
- **THEN** the memo on disk reflects a resumable non-running-truth state rather than an untouched stale copy

### Requirement: Torn-tail tolerance and prefix resilience

Event reading SHALL tolerate exactly one malformed final line (an interrupted append) by treating it as absent with a warning; a malformed interior line SHALL remain a hard error. For every prefix of every fixture and scenario log, folding SHALL produce a legal machine state and a parked reason or drivable verdict without throwing, and resuming from any prefix with deterministic agents SHALL reach the same terminal state as the uninterrupted run.

#### Scenario: Torn tail folds as its clean prefix

- **WHEN** a log's final line is a half-written event
- **THEN** the fold behaves exactly as if that line were absent and logs a warning

#### Scenario: Interior corruption still fails

- **WHEN** a malformed line appears before later valid lines
- **THEN** reading the log throws, naming the line

#### Scenario: Resume from any prefix converges

- **WHEN** a deterministic fake-agent run is resumed from every possible event prefix
- **THEN** each resume reaches the same final state and memo as the uninterrupted run

### Requirement: Escalation crash-window recovery

Resume SHALL heal the escalation presentation window: a folded budget-exhausted stage with no presented gate record SHALL re-present the escalation gate (at the on-disk file version when files exist), and an answered escalation gate whose mover never landed SHALL append the owed mover targeting the still-active failed stage.

#### Scenario: Crash after failure, before presentation

- **WHEN** a process dies after the failure event but before the presented event and the run is resumed
- **THEN** resume presents the owed escalation gate and parks gate-pending

#### Scenario: Crash between answer and mover

- **WHEN** an escalation answer landed but its mover did not
- **THEN** resume appends the owed mover re-entering the still-active failed stage

### Requirement: Corpus conformance for failure shapes

The kernel SHALL fold every historical fixture unchanged and fold five synthetic failure scenarios (approve-cycle, extend-cycle, abort-terminal, precondition-immediate, under-budget-retry-success) identically to the legacy fold across all replay-state fields at every event.

#### Scenario: Synthetic failure fixtures fold identically

- **WHEN** the parity harness folds the five failure-scenario fixtures
- **THEN** kernel and legacy folds agree on every replay-state field at every event, and historical fixtures remain identical
