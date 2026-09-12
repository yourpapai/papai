# sdd-runner-cli spec

## Purpose

Defines the sdd-runner command surface: a single routing verb that starts, resumes, decides, and reports runs, plus a calm-stop verb, so a newcomer operates the pipeline without subcommand knowledge.

## ADDED Requirements

### Requirement: Single routing verb resolves any target

The `sdd [<target>]` command SHALL resolve its target in this order: an existing task-file path (start a new run), an exact run id, an unambiguous run-id prefix, a single gate-pending run, a single interrupted run (including calmly stopped runs), then a single completed run (print its report). With several candidates at any resolution step the command SHALL list each candidate with the concrete command that selects it and exit without side effects.

#### Scenario: Task file starts a new run

- **WHEN** `sdd path/to/task.md` is run and the path exists as a file
- **THEN** a new run starts for the task and no existing run is resumed

#### Scenario: Exact run id routes by state

- **WHEN** `sdd <full-run-id>` is run
- **THEN** the run's state decides the action: gate-pending opens the decision flow, interrupted or stopped resumes it, completed prints the report

#### Scenario: Ambiguous prefix fails loudly

- **WHEN** a run-id prefix matches more than one run
- **THEN** the command fails listing every candidate id, without touching any run

#### Scenario: No target routes to the sole candidate

- **WHEN** `sdd` is run with no target and exactly one run is gate-pending
- **THEN** that run's gate decision flow opens

#### Scenario: No target with several candidates lists them

- **WHEN** `sdd` is run with no target and more than one run could route
- **THEN** each candidate is listed with the exact command to select it and the command exits without side effects

### Requirement: Start-time flags are limited to the depth override

`sdd <task-file>` SHALL accept `--depth S|M|L` as its only run-shaping flag; when absent, the depth estimator classifies the task. `--pr`, `--config`, and `--reopen` are the only other flags on the surface.

#### Scenario: Depth override wins over classification

- **WHEN** `sdd task.md --depth S` is run
- **THEN** the run uses the S profile regardless of what the estimator would classify

#### Scenario: Unknown flag is rejected

- **WHEN** any flag outside the documented set is passed
- **THEN** the command fails before any run starts, listing the valid flags

### Requirement: Calm stop verb

`sdd stop [<id>]` SHALL request a calm stop of the identified run — or the sole active run when no id is given — without killing in-flight agents. It SHALL fail with the candidate list when several runs are active and no id is given.

#### Scenario: Stop the only active run

- **WHEN** `sdd stop` is run while exactly one run is active
- **THEN** that run records a stop request honored at the next boundary and remains resumable

#### Scenario: Several active runs require an id

- **WHEN** `sdd stop` is run while two runs are active
- **THEN** the command fails listing both runs and stops neither

### Requirement: Completed runs print their report

`sdd <completed-run-id>` SHALL print the run report; `--pr` SHALL produce the PR-flavored variant.

#### Scenario: Completed run reports

- **WHEN** `sdd <run-id>` resolves to a completed run
- **THEN** the run report is printed and no pipeline action is taken

### Requirement: Removed legacy surface fails with guidance

Invocations shaped like the removed subcommand surface (`start`/`resume`/`gate`/`continue`/`report`/`audit`/`watch` as first argument) and the removed decision flags SHALL fail with an error naming the replacement routing usage or gate-file path.

#### Scenario: Legacy subcommand rejected with pointer

- **WHEN** `sdd gate resume <run-id>` is run
- **THEN** the command fails without side effects and the error names the replacement form (`sdd <run-id>`)

#### Scenario: Legacy decision flag rejected with pointer

- **WHEN** a removed decision flag such as `--confirm-all` is passed
- **THEN** the command fails and the error points at the hand-edited gate file as the non-interactive decision path

### Requirement: Config path override

`--config <path>` SHALL override the configuration file location; the `SDD_RUNNER_CONFIG` environment variable SHALL be honored when the flag is absent.

#### Scenario: Flag wins over environment

- **WHEN** both `--config` and `SDD_RUNNER_CONFIG` are set
- **THEN** the flag's path is loaded

### Requirement: Gate reopen

`sdd <run-id> --reopen [<n>]` SHALL re-present a settled auto-decided gate at a fresh unanswered version; when `n` is omitted the latest settled gate SHALL be used. It SHALL refuse when a gate is already pending, the version is missing, or the version was never settled.

#### Scenario: Reopen latest settled gate

- **WHEN** `sdd <run-id> --reopen` is run on a run whose latest gate was auto-settled
- **THEN** that gate is re-presented as pending at a fresh version and the run resumes through the decision flow

#### Scenario: Refuse while a gate is pending

- **WHEN** `sdd <run-id> --reopen` is run on a run that already has a pending gate
- **THEN** the command refuses without modifying the pending gate
