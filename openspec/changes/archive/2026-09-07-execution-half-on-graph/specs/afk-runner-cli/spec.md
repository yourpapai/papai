## MODIFIED Requirements

### Requirement: Verb table and routing

afk-runner SHALL expose the verbs `start <taskFile> [--depth S|M|L]
[--execute]`, `status <runId>`, `resume <runId>`, `stop <runId>`, `report
<runId> [--pr]`, `runs`, `analyze [workdirs…] [--json]`, and a bare
run-directory argument that prints the fold summary. A missing or invalid
argument SHALL fail with a usage line naming the verb inventory. `analyze`
SHALL route by workdir paths, never by run id.

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
