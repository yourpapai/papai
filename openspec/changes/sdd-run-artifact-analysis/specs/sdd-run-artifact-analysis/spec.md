## Purpose

A read-only analysis surface over retained sdd-runner run artifacts: it loads runs from one or more workdirs, replays their event logs, joins sidecars, transcripts, gate files, openspec state, and git, and produces a structured corpus report — the repeatably computable evidence base for loop-memory, policy, routing, and stranded-change questions that today require ad-hoc forensics.

## ADDED Requirements

### Requirement: Corpus report from replayed runs

Given one or more sdd-runner workdirs, the analysis surface SHALL produce a per-run and aggregate report computed from each run's event log replay and sidecar joins, covering: per-round finding counts by class and verdict; duplicate-id and lens-overlap rates; cross-round concern-cluster persistence; resolver action mix; gate forensics (presented-to-answered latency, veto cycles, extends, auto-decision rule fired); retry taxonomy (stall vs validation) per role; and per-role/per-round usage via the existing reprice seam. Pre-change run dirs (older event vocabularies, missing sidecars) SHALL parse to reduced coverage with explicit unknowns rather than failing.

#### Scenario: Corpus duplicate-id rate over mixed runs

- **WHEN** the analysis loads one workdir containing a pre-skeptic-era run and a run with skeptic rounds
- **THEN** the report SHALL state the duplicate-id resolution rate for the latter and mark the metric unknown for the former, without error

#### Scenario: Gate latency distribution

- **WHEN** the report covers a run whose final gate was never answered
- **THEN** that gate SHALL appear as never-answered with its age, not be dropped from the latency aggregate

### Requirement: Ground-truth join to openspec and git

For each analyzed run's change folder the analysis SHALL report tasks done/total, whether the change folder exists, its commit count on the current branch, and whether it is present on the configured main branch — surfacing stranded-complete (planning done, unmerged) and merged-unimplemented (merged, zero tasks done) changes explicitly as report sections.

#### Scenario: Stranded-complete change surfaces

- **WHEN** a completed run's change folder shows all tasks done but is absent from the main branch
- **THEN** the ground-truth section SHALL list that change under stranded-complete

#### Scenario: Merged-unimplemented change surfaces

- **WHEN** a run's change folder is present on the main branch with zero completed tasks
- **THEN** the ground-truth section SHALL list that change under merged-unimplemented

### Requirement: Decision-record consistency audit

The analysis SHALL audit each run's three decision writers — the event log, the gate files, and the persisted run state — for mutual consistency: every answered gate event SHALL have a presented ancestor of the same version; a terminal `completed` status SHALL NOT coexist with an unsuperseded ABORT gate answer; state backup residue (`.bak`) and gate files with no matching answered event SHALL be flagged. Runs exhibiting development-era contamination signatures (answered-without-presented sequences, completion after abort) SHALL carry an era-contamination flag so downstream aggregate metrics can exclude or annotate them.

#### Scenario: Answered without presented is flagged

- **WHEN** a run's event log contains an answered gate event for a version with no presented event of that version
- **THEN** the consistency audit SHALL flag that version and mark the run era-contaminated

#### Scenario: Completion after unsuperseded abort is flagged

- **WHEN** a run's persisted status is `completed` while a gate file records an ABORT answer that no later presented-and-answered gate chain supersedes
- **THEN** the consistency audit SHALL flag the run for manual review

#### Scenario: Consistent runs raise no flags

- **WHEN** a run's event log, gate files, and state agree
- **THEN** the consistency audit SHALL report no flags and the run SHALL be excluded from era-contaminated aggregates

### Requirement: Read-only contract

The analysis surface SHALL NOT write, rename, or delete any file in any run directory, workdir, or the repository; its only output SHALL be its stdout/stderr report. Its filesystem and git access SHALL be injected as read-capable-only seams so tests can pin the no-write contract.

#### Scenario: No writes across a full analysis run

- **WHEN** the analysis completes over a corpus of run dirs
- **THEN** no run dir, workdir, or repo file SHALL have been modified, and a test pinning the write-free fs seam SHALL pass

### Requirement: Analysis invocation on the CLI surface

The runner's start script SHALL route an `analyze [workdirs…]` invocation to the analysis surface, printing the human-readable report, with a machine-readable JSON output mode. The invocation SHALL NOT participate in run-id routing or gate-pending discovery.

#### Scenario: Analyze over the current workdir

- **WHEN** the runner start script is invoked with `analyze` and no workdir arguments
- **THEN** the analysis SHALL run over the current workdir's run corpus and print the report to stdout

#### Scenario: Analyze does not disturb pending gates

- **WHEN** the analyzed corpus contains a gate-pending run
- **THEN** the invocation SHALL complete without presenting, settling, or routing that gate anywhere
