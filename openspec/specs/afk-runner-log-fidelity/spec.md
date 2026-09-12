# afk-runner-log-fidelity Specification

## Purpose

Makes the afk-runner event log faithful on re-entry and resumption: state-shaped round events append only when they change folded state, and every resume invocation leaves exactly one log-visible resume event.

## Requirements

### Requirement: Round-open emission owedness

The engine SHALL append a `round_open{round, cap}` event only when the event changes the folded round state — that is, when the round being opened is not already the fold's current round, or the effective cap differs from the fold's recorded cap for that round.

#### Scenario: Fresh round opens

- **WHEN** a review round begins whose number is not the current round in the folded state
- **THEN** exactly one `round_open` event for that round is appended

#### Scenario: Same-round resume does not re-open

- **WHEN** a resume re-enters a round that is already open in the folded state (its verdict unrecorded)
- **THEN** no additional `round_open` event for that round is appended

#### Scenario: Extend re-entry does not re-open

- **WHEN** an extend settle has opened round N+1 and the review work re-enters that round in the same or a later process
- **THEN** no second `round_open` event for round N+1 is appended

#### Scenario: Cap amendment still emits

- **WHEN** a round already open in the folded state is re-entered with an effective cap different from the fold's recorded cap
- **THEN** a `round_open` event for that round carrying the new cap is appended

#### Scenario: Historical duplicate tolerance is preserved

- **WHEN** a log contains duplicate `round_open` events for the same round (frozen historical logs)
- **THEN** both folds remain correct under last-write-wins semantics and replay validation still passes

### Requirement: Work-shaped events are never suppressed

Re-entered rounds SHALL still append their work-shaped events (findings, convergence, `round_close`); the owedness suppression applies only to the state-shaped `round_open` no-op.

#### Scenario: Re-run round records its work

- **WHEN** a resume re-enters and re-runs an interrupted round
- **THEN** that round's findings, convergence verdict, and `round_close` events are appended as usual

### Requirement: Resume-invocation event production

Every `resume` command invocation SHALL append exactly one `resume{path, stage, session?}` event, after any owed-recovery events the resume heals and before any work re-entry or park, classified from the post-recovery folded state plus the session ledger.

#### Scenario: Session continuation

- **WHEN** resume re-enters an open review round whose session ledger holds an in-flight session
- **THEN** one `resume{path: "session-continuation", stage: "review", session: <id>}` event is appended

#### Scenario: Stage rebuild

- **WHEN** resume re-enters an open round with no in-flight ledger session, or re-enters a non-review work stage
- **THEN** one `resume{path: "stage-rebuild", stage: <stage>}` event is appended

#### Scenario: Gate await and recovery-completed runs report artifact-skip

- **WHEN** resume lands on a presented gate — including a run the resume's own recovery healed or completed through a gate settle
- **THEN** one `resume{path: "artifact-skip", stage: "gate"}` event is appended

#### Scenario: Review never started

- **WHEN** resume re-enters a review stage that has opened no round
- **THEN** one `resume{path: "artifact-skip", stage: "review"}` event is appended

#### Scenario: Ordering after owed recovery

- **WHEN** the resume heals owed artifacts (a presentation, an escalation gate, stage exits, movers)
- **THEN** the resume event is appended after the healed events and before any event the subsequent drive produces

#### Scenario: One event per invocation

- **WHEN** resume is invoked repeatedly (for example a crash-looping operator)
- **THEN** each invocation appends its own `resume` event; the events are never deduplicated

#### Scenario: Folds tolerate resume events

- **WHEN** a log contains `resume` events
- **THEN** the kernel fold tolerates them without state change and the legacy fold replays them as a no-op
