## Purpose

The gate lifecycle as first-class afk-runner state: a presented gate parks the run in an awaiting position, four settle producers (TUI answers, hand-edited gate file, deadline expiry, autonomy ladder) answer it through one validated seam, and the answer's outcome keyes continuation on the graph — approve, extend, veto, or abort.

## ADDED Requirements

### Requirement: Gate awaiting is machine state

Presenting a gate SHALL move the run into an awaiting position of the gate state, whatever stage position the presentation arrived from (interstitial after review exit, or inside the gate stage bracket). The parked reason SHALL be derived from that position, not from gate-context sniffing in other stages' outcome data. Gate events SHALL NOT alter the stage map.

#### Scenario: Early gate parks positionally

- **WHEN** a cap-hit review appends a gate presented event while no stage is active in the map
- **THEN** the folded position is the gate awaiting state and the run reports gate-pending, with the stage map unchanged by the gate event

#### Scenario: Re-presentation re-arms awaiting

- **WHEN** a gate is presented again at version n+1 after an earlier answer (e.g. another cap-hit)
- **THEN** the run is awaiting version n+1, and prior answered records remain visible in folded context

### Requirement: Settlement through one validated seam

Every gate answer, whatever its producer, SHALL pass the same validation: the answer content is rendered and parsed back, gate integrity is verified against the recorded hashes, and the resulting events are appended through the append boundary. The log vocabulary SHALL be identical across producers; only the accompanying auto-decision attribution distinguishes a ladder-settled gate.

#### Scenario: Producers write indistinguishable vocabulary

- **WHEN** the same approve answer settles through a TUI answers object, a hand-edited gate file, and an R1 ladder decision
- **THEN** each appends the same gate answered event shape, and only the ladder run carries an auto-decision event naming rule R1

#### Scenario: Invalid answer refused

- **WHEN** a gate file's response section does not parse as a valid answer
- **THEN** nothing is appended and the error surfaces to the operator

### Requirement: Outcome-keyed continuation

An answered gate SHALL continue per its outcome: approve on an early gate appends the next-stage enter and proceeds; extend appends a round open with the raised cap and the extended round executes; veto appends a draft re-entry and a revision round runs incorporating the vetoes' redirects; abort terminates the run as aborted. A presented-but-unanswered gate parks; an answered gate SHALL NOT park again as cap-hit.

#### Scenario: Extend runs the extended round

- **WHEN** an extend answer settles a cap-hit gate at round n
- **THEN** a round open for round n+1 with a raised cap is appended and the review work runs that round

#### Scenario: Abort terminates

- **WHEN** an abort answer settles a gate
- **THEN** the run reaches the aborted final state and no further work is scheduled

#### Scenario: Answered gate releases continuation

- **WHEN** the folded context holds an answered gate and an opened round with no verdict
- **THEN** the run drives the review round rather than parking gate-pending

### Requirement: Explicit outcome with legacy derivation

New gate answered events SHALL carry an explicit outcome. Historical logs without the outcome field SHALL derive continuation from subsequent events and fold to identical context; a historical answered-with-nothing-after log SHALL park awaiting settlement rather than error.

#### Scenario: Historical extend log folds identically

- **WHEN** an existing log containing repeated answered/round-open pairs for one gate version is folded
- **THEN** context matches the legacy fold and the run is drivable into the opened round

### Requirement: Idempotent re-settlement

Repeated settlements of the same gate version (crash-resume cycles re-reading an answered gate file) SHALL append idempotent event sequences and fold without error; the driven work SHALL execute once per owed round.

#### Scenario: Triple settle in the corpus

- **WHEN** a log contains three answered events and three round opens for the same version and round (as the historical marathon run does)
- **THEN** the fold produces one answered gate record and one open round, and resume drives the round once

### Requirement: First-writer-wins claims

Concurrent settle attempts for one gate version SHALL be serialized by an exclusive-create claim artifact; the loser SHALL be rejected as already-settled with the winner named. Legacy claim artifact names SHALL count as claims.

#### Scenario: Racing settlers

- **WHEN** two processes attempt to settle the same gate version and one holds the claim
- **THEN** the other exits reporting already-settled, and exactly one settle sequence is appended

### Requirement: Foreground waiter

After a run parks gate-pending, the process SHALL remain alive in a foreground waiter polling the gate file and the steer file, when a deadline is armed or the operator ran the run interactively. A hand-edited file settles only after its content is stable across consecutive polls and parses as answered. A steer directive landing at a parked gate SHALL be translated to its answer equivalent, with extend-at-final-gate rejected as invalid. External settlement (another process answered it) SHALL exit the waiter cleanly. Calm-stop against a gate-pending run SHALL be a no-op.

#### Scenario: Stable hand-edit settles

- **WHEN** the gate file changes to an answered shape and stays byte-identical across the stability window
- **THEN** the waiter settles through the seam and the run continues per outcome

#### Scenario: Steer extend at final gate skipped

- **WHEN** an extend steer directive lands at a final-mode parked gate
- **THEN** it is skipped with a warning and the gate stays pending

### Requirement: Autonomy ladder as producer

At every presentation the autonomy ladder SHALL be evaluated and an auto-decision event SHALL always be appended, including when no rule applies (rule none). R1 (converged, zero findings, all low-blast) SHALL auto-approve through the settle seam; R2 (decreasing trajectory, no blockers) SHALL auto-extend; R4 SHALL fail closed to the human gate when cost is unknown or projected over ceiling. The auto-extend allowance used SHALL derive from folded auto-decision records.

#### Scenario: Ladder always logs

- **WHEN** a gate is presented and no ladder rule applies
- **THEN** an auto-decision event with rule none is appended alongside the presentation

#### Scenario: R4 fails closed

- **WHEN** spend is unknown or projected past the cost ceiling at presentation
- **THEN** the ladder decides gate-to-human and the run parks awaiting a human answer

### Requirement: Deadline expiry is thin and config-gated

Only when a deadline is configured SHALL a presentation stamp its absolute expiry into the presented event; without configuration no deadline is recorded. On expiry the waiter SHALL claim the gate exclusively, re-run the ladder permitting only conservative outcomes (approve, extend), re-arm at most once, and never auto-abort.

#### Scenario: Unconfigured deadline stamps nothing

- **WHEN** a run without deadline configuration presents a gate
- **THEN** the presented event carries no deadline and expiry never fires

#### Scenario: Expiry re-arms at most once

- **WHEN** a deadline expires twice with no conservative branch applicable
- **THEN** the first expiry re-arms once and the second leaves the gate pending indefinitely

### Requirement: Owed-mover resume

A log whose answered event carries an explicit outcome but whose outcome's mover event is missing (crash between the two appends) SHALL resume by appending the owed mover and continuing. A historical answered log without outcome SHALL park awaiting settlement, and its next settlement SHALL append an answered event carrying the explicit outcome.

#### Scenario: Crash between answer and round open

- **WHEN** a resume folds an answered outcome-extend event with no subsequent round open
- **THEN** the resume appends the owed round open and drives the extended round

#### Scenario: Historical abort heals on settle

- **WHEN** a historical answered-with-nothing-after log is next settled by reading its gate file
- **THEN** the appended answered event carries the explicit outcome and the run reaches the matching terminal or continuation state
