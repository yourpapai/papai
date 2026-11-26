## MODIFIED Requirements

### Requirement: R4 budget guard

All auto-decisions in a run SHALL be bounded by the config `budget` key (USD, default `5`). Any projected or actual exceedance of a numeric budget SHALL cause a human gate regardless of any other rule's predicate. The cost-unknown branch of the guard SHALL apply only to runs configured as metered: `budget: <number>` alone means metered, and a run configured `budget: null` (or with an explicit `metered: false`) SHALL NOT gate auto-decisions on unknown cost — its spend bounds SHALL be the round cap and the R2 trajectory predicate alone. An explicitly configured numeric budget SHALL never be bypassed by unknown cost: unknown cost with a numeric budget SHALL still fail closed.

#### Scenario: Budget exceedance gates despite other rules

- **WHEN** a rule's predicate matches but the run's projected spend crosses a numeric `budget`
- **THEN** the pipeline SHALL present a human gate and SHALL NOT auto-decide

#### Scenario: Unknown cost fails closed

- **WHEN** a rule's predicate matches on a metered run (numeric `budget` or `metered: true`) whose cumulative cost cannot be metered
- **THEN** the pipeline SHALL present a human gate and SHALL NOT auto-decide

#### Scenario: Unmetered run is not gated on unknown cost

- **WHEN** a run is configured `budget: null` (or `metered: false`), its cost is unknown, and R2's trajectory predicate otherwise holds at a cap-hit
- **THEN** R2 SHALL auto-extend exactly one round, bounded by the round cap, and R4 SHALL NOT veto on cost grounds

## ADDED Requirements

### Requirement: Waiter settles emit auto_decision events

When the deadline waiter claims a gate at expiry and settles, re-arms, or leaves it pending, the run's event log SHALL receive the standard `auto_decision` L2 event carrying `{ rule, decision, evidenceDigest, gateVersion }` with decision values covering the waiter's outcomes, so replaying `events.ndjson` alone distinguishes waiter-settled gates from human-settled ones.

#### Scenario: Waiter approval is visible in replay

- **WHEN** the deadline waiter claims an expired gate and its conservative ladder R1-approves
- **THEN** `events.ndjson` SHALL contain an `auto_decision` event for that gate version naming the rule, and replay SHALL reconstruct the approval as automatic

### Requirement: Expiry ladder parity with R4

The deadline waiter's conservative expiry ladder SHALL apply the same metered treatment as the prelude ladder: on an unmetered run (`budget: null` / `metered: false`) expiry MAY take the R2 extend branch when its trajectory predicate holds; on a metered run with unknown cost expiry SHALL stay pending. The two ladders SHALL NOT differ in what they may decide for the same gate state.

#### Scenario: Unmetered expiry may extend

- **WHEN** an unmetered run's early gate expires with 0 blockers, ≥1 open material, and a strictly decreasing trajectory
- **THEN** the waiter's ladder MAY settle the gate as an extend exactly as the prelude ladder's R2 would

#### Scenario: Metered unknown cost stays pending at expiry

- **WHEN** a metered run's gate expires with unknown cumulative cost
- **THEN** the waiter SHALL leave the gate pending and re-arm at most once, as today
