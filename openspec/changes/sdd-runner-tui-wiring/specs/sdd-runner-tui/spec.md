# sdd-runner-tui delta

## MODIFIED Requirements

### Requirement: Interactive terminals get the TUI

The runner SHALL render its interactive terminal UI — the running screen for any live run and the gate screen for gate decisions — whenever stdout and stdin are TTYs, no CI environment variable is set, and the terminal type is not `dumb`. Mode selection SHALL gate every route that drives a live run (task-file start, state-routed resume, continue), not only gate decisions. While the interactive view is active the runner SHALL NOT also emit append-only line output: the line renderer SHALL NOT be subscribed to the event stream in this mode. In every other condition the runner SHALL emit append-only line output with no in-place redraw, preserving the pre-change non-interactive byte contract; a debug environment variable (`SDD_DEBUG=1`) SHALL raise the line output to include tool-level events and SHALL NOT switch a non-TTY context into the TUI.

#### Scenario: Interactive terminal renders the TUI

- **WHEN** a run starts with stdout and stdin as TTYs and no CI variable set
- **THEN** the interactive view renders in place and no scrolling line output is produced

#### Scenario: Piped output stays line-based

- **WHEN** stdout is piped or a CI environment variable is set
- **THEN** output is append-only lines with no ANSI in-place redraw sequences

#### Scenario: Debug env raises line altitude

- **WHEN** line output is active and `SDD_DEBUG=1` is set
- **THEN** tool-call and step events are included as scrolling lines

#### Scenario: Resuming a run on a terminal renders the TUI

- **WHEN** `sdd <run-id>` resumes an interrupted or stopped run with stdout and stdin as TTYs
- **THEN** the interactive view renders for the continued run and no scrolling line output is produced

### Requirement: Running screen shows live pipeline state

While a run is active the TUI SHALL show the pipeline stage map with per-stage status, one line per active agent carrying its current tool call, the per-round finding burndown, and an accumulated status line (round/cap, token totals, cost, elapsed). The view SHALL update as events arrive from the run's event stream, whether the run was started fresh in this process or continued through a routing verb. When the screen attaches to a run that already produced events, it SHALL first rebuild its state by replaying the run's event log alone, then follow live events. The view SHALL show the stop affordance (`q`) with its calm-stop meaning, and the affordance SHALL request a calm stop honored at the next boundary through the same stop seam the `sdd stop` verb uses.

#### Scenario: Agent tool call appears in its slot

- **WHEN** an agent emits a tool-use event
- **THEN** that agent's line shows the tool name and argument and updates on the next event

#### Scenario: Burndown gains a row per completed round

- **WHEN** a review round closes with filed findings
- **THEN** a burndown row for that round appears with per-severity open counts

#### Scenario: Re-attach rebuilds from the event log

- **WHEN** the running screen attaches to a run whose event log already holds completed stages
- **THEN** the initial frame reflects the replayed stages, agents, and burndown before any new event arrives

#### Scenario: Stop affordance reaches the boundary seam

- **WHEN** `q` is pressed while the running screen is live
- **THEN** a calm stop is requested through the boundary stop seam, the run continues to the next boundary, and its state records stopped-but-resumable
