## Purpose

Keeps the debug dashboard's event-derived buffers (LLM traces, turns, notifications, tool failures) and usage counters durable across dashboard connections, so operator visibility no longer depends on an open dashboard session.

## ADDED Requirements

### Requirement: Event-derived buffers capture all activity from process start
The system SHALL capture every debug event emitted by the running process into the event-derived buffers — LLM traces, assembled turns, notifications, and tool failures — and SHALL increment the message, LLM-call, and tool-call counters, regardless of whether any dashboard client is connected and regardless of the event's admin visibility. Buffers and counters SHALL therefore reflect all activity since process start, including activity before the first dashboard connection and between connections.

#### Scenario: Activity with zero connected clients is retained
- **WHEN** an LLM call and a turn complete while no dashboard client has ever connected
- **THEN** a client connecting afterwards receives an initial snapshot (`state:init`) whose LLM trace buffer contains the completed trace, whose turn buffer contains the assembled turn, and whose counters include that call and turn

#### Scenario: Buffers survive dashboard disconnects
- **WHEN** a dashboard client disconnects, further turns and LLM calls occur, and a new client connects
- **THEN** the new client's initial snapshot includes the events that occurred while no client was connected

#### Scenario: Counters accumulate with no client connected
- **WHEN** messages, LLM calls, or tool calls occur while no dashboard client is connected
- **THEN** the counters in a subsequently connected client's initial snapshot include those events

### Requirement: Capture begins before chat platforms start
The system SHALL begin capturing debug events during production startup before chat platform instances start processing messages, so no event emitted between process start and the first dashboard connection is lost. Starting capture SHALL be idempotent: repeated start invocations result in exactly one capture pipeline, so each event increments each counter exactly once and appears exactly once in each buffer.

#### Scenario: First processed message is captured
- **WHEN** a chat platform processes a message immediately after process startup, before any dashboard client connects
- **THEN** the resulting turn and its events are present in the initial snapshot sent to a client connecting later

#### Scenario: Idempotent start does not double-count
- **WHEN** the capture pipeline is started more than once during startup
- **THEN** a subsequent single LLM call increments the LLM-call counter by exactly one and adds exactly one trace to the LLM trace buffer

### Requirement: Dashboard client lifecycle does not affect capture
Connecting or disconnecting dashboard clients SHALL NOT start, stop, or duplicate event capture. Client connection state SHALL only govern ephemeral fan-out: live event broadcasting and the heartbeat.

#### Scenario: Repeated client churn does not duplicate capture
- **WHEN** dashboard clients connect and disconnect repeatedly while events occur
- **THEN** each event is reflected exactly once in the counters and buffers

### Requirement: Admin visibility enforced at broadcast and read time
The system SHALL capture events from all scopes, including scopes not visible to the admin, but SHALL expose only data visible to the current admin. Visibility SHALL be determined as follows: global-scope entries are visible; user-scope entries are visible only when their user id equals the admin user id; group-scope entries are visible only when their group id belongs to the admin's visible groups.

Live fan-out — event frames broadcast to connected clients, `llm:full` trace frames, and synthetic `turn:summary` frames — SHALL be emitted only for admin-visible events. The initial snapshot (`state:init`) SHALL filter the turn, notification, and tool-failure buffers by each entry's stored scope, and the LLM trace buffer by trace user id equal to the admin user id, since traces carry no scope and LLM events are user-scoped.

#### Scenario: Non-admin LLM call is captured but never exposed
- **WHEN** an LLM call for a non-admin user completes while a dashboard client is connected
- **THEN** no `llm:full` frame is broadcast for it and the trace is excluded from any subsequent initial snapshot, while traces for the admin's own calls remain present

#### Scenario: Non-admin turn is captured but never exposed
- **WHEN** a turn in a scope not visible to the admin starts and ends while a dashboard client is connected
- **THEN** no live frames for its events and no `turn:summary` frame are broadcast, and the assembled turn is excluded from subsequent initial snapshots

#### Scenario: Global events stay visible
- **WHEN** a global-scope event occurs while a dashboard client is connected
- **THEN** it is broadcast to the client and included in subsequent initial snapshots

### Requirement: Turn inspector keeps foreign turns unreadable
The turn inspector endpoint (`GET /turns/:id`) SHALL return an assembled turn only when the turn's scope is visible to the current admin, and SHALL respond 404 otherwise — including for turns that were captured while no client was connected. The 404 (not 403) SHALL NOT confirm the existence of a foreign turn.

#### Scenario: Admin-visible turn captured before any connection
- **WHEN** an admin-visible turn completed before any dashboard client connected
- **THEN** the turn inspector returns it with full assembled detail (status, tool calls, reply)

#### Scenario: Foreign turn returns 404
- **WHEN** the turn inspector is queried for a turn whose scope is not visible to the admin
- **THEN** it responds 404, even though the turn is retained in the turn buffer

### Requirement: Heartbeat tied to clients, not capture
The dashboard event stream SHALL send heartbeat ping frames at a 15-second interval only while at least one client is connected: the heartbeat SHALL start when the first client connects, stop when the last client disconnects, and remain independent of event capture.

#### Scenario: Heartbeat follows client presence
- **WHEN** the first dashboard client connects and the last client later disconnects
- **THEN** ping frames arrive at the interval while clients are connected, cease after the last disconnects, and event capture continues throughout

### Requirement: Counter updates broadcast to connected clients
When counters change while at least one dashboard client is connected, the system SHALL broadcast the updated counters to connected clients as a `state:stats` frame, coalescing bursts of changes. Stats frames SHALL NOT be replayed for periods with no connected clients; the initial snapshot carries the current totals instead.

#### Scenario: Stats frame on counter change
- **WHEN** an LLM call completes while a dashboard client is connected
- **THEN** the client receives a `state:stats` frame reflecting the incremented counters

### Requirement: Bounded buffer capacity
Event-derived buffers SHALL be bounded in memory: at most 65535 LLM traces, 512 turns, 2048 notifications, and 1024 tool failures. When a buffer reaches its capacity, the system SHALL drop the oldest entry to admit the newest.

#### Scenario: Oldest entries dropped at capacity
- **WHEN** more events of one kind occur than that buffer's capacity allows
- **THEN** the buffer retains exactly the most recent capacity-many entries

### Requirement: Buffers are process-local and volatile
Event-derived buffers and counters SHALL live in process memory only. They SHALL NOT be persisted to disk or a database, and SHALL reset on process restart. Because LLM traces embed generated reply text, retention beyond bounded process memory is prohibited.

#### Scenario: Restart clears buffers
- **WHEN** the process restarts after prior activity
- **THEN** a dashboard client connecting after restart receives empty buffers and zeroed counters
