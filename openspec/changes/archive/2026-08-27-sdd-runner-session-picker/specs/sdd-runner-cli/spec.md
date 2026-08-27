## Delta: sdd-runner-cli

## ADDED Requirements

### Requirement: Interactive session screen on a terminal

When the runner is invoked with no target on a terminal and at least one run
exists, it SHALL present every run as a selectable row showing the change name,
current stage and review round against its cap, accumulated token/cost totals,
time since last activity, and any pending decision (gate awaiting input, stop
requested). Keyboard selection SHALL route the chosen run through the same
state-derived routing as an explicit id (gate-pending → gate session;
stopped/interrupted → resume; completed → report). The screen SHALL offer row
actions matching the run's state: reopening a settled or abort-settled gate and
requesting a calm stop of an active run, each equivalent to the corresponding
explicit command. A non-terminal invocation SHALL NOT present the screen; it
keeps the plain list-and-exit contract.

#### Scenario: Sessions listed with live progress

- **WHEN** `sdd` runs with no target on a terminal while one run sits at review
  round 2 of 3 and another is completed
- **THEN** both appear as rows with change name, stage/round progress, token
  totals, last activity, and the pending decision or report pointer

#### Scenario: Selection routes by state

- **WHEN** the operator selects the row of a stopped run
- **THEN** the runner resumes that run exactly as if its id had been given

#### Scenario: Aborted run can be reopened from the screen

- **WHEN** the operator selects a run whose latest gate settled as ABORT and
  chooses the reopen action
- **THEN** the gate is re-presented as pending at a fresh version and the gate
  session opens, identical to `sdd <runId> --reopen`

#### Scenario: Active run can be calm-stopped from the screen

- **WHEN** the operator selects a running run and chooses the stop action
- **THEN** a calm-stop marker is requested for that run, honored at the next
  stage or round boundary

#### Scenario: Non-terminal invocation lists instead of prompting

- **WHEN** `sdd` runs with no target while stdout is not a terminal and several
  routable runs exist
- **THEN** every candidate is listed with the explicit command that selects it
  and the process exits without side effects

### Requirement: Inline session start without a task file

The runner SHALL accept a task description entered interactively (title plus
body) as the source for a new session, so starting work does not require
creating or managing a task markdown file. The entered text SHALL be persisted
inside the run directory as the task record, and the pipeline SHALL consume it
identically to file-sourced task text. With no runs existing, a bare
invocation SHALL go directly to this creation entry. Explicit task-file starts
SHALL remain supported and behave as today.

#### Scenario: Session created from typed description

- **WHEN** the operator picks new session, enters a title and description, and
  confirms a derived depth
- **THEN** a new run starts whose task text equals the entered description, and
  intake/draft/review proceed exactly as with a task file

#### Scenario: Description persists inside the run dir

- **WHEN** a session was started from a typed description
- **THEN** the full text remains available later from the run directory itself,
  independent of any repo file

#### Scenario: No runs routes to creation

- **WHEN** `sdd` runs with no target on a terminal and no runs exist
- **THEN** the runner enters the new-session flow instead of failing

### Requirement: Task-name session identity

Newly created sessions SHALL use the slugified task name as their run id and
run-directory name. When a non-terminal session already owns that name, a new
session SHALL refuse and require disambiguation; when only completed or aborted
sessions hold it, the new id SHALL take a numeric suffix (`<slug>-2`). Id
prefix resolution SHALL continue to match any stored id, including legacy
datetime-named run directories, which remain fully operable.

#### Scenario: New session named by task

- **WHEN** a session titled "fix flaky auth test" is created
- **THEN** its id and directory derive from `fix-flaky-auth-test`, displayed
  and addressable by that name

#### Scenario: Collision on an active name refuses

- **WHEN** a new session is requested with the name of a non-terminal run
- **THEN** creation fails naming the active holder, without side effects

#### Scenario: Rerun after completion suffixed

- **WHEN** a session name matches only completed runs
- **THEN** the new run takes the next free `<slug>-<n>` id

#### Scenario: Legacy datetime ids keep working

- **WHEN** an operator addresses a pre-existing datetime-named run by prefix
- **THEN** resolution and every verb behave exactly as before

## MODIFIED Requirements

### Requirement: One routing verb and a loud gate-pending signal

A target-less invocation on a non-terminal context SHALL keep today's contract:
route a sole routable run directly; otherwise list every candidate with the
concrete command that selects it and exit without side effects. On a terminal,
ambiguity SHALL open the interactive session screen instead of exiting. An
explicit run id or unambiguous prefix SHALL route by the run's state:
gate-pending → the gate flow, interrupted/stopped → resume, completed →
report. Resuming a gate-pending run SHALL print that the run awaits a gate
decision together with the exact gate command and run id, rather than exiting
silently.

#### Scenario: Terminal ambiguity selects instead of erroring

- **WHEN** `sdd` runs with no target on a terminal and several routable runs
  exist
- **THEN** the session screen opens for selection rather than the process
  exiting with a candidate list

#### Scenario: Scripted ambiguity stays loud

- **WHEN** `sdd` runs with no target without a terminal and several routable
  runs exist
- **THEN** the command lists every candidate with its selecting command and
  exits without side effects

#### Scenario: Continue routes to the gate

- **WHEN** `sdd <runId>` targets a gate-pending run
- **THEN** the gate flow for that run is entered (session on a terminal, flag
  handling otherwise)

#### Scenario: Resume on a gate-pending run is loud

- **WHEN** `sdd <runId>` targets a gate-pending run outside the session screen
- **THEN** the output states the run awaits a gate decision and prints the
  exact gate command with the run id
