## ADDED Requirements

### Requirement: The verdict covers every planned target

The gate SHALL reconcile the set of targets the run planned to measure against the set of results
it actually received, and SHALL fail when any planned target is missing a result. A target whose
measurement was lost — because the executor measuring it crashed, timed out, was cancelled, or
produced no readable result — SHALL be treated as unmeasurable, never as absent from the run.

#### Scenario: A lost executor fails the gate

- **WHEN** a run plans to measure 24 targets across several executors and one executor carrying 3
  targets dies before reporting
- **THEN** the gate exits non-zero naming the 3 targets it never received a result for, rather than
  rendering a verdict over the 21 it did receive

#### Scenario: A silently empty result set is not a pass

- **WHEN** every executor completes but the combined results contain no per-file entries for
  targets the run planned to measure
- **THEN** the gate exits non-zero, and does not report success on the grounds that no regression
  was found

#### Scenario: A complete result set gates normally

- **WHEN** every planned target has a result, whether measured in this run or carried over
- **THEN** the gate applies its existing checks — unmeasurable outcomes, then threshold, then
  per-file ratchet — to the combined per-file set

### Requirement: Measurements persist independently of the verdict

Scores measured anywhere in a run SHALL be recorded before the verdict is rendered and SHALL
persist even when the run fails, when a different executor failed, or when the run is divided
across several executors. A failing verdict SHALL NOT cause a measurement to be discarded.

#### Scenario: A failing run keeps every executor's measurements

- **WHEN** a divided run measures targets across several executors and the gate then fails on a
  ratchet regression
- **THEN** the scores measured by every executor are recorded, and the next run does not re-measure
  them

#### Scenario: One executor fails and the others' work survives

- **WHEN** one executor fails while the others complete
- **THEN** the completed executors' scores are recorded, the failed executor's targets are recorded
  as neither measured nor reusable, and the next run re-measures only those

#### Scenario: Reporting spans the whole run

- **WHEN** a divided run completes
- **THEN** the measured-versus-reused report covers the whole target set for the run, not one
  executor's share of it
