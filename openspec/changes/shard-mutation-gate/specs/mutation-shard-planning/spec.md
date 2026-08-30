## Purpose

Defines how a mutation run divides its measurement work across parallel executors: how many
executors it asks for, how targets are distributed between them, and the guarantee that these
choices affect only how long the run takes and never what verdict it reaches.

## ADDED Requirements

### Requirement: Work-proportional executor count

The run SHALL choose its executor count from the estimated cost of the targets it must measure,
not from a fixed constant and not from the whole branch diff. The count SHALL be bounded above by
a configured maximum and by the number of targets to measure, and SHALL never exceed either.

#### Scenario: A large measurement set is divided

- **WHEN** a run must measure 38 targets whose estimated cost exceeds the per-executor budget
- **THEN** it requests multiple executors, each assigned a disjoint subset, and no executor is
  assigned more estimated work than the budget unless a single target already exceeds it

#### Scenario: Executor count never exceeds the target count

- **WHEN** a run must measure 2 targets and the configured maximum is 12
- **THEN** it requests at most 2 executors, and no executor is assigned an empty subset

#### Scenario: Reused targets do not inflate the division

- **WHEN** a run's branch diff holds 38 targets but 37 carry over from an earlier run
- **THEN** the division is computed from the 1 target to be measured, not from the 38 gated

### Requirement: Single executor below the division threshold

When estimated work falls below a configured threshold, the run SHALL measure in a single executor
rather than dividing. Dividing costs a fixed orchestration overhead, so a small run SHALL NOT pay
it for a saving smaller than the overhead itself.

#### Scenario: A small pull request is not divided

- **WHEN** a run must measure 3 targets whose combined estimated cost is under the threshold
- **THEN** it requests exactly one executor and spawns no matrix

#### Scenario: Nothing to measure

- **WHEN** every target in the branch diff carries over and the run measures nothing
- **THEN** it requests exactly one executor, which performs no measurement, and the gate still
  evaluates the whole branch diff

### Requirement: Cost-weighted target distribution

Targets SHALL be distributed between executors by estimated cost rather than by count, so that one
executor is not assigned several expensive targets while another is assigned only cheap ones. The
estimate SHALL be derived from data available before measurement begins.

#### Scenario: Expensive targets are spread

- **WHEN** a measurement set mixes targets whose estimated costs differ by more than an order of
  magnitude
- **THEN** the assignment balances estimated cost across executors rather than assigning an equal
  number of targets to each

#### Scenario: An estimate is unavailable for a target

- **WHEN** no cost estimate can be derived for a target
- **THEN** a documented default estimate is used and the target is still assigned and measured

### Requirement: Division choices never affect the verdict

The executor count, the target-to-executor assignment, and every cost estimate SHALL be treated as
scheduling inputs only. A wrong or missing estimate SHALL be able to make a run slower or spawn
more executors than needed, and SHALL NOT be able to change which files are gated, which scores are
recorded, or what verdict the run reaches.

#### Scenario: A badly wrong estimate costs time, not correctness

- **WHEN** every target's estimated cost is wrong by an order of magnitude in either direction
- **THEN** the run is slower or uses more executors than optimal, and reaches the same verdict it
  would have reached measuring everything in one executor

#### Scenario: The verdict is independent of the executor count

- **WHEN** the same commit is measured with one executor and with several
- **THEN** both runs gate the same file set and reach the same verdict

### Requirement: Shared preparation is computed once per run

Preparation that every executor needs and that does not depend on which targets an executor was
assigned SHALL be computed once for the run and made available to each executor, rather than
recomputed by each.

#### Scenario: Test-coverage attribution is not recomputed per executor

- **WHEN** a run divides its measurement set across several executors
- **THEN** the mapping from source files to their covering tests is computed once and consumed by
  every executor, and no executor rebuilds it

#### Scenario: Shared preparation is unavailable

- **WHEN** an executor cannot consume the run's shared preparation
- **THEN** it falls back to computing what it needs for its own targets, and its measurements
  remain valid
