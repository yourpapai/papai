# afk-runner-agent-todos — Delta Spec

## Purpose

Stage agents' own todo lists — their live plan/progress inside one agent session — become run facts: appended to the run's event log as tolerated L0 telemetry while the agent works, so any log reader (the web board, corpus analysis) can see what a running agent is doing below stage granularity.

## ADDED Requirements

### Requirement: Todo snapshot emission into the run log

When a spawned stage agent updates its todo list through a todo tool, the engine SHALL append an `agent_todos {agent, todos[]}` event to the run's event log through the existing emit path, carrying the agent's label and the normalized todo list. Events SHALL be appended live, while the agent session is running.

#### Scenario: Implementer updates its plan mid-task

- **WHEN** an `implement-t<n>` agent calls the todo tool with a list whose items carry statuses
- **THEN** an `agent_todos` event naming that agent label is appended with every item's content and status, before the agent session ends

#### Scenario: Resolver rewrites a completed list

- **WHEN** a resolver agent rewrites its todo list marking items completed
- **THEN** a second `agent_todos` event is appended reflecting the new statuses

### Requirement: Backend normalization to one item shape

Todo capture SHALL normalize both supported backends' todo-tool inputs — opencode `todowrite` (`{content, status, priority}` items) and claude `TodoWrite` (`{content, status, activeForm}` items) — to `{content, status}` items before emission. Backend-internal fields SHALL NOT appear in the event. Non-todo tools SHALL NOT emit; the read-only todo read tool SHALL NOT emit.

#### Scenario: opencode envelope normalizes

- **WHEN** the agent stream carries a `todowrite` part whose input items include a `priority` field
- **THEN** the emitted items carry only `content` and `status`

#### Scenario: claude envelope normalizes

- **WHEN** the agent stream carries a `TodoWrite` part whose input items include an `activeForm` field
- **THEN** the emitted items carry only `content` and `status`

#### Scenario: Todo read does not emit

- **WHEN** an agent invokes the read-only todo read tool
- **THEN** no `agent_todos` event is appended

#### Scenario: Unknown tool degrades to today's behavior

- **WHEN** the agent stream carries a `tool_use` part whose tool is not a recognized todo tool
- **THEN** behavior is unchanged — the existing `tool_use` L0 event only

### Requirement: Dedup and content bounds

Identical consecutive snapshots from the same agent SHALL NOT be re-emitted. Each emitted item's content SHALL be truncated at 200 characters, and each emitted list SHALL be capped at 20 items.

#### Scenario: Unchanged list is skipped

- **WHEN** an agent calls the todo tool twice with byte-identical lists
- **THEN** only the first call emits an `agent_todos` event

#### Scenario: Long item content is truncated

- **WHEN** an item's content exceeds 200 characters
- **THEN** the emitted content is truncated at 200 characters

#### Scenario: Oversized list is capped

- **WHEN** an agent emits a list of more than 20 items
- **THEN** the emitted event carries the first 20 items

### Requirement: Log tolerance preserved

Both folds SHALL treat `agent_todos` as tolerated noise — the machine state SHALL NOT change and the event SHALL NOT drive any transition. The event SHALL pass event-schema validation on append and on read.

#### Scenario: Fold accounting counts the event tolerated

- **WHEN** a log containing `agent_todos` events is folded
- **THEN** the fold's tolerated count includes them and the resulting machine snapshot is identical to the fold of the same log without them

#### Scenario: Append and read validation accept the event

- **WHEN** an `agent_todos` event is appended and the log is read back
- **THEN** both the append-time and read-time schema validation accept every line

### Requirement: Reporter consumers are unaffected by the capture

The todo hook on the agent reporter SHALL be optional; any consumer that does not observe it SHALL behave exactly as before the change.

#### Scenario: Non-observing consumer is unchanged

- **WHEN** a consumer spawns an agent through the seam without observing the todo hook, and the agent updates its todo list
- **THEN** the consumer's observable behavior — its rendering, its usage accounting, its results — is unchanged
