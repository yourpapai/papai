# afk-runner-cli Specification

## Purpose

Defines afk-runner's operator surface — the verb table, gate-file and steer-file interactions, and event-sourced stop/status verbs — so runs are driven from a terminal without a daemon.

## Requirements

### Requirement: Verb table and routing

afk-runner SHALL expose the verbs `start <taskFile> [--depth S|M|L]
[--execute]`, `status <runId>`, `resume <runId>`, `stop <runId>`, `report
<runId> [--pr]`, `runs`, `analyze [workdirs…] [--json]`, `serve
[--host <addr>] [--port <port>] [--token <token>]`, and a bare
run-directory argument that prints the fold summary. A missing or invalid
argument SHALL fail with a usage line naming the verb inventory. `analyze`
SHALL route by workdir paths, never by run id. `serve` SHALL start the
read-only web board over the resolved work dir and SHALL NOT drive, attend,
or settle any run.

#### Scenario: Missing argument names the inventory

- **WHEN** `start` is invoked without a task file
- **THEN** the command fails with a usage line naming the expected arguments and flags

#### Scenario: Bare run directory prints the fold summary

- **WHEN** the CLI is invoked with a run directory path and no verb
- **THEN** the folded summary of that run is printed

#### Scenario: Analyze routes by workdir, not run id

- **WHEN** the CLI is invoked with `analyze` followed by one or more directory paths
- **THEN** the analysis runs over those workdirs' run corpora and prints the corpus report, and existing run-id and task-file routing is unchanged

#### Scenario: Execute flag arms the run

- **WHEN** `start` is invoked with `--execute`
- **THEN** the flag parses, the run's log opens with the armed event, and the front-door command doc names the flag in its documented form

#### Scenario: Serve starts the board without attending runs

- **WHEN** `serve` is invoked over a work dir holding a gate-pending run
- **THEN** the server starts and serves the portfolio, and no gate is presented, settled, or re-driven — the run's artifacts are untouched

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

`status`, `report`, `runs`, `analyze`, and `serve` SHALL be read-only over run
artifacts: they SHALL NOT append events, mutate run state, or write files.
`report` SHALL print the passive run summary; `runs` SHALL print the
cross-run roster and a totals footer that reports cost as a lower bound and
names the count of runs whose spend could not be priced; `analyze` SHALL
print the corpus report over one or more workdirs; `serve` SHALL render the
web board over the work dir without writing to it.

#### Scenario: Report leaves the event log unchanged

- **WHEN** `report <runId>` prints a completed run's summary
- **THEN** the run's event log, memo, and gate files are byte-unchanged

#### Scenario: Runs footer bounds cost honestly

- **WHEN** the workdir contains runs whose spend is unknown
- **THEN** the `runs` footer reports cost as a lower bound together with the unpriced-run count

#### Scenario: Analyze leaves the corpus byte-unchanged

- **WHEN** `analyze` completes over a corpus of run dirs including a gate-pending one
- **THEN** every run's artifacts are byte-unchanged

#### Scenario: Serving leaves the corpus byte-unchanged

- **WHEN** `serve` has served a work dir through live run activity
- **THEN** no run's event log, memo, or gate file differs from its pre-serve state

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

### Requirement: Launch configuration resolution

Every verb SHALL resolve its run configuration through one ladder before any run work starts: a config file at the work dir when present, else the `AFK_RUNNER_MODEL` environment entry for the model with compiled defaults for the rest. A present config file SHALL be authoritative for the whole five-key configuration — its `model`, `budget`, and `deadline` govern the run even when the environment entry names something else — and an absent file SHALL keep the environment-plus-defaults behavior unchanged. All verbs — `start`, `resume`, `status`, `stop`, `report`, `runs`, `analyze`, `serve` — SHALL resolve through the same ladder, so a run's configuration is one resolution, not a per-verb shape.

#### Scenario: Config file at the work dir governs the launch

- **WHEN** the work dir holds a config file whose `model` and `budget` differ from the `AFK_RUNNER_MODEL` entry and the compiled defaults
- **THEN** the run launches with the file's model and budget, and the environment entry is not consulted for them

#### Scenario: Absent config file keeps environment-plus-defaults behavior

- **WHEN** no config file sits at the work dir and `AFK_RUNNER_MODEL` names a model
- **THEN** the run launches with that model, the compiled default budget, and no deadline armed — the behavior before the file surface existed

#### Scenario: No file and no environment entry falls to the compiled defaults

- **WHEN** the work dir holds no config file and `AFK_RUNNER_MODEL` is unset
- **THEN** the run launches with the compiled default model and budget

#### Scenario: An invalid config file fails the launch loudly

- **WHEN** the config file at the work dir carries a key outside the five-key contract or a value of the wrong shape
- **THEN** the verb fails before any run work starts, naming the offending key or the invalid value, never silently falling back to environment or defaults

#### Scenario: Serve resolves its work dir through the same ladder

- **WHEN** `serve` starts with a config file present at the work dir declaring a `workDir`
- **THEN** the board serves that file-declared work dir, resolved through the same ladder every other verb uses

### Requirement: Standing default work dir is ignore-covered

There SHALL be exactly one standing default work dir — `.afk-runner` under the repo root: the config schema's defaulted `workDir` and the CLI's no-file fallback SHALL resolve to the same path, and the repository's ignore file SHALL cover that path. A run launched with no configuration SHALL place all of its bookkeeping — run directories, memos, event logs — under that ignored default, so the runner's own bookkeeping never appears as untracked tree dirt and never trips the agent write guard.

#### Scenario: A default run leaves the tree clean of bookkeeping

- **WHEN** a run launches with no config file and writes its run directory, memo, and event log
- **THEN** all of that bookkeeping sits under the standing default work dir, which the ignore file covers, and none of it is reported as untracked tree dirt

#### Scenario: One default stands in both places

- **WHEN** a config file whose `repoRoot` equals the standing root omits `workDir`, and another launch from that same root has no config file at all
- **THEN** both resolve the work dir to the same standing default path

### Requirement: Command doc flags stay parseable

The front-door command doc (`.claude/commands/sdd-auto.md` and its `.opencode` twin) SHALL document only flag forms the `start` argument parsing accepts — over its whole body, the launch-configuration prose included. Every flag the doc names SHALL parse through the same argument parsing the `start` verb uses, so the doc cannot drift into unknown-flag errors, and a flag the parsing would silently ignore SHALL fail the pin. The doc SHALL document the launch-configuration surface — the config file at the work dir, the `AFK_RUNNER_MODEL` environment entry, the compiled defaults, and their precedence — and that prose SHALL introduce no flag form: configuration rides the file-over-environment-over-defaults ladder, with no `--budget`, `--deadline`, or `--model` flags.

#### Scenario: Documented flag inventory parses

- **WHEN** every flag the command doc names is run through the `start` argument parsing with its documented value form
- **THEN** each documented flag is accepted with no unknown-flag or invalid-value error

#### Scenario: Configuration prose stays total under the pin

- **WHEN** the doc gains its launch-configuration section
- **THEN** the pinned flag inventory stays exactly the flags the `start` parsing accepts — every flag form the grown doc names still parses with its documented value form, and none is silently ignored
