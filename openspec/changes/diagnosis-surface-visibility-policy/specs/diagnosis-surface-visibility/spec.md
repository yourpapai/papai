<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Defines which content the diagnosis surface (the debug dashboard's log buffer,
SSE event stream, and LLM-trace/turn buffers) may release to an authenticated
dashboard session, so one bot admin can never read another admin's users'
message content while structural and aggregate diagnostics stay visible.

## ADDED Requirements

### Requirement: Per-session visibility principal

The diagnosis surface SHALL evaluate content visibility against the bot-admin
identity of the authenticated dashboard session making the request (the admin
the session was minted for), not against a process-wide single admin. All
egress on the surface — REST responses and SSE events alike — SHALL be filtered
through the requesting session's admin visibility.

#### Scenario: Second admin's session is filtered by its own identity

- **WHEN** the server was started by admin A, admin B holds a dashboard session
  minted for B, and B requests diagnosis data whose attribution differs from
  A's
- **THEN** B's responses are filtered against B's visibility, not A's, so
  B's own-scope content is present in full and A-only content is not

#### Scenario: Concurrent sessions do not cross-contaminate

- **WHEN** admins A and B hold concurrent SSE sessions on `/events`
- **THEN** each stream applies its own session's visibility, and content
  visible on one stream is not disclosed on the other by virtue of that other
  session existing

### Requirement: Scope attribution of diagnosis content

Diagnosis content (log entries, turns, LLM traces, notifications, tool
failures) SHALL be attributed to exactly one scope kind — `global`, `user`
(with the acting user id), or `group` (with the group id) — derived from an
explicit user/group attribution field on the content when present, or via the
content's turn id joined against turns admitted by the visibility check.
Content SHALL be released in full only when its scope is `global` or its `user`
scope matches the session admin's own user id. Under this change no group is
in any session admin's visible set, so group-scoped and unattributable content
is released only in the anonymity-safe shape.

#### Scenario: Own-user log entry passes in full

- **WHEN** a buffered log entry carries a user attribution equal to the
  session admin's own user id and includes that user's message text
- **THEN** the entry is returned verbatim, content included, on both
  `GET /logs` and the `log:entry` SSE stream for that session

#### Scenario: Global-scope entries remain visible

- **WHEN** an entry is attributed to the global scope, for example startup or
  scheduler diagnostics
- **THEN** every authenticated session receives it in full

#### Scenario: Group-scoped content is not released in full

- **WHEN** a log entry or turn is attributed to a group scope, whatever the
  group
- **THEN** no session receives its free-form content; it egresses only in the
  anonymity-safe shape

### Requirement: Anonymity-safe egress shape for non-visible entries

Log entries not attributable to the session admin's own or the global scope
SHALL egress only in an anonymity-safe shape honoring the `/stats/*` anonymity
contract: structural fields (`level`, `time`, `msg`, `scope`, `turnId`) and
numeric/enum fields may be retained; free-form content fields (message text,
user text, debug payloads, and any other string fields beyond the structural
set) SHALL be stripped before the entry leaves the process. The identical
shaping SHALL apply at every egress point that serves such entries.

#### Scenario: Foreign user's text never leaves in `GET /logs`

- **WHEN** the in-memory log buffer holds an entry carrying another admin's
  user's message text and a different admin's session calls `GET /logs`
- **THEN** the response contains that entry only in the anonymity-safe shape —
  structural fields present, free-form content fields absent — while the
  session admin's own entries are returned verbatim

#### Scenario: Foreign user's text never leaves on the SSE stream

- **WHEN** a new log entry carrying a foreign user's message text is pushed
  while a non-matching admin session is connected to `/events`
- **THEN** the `log:entry` event delivered to that client carries the
  anonymity-safe shape, and another client's wider visibility does not widen
  this client's egress

#### Scenario: Aggregate counts are unaffected

- **WHEN** entries are content-stripped for a session
- **THEN** log statistics and matching counts for that session remain
  aggregate numbers over the whole buffer

### Requirement: LLM trace visibility

LLM traces SHALL be attributed to the user whose turn produced them. Traces
attributable to the session admin's own scope may be delivered in full; traces
of any other user SHALL NOT carry generated text or tool call
arguments/results to that session — neither in the `state:init` snapshot of
buffered traces nor in live trace events. Structural and numeric trace fields
(timestamps, model identifiers, step/token/duration counters) are diagnostics
and may be delivered.

#### Scenario: Foreign buffered trace is content-free in `state:init`

- **WHEN** a non-matching admin session connects and the recent-trace buffer
  holds a foreign trace with `generatedText` and tool `args`/`result`
- **THEN** the `state:init` snapshot delivered to that session contains no
  foreign `generatedText` and no foreign tool arguments or results, while the
  session admin's own traces appear in full

#### Scenario: Foreign live trace is content-free

- **WHEN** an LLM turn ends for a user outside the session admin's visibility
  while that session is connected
- **THEN** any live trace event delivered to that session carries no generated
  text and no tool call arguments or results for that user

### Requirement: Initial state snapshot visibility

The `state:init` snapshot sent on SSE connection SHALL be visibility-filtered
for the connecting session's admin across its content-bearing buffers:
`recentTurns`, `recentNotifications`, and `recentToolFailures` SHALL NOT
include content of scopes not visible to that admin, applying the same
per-session attribution and anonymity shaping as the log surface.
Aggregate snapshots (scheduler, pollers, message cache, counters) are
global-scope diagnostics and remain available to every authenticated session.

#### Scenario: Foreign turns absent from a second admin's snapshot

- **WHEN** admin B connects while the turn buffer holds turns of admin A's
  users, including their message text
- **THEN** B's `state:init` exposes none of that content, and A's own session
  still receives A-visible turns

#### Scenario: Global diagnostics stay in every snapshot

- **WHEN** any authenticated session connects
- **THEN** its `state:init` still includes the global-scope diagnostics
  snapshots and counters

### Requirement: Turn lookup isolation

REST turn lookup (`GET /turns/:id`) SHALL admit a turn only when its scope is
visible to the requesting session's admin. A turn outside that visibility
SHALL return `404` and SHALL NOT confirm the turn's existence.

#### Scenario: Foreign turn id returns 404

- **WHEN** a session admin requests a turn id belonging to another admin's
  user
- **THEN** the response is `404` and discloses nothing about the turn

#### Scenario: Own turn id returns the turn

- **WHEN** a session admin requests a turn id whose scope is that admin's own
  user scope
- **THEN** the turn is returned in full

### Requirement: Aggregate-only log statistics routes

`GET /logs/stats` and `GET /logs/scopes` SHALL return aggregate-shaped data
only — counts, capacities, oldest/newest timestamps, and scope-name counts —
and SHALL NOT include free-form content from any scope.

#### Scenario: Stats responses carry no content

- **WHEN** the buffer holds entries with user message text and a session
  requests `/logs/stats` or `/logs/scopes`
- **THEN** the response contains only counts, timestamps, and scope names, and
  no message text from any user

### Requirement: Read-only diagnosis surface

Every diagnosis-surface route — `/logs*`, `/events`, `/turns/*`, `/stats/*`,
and the `/admin/*` read panels — SHALL accept `GET` requests only. Any
non-GET method SHALL return `405` and SHALL NOT mutate any state. The surface
SHALL introduce no mutating handler.

#### Scenario: Writes are rejected

- **WHEN** a request with method `POST`, `PUT`, `PATCH`, or `DELETE` targets
  any diagnosis-surface route with a valid session
- **THEN** the response is `405` and no buffered entry, trace, turn, or
  configuration changes as a result

#### Scenario: GET remains functional

- **WHEN** the same routes are requested with `GET` under the same session
- **THEN** they serve their visibility-filtered payloads normally
