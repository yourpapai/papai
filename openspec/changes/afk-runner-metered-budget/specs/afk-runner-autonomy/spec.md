# afk-runner-autonomy Delta

## MODIFIED Requirements

### Requirement: R4 budget guard

The run config's budget SHALL accept a number or null, alongside an optional
explicit metered flag that defaults to whether the budget is a number. All
auto-decisions in a run with a numeric budget SHALL be bounded by it: any
projected or actual exceedance SHALL cause the gate to wait for a human
regardless of any other rule's predicate, and no configuration SHALL bypass
an explicitly configured numeric ceiling. When a metered run's cumulative
cost is unknown, the guard SHALL fail closed: no auto-decision SHALL settle
the gate. An unmetered run — budget null, or metered explicitly false —
SHALL disable only the cost-unknown branch: its auto-decisions are bounded
by the round cap and the R2 trajectory bound alone.

#### Scenario: Budget exceedance gates despite other rules

- **WHEN** a rule's predicate matches but the run's projected spend crosses the configured numeric budget
- **THEN** the gate waits for a human and is not auto-decided

#### Scenario: Unknown cost fails closed

- **WHEN** a metered run's rule predicate matches but the run's cumulative cost cannot be determined
- **THEN** the gate waits for a human and is not auto-decided

#### Scenario: Unmetered run is bounded by round cap and trajectory alone

- **WHEN** an unmetered run's cumulative cost is unknown and another rule's predicate matches
- **THEN** R4's cost-unknown branch does not fire and the matching rule decides the gate

#### Scenario: Explicit numeric budget is never bypassed

- **WHEN** a run declares a numeric budget with metered explicitly false and its projected spend crosses the budget
- **THEN** the gate waits for a human and is not auto-decided

### Requirement: R5 escalation rung

At an escalation gate — presented when a stage exhausts its per-stage failure
budget — rule R5 SHALL settle only when spend is over the ceiling or unknown,
and extend SHALL be suppressed from the rendered gate; otherwise the ladder
records rule none and the gate waits for a human. The unknown-cost test SHALL
NOT be disabled by an unmetered configuration.

#### Scenario: Over-ceiling escalation auto-settles without extend

- **WHEN** an escalation gate is presented and the run's spend is over the ceiling or unknown
- **THEN** R5 settles the gate and the extend directive was never offered

#### Scenario: Under-ceiling escalation waits

- **WHEN** an escalation gate is presented and spend is within the ceiling
- **THEN** the ladder records rule none and the gate waits for a human

#### Scenario: Unmetered escalation keeps extend suppressed on unknown cost

- **WHEN** an unmetered run presents an escalation gate and its cumulative cost is unknown
- **THEN** R5 settles the gate with extend suppressed and the human decides

### Requirement: auto_decision event

One `auto_decision` event SHALL be appended for every ladder evaluation —
including undecided evaluations and deadline-waiter settles — carrying the
rule, decision, evidence digest, and gate version. A deadline waiter that
claims a gate SHALL append exactly one event for every claimed outcome: a
settle names the deciding rule with decision approve or extend; a re-arm and
a stay-pending record rule none with decision pending. A waiter that loses
the claim SHALL append nothing, and a human settle SHALL append no
`auto_decision` beyond the evaluations already recorded, so replaying the
event log alone rebuilds every evaluation, its outcome, and who settled the
gate.

#### Scenario: Replay rebuilds evaluations from the log alone

- **WHEN** a run's event log is replayed without any other run artifacts
- **THEN** every ladder evaluation is reconstructible from the `auto_decision` events

#### Scenario: Waiter settle names its rule

- **WHEN** a claiming waiter's expiry ladder settles the gate
- **THEN** an `auto_decision` event carrying the deciding rule and decision approve or extend is appended with the settle

#### Scenario: Waiter re-arm and stay-pending record pending

- **WHEN** a claiming waiter's expiry ladder finds no conservative branch and the deadline re-arms or stays pending
- **THEN** an `auto_decision` event records rule none with decision pending

#### Scenario: Lost claim and human settles stay silent

- **WHEN** the waiter loses the settle claim, or a human settles the gate without any waiter evaluation
- **THEN** no additional `auto_decision` event is appended for that outcome
