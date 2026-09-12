## Purpose

The live conformance protocol that closes the afk-runner prototype window: proof definition for real end-to-end runs with real agent spawns, induced-incident recovery drills, the live-corpus lane, the reflection/re-score form, and the honest split of the C1 relaxation promise.

## ADDED Requirements

### Requirement: Live conformance run

The runner SHALL complete a think-half run against a real target repository using real agent spawns, from `start` to a terminal memo, without stubbed agents or fixture substitution. The proof runs' depth profile SHALL be decided by the live classifier (prescreen + estimator); a depth override SHALL NOT be used. A calibration run (the classifier's honest-S space: a docs-shaped change) SHALL precede the proof run to validate config, spawn, gate, and waiter plumbing before the proof run is attempted.

#### Scenario: Calibration run completes

- **WHEN** the runner starts on an honestly-S-classified docs-shaped task file against a real target repository
- **THEN** the run reaches a terminal memo without stubbed agents, and the produced change passes `openspec validate --strict`

#### Scenario: Misclassification is recorded, not corrected

- **WHEN** the live classifier assigns a different profile than the operator expected
- **THEN** the assigned profile stands for the run and the divergence is recorded as a reflection input, not overridden via the depth flag

### Requirement: Induced incident recovery, live

The proof run SHALL include two induced incidents, and recovery SHALL use documented operator verbs only: a process-kill during an in-flight review round, and a veto settled at a final gate after a converged round.

#### Scenario: Kill during an in-flight review round

- **WHEN** the runner process is killed while a review round is open, its verdict unrecorded, and a reviewer spawn in flight
- **THEN** `resume` re-runs the same round continuing the in-flight session from the session ledger, and the run thereafter reaches a terminal memo; any orphaned agent-child behavior is observed and recorded

#### Scenario: Veto at a final gate

- **WHEN** a final gate on a converged round is settled with outcome veto
- **THEN** the run re-enters draft as revision work, the review loop opens a new round over the existing cap, and the run re-presents the final gate at the next version

### Requirement: Declared-failure live drill

A scratch run with an unreachable agent configuration (a model name that fails agent-side) SHALL reach the escalation gate through declared failure bookkeeping, and settling it with abort SHALL produce a memo with terminal status `failed`. The drill SHALL pre-register the expected failure kind (`exhausted` — agent-level failure) rather than transport-level infra.

#### Scenario: Bogus model escalates and fails honestly

- **WHEN** a scratch run is started with a model name that no provider resolves and the escalation gate is answered with abort
- **THEN** a `stage_failed` event with kind `exhausted` is recorded, an escalation-mode gate is presented and settled, and the terminal memo records status `failed`

### Requirement: Operator discipline pass criteria

The proof run SHALL pass only if: no events are appended by anything other than the runner; no run-state files are edited outside the gate/steer answer surfaces; the produced change validates strictly and its tests pass in the target repository; every park's memo and report are consistent with the folded log; and the reflection names at least three concrete frictions.

#### Scenario: No operator surgery

- **WHEN** the proof run and its incidents are complete
- **THEN** the events log contains only runner-authored events and the only operator writes are gate answers and steer inputs, verifiable by audit against transcripts and stamps

### Requirement: Live corpus lane

The proof run's event log SHALL be harvested into the fixture corpus as a live-marked lane, distinct from legacy and synthetic marks. The lane's oracle SHALL assert fold-consistency: folding the harvested log reproduces the memo fields the run persisted, and event-schema validation passes over every line including agent noise.

#### Scenario: Harvested log folds to its own memo

- **WHEN** the live-marked log is folded and compared with the memo the run wrote
- **THEN** the derived memo fields match, and every line validates against the event schemas

### Requirement: Reflection and ledger re-score

The reflection artifact SHALL score every follow-ups-ledger item with a verdict from a closed set (`next`, `rise`, `hold`, `fall`, `park`, `retire`), an evidence field citing run artifacts for every non-park verdict, and a falsifiable trigger for later re-opening. Exactly one item SHALL carry verdict `next`, or an explicit tie note SHALL be recorded. The re-scored table SHALL carry an n=1 provisionality preamble, and the living ledger SHALL move to the afk-runner architecture doc.

#### Scenario: Every ledger item is re-scored with evidence

- **WHEN** the reflection is written after the proof run
- **THEN** each U-item has a verdict, park verdicts cite absence of evidence, non-park verdicts cite at least one run artifact, and exactly one `next` is promoted or a tie is explained

### Requirement: Relaxation window close-out

The oxlint prototype relaxations for the afk workspace (line limits, unsafe-type-assertion, classes-per-file) SHALL be removed with lint green at repo defaults. The duplicate-detection ignores and the tests-side type-aware relaxations SHALL be re-timed to the sdd-runner retirement follow-up with their justification recorded at the relaxation site, because they guard the parity oracle that only retirement can remove.

#### Scenario: Lint re-tightens green

- **WHEN** the afk-scoped oxlint overrides are deleted from the lint config
- **THEN** `bun run lint` passes at repo defaults with no afk-scoped rule suppressions remaining

#### Scenario: Oracle ignores are re-annotated, not silently kept

- **WHEN** the close-out completes
- **THEN** the duplicate-detection ignore list and the remaining tests-side relaxation carry recorded justification naming the retirement follow-up they are timed to
