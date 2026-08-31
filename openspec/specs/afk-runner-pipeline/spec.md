# afk-runner-pipeline Specification

## Purpose

Defines the run pipeline afk-runner drives end to end — stage sequence by depth, gates, review rounds, and event-sourced state — so every run ends at a park with replayable history.

## Requirements

### Requirement: Stage sequence through the tail

The pipeline SHALL drive a run through intake, draft, the review loop, and a
tail — task decomposition, atomicity checking on depth M/L, and a final gate —
and SHALL end every run at a park: `completed` via final-gate approval or
`aborted` via abort. A depth-S run SHALL skip the atomicity stage, with
decomposition presenting the final gate as its last work act. No completion
path SHALL produce a completed run whose change folder lacks `tasks.md`.

#### Scenario: Depth-S run skips atomicity

- **WHEN** a run classified depth S converges
- **THEN** the pipeline runs decomposition and presents the final gate without an atomicity stage

#### Scenario: Completed run carries the task list

- **WHEN** any run reaches `completed`
- **THEN** the change directory contains a `tasks.md` produced by the pipeline's decomposition stage

### Requirement: Early-gate approval continues the pipeline

When a human approves an early (cap-hit) gate, the pipeline SHALL continue into
the tail — decomposition, atomicity checking, and a final gate — instead of
finalizing the run. An extend SHALL run exactly one more review round and
re-present at the next gate version; a settled gate-level veto SHALL re-enter
draft as a revision round.

#### Scenario: Approval at an early gate proceeds to the tail

- **WHEN** a human approves an early gate (all boxes checked, blockers answered)
- **THEN** the pipeline runs decomposition and atomicity checking and presents the final gate, instead of marking the run completed

#### Scenario: Final gate after early approval carries the next version

- **WHEN** the final gate is presented following an early-gate approval at version `n`
- **THEN** it is written as `gate-<n+1>.md`, preserving the versioned audit trail

#### Scenario: Gate-level veto re-enters draft

- **WHEN** a gate is settled with a gate-level veto redirect
- **THEN** the pipeline re-enters the draft stage as a revision round instead of continuing to the tail

### Requirement: Severity-based convergence

A review round that reaches the round cap with zero open BLOCKER findings and
zero open MATERIAL findings — nitpicks only, each resolved or dismissed — SHALL
be treated as converged and SHALL flow into the tail without presenting an
early gate. A cap-hit round with any open BLOCKER or MATERIAL finding SHALL
present an early gate for human sign-off.

#### Scenario: Nitpick-only cap-hit converges without a gate

- **WHEN** the review loop reaches its round cap and every open finding is a resolved or dismissed nitpick
- **THEN** the pipeline proceeds directly to the tail without a gate

#### Scenario: Open material finding at cap still gates

- **WHEN** the review loop reaches its round cap with at least one open MATERIAL finding
- **THEN** an early gate is presented and the pipeline waits for a human decision

### Requirement: Resume covers every stage

A run interrupted anywhere — mid-stage, mid-tail, or at a pending gate — SHALL
be resumable by re-folding the event log and re-entering at the interrupted
stage. Resuming a gate-pending run SHALL direct the operator to the pending
gate file and the resume verb rather than exiting silently.

#### Scenario: Interrupted tail resumes at its stage

- **WHEN** a run stopped during decomposition or atomicity checking is resumed
- **THEN** the pipeline re-enters at the interrupted stage and continues toward the final gate

#### Scenario: Resume on a gate-pending run points at the gate

- **WHEN** `resume` is invoked for a run whose gate is pending
- **THEN** the operator is told the run awaits a gate decision and given the gate file path and run id

### Requirement: Gate decisions disclose their downstream effects

Every gate presentation SHALL state, next to each available decision, what the
pipeline does next if that decision is taken — including that approval at an
early gate continues to the tail, that extend runs one more review round, and
that approval at the final gate completes the run.

#### Scenario: Early gate explains approval

- **WHEN** an early gate is presented
- **THEN** its text states that approving continues the pipeline to decomposition and a final gate, and that extending runs one more review round

### Requirement: Round-open owedness

A `round_open` event SHALL be appended only when it changes the folded round
state. Same-round re-entries — resume of an interrupted round, extend
re-entry, and an under-budget escalation retry — SHALL re-run the round's work
without appending another `round_open`; recursion into round n+1 SHALL always
open. Work-shaped events (findings, convergence, round close) SHALL never be
suppressed by re-entry.

#### Scenario: Interrupted round resumes without re-opening

- **WHEN** a run is interrupted mid-round and resumed into the same round
- **THEN** the round's work re-runs and the event log gains no second `round_open` for that round

#### Scenario: Extend re-entry opens only the next round

- **WHEN** an extend settle moves the loop to the next round
- **THEN** exactly one `round_open` for the new round is appended

### Requirement: Classified resume events

Every `resume` invocation SHALL append exactly one classified `resume` event
recording its re-entry path and stage — including invocations that find a
parked gate or a terminal state. Replay of the event log alone SHALL
reconstruct how each resumption re-entered the run.

#### Scenario: Parked-gate resume records its path

- **WHEN** `resume` is invoked for a run parked at a gate
- **THEN** exactly one `resume` event classified as a gate artifact-skip is appended

#### Scenario: Terminal resume records too

- **WHEN** `resume` is invoked for an already-completed run
- **THEN** exactly one `resume` event is appended and the run state is unchanged
