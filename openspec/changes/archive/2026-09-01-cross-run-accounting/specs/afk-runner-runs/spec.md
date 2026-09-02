<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## Purpose

Gives operators a passive cross-run view over the afk work dir: which runs exist and in what state, what each spent in tokens and wall time, and honest portfolio totals — without touching any run's state.

## ADDED Requirements

### Requirement: Cross-run roster command

The `runs` command SHALL list every run recorded in the work dir, newest-first, one row per run, each row showing the run's identity (the session id, or the change name when the id is a legacy datetime form), its status, its total token usage, and its wall duration. The command SHALL print an empty summary (no rows, zeroed totals) when the work dir holds no runs.

#### Scenario: Mixed roster

- **WHEN** the work dir holds runs in `completed`, `aborted`, and gate-pending states
- **THEN** the roster lists one row per run ordered newest-first, each row carrying identity, status, tokens, and wall

#### Scenario: Empty work dir

- **WHEN** the work dir exists but holds no runs (or the runs directory does not exist)
- **THEN** the command prints an empty summary and exits without error

### Requirement: Tokens-first spend with honest cost bounds

Per-run token usage SHALL be the primary spend column. Aggregate cost SHALL render as a lower bound (`≥ $X`) accompanied by the count of unpriced runs whenever any run recorded tokens but zero cost; cost SHALL render as an exact total only when every run is priced.

#### Scenario: Unpriced corpus

- **WHEN** every run recorded tokens with zero cost (an unmetered model)
- **THEN** the footer renders the cost as a lower bound of $0.00 with the unpriced-run count equal to the number of runs

#### Scenario: Priced and unpriced mix

- **WHEN** some runs carry nonzero cost and others carry tokens with zero cost
- **THEN** the footer sums the known costs as a lower bound and reports the unpriced count

### Requirement: Actionable status rendering

Each row's status SHALL render the run's terminal or live status (`completed`, `aborted`, `failed`, `stopped`, `running`), except a run parked at an unanswered gate, which SHALL render as `gate:<mode> v<version>` naming the gate mode and version.

#### Scenario: Gate-pending row

- **WHEN** a run is parked awaiting settlement of an escalation gate at version 2
- **THEN** its row renders the status as `gate:escalation v2`

#### Scenario: Terminal row

- **WHEN** a run has completed
- **THEN** its row renders the status as `completed`

### Requirement: Log-derived duration

Wall duration SHALL be measured from a run's first to last recorded event timestamp, so a live run shows duration-so-far rather than a stale park-time figure. The totals footer SHALL additionally report the summed human-gate dwell (presented→answered distance) across runs.

#### Scenario: Live run freshness

- **WHEN** a running run has appended events after its last park
- **THEN** its row's wall duration reflects the newest event timestamp, not the last-parked memo timestamp

#### Scenario: Dwell in totals

- **WHEN** runs include human-settled gates with measurable presented→answered distance
- **THEN** the footer reports the summed dwell separately from summed wall

### Requirement: Degradation tolerance

A run whose persisted state is unreadable SHALL be omitted from the roster. A run whose event log is missing or unreadable SHALL keep its roster row with unknown tokens and wall (rendered as `—`). The listing SHALL never fail because of a single run's unreadable data.

#### Scenario: Memo without a log

- **WHEN** a run directory holds a readable state file but no event log
- **THEN** the run keeps its roster row with tokens and wall rendered as unknown

#### Scenario: Torn log tail

- **WHEN** a run's event log ends with a torn final line from a crash mid-write
- **THEN** the run's numbers derive from the readable prefix and the roster still prints

### Requirement: Passive surface

Printing the roster and totals SHALL NOT write, rename, or update any file under the work dir, and SHALL NOT append events to any run.

#### Scenario: Read-only over a live work dir

- **WHEN** the command runs against a work dir containing live and parked runs
- **THEN** no file in the work dir changes content or modification time
