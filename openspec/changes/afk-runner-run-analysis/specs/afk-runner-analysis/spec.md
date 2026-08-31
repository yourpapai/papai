## Purpose

A read-only analysis surface over retained afk-runner run artifacts: it loads runs from one or more workdirs, re-folds their event logs, joins sidecars, gate files, the derived memo, openspec state, and git, and produces a structured corpus report — the repeatably computable evidence base for loop-memory, policy, and stranded-change questions that otherwise require ad-hoc forensics.

## ADDED Requirements

### Requirement: Corpus report from re-folded runs

Given one or more workdir corpora, the analysis surface SHALL produce a per-run and aggregate report computed from each run's event-log re-fold and sidecar joins, covering: per-round finding counts by class and verdict; duplicate-id and lens-overlap rates; cross-round concern-cluster persistence; resolver action mix; gate forensics (presented-to-answered latency, never-answered gates with their age, extend origins attributed to human, presentation-time policy, or deadline waiter, and auto-decision counts by rule); retry taxonomy (stall vs validation) per role plus declared stage failures by kind; and usage per role and per round. Runs whose events, sidecars, or memo predate a metric's vocabulary — older event grammars, missing sidecars, absent fields — SHALL parse to reduced coverage with explicit unknowns rather than failing.

#### Scenario: Corpus duplicate-id rate over mixed runs

- **WHEN** the analysis loads one workdir containing a run without skeptic-round sidecars and a run with them
- **THEN** the report SHALL state the duplicate-id resolution rate for the latter and mark the metric unknown for the former, without error

#### Scenario: Gate latency distribution

- **WHEN** the report covers a run whose final gate was never answered
- **THEN** that gate SHALL appear as never-answered with its age, not be dropped from the latency aggregate

#### Scenario: Extend origin names its producer

- **WHEN** a run's gate was extended by the deadline waiter rather than by the presentation-time ladder or a human edit
- **THEN** the gate forensics SHALL attribute that extend to the waiter, distinguishable from policy and human origins in the same report

### Requirement: R2 blocking-cause attribution

For every cap-hit gate state the analysis SHALL attribute one blocking cause, computed from the event-log re-fold joined with the run's cost-knownness and the metered-ness persisted in the run's memo: `r2-fired` when an extend auto-decision names R2; `cost-unknown` when the state carries an R4 decision on a cost-unknown metered run; `over-ceiling` when the state carries an R4 decision on a cost-known run, or on any run where the cost-unknown branch was unreachable; `preview` when the state's auto-decision record is a preview (a legacy-grammar record — the runner has no preview mode); `trajectory-blocked` when the R2 trajectory predicate itself fails. Eligibility SHALL read the convergence record's open count set where present and the raised set otherwise (the event grammar's own fallback); the trajectory strict-decrease SHALL read the raised set; a `needs-review` verdict SHALL never enumerate a cap-hit gate state (its verification round precedes any presentation). The per-run report and the corpus aggregate SHALL surface the cause mix alongside the existing eligibility ratio, and JSON output SHALL carry the per-cause counts. Runs whose records cannot support attribution — including runs whose memo predates the metered field — SHALL report the metric at reduced coverage with an explicit unknown, never an error.

#### Scenario: Cost-unknown metered run attributes its eligible states

- **WHEN** the analysis covers a metered run whose usage is cost-unknown and a cap-hit state was presented with an R4 decision despite trajectory eligibility
- **THEN** that state SHALL be counted under `cost-unknown`, and the run's r2 eligibility line SHALL name that cause with its count

#### Scenario: Unmetered run attributes over-ceiling

- **WHEN** a cap-hit state on an unmetered run carries an R4 decision
- **THEN** that state SHALL be counted under `over-ceiling`, because the cost-unknown branch cannot fire on an unmetered run

#### Scenario: Corpus aggregate names the dominant cause

- **WHEN** the corpus report aggregates runs whose cap-hit states carry mixed causes
- **THEN** the aggregate SHALL report the per-cause counts across all cap-hit states, so the dominant blocking cause is readable without per-run forensics

#### Scenario: Legacy run without attribution support degrades

- **WHEN** an inherited log's events carry no auto-decision records for a cap-hit state
- **THEN** that state SHALL be attributed from whatever gate presentation exists, and a run with no supporting records at all SHALL report the breakdown as unknown with its reason

### Requirement: Ground-truth join to openspec and git

For each analyzed run's change folder the analysis SHALL report tasks done/total, whether the change folder exists, its commit count on the current branch, and whether it is present on the configured main ref — surfacing stranded-complete (planning done, unmerged) and merged-unimplemented (merged, zero tasks done) changes explicitly as report sections.

#### Scenario: Stranded-complete change surfaces

- **WHEN** a completed run's change folder shows all tasks done but is absent from the main ref
- **THEN** the ground-truth section SHALL list that change under stranded-complete

#### Scenario: Merged-unimplemented change surfaces

- **WHEN** a run's change folder is present on the main ref with zero completed tasks
- **THEN** the ground-truth section SHALL list that change under merged-unimplemented

### Requirement: Decision-record consistency audit

The analysis SHALL audit each run's decision records for mutual consistency: the persisted memo SHALL match a memo recomputed from the event log, with a stale or divergent memo flagged alongside its diverging fields; every answered gate event SHALL have a presented event of the same version; a terminal `completed` status SHALL NOT coexist with an unsuperseded abort gate answer; backup residue (`.bak`) and gate files recording a decision with no matching answered event SHALL be flagged. Runs exhibiting inherited development-era contamination signatures (answered-without-presented sequences, completion after abort) SHALL carry an era-contamination flag so downstream aggregate metrics can exclude or annotate them.

#### Scenario: Stale memo is flagged

- **WHEN** a run's persisted memo disagrees with the memo recomputed from its event log
- **THEN** the consistency audit SHALL flag the run and name the diverging fields, without failing the analysis

#### Scenario: Answered without presented is flagged

- **WHEN** a run's event log contains an answered gate event for a version with no presented event of that version
- **THEN** the consistency audit SHALL flag that version and mark the run era-contaminated

#### Scenario: Consistent runs raise no flags

- **WHEN** a run's event log, gate files, and memo agree
- **THEN** the consistency audit SHALL report no flags and the run SHALL be excluded from era-contaminated aggregates

### Requirement: Read-only contract

The analysis surface SHALL NOT write, rename, or delete any file in any run directory, workdir, or the repository; its only output SHALL be its stdout/stderr report. Its filesystem and git access SHALL be injected as read-capable-only seams so tests can pin the no-write contract.

#### Scenario: No writes across a full analysis run

- **WHEN** the analysis completes over a corpus of run dirs
- **THEN** no run dir, workdir, or repo file SHALL have been modified, and a test pinning the write-free fs seam SHALL pass

### Requirement: Analysis invocation on the CLI surface

The runner's CLI SHALL route an `analyze [workdirs…] [--json]` invocation to the analysis surface, printing the human-readable corpus report, with `--json` emitting the same structure machine-readably. Absent workdir arguments, the analysis SHALL run over the configured workdir's corpus. The invocation SHALL NOT participate in run-id routing and SHALL NOT attend, present, or settle any gate.

#### Scenario: Analyze over the current workdir

- **WHEN** the CLI is invoked with `analyze` and no workdir arguments
- **THEN** the analysis SHALL run over the configured workdir's run corpus and print the report to stdout

#### Scenario: Analyze does not disturb pending gates

- **WHEN** the analyzed corpus contains a gate-pending run
- **THEN** the invocation SHALL complete without presenting, settling, or routing that gate anywhere
