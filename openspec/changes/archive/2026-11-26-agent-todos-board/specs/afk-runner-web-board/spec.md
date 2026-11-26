# afk-runner-web-board — Delta Spec

## ADDED Requirements

### Requirement: The open detail stays live

While a run's detail view is open, receiving an SSE portfolio snapshot SHALL re-fetch the selected run's detail within a bounded time, so every detail field — not only todo telemetry — stays current without user action. Re-fetches SHALL be throttled so a burst of snapshots cannot flood the server. The portfolio-over-SSE doctrine is unchanged: the snapshot payload stays the portfolio projection.

#### Scenario: Todo update reaches the open detail

- **WHEN** the operator has a run's detail open and the running agent appends an `agent_todos` event
- **THEN** the panel shows the new list within the sweep-and-fetch cadence, without any user action

#### Scenario: Snapshot burst does not flood the server

- **WHEN** several sweep cycles fire while the detail is open
- **THEN** detail re-fetches are bounded by the throttle, not one per snapshot

#### Scenario: Other detail fields stay current too

- **WHEN** a running agent's tool activity, spend, or position changes while a detail view is open
- **THEN** the re-fetched detail reflects those changes with the same cadence — the liveness is the detail view's, not the todo panel's
