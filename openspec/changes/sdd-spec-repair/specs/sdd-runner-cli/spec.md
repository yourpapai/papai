## REMOVED Requirements

### Requirement: Non-interactive flag path

**Reason:** The decision flags (`--confirm-all`, `--extend`, `--veto`, `--abort`) were removed with the subcommand cutover and today fail with errors naming their replacements; no flag-based decision surface exists.

**Migration:** The non-TTY decision path is the hand-edited `gate-<n>.md` file, already specified by the "Hand-edited gate file remains supported" requirement; internal callers (deadline waiter, steering) settle gates through the same file-writing seam.

## MODIFIED Requirements

### Requirement: Interactive gate session on a terminal

When a gate decision flow runs on a terminal — reached through the routing verb with a gate-pending run id (directly, via pending-gate discovery, or via the session screen) — the runner SHALL present each finding and assumption as a checkbox row with its evidence and blast radius — toggle to accept, toggle with an inline redirect to veto, inspect the item's evidence — and SHALL then offer the gate decisions (approve, extend at early gates, abort) with each decision's downstream effect printed beside it. The session SHALL write the gate file from the collected answers via the write-then-parse self-check: the file remains the audit record and hash anchor, produced by the interaction rather than edited by hand, and abandoning the session SHALL write nothing.

#### Scenario: Guided walkthrough

- **WHEN** an operator opens a pending gate's decision flow on a terminal
- **THEN** each finding and assumption is presented with accept/veto affordances, and inspecting shows the item's evidence and blast radius before deciding

#### Scenario: Trajectory acknowledgment gates approval

- **WHEN** the gate is an early (cap-hit) gate
- **THEN** the walkthrough includes the trajectory acknowledgment, and approve is unavailable until it is affirmed

#### Scenario: Cap-hit blocker requires an answer

- **WHEN** an early gate lists an open blocker
- **THEN** the session collects a free-text answer or an explicit override, and approve is unavailable while any blocker is unanswered

#### Scenario: Session writes the gate file

- **WHEN** the operator completes the prompts and picks a decision
- **THEN** the gate file is written from those answers in the existing gate format, and the pipeline acts on it exactly as if it had been hand-edited

#### Scenario: Session interrupted leaves no partial state

- **WHEN** the operator abandons a session before the final decision
- **THEN** the gate file and run state are untouched and a later session starts fresh

### Requirement: Pending-gate discovery and run-id ergonomics

Whenever a run halts at a gate, the runner SHALL print a next-step line containing the exact command with that run's id (`sdd <runId>` under the start script), since multiple runs may be gate-pending concurrently. An invocation with no target on a terminal with pending gates SHALL list all gate-pending runs — a picker on a terminal, a plain list otherwise — with id, change name, gate version, and wait time; the session screen SHALL present every run as a selectable row with its pending-decision state. Unambiguous id prefixes SHALL be accepted; an ambiguous prefix SHALL fail with the candidate ids listed.

#### Scenario: Halt prints the concrete next step

- **WHEN** a run halts at a gate
- **THEN** the output includes a next-step line with the full command and the run id, copy-pasteable without editing

#### Scenario: Bare gate command lists pending runs

- **WHEN** the runner is invoked with no target and two runs are gate-pending
- **THEN** both are listed with id, change name, gate version, and wait time; on a terminal the operator picks one to open its session

#### Scenario: Ambiguous prefix fails loudly

- **WHEN** a run-id prefix matches more than one candidate run
- **THEN** the invocation fails and lists every matching candidate id
