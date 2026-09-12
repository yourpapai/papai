# afk-runner-board-todos — Delta Spec

## Purpose

The board renders stage agents' todo telemetry from the run log: a run-detail panel showing, per agent, its latest todo list with item statuses — the agent's own plan and progress below the walk's task granularity — on a detail view that stays live while open.

## ADDED Requirements

### Requirement: Agent todos panel in run detail

A run's detail view SHALL render an agent todos panel listing, per agent label that has emitted `agent_todos` events, the agent's latest todo snapshot with each item's content and status, and when that snapshot was taken. Agents with no todo events SHALL NOT appear. A run whose log contains no `agent_todos` events SHALL render no panel. The panel SHALL NOT add any action — it renders read-only state from the log.

#### Scenario: Running implementer's plan is visible

- **WHEN** a run's log holds `agent_todos` events from `implement-t2` and `resolver-r1`, and the operator opens the run's detail
- **THEN** the panel shows both agents, each with its latest list, item statuses rendered per item

#### Scenario: Run without todo telemetry renders nothing extra

- **WHEN** the operator opens a run whose log has no `agent_todos` events
- **THEN** the detail renders exactly as before this capability — no panel, no error

#### Scenario: Historical run renders its last snapshots

- **WHEN** the operator opens a finished run whose log holds `agent_todos` events from completed agents
- **THEN** the panel renders each agent's last snapshot from the log, with its age visible

#### Scenario: Snapshot recency is visible

- **WHEN** the panel renders an agent's latest todo snapshot
- **THEN** it shows when that snapshot was taken, without any extra fetch beyond the run-detail one

### Requirement: Recent-events feed excludes todo telemetry

The bounded recent-events feed SHALL NOT include `agent_todos` events; their content is rendered by the panel. The exclusion SHALL happen before the feed's bound is applied, so a todo burst cannot shrink the feed below its size — the feed stays full of the run's other activity. All other event types keep their current feed treatment.

#### Scenario: Feed is not crowded by checkbox churn

- **WHEN** a run's recent events include gate presentation, a task start, and several `agent_todos` updates
- **THEN** the feed shows the gate and task events and no todo events

#### Scenario: A todo burst does not shrink the feed

- **WHEN** the newest events of a run are dominated by `agent_todos` updates
- **THEN** the feed still renders its full bound of the run's other events, reaching past the excluded ones

### Requirement: Agent todos are labeled as agent-authored state

The panel SHALL present todo items as the agent's own scratchpad, visibly distinct from the runner's task-walk record: it SHALL carry a label naming the source (agent-emitted) and SHALL NOT reuse the walk table's visual language for todo items.

#### Scenario: Operator cannot mistake todos for walk state

- **WHEN** the detail shows the walk table (task id, status, attempts) and the agent todos panel
- **THEN** the panel's header names agent-emitted todos, and its items are rendered in the panel's own form, not as walk rows

### Requirement: Board stays read-only over todo telemetry

Rendering the panel SHALL NOT write any file, append any event, or widen the board's file seam beyond read operations. Todo projection SHALL read only the run's event log, like every other detail field.

#### Scenario: Serving a run with todo telemetry leaves the corpus unchanged

- **WHEN** the board serves a run whose log holds `agent_todos` events, including one with the detail open across several sweeps
- **THEN** the run's log, memo, and gate files are byte-unchanged
