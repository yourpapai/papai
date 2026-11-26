<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Gives operators a read-only, failure-focused query over the persisted usage-event
tables so post-restart post-mortems can list errored LLM turns and failed tool
calls merged newest-first, without altering usage recording.

## ADDED Requirements

### Requirement: Failure sources

The failure query SHALL return only failure rows drawn from the two persisted
usage-event sources: LLM turns whose recorded error is set (non-null), and tool
calls recorded as unsuccessful. Successful LLM turns and successful tool calls
SHALL NOT appear in the result.

#### Scenario: Only failed rows are returned

- **WHEN** the persisted usage events include successful LLM turns, errored LLM
  turns, successful tool calls, and failed tool calls
- **THEN** the result contains exactly the errored LLM turns and the failed tool
  calls, with every successful row excluded

### Requirement: Merged newest-first ordering

Rows from both failure sources SHALL be merged into a single result ordered
newest-first by occurrence time, regardless of which source each row came from.

#### Scenario: Cross-source ordering

- **WHEN** the newest failure is a failed tool call and an older failure is an
  errored LLM turn
- **THEN** the tool-call failure row is returned before the LLM-turn failure row

### Requirement: Time-window filtering

The failure query SHALL accept an optional time window in milliseconds. When a
positive window is supplied, only rows whose occurrence time is at or after
(now − window) SHALL be returned. When the window is null or omitted, all time
SHALL be covered.

#### Scenario: Window excludes older failures

- **WHEN** a one-hour window is supplied and the persisted failures include one
  from five minutes ago and one from three days ago
- **THEN** only the five-minutes-ago failure is returned

#### Scenario: Null or omitted window covers all time

- **WHEN** the window is null or omitted and failures of any age are persisted
- **THEN** every failure is eligible for the result regardless of age

### Requirement: Limit clamping

The failure query SHALL accept an optional result limit. The limit SHALL be
floored to an integer, clamped to the inclusive range 0–200, and default to 25
when omitted. A clamped limit of 0 SHALL return an empty result. The limit SHALL
be applied after merging and ordering, so the newest failures win.

#### Scenario: Default limit

- **WHEN** 40 failures are persisted and no limit is supplied
- **THEN** the 25 newest failures are returned

#### Scenario: Zero limit returns nothing

- **WHEN** the limit is 0
- **THEN** an empty result is returned

#### Scenario: Fractional limit floors

- **WHEN** the limit is 10.9
- **THEN** at most 10 rows are returned

#### Scenario: Oversized limit clamps to 200

- **WHEN** the limit is 500 and 300 failures are persisted
- **THEN** the 200 newest failures are returned

### Requirement: Failure row shape

Each returned row SHALL carry a discriminator `kind` of `llm` or `tool`, plus
shared fields: occurrence timestamp, turn id, storage context id, context type,
chat user id, model, model role, and nullable duration. Rows with `kind: 'llm'`
SHALL additionally carry the error string and a nullable finish reason. Rows
with `kind: 'tool'` SHALL additionally carry the tool name, nullable error type
and error code, and nullable retryable and recovered flags. Nullable source
fields recorded as missing SHALL be normalized to null.

#### Scenario: LLM failure row

- **WHEN** an LLM turn errored with error text `rate limited` and no finish
  reason recorded
- **THEN** its row has `kind` `llm`, error `rate limited`, and finish reason null

#### Scenario: Tool failure row

- **WHEN** a tool call failed with error type `TimeoutError`, no error code,
  retryable true, and recovered false
- **THEN** its row has `kind` `tool`, the called tool's name, error type
  `TimeoutError`, error code null, retryable true, and recovered false

#### Scenario: Nullable field normalization

- **WHEN** a source row leaves any of finish reason, error type, error code,
  retryable, recovered, or duration unrecorded
- **THEN** the returned row reports that field as null

### Requirement: Read-only query

The failure query SHALL NOT modify persisted usage events or change usage
recording behavior. Executing it any number of times SHALL leave recorded events
and ongoing recording identical to a run without the query.

#### Scenario: Repeated queries are side-effect free

- **WHEN** the failure query is executed repeatedly against a populated database
  while usage recording is active
- **THEN** no rows are added, changed, or removed by the query, and the recorded
  events match a run in which the query was never issued
