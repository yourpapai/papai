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
