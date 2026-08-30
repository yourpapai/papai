## Purpose

Estimator oversize-verdict semantics for the sdd-runner intake stage: what signals ground the verdict that routes a task to the parent/child plan branch, how the operator overrides routing, and how every routing decision is recorded in the run's event log. The plan-branch machinery itself (planner, plan gate, child runs) is owned by the `sdd-runner-decomposition` change; this capability covers only the routing verdict that reaches it.

## ADDED Requirements

### Requirement: Signal-grounded oversize verdict

The intake estimator SHALL ground its `oversize` verdict in its own observed structural signals — task novelty (`new-subsystem`), cross-module impact, and implicated-file count — not in the task text self-declaring its size. The verdict SHALL be `true` only when the conjunction holds: novelty is `new-subsystem` AND cross-module is true AND the implicated-file count meets a compiled threshold. The estimator sidecar SHALL record the signal values it weighed in an `oversize_signals` record so every routing decision is auditable after the fact.

#### Scenario: Structural conjunction routes to the planner

- **WHEN** the estimator observes `new-subsystem`, cross-module impact, and an implicated-file count at or above the threshold
- **THEN** the depth sidecar SHALL carry `oversize: true` with its `oversize_signals` record, and intake SHALL route the run to the plan branch without scaffolding a change folder

#### Scenario: Any missing signal keeps the single path

- **WHEN** the estimator observes `new-subsystem` and cross-module impact but the implicated-file count is below the threshold
- **THEN** the depth sidecar SHALL carry `oversize: false` and intake SHALL take the single-change path

### Requirement: Operator routing override

A start invocation SHALL accept an explicit plan override that forces the plan branch regardless of the estimator's verdict, and an explicit depth override SHALL continue to skip planning entirely. An operator-forced route SHALL be recorded as such in the depth event.

#### Scenario: Forced plan branch

- **WHEN** a run starts with the plan override and the estimator verdicts `oversize: false`
- **THEN** the run SHALL enter the plan branch and the depth event SHALL record the operator override alongside the estimator's signals

#### Scenario: Depth override still skips planning

- **WHEN** a run starts with an explicit depth and no plan override
- **THEN** intake SHALL take the single-change path with the given depth, skipping the planner entirely, exactly as today

### Requirement: Routing decisions are evented

The `depth` L2 event SHALL carry the estimator's oversize verdict, the `oversize_signals` values, and whether the route was estimator-decided or operator-forced, so plan-branch routing rates are measurable from `events.ndjson` alone across any set of runs.

#### Scenario: Replay reconstructs routing decisions

- **WHEN** a run's `events.ndjson` is replayed without sidecars
- **THEN** the oversize verdict, its signal values, and the override status SHALL be reconstructible from the depth event
