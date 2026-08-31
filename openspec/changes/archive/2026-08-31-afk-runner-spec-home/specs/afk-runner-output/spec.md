# afk-runner-output Specification

## ADDED Requirements

### Requirement: Deterministic report content

`report <runId>` SHALL render, in stable field order, the run's facts, the
gains block, and the commit list, as plain text. The same run state SHALL
always render the same bytes, and `--pr` SHALL render the PR-body variant of
the same content.

#### Scenario: Same run, same bytes

- **WHEN** `report <runId>` is invoked twice over an unchanged run
- **THEN** both invocations print identical bytes

#### Scenario: PR variant

- **WHEN** `report <runId> --pr` is invoked
- **THEN** the PR-body variant of the same facts, gains, and commits is printed

### Requirement: Report gains block

The gains block SHALL be sourced from `auto_decision` events: interventions
avoided (decisions paired with a subsequent settle — a decision that never
settled does not count), the human gate count, an estimated wall-time figure
derived from gate dwell, and per-rule counts. Undecided evaluations (rule
none) SHALL NOT count as interventions avoided.

#### Scenario: Gains reflect settled decisions only

- **WHEN** a run's event log contains `auto_decision` events for rules R1 and R2, each followed by a settle
- **THEN** the gains block reports the interventions avoided per rule id, the human gate count, and the wall-time estimate

#### Scenario: Rule-none evaluations are excluded

- **WHEN** the log contains `auto_decision` events with rule none
- **THEN** they are not counted as interventions avoided

### Requirement: Honest memo on every park

Every park SHALL write the derived run memo reflecting the folded log:
terminal runs record `completed` or `aborted`, and a run that aborted at an
escalation gate SHALL record `failed`. A memo that does not match the fold
SHALL be discarded and re-derived rather than trusted.

#### Scenario: Abort-at-escalation records failed

- **WHEN** a run aborts at an escalation gate
- **THEN** its memo records the `failed` status

#### Scenario: Stale memo re-derives

- **WHEN** a run boots and finds a memo that disagrees with the folded log
- **THEN** the memo is discarded and re-derived from the log

### Requirement: Bare run-dir fold summary

Passing a run directory to the CLI SHALL print the fold summary — run identity
and folded state in fixed field order — deterministically from the event log
alone.

#### Scenario: Fold summary from the log alone

- **WHEN** the CLI is invoked with a run directory containing only the event log and sidecars
- **THEN** it prints the run's folded summary without writing anything
