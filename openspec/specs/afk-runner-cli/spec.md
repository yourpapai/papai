# afk-runner-cli Specification

## Purpose

Defines afk-runner's operator surface — the verb table, gate-file and steer-file interactions, and event-sourced stop/status verbs — so runs are driven from a terminal without a daemon.

## Requirements

### Requirement: Verb table and routing

afk-runner SHALL expose the verbs `start <taskFile> [--depth S|M|L]`,
`status <runId>`, `resume <runId>`, `stop <runId>`, `report <runId> [--pr]`,
`runs`, `analyze [workdirs…] [--json]`, and a bare run-directory argument
that prints the fold summary. A missing or invalid argument SHALL fail with a
usage line naming the verb inventory. `analyze` SHALL route by workdir
paths, never by run id.

#### Scenario: Missing argument names the inventory

- **WHEN** `start` is invoked without a task file
- **THEN** the command fails with a usage line naming the expected arguments and flags

#### Scenario: Bare run directory prints the fold summary

- **WHEN** the CLI is invoked with a run directory path and no verb
- **THEN** the folded summary of that run is printed

#### Scenario: Analyze routes by workdir, not run id

- **WHEN** the CLI is invoked with `analyze` followed by one or more directory paths
- **THEN** the analysis runs over those workdirs' run corpora and prints the corpus report, and existing run-id and task-file routing is unchanged

### Requirement: Start parks and exits with a loud gate-pending signal

`start` SHALL drive the run to its next park and exit; it SHALL never attend a
gate in the foreground. When the park is gate-pending, the output SHALL name
the pending gate file's path and the exact resume command carrying the run id.

#### Scenario: Gate-pending start prints the pointer

- **WHEN** a started run parks at a gate
- **THEN** the output includes the gate file path and a copy-pasteable `resume <runId>` line

#### Scenario: Machine-invoked start never blocks

- **WHEN** `start` runs without a terminal attached
- **THEN** it exits at the park instead of waiting on the gate

### Requirement: Hand-edited gate file

The gate file SHALL be the operator's decision surface: hand edits —
checkboxes and the own-line directives `APPROVE`, `VETO[: <redirect>]`,
`ABORT`, and `→ RUN 1 MORE` — SHALL settle through the same validated seam as
every other settle producer. The response grammar SHALL be total over gate
shapes; a zero-signal response SHALL be rejected with directive guidance, and
a rendered gate SHALL parse back as the same decision before any file is
overwritten.

#### Scenario: Hand edit settles as any producer would

- **WHEN** an operator hand-edits the gate file and the attending waiter observes it
- **THEN** the edit settles through the validated seam with artifact-integrity checks, identically to any other producer

#### Scenario: Zero-signal response is rejected

- **WHEN** a gate response carries no directive, box, answer, or override
- **THEN** the settle is rejected with guidance naming the available directives

### Requirement: Steer file

`runs/<id>/steer.md` SHALL accept the directives `extend`, `veto
<id>=<redirect>` (item veto), bare `veto` / `veto <text>` (gate-level veto),
and `abort`, consumed at round boundaries and by the foreground gate waiter.
An unparseable line SHALL be consumed with a warning, never left unexamined,
and `extend` at a final gate SHALL be rejected.

#### Scenario: Item veto with redirect

- **WHEN** `veto A1=use the encrypted config path` is written to `steer.md` while the run is in flight
- **THEN** the directive takes effect at the next consumption point with that redirect

#### Scenario: Unparseable line is consumed with a warning

- **WHEN** the first line of `steer.md` matches no directive grammar
- **THEN** it is consumed, a warning names it, and later valid directives still apply

### Requirement: Event-sourced stop verb

`stop <runId>` SHALL: request a calm stop for a live run, honored at the next
boundary; point a gate-pending run at `steer abort` as its answer path; append
`run_abort` for a dead run, write the terminal memo, and release the session
id; and report that there is nothing to stop for an already-final run.

#### Scenario: Live run gets the calm-stop marker

- **WHEN** `stop` is invoked while a process is driving the run
- **THEN** a calm-stop marker is recorded and honored at the next boundary

#### Scenario: Dead run aborts event-sourced

- **WHEN** `stop` is invoked for a run whose process is gone
- **THEN** a `run_abort` event is appended, the terminal memo records the abort, and the session id is released

#### Scenario: Gate-pending stop points at steer

- **WHEN** `stop` is invoked for a run parked at a gate
- **THEN** the output names the steer file and its `abort` directive as the way to end the run

### Requirement: Passive verbs never write run state

`status`, `report`, `runs`, and `analyze` SHALL be read-only over run
artifacts: they SHALL NOT append events, mutate run state, or write files.
`report` SHALL print the passive run summary; `runs` SHALL print the
cross-run roster and a totals footer that reports cost as a lower bound and
names the count of runs whose spend could not be priced; `analyze` SHALL
print the corpus report over one or more workdirs.

#### Scenario: Report leaves the event log unchanged

- **WHEN** `report <runId>` prints a completed run's summary
- **THEN** the run's event log, memo, and gate files are byte-unchanged

#### Scenario: Runs footer bounds cost honestly

- **WHEN** the workdir contains runs whose spend is unknown
- **THEN** the `runs` footer reports cost as a lower bound together with the unpriced-run count

#### Scenario: Analyze leaves the corpus byte-unchanged

- **WHEN** `analyze` completes over a corpus of run dirs including a gate-pending one
- **THEN** every run dir, the workdir, and the repository are byte-unchanged, and the pending gate is neither presented, settled, nor routed anywhere

### Requirement: Depth override warns what it discards

A `start` invoked with `--depth` SHALL emit a warn line on the operator output
naming that scope estimation was skipped — no independent depth reading is
computed — and naming what the forced profile decides for that run: the review
round cap for the forced profile, and, when the forced profile is S, that the
atomicity stage is skipped with decomposition presenting the final gate.

#### Scenario: S override names the cap and the tail

- **WHEN** `start` runs with `--depth S`
- **THEN** an intake warn line names the skipped scope estimation, the S review round cap, and that S skips atomicity with decomposition presenting the final gate

#### Scenario: M override names the cap without a tail claim

- **WHEN** `start` runs with `--depth M`
- **THEN** the warn line names the skipped scope estimation and the M review round cap, and makes no atomicity claim

### Requirement: Divergent depth readings are surfaced

When the estimator's profile and the keyword prescreen's profile disagree by two
levels, intake SHALL emit a warn line naming both readings and stating that the
higher one is taken. The depth event SHALL continue recording the disagreement
flag for replay and analysis.

#### Scenario: Two-level split warns with both readings

- **WHEN** the estimator classifies a task L and the keyword prescreen reads S
- **THEN** a warn line names both readings and the higher one taken, and the recorded depth event still carries the disagreement flag

### Requirement: Command doc flags stay parseable

The front-door command doc (`.claude/commands/sdd-auto.md`) SHALL document only
flag forms the `start` argument parsing accepts. Every flag the doc names SHALL
parse through the same argument parsing the `start` verb uses, so the doc cannot
drift into unknown-flag errors.

#### Scenario: Documented flag inventory parses

- **WHEN** every flag the command doc names is run through the `start` argument parsing with its documented value form
- **THEN** each documented flag is accepted with no unknown-flag or invalid-value error
