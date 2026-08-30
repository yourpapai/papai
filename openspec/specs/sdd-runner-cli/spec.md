# sdd-runner-cli Specification

## Purpose

Defines the sdd-runner command surface: a single routing verb that starts,
resumes, decides, and reports runs, plus a liveness-aware calm-stop verb, and
the interactive session screen that is the home surface for operating several
runs. A newcomer operates the pipeline without subcommand knowledge, and no
operator has to memorize a run id to reach the next step.

## Requirements

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

### Requirement: One routing verb and a loud gate-pending signal

A target-less invocation on a non-terminal context SHALL keep the plain
contract: route a sole routable run directly; otherwise list every candidate
with the concrete command that selects it and exit without side effects. On a
terminal, ambiguity SHALL open the interactive session screen instead of
exiting. An explicit run id or unambiguous prefix SHALL route by the run's
state: gate-pending → the gate flow, interrupted/stopped → resume, completed →
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
- **THEN** the gate flow for that run is entered (session on a terminal, the
  hand-edited gate file otherwise)

#### Scenario: Resume on a gate-pending run is loud

- **WHEN** `sdd <runId>` targets a gate-pending run outside the session screen
- **THEN** the output states the run awaits a gate decision and prints the
  exact gate command with the run id

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

### Requirement: Run process ownership record

A process actively driving a run SHALL keep an ownership record in the run dir
that identifies the owning process, written before pipeline work starts and
removed when the process exits cleanly. Any process SHALL be able to determine
from the record whether the owning process is still alive; a run with
`running` status and no ownership record (or a record whose process is not
alive) SHALL be considered dead.

#### Scenario: Record follows the run lifecycle

- **WHEN** a process starts or resumes a run
- **THEN** the run dir carries an ownership record naming that process, and a
  clean exit removes it

#### Scenario: Crashed owner leaves a stale record

- **WHEN** the owning process dies without cleaning up
- **THEN** the record remains but its named process is not alive, and the run
  is reported dead

#### Scenario: Legacy run has no record

- **WHEN** a run predates ownership records and its process is gone
- **THEN** the run is considered dead — absence of a record never implies a
  live owner

### Requirement: Liveness-aware stop

The `sdd stop` verb and the session screen's stop key SHALL share one stop
semantic: a live run receives the calm-stop request, honored at its next
boundary; a dead run settles immediately. Settling SHALL consume any stale
stop-request marker and move the run to the state its progress honestly
supports: a run that died before intake classification (no depth profile, no
stage artifacts) settles as aborted — not resumable; a run that died
mid-pipeline settles as stopped — resumable exactly like a live calm stop. The
stop output SHALL name which happened and the concrete next step.

#### Scenario: Live run calm-stops at the boundary

- **WHEN** stop is requested for a run whose owning process is alive
- **THEN** a calm-stop request is recorded, the run stops at its next boundary
  with consistent artifacts, and the status becomes stopped-resumable

#### Scenario: Dead mid-pipeline run settles resumable

- **WHEN** stop is requested for a dead run that had passed intake
  classification
- **THEN** the run's status becomes stopped without running any pipeline step,
  and the output states the run is resumable

#### Scenario: Dead pre-classification run settles terminal

- **WHEN** stop is requested for a dead run still at the intake stage with no
  depth profile
- **THEN** the run's status becomes aborted, and the output states there is
  nothing to resume and a fresh run starts from a task file

#### Scenario: Stale stop marker is consumed

- **WHEN** a dead run being settled carries an unconsumed stop-request marker
- **THEN** the marker is removed so a later resume of that run does not
  immediately re-stop

#### Scenario: Stopping a non-running run is a no-op

- **WHEN** stop is requested for a run already stopped, aborted, completed, or
  failed
- **THEN** no state changes and the output reports the run's current status

#### Scenario: Session screen stop settles a dead row

- **WHEN** the stop key is pressed on a session-screen row showing a dead run
- **THEN** the shared stop semantic applies, and the row no longer presents as
  active on the next listing

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

### Requirement: Runner-printed guidance names the current routing surface

Whenever the runner halts a run — at a pending gate decision, or interrupted and resumable — the next-step hint it prints SHALL be the routing invocation that reopens that flow (`sdd <run-id>`). Runner output SHALL NOT direct the operator to a removed subcommand form.

#### Scenario: Gate-halted run points at the routing verb

- **WHEN** a fresh run halts after presenting its gate
- **THEN** the printed hint names `sdd <run-id>` and no removed subcommand form appears in the runner's output

#### Scenario: Interrupted run points at the routing verb

- **WHEN** a calmly stopped run is reported as resumable
- **THEN** the printed hint names `sdd <run-id>`

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

### Requirement: Interactive session screen on a terminal

When the runner is invoked with no target on a terminal and at least one run
exists, it SHALL present every run as a selectable row showing the change name,
current stage and review round against its cap, accumulated token/cost totals,
time since last activity, and any pending decision (gate awaiting input, stop
requested). Keyboard selection SHALL route the chosen run through the same
state-derived routing as an explicit id (gate-pending → gate session;
stopped/interrupted → resume; completed → report). The screen SHALL offer row
actions matching the run's state: reopening a settled or abort-settled gate,
requesting a calm stop of an active run, and deleting a deletable run, each
equivalent to the corresponding explicit command where one exists. A
non-terminal invocation SHALL NOT present the screen; it keeps the plain
list-and-exit contract.

The screen SHALL be a loop rather than a launcher: after a routed action
completes (gate settled, run finished, report displayed, stop requested,
creation settled, deletion settled), the runner SHALL re-present the session
screen with rows re-read from storage. A run that ends by taking over the
terminal (gate session, run screen) SHALL return to the screen when that
surface finishes. An action that fails SHALL surface a notice and return to
the screen instead of exiting. The process SHALL exit only on an explicit
quit from the screen.

Deletion SHALL require an explicit confirmation that names the session being
deleted. Deletion SHALL be refused for any run whose persisted status is
running (including gate-pending and stop-requested) at the moment of
deletion, with a notice directing the operator to calm-stop first; the
refusal SHALL evaluate freshly-read persisted state, not the rendered row.
Deleting a run SHALL remove its run directory and nothing else, and the
screen SHALL re-present without the deleted row; the freed name becomes
reusable by the task-name identity rules.

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

#### Scenario: Report returns to the screen

- **WHEN** the operator selects a completed run and its report has been
  displayed
- **THEN** the session screen is re-presented with rows re-read from storage,
  and the process continues running until the operator quits

#### Scenario: Finished run returns to the screen

- **WHEN** a resumed run or gate session started from the screen finishes
- **THEN** the session screen is re-presented with fresh rows

#### Scenario: Action failure keeps the screen alive

- **WHEN** an action initiated from the screen fails (for example, resume of a
  run whose state cannot be resumed)
- **THEN** a notice describing the failure is shown and the session screen is
  re-presented; the process does not exit

#### Scenario: Deleted session leaves the list

- **WHEN** the operator chooses delete on an aborted run's row and confirms
- **THEN** that run's directory is removed, the screen re-presents without the
  row, and no other run or file is affected

#### Scenario: Deletion requires confirmation naming the session

- **WHEN** the operator chooses delete on a row
- **THEN** a confirmation naming that session is required before anything is
  removed, and declining returns to the screen with no side effects

#### Scenario: Running run refuses deletion

- **WHEN** the operator chooses delete on a row whose persisted status is
  running at deletion time — including a run awaiting a gate decision or one
  whose calm stop has been requested but not yet honored
- **THEN** deletion is refused with a notice directing to calm-stop the run
  first, and the run is untouched

#### Scenario: Guard reads current state, not the rendered row

- **WHEN** a row was rendered as completed but the run has since transitioned
  to running, and the operator confirms deletion
- **THEN** deletion is refused against the freshly-read persisted status

### Requirement: Inline session start without a task file

The runner SHALL accept a task description entered interactively (title plus
body) as the source for a new session, so starting work does not require
creating or managing a task markdown file. The entered text SHALL be persisted
inside the run directory as the task record, and the pipeline SHALL consume it
identically to file-sourced task text. With no runs existing, a bare
invocation SHALL go directly to this creation entry. Explicit task-file starts
SHALL remain supported and behave as today.

On a terminal, creation SHALL be an interactive form within the session
surface: a title field and an optional description field, navigable and
editable by keyboard. Submitting with an empty title SHALL be rejected by
inline validation on the form (no run starts, the form stays open) — it SHALL
NOT abandon the session surface or exit the process. Cancelling the form
SHALL return to the session screen with no side effects. A submission that
passes validation SHALL start the run exactly as a task-file start, and when
that run's turn on the terminal ends, the session screen is re-presented per
its loop requirement.

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

#### Scenario: Empty title is inline validation, not abandonment

- **WHEN** the operator submits the creation form with an empty title
- **THEN** the form shows a validation notice, stays open, and no run starts

#### Scenario: Cancelling creation returns to the screen

- **WHEN** the operator cancels the creation form
- **THEN** the session screen is re-presented with no run started and no other
  side effects

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

### Requirement: Hand-edited gate file remains supported

The gate-file format and parser SHALL be preserved: an operator who
hand-edits the gate file (checkboxes, magic directives) gets identical
behavior to the interactive path. The interactive session is an alternative
front-end over the same file contract, and the hand-edited file is the
non-interactive decision path.

#### Scenario: Hand edit still parses

- **WHEN** an operator hand-edits the gate file and resumes on a non-terminal
  input
- **THEN** the file is parsed by the existing rules and the corresponding
  outcome executes

### Requirement: Run process ownership record

A process actively driving a run SHALL keep an ownership record in the run dir
that identifies the owning process, written before pipeline work starts and
removed when the process exits cleanly. Any process SHALL be able to determine
from the record whether the owning process is still alive; a run with
`running` status and no ownership record (or a record whose process is not
alive) SHALL be considered dead.

#### Scenario: Record follows the run lifecycle

- **WHEN** a process starts or resumes a run
- **THEN** the run dir carries an ownership record naming that process, and a
  clean exit removes it

#### Scenario: Crashed owner leaves a stale record

- **WHEN** the owning process dies without cleaning up
- **THEN** the record remains but its named process is not alive, and the run
  is reported dead

#### Scenario: Legacy run has no record

- **WHEN** a run predates ownership records and its process is gone
- **THEN** the run is considered dead — absence of a record never implies a
  live owner

### Requirement: Liveness-aware stop

The `sdd stop` verb and the session screen's stop key SHALL share one stop
semantic: a live run receives today's calm-stop request, honored at its next
boundary; a dead run settles immediately. Settling SHALL consume any stale
stop-request marker and move the run to the state its progress honestly
supports: a run that died before intake classification (no depth profile, no
stage artifacts) settles as aborted — not resumable; a run that died
mid-pipeline settles as stopped — resumable exactly like a live calm stop. The
stop output SHALL name which happened and the concrete next step.

#### Scenario: Live run calm-stops at the boundary

- **WHEN** stop is requested for a run whose owning process is alive
- **THEN** a calm-stop request is recorded, the run stops at its next boundary
  with consistent artifacts, and the status becomes stopped-resumable

#### Scenario: Dead mid-pipeline run settles resumable

- **WHEN** stop is requested for a dead run that had passed intake
  classification
- **THEN** the run's status becomes stopped without running any pipeline step,
  and the output states the run is resumable

#### Scenario: Dead pre-classification run settles terminal

- **WHEN** stop is requested for a dead run still at the intake stage with no
  depth profile
- **THEN** the run's status becomes aborted, and the output states there is
  nothing to resume and a fresh run starts from a task file

#### Scenario: Stale stop marker is consumed

- **WHEN** a dead run being settled carries an unconsumed stop-request marker
- **THEN** the marker is removed so a later resume of that run does not
  immediately re-stop

#### Scenario: Stopping a non-running run is a no-op

- **WHEN** stop is requested for a run already stopped, aborted, completed, or
  failed
- **THEN** no state changes and the output reports the run's current status

#### Scenario: Session screen stop settles a dead row

- **WHEN** the stop key is pressed on a session-screen row showing a dead run
- **THEN** the shared stop semantic applies, and the row no longer presents as
  active on the next listing
