# sdd-runner-cli Specification

## Purpose

Defines the runner's human-facing interaction surface: how a gate decision is
elicited (interactive session, flags, or hand-edited file), how pending gates
are discovered without memorizing run ids, and how the CLI routes an operator to
the right next step.

## Requirements

### Requirement: Interactive gate session on a terminal

When a gate resume runs on a terminal, the runner SHALL present each finding and
assumption as a prompt — accept, veto (entering the redirect inline), or inspect
the item's evidence and blast radius — and SHALL then offer the gate decisions
(approve, extend, abort) with each decision's downstream effect printed beside
it. The session SHALL write the gate file from the collected answers: the file
remains the audit record and hash anchor, produced by the interaction rather
than edited by hand.

#### Scenario: Guided walkthrough

- **WHEN** an operator resumes a pending gate on a terminal
- **THEN** each finding and assumption is presented with an
  accept/veto/inspect prompt, and inspecting shows the item's evidence and
  blast radius before deciding

#### Scenario: Trajectory acknowledgment gates approval

- **WHEN** the gate is an early (cap-hit) gate
- **THEN** the walkthrough includes the trajectory acknowledgment, and approve
  is unavailable until it is affirmed

#### Scenario: Cap-hit blocker requires an answer

- **WHEN** an early gate lists an open blocker
- **THEN** the session prompts for a free-text answer or an explicit override,
  and approve is unavailable while any blocker is unanswered

#### Scenario: Session writes the gate file

- **WHEN** the operator completes the prompts and picks a decision
- **THEN** the gate file is written from those answers in the existing gate
  format, and the pipeline acts on it exactly as if it had been hand-edited

#### Scenario: Session interrupted leaves no partial state

- **WHEN** the operator abandons a session before the final decision
- **THEN** the gate file and run state are untouched and a later session starts
  fresh

### Requirement: Non-interactive flag path

When standard input is not a terminal, or decision flags are passed, the runner
SHALL NOT prompt and SHALL act on flags alone: the existing `--confirm-all` and
`--abort`, plus a new `--extend` (run one more review round, then re-gate) and a
repeatable `--veto <id>=<redirect>`. Flags SHALL produce outcomes identical to
the equivalent hand-edited gate file.

#### Scenario: Extend without file editing

- **WHEN** `gate resume <runId> --extend` is invoked for a pending early gate
- **THEN** one more review round runs and a new gate version is presented, with
  no file edit required

#### Scenario: Veto with redirect via flag

- **WHEN** `gate resume <runId> --veto A1="reuse the encrypted config path"` is
  invoked
- **THEN** assumption A1 is vetoed with that redirect, the rework runs, and a new
  gate version is presented

#### Scenario: Flags compose predictably

- **WHEN** `--confirm-all` is combined with `--veto` flags
- **THEN** every item is accepted except the vetoed ids, which carry their
  redirects; an unknown veto id fails before any pipeline action, and
  `--extend` is rejected in combination with `--confirm-all`, `--veto`, or
  `--abort`

### Requirement: Pending-gate discovery and run-id ergonomics

Whenever a run halts at a gate, the runner SHALL print a next-step line
containing the exact resume command with that run's id, since multiple runs may
be gate-pending concurrently. A bare `gate` command (no id) SHALL list all
gate-pending runs — as an interactive picker on a terminal, as a plain list
otherwise. Unambiguous id prefixes SHALL be accepted; an ambiguous prefix SHALL
fail with the candidate ids listed.

#### Scenario: Halt prints the concrete next step

- **WHEN** a run halts at a gate
- **THEN** the output includes a next-step line with the full resume command and
  the run id, copy-pasteable without editing

#### Scenario: Bare gate command lists pending runs

- **WHEN** `gate` is invoked without a run id and two runs are gate-pending
- **THEN** both are listed with id, change name, gate version, and wait time;
  on a terminal the operator picks one to open its session

#### Scenario: Ambiguous prefix fails loudly

- **WHEN** a run-id prefix matches more than one gate-pending run
- **THEN** the command fails and lists every matching candidate id

### Requirement: One routing verb and a loud gate-pending signal

A `continue` command SHALL inspect run state and route: gate-pending → the gate
flow; interrupted mid-stage → stage resume; completed → a pointer to the report.
Invoking `resume` for a gate-pending run SHALL print that the run awaits a gate
decision together with the exact gate command and run id, rather than exiting
silently.

#### Scenario: Continue routes to the gate

- **WHEN** `continue <runId>` is invoked for a gate-pending run
- **THEN** the gate flow for that run is entered (session on a terminal, flag
  handling otherwise)

#### Scenario: Resume on a gate-pending run is loud

- **WHEN** `resume <runId>` is invoked for a gate-pending run
- **THEN** the output states the run awaits a gate decision and prints the exact
  gate command with the run id

### Requirement: Hand-edited gate file remains supported

The existing gate-file format and parser SHALL be preserved: an operator who
hand-edits the gate file (checkboxes, magic directives) gets identical behavior
to today. The interactive session and flags are alternative front-ends over the
same file contract.

#### Scenario: Hand edit still parses

- **WHEN** an operator hand-edits the gate file and resumes without flags on a
  non-terminal input
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
