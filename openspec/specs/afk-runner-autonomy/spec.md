# afk-runner-autonomy Specification

## Purpose

Governs how afk-runner decides gates by policy: the single-mode ladder (R1-R5), its auto_decision event record, and the deadline waiter that can settle a gate conservatively when no human answers in time.

## Requirements

### Requirement: Single-mode policy evaluation

The policy ladder SHALL evaluate at every presented gate — early, final, and
escalation alike. There SHALL be no autonomy levels and no observe mode: the
ladder is unconditional, and a gate either settles by rule or waits for a
human.

#### Scenario: Every gate is evaluated

- **WHEN** any gate is presented
- **THEN** the ladder evaluates before the gate waits, and the evaluation's outcome is recorded in the event log

### Requirement: Unconditional policy previews

Every gate presentation SHALL render a policy preview naming each rule's
verdict and what blocked it, regardless of whether any rule fires; an
evaluation where no rung decides SHALL record rule none.

#### Scenario: Undecided gate still previews

- **WHEN** a gate is presented and no rung decides
- **THEN** the gate file carries the preview block and the log records an `auto_decision` event with rule none

### Requirement: Decision ladder ordering

The ladder SHALL evaluate R1, R2, R3, R4 in order; the first matching rung
SHALL settle the gate, and only when no rung decides SHALL the gate wait for a
human. Every auto-decision SHALL cite its rule id and an evidence digest
sufficient to replay why it fired.

#### Scenario: Human gate only when no rung decides

- **WHEN** a gate situation arises and no rule's predicate matches the recorded signals
- **THEN** the gate waits for a human decision

#### Scenario: Every auto-decision is attributable

- **WHEN** any rule auto-decides a gate
- **THEN** the decision record names the rule id and its evidence digest

### Requirement: R1 converged-final-approve

A final gate with zero findings of any severity SHALL be auto-approved by rule
R1. The auto-decided gate SHALL still write its gate file, consume a gate
version, and annotate each decided line with the deciding rule.

#### Scenario: Zero-findings final gate completes without a prompt

- **WHEN** a run converges with zero findings and presents its final gate
- **THEN** rule R1 auto-approves, the gate file exists with pre-checked boxes and rule annotations, and the run reaches `completed` with zero human prompts

#### Scenario: Any finding blocks R1

- **WHEN** a final gate carries any finding, however resolved
- **THEN** R1 does not fire

### Requirement: R2 trajectory-auto-extend

When a round cap is hit with zero open BLOCKERs, at least one open MATERIAL
finding, a strictly decreasing findings count across the last two rounds, and
projected remaining spend under the ceiling, rule R2 SHALL auto-extend exactly
one round. Auto-extends per run SHALL be bounded; if the extended round does
not converge or improve, the early gate SHALL be presented.

#### Scenario: Strictly decreasing burndown auto-extends once

- **WHEN** a cap-hit run has zero open BLOCKERs, open MATERIALs, strictly decreasing findings across the last two rounds, and projected spend under the ceiling
- **THEN** the run auto-extends exactly one round, appending an `auto_decision` event, without prompting

#### Scenario: Flat trajectory does not auto-extend

- **WHEN** a cap-hit run's findings count is flat or increasing across the last two rounds
- **THEN** R2 does not fire and the cap-hit gate is presented to the human

### Requirement: R3 assumption blast-radius triage

Each assumption at a gate SHALL be classified low-blast or high-blast by
deterministic arithmetic over recorded run artifacts only — never agent
judgment. An assumption SHALL be low-blast only when every file it references
lies inside the change folder or the run directory, it touches no spec delta,
and it touches no tasks checklist line; an assumption with missing, empty, or
unverifiable evidence SHALL be classified high-blast (fail closed). Low-blast
assumptions SHALL be auto-accepted with pre-checked, rule-annotated lines; when
items no rule can decide remain, the gate SHALL still be presented for them.

#### Scenario: Missing evidence fails closed

- **WHEN** an assumption's resolver sidecar entry lacks verifiable file evidence
- **THEN** the assumption is classified high-blast and presented to the human

#### Scenario: Mixed gate is pre-checked and still presented

- **WHEN** R3 auto-accepts low-blast assumptions on a gate that also contains items requiring a human decision
- **THEN** the low-blast items are pre-checked with rule annotations and the gate is presented for the remaining items

### Requirement: R4 budget guard

All auto-decisions in a run SHALL be bounded by the configured budget. Any
projected or actual exceedance SHALL cause the gate to wait for a human
regardless of any other rule's predicate. When the run's cumulative cost is
unknown, the guard SHALL fail closed: no auto-decision SHALL settle the gate.

#### Scenario: Budget exceedance gates despite other rules

- **WHEN** a rule's predicate matches but the run's projected spend crosses the configured budget
- **THEN** the gate waits for a human and is not auto-decided

#### Scenario: Unknown cost fails closed

- **WHEN** a rule's predicate matches but the run's cumulative cost cannot be determined
- **THEN** the gate waits for a human and is not auto-decided

### Requirement: R5 escalation rung

At an escalation gate — presented when a stage exhausts its per-stage failure
budget — rule R5 SHALL settle only when spend is over the ceiling or unknown,
and extend SHALL be suppressed from the rendered gate; otherwise the ladder
records rule none and the gate waits for a human.

#### Scenario: Over-ceiling escalation auto-settles without extend

- **WHEN** an escalation gate is presented and the run's spend is over the ceiling or unknown
- **THEN** R5 settles the gate and the extend directive was never offered

#### Scenario: Under-ceiling escalation waits

- **WHEN** an escalation gate is presented and spend is within the ceiling
- **THEN** the ladder records rule none and the gate waits for a human

### Requirement: Never-cut invariants

At every gate: (1) an open BLOCKER SHALL always produce a human gate; no rule
SHALL auto-answer or auto-override a BLOCKER. (2) Budget or round-cap
exceedance SHALL always gate. (3) Branch-leaving actions — PR creation, merges,
deletion of other branches — SHALL never be auto-decided; an auto-decision's
entire write set SHALL be the run directory plus the change folder. (4)
Auto-decided gates SHALL still write the gate file and consume a version so
they remain hash and audit anchors; the gate-file grammar gains only the
optional `decided-by:` line. (5) The event log SHALL remain append-only and
replay-sufficient.

#### Scenario: Open BLOCKER always gates

- **WHEN** any gate situation includes an open BLOCKER finding
- **THEN** the pipeline presents a human gate and no rule auto-decides it

#### Scenario: Auto-decided gate file parses under the extended grammar

- **WHEN** a gate file written by an auto-decision is parsed
- **THEN** it parses under the existing grammar plus the optional `decided-by:` line

### Requirement: auto_decision event

One `auto_decision` event SHALL be appended for every ladder evaluation —
including undecided evaluations and deadline-waiter settles — carrying the
rule, decision, evidence digest, and gate version. Replaying the event log
alone SHALL rebuild every evaluation and its outcome.

#### Scenario: Replay rebuilds evaluations from the log alone

- **WHEN** a run's event log is replayed without any other run artifacts
- **THEN** every ladder evaluation is reconstructible from the `auto_decision` events

### Requirement: Deadline waiter

When the run config sets a `deadline`, a gate presentation SHALL stamp the
deadline into run state; the foreground waiter attending the gate SHALL, at
expiry, re-run a conservative ladder and may settle the gate through the same
seam as every producer. Before any expiry settle the waiter SHALL claim the
gate via an exclusive-create claim so concurrent waiters cannot double-settle;
the deadline SHALL re-arm at most once, SHALL be cleared on any settle, and a
gate settled by any other producer SHALL end the wait. The conservative ladder
SHALL NOT auto-abort.

#### Scenario: Expiry settles under claim

- **WHEN** a configured deadline passes with the gate still pending
- **THEN** the claiming waiter re-runs the conservative ladder and either settles the gate through the seam or re-arms once

#### Scenario: External settle ends the wait

- **WHEN** the gate is settled by another producer before expiry
- **THEN** the waiter observes the settlement and exits without acting

### Requirement: Pre-settle steer override

Immediately before any auto-settle takes effect, a queued `abort` or `veto`
steer directive SHALL take precedence over the pending auto-decision — the
queued human word beats the policy.

#### Scenario: Queued veto beats a pending auto-approve

- **WHEN** a queued `veto` directive exists and the ladder is about to auto-approve
- **THEN** the veto takes effect instead of the auto-decision
