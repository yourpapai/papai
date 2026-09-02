## MODIFIED Requirements

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
