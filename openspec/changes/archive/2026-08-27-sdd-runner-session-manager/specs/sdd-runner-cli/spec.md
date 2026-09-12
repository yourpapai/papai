## Delta: sdd-runner-cli

## MODIFIED Requirements

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

The screen SHALL be a loop rather than a launcher: after a routed action
completes (gate settled, run finished, report displayed, stop requested,
creation settled), the runner SHALL re-present the session screen with rows
re-read from storage. A run that ends by taking over the terminal (gate
session, run screen) SHALL return to the screen when that surface finishes.
An action that fails SHALL surface a notice and return to the screen instead
of exiting. The process SHALL exit only on an explicit quit from the screen.

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
