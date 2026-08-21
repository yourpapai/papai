# sdd-runner-tui spec

## Purpose

Defines the single interactive terminal view for sdd-runner: live run display and in-view gate decisions on interactive terminals, with append-only line output preserved everywhere else.

## ADDED Requirements

### Requirement: Interactive terminals get the TUI

The runner SHALL render its interactive terminal UI when stdout and stdin are TTYs, no CI environment variable is set, and the terminal type is not `dumb`. In every other condition it SHALL emit append-only line output with no in-place redraw, preserving the pre-change non-interactive byte contract; a debug environment variable (`SDD_DEBUG=1`) SHALL raise the line output to include tool-level events.

#### Scenario: Interactive terminal renders the TUI

- **WHEN** a run starts with stdout and stdin as TTYs and no CI variable set
- **THEN** the interactive view renders in place and no scrolling line output is produced

#### Scenario: Piped output stays line-based

- **WHEN** stdout is piped or a CI environment variable is set
- **THEN** output is append-only lines with no ANSI in-place redraw sequences

#### Scenario: Debug env raises line altitude

- **WHEN** line output is active and `SDD_DEBUG=1` is set
- **THEN** tool-call and step events are included as scrolling lines

### Requirement: Running screen shows live pipeline state

While a run is active the TUI SHALL show the pipeline stage map with per-stage status, one line per active agent carrying its current tool call, the per-round finding burndown, and an accumulated status line (round/cap, token totals, cost, elapsed). The view SHALL update as events arrive and SHALL show the stop affordance (`q`) with its calm-stop meaning.

#### Scenario: Agent tool call appears in its slot

- **WHEN** an agent emits a tool-use event
- **THEN** that agent's line shows the tool name and argument and updates on the next event

#### Scenario: Burndown gains a row per completed round

- **WHEN** a review round closes with filed findings
- **THEN** a burndown row for that round appears with per-severity open counts

### Requirement: Gate screen is the decision surface

When the run awaits a gate decision, the TUI SHALL present every assumption, open finding, and blocker as an item with its evidence, collect veto redirects and blocker answers through in-view single-line text input, and offer approve / extend / abort with each choice's downstream consequence displayed beside it. Approve SHALL remain unavailable until the trajectory ack is affirmed and every blocker is answered.

#### Scenario: Approve blocked until ack and answers

- **WHEN** the operator attempts to approve while the trajectory ack is unchecked or a blocker is unanswered
- **THEN** approve is refused with the unmet condition named

#### Scenario: Veto with redirect collected in-view

- **WHEN** the operator unchecks an item and enters redirect text
- **THEN** the redirect is recorded for that item and the decision menu reflects the pending veto

### Requirement: TUI decisions write the gate file

Every TUI decision SHALL be persisted by writing the run's gate file in its existing grammar, through the same write-then-verify path that guards hand edits. The hand-edited gate file SHALL remain a fully supported decision path, and items pre-decided by policy SHALL render as read-only in the TUI.

#### Scenario: TUI approval produces a parseable gate file

- **WHEN** the operator approves through the TUI
- **THEN** the gate file's answer section is updated such that the standard parser reads the approval without TUI-specific syntax

#### Scenario: Policy-decided items are read-only

- **WHEN** a gate item was pre-checked by the autonomy policy
- **THEN** the TUI renders it as decided-by-policy and offers no un-check affordance

### Requirement: Disposable view

The TUI SHALL hold no decision-relevant state outside run artifacts: after terminal loss, close, or process exit, invoking the routing verb on the run id SHALL restore the same screen from the run's event log alone.

#### Scenario: View restored after restart

- **WHEN** the terminal is closed mid-run and `sdd <run-id>` is run again
- **THEN** the view rebuilds to the current run state, including gate items already answered before the close

### Requirement: Calm stop keys

In the TUI, `q` and the first Ctrl-C SHALL request a calm stop honored at the next stage or round boundary; a second Ctrl-C SHALL exit immediately with code 130.

#### Scenario: First Ctrl-C requests calm stop

- **WHEN** Ctrl-C is pressed once while a run is active
- **THEN** a calm stop is requested, the run continues to the next boundary, and its state records stopped-but-resumable

#### Scenario: Second Ctrl-C exits immediately

- **WHEN** Ctrl-C is pressed a second time before the boundary is reached
- **THEN** the process exits with code 130

### Requirement: Deadline countdown and race safety

While a gate deadline is armed the TUI SHALL display the remaining time. At expiry the background waiter and the TUI SHALL be mutually exclusive writers of the gate file: whichever writes first wins, and the other SHALL be rejected with a notice that the gate was already settled, then render the settled state.

#### Scenario: Expiry settles while the operator idles

- **WHEN** the deadline expires with the gate unanswered and no TUI write in flight
- **THEN** the waiter settles the gate conservatively and the TUI renders the settled outcome

#### Scenario: Operator write wins the race

- **WHEN** the operator's decision write lands before the expiry claim
- **THEN** the waiter's action is rejected as already-settled and the operator's decision stands

### Requirement: Narrow terminal degradation

Below a minimum usable width the TUI SHALL degrade to stacked single-column regions rather than rendering broken or truncated-decision lines.

#### Scenario: Narrow terminal stacks regions

- **WHEN** the terminal is narrower than the minimum usable width
- **THEN** every region renders stacked without truncating decision items or their consequences
