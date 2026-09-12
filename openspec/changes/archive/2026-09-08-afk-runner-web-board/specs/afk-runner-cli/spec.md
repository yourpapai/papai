# afk-runner-cli — Delta Spec

## MODIFIED Requirements

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
